/* ============================================================
   main.js — app bootstrap: wires up upload/drag-drop, view
   toggle, recipient autofill, and kicks off first render.
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
    initFormatStorage();
    initQuantityStorage();
    initContacts();
    initVisualSettings();
    initCropModal();
    initLogDirectory();

    const savedView = localStorage.getItem('preferredView') || 'grid';
    setView(savedView);

    document.getElementById('btn-grid-view').addEventListener('click', () => setView('grid'));
    document.getElementById('btn-list-view').addEventListener('click', () => setView('list'));

    const fileInput = document.getElementById('fileInput');
    if (fileInput) fileInput.addEventListener('change', handleFileSelect, false);

    const dropZone = document.getElementById('dropZone');
    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.style.borderColor = 'var(--primary-solid)'; });
        dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.style.borderColor = ''; });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault(); e.stopPropagation();
            dropZone.style.borderColor = '';
            handleFiles(e.dataTransfer.files);
        });
    }

    updateStyleSelect();
    renderEmailMultiselects();
    renderContactsDatalist();
    generateAutoSubject().then(updateDestSummary);

    // כרטיס היעד: תצוגה (שורת סיכום + עיפרון) <-> עריכה (הטופס), כמו "פרטי לקוח"
    document.getElementById('destEditBtn').addEventListener('click', () => setDestEditing(!destEditing));
    document.getElementById('subject').addEventListener('input', updateDestSummary);
    // סגירת רשימות נגללות בלחיצה בחוץ
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.multiselect')) document.querySelectorAll('.multiselect-content.show').forEach(d => d.classList.remove('show'));
    });
    updateDestSummary();
    // אם אין נמענים בכלל - נפתח ישר במצב עריכה כדי שלא יפספסו
    if (!getSelectedMainEmailsRaw().length) setDestEditing(true);

    renderFiles();
});

let destEditing = false;
function setDestEditing(on) {
    destEditing = on;
    document.getElementById('destEditRow').classList.toggle('hidden', !on);
    document.getElementById('destSummary').classList.toggle('hidden', on);
    document.getElementById('destEditIcon').classList.toggle('hidden', on);
    document.getElementById('destDoneIcon').classList.toggle('hidden', !on);
    document.getElementById('destTitle').textContent = on ? 'עריכת נמענים ונושא' : 'למי שולחים';
    document.getElementById('destEditBtn').title = on ? 'סיום עריכה' : 'עריכת נמענים ונושא';
    document.getElementById('destTitleRow').style.marginBottom = on ? '14px' : '0';
    if (!on) updateDestSummary();
}
function updateDestSummary() {
    const el = document.getElementById('destSummary');
    if (!el) return;
    const contacts = getSavedContacts();
    const nameOf = (e) => { const c = contacts.find(x => x.email === e); return c ? c.name : e; };
    const list = getDestinations();
    const subject = (document.getElementById('subject') || {}).value || '';
    const parts = list.map((d, i) => {
        const who = (d.emails || []).map(nameOf).join(', ');
        return `${destDotHtml(d, true)}<b>${escHtml(d.name)}</b>${i === 0 ? '' : ''}: ${who ? escHtml(who) : '<span style="color:var(--danger)">אין נמענים</span>'}`;
    });
    if (subject) parts.push('נושא: ' + escHtml(subject));
    el.innerHTML = parts.join(' <span class="dest-sep">·</span> ');
    el.title = el.textContent;
    const missing = !(list[0].emails || []).length;
    el.style.color = missing ? 'var(--danger)' : '';
}