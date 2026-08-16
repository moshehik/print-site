/**
 * poster-tool.js
 * ------------------------------------------------------------------------
 * Plain browser script (no bundler / no ES modules) that ports the
 * standalone "מערכת פריסה מתקדמת" (Advanced Layout System) tool into a
 * self-contained module: window.PosterTool.
 *
 * Source of truth: "שילוב PDF\מערכת_פריסה_מתקדמת.html" — read that file
 * for the original single-page implementation. This module reproduces its
 * math and behavior as closely as possible:
 *
 *   1. Split one image / PDF page into an NxN grid of tiles (1x1..5x5).
 *   2. Pack all tiles densely onto output sheets (A4/A3/Letter) at a
 *      user-specified physical tile size (cm), auto-computing columns,
 *      rows, and page count (including an "auto-fill" duplication pass
 *      that tries to avoid leaving near-empty trailing pages).
 *   3. Sequential numbering per tile ("<source#> (<part#>)") for
 *      reassembly.
 *   4. An image editor sub-tool: rectangular crop, lasso/freeform crop,
 *      2x upscale, gentle sharpen (3x3 convolution), undo (single-level,
 *      same as original), replace-selection-with-uploaded-image, and
 *      per-page navigation for multi-page PDF sources.
 *   5. Output as a single downloadable multi-page PDF.
 *
 * This module owns the DOM wiring + all canvas/PDF logic for the tool. It
 * expects the markup produced by print-site/poster.html (see that file for
 * the exact element ids) but does not otherwise depend on any other file
 * in the repo. It depends on two globals loaded by the host page:
 *   - pdfjsLib   (pdf.min.js / pdf.worker.min.js — vendored locally)
 *   - window.jspdf.jsPDF (jspdf.umd.min.js — vendored locally)
 *
 * Both are the SAME versions (pdf.js 3.11.174, jsPDF 2.5.1) the original
 * tool loaded from cdnjs, so behavior/API surface matches exactly.
 * ------------------------------------------------------------------------
 */
