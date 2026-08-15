/**
 * pdf-engine.js
 * ------------------------------------------------------------------------
 * Plain browser script (no bundler / no ES modules) that reproduces the
 * PDF-processing / imposition logic from the original single-file app
 * ("תכנת שליחה - עובד.HTML"). This file owns ONLY that logic — merging,
 * page-level remixing, A4 fitting, booklet rotation, blank-page insertion,
 * N-up imposition (incl. the 2-up "duplicate" layout), margin-cut
 * whiteout, page-range filtering, בס"ד/logo branding, and image->PDF
 * conversion. It does NOT own any UI, DOM rendering of the app itself,
 * email/upload/history logic, or reading of app-global state (localStorage,
 * file-list arrays, etc.) — all of that belongs to the UI layer, which is
 * expected to call the functions below with plain bytes/options and get
 * plain bytes back.
 *
 * Every exported function is pure: same input -> same output, no reads
 * from outside its own arguments (the only "impurity" is the use of
 * <canvas> and pdf.js/pdf-lib/jsPDF as rendering engines, which is how a
 * browser necessarily rasterizes PDF pages — this mirrors exactly what the
 * original file did).
 *
 * Requires (loaded as globals before this script, same as the original
 * app and already vendored in ../libs/):
 *   - PDFLib   (libs/pdf-lib.min.js)
 *   - pdfjsLib (libs/pdf.min.js + libs/pdf.worker.min.js)
 *   - window.jspdf.jsPDF (libs/jspdf.umd.min.js)
 * ------------------------------------------------------------------------
 */
