/* ============================================================
   cropblur.js — "hide logo" feature: the rubber-band crop UI that
   picks a template region out of an uploaded PDF page, global/
   per-file blur toggles, and the rasterize -> LogoBlur.processPdfPages
   -> re-embed pipeline used at send time. All OpenCV/geometry/pixel
   work itself lives in ../../js/logo-blur.js (window.LogoBlur); this
   file owns only the UI wiring + pdf.js rasterization + pdf-lib
   re-embedding, exactly as that module's own docstring specifies.
   ============================================================ */

let cropState = { canvas: null, overlay: null, dragging: false, startX: 0, startY: 0, rect: null };

function initCropModal() {
    const openBtn = document.getElementById('openCropBtn');
    const cancelBtn = document.getElementById('cancelCropBtn');
    const closeBtn = document.getElementById('closeModalBtn');
    const confirmBtn = document.getElementById('confirmCropBtn');
    if (openBtn) openBtn.addEventListener('click', openCropTool);
    if (cancelBtn) cancelBtn.addEventListener('click', () => closeModal('cropModal'));
    if (closeBtn) closeBtn.addEventListener('click', () => closeModal('cropModal'));
    if (confirmBtn) confirmBtn.addEventListener('click', confirmCrop);

    // restore persisted blur option UI
    const effect = localStorage.getItem('blurEffect') || 'blur';
    const method = localStorage.getItem('blurMethod') || 'pattern';
    document.querySelectorAll('#blurEffectOptions input[name="blurType"]').forEach(r => { r.checked = r.value === effect; r.closest('.option-item').classList.toggle('checked', r.checked); r.addEventListener('change', onBlurOptionChange); });
    document.querySelectorAll('#blurMethodOptions input[name="blurMethod"]').forEach(r => { r.checked = r.value === method; r.closest('.option-item').classList.toggle('checked', r.checked); r.addEventListener('change', onBlurOptionChange); });
    const offX = document.getElementById('blurOffsetX'), offY = document.getElementById('blurOffsetY');
    if (offX) { offX.value = localStorage.getItem('blurOffsetX') || 0; offX.addEventListener('change', () => localStorage.setItem('blurOffsetX', offX.value)); }
    if (offY) { offY.value = localStorage.getItem('blurOffsetY') || 0; offY.addEventListener('change', () => localStorage.setItem('blurOffsetY', offY.value)); }

    loadCropPreview();
}
function onBlurOptionChange(e) {
    const group = e.target.name === 'blurType' ? 'blurEffectOptions' : 'blurMethodOptions';
    document.querySelectorAll(`#${group} .option-item`).forEach(o => o.classList.remove('checked'));
    e.target.closest('.option-item').classList.add('checked');
    localStorage.setItem(e.target.name === 'blurType' ? 'blurEffect' : 'blurMethod', e.target.value);
}
function getBlurOptions() {
    return {
        mode: localStorage.getItem('blurMethod') || 'pattern',
        effect: localStorage.getItem('blurEffect') || 'blur',
        offsetMmX: parseFloat(localStorage.getItem('blurOffsetX') || '0') || 0,
        offsetMmY: parseFloat(localStorage.getItem('blurOffsetY') || '0') || 0,
        renderScale: (window.LogoBlur && window.LogoBlur.DEFAULT_RENDER_SCALE) || 1.5
    };
}

function toggleGlobalBlur() {
    const on = !isSwitchOn('defaultBlurToggle');
    setSwitch('defaultBlurToggle', on);
    localStorage.setItem('defaultBlur', on);
}
function toggleBlurLogo(id) {
    const item = filesData.find(f => f.id === id);
    if (!item) return;
    item.blurLogo = !item.blurLogo;
    item.isModified = true;
    renderFiles();
}

async function loadCropPreview() {
    if (!window.LogoBlur) return;
    const container = document.getElementById('logoPreviewContainerCrop');
    const img = document.getElementById('logoPreviewCrop');
    if (window.LogoBlur.hasSavedTemplate()) {
        try {
            const t = await window.LogoBlur.loadTemplateImage();
            if (t) { img.src = t.image.src; container.classList.remove('hidden'); return; }
        } catch (e) { console.warn(e); }
    }
    container.classList.add('hidden');
}
function clearCropLogo() {
    if (window.LogoBlur) window.LogoBlur.clearSavedTemplate();
    document.getElementById('logoPreviewContainerCrop').classList.add('hidden');
}

