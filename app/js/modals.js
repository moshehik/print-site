/* ============================================================
   modals.js — format manager, quantity manager, and the sending
   -style manager + its edit sidebar. (Contacts modal lives in
   contacts.js; branding modal wiring lives in contacts.js +
   cropblur.js; the modal open/close chrome itself is in utils.js.)
   ============================================================ */

// ---- format manager ----
function renderManagerList() {
    const container = document.getElementById('modalFormatList');
    const formats = getStoredFormats();
    if (formats.length === 0) { container.innerHTML = '<div class="manager-list-empty">הרשימה ריקה</div>'; return; }
    container.innerHTML = formats.map(fmt => {
        const badge = fmt.autoReverse ? `<span class="badge badge-info" title="הפוך אוטומטית אם כמות הדפים מתחלקת ב-4" style="margin-inline-end:6px;">היפוך</span>` : '';
        return `<div class="manager-list-item"><span>${badge}${escHtml(fmt.name)}</span><button class="btn-delete-item" onclick="deleteFormat('${escAttr(fmt.name)}')"><i class="fas fa-trash-alt"></i></button></div>`;
    }).join('');
}
function addFormatManual() {
    const input = document.getElementById('newFormatInput');
    const check = document.getElementById('newFormatAutoRev');
    const val = input.value.trim();
    if (!val) return;
    let formats = getStoredFormats();
    if (!formats.some(f => f.name === val)) { formats.push({ name: val, autoReverse: check.checked }); saveFormatsToStorage(formats); }
    input.value = ''; check.checked = false;
    renderManagerList();
}
function deleteFormat(name) {
    if (!confirm(`למחוק את "${name}" מהרשימה?`)) return;
    saveFormatsToStorage(getStoredFormats().filter(f => f.name !== name));
    renderManagerList();
}

// ---- quantity manager ----
function renderQuantityManagerList() {
    const container = document.getElementById('modalQuantityList');
    const list = getStoredQuantities();
    if (list.length === 0) { container.innerHTML = '<div class="manager-list-empty">הרשימה ריקה</div>'; return; }
    container.innerHTML = list.map(q => `<div class="manager-list-item"><span>${escHtml(q)}</span><button class="btn-delete-item" onclick="deleteQuantity('${escAttr(q)}')"><i class="fas fa-trash-alt"></i></button></div>`).join('');
}
function addQuantityManual() {
    const input = document.getElementById('newQuantityInput');
    const val = input.value.trim();
    if (!val) return;
    let list = getStoredQuantities();
    if (!list.includes(val)) { list.push(val); saveQuantitiesToStorage(list); }
    input.value = '';
    renderQuantityManagerList();
}
function deleteQuantity(val) {
    if (!confirm(`למחוק את הכמות "${val}"?`)) return;
    saveQuantitiesToStorage(getStoredQuantities().filter(q => q !== val));
    renderQuantityManagerList();
}

