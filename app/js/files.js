/* ============================================================
   files.js — file upload (click + drag/drop), thumbnails/page
   counts, the file grid/list rendering, per-file settings
   (quantity/format/toggles/multi-up/page-selection/note), group
   tab buttons, and applying "sending styles" to files.
   ============================================================ */

// ---- upload ----
async function handleFileSelect(event) { await handleFiles(event.target.files); }

async function handleFiles(fileList) {
    if (!fileList || !fileList.length) return;
    const defBrand = getBrandingDefaults();

    for (let file of Array.from(fileList)) {
        let originalName = file.name, finalName = originalName, count = 1;
        while (filesData.some(f => f.fileObj.name === finalName)) {
            const extIndex = originalName.lastIndexOf('.');
            finalName = extIndex !== -1
                ? `${originalName.substring(0, extIndex)}(${count})${originalName.substring(extIndex)}`
                : `${originalName}(${count})`;
            count++;
        }
        if (finalName !== originalName) {
            try { file = new File([file], finalName, { type: file.type, lastModified: file.lastModified }); }
            catch (e) { console.warn('Could not rename file', e); }
        }

        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const canConvert = file.type.includes('word') || file.type.includes('image') || ['docx', 'doc', 'jpg', 'jpeg', 'png'].includes(ext);
        const isImage = file.type.startsWith('image/') || ['jpg', 'jpeg', 'png'].includes(ext);
        const fileId = Math.random().toString(36).substr(2, 9);
        let previewUrl = isImage ? URL.createObjectURL(file) : null;

        const itemData = {
            fileObj: file, id: fileId, group: 0,
            quantity: 'לכולם', format: 'רגיל', note: '',
            convertToPdf: canConvert, addPageNumbers: false, addArrows: false,
            addBsd: defBrand.bsd, addLogo: defBrand.logo,
            reverseLastPage: false, duplicateTwoUp: false, addEvenBlankPage: false,
            compressPdf: false, splitFile: false, marginCut: false,
            multiUpMode: '', pageSelection: '', blurLogo: isSwitchOn('defaultBlurToggle'),
            canConvert, previewUrl, ext,
            pageCount: isImage ? 1 : undefined,
            isExpanded: file.size > (LARGE_FILE_THRESHOLD_MB * 1024 * 1024),
            appliedStyleName: '', isModified: false, isPlusSelected: false, quantityManuallyChanged: false
        };
        filesData.push(itemData);
        renderFiles();

        if (ext === 'pdf') {
            getPdfPageCountOnly(file).then(result => {
                itemData.pageCount = result.numPages || 0;
                itemData.previewUrl = result.url;
                renderFiles();
                checkAutoReverse(itemData);
            });
        }
    }
    const input = document.getElementById('fileInput');
    if (input) input.value = '';
}

