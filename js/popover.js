// תפריט/פאנל צף מעוגן לאלמנט (אייקון) - משותף לכל עמודי print-site.
// אותה שפה חזותית כמו .user-menu-dropdown של מערכת העיצוב, אבל מוצמד
// לגוף המסמך (לא נחתך ע"י overflow של הכרטיס) ומתהפך אוטומטית כשאין
// מקום למטה. פתוח אחד בכל רגע; נסגר ב-Esc / לחיצה בחוץ / קריאה חוזרת
// על אותו עוגן (toggle).
//   openPopover(anchorEl, contentEl | html, { width, onClose, keepOpen })
//   closePopover()
(function () {
  var current = null; // { el, anchor, onClose }

  var style = document.createElement('style');
  style.textContent =
    '.popover{position:fixed;z-index:60000;min-width:200px;max-width:min(360px,calc(100vw - 24px));background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);padding:8px;animation:pop-in .12s ease;max-height:min(70vh,520px);overflow-y:auto}' +
    '@keyframes pop-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}' +
    '@media (prefers-reduced-motion:reduce){.popover{animation:none}}' +
    '.popover-title{font-size:11.5px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.03em;padding:4px 8px 8px}' +
    '.popover .menu-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--radius-sm);font-size:13px;color:var(--text);cursor:pointer;background:none;border:none;width:100%;text-align:start;font-family:var(--font)}' +
    '.popover .menu-item:hover{background:var(--surface-alt)}' +
    '.popover .menu-item.selected{background:var(--primary-tint);color:var(--primary-solid);font-weight:700}' +
    '.popover .menu-item .icon{width:15px;height:15px;color:var(--text-3);flex:0 0 auto}' +
    '.popover .menu-item.selected .icon{color:var(--primary-solid)}' +
    '.popover .menu-item .check{margin-inline-start:auto;width:14px;height:14px;opacity:0}' +
    '.popover .menu-item.selected .check{opacity:1}' +
    '.popover .menu-divider{height:1px;background:var(--border);margin:6px 2px}' +
    '.popover .field{margin-bottom:8px}' +
    '.popover .field:last-child{margin-bottom:0}' +
    '.popover .opt-chips{padding:2px 4px}' +
    '.popover .popover-foot{display:flex;gap:6px;justify-content:flex-end;padding:8px 4px 2px}';
  document.head.appendChild(style);

  function place(el, anchor) {
    var r = anchor.getBoundingClientRect();
    var pw = el.offsetWidth, ph = el.offsetHeight;
    var vw = window.innerWidth, vh = window.innerHeight;
    // RTL: align the popover's right edge to the anchor's right edge; flip if it overflows left
    var left = r.right - pw;
    if (left < 8) left = Math.min(r.left, vw - pw - 8);
    if (left + pw > vw - 8) left = vw - pw - 8;
    var top = r.bottom + 6;
    if (top + ph > vh - 8) top = Math.max(8, r.top - ph - 6); // flip above
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  function onDocClick(e) {
    if (!current) return;
    if (current.el.contains(e.target) || current.anchor.contains(e.target)) return;
    closePopover();
  }
  function onKey(e) { if (e.key === 'Escape') closePopover(); }
  function onScroll() { if (current) place(current.el, current.anchor); }

  window.repositionPopover = function () { if (current) place(current.el, current.anchor); };

  window.closePopover = function () {
    if (!current) return;
    var c = current; current = null;
    if (c.ro) c.ro.disconnect();
    c.el.remove();
    c.anchor.classList.remove('popover-open');
    document.removeEventListener('mousedown', onDocClick, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onScroll);
    if (c.onClose) c.onClose();
  };

  window.openPopover = function (anchor, content, opts) {
    opts = opts || {};
    if (current && current.anchor === anchor) { closePopover(); return null; } // toggle
    closePopover();
    var el = document.createElement('div');
    el.className = 'popover';
    el.setAttribute('role', 'dialog');
    if (opts.width) el.style.width = opts.width + 'px';
    if (typeof content === 'string') el.innerHTML = content; else el.appendChild(content);
    document.body.appendChild(el);
    place(el, anchor);
    anchor.classList.add('popover-open');
    current = { el: el, anchor: anchor, onClose: opts.onClose };
    // תוכן שנטען מאוחר (רשת עמודים, רשימות) משנה את הגובה - ממקמים מחדש
    // אוטומטית כדי שהפאנל יישאר צמוד לאייקון ולא "יברח" למעלה/למטה
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { if (current && current.el === el) place(el, anchor); });
      ro.observe(el);
      current.ro = ro;
    }
    // defer so the opening click doesn't immediately close it
    setTimeout(function () {
      document.addEventListener('mousedown', onDocClick, true);
      document.addEventListener('keydown', onKey);
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onScroll);
    }, 0);
    return el;
  };

  // בונה תפריט בחירה בודדת: items=[{value,label,icon?}], value=נוכחי, onPick(value)
  window.pickerMenu = function (title, items, value, onPick) {
    var wrap = document.createElement('div');
    if (title) { var t = document.createElement('div'); t.className = 'popover-title'; t.textContent = title; wrap.appendChild(t); }
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item' + (String(it.value) === String(value) ? ' selected' : '');
      b.innerHTML = (it.icon || '') + '<span></span><svg class="icon check" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
      b.querySelector('span').textContent = it.label;
      b.addEventListener('click', function () { onPick(it.value); closePopover(); });
      wrap.appendChild(b);
    });
    return wrap;
  };
})();
