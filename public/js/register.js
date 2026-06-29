// public/js/register.js
(function () {
  console.log("[register] script loaded");

  const form   = document.getElementById('registerForm');
  const msg    = document.getElementById('msg');
  const btn    = document.getElementById('submitBtn');
  const pwd    = document.getElementById('password');
  const toggle = document.getElementById('togglePwd');

  // Roles solicitables (todos menos admin). Deben coincidir con models/User.js (roleRequested enum)
  const REQUESTABLE_ROLES = [
    'bank',
    'promoter',
    'commercial',
    'gerencia',
    'socios',
    'contable',
    'financiero',
    'legal',
    'tecnico'
  ];

  // Etiquetas bonitas para UI (opcional)
  const ROLE_LABEL = {
    bank: 'Banco',
    promoter: 'Promotor',
    commercial: 'Comercial',
    gerencia: 'Gerencia',
    socios: 'Socios',
    contable: 'Contable',
    financiero: 'Financiero',
    legal: 'Legal',
    tecnico: 'Técnico'
  };

  // Rellenar <select id="roleRequested"> si existe
  (function populateRoleSelect() {
    const sel = document.getElementById('roleRequested');
    if (!sel) return; // si usas radios, omitimos
    // limpia y añade placeholder
    sel.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Selecciona tu rol';
    placeholder.disabled = true;
    placeholder.selected = true;
    sel.appendChild(placeholder);

    REQUESTABLE_ROLES.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = ROLE_LABEL[r] || r;
      sel.appendChild(opt);
    });
  })();

  // 👁️ Mostrar/ocultar contraseña
  if (toggle && pwd) {
    toggle.addEventListener('click', function () {
      const isPwd = pwd.getAttribute('type') === 'password';
      pwd.setAttribute('type', isPwd ? 'text' : 'password');
      toggle.textContent = isPwd ? '🙈' : '👁️';
      pwd.focus();
    });
  }

  if (!form) return;

  // Resolver roleRequested desde select o radios
  function getRequestedRole() {
    // 1) select
    const sel = document.getElementById('roleRequested');
    if (sel && sel.value) return String(sel.value).toLowerCase();

    // 2) radios
    const radios = document.querySelectorAll('input[name="roleRequested"]');
    for (const r of radios) {
      if (r.checked) return String(r.value).toLowerCase();
    }

    // 3) default sensato
    return 'bank';
  }

  // Tenancy header (usa lo que tengas en localStorage o default a bancodemo)
  function getTenant() {
    try { return localStorage.getItem('tenant') || 'bancodemo'; } catch (_) { return 'bancodemo'; }
  }

  // Redirección a pantalla de cuenta pendiente
  function goPending(reason) {
    location.href = '/lib/pending.html' + (reason ? ('?r=' + encodeURIComponent(reason)) : '');
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (msg) { msg.textContent = ""; msg.style.color = ""; }
    btn && btn.classList.add('loading');

    const name     = document.getElementById('name')?.value.trim();
    const email    = document.getElementById('email')?.value.trim();
    const password = document.getElementById('password')?.value;
    const roleReq  = getRequestedRole(); // uno de REQUESTABLE_ROLES

    // Validación mínima de rol (evita valores raros si tocan el DOM)
    if (!REQUESTABLE_ROLES.includes(roleReq)) {
      if (msg) { msg.textContent = 'Selecciona un rol válido.'; msg.style.color = 'salmon'; }
      btn && btn.classList.remove('loading');
      return;
    }

    try {
      const resp = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant': getTenant()
        },
        body: JSON.stringify({
          name, email, password,
          roleRequested: roleReq
        })
      });

      const data = await resp.json();

      if (!resp.ok || data.error) {
        throw new Error(data.error || 'Error de registro');
      }

      // No guardamos token ni rol; la cuenta queda pendiente
      // Limpia cualquier sesión previa
      try {
        if (window.API && API.logout) API.logout();
      } catch (_) {}
      try {
        localStorage.removeItem('tkn');
        localStorage.removeItem('role');
        localStorage.removeItem('status');
      } catch (_) {}

      if (msg) {
        msg.textContent = 'Registro recibido. Tu cuenta está pendiente de aprobación por un administrador.';
        msg.style.color = '#7dd3fc';
      }
      setTimeout(() => goPending('pending'), 500);
    } catch (err) {
      console.error("[register] error", err);
      if (msg) { msg.textContent = err.message || 'Error de registro'; msg.style.color = 'salmon'; }
    } finally {
      btn && btn.classList.remove('loading');
    }
  });
})();
