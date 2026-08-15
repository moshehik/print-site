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
    generateAutoSubject();

    const mainEmailManual = document.getElementById('mainEmailManual');
    const secondaryEmailManual = document.getElementById('secondaryEmailManual');
    const lastMain = getSelectedMainEmailsRaw();
    const lastSecondary = getSelectedSecondaryEmailsRaw();
    if (mainEmailManual && lastMain.length) mainEmailManual.value = lastMain[lastMain.length - 1];
    if (secondaryEmailManual && lastSecondary.length) secondaryEmailManual.value = lastSecondary[lastSecondary.length - 1];

    renderFiles();
});
