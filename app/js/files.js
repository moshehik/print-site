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

const SVG = {
    pdf:   '<svg class="icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    word:  '<svg class="icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    image: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    file:  '<svg class="icon" viewBox="0 0 24 24"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
    blur:  '<svg class="icon" viewBox="0 0 24 24"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>',
    pages: '<svg class="icon" viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>',
    down:  '<svg class="icon" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    trash: '<svg class="icon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/></svg>',
    edit:  '<svg class="icon" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',
    gear:  '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    up:    '<svg class="icon" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>',
    qty:   '<svg class="icon" viewBox="0 0 24 24"><path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/></svg>',
    format:'<svg class="icon" viewBox="0 0 24 24"><path d="M6 9V3h12v6M6 18h12v3H6zM6 14h12M4 9h16a2 2 0 0 1 2 2v6h-4v-4H6v4H2v-6a2 2 0 0 1 2-2z"/></svg>',
    style: '<svg class="icon" viewBox="0 0 24 24"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12.5" r="2.5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>',
    group: '<svg class="icon" viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
    note:  '<svg class="icon" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    plus:  '<svg class="icon" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    bsd:   '<svg class="icon" viewBox="0 0 24 24"><text x="12" y="16.5" text-anchor="middle" font-size="11" font-weight="800" fill="currentColor" stroke="none" font-family="inherit">בס״ד</text></svg>',
    logo:  '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    secondary: '<svg class="icon" viewBox="0 0 24 24"><path d="M22 12.5V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9"/><polyline points="22 6 12 13 2 6"/><line x1="19" y1="16" x2="19" y2="22"/><line x1="16" y1="19" x2="22" y2="19"/></svg>',
};

function previewContentFor(item) {
    if (item.previewUrl) return `<img src="${item.previewUrl}" alt="" onerror="this.style.display='none';">`;
    if (item.ext === 'pdf') return SVG.pdf;
    if (item.ext.includes('doc')) return SVG.word;
    if (item.fileObj.type.startsWith('image/')) return SVG.image;
    return SVG.file;
}

function extBadgeFor(item) {
    const ext = (item.ext || '').toUpperCase();
    const cls = ext === 'PDF' ? 'badge-danger' : (ext.startsWith('DOC') ? 'badge-info' : 'badge-neutral');
    return `<span class="badge ${cls} file-ext">${escHtml(ext || '?')}</span>`;
}

