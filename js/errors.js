// שגיאות משותפות לכל עמודי print-site (app/index.html, poster.html,
// app/history.html) - toast מיידי (מציג showError) + שמירה מתמדת
// ב-localStorage כדי שאפשר לצפות בהיסטוריית השגיאות גם בטאב "היסטוריה",
// אחרי רענון או במעבר בין העמודים. כל עמוד טוען את הקובץ הזה מוקדם ככל
// האפשר (מייד אחרי design-system.css) כדי שגם שגיאות מוקדמות ייתפסו.
(function () {
  var STORAGE_KEY = 'printSiteErrorLog';
  var MAX_ERRORS = 200;

  function loadErrorLog() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (e) { return []; }
  }

  function saveErrorLog(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ERRORS))); } catch (e) { /* מלא/חסום - מתעלמים, ה-toast עדיין מוצג */ }
  }

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

  function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(function () {
      if (!btn) return;
      btn.classList.add('copied');
      setTimeout(function () { btn.classList.remove('copied'); }, 1500);
    });
  }

  // כפתור העתקה שקוף (איקון-בלבד, ללא מסגרת בולטת) - אותה שפת עיצוב כמו
  // .bubble-copy-btn ב-design-system.css.
  function copyBtnHtml() {
    return '<button type="button" class="err-copy-btn" title="העתק הודעת שגיאה" ' +
      'style="position:absolute;top:50%;inset-inline-end:8px;transform:translateY(-50%);width:24px;height:24px;' +
      'border-radius:50%;border:1px solid var(--border);background:var(--surface);color:var(--text-3);' +
      'display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;">' +
      '<svg class="icon" viewBox="0 0 24 24" style="width:12px;height:12px;"><rect x="9" y="9" width="13" height="13" rx="2"/>' +
      '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>';
  }

  function showToast(message) {
    var stack = ensureStack();
    var toast = document.createElement('div');
    toast.className = 'toast error';
    toast.style.cssText = 'pointer-events:auto;position:relative;padding-inline-end:38px;';
    toast.innerHTML =
      '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
      '<span></span>' + copyBtnHtml();
    toast.querySelector('span').textContent = message;
    var copyBtn = toast.querySelector('.err-copy-btn');
    copyBtn.addEventListener('click', function () { copyToClipboard(message, copyBtn); });
    stack.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 8000);
  }

  window.showError = function showError(message) {
    message = String(message == null || message === '' ? 'שגיאה לא ידועה' : message);
    var list = loadErrorLog();
    list.unshift({ time: new Date().toISOString(), message: message, page: location.pathname.split('/').pop() || 'index.html' });
    saveErrorLog(list);
    showToast(message);
  };

  window.getErrorLog = loadErrorLog;
  window.clearErrorLog = function () { saveErrorLog([]); };
  window.copyErrorText = copyToClipboard;

  window.addEventListener('error', function (e) {
    window.showError(e.message || 'שגיאת סקריפט לא צפויה');
  });
  window.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason && e.reason.message ? e.reason.message : String(e.reason);
    window.showError(reason);
  });
})();
