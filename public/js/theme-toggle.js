(function () {
  const STORAGE_KEY = 'theme';
  const DARK = 'dark';
  const LIGHT = 'light';

  function getStoredTheme() {
    return localStorage.getItem(STORAGE_KEY) === LIGHT ? LIGHT : DARK;
  }

  function applyTheme(theme) {
    const next = theme === LIGHT ? LIGHT : DARK;
    document.documentElement.classList.toggle('light-theme', next === LIGHT);
    document.documentElement.classList.toggle('dark-theme', next === DARK);
    document.body.classList.toggle('light-theme', next === LIGHT);
    document.body.classList.toggle('dark-theme', next === DARK);
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      btn.textContent = next === LIGHT ? '🌙' : '☀️';
      btn.title = next === LIGHT ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro';
      btn.setAttribute('aria-label', btn.title);
    });
  }

  function setTheme(theme) {
    const next = theme === LIGHT ? LIGHT : DARK;
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }

  function initThemeToggle() {
    applyTheme(getStoredTheme());
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const current = document.body.classList.contains('light-theme') ? LIGHT : DARK;
        setTheme(current === LIGHT ? DARK : LIGHT);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThemeToggle);
  } else {
    initThemeToggle();
  }
})();