// ---- sending style manager ----
function extractStyleFromItem(item) {
    const s = {};
    STYLE_KEYS.forEach(k => { s[k] = item[k]; });
    s.secondaryEmail = ''; // per-item secondary email isn't a meaningful global style value
    return s;
}
function populateStyleSourceFile() {
    const sel = document.getElementById('styleSourceFileSelect');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="-1">ברירת מחדל (מיתוג)</option>' + filesData.map(f => `<option value="${escAttr(f.fileObj.name)}">${escHtml(f.fileObj.name)}</option>`).join('');
    if (cur && Array.from(sel.options).some(o => o.value === cur)) sel.value = cur;
}
function saveCurrentAsStyle() {
    const nameInput = document.getElementById('newStyleNameInput');
    const name = (nameInput.value || '').trim();
    if (!name) { showError('הכנס שם לסגנון'); return; }
    const srcVal = document.getElementById('styleSourceFileSelect').value;
    let styleData;
    if (srcVal && srcVal !== '-1') {
        const fileItem = filesData.find(f => f.fileObj.name === srcVal);
        styleData = fileItem ? extractStyleFromItem(fileItem) : getDefaultStyleFromBranding();
    } else {
        styleData = getDefaultStyleFromBranding();
    }
    const styles = getStoredStyles();
    const idx = styles.findIndex(s => s.name === name);
    if (idx > -1) {
        if (!confirm('סגנון בשם זה קיים. להחליף?')) return;
        styles[idx] = { name, ...styleData };
    } else {
        styles.push({ name, ...styleData });
    }
    saveStylesToStorage(styles);
    nameInput.value = '';
    renderStyleList();
    updateStyleSelect();
}
function renderStyleList() {
    const container = document.getElementById('modalStyleList');
    const styles = getStoredStyles();
    if (styles.length === 0) { container.innerHTML = '<div class="manager-list-empty">אין סגנונות שמורים</div>'; return; }
    container.innerHTML = styles.map(s => `
        <div class="manager-list-item">
            <span>${escHtml(s.name)}</span>
            <div style="display:flex; gap:4px;">
                <button class="btn-delete-item" style="color:var(--primary-solid);" title="ערוך" onclick="openEditStyleSidebar('${escAttr(s.name)}')"><i class="fas fa-pencil-alt"></i></button>
                <button class="btn-delete-item" title="מחק" onclick="deleteStyle('${escAttr(s.name)}')"><i class="fas fa-trash-alt"></i></button>
            </div>
        </div>`).join('');
}
function deleteStyle(name) {
    if (!confirm(`למחוק את הסגנון "${name}"?`)) return;
    saveStylesToStorage(getStoredStyles().filter(s => s.name !== name));
    renderStyleList();
    updateStyleSelect();
}
function openEditStyleSidebar(styleName) {
    const style = getStoredStyles().find(s => s.name === styleName);
    if (!style) { showError('לא נמצא סגנון!'); return; }
    document.getElementById('editStyleOriginalName').value = style.name;
    document.getElementById('editStyleNameInput').value = style.name;
    document.getElementById('editStyleQuantity').innerHTML = getQuantityOptionsHTML(style.quantity);
    document.getElementById('editStyleFormat').innerHTML = getFormatOptionsHTML(style.format);
    document.getElementById('editStyleConvertPdf').checked = !!style.convertToPdf;
    document.getElementById('editStyleBsd').checked = !!style.addBsd;
    document.getElementById('editStylePageNumbers').checked = !!style.addPageNumbers;
    document.getElementById('editStyleReverseLast').checked = !!style.reverseLastPage;
    document.getElementById('editStyleArrows').checked = !!style.addArrows;
    document.getElementById('editStyleDuplicateTwoUp').checked = !!style.duplicateTwoUp;
    document.getElementById('editStyleAddEvenBlank').checked = !!style.addEvenBlankPage;
    document.getElementById('editStyleMarginCut').checked = !!style.marginCut;
    let logoVal = style.addLogo === '1' || style.addLogo === true ? '1' : (style.addLogo === '2' ? '2' : '');
    document.getElementById('editStyleLogo').value = logoVal;
    document.getElementById('editStyleSendSecondary').checked = !!style.sendSecondary;
    document.getElementById('editStylePlusSelected').checked = !!style.isPlusSelected;
    document.getElementById('editStyleSidebar').classList.add('open');
    closeModal('styleManagerModal');
}
function saveEditedStyle() {
    const originalName = document.getElementById('editStyleOriginalName').value;
    const newName = document.getElementById('editStyleNameInput').value.trim();
    if (!newName) { showError('שם הסגנון לא יכול להיות ריק.'); return; }
    let styles = getStoredStyles();
    if (newName !== originalName && styles.some(s => s.name === newName)) { showError('סגנון בשם זה כבר קיים.'); return; }
    const idx = styles.findIndex(s => s.name === originalName);
    if (idx === -1) { showError('שגיאה: לא נמצא סגנון מקורי לשמירה.'); return; }
    styles[idx] = {
        ...styles[idx],
        name: newName,
        quantity: document.getElementById('editStyleQuantity').value,
        format: document.getElementById('editStyleFormat').value,
        convertToPdf: document.getElementById('editStyleConvertPdf').checked,
        addBsd: document.getElementById('editStyleBsd').checked,
        addPageNumbers: document.getElementById('editStylePageNumbers').checked,
        reverseLastPage: document.getElementById('editStyleReverseLast').checked,
        addArrows: document.getElementById('editStyleArrows').checked,
        duplicateTwoUp: document.getElementById('editStyleDuplicateTwoUp').checked,
        addEvenBlankPage: document.getElementById('editStyleAddEvenBlank').checked,
        marginCut: document.getElementById('editStyleMarginCut').checked,
        addLogo: document.getElementById('editStyleLogo').value,
        sendSecondary: document.getElementById('editStyleSendSecondary').checked,
        isPlusSelected: document.getElementById('editStylePlusSelected').checked,
    };
    saveStylesToStorage(styles);
    closeEditStyleSidebar();
    updateStyleSelect();
    openModal('styleManagerModal');
}
function closeEditStyleSidebar() { document.getElementById('editStyleSidebar').classList.remove('open'); }
