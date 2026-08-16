/* ============================================================
   send.js — the send pipeline: per-file/per-group PDF processing
   (delegated to window.PdfEngine, the shared PDF-math module),
   Drive upload + batched email sending via the Apps Script relay,
   the instructions .txt download, and full-send history.

   NOTE ON PdfEngine: every transform below is a thin wrapper that
   calls window.PdfEngine.<fn>() when present, and otherwise logs a
   warning + falls back to a safe local implementation (pdf-lib is
   already loaded site-wide) OR passes the bytes through unchanged
   for the purely-cosmetic transforms that have no simple fallback.
   This keeps the UI fully clickable/testable even before
   js/pdf-engine.js lands, and needs no code changes once it does
   (same function names are picked up automatically).
   ============================================================ */

function addLog(msg, type = 'info') {
    const log = document.getElementById('progressLog');
    if (!log) return;
    const div = document.createElement('div');
    div.className = `log-item log-${type}`;
    div.innerText = `[${new Date().toLocaleTimeString('he-IL', { hour12: false })}] ${msg}`;
    log.prepend(div);
}

// ---- מסילת השלבים בחלון ההתקדמות (הכנה / עיבוד / העלאה / שליחה) ----
const SEND_STEPS = ['prepare', 'process', 'upload', 'send'];
function setSendStep(current) {
    const idx = SEND_STEPS.indexOf(current);
    document.querySelectorAll('.send-steps .step').forEach((el) => {
        const i = SEND_STEPS.indexOf(el.dataset.step);
        el.classList.toggle('done', i < idx);
        el.classList.toggle('current', i === idx);
    });
}
function setSendState(state, title) { // 'running' | 'done' | 'error'
    document.getElementById('loaderSpinner').classList.toggle('hidden', state !== 'running');
    document.getElementById('loaderDoneIcon').classList.toggle('hidden', state !== 'done');
    document.getElementById('loaderErrIcon').classList.toggle('hidden', state !== 'error');
    document.getElementById('loaderCloseBtn').classList.toggle('hidden', state === 'running');
    document.getElementById('loaderTitle').innerText = title;
    const hint = document.getElementById('loaderHint');
    if (hint) hint.innerText = state === 'running' ? 'אנא המתן — אל תסגור את החלון'
        : (state === 'done' ? 'החלון ייסגר אוטומטית' : 'ניתן להעתיק את הלוג ולפנות לתמיכה');
    if (state === 'done') document.querySelectorAll('.send-steps .step').forEach((el) => { el.classList.add('done'); el.classList.remove('current'); });
}
document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('loaderCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', () => document.getElementById('loader').classList.remove('open'));
    const copyBtn = document.getElementById('loaderCopyBtn');
    if (copyBtn) copyBtn.addEventListener('click', (e) => {
        const lines = Array.from(document.getElementById('progressLog').children).map((el) => el.innerText).reverse();
        if (window.copyErrorText) window.copyErrorText(lines.join('\n'), e.currentTarget);
    });
});

async function callEngine(fnName, fallbackFn, ...args) {
    if (window.PdfEngine && typeof window.PdfEngine[fnName] === 'function') {
        try { return await window.PdfEngine[fnName](...args); }
        catch (e) { console.error(`PdfEngine.${fnName} failed, falling back:`, e); addLog(`שגיאה ב-${fnName}, ממשיך עם ברירת מחדל.`, 'warning'); }
    } else {
        console.warn(`PdfEngine.${fnName} is not available yet — using fallback / passthrough.`);
    }
    return fallbackFn ? await fallbackFn(...args) : args[0];
}

