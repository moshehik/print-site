/* ============================================================
   destinations.js — יעדי שליחה מרובים.
   במקום "ראשי + משני(⊕)": רשימת יעדים בעלי שם, כל יעד עם הנמענים
   שלו וצבע. היעד הראשון הוא ברירת המחדל - כל קובץ נשלח אליו אלא אם
   כן הוסר ממנו; לכל קובץ (או קבוצת מיזוג - כולם ביחד) אפשר לסמן כמה
   יעדים. בשליחה: מייל אחד לכל יעד עם הקבצים שלו בלבד. נשמר ב-
   localStorage ('sendDestinations'); נתוני ראשי/משני ישנים מומרים
   אוטומטית לשני יעדים בטעינה הראשונה.
   ============================================================ */

const DEST_KEY = 'sendDestinations';
const DEST_COLORS = ['primary', 'accent', 'success', 'info', 'warning', 'danger'];
const DEST_MAX = 6;

function loadDestinations() {
    let list = null;
    try { list = JSON.parse(localStorage.getItem(DEST_KEY) || 'null'); } catch (e) { list = null; }
    if (Array.isArray(list) && list.length) return list;
    // ---- הגירה חד-פעמית מהמודל הישן (ראשי + ⊕ משני) ----
    const main = JSON.parse(localStorage.getItem('selectedMainEmails') || '[]');
    const sec = JSON.parse(localStorage.getItem('selectedSecondaryEmails') || '[]');
    list = [{ id: 'd1', name: 'יעד ראשי', emails: main, color: 'primary' }];
    if (sec.length) list.push({ id: 'd2', name: 'יעד משני', emails: sec, color: 'accent' });
    saveDestinations(list);
    return list;
}
function saveDestinations(list) { localStorage.setItem(DEST_KEY, JSON.stringify(list)); }
function getDestinations() { return loadDestinations(); }
function getDestination(id) { return getDestinations().find(d => d.id === id) || null; }
function defaultDestId() { return getDestinations()[0].id; }

function addDestination(name) {
    const list = getDestinations();
    if (list.length >= DEST_MAX) { showError(`ניתן להגדיר עד ${DEST_MAX} יעדים.`); return null; }
    const used = new Set(list.map(d => d.color));
    const color = DEST_COLORS.find(c => !used.has(c)) || DEST_COLORS[list.length % DEST_COLORS.length];
    const id = 'd' + (Date.now().toString(36));
    list.push({ id, name: name || `יעד ${list.length + 1}`, emails: [], color });
    saveDestinations(list);
    return id;
}
function renameDestination(id, name) {
    const list = getDestinations(); const d = list.find(x => x.id === id); if (!d) return;
    d.name = name; saveDestinations(list);
}
function removeDestination(id) {
    const list = getDestinations();
    if (list.length <= 1) { showError('חייב להישאר לפחות יעד אחד.'); return false; }
    if (list[0].id === id) { showError('לא ניתן למחוק את יעד ברירת המחדל - הפוך קודם יעד אחר לברירת מחדל.'); return false; }
    saveDestinations(list.filter(d => d.id !== id));
    // הסרת היעד מכל הקבצים
    filesData.forEach(f => { f.dests = (f.dests || []).filter(x => x !== id); if (!f.dests.length) f.dests = [defaultDestId()]; });
    return true;
}
function setDefaultDestination(id) {
    const list = getDestinations(); const i = list.findIndex(d => d.id === id); if (i <= 0) return;
    const [d] = list.splice(i, 1); list.unshift(d); saveDestinations(list);
}
function setDestinationEmails(id, emails) {
    const list = getDestinations(); const d = list.find(x => x.id === id); if (!d) return;
    d.emails = emails; saveDestinations(list);
}

// ---- per-file ----
function fileDests(item) {
    if (!Array.isArray(item.dests) || !item.dests.length) item.dests = [defaultDestId()];
    return item.dests;
}
function fileHasDest(item, id) { return fileDests(item).includes(id); }
// מפעיל/מבטל יעד לקובץ; בקבוצת מיזוג - לכל הקבוצה (הקובץ הממוזג הוא יחידה אחת)
function toggleFileDest(fileId, destId) {
    const item = filesData.find(f => f.id === fileId); if (!item) return;
    const targets = item.group > 0 ? filesData.filter(f => f.group === item.group) : [item];
    const has = fileHasDest(item, destId);
    targets.forEach(f => {
        const cur = new Set(fileDests(f));
        if (has) cur.delete(destId); else cur.add(destId);
        if (!cur.size) cur.add(defaultDestId());   // קובץ חייב לפחות יעד אחד
        f.dests = [...cur];
        f.isModified = true;
    });
    renderFiles();
    if (typeof updateDestSummary === 'function') updateDestSummary();
}
// כשקובץ מצטרף לקבוצה - מקבל את יעדי הקבוצה (updateFileParam קורא לזה)
function syncDestsToGroup(item) {
    if (!item.group) return;
    const other = filesData.find(f => f.group === item.group && f.id !== item.id);
    if (other) item.dests = [...fileDests(other)];
}

// ---- תצוגה: נקודות צבע קטנות של היעדים (לתגים בכרטיס / לפס) ----
function destDotHtml(d, small) {
    return `<span class="dest-dot dest-${d.color}${small ? ' sm' : ''}" title="${escAttr(d.name)}"></span>`;
}
function fileDestBadgesHtml(item) {
    const list = getDestinations();
    return fileDests(item).map(id => list.find(d => d.id === id)).filter(Boolean)
        .map(d => `<span class="badge dest-badge dest-${d.color}" title="יעד: ${escAttr(d.name)}">${destDotHtml(d, true)}${escHtml(d.name)}</span>`).join('');
}

// ---- אווטארים עגולים של היעדים בשורת האייקונים של הכרטיס: לחיצה = כלול/בטל ----
// אות ראשונה; אם כמה יעדים מתחילים באותה אות - ראשי תיבות של שתי מילים
// ("יעד ראשי" -> "יר", "יעד משני" -> "ימ") כדי שהעיגולים יהיו שונים זה מזה
function destInitial(name, all) {
    const t = (name || '').trim();
    if (!t) return '?';
    const first = t.charAt(0);
    const clash = (all || []).filter(n => (n || '').trim().charAt(0) === first).length > 1;
    if (!clash) return first;
    const words = t.split(/\s+/).filter(Boolean);
    return words.length > 1 ? words[0].charAt(0) + words[1].charAt(0) : t.slice(0, 2);
}
function destAvatarsHtml(item) {
    const all = getDestinations().map(x => x.name);
    return getDestinations().map((d, i) => {
        const on = fileHasDest(item, d.id);
        const noRecip = !(d.emails || []).length;
        return `<button type="button" class="dest-avatar dest-${d.color}${on ? ' on' : ''}${noRecip ? ' empty' : ''}" onclick="toggleFileDest('${item.id}','${d.id}')" title="${escAttr(d.name)}${i === 0 ? ' (ברירת מחדל)' : ''}${noRecip ? ' — אין נמענים' : ''}: ${on ? 'נשלח' : 'לא נשלח'}">${escHtml(destInitial(d.name, all))}</button>`;
    }).join('');
}
