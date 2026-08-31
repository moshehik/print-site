/* ============================================================
   utils.js — small stateless helpers shared across the app.
   ============================================================ */

function escHtml(t) { return (t == null ? '' : String(t)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(t) { return escHtml(t).replace(/"/g, '&quot;'); }

function formatSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function base64ToUint8Array(base64) {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}
function uint8ArrayToBase64(bytes) {
    let binary = '';
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < arr.byteLength; i++) binary += String.fromCharCode(arr[i]);
    return window.btoa(binary);
}

function extractEmail(inputStr) {
    if (!inputStr) return '';
    const match = inputStr.match(/<([^>]+)>/);
    return match ? match[1] : inputStr.trim();
}

function getHebrewDateForFilename() {
    try {
        return new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'numeric', year: 'numeric' })
            .format(new Date()).replace(/[./\s]/g, '-');
    } catch (e) { return 'תאריך_לא_זמין'; }
}

// ---- generic modal / dropdown / switch helpers (design-system driven) ----
function openModal(id) {
    if (id === 'formatManagerModal') renderManagerList();
    else if (id === 'quantityManagerModal') renderQuantityManagerList();
    else if (id === 'contactsModal') renderContactsList();
    else if (id === 'styleManagerModal') { renderStyleList(); populateStyleSourceFile(); }
    const el = document.getElementById(id);
    if (el) el.classList.add('open');
}
function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
    if (typeof renderFiles === 'function') renderFiles();
    if (typeof updateStyleSelect === 'function') updateStyleSelect();
}

function toggleDropdown(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const wasOpen = el.classList.contains('open');
    document.querySelectorAll('.dropdown-wrap.open').forEach(d => d.classList.remove('open'));
    if (!wasOpen) el.classList.add('open');
}

function toggleSwitch(id, onChange) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('on');
    if (typeof onChange === 'function') onChange(el.classList.contains('on'));
}
function setSwitch(id, on) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('on', !!on);
}
function isSwitchOn(id) {
    const el = document.getElementById(id);
    return !!(el && el.classList.contains('on'));
}

// close dropdowns / multiselects when clicking outside
document.addEventListener('click', (event) => {
    if (!event.target.closest('.dropdown-wrap')) {
        document.querySelectorAll('.dropdown-wrap.open').forEach(d => d.classList.remove('open'));
    }
    if (!event.target.matches('.multiselect-btn') && !event.target.closest('.multiselect-btn') && !event.target.closest('.multiselect-content')) {
        document.querySelectorAll('.multiselect-content.show').forEach(d => d.classList.remove('show'));
    }
});
// גלילה: כל dropdown תלוי-מיקום (absolute) ייסגר בגלילת דף כדי למנוע "פס של העמוד שייך לתפריט"
// (התפריט היה זז עם הדף כי הוא absolute בתוך הכרטיס). גלילה בתוך הפאנל עצמו לא סוגרת.
window.addEventListener('scroll', (e) => {
    if (e.target && e.target.closest && e.target.closest('.dropdown-panel')) return;
    if (e.target && e.target.closest && e.target.closest('.multiselect-content')) return;
    document.querySelectorAll('.dropdown-wrap.open').forEach(d => d.classList.remove('open'));
    // multiselect מטופל גם ב-contacts.js עם אותו מנגנון, אבל סגירה כאן היא גיבוי
    document.querySelectorAll('.multiselect-content.show').forEach(d => d.classList.remove('show'));
}, true);