// ---- instructions .txt (downloaded automatically right before sending) ----
function createInstructionFile() {
    let content = currentFolderName + '\n';
    filesData.forEach(f => { content += f.fileObj.name + '\n'; });
    const blob = new Blob(['﻿' + content], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.download = 'הוראות_שליחה_' + getHebrewDateForFilename() + '.txt';
    link.click();
}

// ---- resolve which logo image bytes to hand to PdfEngine.addBrandingToPdf ----
async function resolveLogoBytes(logoVal) {
    if (!logoVal) return null;
    const num = logoVal === '2' ? 2 : 1;
    const base64 = getLogoBase64(num);
    if (!base64) return null;
    try { return new Uint8Array(await fetch(base64).then(r => r.arrayBuffer())); }
    catch (e) { console.error('Failed to resolve logo bytes', e); return null; }
}

// ---- builds the {bsdImageBytes, logoImageBytes} options object PdfEngine.addBrandingToPdf expects ----
async function brandingOptions(addBsd, addLogo) {
    const logoImageBytes = await resolveLogoBytes(addLogo);
    let bsdImageBytes = null;
    if (addBsd && window.PdfEngine && typeof window.PdfEngine.generateBsdWatermarkPng === 'function') {
        try { bsdImageBytes = await window.PdfEngine.generateBsdWatermarkPng(); }
        catch (e) { console.error('generateBsdWatermarkPng failed', e); }
    }
    return { bsdImageBytes, logoImageBytes };
}

// ---- per-file / per-merged-doc effect pipeline (mirrors the original's processPdfEffects order) ----
async function processPdfEffects(pdfBytes, item) {
    let bytes = pdfBytes;
    let { quantity, format, addPageNumbers, reverseLastPage, addArrows, addEvenBlankPage, duplicateTwoUp, multiUpMode, blurLogo } = item;
    let addBsd = item.addBsd, addLogo = item.addLogo, marginCut = item.marginCut;
    const newFormat = format;

    // auto-detect ~16:9 pages (slideshow-style exports) and default a logo on if none chosen
    if (!addLogo) {
        try {
            const tempDoc = await PDFLib.PDFDocument.load(bytes);
            for (const page of tempDoc.getPages()) {
                const { width, height } = page.getSize();
                const ratio = Math.max(width, height) / Math.min(width, height);
                if (ratio > 1.65 && ratio < 1.9) {
                    let def = localStorage.getItem('defaultLogo');
                    addLogo = (def === '2') ? '2' : '1';
                    break;
                }
            }
        } catch (e) { console.error('Ratio detect error:', e); }
    }

    // early margin-cut when a multi-up layout is requested (must happen before N-up shrinks the page)
    if (marginCut && multiUpMode) {
        bytes = await callEngine('addMarginCutToPdf', null, bytes);
        marginCut = false;
    }

    // early branding when multi-up/duplicate-2-up will shrink the page afterwards
    if ((multiUpMode || duplicateTwoUp) && (addBsd || addLogo)) {
        bytes = await callEngine('addBrandingToPdf', null, bytes, await brandingOptions(addBsd, addLogo));
        addBsd = false; addLogo = '';
    }

    if (blurLogo) {
        try { bytes = await applyLogoBlurToPdf(bytes); }
        catch (e) { console.error('Logo blur error:', e); addLog('שגיאה בטשטוש הלוגו, ממשיך ללא טשטוש.', 'error'); }
    }

    // normalize to A4
    bytes = await callEngine('resizePdfToA4', null, bytes);

    // rotate pages for landscape booklets
    if (format && format.includes('חוברת')) {
        bytes = await callEngine('applyBookletRotation', null, bytes);
    }

    if (addEvenBlankPage) {
        bytes = await callEngine('addEvenBlankPagesToPdf', null, bytes);
    }

    if (duplicateTwoUp) {
        bytes = await callEngine('createDuplicateTwoUp', null, bytes);
    } else if (multiUpMode || (format && (/4 בעמוד|6 בעמוד|8 בעמוד|9 בעמוד/.test(format) || addArrows))) {
        let n = 0, duplicatePages = false;
        if (multiUpMode) { duplicatePages = multiUpMode.includes('_dup'); n = parseInt(multiUpMode.replace('_dup', ''), 10); }
        else if (format.includes('9 בעמוד')) n = 9;
        else if (format.includes('8 בעמוד')) n = 8;
        else if (format.includes('6 בעמוד')) n = 6;
        else if (format.includes('4 בעמוד')) n = 4;
        else if (addArrows) n = 9;
        if (n > 0) {
            bytes = await callEngine('createNUpPdf', null, bytes, n, { addGridNumbers: addPageNumbers, addArrows, duplicatePages });
        }
    }

    if (marginCut) {
        bytes = await callEngine('addMarginCutToPdf', null, bytes);
    }

    if (addBsd || addLogo) {
        bytes = await callEngine('addBrandingToPdf', null, bytes, await brandingOptions(addBsd, addLogo));
    }

    return { bytes, newFormat };
}

// ---- convert / filter helpers used before processPdfEffects ----
async function filterPdfPagesLocal(pdfBytes, pageSelection) {
    if (!pageSelection || !pageSelection.trim()) return pdfBytes;
    try {
        const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
        const totalPages = pdfDoc.getPageCount();
        const keep = new Set();
        pageSelection.split(',').forEach(part => {
            part = part.trim();
            if (part.includes('-')) {
                let [s, e] = part.split('-').map(n => parseInt(n, 10));
                if (!isNaN(s) && !isNaN(e)) { s = Math.max(1, Math.min(s, e)); e = Math.min(totalPages, Math.max(s, e)); for (let i = s; i <= e; i++) keep.add(i - 1); }
            } else {
                const n = parseInt(part, 10);
                if (!isNaN(n) && n >= 1 && n <= totalPages) keep.add(n - 1);
            }
        });
        if (keep.size === 0 || keep.size === totalPages) return pdfBytes;
        const newDoc = await PDFLib.PDFDocument.create();
        const sorted = Array.from(keep).sort((a, b) => a - b);
        const copied = await newDoc.copyPages(pdfDoc, sorted);
        copied.forEach(p => newDoc.addPage(p));
        return await newDoc.save();
    } catch (e) { console.error('Error filtering PDF pages:', e); return pdfBytes; }
}
async function convertImageToPdfLocal(imageBytes) {
    const pdfDoc = await PDFLib.PDFDocument.create();
    let image;
    try { image = await pdfDoc.embedJpg(imageBytes); }
    catch (e) { image = await pdfDoc.embedPng(imageBytes); }
    const A4_LONG = 841.89, A4_SHORT = 595.28;
    const isLandscape = image.width > image.height;
    const pageWidth = isLandscape ? A4_LONG : A4_SHORT, pageHeight = isLandscape ? A4_SHORT : A4_LONG;
    const scale = Math.min(pageWidth / image.width, pageHeight / image.height);
    const w = image.width * scale, h = image.height * scale;
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    page.drawImage(image, { x: (pageWidth - w) / 2, y: (pageHeight - h) / 2, width: w, height: h });
    return await pdfDoc.save();
}

async function convertWordToPdfServerSide(fileObj) {
    try {
        const arrayBuffer = await fileObj.arrayBuffer();
        const base64Data = uint8ArrayToBase64(new Uint8Array(arrayBuffer));
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'convert_one', fileName: fileObj.name, mimeType: fileObj.type, fileData: base64Data })
        }).then(r => r.json());
        if (res.status === 'success' && res.data && res.data.data) return base64ToUint8Array(res.data.data).buffer;
        throw new Error(res.message || 'המרת וורד נכשלה בשרת');
    } catch (e) { console.error('Word conversion error:', e); throw new Error(`שגיאה בהמרת ${fileObj.name}: ` + e.message); }
}

