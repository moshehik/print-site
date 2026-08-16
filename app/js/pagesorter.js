/* ============================================================
   pagesorter.js — "סדר וערבב דפים": lets the user build a custom
   page order across every PDF in a merge group (pull individual
   pages from any source file, insert blank pages, reorder).
   The saved order is consumed later by the send pipeline via
   PdfEngine.mergeWithOrder(fileBytesList, customOrder).
   Thumbnails are rendered locally with pdf.js (pure preview, not
   "PDF math"); the "download edited file" button prefers
   PdfEngine.listPages/buildFromPageList when available and falls
   back to a local pdf-lib assembly otherwise.
   ============================================================ */

async function openPageSorter() {
    if (currentMergeGroup === 0) return;
    const filesInGroup = filesData.filter(f => f.group === currentMergeGroup && f.ext === 'pdf');
    if (filesInGroup.length === 0) { showError('אין קבצי PDF בקבוצה זו. ניתן לסדר דפים רק לקבצי PDF.'); return; }

    pageSorterState.group = currentMergeGroup;
    pageSorterState.sourceFiles = filesInGroup.map(f => ({ fileItem: f, pages: null }));
    document.getElementById('pageSorterTitle').innerHTML = `<i class="fas fa-grip-horizontal"></i> סדרן דפים — קבוצה ${currentMergeGroup}`;
    openModalRaw('pageSorterModal');

    renderSourcePanel();
    resetFinalOrder(false);

    const existing = customPageOrders[currentMergeGroup];
    if (existing && existing.length) {
        pageSorterState.finalOrder = await hydrateSavedOrder(existing);
    }
    renderFinalOrderPanel();
}

async function hydrateSavedOrder(saved) {
    const out = [];
    for (const p of saved) {
        if (p.type === 'blank') { out.push({ type: 'blank' }); continue; }
        const fileItem = filesData.find(f => f.id === p.fileId);
        if (!fileItem) continue;
        const thumb = await getPageThumbnail(fileItem, p.pageIndex);
        out.push({ type: 'page', fileId: p.fileId, pageIndex: p.pageIndex, thumbnail: thumb, originalFileName: fileItem.fileObj.name });
    }
    return out;
}

function renderSourcePanel() {
    const container = document.getElementById('sourcePagesContainer');
    container.innerHTML = pageSorterState.sourceFiles.map((sf, idx) => `
        <div class="source-file-block" data-idx="${idx}">
            <div class="source-file-head" onclick="toggleSourceFileView(${idx})">
                <span>${escHtml(sf.fileItem.fileObj.name)}</span>
                <i class="fas fa-chevron-down"></i>
            </div>
            <div class="source-pages-grid" id="sourceGrid_${idx}"></div>
        </div>`).join('');
}