(function (window) {
    'use strict';

    // ---------------------------------------------------------------------
    // Constants (mirror the magic numbers from the original file exactly)
    // ---------------------------------------------------------------------

    /** A4 portrait size in PDF points (72 dpi), as used throughout the original app. */
    var A4_PORTRAIT_W = 595.28;
    var A4_PORTRAIT_H = 841.89;

    /** 1 cm in PDF points, as used by the original margin-cut function. */
    var CM = 28.346;

    // ---------------------------------------------------------------------
    // Worker bootstrap — point pdf.js at the vendored worker file relative
    // to THIS script's own location (js/pdf-engine.js -> ../libs/...), so
    // this module works regardless of where the host page lives.
    // ---------------------------------------------------------------------
    (function configurePdfJsWorker() {
        try {
            var thisScript = document.currentScript;
            if (!thisScript) {
                var scripts = document.getElementsByTagName('script');
                thisScript = scripts[scripts.length - 1];
            }
            var workerUrl = 'libs/pdf.worker.min.js';
            if (thisScript && thisScript.src) {
                workerUrl = new URL('../libs/pdf.worker.min.js', thisScript.src).href;
            }
            if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
            }
        } catch (e) {
            // Best-effort only. If pdfjsLib isn't loaded yet, or the host page
            // already configured the worker itself, this is a no-op.
        }
    })();

    // ---------------------------------------------------------------------
    // Generic byte / image helpers
    // ---------------------------------------------------------------------

    function toU8(bytes) {
        if (bytes instanceof Uint8Array) return bytes;
        return new Uint8Array(bytes);
    }

    /** Strips any garbage bytes before the "%PDF-" marker (defensive fix for malformed uploads). */
    function cleanPdfHeader(bytes) {
        var u8 = toU8(bytes);
        var marker = [0x25, 0x50, 0x44, 0x46, 0x2D]; // %PDF-
        var scanLimit = Math.min(u8.length - 5, 2048);
        for (var i = 0; i < scanLimit; i++) {
            if (u8[i] === marker[0] && u8[i + 1] === marker[1] && u8[i + 2] === marker[2] &&
                u8[i + 3] === marker[3] && u8[i + 4] === marker[4]) {
                return i > 0 ? u8.slice(i) : u8;
            }
        }
        return u8;
    }

    /** Decodes a base64 string into raw bytes. */
    function base64ToBytes(base64) {
        var binary = window.atob(base64);
        var len = binary.length;
        var bytes = new Uint8Array(len);
        for (var i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    /** Encodes raw bytes into a base64 string. */
    function bytesToBase64(bytes) {
        var u8 = toU8(bytes);
        var binary = '';
        for (var i = 0; i < u8.byteLength; i++) binary += String.fromCharCode(u8[i]);
        return window.btoa(binary);
    }

    function sniffImageKind(bytes) {
        var u8 = toU8(bytes);
        if (u8.length >= 4 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) return 'png';
        if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xD8) return 'jpg';
        return null;
    }

    /** Embeds an image (PNG or JPG, auto-detected) into a pdf-lib document. */
    async function embedImageAuto(pdfDoc, imageBytes) {
        var u8 = toU8(imageBytes);
        var kind = sniffImageKind(u8);
        if (kind === 'png') return pdfDoc.embedPng(u8);
        if (kind === 'jpg') return pdfDoc.embedJpg(u8);
        // Unknown signature: try both, mirroring convertImageToPdfClientSide's approach.
        try {
            return await pdfDoc.embedJpg(u8);
        } catch (e) {
            return await pdfDoc.embedPng(u8);
        }
    }

    async function loadPdfDoc(bytes) {
        return window.PDFLib.PDFDocument.load(cleanPdfHeader(bytes));
    }

    // ---------------------------------------------------------------------
    // 1 & 2. Merging in list order / with a custom page order, and the
    // lower-level "flat page list" primitives that back both the merge
    // and the page-remix (pick/reorder/insert-blank) UI flow.
    // ---------------------------------------------------------------------

    /**
     * Blank-page marker for use in a page-order list (mirrors the original's
     * `{ type: 'blank' }` entries in `finalOrder` / `customPageOrders`).
     */
    function blankPageMarker() {
        return { type: 'blank' };
    }

    /** Builds one merged pdf-lib document from a list of already-loaded source docs and an ordered page list. */
    async function buildMergedDocFromOrder(srcDocs, order) {
        var mergedPdf = await window.PDFLib.PDFDocument.create();
        var lastDim = { width: A4_PORTRAIT_W, height: A4_PORTRAIT_H };
        for (var idx = 0; idx < order.length; idx++) {
            var entry = order[idx];
            if (!entry) continue;
            if (entry.type === 'blank') {
                mergedPdf.addPage([lastDim.width, lastDim.height]);
                continue;
            }
            var srcDoc = srcDocs[entry.fileIndex];
            if (!srcDoc) continue;
            if (entry.pageIndex < 0 || entry.pageIndex >= srcDoc.getPageCount()) continue;
            var copiedPages = await mergedPdf.copyPages(srcDoc, [entry.pageIndex]);
            var copiedPage = copiedPages[0];
            lastDim = copiedPage.getSize();
            mergedPdf.addPage(copiedPage);
        }
        return mergedPdf;
    }

    /**
     * Merges multiple source PDFs into one, in list order — or, if a custom
     * page order is given (as produced by the page-sorter UI / buildFromPageList
     * flow), builds the merged PDF from that order instead.
     * @param {Array<Uint8Array|ArrayBuffer>} fileBytesList - source PDFs, in list order.
     * @param {Array<{type:'page',fileIndex:number,pageIndex:number}|{type:'blank'}>} [customOrder] - optional explicit page order.
     * @returns {Promise<Uint8Array>}
     */
    async function mergeWithOrder(fileBytesList, customOrder) {
        var list = fileBytesList || [];
        var srcDocs = await Promise.all(list.map(function (b) { return loadPdfDoc(b); }));

        var mergedPdf;
        if (Array.isArray(customOrder) && customOrder.length > 0) {
            mergedPdf = await buildMergedDocFromOrder(srcDocs, customOrder);
        } else {
            mergedPdf = await window.PDFLib.PDFDocument.create();
            for (var i = 0; i < srcDocs.length; i++) {
                var srcDoc = srcDocs[i];
                var copiedPages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
                for (var j = 0; j < copiedPages.length; j++) mergedPdf.addPage(copiedPages[j]);
            }
        }
        return mergedPdf.save();
    }

    /**
     * Lists every page of every source PDF as a flat, addressable reference
     * list ({fileIndex, pageIndex, width, height}), for a UI to let a human
     * pick / reorder / insert blank pages before calling buildFromPageList.
     * @param {Array<Uint8Array|ArrayBuffer>} fileBytesList
     * @returns {Promise<Array<{type:'page', fileIndex:number, pageIndex:number, width:number, height:number, rotation:number}>>}
     */
    async function listPages(fileBytesList) {
        var list = fileBytesList || [];
        var out = [];
        for (var fileIndex = 0; fileIndex < list.length; fileIndex++) {
            var doc = await loadPdfDoc(list[fileIndex]);
            var pages = doc.getPages();
            for (var pageIndex = 0; pageIndex < pages.length; pageIndex++) {
                var size = pages[pageIndex].getSize();
                out.push({
                    type: 'page',
                    fileIndex: fileIndex,
                    pageIndex: pageIndex,
                    width: size.width,
                    height: size.height,
                    rotation: pages[pageIndex].getRotation().angle
                });
            }
        }
        return out;
    }

    /**
     * Builds the final merged PDF from an ordered page-reference list (as
     * produced/edited from listPages()'s output, with blankPageMarker()
     * entries inserted where the human chose to add a blank page).
     *
     * Note: unlike the original app (which kept the already-open source
     * PDFDocuments in memory as UI/session state), this is a pure function
     * so it also needs the source bytes — pass the SAME fileBytesList used
     * for listPages(), keyed by the same fileIndex.
     * @param {Array<Uint8Array|ArrayBuffer>} fileBytesList - source PDFs, indexed by fileIndex.
     * @param {Array<{type:'page',fileIndex:number,pageIndex:number}|{type:'blank'}>} pageRefs - final page order.
     * @returns {Promise<Uint8Array>}
     */
    async function buildFromPageList(fileBytesList, pageRefs) {
        var list = fileBytesList || [];
        var srcDocs = await Promise.all(list.map(function (b) { return loadPdfDoc(b); }));
        var mergedPdf = await buildMergedDocFromOrder(srcDocs, pageRefs || []);
        return mergedPdf.save();
    }

    // ---------------------------------------------------------------------
    // 3. Forced A4 fit (vector path), with rasterize-to-A4 as the fallback.
    // ---------------------------------------------------------------------

    /** Rasterizes each page to a JPEG and re-embeds it centered on a full A4 page (fallback path when vector resizing fails). */
    async function rasterizeAndResizePdfToA4(pdfBytes, quality) {
        quality = typeof quality === 'number' ? quality : 0.8;
        var loadingTask = window.pdfjsLib.getDocument({ data: toU8(pdfBytes) });
        var pdf = await loadingTask.promise;
        var newDoc = await window.PDFLib.PDFDocument.create();

        for (var i = 1; i <= pdf.numPages; i++) {
            var page = await pdf.getPage(i);
            var viewport = page.getViewport({ scale: 2.5 });
            var canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;

            var imgData = canvas.toDataURL('image/jpeg', quality);
            var imgBytes = await fetch(imgData).then(function (res) { return res.arrayBuffer(); });
            var embeddedImage = await newDoc.embedJpg(imgBytes);

            var isLandscape = viewport.width > viewport.height;
            var targetW = isLandscape ? A4_PORTRAIT_H : A4_PORTRAIT_W;
            var targetH = isLandscape ? A4_PORTRAIT_W : A4_PORTRAIT_H;

            var scale = Math.min(targetW / embeddedImage.width, targetH / embeddedImage.height);
            var scaledWidth = embeddedImage.width * scale;
            var scaledHeight = embeddedImage.height * scale;
            var x = (targetW - scaledWidth) / 2;
            var y = (targetH - scaledHeight) / 2;

            var newPage = newDoc.addPage([targetW, targetH]);
            newPage.drawImage(embeddedImage, { x: x, y: y, width: scaledWidth, height: scaledHeight });
        }
        return newDoc.save();
    }

    /** Force-fits every page onto A4 (portrait or landscape, whichever matches its orientation) with no margins, via the vector embed path; falls back to rasterizing if that fails. */
    async function resizePdfToA4(pdfBytes) {
        if (!pdfBytes || pdfBytes.length === 0) return toU8(pdfBytes);
        try {
            var srcDoc = await loadPdfDoc(pdfBytes);
            var newDoc = await window.PDFLib.PDFDocument.create();
            var embeddedPages = await newDoc.embedPages(srcDoc, srcDoc.getPageIndices());

            for (var i = 0; i < embeddedPages.length; i++) {
                var embeddedPage = embeddedPages[i];
                var width = embeddedPage.width;
                var height = embeddedPage.height;
                var isLandscape = width > height;
                var targetW = isLandscape ? A4_PORTRAIT_H : A4_PORTRAIT_W;
                var targetH = isLandscape ? A4_PORTRAIT_W : A4_PORTRAIT_H;

                var scale = Math.min(targetW / width, targetH / height);
                var scaledWidth = width * scale;
                var scaledHeight = height * scale;

                var page = newDoc.addPage([targetW, targetH]);
                page.drawPage(embeddedPage, {
                    x: (targetW - scaledWidth) / 2,
                    y: (targetH - scaledHeight) / 2,
                    width: scaledWidth,
                    height: scaledHeight
                });
            }
            return newDoc.save();
        } catch (e) {
            return rasterizeAndResizePdfToA4(pdfBytes);
        }
    }

    // ---------------------------------------------------------------------
    // 4. Booklet rotation.
    // ---------------------------------------------------------------------

    /** Rotates every landscape page 180°, EXCEPT the last page when the total page count is an exact multiple of 4 (booklet imposition convention). */
    async function applyBookletRotation(pdfBytes) {
        var degrees = window.PDFLib.degrees;
        var pdfDoc = await loadPdfDoc(pdfBytes);
        var pageCount = pdfDoc.getPageCount();
        var pages = pdfDoc.getPages();

        for (var i = 0; i < pageCount; i++) {
            var page = pages[i];
            var size = page.getSize();
            var rotation = page.getRotation().angle;
            var isEffectivelyLandscape = (rotation === 0 || rotation === 180)
                ? (size.width > size.height)
                : (size.height > size.width);

            if (isEffectivelyLandscape) {
                var isLastPage = (i === pageCount - 1);
                var isMultipleOfFour = (pageCount % 4 === 0);
                if (isLastPage && isMultipleOfFour) continue;

                var newRotation = (rotation + 180) % 360;
                page.setRotation(degrees(newRotation));
            }
        }
        return pdfDoc.save();
    }

    /** Reports whether every page in the PDF is (effectively, accounting for rotation) landscape. */
    async function areAllPagesLandscape(pdfBytes) {
        try {
            var pdfDoc = await loadPdfDoc(pdfBytes);
            var pages = pdfDoc.getPages();
            if (pages.length === 0) return false;
            for (var i = 0; i < pages.length; i++) {
                var size = pages[i].getSize();
                var rotation = pages[i].getRotation().angle;
                var isEffectivelyLandscape = (rotation === 90 || rotation === 270)
                    ? (size.height > size.width)
                    : (size.width > size.height);
                if (!isEffectivelyLandscape) return false;
            }
            return true;
        } catch (e) {
            try {
                var loadingTask = window.pdfjsLib.getDocument({ data: toU8(pdfBytes) });
                var pdf = await loadingTask.promise;
                if (pdf.numPages === 0) return false;
                for (var p = 1; p <= pdf.numPages; p++) {
                    var page = await pdf.getPage(p);
                    var viewport = page.getViewport({ scale: 1.0 });
                    if (viewport.width < viewport.height) return false;
                }
                return true;
            } catch (e2) {
                return false;
            }
        }
    }

    // ---------------------------------------------------------------------
    // 5. Even blank pages — insert a blank page after every content page.
    // ---------------------------------------------------------------------

    /** Inserts a blank page (same size as the preceding page) after every content page. */
    async function addEvenBlankPagesToPdf(pdfBytes) {
        var doc = await loadPdfDoc(pdfBytes);
        var pages = doc.getPages();
        var newDoc = await window.PDFLib.PDFDocument.create();
        for (var i = 0; i < pages.length; i++) {
            var copied = await newDoc.copyPages(doc, [i]);
            newDoc.addPage(copied[0]);
            var size = copied[0].getSize();
            newDoc.addPage([size.width, size.height]);
        }
        return newDoc.save();
    }

    // ---------------------------------------------------------------------
    // Shared canvas-rasterization helper used by both N-up and duplicate-2-up.
    // ---------------------------------------------------------------------

    /** Renders a pdf.js page to a canvas at the given scale, rotating 90° if needed so its orientation matches the target cell's orientation. */
    async function renderPageToOrientedCanvas(pdfjsPage, scale, cellW, cellH) {
        var viewport = pdfjsPage.getViewport({ scale: scale });
        var renderCanvas = document.createElement('canvas');
        renderCanvas.width = viewport.width;
        renderCanvas.height = viewport.height;
        await pdfjsPage.render({ canvasContext: renderCanvas.getContext('2d'), viewport: viewport }).promise;

        var pageIsLandscape = viewport.width > viewport.height;
        var cellIsLandscape = cellW > cellH;
        var needRotation = pageIsLandscape !== cellIsLandscape;

        if (!needRotation) return renderCanvas;

        var finalCanvas = document.createElement('canvas');
        finalCanvas.width = viewport.height;
        finalCanvas.height = viewport.width;
        var ctx = finalCanvas.getContext('2d');
        ctx.translate(finalCanvas.width / 2, finalCanvas.height / 2);
        ctx.rotate(-90 * Math.PI / 180);
        ctx.drawImage(renderCanvas, -viewport.width / 2, -viewport.height / 2);
        return finalCanvas;
    }

    function fitWithin(imgW, imgH, cellW, cellH) {
        var imgRatio = imgW / imgH;
        var cellRatio = cellW / cellH;
        var finalW, finalH;
        if (imgRatio > cellRatio) {
            finalW = cellW * 0.95;
            finalH = finalW / imgRatio;
        } else {
            finalH = cellH * 0.95;
            finalW = finalH * imgRatio;
        }
        return { width: finalW, height: finalH };
    }

    // ---------------------------------------------------------------------
    // 6. Duplicate 2-up — each source page rendered twice side-by-side on a
    // landscape sheet: one normal, one rotated 180° (for hand-cut duplex).
    // ---------------------------------------------------------------------

    /** Lays each source page down twice on a landscape A4 sheet — once normal, once rotated 180° — for hand-cut duplex printing. */
    async function createDuplicateTwoUp(pdfBytes) {
        try {
            var loadingTask = window.pdfjsLib.getDocument({ data: toU8(pdfBytes) });
            var pdf = await loadingTask.promise;
            var jsPDF = window.jspdf.jsPDF;
            var doc = new jsPDF({ orientation: 'l', unit: 'pt', format: 'a4' });

            var PAGE_W = 841.89, PAGE_H = 595.28;
            var cellW = PAGE_W / 2, cellH = PAGE_H;

            for (var i = 1; i <= pdf.numPages; i++) {
                if (i > 1) doc.addPage('a4', 'l');
                var page = await pdf.getPage(i);
                var finalCanvas = await renderPageToOrientedCanvas(page, 2.0, cellW, cellH);

                var imgData = finalCanvas.toDataURL('image/jpeg', 0.85);
                var fit = fitWithin(finalCanvas.width, finalCanvas.height, cellW, cellH);

                var x1 = (cellW - fit.width) / 2;
                var y1 = (cellH - fit.height) / 2;
                var x2 = cellW + (cellW - fit.width) / 2;
                var y2 = (cellH - fit.height) / 2;

                var canvas180 = document.createElement('canvas');
                canvas180.width = finalCanvas.width;
                canvas180.height = finalCanvas.height;
                var ctx180 = canvas180.getContext('2d');
                ctx180.translate(canvas180.width / 2, canvas180.height / 2);
                ctx180.rotate(180 * Math.PI / 180);
                ctx180.drawImage(finalCanvas, -finalCanvas.width / 2, -finalCanvas.height / 2);
                var imgData180 = canvas180.toDataURL('image/jpeg', 0.85);

                doc.addImage(imgData, 'JPEG', x1, y1, fit.width, fit.height);
                doc.addImage(imgData180, 'JPEG', x2, y2, fit.width, fit.height);
            }
            return new Uint8Array(doc.output('arraybuffer'));
        } catch (e) {
            // Mirrors the original: on any rendering failure, silently fall back
            // to returning the untouched input rather than throwing.
            return toU8(pdfBytes);
        }
    }

    // ---------------------------------------------------------------------
    // 7. N-up imposition: 4/6/8/9/16-up, optional "duplicated" variant, grid
    // page numbers, and directional cut/print arrows. RTL-aware: columns
    // fill right-to-left (rtlCol = cols - 1 - col).
    // ---------------------------------------------------------------------

    var NUP_GRIDS = { 4: { cols: 2, rows: 2 }, 6: { cols: 3, rows: 2 }, 8: { cols: 4, rows: 2 }, 9: { cols: 3, rows: 3 }, 16: { cols: 4, rows: 4 } };

    /**
     * Imposes N source pages per landscape A4 sheet (N in {4,6,8,9,16}),
     * filling cells right-to-left within each row (RTL layout), with
     * optional per-source-page grid numbers and hand-cut directional arrows.
     * @param {Uint8Array|ArrayBuffer} pdfBytes
     * @param {4|6|8|9|16} n
     * @param {{addGridNumbers?: boolean, addArrows?: boolean, duplicatePages?: boolean}} [options]
     * @returns {Promise<Uint8Array>}
     */
    async function createNUpPdf(pdfBytes, n, options) {
        options = options || {};
        var addGridNumbers = !!options.addGridNumbers;
        var addArrows = !!options.addArrows;
        var duplicatePages = !!options.duplicatePages;

        try {
            var grid = NUP_GRIDS[n];
            if (!grid) return toU8(pdfBytes);
            var cols = grid.cols, rows = grid.rows;

            var loadingTask = window.pdfjsLib.getDocument({ data: toU8(pdfBytes) });
            var pdf = await loadingTask.promise;
            var jsPDF = window.jspdf.jsPDF;
            var doc = new jsPDF({ orientation: 'l', unit: 'pt', format: 'a4' });

            var PAGE_W = 841.89, PAGE_H = 595.28;
            var cellW = PAGE_W / cols, cellH = PAGE_H / rows;

            var cellIndex = 0;
            for (var i = 1; i <= pdf.numPages; i++) {
                var page = await pdf.getPage(i);
                var finalCanvas = await renderPageToOrientedCanvas(page, 2.0, cellW, cellH);
                var imgData = finalCanvas.toDataURL('image/jpeg', 0.75);
                var fit = fitWithin(finalCanvas.width, finalCanvas.height, cellW, cellH);

                var copies = duplicatePages ? n : 1;
                for (var c = 0; c < copies; c++) {
                    if (cellIndex > 0 && cellIndex % n === 0) doc.addPage('a4', 'l');

                    var positionInPage = cellIndex % n;
                    var col = positionInPage % cols;
                    var row = Math.floor(positionInPage / cols);
                    var rtlCol = cols - 1 - col; // RTL: fill columns right-to-left

                    var cellX = rtlCol * cellW;
                    var cellY = row * cellH;

                    doc.addImage(imgData, 'JPEG', cellX + (cellW - fit.width) / 2, cellY + (cellH - fit.height) / 2, fit.width, fit.height);

                    if (addGridNumbers) {
                        var numText = String(i);
                        doc.setFontSize(22); doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold');
                        var textWidth = doc.getTextWidth(numText);
                        var textX = cellX + (cellW / 2) - (textWidth / 2);
                        var textY = cellY + cellH - 15;
                        doc.setFillColor(255, 255, 255); doc.setDrawColor(0, 0, 0);
                        doc.circle(textX + textWidth / 2, textY - 8, 14, 'FD');
                        doc.text(numText, textX, textY);
                    }

                    if (addArrows) {
                        doc.setDrawColor(0, 0, 0); doc.setLineWidth(3.0);
                        var isNotLast = (positionInPage < n - 1) && (cellIndex < (pdf.numPages * copies) - 1);
                        var isEndOfRow = (col === cols - 1);
                        var isLastRow = (row === rows - 1);

                        if (isNotLast) {
                            if (!isEndOfRow) {
                                var arrowY = cellY + 20;
                                var startX = cellX + cellW - 10;
                                var endX = cellX + 10;

                                doc.setDrawColor(255, 255, 255); doc.setLineWidth(5.0);
                                doc.line(startX, arrowY, endX, arrowY);
                                doc.setDrawColor(0, 0, 0); doc.setLineWidth(3.0);
                                doc.line(startX, arrowY, endX, arrowY);
                                doc.setFillColor(0, 0, 0);
                                doc.triangle(endX, arrowY, endX + 12, arrowY - 6, endX + 12, arrowY + 6, 'F');
                            } else if (!isLastRow) {
                                var rowStartX = cellX + 40, rowStartY = cellY + cellH - 20;
                                var rowEndX = (PAGE_W - 40), rowEndY = cellY + cellH + 40;

                                doc.setDrawColor(255, 255, 255); doc.setLineWidth(5.0);
                                doc.line(rowStartX, rowStartY, rowEndX, rowEndY);
                                doc.setDrawColor(0, 0, 0); doc.setLineWidth(3.0);
                                doc.line(rowStartX, rowStartY, rowEndX, rowEndY);
                                doc.setFillColor(0, 0, 0);
                                doc.triangle(rowEndX, rowEndY, rowEndX - 10, rowEndY - 8, rowEndX - 4, rowEndY - 14, 'F');
                            }
                        }
                    }
                    cellIndex++;
                }
            }
            return new Uint8Array(doc.output('arraybuffer'));
        } catch (e) {
            // Mirrors the original: silently fall back to the untouched input.
            return toU8(pdfBytes);
        }
    }

    // ---------------------------------------------------------------------
    // 8. Margin cut — whiteout a 7cm x 1.5cm strip at the bottom-right of
    // each page, auto-detecting the lowest non-white content in that strip.
    // ---------------------------------------------------------------------

    /** Whites out a 7cm×1.5cm strip at the bottom-right of every page, placed just above the lowest non-white pixel found in that strip (so it never covers real content). */
    async function addMarginCutToPdf(pdfBytes) {
        try {
            var rectWidth = 7 * CM;
            var rectHeight = 1.5 * CM;

            var doc = await loadPdfDoc(pdfBytes);
            var pages = doc.getPages();
            var pdfjsDoc = await window.pdfjsLib.getDocument({ data: toU8(pdfBytes) }).promise;

            for (var i = 0; i < pdfjsDoc.numPages; i++) {
                var pdfLibPage = pages[i];
                var size = pdfLibPage.getSize();
                var width = size.width, height = size.height;
                if (width < rectWidth) continue;

                var pdfjsPage = await pdfjsDoc.getPage(i + 1);
                var scale = 3.0;
                var viewport = pdfjsPage.getViewport({ scale: scale });
                var canvas = document.createElement('canvas');
                var ctx = canvas.getContext('2d', { willReadFrequently: true });
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                await pdfjsPage.render({ canvasContext: ctx, viewport: viewport }).promise;

                var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                var data = imageData.data;
                var stripXStart = Math.floor(canvas.width - (rectWidth * scale));

                var lowestContentYCanvas = -1;
                scanLoop:
                for (var y = canvas.height - 1; y >= 0; y--) {
                    for (var x = stripXStart; x < canvas.width; x++) {
                        var index = (y * canvas.width + x) * 4;
                        var r = data[index], g = data[index + 1], b = data[index + 2], alpha = data[index + 3];
                        var luminance = 0.299 * r + 0.587 * g + 0.114 * b;
                        if (alpha > 50 && luminance < 253) {
                            lowestContentYCanvas = y;
                            break scanLoop;
                        }
                    }
                }

                var rectYPoints;
                if (lowestContentYCanvas !== -1) {
                    var lowestContentTopYPdfLib = (canvas.height - lowestContentYCanvas) / scale;
                    rectYPoints = lowestContentTopYPdfLib - rectHeight;
                } else {
                    rectYPoints = 0;
                }
                if (rectYPoints < 0) rectYPoints = 0;

                pdfLibPage.drawRectangle({
                    x: width - rectWidth,
                    y: rectYPoints,
                    width: rectWidth,
                    height: rectHeight,
                    color: window.PDFLib.rgb(1, 1, 1)
                });
            }
            return doc.save();
        } catch (e) {
            // Mirrors the original: silently fall back to the untouched input.
            return toU8(pdfBytes);
        }
    }

    // ---------------------------------------------------------------------
    // 9. Page selection by ranges, e.g. "1, 3, 5-8".
    // ---------------------------------------------------------------------

    /** Keeps only the pages matched by a comma-separated range spec (e.g. "1, 3, 5-8", 1-indexed); returns the input unchanged if the spec is empty, matches nothing, or matches every page. */
    async function filterPdfPages(pdfBytes, pageSelection) {
        if (!pageSelection || pageSelection.trim() === '') return toU8(pdfBytes);
        try {
            var pdfDoc = await loadPdfDoc(pdfBytes);
            var totalPages = pdfDoc.getPageCount();
            var pagesToKeep = new Set();

            var parts = pageSelection.split(',');
            for (var p = 0; p < parts.length; p++) {
                var part = parts[p].trim();
                if (part.includes('-')) {
                    var range = part.split('-');
                    var start = parseInt(range[0]);
                    var end = parseInt(range[1]);
                    if (!isNaN(start) && !isNaN(end)) {
                        start = Math.max(1, Math.min(start, end));
                        end = Math.min(totalPages, Math.max(start, end));
                        for (var k = start; k <= end; k++) pagesToKeep.add(k - 1);
                    }
                } else {
                    var pageNum = parseInt(part);
                    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
                        pagesToKeep.add(pageNum - 1);
                    }
                }
            }

            if (pagesToKeep.size === 0 || pagesToKeep.size === totalPages) return toU8(pdfBytes);

            var newPdfDoc = await window.PDFLib.PDFDocument.create();
            var sortedPages = Array.from(pagesToKeep).sort(function (a, b) { return a - b; });
            var copiedPages = await newPdfDoc.copyPages(pdfDoc, sortedPages);
            copiedPages.forEach(function (page) { newPdfDoc.addPage(page); });

            return newPdfDoc.save();
        } catch (e) {
            return toU8(pdfBytes);
        }
    }

    // ---------------------------------------------------------------------
    // 10. Branding — בס"ד watermark top-right and/or a logo top-left.
    // ---------------------------------------------------------------------

    /**
     * Renders the exact same בס"ד watermark image the original app generated
     * on the fly (canvas text stamp, not a stored asset) — a convenience so
     * callers can pass its bytes into addBrandingToPdf() unchanged.
     * @returns {Promise<Uint8Array>} PNG bytes.
     */
    async function generateBsdWatermarkPng() {
        var canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 50;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 100, 50);
        ctx.font = 'bold 24px sans-serif';
        ctx.fillStyle = '#333';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText('בס"ד', 95, 5);
        var dataUrl = canvas.toDataURL('image/png');
        var buf = await fetch(dataUrl).then(function (r) { return r.arrayBuffer(); });
        return new Uint8Array(buf);
    }

    /**
     * Stamps a בס"ד watermark (top-right) and/or a logo image (top-left) onto
     * every page of the PDF, skipping any page indices listed in skipPageIndices.
     * @param {Uint8Array|ArrayBuffer} pdfBytes
     * @param {{bsdImageBytes?: Uint8Array, logoImageBytes?: Uint8Array, skipPageIndices?: number[]}} [options]
     * @returns {Promise<Uint8Array>}
     */
    async function addBrandingToPdf(pdfBytes, options) {
        options = options || {};
        var bsdImageBytes = options.bsdImageBytes || null;
        var logoImageBytes = options.logoImageBytes || null;
        var skipPageIndices = options.skipPageIndices || [];

        if (!bsdImageBytes && !logoImageBytes) return toU8(pdfBytes);

        try {
            var doc = await loadPdfDoc(pdfBytes);
            var bsdImage = bsdImageBytes ? await embedImageAuto(doc, bsdImageBytes) : null;
            var userLogoImage = null;
            if (logoImageBytes) {
                try {
                    userLogoImage = await embedImageAuto(doc, logoImageBytes);
                } catch (e) {
                    userLogoImage = null; // Skip logo gracefully, keep going with בס"ד.
                }
            }

            var pages = doc.getPages();
            for (var idx = 0; idx < pages.length; idx++) {
                if (skipPageIndices.includes(idx)) continue;
                var page = pages[idx];
                var size = page.getSize();
                var width = size.width, height = size.height;

                if (bsdImage) {
                    var dims = bsdImage.scale(0.5);
                    page.drawImage(bsdImage, {
                        x: width - dims.width - 20,
                        y: height - dims.height - 10,
                        width: dims.width,
                        height: dims.height
                    });
                }

                if (userLogoImage) {
                    var maxH = 60;
                    var scaleFactor = maxH / userLogoImage.height;
                    var logoW = userLogoImage.width * scaleFactor;
                    var logoH = userLogoImage.height * scaleFactor;
                    page.drawImage(userLogoImage, {
                        x: 20,
                        y: height - logoH - 10,
                        width: logoW,
                        height: logoH
                    });
                }
            }
            return doc.save();
        } catch (e) {
            return toU8(pdfBytes);
        }
    }

    // ---------------------------------------------------------------------
    // 11. Image -> full-bleed A4 PDF page.
    // ---------------------------------------------------------------------

    /** Wraps a JPG/PNG image into a single full-bleed A4 PDF page, choosing portrait vs landscape from the image's own aspect ratio. */
    async function convertImageToPdfClientSide(imageBytes) {
        var u8 = toU8(imageBytes);
        var pdfDoc = await window.PDFLib.PDFDocument.create();
        var image;
        try {
            image = await pdfDoc.embedJpg(u8);
        } catch (e) {
            try {
                image = await pdfDoc.embedPng(u8);
            } catch (e2) {
                throw new Error('פורמט תמונה לא נתמך (רק JPG/PNG)');
            }
        }

        var A4_LONG = 841.89, A4_SHORT = 595.28;
        var isLandscape = image.width > image.height;
        var pageWidth = isLandscape ? A4_LONG : A4_SHORT;
        var pageHeight = isLandscape ? A4_SHORT : A4_LONG;

        var scale = Math.min(pageWidth / image.width, pageHeight / image.height);
        var finalWidth = image.width * scale;
        var finalHeight = image.height * scale;
        var x = (pageWidth - finalWidth) / 2;
        var y = (pageHeight - finalHeight) / 2;

        var page = pdfDoc.addPage([pageWidth, pageHeight]);
        page.drawImage(image, { x: x, y: y, width: finalWidth, height: finalHeight });
        return pdfDoc.save();
    }

    // ---------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------

    window.PdfEngine = {
        // utils
        cleanPdfHeader: cleanPdfHeader,
        base64ToBytes: base64ToBytes,
        bytesToBase64: bytesToBase64,
        blankPageMarker: blankPageMarker,

        // 1. merge
        mergeWithOrder: mergeWithOrder,

        // 2. page-level remix
        listPages: listPages,
        buildFromPageList: buildFromPageList,

        // 3. forced A4 fit
        resizePdfToA4: resizePdfToA4,
        rasterizeAndResizePdfToA4: rasterizeAndResizePdfToA4,

        // 4. booklet rotation
        applyBookletRotation: applyBookletRotation,
        areAllPagesLandscape: areAllPagesLandscape,

        // 5. even blank pages
        addEvenBlankPagesToPdf: addEvenBlankPagesToPdf,

        // 6. duplicate 2-up
        createDuplicateTwoUp: createDuplicateTwoUp,

        // 7. N-up imposition
        createNUpPdf: createNUpPdf,

        // 8. margin cut
        addMarginCutToPdf: addMarginCutToPdf,

        // 9. page filtering
        filterPdfPages: filterPdfPages,

        // 10. branding
        generateBsdWatermarkPng: generateBsdWatermarkPng,
        addBrandingToPdf: addBrandingToPdf,

        // 11. image -> PDF
        convertImageToPdfClientSide: convertImageToPdfClientSide
    };

})(window);