(function (global) {
    'use strict';

    function createPosterTool() {

        // ---- module state (mirrors the original tool's closure state) ----
        let els = {};               // cached DOM refs, filled by init()
        let selectedFiles = [];
        let previewSourceCanvas = null;

        // Editor state
        let fileEdits = new Map();          // File -> {type:'image', canvas} | {type:'pdf', pages:{n:canvas}}
        let editorFileIndex = -1;
        let editorPdfDoc = null;
        let editorPdfPageNum = 1;
        const editorSourceCanvas = document.createElement('canvas');
        const editorWorkingCanvas = document.createElement('canvas');
        let activeTool = 'rect';            // 'rect' | 'lasso'
        let isDrawing = false;
        let startX = 0, startY = 0;
        let cropRect = null;                // {x, y, w, h}
        let lassoPoints = [];
        const editorUndoCanvas = document.createElement('canvas');
        let hasSelection = false;
        let currentCropPath = null;
        let editorCtx = null;

        let initialized = false;

        // ---- small helpers ----

        function $(id) { return document.getElementById(id); }

        // Read a design-system CSS custom property so canvas drawing (crop
        // borders / grid lines / selection marquee) follows the active
        // theme/palette instead of hard-coded hex values.
        function themeColor(varName, fallback) {
            try {
                const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
                return v || fallback;
            } catch (e) {
                return fallback;
            }
        }

        function fileToCanvas(file) {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = function (event) {
                    const img = new Image();
                    img.onload = function () {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        canvas.getContext('2d').drawImage(img, 0, 0);
                        resolve(canvas);
                    };
                    img.src = event.target.result;
                };
                reader.readAsDataURL(file);
            });
        }

        // ---- init ----

        function init(config) {
            config = config || {};

            if (global.pdfjsLib) {
                global.pdfjsLib.GlobalWorkerOptions.workerSrc = config.workerSrc || 'libs/pdf.worker.min.js';
            }

            els = {
                fileInput: $('fileInput'),
                dropZone: $('dropZone'),
                fileList: $('fileList'),
                processBtn: $('processBtn'),
                loader: $('loader'),
                statusText: $('statusText'),
                statusLog: $('statusLog'),
                gridSelect: $('gridSelect'),
                pageSizeSelect: $('pageSizeSelect'),
                partWidth: $('partWidth'),
                partHeight: $('partHeight'),
                addNumbers: $('addNumbers'),
                autoFillPages: $('autoFillPages'),
                fontSizeInput: $('fontSizeInput'),
                previewContainer: $('previewContainer'),
                previewCanvas: $('previewCanvas'),

                editModal: $('editModal'),
                closeEditModalBtn: $('closeEditModalBtn'),
                toolRect: $('toolRect'),
                toolLasso: $('toolLasso'),
                btnDownloadCrop: $('btnDownloadCrop'),
                btnUploadReplaceLabel: $('btnUploadReplaceLabel'),
                replaceInput: $('replaceInput'),
                btnUpscale: $('btnUpscale'),
                btnSharpen: $('btnSharpen'),
                btnUndo: $('btnUndo'),
                btnDownloadFull: $('btnDownloadFull'),
                btnSaveEdit: $('btnSaveEdit'),
                editPdfControls: $('editPdfControls'),
                btnPrevPage: $('btnPrevPage'),
                btnNextPage: $('btnNextPage'),
                editPageIndicator: $('editPageIndicator'),
                editorCanvas: $('editorCanvas')
            };

            if (!els.editorCanvas) {
                throw new Error('PosterTool.init: required markup not found (editorCanvas missing).');
            }

            editorCtx = els.editorCanvas.getContext('2d');

            wireUploadEvents();
            wireControlEvents();
            wireProcessEvent();
            wireEditorEvents();

            initialized = true;
            return true;
        }

        // ---- upload / drag&drop ----

        function wireUploadEvents() {
            const { fileInput, dropZone } = els;

            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                dropZone.addEventListener(eventName, e => { e.preventDefault(); e.stopPropagation(); }, false);
            });

            dropZone.addEventListener('dragover', () => dropZone.classList.add('dragover'));
            dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
            dropZone.addEventListener('drop', (e) => {
                dropZone.classList.remove('dragover');
                handleFiles(e.dataTransfer.files);
            });

            fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
        }

        function wireControlEvents() {
            els.gridSelect.addEventListener('change', updatePreviewGrid);
            els.partWidth.addEventListener('input', updatePreviewGrid);
            els.partHeight.addEventListener('input', updatePreviewGrid);
        }

        async function handleFiles(files) {
            if (!files || files.length === 0) return;
            selectedFiles = Array.from(files);

            els.fileList.innerHTML = '';
            els.fileList.style.display = 'block';

            selectedFiles.forEach((f, idx) => {
                const item = document.createElement('div');
                item.className = 'file-item';

                const span = document.createElement('span');
                span.innerText = f.name;
                span.title = f.name;

                const btnEdit = document.createElement('button');
                btnEdit.type = 'button';
                btnEdit.className = 'btn-edit';
                btnEdit.innerHTML = '&#9999;&#65039; ערוך'; // "✏️ ערוך"
                btnEdit.onclick = () => openEditor(idx);

                item.appendChild(span);
                item.appendChild(btnEdit);
                els.fileList.appendChild(item);
            });

            els.processBtn.disabled = false;

            try {
                await renderPreview(selectedFiles[0]);
            } catch (err) {
                console.error('Error rendering preview:', err);
            }
        }

        async function renderPreview(file) {
            if (file.type === 'application/pdf') {
                const arrayBuffer = await file.arrayBuffer();
                const pdfDoc = await global.pdfjsLib.getDocument(arrayBuffer).promise;
                const page = await pdfDoc.getPage(1);
                const viewport = page.getViewport({ scale: 1.5 });
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                previewSourceCanvas = canvas;
            } else if (file.type.startsWith('image/')) {
                previewSourceCanvas = await fileToCanvas(file);
            }

            updatePreviewGrid();
            els.previewContainer.style.display = 'flex';
        }

        function updatePreviewGrid() {
            if (!previewSourceCanvas) return;
            const splitCount = parseInt(els.gridSelect.value, 10);
            const partW = parseFloat(els.partWidth.value) || 1;
            const partH = parseFloat(els.partHeight.value) || 1;

            const previewCanvas = els.previewCanvas;
            previewCanvas.width = previewSourceCanvas.width;
            previewCanvas.height = previewSourceCanvas.height;
            const ctx = previewCanvas.getContext('2d');

            ctx.drawImage(previewSourceCanvas, 0, 0);

            // Crop calculation to avoid stretching (matches target aspect ratio)
            const targetRatio = partW / partH;
            const sourceRatio = previewCanvas.width / previewCanvas.height;

            let cropX = 0, cropY = 0, cropW = previewCanvas.width, cropH = previewCanvas.height;

            if (sourceRatio > targetRatio) {
                cropW = previewCanvas.height * targetRatio;
                cropX = (previewCanvas.width - cropW) / 2;
            } else if (sourceRatio < targetRatio) {
                cropH = previewCanvas.width / targetRatio;
                cropY = (previewCanvas.height - cropH) / 2;
            }

            // Shade the margins that get cropped off the page
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            if (cropX > 0) {
                ctx.fillRect(0, 0, cropX, previewCanvas.height);
                ctx.fillRect(cropX + cropW, 0, previewCanvas.width - (cropX + cropW), previewCanvas.height);
            }
            if (cropY > 0) {
                ctx.fillRect(0, 0, previewCanvas.width, cropY);
                ctx.fillRect(0, cropY + cropH, previewCanvas.width, previewCanvas.height - (cropY + cropH));
            }

            // Frame around the active area
            ctx.strokeStyle = themeColor('--primary-solid', '#2563eb');
            ctx.lineWidth = Math.max(2, previewCanvas.width / 300);
            ctx.strokeRect(cropX, cropY, cropW, cropH);

            // Grid lines
            if (splitCount > 1) {
                const tileW = cropW / splitCount;
                const tileH = cropH / splitCount;
                ctx.strokeStyle = themeColor('--danger-solid', '#ef4444');
                ctx.lineWidth = Math.max(3, previewCanvas.width / 200);
                ctx.beginPath();
                for (let i = 1; i < splitCount; i++) {
                    ctx.moveTo(cropX + i * tileW, cropY);
                    ctx.lineTo(cropX + i * tileW, cropY + cropH);
                }
                for (let i = 1; i < splitCount; i++) {
                    ctx.moveTo(cropX, cropY + i * tileH);
                    ctx.lineTo(cropX + cropW, cropY + i * tileH);
                }
                ctx.stroke();
            }
        }

        // ---- layout generation (split + dense pack + PDF export) ----

        function wireProcessEvent() {
            els.processBtn.addEventListener('click', generateLayout);
        }

        async function generateLayout() {
            if (selectedFiles.length === 0) return;

            els.loader.style.display = 'flex';
            els.statusLog.style.display = 'block';
            els.statusLog.innerText = 'מתחיל עיבוד...'; // מתחיל עיבוד...

            const splitCount = parseInt(els.gridSelect.value, 10);
            const pageSize = els.pageSizeSelect.value;
            const partW = parseFloat(els.partWidth.value);
            const partH = parseFloat(els.partHeight.value);
            const addNums = els.addNumbers.checked;
            const autoFillPages = els.autoFillPages.checked;
            const fontSize = parseInt(els.fontSizeInput.value, 10);

            const { jsPDF } = global.jspdf;

            try {
                const pdf = new jsPDF({ orientation: 'portrait', unit: 'cm', format: pageSize });
                pdf.deletePage(1); // start clean, we add pages as needed

                const margin = 0.5; // cm
                const gap = 0.2;    // cm

                let currentX = margin;
                let currentY = margin;
                let colIdx = 0;
                let rowIdx = 0;
                let isFirstPage = true;
                let currentOrientation = 'p';
                let pageW = 21, pageH = 29.7;
                let cols = 0, rows = 0;

                function setPageOrientation(isLandscape) {
                    currentOrientation = isLandscape ? 'l' : 'p';

                    let basePageW = 21, basePageH = 29.7; // a4 default
                    if (pageSize === 'a3') { basePageW = 29.7; basePageH = 42; }
                    else if (pageSize === 'letter') { basePageW = 21.6; basePageH = 27.9; }

                    if (isLandscape) {
                        pageW = Math.max(basePageW, basePageH);
                        pageH = Math.min(basePageW, basePageH);
                    } else {
                        pageW = Math.min(basePageW, basePageH);
                        pageH = Math.max(basePageW, basePageH);
                    }

                    cols = Math.floor((pageW - 2 * margin + gap) / (partW + gap));
                    rows = Math.floor((pageH - 2 * margin + gap) / (partH + gap));
                }

                function addNewPage() {
                    pdf.addPage(pageSize, currentOrientation);
                    currentX = margin;
                    currentY = margin;
                    colIdx = 0;
                    rowIdx = 0;
                }

                let imageCounter = 0;
                const allParts = [];

                async function extractTiles(canvas, splitCount, imgCount) {
                    const isLandscape = canvas.width > canvas.height;
                    const neededOrientation = isLandscape ? 'l' : 'p';

                    const targetRatio = partW / partH;
                    const sourceRatio = canvas.width / canvas.height;

                    let cropX = 0, cropY = 0, cropW = canvas.width, cropH = canvas.height;

                    if (sourceRatio > targetRatio) {
                        cropW = canvas.height * targetRatio;
                        cropX = (canvas.width - cropW) / 2;
                    } else if (sourceRatio < targetRatio) {
                        cropH = canvas.width / targetRatio;
                        cropY = (canvas.height - cropH) / 2;
                    }

                    const tileW = cropW / splitCount;
                    const tileH = cropH / splitCount;

                    let partCounter = 1;
                    for (let r = 0; r < splitCount; r++) {
                        for (let c = 0; c < splitCount; c++) {
                            const tileCanvas = document.createElement('canvas');
                            tileCanvas.width = tileW;
                            tileCanvas.height = tileH;
                            const tileCtx = tileCanvas.getContext('2d');

                            const sx = cropX + (c * tileW);
                            const sy = cropY + (r * tileH);

                            tileCtx.drawImage(canvas, sx, sy, tileW, tileH, 0, 0, tileW, tileH);

                            const imgData = tileCanvas.toDataURL('image/jpeg', 0.85);

                            allParts.push({
                                imgData,
                                label: addNums ? `${imgCount} (${partCounter})` : null,
                                neededOrientation
                            });

                            partCounter++;
                        }
                    }
                }

                for (let i = 0; i < selectedFiles.length; i++) {
                    const file = selectedFiles[i];
                    els.statusText.innerText = `קורא קובץ ${i + 1} מתוך ${selectedFiles.length}...`;

                    if (file.type === 'application/pdf') {
                        const arrayBuffer = await file.arrayBuffer();
                        const pdfDoc = await global.pdfjsLib.getDocument(arrayBuffer).promise;

                        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
                            imageCounter++;
                            els.statusText.innerText = `חותך עמוד ${pageNum} מתוך ה-PDF ${file.name}...`;

                            let canvasToProcess;
                            if (fileEdits.has(file) && fileEdits.get(file).type === 'pdf' && fileEdits.get(file).pages[pageNum]) {
                                canvasToProcess = fileEdits.get(file).pages[pageNum];
                            } else {
                                const page = await pdfDoc.getPage(pageNum);
                                const viewport = page.getViewport({ scale: 2 });
                                const canvas = document.createElement('canvas');
                                canvas.width = viewport.width;
                                canvas.height = viewport.height;
                                await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                                canvasToProcess = canvas;
                            }

                            await extractTiles(canvasToProcess, splitCount, imageCounter);
                        }
                    } else if (file.type.startsWith('image/')) {
                        imageCounter++;
                        els.statusText.innerText = `חותך תמונה ${file.name}...`;

                        let canvasToProcess;
                        if (fileEdits.has(file) && fileEdits.get(file).type === 'image') {
                            canvasToProcess = fileEdits.get(file).canvas;
                        } else {
                            canvasToProcess = await fileToCanvas(file);
                        }
                        await extractTiles(canvasToProcess, splitCount, imageCounter);
                    }
                }

                // Phase 2: place all parts with auto-fill duplication logic
                els.statusText.innerText = 'מסדר פריסה ומחשב שכפולים...';

                let M = 1;
                const T = allParts.length;

                if (autoFillPages && T > 0) {
                    let testLandscape = allParts[0].neededOrientation === 'l';
                    let basePageW = 21, basePageH = 29.7;
                    if (pageSize === 'a3') { basePageW = 29.7; basePageH = 42; }
                    else if (pageSize === 'letter') { basePageW = 21.6; basePageH = 27.9; }

                    let pW = testLandscape ? Math.max(basePageW, basePageH) : Math.min(basePageW, basePageH);
                    let pH = testLandscape ? Math.min(basePageW, basePageH) : Math.max(basePageW, basePageH);

                    const estCols = Math.floor((pW - 2 * margin + gap) / (partW + gap));
                    const estRows = Math.floor((pH - 2 * margin + gap) / (partH + gap));
                    const C = estCols * estRows;

                    if (C > 0) {
                        for (let m = 1; m <= 50; m++) {
                            let rem = (T * m) % C;
                            let empty = (C - rem) % C;
                            if (empty <= 2) { M = m; break; }
                        }
                        if (M === 1) {
                            let bestM = 1, minEmpty = C;
                            for (let m = 1; m <= 50; m++) {
                                let rem = (T * m) % C;
                                let empty = (C - rem) % C;
                                if (empty < minEmpty) { minEmpty = empty; bestM = m; }
                            }
                            M = bestM;
                        }
                    }
                }

                for (let m = 0; m < M; m++) {
                    for (const p of allParts) {
                        if (isFirstPage || currentOrientation !== p.neededOrientation) {
                            setPageOrientation(p.neededOrientation === 'l');
                            if (cols < 1 || rows < 1) {
                                throw new Error('המידות שהזנת (רוחב/גובה) גדולות מדי עבור דף הפלט הנבחר.');
                            }
                            addNewPage();
                            isFirstPage = false;
                        }

                        if (rowIdx >= rows) {
                            addNewPage();
                        }

                        pdf.addImage(p.imgData, 'JPEG', currentX, currentY, partW, partH);

                        if (p.label) {
                            pdf.setFontSize(fontSize);
                            pdf.setTextColor(50);
                            pdf.text(p.label, currentX + (partW / 2), currentY + partH - 0.2, { align: 'center' });
                        }

                        colIdx++;
                        currentX += partW + gap;

                        if (colIdx >= cols) {
                            colIdx = 0;
                            currentX = margin;
                            rowIdx++;
                            currentY += partH + gap;
                        }
                    }
                }

                els.statusText.innerText = 'מייצר קובץ PDF סופי...';
                pdf.save('פריסה_מתקדמת.pdf'); // פריסה_מתקדמת.pdf
                els.statusLog.innerText = `העיבוד הושלם! סך הכל מקורות: ${imageCounter}. הפריסה ירדה כקובץ.`;

            } catch (error) {
                console.error(error);
                showError(error && error.message ? error.message : 'אירעה שגיאה בעיבוד הקבצים.');
                els.statusLog.innerText = 'שגיאה בעיבוד.';
            } finally {
                els.loader.style.display = 'none';
            }
        }

        // ---- image editor sub-tool ----

        function wireEditorEvents() {
            els.toolRect.addEventListener('click', () => {
                activeTool = 'rect';
                els.toolRect.classList.add('active');
                els.toolLasso.classList.remove('active');
                clearSelection();
            });
            els.toolLasso.addEventListener('click', () => {
                activeTool = 'lasso';
                els.toolLasso.classList.add('active');
                els.toolRect.classList.remove('active');
                clearSelection();
            });

            els.closeEditModalBtn.addEventListener('click', () => { els.editModal.style.display = 'none'; });

            els.btnPrevPage.addEventListener('click', () => { if (editorPdfPageNum > 1) loadEditorPage(editorPdfPageNum - 1); });
            els.btnNextPage.addEventListener('click', () => { if (editorPdfDoc && editorPdfPageNum < editorPdfDoc.numPages) loadEditorPage(editorPdfPageNum + 1); });

            els.editorCanvas.addEventListener('mousedown', onEditorMouseDown);
            els.editorCanvas.addEventListener('mousemove', onEditorMouseMove);
            els.editorCanvas.addEventListener('mouseup', onEditorMouseUp);

            els.btnDownloadCrop.addEventListener('click', onDownloadCrop);
            els.replaceInput.addEventListener('change', onReplaceInputChange);
            els.btnUndo.addEventListener('click', onUndo);
            els.btnUpscale.addEventListener('click', onUpscale);
            els.btnDownloadFull.addEventListener('click', onDownloadFull);
            els.btnSharpen.addEventListener('click', onSharpen);
            els.btnSaveEdit.addEventListener('click', onSaveEdit);
        }

        async function openEditor(idx) {
            editorFileIndex = idx;
            const file = selectedFiles[idx];
            els.editPdfControls.style.display = 'none';
            editorPdfDoc = null;
            editorPdfPageNum = 1;

            els.editModal.style.display = 'flex';

            if (file.type === 'application/pdf') {
                const arrayBuffer = await file.arrayBuffer();
                editorPdfDoc = await global.pdfjsLib.getDocument(arrayBuffer).promise;
                els.editPdfControls.style.display = 'flex';
                await loadEditorPage(1);
            } else if (file.type.startsWith('image/')) {
                let sourceCanvas;
                if (fileEdits.has(file) && fileEdits.get(file).type === 'image') {
                    sourceCanvas = fileEdits.get(file).canvas;
                } else {
                    sourceCanvas = await fileToCanvas(file);
                }
                setEditorCanvas(sourceCanvas);
            }
        }

        async function loadEditorPage(pageNum) {
            if (!editorPdfDoc) return;
            editorPdfPageNum = pageNum;
            els.editPageIndicator.innerText = `עמוד ${pageNum} מתוך ${editorPdfDoc.numPages}`; // עמוד N מתוך M
            els.btnPrevPage.disabled = pageNum <= 1;
            els.btnNextPage.disabled = pageNum >= editorPdfDoc.numPages;

            const file = selectedFiles[editorFileIndex];
            if (fileEdits.has(file) && fileEdits.get(file).type === 'pdf' && fileEdits.get(file).pages[pageNum]) {
                setEditorCanvas(fileEdits.get(file).pages[pageNum]);
                return;
            }

            const page = await editorPdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 2 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

            setEditorCanvas(canvas);
        }

        function setEditorCanvas(sourceCanvas) {
            editorSourceCanvas.width = sourceCanvas.width;
            editorSourceCanvas.height = sourceCanvas.height;
            editorSourceCanvas.getContext('2d').drawImage(sourceCanvas, 0, 0);

            editorWorkingCanvas.width = sourceCanvas.width;
            editorWorkingCanvas.height = sourceCanvas.height;
            editorWorkingCanvas.getContext('2d').drawImage(sourceCanvas, 0, 0);

            els.editorCanvas.width = sourceCanvas.width;
            els.editorCanvas.height = sourceCanvas.height;

            els.btnUndo.disabled = true;

            redrawEditor();
            clearSelection();
        }

        function saveUndoState() {
            editorUndoCanvas.width = editorWorkingCanvas.width;
            editorUndoCanvas.height = editorWorkingCanvas.height;
            editorUndoCanvas.getContext('2d').drawImage(editorWorkingCanvas, 0, 0);
            els.btnUndo.disabled = false;
        }

        function redrawEditor() {
            editorCtx.clearRect(0, 0, els.editorCanvas.width, els.editorCanvas.height);
            editorCtx.drawImage(editorWorkingCanvas, 0, 0);

            if (hasSelection) {
                editorCtx.save();
                editorCtx.strokeStyle = themeColor('--danger-solid', '#ef4444');
                editorCtx.lineWidth = Math.max(2, els.editorCanvas.width / 400);
                editorCtx.setLineDash([5, 5]);

                if (activeTool === 'rect' && cropRect) {
                    editorCtx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
                } else if (activeTool === 'lasso' && currentCropPath) {
                    editorCtx.stroke(currentCropPath);
                }
                editorCtx.restore();
            }
        }

        function clearSelection() {
            hasSelection = false;
            cropRect = null;
            lassoPoints = [];
            currentCropPath = null;
            els.btnDownloadCrop.disabled = true;
            els.btnUploadReplaceLabel.classList.add('is-disabled');
            els.replaceInput.disabled = true;
            redrawEditor();
        }

        function getMousePos(evt) {
            const rect = els.editorCanvas.getBoundingClientRect();
            const scaleX = els.editorCanvas.width / rect.width;
            const scaleY = els.editorCanvas.height / rect.height;
            return {
                x: (evt.clientX - rect.left) * scaleX,
                y: (evt.clientY - rect.top) * scaleY
            };
        }

        function onEditorMouseDown(e) {
            if (e.button !== 0) return;
            const pos = getMousePos(e);
            isDrawing = true;
            startX = pos.x;
            startY = pos.y;
            clearSelection();

            if (activeTool === 'lasso') {
                lassoPoints = [{ x: startX, y: startY }];
            }
        }

        function onEditorMouseMove(e) {
            if (!isDrawing) return;
            const pos = getMousePos(e);

            redrawEditor();
            editorCtx.save();
            editorCtx.strokeStyle = themeColor('--danger-solid', '#ef4444');
            editorCtx.lineWidth = Math.max(2, els.editorCanvas.width / 400);
            editorCtx.setLineDash([5, 5]);

            if (activeTool === 'rect') {
                const w = pos.x - startX;
                const h = pos.y - startY;
                editorCtx.strokeRect(startX, startY, w, h);
            } else if (activeTool === 'lasso') {
                lassoPoints.push(pos);
                editorCtx.beginPath();
                editorCtx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
                for (let i = 1; i < lassoPoints.length; i++) {
                    editorCtx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
                }
                editorCtx.stroke();
            }
            editorCtx.restore();
        }

        function onEditorMouseUp(e) {
            if (!isDrawing) return;
            isDrawing = false;
            const pos = getMousePos(e);

            if (activeTool === 'rect') {
                let x = Math.min(startX, pos.x);
                let y = Math.min(startY, pos.y);
                let w = Math.abs(pos.x - startX);
                let h = Math.abs(pos.y - startY);
                if (w > 5 && h > 5) {
                    cropRect = { x, y, w, h };
                    hasSelection = true;
                }
            } else if (activeTool === 'lasso') {
                if (lassoPoints.length > 5) {
                    currentCropPath = new Path2D();
                    currentCropPath.moveTo(lassoPoints[0].x, lassoPoints[0].y);
                    for (let i = 1; i < lassoPoints.length; i++) {
                        currentCropPath.lineTo(lassoPoints[i].x, lassoPoints[i].y);
                    }
                    currentCropPath.closePath();
                    hasSelection = true;

                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    lassoPoints.forEach(p => {
                        if (p.x < minX) minX = p.x;
                        if (p.y < minY) minY = p.y;
                        if (p.x > maxX) maxX = p.x;
                        if (p.y > maxY) maxY = p.y;
                    });
                    cropRect = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
                }
            }

            if (hasSelection) {
                els.btnDownloadCrop.disabled = false;
                els.btnUploadReplaceLabel.classList.remove('is-disabled');
                els.replaceInput.disabled = false;
            }
            redrawEditor();
        }

        function onDownloadCrop() {
            if (!hasSelection || !cropRect) return;
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = cropRect.w;
            tempCanvas.height = cropRect.h;
            const tCtx = tempCanvas.getContext('2d');

            if (activeTool === 'lasso' && currentCropPath) {
                tCtx.translate(-cropRect.x, -cropRect.y);
                tCtx.clip(currentCropPath);
                tCtx.translate(cropRect.x, cropRect.y);
            }

            tCtx.drawImage(editorWorkingCanvas, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, cropRect.w, cropRect.h);

            const link = document.createElement('a');
            link.download = `crop_${Date.now()}.png`;
            link.href = tempCanvas.toDataURL('image/png');
            link.click();
        }

        async function onReplaceInputChange(e) {
            if (!e.target.files || e.target.files.length === 0 || !hasSelection || !cropRect) return;
            saveUndoState();
            const file = e.target.files[0];
            const newImgCanvas = await fileToCanvas(file);

            const wCtx = editorWorkingCanvas.getContext('2d');
            wCtx.save();

            if (activeTool === 'lasso' && currentCropPath) {
                wCtx.clip(currentCropPath);
            }

            wCtx.drawImage(newImgCanvas, cropRect.x, cropRect.y, cropRect.w, cropRect.h);
            wCtx.restore();

            clearSelection();
            e.target.value = '';
        }

        function onUndo() {
            editorWorkingCanvas.width = editorUndoCanvas.width;
            editorWorkingCanvas.height = editorUndoCanvas.height;
            editorWorkingCanvas.getContext('2d').clearRect(0, 0, editorWorkingCanvas.width, editorWorkingCanvas.height);
            editorWorkingCanvas.getContext('2d').drawImage(editorUndoCanvas, 0, 0);

            els.editorCanvas.width = editorWorkingCanvas.width;
            els.editorCanvas.height = editorWorkingCanvas.height;

            els.btnUndo.disabled = true;
            redrawEditor();
        }

        function onUpscale() {
            saveUndoState();

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = editorWorkingCanvas.width * 2;
            tempCanvas.height = editorWorkingCanvas.height * 2;
            const tCtx = tempCanvas.getContext('2d');

            tCtx.imageSmoothingEnabled = true;
            tCtx.imageSmoothingQuality = 'high';
            tCtx.drawImage(editorWorkingCanvas, 0, 0, tempCanvas.width, tempCanvas.height);

            editorWorkingCanvas.width = tempCanvas.width;
            editorWorkingCanvas.height = tempCanvas.height;
            editorWorkingCanvas.getContext('2d').drawImage(tempCanvas, 0, 0);

            els.editorCanvas.width = editorWorkingCanvas.width;
            els.editorCanvas.height = editorWorkingCanvas.height;

            clearSelection();
            redrawEditor();
        }

        function onDownloadFull() {
            const link = document.createElement('a');
            link.download = `edited_image_${Date.now()}.png`;
            link.href = editorWorkingCanvas.toDataURL('image/png');
            link.click();
        }

        function onSharpen() {
            saveUndoState();

            const wCtx = editorWorkingCanvas.getContext('2d');

            let sx = 0, sy = 0, sw = editorWorkingCanvas.width, sh = editorWorkingCanvas.height;
            if (hasSelection && cropRect) {
                sx = Math.floor(cropRect.x);
                sy = Math.floor(cropRect.y);
                sw = Math.floor(cropRect.w);
                sh = Math.floor(cropRect.h);
            }

            if (sw <= 0 || sh <= 0) return;

            const imageData = wCtx.getImageData(sx, sy, sw, sh);
            const data = imageData.data;
            const amount = 0.2;
            const weights = [
                0, -amount, 0,
                -amount, 1 + 4 * amount, -amount,
                0, -amount, 0
            ];

            const side = 3;
            const halfSide = 1;
            const src = new Uint8ClampedArray(data);
            const w = sw;
            const h = sh;

            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const dstOff = (y * w + x) * 4;
                    let r = 0, g = 0, b = 0;
                    for (let cy = 0; cy < side; cy++) {
                        for (let cx = 0; cx < side; cx++) {
                            const scy = Math.min(Math.max(y + cy - halfSide, 0), h - 1);
                            const scx = Math.min(Math.max(x + cx - halfSide, 0), w - 1);

                            const srcOff = (scy * w + scx) * 4;
                            const wt = weights[cy * side + cx];
                            r += src[srcOff] * wt;
                            g += src[srcOff + 1] * wt;
                            b += src[srcOff + 2] * wt;
                        }
                    }
                    data[dstOff] = Math.min(Math.max(r, 0), 255);
                    data[dstOff + 1] = Math.min(Math.max(g, 0), 255);
                    data[dstOff + 2] = Math.min(Math.max(b, 0), 255);
                }
            }

            wCtx.putImageData(imageData, sx, sy);
            redrawEditor();
        }

        function onSaveEdit() {
            if (editorFileIndex < 0) return;
            const file = selectedFiles[editorFileIndex];

            const finalCanvas = document.createElement('canvas');
            finalCanvas.width = editorWorkingCanvas.width;
            finalCanvas.height = editorWorkingCanvas.height;
            finalCanvas.getContext('2d').drawImage(editorWorkingCanvas, 0, 0);

            if (file.type === 'application/pdf') {
                let edits = fileEdits.get(file);
                if (!edits || edits.type !== 'pdf') {
                    edits = { type: 'pdf', pages: {} };
                    fileEdits.set(file, edits);
                }
                edits.pages[editorPdfPageNum] = finalCanvas;
            } else {
                fileEdits.set(file, { type: 'image', canvas: finalCanvas });
            }

            showError('השינויים נשמרו בהצלחה עבור קובץ זה! התצוגה תתעדכן בתהליך הפריסה.');

            if (editorFileIndex === 0 && (file.type !== 'application/pdf' || editorPdfPageNum === 1)) {
                previewSourceCanvas = finalCanvas;
                updatePreviewGrid();
            }
        }

        return {
            init,
            isInitialized: () => initialized
        };
    }

    global.PosterTool = createPosterTool();

})(window);
