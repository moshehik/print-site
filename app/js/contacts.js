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
async function deleteContact(idx) {
    if (!await askConfirm({ title: 'למחוק איש קשר?', message: 'איש הקשר יוסר מהרשימה. אפשר להוסיף אותו שוב בכל עת.', danger: true })) return;
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
            <button class="btn-delete-item" onclick="deleteContact(${i})"><svg class="icon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/></svg></button>
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

// ---- recipient pickers - one per destination (checkbox dropdown of saved contacts + manual email row) ----
function renderEmailMultiselects() {
    const host = document.getElementById('destList');
    if (!host) return;
    const list = getDestinations();
    host.innerHTML = list.map((d, i) => `
        <div class="dest-item dest-${d.color}" data-dest="${d.id}">
            <div class="dest-item-head">
                ${destDotHtml(d)}
                <input class="dest-name" value="${escAttr(d.name)}" title="שם היעד (לחץ לעריכה)" onchange="renameDestination('${d.id}', this.value.trim() || 'יעד'); updateDestSummary(); renderFiles();">
                ${i === 0 ? '<span class="badge badge-neutral" title="כל קובץ נשלח ליעד זה אלא אם הוסר">ברירת מחדל</span>' : `<button type="button" class="btn btn-ghost btn-icon-only btn-sm" title="הפוך לברירת מחדל" onclick="setDefaultDestination('${d.id}'); renderEmailMultiselects(); renderFiles(); updateDestSummary();"><svg class="icon" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button>`}
                ${list.length > 1 && i > 0 ? `<button type="button" class="btn btn-ghost btn-icon-only btn-sm dest-remove" title="הסר יעד" onclick="askRemoveDestination('${d.id}')"><svg class="icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
            </div>
            <div class="multiselect" id="ms_${d.id}"></div>
        </div>`).join('');
    list.forEach(d => renderEmailMultiselect('ms_' + d.id, d.id));
}
async function askRemoveDestination(id) {
    const d = getDestination(id); if (!d) return;
    if (!await askConfirm({ title: 'להסיר יעד?', message: `היעד "${d.name}" יוסר. קבצים שסומנו רק אליו יחזרו ליעד ברירת המחדל.`, danger: true, confirmText: 'הסר' })) return;
    if (removeDestination(id)) { renderEmailMultiselects(); renderFiles(); updateDestSummary(); }
}
async function askAddDestination() {
    const name = await askPrompt({ title: 'יעד חדש', message: 'שם ליעד (למשל: מדפסת משרד, בית דפוס, ארכיון).', placeholder: 'שם היעד…', confirmText: 'הוסף' });
    if (!name) return;
    const id = addDestination(name);
    if (id) { renderEmailMultiselects(); renderFiles(); updateDestSummary(); setTimeout(() => toggleEmailMultiselect('ms_' + id), 50); }
}

function renderEmailMultiselect(containerId, destId) {
    const contacts = getSavedContacts();
    const dest = getDestination(destId); if (!dest) return;
    const selected = dest.emails || [];
    const container = document.getElementById(containerId);
    if (!container) return;
    const dropdownId = `dropdown_${containerId}`;
    const wasOpen = document.getElementById(dropdownId) ? document.getElementById(dropdownId).classList.contains('show') : false;
    const manualId = `manual_${containerId}`;
    const prevManual = document.getElementById(manualId) ? document.getElementById(manualId).value : '';

    const knownEmails = new Set(contacts.map(c => c.email));
    const labels = selected.map(e => { const c = contacts.find(x => x.email === e); return c ? c.name : e; });
    const displayText = labels.length ? labels.join(', ') : 'בחר אנשי קשר או הקלד מייל…';

    let html = `<div class="multiselect-btn" onclick="toggleEmailMultiselect('${containerId}')"><span class="${labels.length ? '' : 'placeholder'}">${escHtml(displayText)}</span><svg class="icon" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></div>`;
    html += `<div id="${dropdownId}" class="multiselect-content ${wasOpen ? 'show' : ''}">`;
    if (contacts.length === 0) html += `<div class="manager-list-empty">אין אנשי קשר שמורים</div>`;
    contacts.forEach(c => {
        const checked = selected.includes(c.email) ? 'checked' : '';
        html += `<label class="multiselect-item"><input type="checkbox" value="${escAttr(c.email)}" ${checked} onchange="onEmailMultiselectChange('${containerId}', '${destId}', this)"><span>${escHtml(c.name)} <span class="hint">&lt;${escHtml(c.email)}&gt;</span></span></label>`;
    });
    selected.filter(e => !knownEmails.has(e)).forEach(e => {
        html += `<label class="multiselect-item"><input type="checkbox" value="${escAttr(e)}" checked onchange="onEmailMultiselectChange('${containerId}', '${destId}', this)"><span>${escHtml(e)} <span class="badge badge-neutral" style="margin-inline-start:6px;">ידני</span></span></label>`;
    });
    html += `<div class="multiselect-manual" onclick="event.stopPropagation()">
        <input type="text" id="${manualId}" class="input" placeholder="הקלד מייל ולחץ Enter…" list="contacts-datalist" dir="ltr" value="${escAttr(prevManual)}"
               onkeydown="if(event.key==='Enter'){event.preventDefault();addManualEmail('${containerId}','${destId}');}">
        <button type="button" class="btn btn-primary btn-sm btn-icon-only" title="הוסף" onclick="addManualEmail('${containerId}','${destId}')"><svg class="icon" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
    </div>`;
    html += `</div>`;
    container.innerHTML = html;
}
function addManualEmail(containerId, destId) {
    const input = document.getElementById(`manual_${containerId}`);
    if (!input) return;
    const email = input.value.trim();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError('כתובת מייל לא תקינה: ' + email); return; }
    const dest = getDestination(destId); if (!dest) return;
    const arr = [...(dest.emails || [])];
    if (!arr.includes(email)) arr.push(email);
    setDestinationEmails(destId, arr);
    input.value = '';
    renderEmailMultiselect(containerId, destId);
    if (typeof updateDestSummary === 'function') updateDestSummary();
}
function toggleEmailMultiselect(containerId) {
    document.querySelectorAll('.multiselect-content.show').forEach(d => { if (d.id !== `dropdown_${containerId}`) d.classList.remove('show'); });
    const dd = document.getElementById(`dropdown_${containerId}`);
    if (dd) dd.classList.toggle('show');
}
// גלילה: התפריט הנפתח של אנשי קשר מוצמד למיקום העכבר — גלילת הדף לא מזיזה אותו איתו.
// אם הגלילה היא מחוץ לתפריט עצמו, סוגרים אותו כדי למנוע "גם הדף וגם התפריט זזים יחד".
(function () {
    function onPageScroll(e) {
        const open = document.querySelectorAll('.multiselect-content.show');
        if (!open.length) return;
        if (e && e.target && e.target.closest && e.target.closest('.multiselect-content')) return;
        open.forEach(d => d.classList.remove('show'));
    }
    window.addEventListener('scroll', onPageScroll, true);
})();
function onEmailMultiselectChange(containerId, destId, el) {
    const email = el.value;
    const dest = getDestination(destId); if (!dest) return;
    let arr = [...(dest.emails || [])];
    if (el.checked) { if (!arr.includes(email)) arr.push(email); }
    else arr = arr.filter(e => e !== email);
    setDestinationEmails(destId, arr);
    renderEmailMultiselect(containerId, destId);
    if (typeof updateDestSummary === 'function') updateDestSummary();
}
// תאימות: הקוד הישן קרא ל"ראשי/משני" - עכשיו זה יעד ברירת המחדל / השני
function getSelectedMainEmailsRaw() { return getDestinations()[0].emails || []; }
function getSelectedSecondaryEmailsRaw() { const l = getDestinations(); return l[1] ? (l[1].emails || []) : []; }
function getSelectedMainEmails() { return getSelectedMainEmailsRaw().filter(Boolean); }
function getSelectedSecondaryEmails() { return getSelectedSecondaryEmailsRaw().filter(Boolean); }

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