async function getFileAsPdfBytes(item) {
    let bytes;
    if (item.ext === 'pdf') {
        bytes = await item.fileObj.arrayBuffer();
    } else if (item.canConvert) {
        if (item.fileObj.type.startsWith('image/') || ['jpg', 'jpeg', 'png'].includes(item.ext)) {
            const imgBytes = await item.fileObj.arrayBuffer();
            bytes = await callEngine('convertImageToPdfClientSide', convertImageToPdfLocal, imgBytes);
        } else if (item.fileObj.type.includes('word') || ['docx', 'doc'].includes(item.ext)) {
            bytes = await convertWordToPdfServerSide(item.fileObj);
        } else {
            bytes = await item.fileObj.arrayBuffer();
        }
    } else {
        bytes = await item.fileObj.arrayBuffer();
    }
    if (item.pageSelection && item.pageSelection.trim() !== '') {
        bytes = await callEngine('filterPdfPages', filterPdfPagesLocal, bytes, item.pageSelection);
    }
    return bytes;
}

// ---- customPageOrders/pagesorter entries are keyed by fileId; PdfEngine wants
// positional fileIndex into the exact fileBytesList passed alongside. Converts. ----
function convertFileIdOrderToIndexOrder(customOrder, orderedFileItems) {
    if (!customOrder) return null;
    const idToIndex = {};
    orderedFileItems.forEach((item, idx) => { idToIndex[item.id] = idx; });
    return customOrder
        .map(p => {
            if (p.type === 'blank') return { type: 'blank' };
            const fileIndex = idToIndex[p.fileId];
            return fileIndex === undefined ? null : { type: 'page', fileIndex, pageIndex: p.pageIndex };
        })
        .filter(Boolean);
}