// כרטיס קובץ - נבנה מחדש על מרכיבי design-system בלבד: תמונה ממוזערת עם
// תג סיומת + כפתור ⊕, גוף עם שם/מטא, "כמות" ו"פורמט" זמינים תמיד, סגנון
// מהיר, ושורת פעולות (קבוצות מיזוג + אייקונים). האפשרויות המתקדמות
// מתקפלות בלחיצה - אותו מודל נתונים בדיוק (updateFileParam וכו').
function renderFileCard(item) {
    const isLarge = item.fileObj.size > LARGE_FILE_THRESHOLD_MB * 1024 * 1024;
    const meta = [
        formatSize(item.fileObj.size) + (isLarge ? ' (גדול)' : ''),
        item.pageCount ? item.pageCount + ' עמ׳' : '',
    ].filter(Boolean).join(' · ');
    const on = (v) => v ? ' active-toggle' : '';
    const activeOpts = countActiveOptions(item);

    // תג לכל הגדרה פעילה - רואים את כל מצב הקובץ בלי לפתוח שום תפריט
    const OPT_LABELS = { convertToPdf: 'PDF', addBsd: 'בס"ד', addPageNumbers: 'מספור', reverseLastPage: 'הפוך אחרון', addArrows: '9+חיצים', duplicateTwoUp: '2 משוכפל', addEvenBlankPage: 'דף ריק', marginCut: 'חיתוך שוליים' };
    const MULTI_LABELS = { '4': '4 בעמוד', '4_dup': '4 משוכפל', '9': '9 בעמוד', '9_dup': '9 משוכפל', '16': '16 בעמוד', '16_dup': '16 משוכפל' };
    const logoVal = item.addLogo === true || item.addLogo === '1' ? '1' : (item.addLogo === '2' ? '2' : '');
    const badge = (cls, text, title) => `<span class="badge ${cls}" title="${escAttr(title || text)}">${escHtml(text)}</span>`;
    const chips = [
        badge('badge-neutral', String(item.quantity || ''), 'כמות'),
        badge('badge-neutral', item.format || '', 'פורמט'),
        item.appliedStyleName ? badge('badge-primary', item.appliedStyleName, 'סגנון') : '',
        item.group > 0 ? badge('badge-info', `שילוב ${item.group}`, 'קבוצת מיזוג') : '',
        item.isPlusSelected ? badge('badge-warning', '⊕ משני', 'נשלח גם לנמענים המשניים') : '',
        item.addBsd ? badge('badge-neutral', 'בס"ד') : '',
        ...CARD_OPTION_KEYS.filter(k => item[k]).map(k => badge('badge-neutral', OPT_LABELS[k])),
        logoVal ? badge('badge-neutral', `לוגו ${logoVal}`) : '',
        item.multiUpMode ? badge('badge-neutral', MULTI_LABELS[item.multiUpMode] || item.multiUpMode, 'מרובים בעמוד') : '',
        item.pageSelection ? badge('badge-info', `עמ׳ ${item.pageSelection}`, 'בחירת עמודים') : '',
        item.blurLogo ? badge('badge-neutral', 'טשטוש לוגו') : '',
        item.note ? badge('badge-warning', 'הערה', item.note) : '',
    ].filter(Boolean).join('');

    return `
    <div class="file-card group-${item.group}" data-id="${item.id}">
        <div class="file-thumb">
            ${previewContentFor(item)}
            ${extBadgeFor(item)}
        </div>
        <div class="file-body">
            <div class="file-name" title="${escAttr(item.fileObj.name)}">${escHtml(item.fileObj.name)}</div>
            <div class="file-meta ${isLarge ? 'large' : ''}">
                <span class="file-modified-dot ${item.isModified ? 'show' : ''}" title="הוגדר"></span>
                <span class="file-meta-text">${meta}</span>
                <span class="file-chips">${chips}</span>
            </div>
            ${getLargeFileOptions(item, isLarge)}
            <div class="file-toolbar">
                <button type="button" class="btn btn-secondary btn-icon-only btn-sm" data-pop="qty"    onclick="openCardMenu(this,'${item.id}','qty')"    title="כמות">${SVG.qty}</button>
                <button type="button" class="btn btn-secondary btn-icon-only btn-sm" data-pop="format" onclick="openCardMenu(this,'${item.id}','format')" title="פורמט">${SVG.format}</button>
                <button type="button" class="btn btn-secondary btn-icon-only btn-sm${on(item.appliedStyleName)}" data-pop="style" onclick="openCardMenu(this,'${item.id}','style')" title="סגנון שליחה">${SVG.style}</button>
                <button type="button" class="btn btn-secondary btn-icon-only btn-sm${on(activeOpts)}" data-pop="options" onclick="openCardMenu(this,'${item.id}','options')" title="אפשרויות הדפסה ועיצוב">${SVG.gear}</button>
                <button type="button" class="btn btn-secondary btn-icon-only btn-sm tb-bsd${on(item.addBsd)}" onclick="updateFileParam('${item.id}','addBsd',${item.addBsd ? 'false' : 'true'})" title="${item.addBsd ? 'הסר בס״ד' : 'הוסף בס״ד'}">${SVG.bsd}</button>
                <button type="button" class="btn btn-secondary btn-icon-only btn-sm tb-logo${on(logoVal)}" onclick="cycleFileLogo('${item.id}')" title="${logoVal ? 'לוגו ' + logoVal + ' (לחץ להחלפה)' : 'הוסף לוגו'}">${SVG.logo}${logoVal ? `<span class="tb-logo-num">${logoVal}</span>` : ''}</button>
                <button type="button" class="btn btn-secondary btn-icon-only btn-sm tb-secondary${item.isPlusSelected ? ' active-toggle' : ''}" onclick="togglePlus('${item.id}')" title="שליחה גם לנמענים המשניים (⊕)">${SVG.secondary}</button>
                <span class="tb-sep"></span>
                <div class="group-tabs" title="קבוצת מיזוג">${getGroupTabsHTML(item)}${item.group > 0 ? `<button type="button" class="btn-edit-group" onclick="openMergeSidebar(${item.group})" title="ניהול קבוצה ${item.group}">${SVG.edit}</button>` : ''}</div>
                <span class="tb-sep"></span>
                <button type="button" class="btn btn-secondary btn-icon-only btn-sm${on(item.blurLogo)}" onclick="toggleBlurLogo('${item.id}')" title="הסתרת לוגו / טשטוש">${SVG.blur}</button>
                <button type="button" class="btn btn-secondary btn-icon-only btn-sm${on(item.pageSelection)}" data-pop="pages" onclick="openPageSelectionPrompt('${item.id}', this)" title="בחירת עמודים">${SVG.pages}</button>
                <button type="button" class="btn btn-secondary btn-icon-only btn-sm${on(item.note)}" data-pop="note" onclick="openCardMenu(this,'${item.id}','note')" title="הערה">${SVG.note}</button>
                <span class="tb-sep"></span>
                <button type="button" class="btn btn-secondary btn-icon-only btn-sm" onclick="downloadSingleItem('${item.id}')" title="הורדת קובץ מעובד">${SVG.down}</button>
                <span class="tb-spacer"></span>
                <button type="button" class="btn btn-secondary btn-icon-only btn-sm tb-danger" onclick="removeFile('${item.id}')" title="הסר">${SVG.trash}</button>
            </div>
        </div>
    </div>`;
}

