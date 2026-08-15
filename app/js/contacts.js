/* ============================================================
   contacts.js — recipients (main/secondary multiselects + manual
   entry), contacts manager modal, branding defaults (בס"ד/logo),
   logo upload, and the auto-generated subject line (hebcal).
   ============================================================ */

// ---- visual settings: show/hide the fixed בס"ד + logo header chrome ----
function initVisualSettings() {
    const showBsd = localStorage.getItem('showBsd') !== 'false';
    const showLogo = localStorage.getItem('showLogo') !== 'false';
    applyVisibility('bsd', showBsd);
    applyVisibility('logo', showLogo);

    const defBrand = getBrandingDefaults();
    setSwitch('defaultBsdToggle', defBrand.bsd);
    applyDefaultLogoUi(defBrand.logo);
    setSwitch('defaultBlurToggle', localStorage.getItem('defaultBlur') === 'true');

    loadUserLogoPreview();
}
function applyVisibility(type, show) {
    const el = document.getElementById(type === 'bsd' ? 'bsdContainer' : 'mainLogo');
    if (el) el.style.display = show ? 'block' : 'none';
}

function saveBrandingDefaults() {
    localStorage.setItem('defaultBsd', isSwitchOn('defaultBsdToggle'));
    const lbl = document.getElementById('defaultLogoLabel');
    localStorage.setItem('defaultLogo', (lbl && lbl.dataset.value) || '');
}
function cycleDefaultLogo() {
    const lbl = document.getElementById('defaultLogoLabel');
    const cur = (lbl && lbl.dataset.value) || '';
    const next = cur === '' ? '1' : (cur === '1' ? '2' : '');
    applyDefaultLogoUi(next);
    saveBrandingDefaults();
}
function applyDefaultLogoUi(val) {
    const lbl = document.getElementById('defaultLogoLabel');
    if (!lbl) return;
    lbl.dataset.value = val;
    lbl.textContent = val === '' ? 'אין' : (val === '1' ? 'לוגו 1' : 'לוגו 2');
}

function handleLogoUpload(logoNum, files) {
    if (!files || !files.length) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const base64 = e.target.result;
        localStorage.setItem('userLogo' + logoNum + 'Base64', base64);
        if (logoNum === 1) localStorage.setItem('userLogoBase64', base64);
        loadUserLogoPreview();
    };
    reader.readAsDataURL(files[0]);
}
function clearLogo(logoNum) {
    localStorage.removeItem('userLogo' + logoNum + 'Base64');
    if (logoNum === 1) localStorage.removeItem('userLogoBase64');
    loadUserLogoPreview();
}
function loadUserLogoPreview() {
    for (let i = 1; i <= 2; i++) {
        const base64 = getLogoBase64(i);
        const container = document.getElementById('logo' + i + 'PreviewContainer');
        if (!container) continue;
        container.innerHTML = base64 ? `<img src="${base64}" alt="לוגו ${i}">` : `<span class="hint">אין לוגו</span>`;
    }
}

