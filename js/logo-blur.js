/**
 * logo-blur.js
 * ------------------------------------------------------------------------
 * Plain browser script (no bundler / no ES modules) that reproduces the
 * OpenCV-based "hide logo" feature from the original single-file app
 * ("תכנת שליחה - עובד.HTML", search for `applyLogoBlurToPdf` /
 * `initCropModal` around line 4058 and 4343 there).
 *
 * This file owns ONLY the OpenCV / geometry / canvas-pixel-manipulation
 * logic. It does NOT own:
 *   - the mouse-drag crop UI (rubber-band rectangle drawing) — the UI
 *     layer draws the overlay and calls cropRegionFromCanvas() with the
 *     final pixel rectangle once the user releases the mouse.
 *   - PDF rendering (pdf.js) or PDF page embedding (pdf-lib) — the UI /
 *     PDF layer is expected to rasterize PDF pages to <canvas> elements,
 *     hand them to LogoBlur.processPdfPages(), and re-embed the resulting
 *     canvases back into the PDF itself.
 *   - persistent UI form state (which radio button is checked, offset
 *     input values) — those are plain form state and belong to the UI
 *     layer. The one exception is the cropped logo template image itself
 *     (dataURL + relative rect), which this module optionally persists
 *     under the SAME localStorage keys the original app used
 *     ('userCropLogoBase64' / 'userCropLogoData'), since that is the
 *     actual artifact this module produces and consumes.
 *
 * Requires OpenCV.js to be loaded as a global `cv`, e.g.:
 *   <script src="opencv.js" async></script>
 * exactly like the original app. Detection (pattern mode) and the
 * blur/inpaint effects need `cv`; fixed-position mode and the white-fill
 * effect are pure <canvas> 2D operations and work even without OpenCV.
 * ------------------------------------------------------------------------
 */