const CARD_OPTION_KEYS = ['convertToPdf', 'addPageNumbers', 'reverseLastPage', 'addArrows', 'duplicateTwoUp', 'addEvenBlankPage', 'marginCut'];
function countActiveOptions(item) {
    let n = CARD_OPTION_KEYS.filter(k => item[k]).length;
    if (item.multiUpMode) n++;
    return n;
}

// ---- תפריטים צפים של הכרטיס: כל הגדרה נפתחת מהאייקון שלה ----
function openCardMenu(anchor, id, kind) {
    const item = filesData.find(f => f.id === id);
    if (!item) return;
    // מכיוון ש-renderFiles מחליף את ה-DOM, אחרי כל שינוי מאתרים את העוגן מחדש
    const reopen = (k) => {
        const btn = document.querySelector(`.file-card[data-id="${id}"] [data-pop="${k}"]`);
        if (btn) openCardMenu(btn, id, k);
    };
    const set = (key, val, keepOpen) => {
        closePopover();
        updateFileParam(id, key, val);
        if (keepOpen) setTimeout(() => reopen(kind), 0);
    };

    if (kind === 'qty') {
        const items = getStoredQuantities().map(q => ({ value: q, label: q }));
        openPopover(anchor, pickerMenu('כמות', items, item.quantity, v => set('quantity', v)));
        return;
    }
    if (kind === 'format') {
        const items = getStoredFormats().map(f => ({ value: f.name, label: f.name }));
        openPopover(anchor, pickerMenu('פורמט', items, item.format, v => set('format', v)), { width: 240 });
        return;
    }
    if (kind === 'style') {
        const styles = getStoredStyles();
        const wrap = document.createElement('div');
        if (!styles.length) {
            wrap.innerHTML = '<div class="popover-title">סגנון שליחה</div><div class="manager-list-empty">אין סגנונות שמורים</div>';
        } else {
            wrap.appendChild(pickerMenu('סגנון שליחה', styles.map(st => ({ value: st.name, label: st.name })), item.appliedStyleName, v => { closePopover(); applyStyleToFile(id, v); }));
        }
        const foot = document.createElement('div'); foot.className = 'popover-foot';
        foot.innerHTML = '<button type="button" class="btn btn-secondary btn-sm">שמור הגדרות נוכחיות כסגנון</button>';
        foot.querySelector('button').addEventListener('click', () => { closePopover(); saveAsStyleFromFile(id); });
        wrap.appendChild(foot);
        openPopover(anchor, wrap, { width: 260 });
        return;
    }
    if (kind === 'note') {
        const wrap = document.createElement('div');
        wrap.innerHTML = `<div class="popover-title">הערה לקובץ</div>
            <div class="field"><textarea class="textarea" rows="3" placeholder="הערה שתצורף לקובץ…"></textarea></div>
            <div class="popover-foot"><button type="button" class="btn btn-primary btn-sm">שמור</button></div>`;
        const ta = wrap.querySelector('textarea'); ta.value = item.note || '';
        wrap.querySelector('.btn').addEventListener('click', () => set('note', ta.value.trim()));
        ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) set('note', ta.value.trim()); });
        openPopover(anchor, wrap, { width: 280 });
        setTimeout(() => ta.focus(), 0);
        return;
    }
    if (kind === 'options') {
        const logoVal = item.addLogo === true || item.addLogo === '1' ? '1' : (item.addLogo === '2' ? '2' : '');
        const wrap = document.createElement('div');
        wrap.innerHTML = `<div class="popover-title">אפשרויות הדפסה ועיצוב</div>
            <div class="opt-chips"></div>
            <div class="menu-divider"></div>
            <div class="form-grid" style="gap:0 8px; padding:0 4px; grid-template-columns:1fr;">
                <div class="field"><label>מרובים בעמוד</label><select class="select" data-k="multiUpMode">
                    <option value="">ללא</option><option value="4">4 בעמוד</option><option value="4_dup">4 (משוכפל)</option>
                    <option value="9">9 בעמוד</option><option value="9_dup">9 (משוכפל)</option><option value="16">16 בעמוד</option><option value="16_dup">16 (משוכפל)</option></select></div>
            </div>`;
        const chipsEl = wrap.querySelector('.opt-chips');
        const labels = { convertToPdf: 'המר ל-PDF', addPageNumbers: 'מספור', reverseLastPage: 'הפוך דף אחרון', addArrows: '9 בעמוד + חיצים', duplicateTwoUp: '2 משוכפל', addEvenBlankPage: 'דף ריק זוגי', marginCut: 'חיתוך שוליים' };
        CARD_OPTION_KEYS.forEach(k => {
            if (k === 'convertToPdf' && !item.canConvert) return;
            const lab = document.createElement('label'); lab.className = 'opt-chip';
            lab.innerHTML = `<input type="checkbox" ${item[k] ? 'checked' : ''}><span>${labels[k]}</span>`;
            lab.querySelector('input').addEventListener('change', e => set(k, e.target.checked, true));
            chipsEl.appendChild(lab);
        });
        wrap.querySelector('[data-k="multiUpMode"]').value = item.multiUpMode || '';
        wrap.querySelectorAll('select').forEach(sel => sel.addEventListener('change', e => set(e.target.dataset.k, e.target.value, true)));
        openPopover(anchor, wrap, { width: 320 });
        return;
    }
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
    return [0, 1, 2, 3, 4, 5].map(g => `<button type="button" class="group-tab ${item.group === g ? 'active' : ''}" data-g="${g}" onclick="updateFileParam('${item.id}','group',${g})" title="${g === 0 ? 'ללא מיזוג' : 'שילוב ' + g}">${g === 0 ? '−' : g}</button>`).join('');
}

