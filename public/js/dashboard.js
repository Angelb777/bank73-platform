// public/js/dashboard.js  (ADMIN ONLY)
(async function () {
  // ---------- Helpers de autenticación ----------
  function getAuth() {
    try {
      if (window.API?.getAuth) return API.getAuth();
    } catch (_) {}
    return {
      token: localStorage.getItem('tkn'),
      role: localStorage.getItem('role'),
      tenant: localStorage.getItem('tenant') || 'bancodemo'
    };
  }
  function clearAuthAndGoHome() {
    try {
      if (window.API?.logout) API.logout();
      else if (window.API?.clearAuth) API.clearAuth();
    } catch (_) {}
    localStorage.removeItem('tkn');
    localStorage.removeItem('role');
    location.href = '/';
  }

  const { token, role, tenant } = getAuth();
  if (!token) return clearAuthAndGoHome();

  const roleL = (role || '').toLowerCase();
  const statusL = (localStorage.getItem('status') || '').toLowerCase();

  // ---- ROLES: fuente única para pintar selects ----
const ALL_ROLES = [
  'admin',
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

// Solo los roles que el endpoint /api/projects/assignees admite
const ASSIGNABLE_ROLES = [
  'promoter',
  'commercial',
  'legal',
  'tecnico',
  'gerencia',
  'socios',
  'financiero',
  'contable'
];

const PROJECT_TYPES = [
  'Residencial vertical PH',
  'Residencial horizontal',
  'Comercial',
  'Mixto',
  'Lotes unifamiliares',
  'Lotes, adosados y dúplex PH',
  'Otro'
];

const PROMOTER_TYPES = [
  'No definido',
  'Promotor constructor',
  'Llave en mano',
  'Subcontratación',
  'Gestión fragmentada'
];

function renderPromoterTypeOptions(selected = '') {
  const sel = String(selected || 'No definido');
  return PROMOTER_TYPES.map(type => {
    const s = sel === type ? ' selected' : '';
    return `<option value="${type}"${s}>${type}</option>`;
  }).join('');
}

const ROLE_LABEL = (r) => ({
  admin: 'Admin',
  bank: 'Bank',
  promoter: 'Promoter',
  commercial: 'Commercial',
  gerencia: 'Gerencia',
  socios: 'Socios',
  contable: 'Contable',
  financiero: 'Financiero',
  legal: 'Legal',
  tecnico: 'Técnico'
}[String(r).toLowerCase()] || r);

function renderRoleOptions(selected = '') {
  const sel = String(selected || '').toLowerCase();
  const head = `<option value="">— rol —</option>`;
  const body = ALL_ROLES.map(r => {
    const v = String(r).toLowerCase();
    const s = sel === v ? ' selected' : '';
    return `<option value="${v}"${s}>${ROLE_LABEL(v)}</option>`;
  }).join('');
  return head + body;
}


  if (statusL && statusL !== 'active') {
    location.href = '/pending.html';
    return;
  }
  if (roleL !== 'admin') {
    location.href = '/portfolio';
    return;
  }

  // ---------- DOM ----------
  const msgEl = document.getElementById('msg');

  // Usuarios
  const usersTbody = document.getElementById('usersTbody');
  const pendingUsersTbody = document.getElementById('pendingUsersTbody');
  const usersStatusFilter = document.getElementById('usersStatusFilter');
  const usersSearch = document.getElementById('usersSearch');
  const roleSelectDefault = document.getElementById('roleSelectDefault');
  const usersCardBody = document.getElementById('usersCardBody');
  const toggleUsersCardBtn = document.getElementById('toggleUsersCard');
  const usersPagerInfo = document.getElementById('usersPagerInfo');
  const usersPrev = document.getElementById('usersPrev');
  const usersNext = document.getElementById('usersNext');

  // Rellenar el "Rol por defecto al aprobar" con TODOS los roles
if (roleSelectDefault) {
  roleSelectDefault.innerHTML =
    `<option value="">— Rol al aprobar (opcional) —</option>` +
    ALL_ROLES.map(r => `<option value="${r}">${ROLE_LABEL(r)}</option>`).join('');
}

  // Proyectos (pendientes)
  const pendingProjectsTbody = document.getElementById('pendingProjectsTbody');

  // Proyectos (listado completo + filtros)
  const allProjectsTbody = document.getElementById('allProjectsTbody');
  const allProjectsFilter = document.getElementById('allProjectsFilter');
  const allProjectsSearch = document.getElementById('allProjectsSearch');
  const refreshAllProjectsBtn = document.getElementById('refreshAllProjects');
  const allProjectsPagerInfo = document.getElementById('allProjectsPagerInfo');
  const allProjectsPrev = document.getElementById('allProjectsPrev');
  const allProjectsNext = document.getElementById('allProjectsNext');

  // Caché de proyectos (última carga)
  let allProjectsCache = [];
  let usersCache = [];
  let usersPage = 1;
  let usersLastTotal = 0;
  let allProjectsPage = 1;
  let allProjectsLastTotal = 0;
  const usersPageSize = 10;
  const allProjectsPageSize = 10;

  // Modal asignación (si existe en el HTML)
  const assignModal = document.getElementById('assignModal');
  const assignProjectNameEl = document.getElementById('assignProjectName');
  const assignTeamSuggestionEl = document.getElementById('assignTeamSuggestion');
  const assignCancelBtn = document.getElementById('assignCancel');
  const assignCloseBtn = document.getElementById('assignClose');
  const assignSaveBtn = document.getElementById('assignSave');

  // Actividad / auditoría
  const activityCard = document.getElementById('activityCard');
  const openActivityBtn = document.getElementById('openActivityBtn');
  const hideActivityBtn = document.getElementById('hideActivityBtn');
  const refreshAuditLogsBtn = document.getElementById('refreshAuditLogs');
  const auditActionFilter = document.getElementById('auditActionFilter');
  const auditStatusFilter = document.getElementById('auditStatusFilter');
  const auditSearch = document.getElementById('auditSearch');
  const auditTbody = document.getElementById('auditTbody');
  const auditTotal = document.getElementById('auditTotal');
  const auditFailures = document.getElementById('auditFailures');
  const auditDocs = document.getElementById('auditDocs');
  const auditLatest = document.getElementById('auditLatest');
  const auditPagerInfo = document.getElementById('auditPagerInfo');
  const auditPrev = document.getElementById('auditPrev');
  const auditNext = document.getElementById('auditNext');

  let auditPage = 1;
  const auditLimit = 50;
  let auditLastTotal = 0;

  document.getElementById('logoutBtn')?.addEventListener('click', clearAuthAndGoHome);

  // ---------- Pequeño wrapper fetch ----------
  async function xfetch(path, opts = {}) {
    if (window.API?.get && (!opts.method || opts.method === 'GET')) {
      return API.get(path);
    }
    if (window.API?.post && opts.method === 'POST') {
      return API.post(path, opts.body ? JSON.parse(opts.body) : undefined);
    }
    if (window.API?.del && opts.method === 'DELETE') {
      return API.del(path);
    }
    if (window.API?.put && opts.method === 'PUT') {
      return API.put(path, opts.body ? JSON.parse(opts.body) : undefined);
    }
    const resp = await fetch(path, {
      ...opts,
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Tenant': tenant,
        'Content-Type': 'application/json',
        ...(opts.headers || {})
      }
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data.error || data.message || `Error ${resp.status}`);
    }
    return data;
  }

  // ---------- Normalizadores ----------
  function userStatus(u) {
    const s = (u.status || '').toLowerCase();
    if (s) return s;
    if (u.blocked) return 'blocked';
    if (u.verified === false) return 'pending';
    if (u.verified === true) return 'active';
    return 'pending';
  }
  function isPending(u) { return userStatus(u) === 'pending'; }

  // ---------- USERS: API ----------
  async function apiGetUsers({ status } = {}) {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    const data = await xfetch(`/api/admin/users${qs}`);
    return Array.isArray(data) ? data : (data.users || []);
  }
  async function apiApproveUser(id, role) {
    return xfetch(`/api/admin/users/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(role ? { role } : {})
    });
  }
  async function apiBlockUser(id) {
    return xfetch(`/api/admin/users/${id}/block`, { method: 'POST' });
  }
  async function apiDeleteUser(id) {
    return xfetch(`/api/admin/users/${id}`, { method: 'DELETE' });
  }
  async function apiUpdatePromoterProfile(id, promoterProfile) {
    return xfetch(`/api/admin/users/${id}/promoter-profile`, {
      method: 'PATCH',
      body: JSON.stringify({ promoterProfile })
    });
  }

  // ---------- PROJECTS: API (pendientes admin) ----------
  async function apiGetProjectsPending() {
    const data = await xfetch('/api/admin/projects?status=pending');
    return Array.isArray(data) ? data : (data.projects || []);
  }
  async function apiApproveProject(id) {
    return xfetch(`/api/admin/projects/${id}/approve`, { method: 'POST' });
  }
  async function apiRejectProject(id) {
    return xfetch(`/api/admin/projects/${id}/reject`, { method: 'POST' });
  }

  // ---------- PROJECTS: API (listado completo + asignaciones) ----------
  async function apiGetAllProjects(publishStatus) {
    const qs = publishStatus ? `?publishStatus=${encodeURIComponent(publishStatus)}` : '';
    return xfetch(`/api/projects${qs}`);
  }
  async function apiGetAssignees(role) {
    const data = await xfetch(`/api/projects/assignees?role=${encodeURIComponent(role)}`);
    return data.users || [];
  }
  // modoFlexible=false => envía { assignments: { role:[ids], ... } } (recomendado)
// modoFlexible=true  => envía compatibilidad { promoters:[], commercials:[] } + extras por si el backend aún no está migrado
async function apiAssignProject(id, assignmentsOrLegacy, modoFlexible = false) {
  if (!modoFlexible) {
    // Recomendado: payload genérico
    return xfetch(`/api/projects/${id}/assign`, {
      method: 'PUT',
      body: JSON.stringify({ assignments: assignmentsOrLegacy })
    });
  } else {
    // Compat: si aún no migraste backend, mandamos también los campos antiguos
    const assignments = assignmentsOrLegacy || {};
    const body = {
      promoters: assignments.promoter || [],
      commercials: assignments.commercial || []
    };
    // Enviamos además el resto por si el backend ya los acepta (no rompe si los ignora)
    Object.keys(assignments).forEach(role => {
      if (role !== 'promoter' && role !== 'commercial') {
        body[role] = assignments[role];
      }
    });
    return xfetch(`/api/projects/${id}/assign`, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  }
}

  async function apiDeleteProject(id) {
    return xfetch(`/api/projects/${id}`, { method: 'DELETE' });
  }

  async function apiGetAuditLogs() {
    const qs = new URLSearchParams({
      page: String(auditPage),
      limit: String(auditLimit)
    });

    if (auditActionFilter?.value) qs.set('action', auditActionFilter.value);
    if (auditStatusFilter?.value) qs.set('status', auditStatusFilter.value);
    if (auditSearch?.value?.trim()) qs.set('q', auditSearch.value.trim());

    return xfetch(`/api/admin/audit-logs?${qs.toString()}`);
  }

  // ---------- CACHES de candidatos (para pintar nombres) ----------
  let promotersMap = new Map();   // id -> {name,email}
  let commercialsMap = new Map(); // id -> {name,email}
  function nameOf(map, id) {
    const u = map.get(String(id));
    if (!u) return '';
    return u.name || u.email || String(id);
  }
  function normalize(s) { return (s || '').toString().toLowerCase(); }

  function maxPageFor(total, pageSize) {
    return Math.max(1, Math.ceil(Number(total || 0) / pageSize));
  }

  function slicePage(list, page, pageSize) {
    const start = (page - 1) * pageSize;
    return list.slice(start, start + pageSize);
  }

  function pagerText(page, total, pageSize, label) {
    if (!total) return `0 ${label}`;
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(total, page * pageSize);
    return `${start}-${end} de ${total} ${label}`;
  }

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderProjectTypeOptions(selected = '') {
  const sel = String(selected || '');
  return `<option value="">No definido</option>` + PROJECT_TYPES.map(type => {
    const s = sel === type ? ' selected' : '';
    return `<option value="${type}"${s}>${type}</option>`;
  }).join('');
}

function isPromoterLikeUser(u = {}) {
  return String(u.role || '').toLowerCase() === 'promoter' ||
    String(u.roleRequested || u.requestedRole || '').toLowerCase() === 'promoter';
}

function promoterProfileCell(u = {}) {
  if (!isPromoterLikeUser(u)) return '<span class="muted">No definido</span>';
  const category = u.promoterCategory || 'Emergente';
  const companyName = u.promoterProfile?.companyName || '';
  const promoterType = u.promoterProfile?.promoterType || 'No definido';
  const lines = [
    companyName ? `<strong class="promoter-profile-company">${escapeHtml(companyName)}</strong>` : '',
    promoterType && promoterType !== 'No definido' ? `<span class="promoter-profile-category">${escapeHtml(promoterType)}</span>` : '',
    category && category !== 'No definido' ? `<span class="promoter-profile-category">${escapeHtml(category)}</span>` : ''
  ].filter(Boolean).join('');
  return `
    <div class="promoter-profile-cell">
      ${lines ? `<div>${lines}</div>` : ''}
      <button class="btn small promoter-profile-action" data-user-promoter-profile="${u._id}">Editar perfil</button>
    </div>
  `;
}

const ACTION_LABELS = {
  'auth.login_success': 'Login correcto',
  'auth.login_failed': 'Login fallido',
  'auth.login_blocked': 'Login bloqueado',
  'auth.register_requested': 'Registro solicitado',
  'user.approved': 'Usuario aprobado',
  'user.blocked': 'Usuario bloqueado',
  'user.deleted': 'Usuario eliminado',
  'project.created': 'Proyecto creado',
  'project.updated': 'Proyecto actualizado',
  'project.approved': 'Proyecto aprobado',
  'project.rejected': 'Proyecto rechazado',
  'project.assigned': 'Equipo asignado',
  'project.deleted': 'Proyecto eliminado',
  'document.uploaded': 'Documento subido',
  'document.downloaded': 'Documento descargado',
  'document.deleted': 'Documento eliminado',
  'security.rate_limited': 'Límite activado'
};

const STATUS_LABELS = {
  success: 'Correcto',
  failure: 'Fallido',
  blocked: 'Bloqueado',
  info: 'Info'
};

function actionLabel(action) {
  return ACTION_LABELS[action] || action || '-';
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status || '-';
}

function formatShortDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

function formatTimeAgo(value) {
  if (!value) return '-';
  const d = new Date(value);
  const diff = Date.now() - d.getTime();
  if (!Number.isFinite(diff)) return '-';
  const min = Math.max(0, Math.round(diff / 60000));
  if (min < 1) return 'Ahora';
  if (min < 60) return `${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

function targetText(log) {
  if (!log?.targetType) return '-';
  const id = log.targetId ? String(log.targetId).slice(-6) : '';
  return id ? `${log.targetType} · ${id}` : log.targetType;
}

function detailText(log) {
  const meta = log.metadata || {};
  const bits = [];
  if (log.message) bits.push(log.message);
  if (meta.originalname) bits.push(meta.originalname);
  if (meta.email) bits.push(meta.email);
  if (meta.name) bits.push(meta.name);
  if (meta.role) bits.push(`rol: ${meta.role}`);
  if (meta.size) bits.push(`${Math.round(Number(meta.size) / 1024)} KB`);
  return bits.filter(Boolean).join(' · ') || '-';
}

function projectMatchesQuery(p, q) {
  if (!q) return true;
  const qL = normalize(q);

  const name = normalize(p.name);
  const desc = normalize(p.description);

  // Nombres ya resueltos con los Map de candidatos
  const proms = (p.assignedPromoters || [])
    .map(id => normalize(nameOf(promotersMap, id)))
    .filter(Boolean)
    .join(' ');
  const comms = (p.assignedCommercials || [])
    .map(id => normalize(nameOf(commercialsMap, id)))
    .filter(Boolean)
    .join(' ');

  return (
    name.includes(qL) ||
    desc.includes(qL) ||
    proms.includes(qL) ||
    comms.includes(qL)
  );
}

  async function apiUpdateProject(id, payload) {
    return xfetch(`/api/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  }


function applyProjectsFilters(list) {
  const publishStatus = allProjectsFilter?.value || '';
  const q = allProjectsSearch?.value || '';

  let filtered = Array.isArray(list) ? list.slice() : [];
  if (publishStatus) {
    filtered = filtered.filter(p => normalize(p.publishStatus) === normalize(publishStatus));
  }
  if (q.trim()) {
    filtered = filtered.filter(p => projectMatchesQuery(p, q));
  }
  return filtered;
}
  async function refreshAssigneesCaches() {
    try {
      const [promoters, commercials] = await Promise.all([
        apiGetAssignees('promoter'),
        apiGetAssignees('commercial')
      ]);
      promotersMap = new Map(promoters.map(u => [String(u._id), u]));
      commercialsMap = new Map(commercials.map(u => [String(u._id), u]));
    } catch (e) {
      console.warn('No se pudieron cargar candidatos:', e.message);
      promotersMap = new Map();
      commercialsMap = new Map();
    }
  }

  // ---------- RENDER: Usuarios Pendientes ----------
  function renderPendingUsers(list) {
    if (!pendingUsersTbody) return;
    pendingUsersTbody.innerHTML = '';
    if (!list.length) {
      pendingUsersTbody.innerHTML = `<tr><td colspan="6" class="muted">No hay usuarios pendientes.</td></tr>`;
      return;
    }
    list.forEach((u) => {
      const tr = document.createElement('tr');
      const requestedAt = u.requestedAt || u.createdAt;
      const st = userStatus(u);
      const roleRequested = u.roleRequested || u.requestedRole || '';
      const defaultRole = roleSelectDefault?.value || '';
      const initialRole = roleRequested || defaultRole;

      tr.innerHTML = `
  <td>${u.name || '-'}</td>
  <td>${u.email}</td>
  <td>${requestedAt ? new Date(requestedAt).toLocaleString() : '-'}</td>
  <td><span class="badge ${st}">${st.toUpperCase()}</span></td>
  <td>${promoterProfileCell(u)}</td>
  <td>
    <div class="actions">
      <select class="input role-inline" data-id="${u._id}" title="Cambiar rol">
        ${renderRoleOptions(initialRole)}
      </select>
      <button class="btn small approve" data-id="${u._id}">Aprobar</button>
      <button class="btn small" data-action="block" data-id="${u._id}">Bloquear</button>
      <button class="btn danger small" data-action="delete" data-id="${u._id}">Eliminar</button>
    </div>
  </td>
`;


      pendingUsersTbody.appendChild(tr);
    });
  }

  // ---------- RENDER: Usuarios (listado general) ----------
  function renderUsers(list) {
    if (!usersTbody) return;
    usersTbody.innerHTML = '';
    usersLastTotal = Array.isArray(list) ? list.length : 0;
    usersPage = Math.min(usersPage, maxPageFor(usersLastTotal, usersPageSize));
    if (usersPage < 1) usersPage = 1;

    if (usersPagerInfo) usersPagerInfo.textContent = pagerText(usersPage, usersLastTotal, usersPageSize, 'usuarios');
    if (usersPrev) usersPrev.disabled = usersPage <= 1;
    if (usersNext) usersNext.disabled = usersPage >= maxPageFor(usersLastTotal, usersPageSize);

    if (!list.length) {
      usersTbody.innerHTML = `<tr><td class="muted" colspan="8">No hay usuarios.</td></tr>`;
      return;
    }
    let myId = null;
    try { myId = window.API?.getAuth?.().userId || null; } catch (_) {}

    slicePage(list, usersPage, usersPageSize).forEach((u) => {
      const st = userStatus(u);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${u.name || '-'}</td>
        <td>${u.email}</td>
        <td><code>${u.role || '-'}</code></td>
        <td>${u.requestedAt ? new Date(u.requestedAt).toLocaleString() : '-'}</td>
        <td><span class="badge ${st}">${st.toUpperCase()}</span></td>
        <td>${u.createdAt ? new Date(u.createdAt).toLocaleString() : '-'}</td>
        <td>${promoterProfileCell(u)}</td>
        <td>
          <div class="actions">
            ${st==='pending'
              ? `<button class="btn small approve" data-id="${u._id}">Aprobar</button>`
              : `<button class="btn small" data-action="block" data-id="${u._id}">${st==='blocked'?'Desbloquear':'Bloquear'}</button>`
            }
            <select class="input role-inline" data-id="${u._id}">
            ${renderRoleOptions(u.role)}
            </select>
            <button class="btn danger small" data-action="delete" data-id="${u._id}">Eliminar</button>
          </div>
        </td>
      `;
      if (myId && u._id === myId) {
        const delBtn = tr.querySelector('button[data-action="delete"]');
        if (delBtn) { delBtn.disabled = true; delBtn.title = 'No puedes eliminar tu propia cuenta'; }
      }
      usersTbody.appendChild(tr);
    });
  }

  // ---------- RENDER: Proyectos Pendientes ----------
  function teamSuggestionHtml(s = {}) {
    const roles = ['promoter','commercial','legal','tecnico','gerencia','socios','financiero','contable'];
    const rows = roles
      .map(r => {
        const list = Array.isArray(s?.[r]) ? s[r].filter(Boolean) : [];
        if (!list.length) return '';
        return `<div><b>${escapeHtml(ROLE_LABEL(r))}:</b> ${escapeHtml(list.join(', '))}</div>`;
      })
      .filter(Boolean);

    if (s?.notes) rows.push(`<div><b>Notas:</b> ${escapeHtml(s.notes)}</div>`);
    return rows.length ? `<div class="muted" style="margin-top:6px; font-size:.82rem;">${rows.join('')}</div>` : '<span class="muted">—</span>';
  }

  function renderAssignTeamSuggestion(s = {}) {
    if (!assignTeamSuggestionEl) return;
    const roles = ['promoter','commercial','legal','tecnico','gerencia','socios','financiero','contable'];
    const rows = roles
      .map(r => {
        const list = Array.isArray(s?.[r]) ? s[r].filter(Boolean) : [];
        if (!list.length) return '';
        return `<div><b>${escapeHtml(ROLE_LABEL(r))}:</b> ${escapeHtml(list.join(', '))}</div>`;
      })
      .filter(Boolean);

    if (s?.notes) rows.push(`<div><b>Notas:</b> ${escapeHtml(s.notes)}</div>`);

    if (!rows.length) {
      assignTeamSuggestionEl.style.display = 'none';
      assignTeamSuggestionEl.innerHTML = '';
      return;
    }

    assignTeamSuggestionEl.innerHTML = `<div class="title">Equipo sugerido por el solicitante</div>${rows.join('')}`;
    assignTeamSuggestionEl.style.display = '';
  }

  function renderPendingProjects(list) {
    if (!pendingProjectsTbody) return;
    pendingProjectsTbody.innerHTML = '';
    if (!list.length) {
      pendingProjectsTbody.innerHTML = `<tr><td colspan="4" class="muted">No hay proyectos pendientes.</td></tr>`;
      return;
    }
    list.forEach((p) => {
      const tr = document.createElement('tr');
      const st = (p.publishStatus || 'pending').toLowerCase();
      tr.innerHTML = `
        <td>${p.name || '-'}</td>
        <td>
          <div>${p.description || '-'}</div>
          <div class="muted" style="font-size:.82rem;">Tipo: ${escapeHtml(p.projectType || 'No definido')}</div>
          ${teamSuggestionHtml(p.teamSuggestion)}
        </td>
        <td><span class="badge ${st}">${st.toUpperCase()}</span></td>
        <td>
          <div class="actions">
            <button class="btn small" data-project-approve="${p._id}">Aprobar</button>
            <button class="btn danger small" data-project-reject="${p._id}">Rechazar</button>
          </div>
        </td>
      `;
      pendingProjectsTbody.appendChild(tr);
    });
  }

  // ---------- RENDER: Proyectos (lista completa) ----------
  function renderAllProjects(list) {
  if (!allProjectsTbody) return;
  allProjectsTbody.innerHTML = '';
  allProjectsLastTotal = Array.isArray(list) ? list.length : 0;
  allProjectsPage = Math.min(allProjectsPage, maxPageFor(allProjectsLastTotal, allProjectsPageSize));
  if (allProjectsPage < 1) allProjectsPage = 1;

  if (allProjectsPagerInfo) allProjectsPagerInfo.textContent = pagerText(allProjectsPage, allProjectsLastTotal, allProjectsPageSize, 'proyectos');
  if (allProjectsPrev) allProjectsPrev.disabled = allProjectsPage <= 1;
  if (allProjectsNext) allProjectsNext.disabled = allProjectsPage >= maxPageFor(allProjectsLastTotal, allProjectsPageSize);

  if (!list.length) {
    allProjectsTbody.innerHTML = `<tr><td colspan="6" class="muted">No hay proyectos.</td></tr>`;
    return;
  }
  slicePage(list, allProjectsPage, allProjectsPageSize).forEach((p) => {
    const st = (p.publishStatus || 'pending').toLowerCase();
    const proms = (p.assignedPromoters || []).map(id => nameOf(promotersMap, id)).filter(Boolean);
    const comms = (p.assignedCommercials || []).map(id => nameOf(commercialsMap, id)).filter(Boolean);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.name || '-'}</td>
      <td>
        <div>${p.description || '-'}</div>
        <div class="muted" style="font-size:.82rem;">Tipo: ${escapeHtml(p.projectType || 'No definido')}</div>
      </td>
      <td><span class="badge ${st}">${st.toUpperCase()}</span></td>
      <td>${proms.length ? proms.join(', ') : '<span class="muted">—</span>'}</td>
      <td>${comms.length ? comms.join(', ') : '<span class="muted">—</span>'}</td>
      <td>
        <div class="actions">
          <a class="btn small" href="/project?id=${p._id}&ref=admin">Abrir</a>
          <button class="btn small" data-project-assign="${p._id}" data-project-name="${p.name||''}">Asignar equipo</button>
          <button class="btn small" data-project-edit="${p._id}">Editar</button>
          ${st === 'pending' ? `
            <button class="btn small" data-project-approve="${p._id}">Aprobar</button>
            <button class="btn danger small" data-project-reject="${p._id}">Rechazar</button>
          ` : ''}
          <button class="btn danger small" data-project-delete="${p._id}">Eliminar</button>
        </div>
      </td>
    `;
    allProjectsTbody.appendChild(tr);
  });
}

  function renderAuditLogs(payload = {}) {
    if (!auditTbody) return;

    const logs = Array.isArray(payload.logs) ? payload.logs : [];
    auditLastTotal = Number(payload.total || logs.length || 0);

    if (!logs.length) {
      auditTbody.innerHTML = `<tr><td colspan="7" class="muted">No hay actividad con estos filtros.</td></tr>`;
    } else {
      auditTbody.innerHTML = logs.map(log => {
        const status = String(log.status || 'success').toLowerCase();
        const actor = log.actorEmail || log.actorRole || '-';
        return `
          <tr>
            <td>${formatShortDate(log.createdAt)}</td>
            <td><span class="audit-action">${escapeHtml(actionLabel(log.action))}</span></td>
            <td>${escapeHtml(actor)}</td>
            <td><span class="badge audit-status ${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span></td>
            <td>${escapeHtml(targetText(log))}</td>
            <td>${escapeHtml(log.ip || '-')}</td>
            <td><div class="audit-detail" title="${escapeHtml(detailText(log))}">${escapeHtml(detailText(log))}</div></td>
          </tr>
        `;
      }).join('');
    }

    const failureCount = logs.filter(l => l.action === 'auth.login_failed' || l.status === 'failure').length;
    const docCount = logs.filter(l => String(l.action || '').startsWith('document.')).length;
    const latest = logs[0]?.createdAt ? formatTimeAgo(logs[0].createdAt) : '-';
    const maxPage = Math.max(1, Math.ceil(auditLastTotal / auditLimit));

    if (auditTotal) auditTotal.textContent = String(auditLastTotal);
    if (auditFailures) auditFailures.textContent = String(failureCount);
    if (auditDocs) auditDocs.textContent = String(docCount);
    if (auditLatest) auditLatest.textContent = latest;
    if (auditPagerInfo) auditPagerInfo.textContent = `Página ${auditPage} de ${maxPage} · ${auditLastTotal} eventos`;
    if (auditPrev) auditPrev.disabled = auditPage <= 1;
    if (auditNext) auditNext.disabled = auditPage >= maxPage;
  }

  // ---------- CARGAS ----------
  async function loadPendingUsers() {
    if (!pendingUsersTbody) return;
    try {
      const all = await apiGetUsers({ status: 'pending' });
      const list = all.filter(isPending);
      usersCache = usersCache.concat(list).filter((u, idx, arr) =>
        arr.findIndex(x => String(x._id) === String(u._id)) === idx
      );
      renderPendingUsers(list);
    } catch (e) {
      pendingUsersTbody.innerHTML = `<tr><td colspan="6" class="muted">Error al cargar: ${e.message}</td></tr>`;
    }
  }
  async function loadUsers() {
    if (!usersTbody) return;
    try {
      const status = usersStatusFilter?.value || '';
      let list = await apiGetUsers({ status });
      if (status) list = list.filter(u => userStatus(u) === status);
      usersCache = list;
      const q = (usersSearch?.value || '').trim().toLowerCase();
      if (q) {
        list = list.filter(u =>
          (u.name || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q)
        );
      }
      renderUsers(list);
    } catch (e) {
      if (msgEl) {
        msgEl.textContent = e.message || 'Error al cargar usuarios';
        msgEl.style.color = 'salmon';
      } else {
        console.error(e);
      }
    }
  }
  async function loadPendingProjects() {
    if (!pendingProjectsTbody) return;
    try {
      const list = await apiGetProjectsPending();
      renderPendingProjects(list);
    } catch (e) {
      pendingProjectsTbody.innerHTML = `<tr><td colspan="4" class="muted">Error al cargar: ${e.message}</td></tr>`;
    }
  }

  async function loadAllProjects() {
  if (!allProjectsTbody) return;
  try {
    await refreshAssigneesCaches(); // precarga nombres de equipo
    const list = await apiGetAllProjects('');
    allProjectsCache = Array.isArray(list) ? list : []; // guardamos la última carga
    renderAllProjects(applyProjectsFilters(allProjectsCache)); // render con filtros (incluye búsqueda)
  } catch (e) {
    allProjectsTbody.innerHTML = `<tr><td colspan="6" class="muted">Error al cargar: ${e.message}</td></tr>`;
  }
 }

 async function loadAuditLogs() {
  if (!auditTbody) return;
  auditTbody.innerHTML = `<tr><td colspan="7" class="muted">Cargando actividad...</td></tr>`;
  try {
    const payload = await apiGetAuditLogs();
    renderAuditLogs(payload);
  } catch (e) {
    auditTbody.innerHTML = `<tr><td colspan="7" class="muted">Error al cargar actividad: ${escapeHtml(e.message)}</td></tr>`;
  }
 }

 function createRoleSelect(role, candidates = [], preselectedIds = []) {
  const wrap = document.createElement('div');

  const label = document.createElement('label');
  label.className = 'small muted';
  label.textContent = ROLE_LABEL(role);

  // ✅ NUEVO: buscador por rol
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'input small';
  search.placeholder = `Buscar ${ROLE_LABEL(role)}...`;
  search.style.width = '100%';
  search.style.margin = '6px 0 8px 0';

  const sel = document.createElement('select');
  sel.className = 'input';
  sel.multiple = true;
  sel.size = 8;
  sel.style.width = '100%';
  sel.dataset.role = role;

  const setPre = new Set((preselectedIds || []).map(String));

  candidates.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u._id;
    opt.textContent = `${u.name || '(sin nombre)'} — ${u.email}`;
    opt.selected = setPre.has(String(u._id));
    sel.appendChild(opt);
  });

  // ✅ NUEVO: filtro de options
  const norm = (s) => (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  const applyFilter = () => {
    const q = norm(search.value);
    Array.from(sel.options).forEach(o => {
      if (!q) { o.hidden = false; return; }
      o.hidden = !norm(o.textContent).includes(q);
    });
  };

  // pequeño debounce para no recalcular cada tecla súper rápido
  let t = null;
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(applyFilter, 100);
  });

  wrap.appendChild(label);
  wrap.appendChild(search); // 👈 encima del select
  wrap.appendChild(sel);

  return wrap;
}

  function dashboardRepeatRow(kind, item = {}) {
    if (kind === 'board') return `<div class="create-repeat-row" data-ep-board-row style="display:grid;grid-template-columns:repeat(3,1fr) auto;gap:8px;margin-bottom:8px;">
      <label class="small muted">Nombre<input class="input" data-ep-board="name" value="${escapeHtml(item.name || '')}"></label>
      <label class="small muted">Cedula<input class="input" data-ep-board="cedula" value="${escapeHtml(item.cedula || '')}"></label>
      <label class="small muted">Puesto<input class="input" data-ep-board="position" value="${escapeHtml(item.position || '')}"></label>
      <button class="btn small" type="button" data-remove-ep-row>Quitar</button>
    </div>`;
    return `<div class="create-repeat-row" data-ep-shareholder-row style="display:grid;grid-template-columns:repeat(3,1fr) auto;gap:8px;margin-bottom:8px;">
      <label class="small muted">Nombre<input class="input" data-ep-shareholder="name" value="${escapeHtml(item.name || '')}"></label>
      <label class="small muted">Cedula<input class="input" data-ep-shareholder="cedula" value="${escapeHtml(item.cedula || '')}"></label>
      <label class="small muted">Porcentaje<input class="input" data-ep-shareholder="percentage" type="number" step="any" value="${item.percentage ?? ''}"></label>
      <button class="btn small" type="button" data-remove-ep-row>Quitar</button>
    </div>`;
  }

  function isValidBankNumberText(value) {
    const text = String(value || '').trim();
    if (!text) return true;
    if (!/^\d{1,3}(,\d{3})*(\.\d+)?$/.test(text) && !/^\d+(\.\d+)?$/.test(text)) return false;
    const integer = text.split('.')[0];
    return integer.length < 4 || /^\d{1,3}(,\d{3})+$/.test(integer);
  }

  function parseBankNumber(value) {
    const text = String(value || '').trim();
    if (!text) return 0;
    if (!isValidBankNumberText(text)) return NaN;
    const n = Number(text.replace(/,/g, ''));
    return Number.isFinite(n) ? n : NaN;
  }

  function parseBankNumberLive(value) {
    const text = String(value || '').trim();
    if (!text) return 0;
    if (!/^[\d,]*\.?\d*$/.test(text)) return NaN;
    const n = Number(text.replace(/,/g, ''));
    return Number.isFinite(n) ? n : NaN;
  }

  function formatBankNumber(value, decimals = 2) {
    const n = typeof value === 'number' ? value : parseBankNumber(value);
    if (!Number.isFinite(n)) return '';
    const hasDecimals = Math.abs(n % 1) > 0;
    return n.toLocaleString('en-US', {
      minimumFractionDigits: hasDecimals ? decimals : 0,
      maximumFractionDigits: decimals
    });
  }

  function formatPercentNumber(value) {
    return formatBankNumber(value, 4).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }

  function bindBankNumberFormatting(root = document) {
    root.querySelectorAll('[data-bank-number]').forEach(input => {
      if (input.__bankFormatBound) return;
      input.__bankFormatBound = true;
      input.addEventListener('blur', () => {
        if (!String(input.value || '').trim()) return;
        const n = parseBankNumber(input.value);
        if (Number.isFinite(n)) input.value = formatBankNumber(n);
      });
    });
  }

  function validateBankNumberInputs(root = document) {
    const bad = Array.from(root.querySelectorAll('[data-bank-number]')).find(input => !isValidBankNumberText(input.value));
    if (bad) {
      bad.focus();
      alert('Formato numerico invalido. Usa comas para miles y punto para decimales, por ejemplo 1,250,000.75.');
      return false;
    }
    return true;
  }

  function dashboardModelRow(item = {}) {
    const statuses = item.initialStatuses || {};
    return `<div data-ep-model-row style="border:1px solid #2a323d;border-radius:10px;padding:10px;margin-bottom:10px;">
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
        <label class="small muted">Modelo<input class="input" data-ep-model="name" value="${escapeHtml(item.name || '')}"></label>
        <label class="small muted">Recamaras<input class="input" data-ep-model="bedrooms" type="number" step="1" value="${item.bedrooms ?? ''}"></label>
        <label class="small muted">Banos<input class="input" data-ep-model="bathrooms" type="number" step="any" value="${item.bathrooms ?? ''}"></label>
        <label class="small muted">Unidades<input class="input" data-ep-model="unitsCount" type="number" step="1" value="${item.unitsCount ?? ''}"></label>
        <label class="small muted">Area abierta<input class="input" data-ep-model="openAreaM2" data-bank-number type="text" inputmode="decimal" value="${item.openAreaM2 ? formatBankNumber(item.openAreaM2) : ''}"></label>
        <label class="small muted">Area cerrada<input class="input" data-ep-model="closedAreaM2" data-bank-number type="text" inputmode="decimal" value="${item.closedAreaM2 ? formatBankNumber(item.closedAreaM2) : ''}"></label>
        <label class="small muted">Precio<input class="input" data-ep-model="price" data-bank-number type="text" inputmode="decimal" value="${item.price ? formatBankNumber(item.price) : ''}"></label>
        <label class="small muted">Observaciones<input class="input" data-ep-model="observations" value="${escapeHtml(item.observations || '')}"></label>
      </div>
      <div style="border:1px solid #1d4ed8;background:#0b1730;border-radius:10px;padding:10px;margin-top:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
          <strong class="small">Estados iniciales de unidades</strong>
          <span class="small muted" data-ep-model-summary>Define cantidad de unidades por estado</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
          ${[
            ['disponible','Disponible'],['inventario','Inventario'],['reservado','Reservado'],['con_cpp','Con CPP o venta al contado'],
            ['tramite_legal_activado','Trámite legal activado'],['escriturado_traspasado','Escriturado / Traspasado'],['vivienda_entregada','Vivienda entregada']
          ].map(([key,label]) => `<label class="small muted">${label}<input class="input" data-ep-model-status="${key}" type="number" step="1" value="${statuses[key] ?? ''}"></label>`).join('')}
          <button class="btn small" type="button" data-remove-ep-model>Quitar</button>
        </div>
      </div>
      <div class="small muted" data-ep-model-warning></div>
    </div>`;
  }

  function dashboardPhaseRow(index, item = {}) {
    const lines = (kind, rows = []) => (rows.length ? rows : [{ name: '', amount: '' }]).map(row => `
      <div data-ep-phase-line="${kind}" style="display:grid;grid-template-columns:1fr 130px;gap:8px;margin-bottom:6px;">
        <input class="input" data-ep-phase-line-name value="${escapeHtml(row.name || '')}" placeholder="Concepto">
        <input class="input" data-ep-phase-line-amount data-bank-number type="text" inputmode="decimal" value="${row.amount ? formatBankNumber(row.amount) : ''}" placeholder="Monto">
      </div>`).join('');
    return `<details open data-ep-phase-row="${index}" style="border:1px solid #2a323d;border-radius:10px;padding:10px;margin-bottom:10px;">
      <summary>Fase ${index + 1}</summary>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
        <label class="small muted">Nombre<input class="input" data-ep-phase="name" value="${escapeHtml(item.name || `Fase ${index + 1}`)}"></label>
        <label class="small muted" style="grid-column:1/-1">Usos estimados<div data-ep-phase-box="planUses">${lines('planUses', item.planUses || [])}</div><button class="btn small" type="button" data-add-ep-phase-line="planUses">+ Uso</button></label>
        <div class="small muted" style="grid-column:1/-1;border:1px solid #1d4ed8;background:#0b1730;border-radius:10px;padding:10px;" data-ep-phase-sources-summary>
          <strong>Fuentes estimadas automaticas</strong>
          <div style="margin-top:6px;">Total usos: <b data-phase-total-uses>0</b> · Banco: <b data-phase-bank-source>0</b> · Promotor: <b data-phase-promoter-source>0</b> · Total fuentes: <b data-phase-total-sources>0</b></div>
        </div>
      </div>
    </details>`;
  }

  const dashNum = (value) => {
    if (value === '' || value === null || value === undefined) return 0;
    const n = parseBankNumberLive(value);
    return Number.isFinite(n) ? n : 0;
  };

  function collectEditLegalData() {
    return {
      promoterLegalName: document.getElementById('ep-ld-promoterLegalName')?.value?.trim() || '',
      interimBank: document.getElementById('ep-ld-interimBank')?.value?.trim() || '',
      trustApplies: document.getElementById('ep-ld-trustApplies')?.value === 'true',
      trustName: document.getElementById('ep-ld-trustName')?.value?.trim() || '',
      boardMembers: Array.from(document.querySelectorAll('[data-ep-board-row]')).map(row => ({
        name: row.querySelector('[data-ep-board="name"]')?.value.trim() || '',
        cedula: row.querySelector('[data-ep-board="cedula"]')?.value.trim() || '',
        position: row.querySelector('[data-ep-board="position"]')?.value.trim() || ''
      })),
      shareholders: Array.from(document.querySelectorAll('[data-ep-shareholder-row]')).map(row => ({
        name: row.querySelector('[data-ep-shareholder="name"]')?.value.trim() || '',
        cedula: row.querySelector('[data-ep-shareholder="cedula"]')?.value.trim() || '',
        percentage: dashNum(row.querySelector('[data-ep-shareholder="percentage"]')?.value)
      }))
    };
  }

  function collectEditTechnicalData() {
    return {
      phasesCount: dashNum(document.getElementById('ep-td-phasesCount')?.value),
      totalUnits: dashNum(document.getElementById('ep-td-totalUnits')?.value),
      notes: document.getElementById('ep-td-notes')?.value?.trim() || ''
    };
  }

  function collectEditHousingModels() {
    return Array.from(document.querySelectorAll('[data-ep-model-row]')).map(row => ({
      name: row.querySelector('[data-ep-model="name"]')?.value.trim() || '',
      bedrooms: dashNum(row.querySelector('[data-ep-model="bedrooms"]')?.value),
      bathrooms: dashNum(row.querySelector('[data-ep-model="bathrooms"]')?.value),
      unitsCount: dashNum(row.querySelector('[data-ep-model="unitsCount"]')?.value),
      openAreaM2: dashNum(row.querySelector('[data-ep-model="openAreaM2"]')?.value),
      closedAreaM2: dashNum(row.querySelector('[data-ep-model="closedAreaM2"]')?.value),
      price: dashNum(row.querySelector('[data-ep-model="price"]')?.value),
      observations: row.querySelector('[data-ep-model="observations"]')?.value.trim() || '',
      initialStatuses: Object.fromEntries(Array.from(row.querySelectorAll('[data-ep-model-status]')).map(input => [
        input.dataset.epModelStatus,
        dashNum(input.value)
      ]))
    })).filter(item => item.name || item.unitsCount || item.price || item.openAreaM2 || item.closedAreaM2);
  }

  function syncEditModelStatusRow(row, { autoFill = false } = {}) {
    if (!row) return true;
    const total = dashNum(row.querySelector('[data-ep-model="unitsCount"]')?.value);
    const inputs = Array.from(row.querySelectorAll('[data-ep-model-status]'));
    let values = inputs.map(input => Math.max(0, Math.round(dashNum(input.value))));
    let statusTotal = values.reduce((sum, value) => sum + value, 0);

    if (autoFill && total > 0 && statusTotal < total) {
      const emptyInputs = inputs.filter(input => String(input.value || '').trim() === '');
      if (emptyInputs.length === inputs.length) {
        emptyInputs[0].value = total;
      } else if (emptyInputs.length === 1) {
        emptyInputs[0].value = total - statusTotal;
      }
      values = inputs.map(input => Math.max(0, Math.round(dashNum(input.value))));
      statusTotal = values.reduce((sum, value) => sum + value, 0);
    }

    const remaining = total - statusTotal;
    const summary = row.querySelector('[data-ep-model-summary]');
    const warning = row.querySelector('[data-ep-model-warning]');
    if (summary) {
      summary.textContent = total
        ? `Total ${total} · Asignadas ${statusTotal} · Restantes ${Math.max(remaining, 0)}`
        : 'Define primero la cantidad total de unidades';
      summary.style.color = remaining < 0 ? '#fca5a5' : (remaining === 0 && total ? '#86efac' : '#cbd5e1');
    }
    if (warning) {
      if (!total) {
        warning.textContent = 'Cuando indiques el total, este bloque calcula automaticamente las unidades restantes.';
        warning.style.color = '';
      } else if (remaining > 0) {
        warning.textContent = `Faltan ${remaining} unidades por asignar a algun estado. Si dejas una sola casilla vacia, se completa automaticamente.`;
        warning.style.color = '#fde68a';
      } else if (remaining < 0) {
        warning.textContent = `Te pasaste por ${Math.abs(remaining)} unidades. Ajusta el reparto antes de guardar.`;
        warning.style.color = '#fca5a5';
      } else {
        warning.textContent = 'Reparto completo: la suma de estados coincide con el total.';
        warning.style.color = '#86efac';
      }
    }
    return !total || statusTotal === total || statusTotal === 0;
  }

  function validateEditModelStatuses(alertOnError = false) {
    for (const row of Array.from(document.querySelectorAll('[data-ep-model-row]'))) {
      syncEditModelStatusRow(row);
      const total = dashNum(row.querySelector('[data-ep-model="unitsCount"]')?.value);
      const statusTotal = Array.from(row.querySelectorAll('[data-ep-model-status]')).reduce((sum, input) => sum + dashNum(input.value), 0);
      const ok = !total || !statusTotal || total === statusTotal;
      if (!ok) {
        if (alertOnError) alert('La suma de estados por modelo debe coincidir con la cantidad de unidades.');
        return false;
      }
    }
    return true;
  }

  function collectEditPhaseLines(row, kind) {
    return Array.from(row.querySelectorAll(`[data-ep-phase-line="${kind}"]`)).map(line => ({
      name: line.querySelector('[data-ep-phase-line-name]')?.value.trim() || '',
      amount: dashNum(line.querySelector('[data-ep-phase-line-amount]')?.value)
    })).filter(item => item.name || item.amount);
  }

  function currentEditFinancialNumbers() {
    return {
      total: dashNum(document.getElementById('ep-fc-projectTotal')?.value),
      bankAmount: dashNum(document.getElementById('ep-fc-bankFinancedAmount')?.value),
      bankPct: dashNum(document.getElementById('ep-fc-bankFinancedPct')?.value),
      promoterAmount: dashNum(document.getElementById('ep-fc-promoterContribution')?.value),
      promoterPct: dashNum(document.getElementById('ep-fc-promoterContributionPct')?.value)
    };
  }

  function editPhaseUsesTotal(row) {
    return collectEditPhaseLines(row, 'planUses').reduce((sum, item) => sum + dashNum(item.amount), 0);
  }

  function autoEditPhaseSourcesForUses(usesTotal, financial = currentEditFinancialNumbers()) {
    const bank = usesTotal * dashNum(financial.bankPct) / 100;
    const promoter = usesTotal * dashNum(financial.promoterPct) / 100;
    return [
      { name: 'Banco', amount: Math.round(bank * 100) / 100 },
      { name: 'Promotor', amount: Math.round(promoter * 100) / 100 }
    ];
  }

  function syncEditPhaseSources() {
    const financial = currentEditFinancialNumbers();
    let totalUsesAll = 0;
    let totalBankAll = 0;
    let totalPromoterAll = 0;
    document.querySelectorAll('[data-ep-phase-row]').forEach(row => {
      const usesTotal = editPhaseUsesTotal(row);
      const sources = autoEditPhaseSourcesForUses(usesTotal, financial);
      const bank = dashNum(sources.find(item => item.name === 'Banco')?.amount);
      const promoter = dashNum(sources.find(item => item.name === 'Promotor')?.amount);
      const total = bank + promoter;
      totalUsesAll += usesTotal;
      totalBankAll += bank;
      totalPromoterAll += promoter;
      const setText = (selector, value) => {
        const el = row.querySelector(selector);
        if (el) el.textContent = formatBankNumber(value);
      };
      setText('[data-phase-total-uses]', usesTotal);
      setText('[data-phase-bank-source]', bank);
      setText('[data-phase-promoter-source]', promoter);
      setText('[data-phase-total-sources]', total);
    });
    renderEditPhasesGlobalSummary({
      totalUses: totalUsesAll,
      totalBank: totalBankAll,
      totalPromoter: totalPromoterAll,
      financial
    });
  }

  function ensureEditPhasesGlobalSummary() {
    const box = document.getElementById('ep-financePhases');
    if (!box) return null;
    let el = document.getElementById('epFinancePhasesSummary');
    if (!el) {
      el = document.createElement('div');
      el.id = 'epFinancePhasesSummary';
      el.style.cssText = 'border:1px solid #1d4ed8;background:#0b1730;border-radius:10px;padding:10px;margin:0 0 10px;color:#e6edf3;';
      box.parentNode?.insertBefore(el, box);
    }
    return el;
  }

  function renderEditPhasesGlobalSummary({ totalUses, totalBank, totalPromoter, financial }) {
    const el = ensureEditPhasesGlobalSummary();
    if (!el) return;
    const diff = dashNum(financial.total) - dashNum(totalUses);
    const ok = Math.abs(diff) <= 0.05 && financial.total > 0;
    el.innerHTML = `
      <strong>Resumen de fases</strong>
      <div class="small" style="margin-top:6px;">
        Usos fases: <b>${formatBankNumber(totalUses)}</b> · Banco: <b>${formatBankNumber(totalBank)}</b> · Promotor: <b>${formatBankNumber(totalPromoter)}</b> · Total fuentes: <b>${formatBankNumber(totalBank + totalPromoter)}</b>
      </div>
      <div class="small" style="margin-top:4px;color:${ok ? '#86efac' : '#fde68a'};">
        ${financial.total ? (ok ? 'Las fases coinciden con el total del proyecto.' : `Diferencia contra total del proyecto: ${formatBankNumber(diff)}`) : 'Indica el total del proyecto para comparar la suma de fases.'}
      </div>
    `;
  }

  function collectEditFinancePhases() {
    const financial = currentEditFinancialNumbers();
    return Array.from(document.querySelectorAll('[data-ep-phase-row]')).map((row, idx) => ({
      name: row.querySelector('[data-ep-phase="name"]')?.value.trim() || `Fase ${idx + 1}`,
      planUses: collectEditPhaseLines(row, 'planUses'),
      planSources: autoEditPhaseSourcesForUses(editPhaseUsesTotal(row), financial)
    }));
  }

  function syncEditFinancePhases(phases) {
    const box = document.getElementById('ep-financePhases');
    if (!box) return;
    const current = Array.isArray(phases) ? phases : collectEditFinancePhases();
    const count = Math.max(dashNum(document.getElementById('ep-td-phasesCount')?.value), current.length);
    box.innerHTML = Array.from({ length: count }, (_, idx) => dashboardPhaseRow(idx, current[idx] || {})).join('');
    bindBankNumberFormatting(box);
    syncEditPhaseSources();
  }

  function syncEditFinancialTriplet(sourceId = '') {
    const totalEl = document.getElementById('ep-fc-projectTotal');
    const amountEl = document.getElementById('ep-fc-bankFinancedAmount');
    const pctEl = document.getElementById('ep-fc-bankFinancedPct');
    const promoterEl = document.getElementById('ep-fc-promoterContribution');
    const promoterPctEl = document.getElementById('ep-fc-promoterContributionPct');
    const total = dashNum(totalEl?.value);
    let amount = dashNum(amountEl?.value);
    let pct = dashNum(pctEl?.value);
    let promoter = dashNum(promoterEl?.value);
    let promoterPct = dashNum(promoterPctEl?.value);
    if (!total) return;
    pct = Math.min(Math.max(pct, 0), 100);
    promoterPct = Math.min(Math.max(promoterPct, 0), 100);

    if (sourceId === 'ep-fc-bankFinancedPct') amount = total * pct / 100;
    else if (sourceId === 'ep-fc-promoterContributionPct') {
      promoter = total * promoterPct / 100;
      amount = total - promoter;
    } else if (sourceId === 'ep-fc-promoterContribution') {
      promoter = Math.min(Math.max(promoter, 0), total);
      amount = total - promoter;
    } else if (sourceId === 'ep-fc-bankFinancedAmount') {
      amount = Math.min(Math.max(amount, 0), total);
      promoter = total - amount;
    } else if (sourceId === 'ep-fc-projectTotal') {
      if (pct) amount = total * pct / 100;
      else if (amount) amount = Math.min(amount, total);
      else if (promoter) amount = total - Math.min(promoter, total);
    }

    amount = Math.min(Math.max(amount, 0), total);
    promoter = Math.max(total - amount, 0);
    pct = total ? amount / total * 100 : 0;
    promoterPct = total ? promoter / total * 100 : 0;

    if (amountEl) amountEl.value = formatBankNumber(amount);
    if (pctEl) pctEl.value = formatPercentNumber(pct);
    if (promoterEl) promoterEl.value = formatBankNumber(promoter);
    if (promoterPctEl) promoterPctEl.value = formatPercentNumber(promoterPct);
    syncEditPhaseSources();
  }

  function validateEditFinancePhases(alertOnError = false) {
    const financial = currentEditFinancialNumbers();
    const phases = collectEditFinancePhases();
    const usesTotal = phases.reduce((sum, phase) => sum + phase.planUses.reduce((a, item) => a + dashNum(item.amount), 0), 0);
    const bankTotal = phases.reduce((sum, phase) => sum + dashNum(phase.planSources.find(item => item.name === 'Banco')?.amount), 0);
    const promoterTotal = phases.reduce((sum, phase) => sum + dashNum(phase.planSources.find(item => item.name === 'Promotor')?.amount), 0);
    const close = (a, b) => Math.abs(dashNum(a) - dashNum(b)) <= 0.05;
    const fail = (message) => {
      if (alertOnError) alert(message);
      return false;
    };
    if (financial.total > 0 && phases.length && !close(usesTotal, financial.total)) {
      return fail(`La suma de usos por fase (${formatBankNumber(usesTotal)}) debe coincidir con el total del proyecto (${formatBankNumber(financial.total)}).`);
    }
    if (financial.bankAmount > 0 && phases.length && !close(bankTotal, financial.bankAmount)) {
      return fail(`La suma de fuentes Banco por fase (${formatBankNumber(bankTotal)}) debe coincidir con el monto banco (${formatBankNumber(financial.bankAmount)}).`);
    }
    if (financial.promoterAmount > 0 && phases.length && !close(promoterTotal, financial.promoterAmount)) {
      return fail(`La suma de fuentes Promotor por fase (${formatBankNumber(promoterTotal)}) debe coincidir con el aporte promotor (${formatBankNumber(financial.promoterAmount)}).`);
    }
    for (const phase of phases) {
      const uses = phase.planUses.reduce((a, item) => a + dashNum(item.amount), 0);
      const sources = phase.planSources.reduce((a, item) => a + dashNum(item.amount), 0);
      if (!close(uses, sources)) return fail(`En ${phase.name}, total usos (${formatBankNumber(uses)}) debe coincidir con total fuentes (${formatBankNumber(sources)}).`);
    }
    return true;
  }

  // ---- Modal de edición (inyectado si no existe) ----
  function ensureEditModal() {
    if (document.getElementById('editProjectModal')) return;

    const wrap = document.createElement('div');
    wrap.id = 'editProjectModal';
    wrap.style.cssText = 'display:none;position:fixed;inset:0;background:#0009;z-index:9999;align-items:center;justify-content:center;';
    wrap.innerHTML = `
  <div style="background:#12181f;color:#e6edf3;width:min(820px,94vw);max-height:90vh;overflow:auto;border-radius:12px;padding:16px 18px;box-shadow:0 10px 30px rgba(0,0,0,.4);">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;">
      <h3 style="margin:0;font-size:1.1rem;">Editar proyecto</h3>
      <button id="editProjClose" class="btn small" style="background:#2a323d;">Cerrar</button>
    </div>

    <div>
      <label class="small muted">Nombre</label>
      <input id="editProjName" class="input" type="text" maxlength="200" />
    </div>

    <div style="margin-top:10px;">
      <label class="small muted">Descripción</label>
      <textarea id="editProjDesc" class="input" rows="6" maxlength="20000" style="resize:vertical;"></textarea>
    </div>

    <div style="margin-top:10px;">
      <label class="small muted">Tipo de proyecto</label>
      <select id="editProjType" class="input">
        ${renderProjectTypeOptions('')}
      </select>
    </div>

    <div style="margin-top:10px;">
      <label class="small muted">Ubicacion / direccion del proyecto</label>
      <input id="editProjLocation" class="input" type="text" />
    </div>

    <!-- NUEVO: KPIs -->
    <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div>
        <div class="small muted" style="margin-bottom:6px;">KPIs iniciales</div>

        <label class="small muted">Loan aprobado</label>
        <input id="ep-loanApproved" class="input" type="number" step="any" />

        <label class="small muted" style="margin-top:8px;">Desembolsado</label>
        <input id="ep-loanDisbursed" class="input" type="number" step="any" />

        <label class="small muted" style="margin-top:8px;">Saldo loan</label>
        <input id="ep-loanBalance" class="input" type="number" step="any" />
      </div>

      <div>
        <label class="small muted">Budget aprobado</label>
        <input id="ep-budgetApproved" class="input" type="number" step="any" />

        <label class="small muted" style="margin-top:8px;">Gasto</label>
        <input id="ep-budgetSpent" class="input" type="number" step="any" />

        <label class="small muted" style="margin-top:8px;">Unidades totales</label>
        <input id="ep-unitsTotal" class="input" type="number" step="1" />

        <label class="small muted" style="margin-top:8px;">Unidades vendidas</label>
        <input id="ep-unitsSold" class="input" type="number" step="1" />
      </div>
    </div>

    <details style="margin-top:14px;">
      <summary class="small muted">Condiciones financieras</summary>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;max-height:260px;overflow:auto;">
        ${[
          ['projectTotal','Total del proyecto','number'],['bankFinancedAmount','Monto banco','number'],['bankFinancedPct','% banco','number'],
          ['promoterContribution','Aporte promotor','number'],['promoterContributionPct','% promotor','number'],['interestRate','Tasa de interés','number'],
          ['term','Plazo','text'],['paymentMethod','Forma de pago','text'],['commission','Comisión','text'],
          ['disbursementMethod','Forma de desembolso','text'],['disbursementConditions','Condiciones desembolso','text'],
          ['amortizationConditions','Condiciones amortización','text'],['requiredPresales','Preventa requerida','text'],
          ['guarantees','Garantías','text'],['insurance','Seguros','text']
        ].map(([key,label,type]) => `<label class="small muted">${label}<input id="ep-fc-${key}" class="input" type="${type === 'number' ? 'text' : type}" ${['projectTotal','bankFinancedAmount','promoterContribution'].includes(key) ? 'data-bank-number inputmode="decimal"' : (type === 'number' ? 'inputmode="decimal"' : '')}></label>`).join('')}
      </div>
      <h4 style="margin:12px 0 8px;">Condiciones precedentes</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;">
        ${[['presalesMet','Preventa cumplida'],['constructionPermitsApproved','Permisos construcción'],['plansApproved','Planos aprobados'],['insuranceDelivered','Seguros entregados'],['guaranteesConstituted','Garantías constituidas'],['environmentalStudyApproved','Estudio ambiental'],['trustConstituted','Fideicomiso constituido'],['otherRequirementsMet','Otros requisitos']].map(([key,label]) => `<label class="small muted"><input type="checkbox" data-ep-precedent="${key}"> ${label}</label>`).join('')}
      </div>
      <label class="small muted">Detalle otros requisitos<textarea id="ep-fc-otherRequirements" class="input" rows="2"></textarea></label>
      <h4 style="margin:12px 0 8px;">Estructura de la operación</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        ${[['trustee','Fiduciaria'],['trustType','Tipo de fideicomiso'],['technicalInspector','Inspector técnico'],['financialInspector','Inspector financiero']].map(([key,label]) => `<label class="small muted">${label}<input id="ep-op-${key}" class="input"></label>`).join('')}
      </div>
    </details>

    <details style="margin-top:14px;">
      <summary class="small muted">Datos legales</summary>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
        <label class="small muted">Promotor / sociedad<input id="ep-ld-promoterLegalName" class="input"></label>
        <label class="small muted">Banco interino<input id="ep-ld-interimBank" class="input"></label>
        <label class="small muted">Fideicomiso<select id="ep-ld-trustApplies" class="input"><option value="false">No aplica</option><option value="true">Aplica</option></select></label>
        <label class="small muted">Nombre fideicomiso<input id="ep-ld-trustName" class="input"></label>
      </div>
      <h4 style="margin:12px 0 8px;">Junta directiva</h4>
      <div id="ep-boardMembers"></div>
      <button id="ep-add-board" class="btn small" type="button">+ Anadir directivo</button>
      <h4 style="margin:12px 0 8px;">Accionistas</h4>
      <div id="ep-shareholders"></div>
      <button id="ep-add-shareholder" class="btn small" type="button">+ Anadir accionista</button>
    </details>

    <details style="margin-top:14px;">
      <summary class="small muted">Datos tecnicos, modelos y estados</summary>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
        <label class="small muted">Numero de fases<input id="ep-td-phasesCount" class="input" type="number" step="1"></label>
        <label class="small muted">Total unidades<input id="ep-td-totalUnits" class="input" type="number" step="1"></label>
        <label class="small muted" style="grid-column:1/-1">Notas tecnicas<textarea id="ep-td-notes" class="input" rows="2"></textarea></label>
      </div>
      <h4 style="margin:12px 0 8px;">Modelos</h4>
      <div id="ep-housingModels"></div>
      <button id="ep-add-model" class="btn small" type="button">+ Anadir modelo</button>
    </details>

    <details style="margin-top:14px;">
      <summary class="small muted">Fases, usos y fuentes</summary>
      <div id="ep-financePhases" style="margin-top:10px;"></div>
    </details>

    <div style="margin-top:14px;display:flex;gap:10px;justify-content:flex-end;">
      <button id="editProjCancel" class="btn">Cancelar</button>
      <button id="editProjSave" class="btn small">Guardar</button>
    </div>
  </div>
`;

    document.body.appendChild(wrap);

    // Handlers básicos
    document.getElementById('editProjClose').addEventListener('click', () => { wrap.style.display = 'none'; });
    document.getElementById('editProjCancel').addEventListener('click', () => { wrap.style.display = 'none'; });
    bindBankNumberFormatting(wrap);
    ['ep-fc-projectTotal','ep-fc-bankFinancedAmount','ep-fc-bankFinancedPct','ep-fc-promoterContribution','ep-fc-promoterContributionPct'].forEach(fieldId => {
      document.getElementById(fieldId)?.addEventListener('input', () => syncEditFinancialTriplet(fieldId));
    });
    document.getElementById('ep-add-board')?.addEventListener('click', () => document.getElementById('ep-boardMembers')?.insertAdjacentHTML('beforeend', dashboardRepeatRow('board')));
    document.getElementById('ep-add-shareholder')?.addEventListener('click', () => document.getElementById('ep-shareholders')?.insertAdjacentHTML('beforeend', dashboardRepeatRow('shareholder')));
    document.getElementById('ep-add-model')?.addEventListener('click', () => {
      document.getElementById('ep-housingModels')?.insertAdjacentHTML('beforeend', dashboardModelRow());
      bindBankNumberFormatting(document.getElementById('ep-housingModels') || document);
    });
    document.getElementById('ep-td-phasesCount')?.addEventListener('input', syncEditFinancePhases);
    ['ep-boardMembers','ep-shareholders','ep-housingModels'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', event => {
        event.target.closest('[data-remove-ep-row]')?.closest('.create-repeat-row')?.remove();
        event.target.closest('[data-remove-ep-model]')?.closest('[data-ep-model-row]')?.remove();
        validateEditModelStatuses();
      });
      document.getElementById(id)?.addEventListener('input', () => {
        document.getElementById('ep-housingModels')?.querySelectorAll('[data-ep-model-row]').forEach(row => syncEditModelStatusRow(row, { autoFill: true }));
      });
    });
    document.getElementById('ep-financePhases')?.addEventListener('click', event => {
      const btn = event.target.closest('[data-add-ep-phase-line]');
      if (!btn) return;
      const kind = btn.dataset.addEpPhaseLine;
      btn.closest('[data-ep-phase-row]')?.querySelector(`[data-ep-phase-box="${kind}"]`)?.insertAdjacentHTML('beforeend', `
        <div data-ep-phase-line="${kind}" style="display:grid;grid-template-columns:1fr 130px;gap:8px;margin-bottom:6px;">
          <input class="input" data-ep-phase-line-name placeholder="Concepto">
          <input class="input" data-ep-phase-line-amount data-bank-number type="text" inputmode="decimal" placeholder="Monto">
        </div>`);
      bindBankNumberFormatting(document.getElementById('ep-financePhases') || document);
      syncEditPhaseSources();
    });
    document.getElementById('ep-financePhases')?.addEventListener('input', syncEditPhaseSources);
    document.getElementById('ep-financePhases')?.addEventListener('change', syncEditPhaseSources);
    document.getElementById('ep-financePhases')?.addEventListener('keyup', syncEditPhaseSources);
    document.addEventListener('input', event => {
      if (event.target?.matches?.('[data-ep-phase-line-amount], [data-ep-phase-line-name]')) syncEditPhaseSources();
    }, true);

    // Guardar
    document.getElementById('editProjSave').addEventListener('click', async () => {
      const id = wrap.dataset.projectId;
      if (!id) return;

      const name = document.getElementById('editProjName').value.trim();
      const description = document.getElementById('editProjDesc').value.trim();
      const projectType = document.getElementById('editProjType')?.value || '';

      // Puedes permitir nombre vacío si quieres; por defecto, exigimos nombre.
      if (!name) { alert('El nombre no puede estar vacío'); return; }

      try {
  const payload = {
    name,
    description,
    projectType,
    location: document.getElementById('editProjLocation')?.value?.trim() || ''
  };

  // helper para añadir números sólo si hay valor
  const num = (id) => {
    const v = document.getElementById(id)?.value;
    return (v === '' || v === null || v === undefined) ? null : parseBankNumber(v);
  };
  const add = (key, id) => {
    const v = num(id);
    if (v !== null && !Number.isNaN(v)) payload[key] = v;
  };

  add('loanApproved',    'ep-loanApproved');
  add('loanDisbursed',   'ep-loanDisbursed');
  add('loanBalance',     'ep-loanBalance');
  add('budgetApproved',  'ep-budgetApproved');
  add('budgetSpent',     'ep-budgetSpent');
  add('unitsTotal',      'ep-unitsTotal');
  add('unitsSold',       'ep-unitsSold');

  if (!validateBankNumberInputs(wrap)) return;
  syncEditFinancialTriplet('ep-fc-projectTotal');
  const conditionNumbers = ['projectTotal','bankFinancedAmount','bankFinancedPct','promoterContribution','promoterContributionPct','interestRate'];
  const conditionTexts = ['term','paymentMethod','commission','disbursementMethod','disbursementConditions','amortizationConditions','requiredPresales','guarantees','insurance'];
  payload.financialConditions = {};
  conditionNumbers.forEach(key => {
    const value = num(`ep-fc-${key}`);
    if (value !== null && !Number.isNaN(value)) payload.financialConditions[key] = value;
  });
  conditionTexts.forEach(key => { payload.financialConditions[key] = document.getElementById(`ep-fc-${key}`)?.value?.trim() || ''; });
  payload.financialConditions.facilities = [];
  payload.financialConditions.precedentConditions = {};
  document.querySelectorAll('[data-ep-precedent]').forEach(input => { payload.financialConditions.precedentConditions[input.dataset.epPrecedent] = input.checked; });
  payload.financialConditions.precedentConditions.otherRequirements = document.getElementById('ep-fc-otherRequirements')?.value?.trim() || '';
  payload.financialConditions.operationStructure = {
    trustee: document.getElementById('ep-op-trustee')?.value?.trim() || '',
    trustType: document.getElementById('ep-op-trustType')?.value?.trim() || '',
    technicalInspector: document.getElementById('ep-op-technicalInspector')?.value?.trim() || '',
    financialInspector: document.getElementById('ep-op-financialInspector')?.value?.trim() || ''
  };
  payload.legalData = collectEditLegalData();
  payload.technicalData = collectEditTechnicalData();
  payload.housingModels = collectEditHousingModels();
  if (!validateEditModelStatuses(true)) return;
  if (!validateEditFinancePhases(true)) return;
  payload.financePhases = collectEditFinancePhases();

  await apiUpdateProject(id, payload);
  wrap.style.display = 'none';
  await loadAllProjects();
  alert('Proyecto actualizado.');
} catch (e) {
  alert(e.message || 'No se pudo actualizar el proyecto');
}

    });
  }


  function ensurePromoterProfileModal() {
    if (document.getElementById('promoterProfileModal')) return;

    const wrap = document.createElement('div');
    wrap.id = 'promoterProfileModal';
    wrap.style.cssText = 'display:none;position:fixed;inset:0;background:#0009;z-index:10000;align-items:center;justify-content:center;';
    wrap.innerHTML = `
      <div style="background:#12181f;color:#e6edf3;width:min(680px,92vw);border-radius:12px;padding:16px 18px;box-shadow:0 10px 30px rgba(0,0,0,.4);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;">
          <div>
            <h3 style="margin:0;font-size:1.1rem;">Perfil del promotor</h3>
            <div id="promoterProfileUser" class="small muted"></div>
          </div>
          <button id="promoterProfileClose" class="btn small" style="background:#2a323d;">Cerrar</button>
        </div>

        <label class="small muted" style="display:block;margin-bottom:10px;">Nombre de la sociedad
          <input id="pp-companyName" class="input" type="text" placeholder="Ej: Promotora Vista Azul, S.A." />
        </label>

        <label class="small muted" style="display:block;margin-bottom:10px;">Tipo de promotor
          <select id="pp-promoterType" class="input">
            ${renderPromoterTypeOptions()}
          </select>
        </label>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <label class="small muted">Años de experiencia
            <input id="pp-yearsExperience" class="input" type="number" min="0" step="1" />
          </label>
          <label class="small muted">Proyectos entregados
            <input id="pp-deliveredProjects" class="input" type="number" min="0" step="1" />
          </label>
          <label class="small muted">Proyectos activos
            <input id="pp-activeProjects" class="input" type="number" min="0" step="1" />
          </label>
          <label class="small muted">Unidades desarrolladas
            <input id="pp-developedVolume" class="input" type="number" min="0" step="any" />
          </label>
        </div>

        <label class="small muted" style="display:block;margin-top:10px;">Países de operación
          <input id="pp-countries" class="input" type="text" placeholder="Panamá, Colombia..." />
        </label>
        <label class="small muted" style="display:block;margin-top:10px;">Notas
          <textarea id="pp-notes" class="input" rows="4" style="resize:vertical;"></textarea>
        </label>
        <div class="small muted" style="margin-top:8px;">Clasificación actual: <span id="pp-category">No definido</span></div>

        <div style="margin-top:14px;display:flex;gap:10px;justify-content:flex-end;">
          <button id="promoterProfileCancel" class="btn">Cancelar</button>
          <button id="promoterProfileSave" class="btn small">Guardar</button>
        </div>
      </div>
    `;

    document.body.appendChild(wrap);
    const close = () => { wrap.style.display = 'none'; };
    document.getElementById('promoterProfileClose').addEventListener('click', close);
    document.getElementById('promoterProfileCancel').addEventListener('click', close);
    document.getElementById('promoterProfileSave').addEventListener('click', async () => {
      const id = wrap.dataset.userId;
      if (!id) return;
      const numOrBlank = (fieldId) => {
        const value = document.getElementById(fieldId)?.value;
        return value === '' || value === null || value === undefined ? '' : Number(value);
      };
      const profile = {
        companyName: document.getElementById('pp-companyName')?.value || '',
        promoterType: document.getElementById('pp-promoterType')?.value || 'No definido',
        yearsExperience: numOrBlank('pp-yearsExperience'),
        deliveredProjects: numOrBlank('pp-deliveredProjects'),
        activeProjects: numOrBlank('pp-activeProjects'),
        developedVolume: numOrBlank('pp-developedVolume'),
        countries: document.getElementById('pp-countries')?.value || '',
        notes: document.getElementById('pp-notes')?.value || ''
      };

      try {
        await apiUpdatePromoterProfile(id, profile);
        wrap.style.display = 'none';
        await loadPendingUsers();
        await loadUsers();
      } catch (e) {
        alert(e.message || 'No se pudo guardar el perfil del promotor');
      }
    });
  }

  function openPromoterProfileModal(user) {
    ensurePromoterProfileModal();
    const wrap = document.getElementById('promoterProfileModal');
    const profile = user?.promoterProfile || {};
    wrap.dataset.userId = user._id;
    document.getElementById('promoterProfileUser').textContent = `${user.name || '-'} · ${user.email || '-'}`;
    document.getElementById('pp-companyName').value = profile.companyName || '';
    document.getElementById('pp-promoterType').innerHTML = renderPromoterTypeOptions(profile.promoterType || 'No definido');
    document.getElementById('pp-yearsExperience').value = profile.yearsExperience ?? '';
    document.getElementById('pp-deliveredProjects').value = profile.deliveredProjects ?? '';
    document.getElementById('pp-activeProjects').value = profile.activeProjects ?? '';
    document.getElementById('pp-developedVolume').value = profile.developedVolume ?? '';
    document.getElementById('pp-countries').value = Array.isArray(profile.countries) ? profile.countries.join(', ') : '';
    document.getElementById('pp-notes').value = profile.notes || '';
    document.getElementById('pp-category').textContent = user.promoterCategory || 'No definido';
    wrap.style.display = 'flex';
  }

  // ---------- EVENTOS ----------
  // Usuarios pendientes
  document.getElementById('refreshPendingUsers')?.addEventListener('click', loadPendingUsers);
  roleSelectDefault?.addEventListener('change', () => {
    pendingUsersTbody?.querySelectorAll('select.role-inline').forEach(sel => {
      if (!sel.value) sel.value = roleSelectDefault.value || '';
    });
  });

  // Proyectos pendientes
  document.getElementById('refreshPendingProjects')?.addEventListener('click', loadPendingProjects);

  // Listado general de usuarios
  document.getElementById('refreshUsers')?.addEventListener('click', loadUsers);
  usersStatusFilter?.addEventListener('change', () => {
    usersPage = 1;
    loadUsers();
  });
  usersSearch?.addEventListener('input', () => {
    usersPage = 1;
    loadUsers();
  });
  usersPrev?.addEventListener('click', () => {
    if (usersPage <= 1) return;
    usersPage -= 1;
    loadUsers();
  });
  usersNext?.addEventListener('click', () => {
    if (usersPage >= maxPageFor(usersLastTotal, usersPageSize)) return;
    usersPage += 1;
    loadUsers();
  });
  toggleUsersCardBtn?.addEventListener('click', () => {
    if (!usersCardBody) return;
    const collapsed = usersCardBody.classList.toggle('is-collapsed');
    toggleUsersCardBtn.textContent = collapsed ? 'v' : '^';
    toggleUsersCardBtn.setAttribute('aria-expanded', String(!collapsed));
    toggleUsersCardBtn.setAttribute('aria-label', collapsed ? 'Mostrar usuarios' : 'Ocultar usuarios');
  });

  // Proyectos (admin)
  refreshAllProjectsBtn?.addEventListener('click', loadAllProjects);

  openActivityBtn?.addEventListener('click', async () => {
    if (!activityCard) return;
    const isOpen = activityCard.style.display !== 'none';
    if (isOpen) {
      activityCard.style.display = 'none';
      openActivityBtn.textContent = 'Actividad';
      return;
    }

    activityCard.style.display = '';
    openActivityBtn.textContent = 'Ocultar actividad';
    activityCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    auditPage = 1;
    await loadAuditLogs();
  });

  hideActivityBtn?.addEventListener('click', () => {
    if (activityCard) activityCard.style.display = 'none';
    if (openActivityBtn) openActivityBtn.textContent = 'Actividad';
  });

  refreshAuditLogsBtn?.addEventListener('click', loadAuditLogs);
  auditActionFilter?.addEventListener('change', () => {
    auditPage = 1;
    loadAuditLogs();
  });
  auditStatusFilter?.addEventListener('change', () => {
    auditPage = 1;
    loadAuditLogs();
  });

  let auditSearchTO = null;
  auditSearch?.addEventListener('input', () => {
    clearTimeout(auditSearchTO);
    auditSearchTO = setTimeout(() => {
      auditPage = 1;
      loadAuditLogs();
    }, 250);
  });

  auditPrev?.addEventListener('click', () => {
    if (auditPage <= 1) return;
    auditPage -= 1;
    loadAuditLogs();
  });
  auditNext?.addEventListener('click', () => {
    const maxPage = Math.max(1, Math.ceil(auditLastTotal / auditLimit));
    if (auditPage >= maxPage) return;
    auditPage += 1;
    loadAuditLogs();
  });

  // Delegación de eventos global
  document.addEventListener('click', async (e) => {
    const promoterProfileBtn = e.target.closest?.('button[data-user-promoter-profile]');
    if (promoterProfileBtn) {
      const id = promoterProfileBtn.getAttribute('data-user-promoter-profile');
      let user = usersCache.find(u => String(u._id) === String(id));
      if (!user) {
        const all = await apiGetUsers();
        usersCache = all;
        user = usersCache.find(u => String(u._id) === String(id));
      }
      if (!user) return alert('Usuario no encontrado');
      openPromoterProfileModal(user);
      return;
    }

    // ---- Usuarios: aprobar ----
    const approveBtn = e.target.closest?.('button.approve');
    if (approveBtn) {
      const id = approveBtn.getAttribute('data-id');
      const row = approveBtn.closest('tr');
      const sel = row?.querySelector('select.role-inline');
      const role = (sel?.value || roleSelectDefault?.value || '').trim();
      approveBtn.disabled = true;
      try {
        await apiApproveUser(id, role || undefined);
        row?.remove();
        loadUsers();
      } catch (err) {
        approveBtn.disabled = false;
        alert(err.message || 'No se pudo aprobar');
      }
      return;
    }

    // ---- Usuarios: bloquear/desbloquear ----
    const blockBtn = e.target.closest?.('button[data-action="block"]');
    if (blockBtn) {
      const id = blockBtn.getAttribute('data-id');
      blockBtn.disabled = true;
      try {
        await apiBlockUser(id);
        loadPendingUsers();
        loadUsers();
      } catch (err) {
        blockBtn.disabled = false;
        alert(err.message || 'No se pudo bloquear/desbloquear');
      }
      return;
    }

    // ---- Usuarios: eliminar ----
    const delBtn = e.target.closest?.('button[data-action="delete"]');
    if (delBtn) {
      const id = delBtn.getAttribute('data-id');
      if (!confirm('¿Seguro que deseas eliminar este usuario?')) return;
      delBtn.disabled = true;
      try {
        await apiDeleteUser(id);
        delBtn.closest('tr')?.remove();
        loadPendingUsers();
        loadUsers();
      } catch (err) {
        delBtn.disabled = false;
        alert(err.message || 'No se pudo eliminar');
      }
      return;
    }

    // ---- Proyectos: aprobar ----
const pApprove = e.target.closest?.('button[data-project-approve]');
if (pApprove) {
  const id = pApprove.getAttribute('data-project-approve');
  pApprove.disabled = true;
  try {
    await apiApproveProject(id);
    const row = pApprove.closest('tr');
    if (allProjectsTbody && allProjectsTbody.contains(row)) {
      // venía de la lista completa -> refrescamos esa lista
      await loadAllProjects();
    } else {
      // venía de "pendientes" -> quitamos la fila
      row?.remove();
    }
  } catch (err) {
    pApprove.disabled = false;
    alert(err.message || 'No se pudo aprobar el proyecto');
  }
  return;
}

// ---- Proyectos: rechazar ----
const pReject = e.target.closest?.('button[data-project-reject]');
if (pReject) {
  const id = pReject.getAttribute('data-project-reject');
  pReject.disabled = true;
  try {
    await apiRejectProject(id);
    const row = pReject.closest('tr');
    if (allProjectsTbody && allProjectsTbody.contains(row)) {
      await loadAllProjects();
    } else {
      row?.remove();
    }
  } catch (err) {
    pReject.disabled = false;
    alert(err.message || 'No se pudo rechazar el proyecto');
  }
  return;
}

// ---- Proyectos: abrir modal de edición ----
const pEdit = e.target.closest?.('button[data-project-edit]');
if (pEdit) {
  const id = pEdit.getAttribute('data-project-edit');
  try {
    ensureEditModal();
    const proj = await xfetch(`/api/projects/${id}`);
    const modal = document.getElementById('editProjectModal');
    modal.dataset.projectId = id;
    document.getElementById('editProjName').value = proj.name || '';
    document.getElementById('editProjDesc').value = proj.description || '';
    document.getElementById('editProjType').value = proj.projectType || proj.tipoProyecto || '';
    document.getElementById('editProjLocation').value = proj.location || proj.address || '';
    // Rellenar KPIs
document.getElementById('ep-loanApproved').value   = proj.loanApproved ?? '';
document.getElementById('ep-loanDisbursed').value  = proj.loanDisbursed ?? '';
document.getElementById('ep-loanBalance').value    = proj.loanBalance ?? '';
document.getElementById('ep-budgetApproved').value = proj.budgetApproved ?? '';
document.getElementById('ep-budgetSpent').value    = proj.budgetSpent ?? '';
document.getElementById('ep-unitsTotal').value     = proj.unitsTotal ?? '';
document.getElementById('ep-unitsSold').value      = proj.unitsSold ?? '';
    const conditions = proj.financialConditions || {};
    ['projectTotal','bankFinancedAmount','bankFinancedPct','promoterContribution','promoterContributionPct','interestRate','term','paymentMethod','commission','disbursementMethod','disbursementConditions','amortizationConditions','requiredPresales','guarantees','insurance'].forEach(key => {
      const input = document.getElementById(`ep-fc-${key}`);
      if (input) input.value = input.matches('[data-bank-number]') && conditions[key] ? formatBankNumber(conditions[key]) : (conditions[key] ?? '');
    });
    const precedent = conditions.precedentConditions || {};
    document.querySelectorAll('[data-ep-precedent]').forEach(input => { input.checked = !!precedent[input.dataset.epPrecedent]; });
    document.getElementById('ep-fc-otherRequirements').value = precedent.otherRequirements || '';
    const operation = conditions.operationStructure || {};
    ['trustee','trustType','technicalInspector','financialInspector'].forEach(key => {
      const input = document.getElementById(`ep-op-${key}`); if (input) input.value = operation[key] || '';
    });
    const legal = proj.legalData || {};
    document.getElementById('ep-ld-promoterLegalName').value = legal.promoterLegalName || '';
    document.getElementById('ep-ld-interimBank').value = legal.interimBank || '';
    document.getElementById('ep-ld-trustApplies').value = legal.trustApplies ? 'true' : 'false';
    document.getElementById('ep-ld-trustName').value = legal.trustName || '';
    document.getElementById('ep-boardMembers').innerHTML = (legal.boardMembers || []).map(item => dashboardRepeatRow('board', item)).join('');
    document.getElementById('ep-shareholders').innerHTML = (legal.shareholders || []).map(item => dashboardRepeatRow('shareholder', item)).join('');
    const tech = proj.technicalData || {};
    document.getElementById('ep-td-phasesCount').value = tech.phasesCount ?? '';
    document.getElementById('ep-td-totalUnits').value = tech.totalUnits ?? '';
    document.getElementById('ep-td-notes').value = tech.notes || '';
    document.getElementById('ep-housingModels').innerHTML = (proj.housingModels || []).map(dashboardModelRow).join('');
    bindBankNumberFormatting(modal);
    validateEditModelStatuses();
    let financePhases = proj.financePhases || [];
    try {
      const finance = await xfetch(`/api/projects/${id}/finance`);
      if (Array.isArray(finance?.phases) && finance.phases.length) financePhases = finance.phases;
    } catch (_) {}
    syncEditFinancePhases(financePhases);

    modal.style.display = 'flex';
  } catch (err) {
    alert(err.message || 'No se pudo abrir el editor');
  }
  return;
}

// === Editar proyecto (incluye KPIs iniciales) ===
function openProjectEditor() {
  const p = state?.project || {};

  const html = `
    <div class="row w-100">
      <label>Nombre</label>
      <input id="ep-name" class="w-100" value="${p.name || ''}" />
    </div>

    <div class="row w-100">
      <label>Descripción</label>
      <textarea id="ep-desc" class="w-100" rows="4">${p.description || ''}</textarea>
    </div>

    <div class="grid-2" style="margin-top:10px">
      <div>
        <div class="label">KPIs iniciales</div>
        <div class="row w-100">
          <label>Loan aprobado</label>
          <input id="ep-loanApproved" type="number" step="any" value="${p.loanApproved ?? ''}">
        </div>
        <div class="row w-100">
          <label>Desembolsado</label>
          <input id="ep-loanDisbursed" type="number" step="any" value="${p.loanDisbursed ?? ''}">
        </div>
        <div class="row w-100">
          <label>Saldo loan</label>
          <input id="ep-loanBalance" type="number" step="any" value="${p.loanBalance ?? ''}">
        </div>
      </div>

      <div>
        <div class="label" style="visibility:hidden">_</div>
        <div class="row w-100">
          <label>Budget aprobado</label>
          <input id="ep-budgetApproved" type="number" step="any" value="${p.budgetApproved ?? ''}">
        </div>
        <div class="row w-100">
          <label>Gasto</label>
          <input id="ep-budgetSpent" type="number" step="any" value="${p.budgetSpent ?? ''}">
        </div>
        <div class="row w-100">
          <label>Unidades totales</label>
          <input id="ep-unitsTotal" type="number" step="1" value="${p.unitsTotal ?? ''}">
        </div>
        <div class="row w-100">
          <label>Unidades vendidas</label>
          <input id="ep-unitsSold" type="number" step="1" value="${p.unitsSold ?? ''}">
        </div>
      </div>
    </div>
  `;

  openModal('Editar proyecto', html, 'Guardar', async () => {
    const num = (id) => {
      const v = document.getElementById(id)?.value;
      return v === '' || v === null || v === undefined ? null : Number(v);
    };

    const body = {
      name: document.getElementById('ep-name').value.trim(),
      description: document.getElementById('ep-desc').value.trim(),

      // KPIs iniciales
      loanApproved:     num('ep-loanApproved'),
      loanDisbursed:    num('ep-loanDisbursed'),
      loanBalance:      num('ep-loanBalance'),
      budgetApproved:   num('ep-budgetApproved'),
      budgetSpent:      num('ep-budgetSpent'),
      unitsTotal:       num('ep-unitsTotal'),
      unitsSold:        num('ep-unitsSold'),
    };

    // Limpia nulls si tu API no los quiere
    Object.keys(body).forEach(k => body[k] === null && delete body[k]);

    await API.put(`/api/projects/${id}`, body);
    modalBackdrop.style.display = 'none';

    // refresca header, KPIs y resumen
    await loadProject();
    if (typeof loadSummary === 'function') await loadSummary();
  });
}

// Enganche del botón (ajusta el selector al que ya tienes en tu header)
const editProjectBtn =
  document.getElementById('editProjectBtn') ||
  document.querySelector('[data-action="edit-project"]') ||
  document.querySelector('.btn-edit-project');

if (editProjectBtn) editProjectBtn.addEventListener('click', openProjectEditor);


    // ---- Proyectos completos: abrir modal asignación ----
const pAssign = e.target.closest?.('button[data-project-assign]');
if (pAssign && assignModal && assignProjectNameEl) {
  const id = pAssign.getAttribute('data-project-assign');
  const name = pAssign.getAttribute('data-project-name') || '';
  assignModal.dataset.projectId = id;
  assignProjectNameEl.textContent = `Proyecto: ${name}`;

  try {
    // 1) Cargamos el proyecto y los candidatos por rol (todos)
    const [project, candidatesByRoleArr] = await Promise.all([
      xfetch(`/api/projects/${id}`),
      Promise.all(ASSIGNABLE_ROLES.map(r =>
        apiGetAssignees(r).then(users => ({ role: r, users }))
      ))
    ]);

    const candidatesByRole = {};
    candidatesByRoleArr.forEach(({ role, users }) => { candidatesByRole[role] = users || []; });
    renderAssignTeamSuggestion(project.teamSuggestion || {});

    // 2) Determinar preseleccionados por rol
    // Recomendado backend: project.assignees = { promoter:[ids], commercial:[ids], gerencia:[ids], ... }
    // Fallback (si solo tienes assignedPromoters/assignedCommercials):
    function preselectedFor(role) {
      const ass = project.assignees && project.assignees[role];
      if (Array.isArray(ass)) return ass;

      // Fallback a los antiguos nombres
      if (role === 'promoter' && Array.isArray(project.assignedPromoters)) return project.assignedPromoters;
      if (role === 'commercial' && Array.isArray(project.assignedCommercials)) return project.assignedCommercials;
      return [];
    }

    // 3) Pintar selects dinámicos
    const container = document.getElementById('assignRolesContainer');
    container.innerHTML = '';
    ASSIGNABLE_ROLES.forEach(role => {
      const candidates = candidatesByRole[role] || [];
      const pre = preselectedFor(role);
      container.appendChild(createRoleSelect(role, candidates, pre));
    });

    assignModal.classList.add('show');
  } catch (err) {
    alert('No se pudo abrir el modal: ' + (err.message || err));
  }
  return;
}


    // ---- Proyectos completos: eliminar ----
    const pDelete = e.target.closest?.('button[data-project-delete]');
    if (pDelete) {
      const id = pDelete.getAttribute('data-project-delete');
      if (!confirm('¿Seguro que quieres eliminar este proyecto? Esta acción no se puede deshacer.')) return;
      pDelete.disabled = true;
      try {
        await apiDeleteProject(id);
        await loadAllProjects();
      } catch (err) {
        pDelete.disabled = false;
        alert(err.message || 'No se pudo eliminar el proyecto');
      }
      return;
    }
  });

  // Cambio de rol inline en listado general (usuarios activos)
  document.addEventListener('change', async (e) => {
    const sel = e.target.closest?.('select.role-inline');
    if (!sel) return;
    const id = sel.getAttribute('data-id');
    const newRole = sel.value;
    const row = sel.closest('tr');
    const stBadge = row?.querySelector('.badge');
    if (stBadge && stBadge.textContent?.toLowerCase() === 'pending') return;

    sel.disabled = true;
    try {
      await apiApproveUser(id, newRole || undefined);
      setTimeout(loadUsers, 200);
    } catch (err) {
      alert(err.message || 'No se pudo actualizar el rol');
    } finally {
      sel.disabled = false;
    }
  });

  // Modal asignación: guardar/cerrar (si existe)
  assignCancelBtn?.addEventListener('click', () => assignModal?.classList.remove('show'));
  assignCloseBtn?.addEventListener('click', () => assignModal?.classList.remove('show'));
  assignSaveBtn?.addEventListener('click', async () => {
  if (!assignModal) return;
  const id = assignModal.dataset.projectId;
  if (!id) return;

  // Recoger selecciones por rol
  const container = document.getElementById('assignRolesContainer');
  const selects = Array.from(container.querySelectorAll('select[data-role]'));
  const assignments = {};
  selects.forEach(sel => {
    const role = sel.dataset.role;
    const ids = Array.from(sel.selectedOptions).map(o => o.value);
    assignments[role] = ids;
  });

  try {
    // Opción 1 (recomendada): endpoint genérico con mapa por rol
    await apiAssignProject(id, assignments);
    // Opción 2 (si tu backend aún espera campos "promoters/commercials"):
    // await apiAssignProject(id, assignments, true);

    assignModal.classList.remove('show');
    await loadAllProjects();
    alert('Asignaciones guardadas.');
  } catch (e) {
    alert(e.message || 'No se pudieron guardar las asignaciones');
  }
});

// Proyectos (admin) - filtros client-side
allProjectsFilter?.addEventListener('change', () => {
  allProjectsPage = 1;
  renderAllProjects(applyProjectsFilters(allProjectsCache));
});

// Proyectos (admin) - buscador con pequeño debounce
let projSearchTO = null;
allProjectsSearch?.addEventListener('input', () => {
  clearTimeout(projSearchTO);
  projSearchTO = setTimeout(() => {
    allProjectsPage = 1;
    renderAllProjects(applyProjectsFilters(allProjectsCache));
  }, 150);
});

allProjectsPrev?.addEventListener('click', () => {
  if (allProjectsPage <= 1) return;
  allProjectsPage -= 1;
  renderAllProjects(applyProjectsFilters(allProjectsCache));
});

allProjectsNext?.addEventListener('click', () => {
  if (allProjectsPage >= maxPageFor(allProjectsLastTotal, allProjectsPageSize)) return;
  allProjectsPage += 1;
  renderAllProjects(applyProjectsFilters(allProjectsCache));
});

  // ---------- INIT ----------
  await Promise.all([
    loadPendingUsers(),
    loadPendingProjects(),
    loadUsers(),
    loadAllProjects(), // se ignora si no existe la UI de proyectos completos
  ]);
})();