// ---- merge-group assembly (plain sequential order, or the user's saved custom order) ----
async function mergeGroupToPdf(sortedFilesInGroup, customOrder) {
    if (window.PdfEngine && typeof window.PdfEngine.mergeWithOrder === 'function') {
        try {
            const fileBytesList = [];
            for (const item of sortedFilesInGroup) fileBytesList.push(await getFileAsPdfBytes(item));
            const indexOrder = convertFileIdOrderToIndexOrder(customOrder, sortedFilesInGroup);
            return await window.PdfEngine.mergeWithOrder(fileBytesList, indexOrder);
        } catch (e) { console.error('PdfEngine.mergeWithOrder failed, falling back:', e); addLog('שגיאה במיזוג דרך PdfEngine, ממשיך עם מיזוג מקומי.', 'warning'); }
    } else {
        console.warn('PdfEngine.mergeWithOrder is not available yet — using local pdf-lib fallback.');
    }

    const mergedPdf = await PDFLib.PDFDocument.create();
    if (customOrder && customOrder.length > 0) {
        const loadedDocs = {};
        for (const p of customOrder) {
            if (p.type !== 'page') continue;
            if (!loadedDocs[p.fileId]) {
                const fileItem = filesData.find(f => f.id === p.fileId);
                if (fileItem) loadedDocs[p.fileId] = await PDFLib.PDFDocument.load(await getFileAsPdfBytes(fileItem));
            }
        }
        let lastSize = { width: 595.28, height: 841.89 };
        for (const p of customOrder) {
            if (p.type === 'blank') { mergedPdf.addPage([lastSize.width, lastSize.height]); continue; }
            const srcDoc = loadedDocs[p.fileId];
            if (srcDoc && p.pageIndex < srcDoc.getPageCount()) {
                const [copied] = await mergedPdf.copyPages(srcDoc, [p.pageIndex]);
                lastSize = copied.getSize();
                mergedPdf.addPage(copied);
            }
        }
    } else {
        for (const item of sortedFilesInGroup) {
            try {
                const bytes = await getFileAsPdfBytes(item);
                const doc = await PDFLib.PDFDocument.load(bytes);
                const copied = await mergedPdf.copyPages(doc, doc.getPageIndices());
                copied.forEach(p => mergedPdf.addPage(p));
            } catch (e) { addLog(`שגיאה במיזוג ${item.fileObj.name}: ${e.message}`, 'error'); }
        }
    }
    return await mergedPdf.save();
}