async function toggleSourceFileView(idx) {
    const grid = document.getElementById('sourceGrid_' + idx);
    const isShown = grid.classList.contains('show');
    if (isShown) { grid.classList.remove('show'); return; }
    grid.classList.add('show');
    const sf = pageSorterState.sourceFiles[idx];
    if (sf.pages) { renderSourceGrid(idx); return; }
    grid.innerHTML = '<div class="manager-list-empty">טוען עמודים...</div>';
    try {
        const bytes = await sf.fileItem.fileObj.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        const pages = [];
        for (let i = 0; i < pdf.numPages; i++) pages.push({ pageIndex: i, thumbnail: null });
        sf.pages = pages;
        renderSourceGrid(idx);
        // render thumbnails progressively
        for (let i = 0; i < pdf.numPages; i++) {
            const page = await pdf.getPage(i + 1);
            const viewport = page.getViewport({ scale: 0.35 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width; canvas.height = viewport.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            sf.pages[i].thumbnail = canvas.toDataURL();
            const cell = document.querySelector(`#sourceGrid_${idx} [data-page="${i}"] .source-page-preview`);
            if (cell) cell.innerHTML = `<img src="${sf.pages[i].thumbnail}">`;
        }
    } catch (e) {
        console.error(e);
        grid.innerHTML = '<div class="manager-list-empty">שגיאה בטעינת הקובץ.</div>';
    }
}
function renderSourceGrid(idx) {
    const sf = pageSorterState.sourceFiles[idx];
    const grid = document.getElementById('sourceGrid_' + idx);
    grid.innerHTML = sf.pages.map(p => {
        const added = pageSorterState.finalOrder.some(fp => fp.type === 'page' && fp.fileId === sf.fileItem.id && fp.pageIndex === p.pageIndex);
        return `<div class="source-page-item ${added ? 'added' : ''}" data-page="${p.pageIndex}">
            <div class="source-page-preview">${p.thumbnail ? `<img src="${p.thumbnail}">` : '<div class="spinner"></div>'}</div>
            <div class="source-page-info">עמ׳ ${p.pageIndex + 1}</div>
            <button class="btn-page-action" style="width:100%; margin-top:3px;" onclick="addPageToFinalOrder('${sf.fileItem.id}', ${p.pageIndex})"><i class="fas fa-plus"></i></button>
        </div>`;
    }).join('');
}
async function getPageThumbnail(fileItem, pageIndex) {
    try {
        const bytes = await fileItem.fileObj.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        const page = await pdf.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale: 0.35 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        return canvas.toDataURL();
    } catch (e) { return null; }
}

function renderFinalOrderPanel() {
    const container = document.getElementById('finalPagesContainer');
    document.getElementById('pageSorterInfo').textContent = `${pageSorterState.finalOrder.length} עמודים`;
    if (pageSorterState.finalOrder.length === 0) { container.innerHTML = '<div class="manager-list-empty">אין עמודים בסדר הסופי</div>'; return; }
    container.innerHTML = pageSorterState.finalOrder.map((p, i) => {
        if (p.type === 'blank') {
            return `<div class="final-page-item">
                <div class="final-page-number">${i + 1}</div>
                <div class="final-page-preview"><i class="fas fa-file icon" style="color:var(--text-3);"></i></div>
                <div class="final-page-info">דף ריק</div>
                ${finalPageControls(i)}
            </div>`;
        }
        return `<div class="final-page-item">
            <div class="final-page-number">${i + 1}</div>
            <div class="final-page-preview">${p.thumbnail ? `<img src="${p.thumbnail}">` : '<div class="spinner"></div>'}</div>
            <div class="final-page-info">${escHtml(p.originalFileName)}<br>עמ׳ ${p.pageIndex + 1}</div>
            ${finalPageControls(i)}
        </div>`;
    }).join('');
}
function finalPageControls(i) {
    return `<div class="final-page-controls">
        <button class="btn-page-action" onclick="movePageInFinalOrder(${i}, -1)" ${i === 0 ? 'disabled' : ''}><i class="fas fa-chevron-up"></i></button>
        <button class="btn-page-action" onclick="movePageInFinalOrder(${i}, 1)" ${i === pageSorterState.finalOrder.length - 1 ? 'disabled' : ''}><i class="fas fa-chevron-down"></i></button>
        <button class="btn-page-action" style="color:var(--danger); border-color:var(--danger);" onclick="removePageFromFinalOrder(${i})"><i class="fas fa-trash-alt"></i></button>
    </div>`;
}

function addPageToFinalOrder(fileId, pageIndex) {
    const sf = pageSorterState.sourceFiles.find(s => s.fileItem.id === fileId);
    const page = sf && sf.pages ? sf.pages.find(p => p.pageIndex === pageIndex) : null;
    pageSorterState.finalOrder.push({ type: 'page', fileId, pageIndex, thumbnail: page ? page.thumbnail : null, originalFileName: sf.fileItem.fileObj.name });
    renderFinalOrderPanel();
    const idx = pageSorterState.sourceFiles.findIndex(s => s.fileItem.id === fileId);
    if (idx > -1) renderSourceGrid(idx);
}
function addBlankPageToFinalOrder() { pageSorterState.finalOrder.push({ type: 'blank' }); renderFinalOrderPanel(); }
function removePageFromFinalOrder(index) {
    const removed = pageSorterState.finalOrder.splice(index, 1)[0];
    renderFinalOrderPanel();
    if (removed && removed.type === 'page') {
        const idx = pageSorterState.sourceFiles.findIndex(s => s.fileItem.id === removed.fileId);
        if (idx > -1 && pageSorterState.sourceFiles[idx].pages) renderSourceGrid(idx);
    }
}
function movePageInFinalOrder(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= pageSorterState.finalOrder.length) return;
    [pageSorterState.finalOrder[index], pageSorterState.finalOrder[target]] = [pageSorterState.finalOrder[target], pageSorterState.finalOrder[index]];
    renderFinalOrderPanel();
}
function resetFinalOrder(render = true) {
    const groupFiles = filesData.filter(f => f.group === currentMergeGroup && f.ext === 'pdf');
    pageSorterState.finalOrder = [];
    // Default: sequential order across all files/pages in the group (mirrors the plain merge).
    (async () => {
        for (const f of groupFiles) {
            try {
                const bytes = await f.fileObj.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
                for (let i = 0; i < pdf.numPages; i++) {
                    pageSorterState.finalOrder.push({ type: 'page', fileId: f.id, pageIndex: i, thumbnail: null, originalFileName: f.fileObj.name });
                }
            } catch (e) { console.error(e); }
        }
        if (render) renderFinalOrderPanel();
    })();
}

function savePageOrder() {
    customPageOrders[currentMergeGroup] = pageSorterState.finalOrder.map(p =>
        p.type === 'blank' ? { type: 'blank' } : { type: 'page', fileId: p.fileId, pageIndex: p.pageIndex });
    closeModal('pageSorterModal');
    showError('סדר הדפים נשמר. הוא ייושם בעת השליחה.');
}

async function downloadSortedFile() {
    try {
        const bytes = await buildPdfFromPageOrder(pageSorterState.finalOrder);
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `קובץ_ערוך_קבוצה_${currentMergeGroup}.pdf`;
        a.click();
    } catch (e) {
        console.error(e);
        showError('שגיאה ביצירת הקובץ: ' + e.message);
    }
}

/** Builds the actual PDF bytes for a page-order array. Prefers PdfEngine
 *  (buildFromPageList / mergeWithOrder); falls back to a direct pdf-lib
 *  assembly so the tool still works before pdf-engine.js lands. */
async function buildPdfFromPageOrder(order) {
    if (window.PdfEngine && typeof window.PdfEngine.buildFromPageList === 'function') {
        // PdfEngine addresses pages by positional fileIndex into fileBytesList, not
        // by our fileId strings — build that mapping (see convertFileIdOrderToIndexOrder
        // in send.js for the same pattern used by the group-merge path).
        const idToIndex = {};
        const fileBytesList = [];
        for (const p of order) {
            if (p.type === 'page' && !(p.fileId in idToIndex)) {
                const item = filesData.find(f => f.id === p.fileId);
                idToIndex[p.fileId] = fileBytesList.length;
                fileBytesList.push(item ? await item.fileObj.arrayBuffer() : new Uint8Array());
            }
        }
        const pageRefs = order.map(p => p.type === 'blank'
            ? { type: 'blank' }
            : { type: 'page', fileIndex: idToIndex[p.fileId], pageIndex: p.pageIndex });
        return await window.PdfEngine.buildFromPageList(fileBytesList, pageRefs);
    }
    console.warn('PdfEngine.buildFromPageList missing — using local pdf-lib fallback.');
    const outDoc = await PDFLib.PDFDocument.create();
    const loaded = {};
    let lastSize = { width: 595.28, height: 841.89 };
    for (const p of order) {
        if (p.type === 'blank') { outDoc.addPage([lastSize.width, lastSize.height]); continue; }
        if (!loaded[p.fileId]) {
            const item = filesData.find(f => f.id === p.fileId);
            if (!item) continue;
            loaded[p.fileId] = await PDFLib.PDFDocument.load(await item.fileObj.arrayBuffer());
        }
        const srcDoc = loaded[p.fileId];
        if (p.pageIndex < srcDoc.getPageCount()) {
            const [copied] = await outDoc.copyPages(srcDoc, [p.pageIndex]);
            lastSize = copied.getSize();
            outDoc.addPage(copied);
        }
    }
    return await outDoc.save();
}