(function (window) {
    'use strict';

    // ---- Constants (mirrors the magic numbers from the original file) ----

    /** 1 mm expressed in PDF points, used to convert the manual offset (mm) into pixels. */
    var MM_TO_PT = 2.83465;

    /** Rendering scale the original app used when rasterizing PDF pages (pdf.js viewport scale 1.5). */
    var DEFAULT_RENDER_SCALE = 1.5;

    /** Minimum cv.matchTemplate score (TM_CCOEFF_NORMED) accepted as a valid pattern match. */
    var PATTERN_MATCH_THRESHOLD = 0.65;

    /** Gaussian blur kernel size used for the 'blur' effect. */
    var BLUR_KERNEL_SIZE = 45;

    /** Extra context margin (px) grabbed around the rect for the 'inpaint' effect, so TELEA has surrounding pixels to work with. */
    var INPAINT_CONTEXT_MARGIN = 30;

    /** cv.inpaint() radius parameter. */
    var INPAINT_RADIUS = 10;

    /** localStorage keys — kept identical to the original app so a saved template survives the rewrite. */
    var STORAGE_KEYS = {
        TEMPLATE_IMAGE: 'userCropLogoBase64',
        TEMPLATE_REL: 'userCropLogoData'
    };

    // ---------------------------------------------------------------------
    // OpenCV readiness
    // ---------------------------------------------------------------------

    /** @returns {boolean} true if the global `cv` (OpenCV.js) is loaded and its runtime has finished initializing. */
    function isReady() {
        return typeof cv !== 'undefined' && !!cv.Mat;
    }

    /** Throws a (Hebrew-language) error if OpenCV.js isn't ready yet — mirrors the original's `typeof cv === 'undefined'` bail-out. */
    function ensureReady() {
        if (!isReady()) {
            throw new Error('מנוע ראייה ממוחשבת (OpenCV) לא נטען.');
        }
    }

    /**
     * Resolves once OpenCV.js has finished loading and initializing (polls `isReady()`).
     * The original app never actually waited for this — it just checked `typeof cv === 'undefined'`
     * at call time and hoped the async <script> tag had already finished by then. This helper is an
     * added convenience for callers that want to await readiness explicitly; it is not required.
     * @param {number} [timeoutMs=30000] how long to wait before rejecting.
     * @returns {Promise<void>}
     */
    function whenReady(timeoutMs) {
        timeoutMs = timeoutMs || 30000;
        return new Promise(function (resolve, reject) {
            if (isReady()) { resolve(); return; }
            var start = Date.now();
            var timer = setInterval(function () {
                if (isReady()) {
                    clearInterval(timer);
                    resolve();
                } else if (Date.now() - start > timeoutMs) {
                    clearInterval(timer);
                    reject(new Error('פסק זמן בהמתנה לטעינת מנוע OpenCV.'));
                }
            }, 50);
        });
    }

    // ---------------------------------------------------------------------
    // Small geometry helpers
    // ---------------------------------------------------------------------

    /**
     * Normalizes a rectangle description into integer {x,y,width,height}, accepting either
     * an already-normalized {x,y,width,height} object, or two raw drag points
     * {x1,y1,x2,y2} / {startX,startY,endX,endY} (min/abs is applied, like the original
     * crop-modal's mousedown/mouseup handling did inline).
     * @param {Object} rect
     * @returns {{x:number,y:number,width:number,height:number}}
     */
    function normalizeRect(rect) {
        if (!rect) return { x: 0, y: 0, width: 0, height: 0 };
        var hasPoints = rect.x1 !== undefined || rect.x2 !== undefined ||
            rect.startX !== undefined || rect.endX !== undefined;
        if (hasPoints) {
            var x1 = rect.x1 !== undefined ? rect.x1 : rect.startX;
            var y1 = rect.y1 !== undefined ? rect.y1 : rect.startY;
            var x2 = rect.x2 !== undefined ? rect.x2 : rect.endX;
            var y2 = rect.y2 !== undefined ? rect.y2 : rect.endY;
            return {
                x: Math.round(Math.min(x1, x2)),
                y: Math.round(Math.min(y1, y2)),
                width: Math.round(Math.abs(x2 - x1)),
                height: Math.round(Math.abs(y2 - y1))
            };
        }
        return {
            x: Math.round(rect.x || 0),
            y: Math.round(rect.y || 0),
            width: Math.round(rect.width || 0),
            height: Math.round(rect.height || 0)
        };
    }

    /**
     * Converts a millimeter offset into canvas pixels, given the scale the page canvas was
     * rendered at (pdf.js `viewport = page.getViewport({ scale })`). Reproduces the original's
     * `(mm * 2.83465) / (pdfWidthPts / canvasWidthPx)` formula, simplified since
     * pdfWidthPts / canvasWidthPx === 1/scale for a canvas rendered directly from a PDF page.
     * @param {number} mm
     * @param {number} [scale=1.5]
     * @returns {number} pixels
     */
    function mmToPixels(mm, scale) {
        scale = scale || DEFAULT_RENDER_SCALE;
        return (mm || 0) * MM_TO_PT * scale;
    }

    /**
     * Applies the manual X/Y millimeter offset correction to a detected/fixed rect, in canvas
     * pixel space. Matches the original exactly: +X moves the rect right, +Y moves it UP
     * (subtracted from canvas y, since canvas y grows downward) to compensate for detection drift.
     * @param {{x:number,y:number,width:number,height:number}} rect
     * @param {number} offsetMmX
     * @param {number} offsetMmY
     * @param {number} [renderScale=1.5] the pdf.js viewport scale the page canvas was rendered at.
     * @returns {{x:number,y:number,width:number,height:number}} a new, offset rect (input is not mutated).
     */
    function offsetRect(rect, offsetMmX, offsetMmY, renderScale) {
        if (!rect) return rect;
        var dx = mmToPixels(offsetMmX, renderScale);
        var dy = mmToPixels(offsetMmY, renderScale);
        var out = {
            x: rect.x + dx,
            y: rect.y - dy, // subtract to move UP on canvas, same as original
            width: rect.width,
            height: rect.height
        };
        if (rect.score !== undefined) out.score = rect.score;
        return out;
    }

    // ---------------------------------------------------------------------
    // 1. Crop tool (geometry only — no mouse handling)
    // ---------------------------------------------------------------------

    /**
     * Cuts a rectangular region out of a rendered page canvas/image and returns it as a
     * standalone template, along with its position relative to the source (0..1), for later
     * use as either a pattern-matching template or a fixed-position rect. Mirrors the original
     * crop modal's "confirmBtn" handler (patchCanvas + relX/relY/relWidth/relHeight).
     * @param {HTMLCanvasElement|HTMLImageElement} canvas the full source page already rendered.
     * @param {Object} rectPixels pixel rect on the source, see normalizeRect() for accepted shapes.
     * @returns {{canvas:HTMLCanvasElement, image:HTMLCanvasElement, dataUrl:string, rel:{relX:number,relY:number,relWidth:number,relHeight:number}}}
     *   `image` is an alias of `canvas` so the whole return value can be passed straight into
     *   findLogoRegion()/processPdfPages() as `templateImage`.
     */
    function cropRegionFromCanvas(canvas, rectPixels) {
        var r = normalizeRect(rectPixels);
        if (r.width < 10 || r.height < 10) {
            throw new Error('אנא סמן אזור גדול יותר (מינימום 10x10 פיקסלים)');
        }
        var srcWidth = canvas.width || canvas.naturalWidth;
        var srcHeight = canvas.height || canvas.naturalHeight;

        var patchCanvas = document.createElement('canvas');
        patchCanvas.width = r.width;
        patchCanvas.height = r.height;
        var ctx = patchCanvas.getContext('2d');
        ctx.drawImage(canvas, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);

        var rel = {
            relX: r.x / srcWidth,
            relY: r.y / srcHeight,
            relWidth: r.width / srcWidth,
            relHeight: r.height / srcHeight
        };

        return {
            canvas: patchCanvas,
            image: patchCanvas,
            dataUrl: patchCanvas.toDataURL('image/png'),
            rel: rel
        };
    }

    // ---------------------------------------------------------------------
    // 2. Detection: pattern matching or fixed relative position
    // ---------------------------------------------------------------------

    /** Pulls out the actual pixel source (canvas/image) from a templateImage argument that may be a raw element or a {image,...} object. */
    function resolveTemplateElement(templateImage) {
        if (!templateImage) return null;
        return templateImage.image || templateImage.canvas || templateImage;
    }

    /**
     * Locates the logo region on a rendered page canvas, either by OpenCV template (pattern)
     * matching or by returning the same fixed relative rectangle on every page. Mirrors the
     * original's `blurMethod === 'pattern' | 'fixed'` branch inside applyLogoBlurToPdf.
     * @param {HTMLCanvasElement} pageCanvas a single rendered PDF page.
     * @param {Object} templateImage for 'pattern': an image/canvas or {image} object holding the
     *   cropped logo (as produced by cropRegionFromCanvas). For 'fixed': an object with a `.rel`
     *   member ({relX,relY,relWidth,relHeight}), also produced by cropRegionFromCanvas.
     * @param {'pattern'|'fixed'} mode
     * @returns {{x:number,y:number,width:number,height:number,score:(number|null)}|null}
     *   null if mode is 'pattern' and no match scored above PATTERN_MATCH_THRESHOLD (0.65),
     *   or if mode is 'fixed' and no relative rect was supplied.
     */
    function findLogoRegion(pageCanvas, templateImage, mode) {
        if (mode === 'fixed') {
            var rel = templateImage && templateImage.rel;
            if (!rel || rel.relX === undefined) return null;
            return {
                x: Math.round(rel.relX * pageCanvas.width),
                y: Math.round(rel.relY * pageCanvas.height),
                width: Math.round(rel.relWidth * pageCanvas.width),
                height: Math.round(rel.relHeight * pageCanvas.height),
                score: null
            };
        }

        if (mode === 'pattern') {
            ensureReady();
            var templateEl = resolveTemplateElement(templateImage);
            if (!templateEl) return null;

            var templ = cv.imread(templateEl);
            var src = cv.imread(pageCanvas);
            var gray = new cv.Mat();
            var result = new cv.Mat();
            var rectOut = null;
            try {
                cv.cvtColor(templ, templ, cv.COLOR_RGBA2GRAY);
                cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
                cv.matchTemplate(gray, templ, result, cv.TM_CCOEFF_NORMED);
                var minMax = cv.minMaxLoc(result);
                if (minMax.maxVal > PATTERN_MATCH_THRESHOLD) {
                    rectOut = {
                        x: minMax.maxPoint.x,
                        y: minMax.maxPoint.y,
                        width: templ.cols,
                        height: templ.rows,
                        score: minMax.maxVal
                    };
                }
            } finally {
                templ.delete(); src.delete(); gray.delete(); result.delete();
            }
            return rectOut;
        }

        throw new Error('שיטת זיהוי לא מוכרת: ' + mode);
    }

    // ---------------------------------------------------------------------
    // 3. Hide effects: blur / inpaint / white-fill
    // ---------------------------------------------------------------------

    /**
     * Applies one of the three hide effects directly onto pageCanvas (mutated in place) over the
     * given rect, and returns pageCanvas for convenience. Mirrors the original's
     * blurType === 'white' | 'blur' | 'inpaint' branch, adapted to draw back onto a <canvas>
     * instead of embedding a PNG patch into a pdf-lib page (that embedding step is the UI/PDF
     * layer's job once it gets the modified canvas back).
     * @param {HTMLCanvasElement} pageCanvas
     * @param {{x:number,y:number,width:number,height:number}} rect region to hide, in pageCanvas pixel space.
     * @param {'blur'|'inpaint'|'white'} effect
     * @param {Object} [options]
     * @param {number} [options.blurKernelSize=45] Gaussian blur kernel size (must be odd).
     * @param {number} [options.inpaintRadius=10] cv.inpaint() radius.
     * @param {number} [options.inpaintMargin=30] extra context margin (px) fed into inpaint.
     * @returns {HTMLCanvasElement} pageCanvas, mutated.
     */
    function applyHideEffect(pageCanvas, rect, effect, options) {
        if (!rect) return pageCanvas;
        options = options || {};

        if (effect === 'white') {
            var ctx2d = pageCanvas.getContext('2d');
            ctx2d.fillStyle = '#ffffff';
            ctx2d.fillRect(rect.x, rect.y, rect.width, rect.height);
            return pageCanvas;
        }

        if (effect === 'blur' || effect === 'inpaint') {
            ensureReady();
            var margin = effect === 'inpaint' ? (options.inpaintMargin || INPAINT_CONTEXT_MARGIN) : 0;
            var rx = Math.max(0, Math.round(rect.x - margin));
            var ry = Math.max(0, Math.round(rect.y - margin));
            var rw = Math.min(pageCanvas.width - rx, Math.round(rect.width + 2 * margin));
            var rh = Math.min(pageCanvas.height - ry, Math.round(rect.height + 2 * margin));

            var src = cv.imread(pageCanvas);
            var roi = src.roi(new cv.Rect(rx, ry, rw, rh));
            var patchDest = new cv.Mat();
            var maskMat = null, maskRoi = null, roiRgb = null, patchDestRgb = null;

            try {
                if (effect === 'blur') {
                    var k = options.blurKernelSize || BLUR_KERNEL_SIZE;
                    cv.GaussianBlur(roi, patchDest, new cv.Size(k, k), 0, 0, cv.BORDER_DEFAULT);
                } else {
                    // inpaint (TELEA): mask the exact logo rect within the wider context ROI, then inpaint.
                    maskMat = new cv.Mat.zeros(roi.rows, roi.cols, cv.CV_8UC1);
                    maskRoi = maskMat.roi(new cv.Rect(
                        Math.round(rect.x) - rx, Math.round(rect.y) - ry,
                        Math.round(rect.width), Math.round(rect.height)
                    ));
                    maskRoi.setTo(new cv.Scalar(255));

                    // cv.inpaint requires 1 or 3 channel input; roi is RGBA (4-channel).
                    roiRgb = new cv.Mat();
                    cv.cvtColor(roi, roiRgb, cv.COLOR_RGBA2RGB);
                    patchDestRgb = new cv.Mat();
                    cv.inpaint(roiRgb, maskMat, patchDestRgb, options.inpaintRadius || INPAINT_RADIUS, cv.INPAINT_TELEA);

                    cv.cvtColor(patchDestRgb, patchDest, cv.COLOR_RGB2RGBA);
                }

                var patchCanvas = document.createElement('canvas');
                patchCanvas.width = rw;
                patchCanvas.height = rh;
                cv.imshow(patchCanvas, patchDest);

                pageCanvas.getContext('2d').drawImage(patchCanvas, rx, ry);
            } finally {
                src.delete(); roi.delete(); patchDest.delete();
                if (maskMat) maskMat.delete();
                if (maskRoi) maskRoi.delete();
                if (roiRgb) roiRgb.delete();
                if (patchDestRgb) patchDestRgb.delete();
            }
            return pageCanvas;
        }

        throw new Error('אפקט הסתרה לא מוכר: ' + effect);
    }

    // ---------------------------------------------------------------------
    // 5. Top-level orchestrator
    // ---------------------------------------------------------------------

    /**
     * Runs detection + the chosen hide effect across every supplied page canvas, in place.
     * Equivalent to the per-page loop inside the original's applyLogoBlurToPdf(), minus the
     * pdf.js rasterization and pdf-lib re-embedding steps (the caller owns those).
     * @param {HTMLCanvasElement[]} pdfPageCanvases already-rendered page canvases, in page order.
     * @param {Object} templateImage as produced by cropRegionFromCanvas(): {image, rel}.
     * @param {Object} [options]
     * @param {'pattern'|'fixed'} [options.mode='pattern']
     * @param {'blur'|'inpaint'|'white'} [options.effect='blur']
     * @param {number} [options.offsetMmX=0] manual horizontal drift correction, in mm.
     * @param {number} [options.offsetMmY=0] manual vertical drift correction, in mm (positive = up).
     * @param {number} [options.renderScale=1.5] pdf.js viewport scale the canvases were rendered at (needed to convert mm offsets to px).
     * @param {function} [options.onPageResult] optional callback(pageResult) invoked after each page, for progress/logging in the UI layer.
     * @returns {Promise<Array<{canvas:HTMLCanvasElement, rect:(Object|null), pageIndex:number}>>}
     */
    async function processPdfPages(pdfPageCanvases, templateImage, options) {
        options = options || {};
        var mode = options.mode || 'pattern';
        var effect = options.effect || 'blur';
        var offsetMmX = options.offsetMmX || 0;
        var offsetMmY = options.offsetMmY || 0;
        var renderScale = options.renderScale || DEFAULT_RENDER_SCALE;
        var onPageResult = typeof options.onPageResult === 'function' ? options.onPageResult : null;

        var results = [];
        for (var i = 0; i < pdfPageCanvases.length; i++) {
            var canvas = pdfPageCanvases[i];
            var rect = findLogoRegion(canvas, templateImage, mode);
            if (rect) {
                rect = offsetRect(rect, offsetMmX, offsetMmY, renderScale);
                applyHideEffect(canvas, rect, effect);
            }
            var pageResult = { canvas: canvas, rect: rect, pageIndex: i };
            results.push(pageResult);
            if (onPageResult) onPageResult(pageResult);
        }
        return results;
    }

    // ---------------------------------------------------------------------
    // Optional: template persistence (same localStorage keys as the original)
    // ---------------------------------------------------------------------

    /**
     * Persists a cropped template (as returned by cropRegionFromCanvas) to localStorage, under
     * the same keys the original app used ('userCropLogoBase64' / 'userCropLogoData').
     * @param {{dataUrl:string, rel:Object}} cropResult
     */
    function saveTemplate(cropResult) {
        if (typeof localStorage === 'undefined') return;
        if (!cropResult || !cropResult.dataUrl) throw new Error('cropResult לא תקין');
        localStorage.setItem(STORAGE_KEYS.TEMPLATE_IMAGE, cropResult.dataUrl);
        localStorage.setItem(STORAGE_KEYS.TEMPLATE_REL, JSON.stringify(cropResult.rel || {}));
    }

    /** Removes any previously saved template from localStorage. */
    function clearSavedTemplate() {
        if (typeof localStorage === 'undefined') return;
        localStorage.removeItem(STORAGE_KEYS.TEMPLATE_IMAGE);
        localStorage.removeItem(STORAGE_KEYS.TEMPLATE_REL);
    }

    /** @returns {boolean} true if a template was previously saved via saveTemplate(). */
    function hasSavedTemplate() {
        return typeof localStorage !== 'undefined' && !!localStorage.getItem(STORAGE_KEYS.TEMPLATE_IMAGE);
    }

    /**
     * Loads the previously saved template (dataURL + relative rect) back into a real, decoded
     * <img> element ready for use as `templateImage` in findLogoRegion()/processPdfPages().
     * @returns {Promise<{image:HTMLImageElement, rel:Object}|null>} null if nothing was saved.
     */
    function loadTemplateImage() {
        if (typeof localStorage === 'undefined') return Promise.resolve(null);
        var dataUrl = localStorage.getItem(STORAGE_KEYS.TEMPLATE_IMAGE);
        if (!dataUrl) return Promise.resolve(null);
        var relRaw = localStorage.getItem(STORAGE_KEYS.TEMPLATE_REL);
        var rel = null;
        try { rel = relRaw ? JSON.parse(relRaw) : null; } catch (e) { rel = null; }

        return new Promise(function (resolve, reject) {
            var img = new Image();
            img.onload = function () { resolve({ image: img, rel: rel }); };
            img.onerror = function () { reject(new Error('טעינת תמונת הלוגו השמורה נכשלה')); };
            img.src = dataUrl;
        });
    }

    // ---------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------

    window.LogoBlur = {
        // constants / info
        PATTERN_MATCH_THRESHOLD: PATTERN_MATCH_THRESHOLD,
        DEFAULT_RENDER_SCALE: DEFAULT_RENDER_SCALE,
        MODES: ['pattern', 'fixed'],
        EFFECTS: ['blur', 'inpaint', 'white'],

        // OpenCV readiness
        isReady: isReady,
        whenReady: whenReady,

        // geometry
        cropRegionFromCanvas: cropRegionFromCanvas,
        findLogoRegion: findLogoRegion,
        offsetRect: offsetRect,
        mmToPixels: mmToPixels,

        // effects
        applyHideEffect: applyHideEffect,

        // orchestrator
        processPdfPages: processPdfPages,

        // optional template persistence
        saveTemplate: saveTemplate,
        clearSavedTemplate: clearSavedTemplate,
        hasSavedTemplate: hasSavedTemplate,
        loadTemplateImage: loadTemplateImage
    };

})(window);