// ---- Drive upload / email relay (Apps Script) ----
async function uploadToDriveServer(fileMeta, fileDataBase64) {
    const res = await fetch(SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'upload_drive', fileName: fileMeta.name, mimeType: fileMeta.mimeType || 'application/pdf', fileData: fileDataBase64 })
    }).then(r => r.json());
    if (res.status === 'success') return res.data.url;
    throw new Error('העלאה נכשלה');
}

function buildEmailBody(files, driveLinks, subject) {
    const tableStyle = 'border-collapse: collapse; width: 100%; border: 1px solid #ddd; font-family: sans-serif;';
    const thStyle = 'background-color: #f2f2f2; border: 1px solid #ddd; padding: 12px; text-align: right; color: #333;';
    const tdStyle = 'border: 1px solid #ddd; padding: 12px; text-align: right; color: #555;';
    let html = `<div dir="rtl" style="font-family: sans-serif; color: #333;"><h2 style="color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px;">${subject}</h2>`;
    if (driveLinks && driveLinks.length > 0) {
        html += `<h3 style="color: #1f9d55;">📂 קבצים גדולים:</h3><table style="${tableStyle}"><thead><tr style="background-color: #dcfce7;"><th style="${thStyle}">שם</th><th style="${thStyle}">כמות</th><th style="${thStyle}">פורמט</th><th style="${thStyle}">קישור</th></tr></thead><tbody>`;
        driveLinks.forEach(f => { html += `<tr><td style="${tdStyle}"><b>${f.name}</b></td><td style="${tdStyle}">${f.quantity}</td><td style="${tdStyle}">${f.format}</td><td style="${tdStyle}"><a href="${f.url}">הורד</a></td></tr>`; });
        html += `</tbody></table><br>`;
    }
    if (files && files.length > 0) {
        html += `<h3 style="color: #333;">📎 קבצים מצורפים:</h3><table style="${tableStyle}"><thead><tr style="background-color: #e0f2fe;"><th style="${thStyle}">שם</th><th style="${thStyle}">כמות</th><th style="${thStyle}">פורמט</th><th style="${thStyle}">הערות</th></tr></thead><tbody>`;
        files.forEach((f, idx) => { html += `<tr style="background-color: ${idx % 2 ? '#f8fafc' : '#fff'};"><td style="${tdStyle}"><b>${f.name}</b></td><td style="${tdStyle}">${f.quantity}</td><td style="${tdStyle}">${f.format}</td><td style="${tdStyle}">${f.note || '-'}</td></tr>`; });
        html += `</tbody></table>`;
    }
    // Machine-readable block — parsed verbatim by the print-side relay. DO NOT change this shape.
    html += `<div style="display:none;">---START_SYSTEM_DATA---\n`;
    if (driveLinks) driveLinks.forEach(f => { html += `[DRIVE]${f.name}|${f.url}|${f.quantity}|${f.format}|${f.note}[/DRIVE]\n`; });
    if (files) files.forEach(f => { html += `[FILE]${f.name}|${f.quantity}|${f.format}|${f.note}[/FILE]\n`; });
    html += `---END_SYSTEM_DATA---</div></div>`;
    return html;
}

async function sendBatch(email, subject, files, driveLinks) {
    const content = buildEmailBody(files, driveLinks, subject);
    const res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'email', email, subject, content, files }) }).then(r => r.json());
    if (res.status !== 'success') throw new Error(res.message);
}
async function sendFilesToEmail(targetEmail, subject, { filesToEmail, driveLinks }) {
    let currentBatch = [], currentBatchSize = 0, batchIndex = 1;
    const flush = async (isFirstBatch) => {
        const subTitle = batchIndex > 1 ? ` (חלק ${batchIndex})` : '';
        await sendBatch(targetEmail, subject + subTitle, currentBatch, isFirstBatch ? driveLinks : []);
        batchIndex++;
    };
    for (const file of filesToEmail) {
        const fileSize = file.data.length * 0.75;
        if (currentBatch.length > 0 && (currentBatchSize + fileSize) > MAX_BATCH_SIZE_MB * 1024 * 1024) {
            await flush(batchIndex === 1);
            currentBatch = []; currentBatchSize = 0;
        }
        currentBatch.push(file); currentBatchSize += fileSize;
    }
    if (currentBatch.length > 0 || (filesToEmail.length === 0 && driveLinks.length > 0)) await flush(batchIndex === 1);
}

