// חלונות שאלה/קלט/התראה משותפים לכל עמודי print-site - מחליפים את
// confirm()/prompt()/alert() של הדפדפן ב-.confirm-modal ו-.toast של
// מערכת העיצוב "אריג" (בדיוק כמו במערכת הגמ"ח). כולם מבוססי Promise:
//   const ok   = await askConfirm({ title, message, confirmText, danger })
//   const text = await askPrompt({ title, message, placeholder, value })   // null בביטול
//   notify(message, 'success' | 'info' | 'warning' | 'error')
// (showError מ-errors.js נשאר לשגיאות - הוא גם שומר ללוג; notify לא.)
(function () {
  var ICONS = {
    question: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    danger:   '<svg class="icon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    edit:     '<svg class="icon" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',
    success:  '<svg class="icon" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
    info:     '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    warning:  '<svg class="icon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    error:    '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  };
  var TONE = {
    question: { bg: 'var(--primary-tint)', fg: 'var(--primary-solid)' },
    danger:   { bg: 'var(--danger-tint)',  fg: 'var(--danger)' },
    edit:     { bg: 'var(--primary-tint)', fg: 'var(--primary-solid)' },
    warning:  { bg: 'var(--warning-tint)', fg: 'var(--warning)' },
    info:     { bg: 'var(--info-tint)',    fg: 'var(--info)' },
    success:  { bg: 'var(--success-tint)', fg: 'var(--success)' },
  };

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }

  function openDialog(inner, opts) {
    var backdrop = el('<div class="dlg-backdrop" role="dialog" aria-modal="true"></div>');
    var modal = el('<div class="modal confirm-modal"></div>');
    modal.appendChild(inner);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    // focus first control
    setTimeout(function () {
      var f = modal.querySelector('input, .btn-primary, .btn-danger, .btn');
      if (f) f.focus();
    }, 0);
    function close() { backdrop.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') { close(); opts.onCancel && opts.onCancel(); } }
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) { close(); opts.onCancel && opts.onCancel(); } });
    return close;
  }

  window.askConfirm = function (o) {
    o = o || {};
    var tone = o.danger ? 'danger' : 'question';
    return new Promise(function (resolve) {
      var inner = el(
        '<div>' +
          '<div class="modal-icon-circle" style="background:' + TONE[tone].bg + ';color:' + TONE[tone].fg + ';">' + ICONS[tone] + '</div>' +
          '<h3></h3><p></p>' +
          '<div class="confirm-actions">' +
            '<button type="button" class="btn btn-secondary dlg-cancel"></button>' +
            '<button type="button" class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + ' dlg-ok"></button>' +
          '</div>' +
        '</div>');
      inner.querySelector('h3').textContent = o.title || 'האם להמשיך?';
      inner.querySelector('p').textContent = o.message || '';
      inner.querySelector('.dlg-cancel').textContent = o.cancelText || 'ביטול';
      inner.querySelector('.dlg-ok').textContent = o.confirmText || (o.danger ? 'מחק' : 'אישור');
      var close = openDialog(inner, { onCancel: function () { resolve(false); } });
      inner.querySelector('.dlg-cancel').addEventListener('click', function () { close(); resolve(false); });
      inner.querySelector('.dlg-ok').addEventListener('click', function () { close(); resolve(true); });
    });
  };

  window.askPrompt = function (o) {
    o = o || {};
    return new Promise(function (resolve) {
      var inner = el(
        '<form>' +
          '<div class="modal-icon-circle" style="background:' + TONE.edit.bg + ';color:' + TONE.edit.fg + ';">' + ICONS.edit + '</div>' +
          '<h3></h3><p></p>' +
          '<div class="field" style="text-align:start;"><input class="input" type="text" autocomplete="off"></div>' +
          '<div class="confirm-actions">' +
            '<button type="button" class="btn btn-secondary dlg-cancel"></button>' +
            '<button type="submit" class="btn btn-primary dlg-ok"></button>' +
          '</div>' +
        '</form>');
      inner.querySelector('h3').textContent = o.title || 'הזן ערך';
      inner.querySelector('p').textContent = o.message || '';
      var input = inner.querySelector('input');
      input.placeholder = o.placeholder || '';
      input.value = o.value || '';
      inner.querySelector('.dlg-cancel').textContent = o.cancelText || 'ביטול';
      inner.querySelector('.dlg-ok').textContent = o.confirmText || 'שמור';
      var close = openDialog(inner, { onCancel: function () { resolve(null); } });
      inner.querySelector('.dlg-cancel').addEventListener('click', function () { close(); resolve(null); });
      inner.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = input.value.trim();
        if (!v && o.required !== false) { input.focus(); input.classList.add('is-invalid'); return; }
        close(); resolve(v);
      });
    });
  };

  // ---- toast (לא נשמר ללוג - להודעות "בוצע"/"שים לב"; לשגיאות השתמשו ב-showError) ----
  function ensureStack() {
    var stack = document.getElementById('errToastStack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'errToastStack';
      stack.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:10px;width:100%;max-width:380px;padding:0 12px;pointer-events:none;';
      document.body.appendChild(stack);
    }
    return stack;
  }
  window.notify = function (message, type) {
    type = type || 'info';
    if (type === 'error' && window.showError) return window.showError(message);
    var toast = el('<div class="toast ' + type + '" style="pointer-events:auto;">' + (ICONS[type] || ICONS.info) + '<span></span></div>');
    toast.querySelector('span').textContent = message;
    ensureStack().appendChild(toast);
    setTimeout(function () { toast.remove(); }, type === 'success' ? 3500 : 5000);
  };

  // ---- CSS for the backdrop (the modal itself is pure design-system) ----
  var style = document.createElement('style');
  style.textContent =
    '.dlg-backdrop{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(20,14,10,.5);animation:dlg-fade .12s ease}' +
    '@keyframes dlg-fade{from{opacity:0}to{opacity:1}}' +
    '.dlg-backdrop .confirm-modal{width:100%;animation:dlg-pop .14s ease}' +
    '@keyframes dlg-pop{from{transform:scale(.96);opacity:0}to{transform:scale(1);opacity:1}}' +
    '.dlg-backdrop .input.is-invalid{border-color:var(--danger);outline:2px solid var(--danger-tint)}' +
    '@media (prefers-reduced-motion:reduce){.dlg-backdrop,.dlg-backdrop .confirm-modal{animation:none}}';
  document.head.appendChild(style);
})();
