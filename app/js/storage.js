/* ============================================================
   storage.js — all localStorage-backed persistence: formats,
   quantities, contacts, sending styles, branding defaults, logos,
   selected recipients, email history, full send history.
   ============================================================ */

// ---- formats ----
function initFormatStorage() {
    let stored = localStorage.getItem('customFormats');
    if (!stored) {
        const defaults = [
            { name: 'רגיל', autoReverse: false },
            { name: 'צבעוני לא דו״צ', autoReverse: false },
            { name: 'חוברת A5', autoReverse: true },
            { name: 'חוברת A5 לרוחב', autoReverse: true },
            { name: 'חוברת A3', autoReverse: true },
            { name: '4 בעמוד', autoReverse: false },
            { name: '6 בעמוד', autoReverse: false },
            { name: '8 בעמוד', autoReverse: false },
            { name: '9 בעמוד', autoReverse: false }
        ];
        localStorage.setItem('customFormats', JSON.stringify(defaults));
    } else {
        try {
            const parsed = JSON.parse(stored);
            if (parsed.length > 0 && typeof parsed[0] === 'string') {
                const migrated = parsed.map(s => ({ name: s, autoReverse: (s.includes('חוברת') && !s.includes('ללא')) }));
                localStorage.setItem('customFormats', JSON.stringify(migrated));
            }
        } catch (e) { localStorage.setItem('customFormats', '[]'); }
    }
}
function getStoredFormats() { return JSON.parse(localStorage.getItem('customFormats') || '[]'); }
function saveFormatsToStorage(list) { localStorage.setItem('customFormats', JSON.stringify(list)); }
function getFormatOptionsHTML(selectedFormat) {
    let formats = getStoredFormats();
    if (selectedFormat && !formats.find(f => f.name === selectedFormat)) formats.push({ name: selectedFormat, autoReverse: false });
    return formats.map(f => `<option value="${escAttr(f.name)}" ${f.name === selectedFormat ? 'selected' : ''}>${escHtml(f.name)}</option>`).join('');
}

// ---- quantities ----
function initQuantityStorage() {
    if (!localStorage.getItem('customQuantities')) {
        localStorage.setItem('customQuantities', JSON.stringify(['לכולם', '1', '2', '4', '8', '10', '25', '50']));
    }
}
function getStoredQuantities() { return JSON.parse(localStorage.getItem('customQuantities') || '[]'); }
function saveQuantitiesToStorage(list) { localStorage.setItem('customQuantities', JSON.stringify(list)); }
function getQuantityOptionsHTML(selected) {
    let list = getStoredQuantities();
    if (selected && !list.includes(selected)) list.push(selected);
    return list.map(q => `<option value="${escAttr(q)}" ${q === selected ? 'selected' : ''}>${escHtml(q)}</option>`).join('');
}

// ---- contacts ----
function initContacts() {
    if (!localStorage.getItem('savedContacts')) localStorage.setItem('savedContacts', '[]');
}
function getSavedContacts() { return JSON.parse(localStorage.getItem('savedContacts') || '[]'); }
function saveContactsToStorage(list) { localStorage.setItem('savedContacts', JSON.stringify(list)); }

// ---- sending styles ----
function getStoredStyles() { return JSON.parse(localStorage.getItem('sendingStyles') || '[]'); }
function saveStylesToStorage(arr) { localStorage.setItem('sendingStyles', JSON.stringify(arr)); }

function getDefaultStyleFromBranding() {
    const defBsd = localStorage.getItem('defaultBsd') !== 'false';
    let defLogo = localStorage.getItem('defaultLogo') || '';
    if (defLogo === 'true') defLogo = '1';
    if (defLogo === 'false') defLogo = '';
    return {
        quantity: 'לכולם', format: 'רגיל', convertToPdf: true, addPageNumbers: false, addArrows: false,
        addBsd: defBsd, addLogo: defLogo, reverseLastPage: false, duplicateTwoUp: false, addEvenBlankPage: false,
        compressPdf: false, splitFile: false, sendSecondary: false, secondaryEmail: '', isPlusSelected: false,
        marginCut: false, multiUpMode: ''
    };
}

// ---- branding defaults / logos ----
function getBrandingDefaults() {
    return {
        bsd: localStorage.getItem('defaultBsd') !== 'false',
        logo: (() => { let l = localStorage.getItem('defaultLogo') || ''; if (l === 'true') l = '1'; if (l === 'false') l = ''; return l; })()
    };
}
function getLogoBase64(n) {
    let b = localStorage.getItem('userLogo' + n + 'Base64');
    if (n === 1 && !b) b = localStorage.getItem('userLogoBase64');
    return b;
}

// ---- selected recipients ----

// ---- email history (simple recent-email list, used for autocomplete) ----
function saveEmailToHistory(email) {
    localStorage.setItem('lastUsedEmail', email);
    let history = JSON.parse(localStorage.getItem('emailHistory') || '[]');
    if (!history.includes(email)) {
        history.unshift(email);
        if (history.length > 10) history.pop();
        localStorage.setItem('emailHistory', JSON.stringify(history));
    }
}

// ---- full send history (consumed by ../history.html) ----
function saveFullSendToHistory(sendData) {
    let history = JSON.parse(localStorage.getItem('fullSendHistory') || '[]');
    history.unshift({
        date: new Date().toISOString(),
        subject: sendData.subject,
        mainRecipients: sendData.mainRecipients,
        secondaryRecipients: sendData.secondaryRecipients,
        destinations: sendData.destinations || [],   // [{id,name,recipients,fileCount}]
        files: sendData.files,                        // [{name,quantity,format,dests:[names]}]
        logs: sendData.logs || []                     // מוצג בטאב "לוגים" בהיסטוריה
    });
    if (history.length > 100) history.pop();
    localStorage.setItem('fullSendHistory', JSON.stringify(history));
}