// ---- the main pipeline ----
async function processAndSend() {
    const loader = document.getElementById('loader');
    let sendFailed = false;
    loader.classList.add('open');
    document.getElementById('progressLog').innerHTML = '';
    setSendState('running', 'מתחיל עיבוד...');
    setSendStep('prepare');

    try {
        if ('wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); addLog('מצב ערות מסך הופעל.', 'info'); }
    } catch (e) { console.warn('Failed to get wake lock:', e); }

    try {
        addLog('מתחיל תהליך שליחה...', 'info');
        createInstructionFile();

        const mainEmailsRaw = getSelectedMainEmails();
        const secondaryEmailsRaw = getSelectedSecondaryEmails();
        if (mainEmailsRaw.length === 0) throw new Error('לא נבחרו נמענים ראשיים.');

        const subject = document.getElementById('subject').value || 'קבצים להדפסה';
        const mainRecipients = mainEmailsRaw.map(extractEmail).filter(Boolean);
        const secondaryRecipients = secondaryEmailsRaw.map(extractEmail).filter(Boolean);

        const fileGroups = {};
        filesData.forEach(item => {
            const key = item.group || `file_${item.id}`;
            (fileGroups[key] = fileGroups[key] || []).push(item);
        });

        const primaryAttachments = [], primaryDriveLinks = [], secondaryAttachments = [], secondaryDriveLinks = [];
        setSendStep('process');
        setSendState('running', 'מעבד קבצים...');

        for (const groupKey of Object.keys(fileGroups).sort()) {
            const filesInGroup = fileGroups[groupKey];
            const isMergeGroup = filesInGroup[0].group > 0;
            let finalBytes, fileName, itemMeta, fileMimeType, newFormat;

            if (isMergeGroup) {
                addLog(`מעבד קבוצה ${groupKey}...`, 'info');
                const sortedFilesInGroup = filesInGroup.sort((a, b) => filesData.indexOf(a) - filesData.indexOf(b));
                itemMeta = sortedFilesInGroup[0];
                const customOrder = customPageOrders[groupKey];
                finalBytes = await mergeGroupToPdf(sortedFilesInGroup, customOrder);
                const mergedNames = sortedFilesInGroup.map(f => f.fileObj.name.replace(/\.[^/.]+$/, '')).slice(0, 2).join('_');
                fileName = `שילוב_קבוצה_${groupKey}_-_${mergedNames}.pdf`;
                fileMimeType = 'application/pdf';
            } else {
                const item = filesInGroup[0];
                itemMeta = item;
                addLog(`מעבד את ${item.fileObj.name}...`, 'info');
                let fileBytes = await item.fileObj.arrayBuffer();
                fileName = item.fileObj.name;
                fileMimeType = item.fileObj.type;
                if ((item.convertToPdf && item.ext !== 'pdf') || (item.pageSelection && item.pageSelection.trim() !== '')) {
                    fileBytes = await getFileAsPdfBytes(item);
                    if (item.ext !== 'pdf') fileName = fileName.replace(/\.[^/.]+$/, '.pdf');
                    fileMimeType = 'application/pdf';
                }
                finalBytes = fileBytes;
            }

            const res = await processPdfEffects(finalBytes, itemMeta);
            finalBytes = res.bytes; newFormat = res.newFormat;

            const finalSizeMB = finalBytes.byteLength / (1024 * 1024);
            const base64Data = uint8ArrayToBase64(new Uint8Array(finalBytes));
            const isPlusFile = itemMeta.isPlusSelected;

            if (isPlusFile) {
                if (secondaryRecipients.length > 0) {
                    (finalSizeMB > DRIVE_THRESHOLD_MB ? secondaryDriveLinks : secondaryAttachments).push(
                        finalSizeMB > DRIVE_THRESHOLD_MB
                            ? { name: fileName, url: null, base64Data, mimeType: fileMimeType, quantity: itemMeta.quantity, format: newFormat, note: itemMeta.note }
                            : { name: fileName, data: base64Data, mimeType: fileMimeType, quantity: itemMeta.quantity, format: newFormat, note: itemMeta.note }
                    );
                }
                (finalSizeMB > DRIVE_THRESHOLD_MB ? primaryDriveLinks : primaryAttachments).push(
                    finalSizeMB > DRIVE_THRESHOLD_MB
                        ? { name: fileName, url: null, base64Data, mimeType: fileMimeType, quantity: itemMeta.quantity, format: newFormat, note: itemMeta.note }
                        : { name: fileName, data: base64Data, mimeType: fileMimeType, quantity: itemMeta.quantity, format: newFormat, note: itemMeta.note }
                );
            } else {
                (finalSizeMB > DRIVE_THRESHOLD_MB ? primaryDriveLinks : primaryAttachments).push(
                    finalSizeMB > DRIVE_THRESHOLD_MB
                        ? { name: fileName, url: null, base64Data, mimeType: fileMimeType, quantity: itemMeta.quantity, format: newFormat, note: itemMeta.note }
                        : { name: fileName, data: base64Data, mimeType: fileMimeType, quantity: itemMeta.quantity, format: newFormat, note: itemMeta.note }
                );
            }
        }

        for (const link of [...primaryDriveLinks, ...secondaryDriveLinks]) {
            if (!link.url) {
                setSendStep('upload'); setSendState('running', 'מעלה לדרייב...');
                addLog(`מעלה ${link.name} לדרייב...`, 'info');
                link.url = await uploadToDriveServer({ name: link.name, mimeType: link.mimeType }, link.base64Data);
                addLog(`${link.name} הועלה בהצלחה!`, 'drive');
                delete link.base64Data;
            }
        }

        if (mainRecipients.length > 0 && (primaryAttachments.length > 0 || primaryDriveLinks.length > 0)) {
            setSendStep('send'); setSendState('running', 'שולח...');
            addLog(`שולח מייל ראשי ל: ${mainRecipients.join(', ')}`, 'info');
            await sendFilesToEmail(mainRecipients.join(','), subject, { filesToEmail: primaryAttachments, driveLinks: primaryDriveLinks });
            addLog('מייל ראשי נשלח!', 'success');
        } else {
            addLog('אין קבצים לשליחה לנמענים הראשיים.', 'info');
        }

        if (mainRecipients.length > 0 && secondaryRecipients.length > 0) await new Promise(r => setTimeout(r, 3000));

        if (secondaryRecipients.length > 0 && (secondaryAttachments.length > 0 || secondaryDriveLinks.length > 0)) {
            addLog(`שולח מייל משני ל: ${secondaryRecipients.join(', ')}`, 'info');
            await sendFilesToEmail(secondaryRecipients.join(','), `(+) ${subject}`, { filesToEmail: secondaryAttachments, driveLinks: secondaryDriveLinks });
            addLog('מייל משני נשלח!', 'success');
        }

        mainEmailsRaw.forEach(saveEmailToHistory);
        secondaryEmailsRaw.forEach(saveEmailToHistory);
        if (wakeLock) wakeLock.release().then(() => { wakeLock = null; });

        addLog('הכל נשלח בהצלחה!', 'success');
        setSendState('done', 'השליחה הסתיימה בהצלחה!');

        try {
            const logs = Array.from(document.getElementById('progressLog').children).map(el => el.innerText);
            const allFiles = [...primaryAttachments, ...primaryDriveLinks, ...secondaryAttachments, ...secondaryDriveLinks];
            const uniqueFilesMap = new Map();
            allFiles.forEach(f => uniqueFilesMap.set(f.name, f));
            const sendData = {
                subject, mainRecipients, secondaryRecipients,
                files: Array.from(uniqueFilesMap.values()).map(f => ({ name: f.name, quantity: f.quantity, format: f.format })),
                logs
            };
            saveFullSendToHistory(sendData);
            await writeLogFile(sendData);
        } catch (e) { console.error('Error saving history/log:', e); }

    } catch (err) {
        console.error('Send process failed:', err);
        addLog(`שגיאה קריטית: ${err.message}`, 'error');
        setSendState('error', 'השליחה נכשלה');
        sendFailed = true;
    } finally {
        // הצלחה - נסגר לבד; שגיאה - נשאר פתוח כדי שאפשר לקרוא/להעתיק את הלוג
        if (!sendFailed) setTimeout(() => { loader.classList.remove('open'); }, 5000);
    }
}

// ---- optional local log files via the File System Access API ----
function openLogDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('LogSystemDB', 1);
        request.onupgradeneeded = (e) => e.target.result.createObjectStore('logDir');
        request.onsuccess = () => {
            const db = request.result;
            resolve({
                get: (store, key) => new Promise((res, rej) => { const r = db.transaction(store, 'readonly').objectStore(store).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
                put: (store, key, val) => new Promise((res, rej) => { const r = db.transaction(store, 'readwrite').objectStore(store).put(val, key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })
            });
        };
        request.onerror = () => reject(request.error);
    });
}
async function verifyPermission(fileHandle, readWrite) {
    const options = readWrite ? { mode: 'readwrite' } : {};
    if ((await fileHandle.queryPermission(options)) === 'granted') return true;
    if ((await fileHandle.requestPermission(options)) === 'granted') return true;
    return false;
}
async function initLogDirectory() {
    if (!window.showDirectoryPicker) return;
    try {
        const db = await openLogDb();
        const handle = await db.get('logDir', 'handle');
        if (handle) logDirectoryHandle = handle;
    } catch (e) { console.error('Error init log dir:', e); }
}
async function requestLogDirectoryAccess() {
    if (!window.showDirectoryPicker) { showError('הדפדפן שלך אינו תומך בשמירת קבצים לתיקייה מקומית בצורה זו.'); return; }
    try {
        logDirectoryHandle = await window.showDirectoryPicker();
        const db = await openLogDb();
        await db.put('logDir', 'handle', logDirectoryHandle);
        showError('תיקיית הלוגים הוגדרה בהצלחה!');
    } catch (err) {
        if (err.name !== 'AbortError') { console.error(err); showError('שגיאה: ' + err.message); }
    }
}
async function writeLogFile(sendData) {
    if (!logDirectoryHandle) return;
    try {
        if (!(await verifyPermission(logDirectoryHandle, true))) return;
        const date = new Date();
        const filename = `send_log_${date.toISOString().replace(/[:.]/g, '-')}.txt`;
        const fileHandle = await logDirectoryHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        const logContent = `--- פרטי שליחה ---\nתאריך ושעה: ${date.toLocaleString('he-IL')}\nנושא: ${sendData.subject}\n\n[נמענים ראשיים]\n${sendData.mainRecipients.length ? sendData.mainRecipients.join(', ') : 'אין'}\n\n[נמענים משניים]\n${sendData.secondaryRecipients.length ? sendData.secondaryRecipients.join(', ') : 'אין'}\n\n[קבצים]\n${sendData.files.map(f => `- ${f.name} (כמות: ${f.quantity}) [פורמט: ${f.format}]`).join('\n')}\n\n[סטטוס הודעות]\n${sendData.logs.join('\n')}\n--------------------\n`;
        await writable.write(logContent);
        await writable.close();
    } catch (e) { console.error('Failed to write log file:', e); }
}