async function openCropTool() {
    const pdfItem = filesData.find(f => f.ext === 'pdf');
    if (!pdfItem) { alert('העלה קודם לפחות קובץ PDF אחד כדי לבחור ממנו את אזור הלוגו.'); return; }
    openModalRaw('cropModal');
    const wrapper = document.getElementById('cropCanvasWrapper');
    const loader = document.getElementById('cropLoader');
    wrapper.classList.add('hidden');
    loader.classList.remove('hidden');
    try {
        const bytes = await pdfItem.fileObj.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        const page = await pdf.getPage(1);
        const scale = (window.LogoBlur && window.LogoBlur.DEFAULT_RENDER_SCALE) || 1.5;
        const viewport = page.getViewport({ scale });
        const canvas = document.getElementById('cropCanvas');
        const overlay = document.getElementById('cropOverlay');
        canvas.width = overlay.width = viewport.width;
        canvas.height = overlay.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        cropState.canvas = canvas; cropState.overlay = overlay; cropState.rect = null;
        wireCropDrag(overlay);
        loader.classList.add('hidden');
        wrapper.classList.remove('hidden');
    } catch (e) {
        console.error(e);
        loader.innerHTML = '<div class="manager-list-empty">שגיאה בטעינת הקובץ.</div>';
    }
}
function wireCropDrag(overlay) {
    const ctx = overlay.getContext('2d');
    const getPos = (e) => {
        const rect = overlay.getBoundingClientRect();
        const scaleX = overlay.width / rect.width, scaleY = overlay.height / rect.height;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    };
    const start = (e) => { const p = getPos(e); cropState.dragging = true; cropState.startX = p.x; cropState.startY = p.y; };
    const move = (e) => {
        if (!cropState.dragging) return;
        const p = getPos(e);
        const x = Math.min(cropState.startX, p.x), y = Math.min(cropState.startY, p.y);
        const w = Math.abs(p.x - cropState.startX), h = Math.abs(p.y - cropState.startY);
        cropState.rect = { x, y, width: w, height: h };
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        ctx.strokeStyle = '#7C2E4D'; ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(124,46,77,0.15)';
        ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
    };
    const end = () => { cropState.dragging = false; };
    overlay.onmousedown = start; overlay.onmousemove = move; overlay.onmouseup = end; overlay.onmouseleave = end;
    overlay.ontouchstart = start; overlay.ontouchmove = move; overlay.ontouchend = end;
}
function confirmCrop() {
    if (!cropState.rect || cropState.rect.width < 5 || cropState.rect.height < 5) { alert('סמן תחילה אזור על ידי גרירה עם העכבר.'); return; }
    try {
        const cropResult = window.LogoBlur.cropRegionFromCanvas(cropState.canvas, cropState.rect);
        window.LogoBlur.saveTemplate(cropResult);
        closeModal('cropModal');
        loadCropPreview();
    } catch (e) {
        console.error(e);
        alert('שגיאה בשמירת האזור: ' + e.message);
    }
}

/** Applies the "hide logo" pipeline to a PDF's bytes: rasterize each page
 *  with pdf.js, hand the canvases to LogoBlur.processPdfPages(), and
 *  re-embed the (possibly modified) canvases back into a new PDF. */
async function applyLogoBlurToPdf(pdfBytes) {
    if (!window.LogoBlur || !window.LogoBlur.hasSavedTemplate()) return pdfBytes;
    try {
        if (window.LogoBlur.whenReady) await window.LogoBlur.whenReady(8000);
    } catch (e) { console.warn('OpenCV not ready, skipping logo-hide.', e); return pdfBytes; }

    const options = getBlurOptions();
    const template = await window.LogoBlur.loadTemplateImage();
    if (!template) return pdfBytes;

    const pdf = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
    const canvases = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: options.renderScale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        canvases.push(canvas);
    }

    await window.LogoBlur.processPdfPages(canvases, template, options);

    const outDoc = await PDFLib.PDFDocument.create();
    for (const canvas of canvases) {
        const jpg = canvas.toDataURL('image/jpeg', 0.9);
        const bytes = await fetch(jpg).then(r => r.arrayBuffer());
        const image = await outDoc.embedJpg(bytes);
        // canvas px were rendered at pdf.js viewport scale = options.renderScale, i.e.
        // canvas.width = pageWidthInPdfPoints * renderScale — divide back out to get points.
        const pageWidthPt = canvas.width / options.renderScale;
        const pageHeightPt = canvas.height / options.renderScale;
        const pageDoc = outDoc.addPage([pageWidthPt, pageHeightPt]);
        pageDoc.drawImage(image, { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt });
    }
    return await outDoc.save();
}
