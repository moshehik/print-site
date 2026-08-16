/* ============================================================
   groups.js — merge-group sidebar: reordering files within a
   group (1-4) and applying settings/styles to the whole group.
   ============================================================ */

function openMergeSidebar(groupId) {
    if (groupId === 0) return;
    currentMergeGroup = groupId;
    document.getElementById('mergeSidebarTitle').innerHTML = `<svg class="icon" viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg> ניהול קבוצה ${groupId}`;
    document.getElementById('mergeSidebar').classList.add('open');
    document.getElementById('groupStyleSelect').innerHTML = getStylesOptionsHTML('');

    const groupFiles = filesData.filter(f => f.group === currentMergeGroup);
    if (groupFiles.length > 0) {
        const first = groupFiles[0];
        document.getElementById('groupQtySelect').innerHTML = getQuantityOptionsHTML(first.quantity);
        document.getElementById('groupFormatSelect').innerHTML = getFormatOptionsHTML(first.format);
        document.getElementById('groupPdfCheck').checked = !!first.convertToPdf;
        document.getElementById('groupBsdCheck').checked = !!first.addBsd;
        document.getElementById('groupNumCheck').checked = !!first.addPageNumbers;
        document.getElementById('groupRevCheck').checked = !!first.reverseLastPage;
        document.getElementById('groupArrowsCheck').checked = !!first.addArrows;
        document.getElementById('groupDupCheck').checked = !!first.duplicateTwoUp;
        document.getElementById('groupBlankCheck').checked = !!first.addEvenBlankPage;
        document.getElementById('groupMarginCutCheck').checked = !!first.marginCut;
        renderGroupDestChips(first);
        let lVal = first.addLogo === '1' || first.addLogo === true ? '1' : (first.addLogo === '2' ? '2' : '');
        document.getElementById('groupLogoSelect').value = lVal;
    } else {
        document.getElementById('groupFormatSelect').innerHTML = getFormatOptionsHTML('רגיל');
    }
    renderMergeList();
}
function closeMergeSidebar() {
    document.getElementById('mergeSidebar').classList.remove('open');
    currentMergeGroup = 0;
    renderFiles();
}
function renderMergeList() {
    const container = document.getElementById('mergeListContainer');
    const groupFiles = filesData.filter(f => f.group === currentMergeGroup);
    if (groupFiles.length === 0) { container.innerHTML = '<div class="manager-list-empty">אין קבצים בקבוצה זו</div>'; return; }
    container.innerHTML = groupFiles.map((file, idx) => `
        <div class="merge-list-item">
            <div class="merge-item-idx">${idx + 1}</div>
            <div class="merge-item-info">
                <div class="merge-item-name" title="${escAttr(file.fileObj.name)}">${escHtml(file.fileObj.name)}</div>
                <div class="merge-item-details">${escHtml(file.format)}, ${escHtml(file.quantity)}</div>
            </div>
            <div class="reorder-controls">
                <button class="btn-reorder" onclick="moveFileInGroup('${file.id}', -1)" ${idx === 0 ? 'disabled' : ''}><svg class="icon" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg></button>
                <button class="btn-reorder" onclick="moveFileInGroup('${file.id}', 1)" ${idx === groupFiles.length - 1 ? 'disabled' : ''}><svg class="icon" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></button>
            </div>
        </div>`).join('');
}
function moveFileInGroup(fileId, direction) {
    const currentIndex = filesData.findIndex(f => f.id === fileId);
    if (currentIndex === -1) return;
    let swapIndex = -1;
    if (direction === -1) { for (let i = currentIndex - 1; i >= 0; i--) if (filesData[i].group === currentMergeGroup) { swapIndex = i; break; } }
    else { for (let i = currentIndex + 1; i < filesData.length; i++) if (filesData[i].group === currentMergeGroup) { swapIndex = i; break; } }
    if (swapIndex !== -1) {
        [filesData[currentIndex], filesData[swapIndex]] = [filesData[swapIndex], filesData[currentIndex]];
        renderMergeList();
    }
}
function applyStyleToGroup(styleName) {
    if (!styleName || !currentMergeGroup) return;
    const style = getStoredStyles().find(s => s.name === styleName);
    if (!style) return;
    filesData.forEach(item => {
        if (item.group === currentMergeGroup) {
            STYLE_KEYS.forEach(k => { if (style[k] !== undefined && !(k === 'convertToPdf' && !item.canConvert)) item[k] = style[k]; });
            item.appliedStyleName = styleName;
            item.isModified = true;
            checkAutoReverse(item);
        }
    });
    openMergeSidebar(currentMergeGroup);
    renderFiles();
}
function applyGroupSetting(key, value) {
    if (!currentMergeGroup) return;
    filesData.forEach(f => {
        if (f.group === currentMergeGroup) {
            f[key] = value;
            if (key === 'format') checkAutoReverse(f);
            f.appliedStyleName = '';
            f.isModified = true;
        }
    });
    renderFiles();
}


// צ'יפים של יעדי השליחה בפאנל הקבוצה - toggleFileDest מסנכרן את כל הקבוצה
function renderGroupDestChips(first) {
    const host = document.getElementById('groupDestChips');
    if (!host || !first) return;
    host.innerHTML = getDestinations().map((d, i) => `
        <label class="opt-chip dest-${d.color}"><input type="checkbox" ${fileHasDest(first, d.id) ? 'checked' : ''} onchange="toggleFileDest('${first.id}', '${d.id}'); renderMergeList();"><span>${destDotHtml(d, true)}${escHtml(d.name)}${i === 0 ? ' <span class="hint">(ברירת מחדל)</span>' : ''}</span></label>`).join('');
}