function getLargeFileOptions(item, isLarge) {
    if (!isLarge) return '';
    const compress = (item.ext === 'pdf' || item.convertToPdf)
        ? `<label class="checkbox-row"><input type="checkbox" ${item.compressPdf ? 'checked' : ''} onchange="updateFileParam('${item.id}', 'compressPdf', this.checked)">דחיסה</label>` : '';
    const split = `<label class="checkbox-row"><input type="checkbox" ${item.splitFile ? 'checked' : ''} onchange="updateFileParam('${item.id}', 'splitFile', this.checked)">פצל</label>`;
    return `<div class="large-file-options">${compress}${split}</div>`;
}

function updateStatusBar(bytes, hasHugeFile) {
    const mb = bytes / (1024 * 1024);
    const el = document.getElementById('sizeStatus');
    const txt = document.getElementById('totalSizeText');
    const method = document.getElementById('destMethod');
    const hint = document.getElementById('sendBarHint');
    const countBadge = document.getElementById('fileCountBadge');
    if (countBadge) countBadge.textContent = filesData.length;
    if (!el) return;
    if (bytes === 0) {
        el.className = 'send-bar-status';
        txt.innerText = '0 MB'; method.innerText = '';
        if (hint) hint.innerText = 'העלה קבצים כדי לשלוח';
        return;
    }
    txt.innerText = mb.toFixed(2) + ' MB';
    if (hasHugeFile)                  { el.className = 'send-bar-status status-drive'; method.innerText = 'שילוב מייל + דרייב'; }
    else if (mb > MAX_BATCH_SIZE_MB)  { el.className = 'send-bar-status status-heavy'; method.innerText = 'מפוצל למספר מיילים'; }
    else                              { el.className = 'send-bar-status status-ok';    method.innerText = 'מייל בודד'; }
    if (hint) hint.innerText = `${filesData.length} קבצים מוכנים לשליחה`;
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
async function saveAsStyleFromFile(fileId) {
    const item = filesData.find(f => f.id === fileId);
    if (!item) return;
    const name = await askPrompt({ title: 'שמירה כסגנון', message: 'ההגדרות הנוכחיות של הקובץ יישמרו כסגנון לשימוש חוזר.', placeholder: 'שם הסגנון…', confirmText: 'שמור' });
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
async function openPageSelectionPrompt(id, anchor) {
    const item = filesData.find(f => f.id === id);
    if (!item) return;
    currentSelectionFileId = id;
    // תפריט צף (כמו שאר האייקונים) - הפאנל נבנה מחדש בכל פתיחה, המזהים
    // נשארים כדי ש-updatePageSelectionVisuals/selectAllPages ימשיכו לעבוד
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="popover-title">בחירת עמודים להדפסה/הורדה</div>
        <div class="hint" style="padding:0 6px 8px;">עמודים או טווחים מופרדים בפסיק (1, 3, 5-8). ריק = הכל.</div>
        <div class="manager-add-row" style="padding:0 4px;">
            <input type="text" id="pageSelectionInput" class="input" placeholder="לדוגמה: 1, 3, 5-8" dir="ltr" oninput="updatePageSelectionVisuals()">
            <button type="button" class="btn btn-secondary btn-sm" onclick="selectAllPages()" title="סמן הכל">הכל</button>
        </div>
        <div id="pageSelectionLoading" class="hidden" style="text-align:center; padding:14px;"><span class="spinner" style="display:inline-block;vertical-align:middle;"></span> טוען דפים...</div>
        <div id="pageSelectionGrid" class="page-checkbox-grid" style="margin:0 4px 4px;"></div>
        <div class="popover-foot"><button type="button" class="btn btn-primary btn-sm" onclick="savePageSelection()">שמור בחירה</button></div>`;
    openPopover(anchor, wrap, { width: 340 });
    document.getElementById('pageSelectionInput').value = item.pageSelection || '';

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
    if (window.repositionPopover) repositionPopover();
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
    const val = document.getElementById('pageSelectionInput').value.trim();
    closePopover();
    updateFileParam(currentSelectionFileId, 'pageSelection', val);
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
        showError('שגיאה בעיבוד הקובץ: ' + e.message);
    }
}
async function getFileAsPdfBytesOrOriginal(item) {
    if ((item.convertToPdf && item.ext !== 'pdf') || (item.pageSelection && item.pageSelection.trim() !== '')) {
        return await getFileAsPdfBytes(item);
    }
    return await item.fileObj.arrayBuffer();
}