function getBsdImageBytes() {
    const canvas = document.getElementById('bsdCanvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 100, 50);
    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = '#333';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('בס"ד', 95, 5);
    return canvas.toDataURL('image/png');
}

// ---- contacts manager ----
function addContactManual() {
    const nameEl = document.getElementById('newContactName');
    const emailEl = document.getElementById('newContactEmail');
    const name = nameEl.value.trim(), email = emailEl.value.trim();
    if (!name || !email) return;
    const contacts = getSavedContacts();
    contacts.push({ name, email });
    saveContactsToStorage(contacts);
    nameEl.value = ''; emailEl.value = '';
    renderContactsList();
    renderContactsDatalist();
    renderEmailMultiselects();
}
function deleteContact(idx) {
    if (!confirm('למחוק איש קשר זה?')) return;
    const contacts = getSavedContacts();
    contacts.splice(idx, 1);
    saveContactsToStorage(contacts);
    renderContactsList();
    renderContactsDatalist();
    renderEmailMultiselects();
}
function renderContactsList() {
    const list = getSavedContacts();
    const container = document.getElementById('modalContactsList');
    if (list.length === 0) { container.innerHTML = '<div class="manager-list-empty">אין אנשי קשר</div>'; return; }
    container.innerHTML = list.map((c, i) => `
        <div class="manager-list-item">
            <span><b>${escHtml(c.name)}</b> (${escHtml(c.email)})</span>
            <button class="btn-delete-item" onclick="deleteContact(${i})"><i class="fas fa-trash-alt"></i></button>
        </div>`).join('');
}
function renderContactsDatalist() {
    const contacts = getSavedContacts();
    const history = JSON.parse(localStorage.getItem('emailHistory') || '[]');
    let html = contacts.map(c => `<option value="${escAttr(c.name)} <${escAttr(c.email)}>">${escHtml(c.email)}</option>`).join('');
    history.forEach(e => { if (!contacts.some(c => c.email === e)) html += `<option value="${escAttr(e)}">`; });
    const dl = document.getElementById('contacts-datalist');
    if (dl) dl.innerHTML = html;
}

// ---- recipient multiselects (checkbox dropdown of saved contacts + manual free text) ----
function renderEmailMultiselects() {
    renderEmailMultiselect('mainEmailMultiselect', 'main');
    renderEmailMultiselect('secondaryEmailMultiselect', 'secondary');
}
function renderEmailMultiselect(containerId, type) {
    const contacts = getSavedContacts();
    const selected = type === 'main' ? getSelectedMainEmailsRaw() : getSelectedSecondaryEmailsRaw();
    const container = document.getElementById(containerId);
    if (!container) return;
    const dropdownId = `dropdown_${containerId}`;
    const wasOpen = document.getElementById(dropdownId) ? document.getElementById(dropdownId).classList.contains('show') : false;

    const selectedNames = contacts.filter(c => selected.includes(c.email)).map(c => c.name);
    const displayText = selectedNames.length ? selectedNames.join(', ') : 'בחר אנשי קשר';
    let html = `<div class="multiselect-btn" onclick="toggleEmailMultiselect('${containerId}')"><span class="${selectedNames.length ? '' : 'placeholder'}">${escHtml(displayText)}</span><i class="fas fa-caret-down"></i></div>`;
    html += `<div id="${dropdownId}" class="multiselect-content ${wasOpen ? 'show' : ''}">`;
    if (contacts.length === 0) html += `<div class="manager-list-empty">אין אנשי קשר שמורים</div>`;
    contacts.forEach(c => {
        const checked = selected.includes(c.email) ? 'checked' : '';
        html += `<label class="multiselect-item"><input type="checkbox" value="${escAttr(c.email)}" ${checked} onchange="onEmailMultiselectChange('${containerId}', '${type}', this)"><span>${escHtml(c.name)} &lt;${escHtml(c.email)}&gt;</span></label>`;
    });
    html += `</div>`;
    container.innerHTML = html;
}
function toggleEmailMultiselect(containerId) {
    document.querySelectorAll('.multiselect-content.show').forEach(d => { if (d.id !== `dropdown_${containerId}`) d.classList.remove('show'); });
    document.getElementById(`dropdown_${containerId}`).classList.toggle('show');
}
function onEmailMultiselectChange(containerId, type, el) {
    const email = el.value;
    const storageKey = type === 'main' ? 'selectedMainEmails' : 'selectedSecondaryEmails';
    let arr = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (el.checked) {
        if (!arr.includes(email)) arr.push(email);
    } else {
        arr = arr.filter(e => e !== email);
        const manualInput = document.getElementById(type === 'main' ? 'mainEmailManual' : 'secondaryEmailManual');
        if (manualInput && manualInput.value.trim() === email) manualInput.value = '';
    }
    localStorage.setItem(storageKey, JSON.stringify(arr));
    renderEmailMultiselects();
}
function getSelectedMainEmails() {
    let arr = getSelectedMainEmailsRaw();
    const manual = document.getElementById('mainEmailManual') ? document.getElementById('mainEmailManual').value.trim() : '';
    if (manual && !arr.includes(manual)) arr.push(manual);
    return arr.filter(Boolean);
}
function getSelectedSecondaryEmails() {
    let arr = getSelectedSecondaryEmailsRaw();
    const manual = document.getElementById('secondaryEmailManual') ? document.getElementById('secondaryEmailManual').value.trim() : '';
    if (manual && !arr.includes(manual)) arr.push(manual);
    return arr.filter(Boolean);
}

// ---- subject auto-generation (day of week + parasha + Hebrew date, via hebcal) ----
async function generateAutoSubject() {
    try {
        const today = new Date();
        const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
        const hebrewDate = new Intl.DateTimeFormat('he-u-ca-hebrew', { year: 'numeric', month: 'long', day: 'numeric' }).format(today);
        let parasha = '';
        try {
            const response = await fetch('https://www.hebcal.com/shabbat?cfg=json&geonameid=281184&M=on');
            const data = await response.json();
            const parashaItem = (data.items || []).find(item => item.category === 'parashat');
            parasha = parashaItem ? parashaItem.hebrew : '';
        } catch (e) { parasha = ''; }
        currentFolderName = `יום ${days[today.getDay()]} - ${parasha}`;
        const subjectEl = document.getElementById('subject');
        if (subjectEl) subjectEl.value = `קבצים | ${days[today.getDay()]} | ${parasha} | ${hebrewDate}`;
    } catch (e) {
        const subjectEl = document.getElementById('subject');
        if (subjectEl) subjectEl.value = 'קבצים להדפסה';
        currentFolderName = 'ארכיון כללי';
    }
}
