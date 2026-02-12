// /public/js/login-ui.js
(function () {
  function init() {
    console.log('[login-ui] init');

    // Año footer
    var y = document.getElementById('y');
    if (y) y.textContent = new Date().getFullYear();

    // Elementos
    var pwd    = document.getElementById('password');
    var toggle = document.getElementById('togglePwd');

    if (!pwd || !toggle) {
      console.warn('[login-ui] Falta #password o #togglePwd', { pwd: !!pwd, toggle: !!toggle });
      return;
    }

    // Asegura que el botón no sea bloqueado por CSS
    // (por si .ghost o el contenedor tienen pointer-events:none)
    try {
      toggle.style.pointerEvents = 'auto';
      toggle.style.position = toggle.style.position || 'relative';
      toggle.style.zIndex = toggle.style.zIndex || '2';
    } catch (_) {}

    function applyState() {
      var showing = (pwd.getAttribute('type') === 'text');
      toggle.setAttribute('aria-label', showing ? 'Ocultar contraseña' : 'Mostrar contraseña');
      toggle.textContent = showing ? '🙈' : '👁️';
    }

    function togglePassword(e) {
      if (e) e.preventDefault();
      var current = pwd.getAttribute('type') || 'password';
      var next = current === 'password' ? 'text' : 'password';
      pwd.setAttribute('type', next);
      applyState();
      // Mantener foco sin scroll
      try { pwd.focus({ preventScroll: true }); } catch (_) { pwd.focus(); }
      console.log('[login-ui] toggled ->', next);
    }

    // Listeners robustos
    toggle.addEventListener('click', togglePassword);
    // Por si algún estilo evita el click, capturamos también mousedown
    toggle.addEventListener('mousedown', function (e) {
      // Si el click normal no llega por CSS, al menos mousedown hará el toggle
      if (e.button === 0) { e.preventDefault(); togglePassword(); }
    });

    // Estado inicial del icono
    applyState();

    // Spinner del submit
    var form = document.getElementById('loginForm');
    var btn  = document.getElementById('submitBtn');
    if (form && btn) {
      form.addEventListener('submit', function () {
        btn.classList.add('loading');
        setTimeout(function () { btn.classList.remove('loading'); }, 4000);
      });
    }

    console.log('[login-ui] listo');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
