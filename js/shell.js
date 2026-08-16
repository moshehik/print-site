// מעטפת משותפת לכל עמודי print-site - התנהגות ה-app-shell של מערכת
// העיצוב "אריג": כפתור 3-הפסים (מכווץ/מסתיר את ה-sidebar בדסקטופ, פותח
// מגירה במובייל), מתג מצב כהה/בהיר, ושמירת שתי ההעדפות ב-localStorage.
(function () {
  var THEME_KEY = 'printSiteTheme';
  var SIDEBAR_KEY = 'printSiteSidebar';
  var PALETTE_KEY = 'printSitePalette';
  var DENSITY_KEY = 'printSiteDensity';

  // ---- החלת העדפות שמורות מוקדם (לפני ציור הדף - נקרא מ-<head>) ----
  var savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === 'dark' || savedTheme === 'light') {
    document.documentElement.setAttribute('data-theme', savedTheme);
  }
  var savedSidebar = localStorage.getItem(SIDEBAR_KEY);
  if (savedSidebar === 'collapsed' || savedSidebar === 'hidden') {
    document.documentElement.setAttribute('data-sidebar', savedSidebar);
  }
  var savedPalette = localStorage.getItem(PALETTE_KEY);
  if (savedPalette) document.documentElement.setAttribute('data-palette', savedPalette);
  var savedDensity = localStorage.getItem(DENSITY_KEY);
  if (savedDensity === 'compact') document.documentElement.setAttribute('data-density', 'compact');

  // API לעמוד "עיצוב ותצוגה" (display-settings) - שינוי + שמירה במקום אחד
  window.ShellPrefs = {
    setTheme: function (mode) { // 'light' | 'dark' | 'auto'
      if (mode === 'auto') {
        document.documentElement.removeAttribute('data-theme');
        localStorage.removeItem(THEME_KEY);
      } else {
        document.documentElement.setAttribute('data-theme', mode);
        localStorage.setItem(THEME_KEY, mode);
      }
    },
    setPalette: function (name) { // '' = ברירת המחדל (אריג)
      if (name) {
        document.documentElement.setAttribute('data-palette', name);
        localStorage.setItem(PALETTE_KEY, name);
      } else {
        document.documentElement.removeAttribute('data-palette');
        localStorage.removeItem(PALETTE_KEY);
      }
    },
    setDensity: function (d) { // 'comfortable' | 'compact'
      if (d === 'compact') {
        document.documentElement.setAttribute('data-density', 'compact');
        localStorage.setItem(DENSITY_KEY, 'compact');
      } else {
        document.documentElement.removeAttribute('data-density');
        localStorage.removeItem(DENSITY_KEY);
      }
    },
    get: function () {
      return {
        theme: localStorage.getItem(THEME_KEY) || 'auto',
        palette: localStorage.getItem(PALETTE_KEY) || '',
        density: localStorage.getItem(DENSITY_KEY) || 'comfortable',
      };
    },
  };

  function isDarkNow() {
    var attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark') return true;
    if (attr === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var sidebar = document.getElementById('sidebar');
    var backdrop = document.getElementById('sidebarBackdrop');
    var menuToggle = document.getElementById('menuToggle');
    var themeToggle = document.getElementById('themeToggle');

    if (menuToggle) menuToggle.addEventListener('click', function () {
      if (window.innerWidth <= 900) {
        var open = sidebar.classList.toggle('open');
        if (backdrop) backdrop.classList.toggle('open', open);
      } else {
        // דסקטופ: מלא -> מכווץ (רק אייקונים) -> מוסתר -> חוזר למלא
        var cur = document.documentElement.getAttribute('data-sidebar') || '';
        var next = cur === '' ? 'collapsed' : (cur === 'collapsed' ? 'hidden' : '');
        if (next) {
          document.documentElement.setAttribute('data-sidebar', next);
          localStorage.setItem(SIDEBAR_KEY, next);
        } else {
          document.documentElement.removeAttribute('data-sidebar');
          localStorage.removeItem(SIDEBAR_KEY);
        }
      }
    });

    if (backdrop) backdrop.addEventListener('click', function () {
      sidebar.classList.remove('open');
      backdrop.classList.remove('open');
    });

    if (themeToggle) themeToggle.addEventListener('click', function () {
      var next = isDarkNow() ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem(THEME_KEY, next);
    });
  });
})();