async function getPdfPageCountOnly(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let thumbnailUrl = null;
        try {
            const page = await pdf.getPage(1);
            const viewport = page.getViewport({ scale: 0.5 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width; canvas.height = viewport.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            thumbnailUrl = canvas.toDataURL();
        } catch (e) { /* fall back to icon */ }
        return { url: thumbnailUrl, numPages: pdf.numPages || 0 };
    } catch (e) { return { url: null, numPages: 0 }; }
}

function toggleExpand(id) {
    const item = filesData.find(f => f.id === id);
    if (item) { item.isExpanded = !item.isExpanded; renderFiles(); }
}
function togglePlus(id) {
    const item = filesData.find(f => f.id === id);
    if (item) { item.isPlusSelected = !item.isPlusSelected; renderFiles(); }
}
function removeFile(id) {
    filesData = filesData.filter(f => f.id !== id);
    renderFiles();
    const sb = document.getElementById('mergeSidebar');
    if (sb && sb.classList.contains('open')) renderMergeList();
}

function checkAutoReverse(item) {
    const fmt = getStoredFormats().find(f => f.name === item.format);
    if (fmt && fmt.autoReverse && item.pageCount > 0 && item.pageCount % 4 === 0) item.reverseLastPage = true;
}
function adjustQuantityForTwoUp(item) { /* placeholder hook, mirrors original's no-op-by-default behavior */ }

// ---- per-file param updates (also propagates to the rest of a merge group) ----
function updateFileParam(id, key, value) {
    const item = filesData.find(f => f.id === id);
    if (!item) return;

    const apply = (f) => {
        if (key === 'quantity') f.quantityManuallyChanged = true;
        if (key === 'format' && typeof value === 'string' && value.includes('צבעוני') && !f.quantityManuallyChanged) f.quantity = '1';
        f[key] = value;
        if (STYLE_KEYS.includes(key)) f.appliedStyleName = '';
        if (key === 'format') checkAutoReverse(f);
        f.isModified = true;
    };

    if (item.group > 0 && STYLE_KEYS.includes(key)) {
        filesData.filter(f => f.group === item.group).forEach(apply);
    } else {
        apply(item);
    }

    if (key === 'group' && value > 0) {
        const existing = filesData.find(f => f.group === value && f.id !== id);
        if (existing) {
            STYLE_KEYS.forEach(k => { if (!(k === 'convertToPdf' && !item.canConvert)) item[k] = existing[k]; });
        }
    }

    renderFiles();
    const sb = document.getElementById('mergeSidebar');
    if (key === 'group' && sb && sb.classList.contains('open')) renderMergeList();
}

function cycleFileLogo(id) {
    const item = filesData.find(f => f.id === id);
    if (!item) return;
    const cur = item.addLogo === true || item.addLogo === '1' ? '1' : (item.addLogo === '2' ? '2' : '');
    item.addLogo = cur === '' ? '1' : (cur === '1' ? '2' : '');
    item.appliedStyleName = '';
    item.isModified = true;
    renderFiles();
}

// ---- rendering ----
function renderFiles() {
    const container = document.getElementById('fileListContainer');
    if (!container) return;
    container.className = `file-list ${currentView === 'list' ? 'list-view' : ''}`;

    let totalBytes = 0, hasHugeFile = false;

    if (filesData.length === 0) {
        container.innerHTML = '';
        updateStatusBar(0, false);
        if (typeof updateStyleSelect === 'function') updateStyleSelect();
        return;
    }

    container.innerHTML = filesData.map(item => {
        totalBytes += item.fileObj.size;
        if (item.fileObj.size > DRIVE_THRESHOLD_MB * 1024 * 1024) hasHugeFile = true;
        return renderFileCard(item);
    }).join('');

    updateStatusBar(totalBytes, hasHugeFile);
    if (typeof updateStyleSelect === 'function') updateStyleSelect();

    const mergeSidebar = document.getElementById('mergeSidebar');
    if (mergeSidebar && mergeSidebar.classList.contains('open') && currentMergeGroup > 0) renderMergeList();
}

function previewContentFor(item) {
    if (item.ext === 'pdf') {
        return item.previewUrl ? `<img src="${item.previewUrl}" alt="">` : `<i class="fas fa-file-pdf icon" style="color:#dc2626;font-size:2.2rem;"></i>`;
    }
    if (item.previewUrl) return `<img src="${item.previewUrl}" alt="" onerror="this.style.display='none';">`;
    let iconClass = 'fa-file';
    if (item.ext.includes('doc')) iconClass = 'fa-file-word';
    if (item.fileObj.type.includes('video')) iconClass = 'fa-file-video';
    return `<i class="fas ${iconClass} icon" style="font-size:2.2rem;"></i>`;
}

function renderFileCard(item) {
    const isLarge = item.fileObj.size > LARGE_FILE_THRESHOLD_MB * 1024 * 1024;
    const sizeClass = isLarge ? 'file-size-line large' : 'file-size-line';
    const plusActive = item.isPlusSelected ? 'active' : '';
    const modifiedShow = item.isModified ? 'show' : '';
    const groupTabs = getGroupTabsHTML(item);
    const stylesOptions = getStylesOptionsHTML(item.appliedStyleName);
    const editGroupBtn = item.group > 0 ? `<button class="btn-edit-group" onclick="openMergeSidebar(${item.group})" title="ערוך קבוצה ${item.group}"><i class="fas fa-pencil-alt"></i></button>` : '';

    return `
    <div class="file-card group-${item.group}" data-id="${item.id}">
        <div class="file-top">
            <div class="file-name-wrap">
                <button class="btn-plus ${plusActive}" onclick="togglePlus('${item.id}')" title="סימון לשליחה משנית (⊕)"><i class="fas fa-plus"></i></button>
                <div style="min-width:0;">
                    <div class="file-name" title="${escAttr(item.fileObj.name)}">${escHtml(item.fileObj.name)} <span class="file-modified-dot ${modifiedShow}" title="הוגדר"></span></div>
                    <div class="${sizeClass}">${formatSize(item.fileObj.size)}${isLarge ? ' (גדול)' : ''}${item.pageCount ? ' · ' + item.pageCount + ' עמ׳' : ''}</div>
                </div>
            </div>
            <div class="file-icon-actions">
                ${editGroupBtn}
                ${groupTabs}
                <button class="btn-icon-only btn-sm btn-secondary ${item.blurLogo ? 'active-toggle' : ''}" onclick="toggleBlurLogo('${item.id}')" title="הסתרת לוגו / טשטוש"><i class="fa-solid fa-droplet"></i></button>
                <button class="btn-icon-only btn-sm btn-secondary ${item.pageSelection ? 'active-toggle' : ''}" onclick="openPageSelectionPrompt('${item.id}')" title="בחירת עמודים"><i class="fa-solid fa-scissors"></i></button>
                <button class="btn-icon-only btn-sm btn-secondary" onclick="downloadSingleItem('${item.id}')" title="הורדת קובץ מעובד"><i class="fa-solid fa-download"></i></button>
                <button class="btn-icon-only btn-sm btn-danger-ghost" onclick="removeFile('${item.id}')" title="הסר"><i class="fas fa-trash-alt"></i></button>
            </div>
        </div>
        <div class="file-thumb">${previewContentFor(item)}</div>
        <div class="style-select-row">
            <select class="select" onchange="applyStyleToFile('${item.id}', this.value)">${stylesOptions}</select>
        </div>
        <button class="toggle-more-btn" onclick="toggleExpand('${item.id}')">${item.isExpanded ? '<i class="fas fa-chevron-up"></i> סגור אפשרויות' : '<i class="fas fa-cog"></i> הגדרות נוספות'}</button>
        <div class="advanced-controls ${item.isExpanded ? 'show' : ''}">
            <div class="moved-controls">
                <div><label>כמות</label><select class="select" onchange="updateFileParam('${item.id}', 'quantity', this.value)">${getQuantityOptionsHTML(item.quantity)}</select></div>
                <div><label>פורמט</label><select class="select" onchange="updateFileParam('${item.id}', 'format', this.value)">${getFormatOptionsHTML(item.format)}</select></div>
            </div>
            <div class="multiselect">
                <div class="multiselect-btn" onclick="toggleFileOptionsMultiselect('${item.id}')"><span>אפשרויות הדפסה ועיצוב</span><i class="fas fa-caret-down"></i></div>
                <div id="dropdown_${item.id}" class="multiselect-content">${getDropdownItems(item)}</div>
            </div>
            ${getLargeFileOptions(item, isLarge)}
            <div class="opt-note"><input type="text" class="input" placeholder="הערה לקובץ..." value="${escAttr(item.note)}" onchange="updateFileParam('${item.id}', 'note', this.value)"></div>
        </div>
    </div>`;
}

function toggleFileOptionsMultiselect(id) {
    const dd = document.getElementById('dropdown_' + id);
    if (!dd) return;
    const wasOpen = dd.classList.contains('show');
    document.querySelectorAll('.multiselect-content.show').forEach(d => d.classList.remove('show'));
    if (!wasOpen) dd.classList.add('show');
}

function getStylesOptionsHTML(selectedStyleName) {
    const styles = getStoredStyles();
    if (!styles.length) return `<option value="">אין סגנונות שמורים</option>`;
    let html = `<option value="">-- בחר סגנון מהיר --</option>`;
    styles.forEach(s => { html += `<option value="${escAttr(s.name)}" ${s.name === selectedStyleName ? 'selected' : ''}>${escHtml(s.name)}</option>`; });
    return html;
}

function getGroupTabsHTML(item) {
    return `<div class="group-tabs">
        ${[0, 1, 2, 3, 4].map(g => `<button class="group-tab ${item.group === g ? 'active' : ''}" data-g="${g}" onclick="updateFileParam('${item.id}','group',${g})" title="${g === 0 ? 'ללא מיזוג' : 'שילוב ' + g}">${g === 0 ? '−' : g}</button>`).join('')}
    </div>`;
}

function getDropdownItems(item) {
    const logoVal = item.addLogo === true || item.addLogo === '1' ? '1' : (item.addLogo === '2' ? '2' : '');
    const logoLabel = logoVal === '' ? 'אין' : (logoVal === '1' ? 'לוגו 1' : 'לוגו 2');
    let items = '';
    if (item.canConvert) items += chkItem(item.id, 'convertToPdf', item.convertToPdf, 'המר ל-PDF');
    items += chkItem(item.id, 'addBsd', item.addBsd, 'הוסף בס"ד');
    items += `<label class="multiselect-item"><span>הוסף לוגו: ${logoLabel}</span><button class="btn btn-secondary btn-sm" style="margin-inline-start:auto;" onclick="event.stopPropagation(); cycleFileLogo('${item.id}')">החלף</button></label>`;
    items += chkItem(item.id, 'addPageNumbers', item.addPageNumbers, 'הוסף מספור');
    items += chkItem(item.id, 'addArrows', item.addArrows, '9 בעמוד + חיצים');
    items += chkItem(item.id, 'reverseLastPage', item.reverseLastPage, 'הפוך דף אחרון');
    items += chkItem(item.id, 'duplicateTwoUp', item.duplicateTwoUp, '2 בעמוד (משוכפל)');
    items += chkItem(item.id, 'addEvenBlankPage', item.addEvenBlankPage, 'הוסף דף ריק זוגי');
    items += chkItem(item.id, 'marginCut', item.marginCut, 'חיתוך שוליים');
    items += `<div class="multiselect-item" style="justify-content:space-between;"><span>מרובים בעמוד:</span><select class="file-opt-select" onchange="updateFileParam('${item.id}', 'multiUpMode', this.value)">
        <option value="" ${!item.multiUpMode ? 'selected' : ''}>ללא</option>
        <option value="4" ${item.multiUpMode === '4' ? 'selected' : ''}>4 בעמוד</option>
        <option value="4_dup" ${item.multiUpMode === '4_dup' ? 'selected' : ''}>4 (משוכפל)</option>
        <option value="9" ${item.multiUpMode === '9' ? 'selected' : ''}>9 בעמוד</option>
        <option value="9_dup" ${item.multiUpMode === '9_dup' ? 'selected' : ''}>9 (משוכפל)</option>
        <option value="16" ${item.multiUpMode === '16' ? 'selected' : ''}>16 בעמוד</option>
        <option value="16_dup" ${item.multiUpMode === '16_dup' ? 'selected' : ''}>16 (משוכפל)</option>
    </select></div>`;
    items += `<div class="multiselect-item"><input type="text" class="input" style="height:32px;" placeholder="הערה..." value="${escAttr(item.note)}" onchange="updateFileParam('${item.id}', 'note', this.value)"></div>`;
    items += `<div class="multiselect-item"><button class="btn btn-secondary btn-sm multiselect-footer-btn" style="width:100%;" onclick="saveAsStyleFromFile('${item.id}')"><i class="fas fa-save"></i> שמור כסגנון</button></div>`;
    return items;
}
function chkItem(id, key, checked, label) {
    return `<label class="multiselect-item checkbox-item"><input type="checkbox" ${checked ? 'checked' : ''} onchange="updateFileParam('${id}', '${key}', this.checked)"><span>${label}</span></label>`;
}

function getLargeFileOptions(item, isLarge) {
    if (!isLarge) return '';
    const compress = (item.ext === 'pdf' || item.convertToPdf)
        ? `<label class="checkbox-row"><input type="checkbox" ${item.compressPdf ? 'checked' : ''} onchange="updateFileParam('${item.id}', 'compressPdf', this.checked)"><i class="fas fa-compress-arrows-alt"></i> דחיסה</label>` : '';
    const split = `<label class="checkbox-row"><input type="checkbox" ${item.splitFile ? 'checked' : ''} onchange="updateFileParam('${item.id}', 'splitFile', this.checked)"><i class="fas fa-cut"></i> פצל</label>`;
    return `<div class="large-file-options">${compress}${split}</div>`;
}

function updateStatusBar(bytes, hasHugeFile) {
    const mb = bytes / (1024 * 1024);
    const el = document.getElementById('sizeStatus');
    const txt = document.getElementById('totalSizeText');
    const method = document.getElementById('destMethod');
    if (!el) return;
    if (bytes === 0) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    txt.innerText = mb.toFixed(2) + ' MB';
    if (hasHugeFile) { el.className = 'status-bar status-drive'; method.innerHTML = 'שילוב מייל + דרייב <i class="fab fa-google-drive"></i>'; }
    else if (mb > MAX_BATCH_SIZE_MB) { el.className = 'status-bar status-heavy'; method.innerHTML = 'מפוצל למספר מיילים <i class="fas fa-boxes"></i>'; }
    else { el.className = 'status-bar status-ok'; method.innerHTML = 'מייל בודד <i class="fas fa-envelope"></i>'; }
}

function setView(view) {
    currentView = view;
    localStorage.setItem('preferredView', view);
    document.getElementById('btn-grid-view').classList.toggle('active', view === 'grid');
    document.getElementById('btn-list-view').classList.toggle('active', view === 'list');
    renderFiles();
}

// ---- sending styles: apply to one file / all files / a group ----
function applyStyleToFile(fileId, styleName) {
    if (!styleName) return;
    const style = getStoredStyles().find(s => s.name === styleName);
    const item = filesData.find(f => f.id === fileId);
    if (!style || !item) return;
    item.appliedStyleName = styleName;
    STYLE_KEYS.forEach(k => { if (style[k] !== undefined && !(k === 'convertToPdf' && !item.canConvert)) item[k] = style[k]; });
    item.quantityManuallyChanged = false;
    item.isModified = true;
    checkAutoReverse(item);
    renderFiles();
}
function applySelectedStyle() {
    const sel = document.getElementById('styleSelect');
    if (!sel || !sel.value || !filesData.length) return;
    const style = getStoredStyles().find(s => s.name === sel.value);
    if (!style) return;
    filesData.forEach(item => {
        STYLE_KEYS.forEach(k => { if (style[k] !== undefined && !(k === 'convertToPdf' && !item.canConvert)) item[k] = style[k]; });
        item.quantityManuallyChanged = false;
        item.isModified = true;
        checkAutoReverse(item);
    });
    renderFiles();
}
function onStyleSelectChange() {
    const btn = document.getElementById('applyStyleBtn');
    if (btn) btn.disabled = !document.getElementById('styleSelect').value || filesData.length === 0;
}
function updateStyleSelect() {
    const sel = document.getElementById('styleSelect');
    if (!sel) return;
    const row = document.getElementById('styleSelectorRow');
    const btn = document.getElementById('applyStyleBtn');
    const curVal = sel.value;
    const styles = getStoredStyles();
    sel.innerHTML = '<option value="">-- בחר סגנון --</option>' + styles.map(s => `<option value="${escAttr(s.name)}">${escHtml(s.name)}</option>`).join('');
    if (curVal && styles.some(s => s.name === curVal)) sel.value = curVal;
    if (row) row.classList.toggle('show', filesData.length > 0);
    if (btn) btn.disabled = !sel.value || filesData.length === 0;
}
function saveAsStyleFromFile(fileId) {
    const item = filesData.find(f => f.id === fileId);
    if (!item) return;
    const name = prompt('שם לסגנון החדש:');
    if (!name || !name.trim()) return;
    const styleData = {};
    STYLE_KEYS.forEach(k => { styleData[k] = item[k]; });
    styleData.secondaryEmail = '';
    const styles = getStoredStyles();
    const idx = styles.findIndex(s => s.name === name.trim());
    if (idx > -1) styles[idx] = { name: name.trim(), ...styleData };
    else styles.push({ name: name.trim(), ...styleData });
    saveStylesToStorage(styles);
    updateStyleSelect();
}

// ---- page selection modal ----
async function openPageSelectionPrompt(id) {
    const item = filesData.find(f => f.id === id);
    if (!item) return;
    currentSelectionFileId = id;
    document.getElementById('pageSelectionInput').value = item.pageSelection || '';
    openModalRaw('pageSelectionModal');

    const grid = document.getElementById('pageSelectionGrid');
    const loader = document.getElementById('pageSelectionLoading');
    grid.innerHTML = '';
    currentSelectionTotalPages = 0;

    if (item.ext !== 'pdf' && !item.canConvert) {
        grid.classList.remove('hidden');
        grid.innerHTML = '<div class="manager-list-empty">קובץ זה אינו נתמך לתצוגת עמודים.</div>';
        return;
    }
    grid.classList.add('hidden');
    loader.classList.remove('hidden');
    try {
        const bytes = item.ext === 'pdf' ? await item.fileObj.arrayBuffer() : await getFileAsPdfBytes(item);
        const pdfDoc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
        currentSelectionTotalPages = pdfDoc.getPageCount();
        loader.classList.add('hidden');
        grid.classList.remove('hidden');
        let html = '';
        for (let i = 1; i <= currentSelectionTotalPages; i++) {
            html += `<div class="page-checkbox-item" onclick="togglePageCheckbox(this)">דף ${i}</div>`;
        }
        grid.innerHTML = html;
        updatePageSelectionVisuals();
    } catch (e) {
        console.error('Could not load PDF to show pages', e);
        loader.classList.add('hidden');
        grid.classList.remove('hidden');
        grid.innerHTML = '<div class="manager-list-empty">לא ניתן לטעון תצוגת דפים עבור קובץ זה.</div>';
    }
}
function openModalRaw(id) { const el = document.getElementById(id); if (el) el.classList.add('open'); }

function togglePageCheckbox(el) { el.classList.toggle('selected'); updateInputFromVisuals(); }
function selectAllPages() {
    document.getElementById('pageSelectionInput').value = '';
    document.querySelectorAll('#pageSelectionGrid .page-checkbox-item').forEach(el => el.classList.add('selected'));
}
function updateInputFromVisuals() {
    if (currentSelectionTotalPages === 0) return;
    const selected = [];
    document.querySelectorAll('#pageSelectionGrid .page-checkbox-item').forEach((el, i) => { if (el.classList.contains('selected')) selected.push(i + 1); });
    const input = document.getElementById('pageSelectionInput');
    if (selected.length === 0 || selected.length === currentSelectionTotalPages) { input.value = ''; return; }
    let ranges = [], start = selected[0], end = selected[0];
    for (let i = 1; i < selected.length; i++) {
        if (selected[i] === end + 1) end = selected[i];
        else { ranges.push(start === end ? `${start}` : `${start}-${end}`); start = end = selected[i]; }
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    input.value = ranges.join(', ');
}
function updatePageSelectionVisuals() {
    const val = document.getElementById('pageSelectionInput').value;
    if (currentSelectionTotalPages === 0) return;
    const items = document.querySelectorAll('#pageSelectionGrid .page-checkbox-item');
    if (val.trim() === '') { items.forEach(el => el.classList.add('selected')); return; }
    const selectedSet = new Set();
    val.split(',').forEach(part => {
        part = part.trim();
        if (part.includes('-')) {
            let [s, e] = part.split('-').map(n => parseInt(n));
            if (!isNaN(s) && !isNaN(e)) { s = Math.max(1, s); e = Math.min(currentSelectionTotalPages, e); for (let i = s; i <= e; i++) selectedSet.add(i); }
        } else {
            const n = parseInt(part);
            if (!isNaN(n)) selectedSet.add(n);
        }
    });
    items.forEach((el, i) => el.classList.toggle('selected', selectedSet.has(i + 1)));
}
function savePageSelection() {
    if (!currentSelectionFileId) return;
    updateFileParam(currentSelectionFileId, 'pageSelection', document.getElementById('pageSelectionInput').value.trim());
    closeModal('pageSelectionModal');
}

// ---- download a single processed file (uses the send-pipeline's per-file processor) ----
async function downloadSingleItem(id) {
    const item = filesData.find(f => f.id === id);
    if (!item) return;
    try {
        let bytes = await getFileAsPdfBytesOrOriginal(item);
        const res = await processPdfEffects(bytes, item);
        const blob = new Blob([res.bytes], { type: 'application/pdf' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = item.fileObj.name.replace(/\.[^/.]+$/, '') + '_מעובד.pdf';
        a.click();
    } catch (e) {
        console.error(e);
        alert('שגיאה בעיבוד הקובץ: ' + e.message);
    }
}
async function getFileAsPdfBytesOrOriginal(item) {
    if ((item.convertToPdf && item.ext !== 'pdf') || (item.pageSelection && item.pageSelection.trim() !== '')) {
        return await getFileAsPdfBytes(item);
    }
    return await item.fileObj.arrayBuffer();
}
