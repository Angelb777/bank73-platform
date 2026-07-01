// public/js/auth.js
// ROLE-SEP: login UI con soporte de status y roles en minúsculas
(function () {
  const form   = document.getElementById('loginForm');
  const msg    = document.getElementById('msg');
  const btn    = document.getElementById('submitBtn');
  const pwd    = document.getElementById('password');
  const toggle = document.getElementById('togglePwd');

  // === Storage helpers ===
  function setAuth(token, role, status) {                // ROLE-SEP
    try {
      if (window.API && API.setAuth) API.setAuth(token, role, status);
      else {
        localStorage.setItem('tkn', token);
        localStorage.setItem('token', token); 
        localStorage.setItem('role', String(role || '').toLowerCase());     // ROLE-SEP
        localStorage.setItem('status', String(status || 'active').toLowerCase()); // ROLE-SEP
      }
      // Exponer para UI condicional
      window.currentUser = { role: String(role||'').toLowerCase(), status: String(status||'').toLowerCase() }; // ROLE-SEP
    } catch (_) {}
  }
  function getAuth() {
    try { if (window.API && API.getAuth) return API.getAuth(); } catch (_) {}
    return {
      token:  localStorage.getItem('tkn'),
      role:   localStorage.getItem('role'),
      status: localStorage.getItem('status')
    };
  }
  function clearAuth() {
    try { if (window.API && API.logout) API.logout(); } catch (_) {}
    localStorage.removeItem('tkn');
    localStorage.removeItem('role');
    localStorage.removeItem('status'); // ROLE-SEP
    delete window.currentUser;
  }

  // === Navegación según rol/estado ===
  function go(role, status) {                                            // ROLE-SEP
    const r = String(role || '').toLowerCase();
    const s = String(status || '').toLowerCase();
    if (s && s !== 'active') { location.href = '/pending.html'; return; } // ROLE-SEP
    location.href = (r === 'admin' || r === 'bank') ? '/dashboard' : '/portfolio';        // ROLE-SEP
  }

  // 👁️ Mostrar/ocultar contraseña
  if (toggle && pwd) {
    toggle.addEventListener('click', function () {
      const isPwd = pwd.getAttribute('type') === 'password';
      pwd.setAttribute('type', isPwd ? 'text' : 'password');
      toggle.textContent = isPwd ? '🙈' : '👁️';
      pwd.focus();
    });
  }

  // Autoredirect si ya hay sesión
  (function () {
    const { token, role, status } = getAuth();
    if (token && role) go(role, status);                                 // ROLE-SEP
  })();

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (msg) { msg.textContent = ''; msg.style.color = ''; }
      btn && btn.classList.add('loading');

      const email    = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;

      try {
        const resp = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Tenant': 'bancodemo' },
          body: JSON.stringify({ email, password })
        });
        const out = await resp.json();

        // 403 (pending/blocked) — mostramos mensaje y no guardamos token
        if (resp.status === 403) {
          setAuth('', '', out.status || 'pending'); // solo para que /pending.html pueda leer status si lo necesitas
          throw new Error(out.error || 'Cuenta pendiente/bloqueada');
        }
        if (!resp.ok || out.error) throw new Error(out.error || 'Credenciales inválidas');

        // Esperamos: { token, role: 'admin'|'bank'|'promoter'|'commercial', status: 'active' }
        setAuth(out.token, out.role, out.status, {
          userId: out.userId,
          tenantKeys: out.tenantKeys || (out.tenantKey ? [out.tenantKey] : [])
        });                         // ROLE-SEP
        go(out.role, out.status);                                         // ROLE-SEP
      } catch (e) {
        if (msg) { msg.textContent = e.message || 'Credenciales inválidas'; msg.style.color = 'salmon'; }
      } finally {
        btn && btn.classList.remove('loading');
      }
    });
  }

  // Logout global
  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    clearAuth(); location.href = '/';
  });
})();
