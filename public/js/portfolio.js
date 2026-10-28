(async function () {
  if (!API.getToken()) {
    API.logout?.();
    location.replace('/login');
    return;
  }

  const container = document.getElementById('cards');
  const banner = document.getElementById('noProjectsBanner');
  const filterBtn = document.getElementById('portfolioFilterBtn');
  const filterModalBackdrop = document.getElementById('filterModalBackdrop');
  const filterPromoter = document.getElementById('filterPromoter');
  const filterStatus = document.getElementById('filterStatus');
  const filterSort = document.getElementById('filterSort');
  const filterSoldOnly = document.getElementById('filterSoldOnly');
  const applyFiltersBtn = document.getElementById('applyFilters');
  const clearFiltersBtn = document.getElementById('clearFilters');
  const closeFilterModalBtn = document.getElementById('closeFilterModal');
  const profileBtn = document.getElementById('portfolioProfileBtn');
  const profileModalBackdrop = document.getElementById('profileModalBackdrop');
  const closeProfileModalBtn = document.getElementById('closeProfileModal');
  const cancelProfileModalBtn = document.getElementById('cancelProfileModal');
  const saveProfileModalBtn = document.getElementById('saveProfileModal');
  const profileCompletionText = document.getElementById('profileCompletionText');
  const profileRequiredBackdrop = document.getElementById('profileRequiredBackdrop');
  const closeProfileRequiredBtn = document.getElementById('closeProfileRequired');
  const goToPromoterProfileBtn = document.getElementById('goToPromoterProfile');
  const promoterMap = new Map();
  let promoterOptionsLoaded = false;
  const createPromoterProfiles = new Map();
  const createPromoterCompanies = new Map();
  let createPromoterProfilesLoaded = false;

  // Auth / rol
  const auth = API.getAuth ? API.getAuth() : {
    role: (localStorage.getItem('role') || '').toLowerCase(),
    userId: localStorage.getItem('userId')
  };
  const role = (auth.role || '').toLowerCase();
  const DEFAULT_PROJECT_COVER = '/assets/FotoPortfolio.jpg';
  let fundingModuleEnabled = false;
  const fundingOpportunityDetailCache = new Map();
  const fundingOpportunityDetailRequests = new Map();
  const dashboardBtn = document.getElementById('portfolioDashboardBtn');
  if (dashboardBtn && ['admin', 'bank'].includes(role)) {
    dashboardBtn.style.display = '';
    dashboardBtn.addEventListener('click', () => { location.href = '/dashboard'; });
  }

  // ✅ Solo admin, bank y promoter pueden crear
  const CAN_CREATE = role === 'admin' || role === 'bank' || role === 'promoter';
  let promoterProfileState = null;

  // Roles
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
  const ASSIGNABLE_ROLES = ALL_ROLES.filter(r => !['admin', 'bank'].includes(r));

  // ===== Helpers =====
  const norm = (s) => (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  const escapeHtml = (s) => (s || '').toString().replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
  const truncateText = (value, maxLength = 220) => {
    const text = String(value || '').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}...` : text;
  };

  const splitCsv = (value) => String(value || '').split(/\r?\n|,/).map(x => x.trim()).filter(Boolean);
  const numberOrNull = (value) => {
    if (value === '' || value === null || value === undefined) return null;
    const n = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const profileMoneyFields = ['pp-developedVolume', 'pp-averageProjectTicket'];
  const formatProfileMoney = (value) => {
    const n = numberOrNull(value);
    if (n === null) return '';
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  function bindProfileMoneyInputs(root = document) {
    profileMoneyFields.forEach(id => {
      const el = root.getElementById ? root.getElementById(id) : document.getElementById(id);
      if (!el || el.dataset.moneyBound === '1') return;
      el.dataset.moneyBound = '1';
      el.addEventListener('input', () => {
        el.value = el.value.replace(/[^\d,.]/g, '');
      });
      el.addEventListener('blur', () => {
        el.value = formatProfileMoney(el.value);
      });
    });
  }

  const debounce = (fn, ms = 120) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  function setProfileField(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = value ?? '';
  }

  function getProfileField(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    return el.type === 'checkbox' ? el.checked : el.value;
  }

  function renderProfileCompanies(companies = []) {
    const container = document.getElementById('pp-companies');
    if (!container) return;
    const rows = companies.length ? companies : [{ name: '', incorporationYear: '', isPrimary: true }];
    container.innerHTML = '';
    rows.forEach((company, index) => {
      const row = document.createElement('div');
      row.className = 'profile-company-row';
      row.dataset.companyId = company.companyId || company._id || '';
      row.innerHTML = `
        <div class="profile-company-fields">
          <label><span>Sociedad ${index + 1} · Nombre</span><input data-company-name type="text" placeholder="Razón social"></label>
          <label><span>Año de constitución</span><input data-company-year type="number" min="1800" max="${new Date().getFullYear()}" step="1" placeholder="Ej: 2012"></label>
          <label><span>RUC</span><input data-company-ruc type="text" placeholder="RUC de la sociedad"></label>
          <label class="profile-company-primary" title="Usar esta sociedad por defecto"><input data-company-primary type="radio" name="pp-primary-company"> Sociedad principal</label>
          <button class="btn ghost profile-company-remove" data-remove-company type="button" title="Eliminar sociedad" aria-label="Eliminar sociedad">×</button>
        </div>
        <div class="profile-company-shareholders">
          <div class="profile-company-shareholders-head"><strong>Junta accionarial</strong><button class="btn ghost" data-add-company-shareholder type="button">+ Añadir accionista</button></div>
          <div data-company-shareholders></div>
        </div>`;
      row.querySelector('[data-company-name]').value = company.name || '';
      row.querySelector('[data-company-year]').value = company.incorporationYear ?? '';
      row.querySelector('[data-company-ruc]').value = company.ruc || '';
      row.querySelector('[data-company-primary]').checked = !!company.isPrimary || (!rows.some(item => item.isPrimary) && index === 0);
      const shareholders = Array.isArray(company.shareholders) ? company.shareholders : [];
      row.querySelector('[data-company-shareholders]').innerHTML = shareholders.map(profileCompanyShareholderRow).join('');
      container.appendChild(row);
    });
  }

  function profileCompanyShareholderRow(item = {}) {
    return `<div class="profile-shareholder-row" data-company-shareholder-row>
      <label>Nombre<input data-company-shareholder="name" value="${escapeHtml(item.name || '')}"></label>
      <label>Cédula<input data-company-shareholder="cedula" value="${escapeHtml(item.cedula || '')}"></label>
      <label>Porcentaje<input data-company-shareholder="percentage" type="number" min="0.01" max="100" step="any" value="${item.percentage ?? ''}"></label>
      <button class="btn ghost profile-company-remove" data-remove-company-shareholder type="button" aria-label="Eliminar accionista">×</button>
    </div>`;
  }

  function collectProfileCompanies() {
    const currentYear = new Date().getFullYear();
    const companies = Array.from(document.querySelectorAll('#pp-companies .profile-company-row')).map(row => ({
      companyId: row.dataset.companyId || '',
      name: row.querySelector('[data-company-name]')?.value.trim() || '',
      incorporationYear: numberOrNull(row.querySelector('[data-company-year]')?.value),
      ruc: row.querySelector('[data-company-ruc]')?.value.trim() || '',
      shareholders: Array.from(row.querySelectorAll('[data-company-shareholder-row]')).map(shareholder => ({
        name: shareholder.querySelector('[data-company-shareholder="name"]')?.value.trim() || '',
        cedula: shareholder.querySelector('[data-company-shareholder="cedula"]')?.value.trim() || '',
        percentage: numberOrNull(shareholder.querySelector('[data-company-shareholder="percentage"]')?.value)
      })),
      isPrimary: !!row.querySelector('[data-company-primary]')?.checked
    })).filter(company => company.name || company.incorporationYear !== null);
    if (companies.some(company => !company.name || !Number.isInteger(company.incorporationYear) || company.incorporationYear < 1800 || company.incorporationYear > currentYear)) {
      throw new Error(`Cada sociedad debe tener nombre y un año de constitución entre 1800 y ${currentYear}.`);
    }
    if (companies.length && !companies.some(company => company.isPrimary)) companies[0].isPrimary = true;
    for (const company of companies) {
      if (!company.ruc) throw new Error(`Indica el RUC de ${company.name}.`);
      if (!company.shareholders.length) throw new Error(`Añade al menos un accionista a ${company.name}.`);
      if (company.shareholders.some(item => !item.name || !item.cedula || !(item.percentage > 0) || item.percentage > 100)) {
        throw new Error(`Completa nombre, cédula y porcentaje de todos los accionistas de ${company.name}.`);
      }
      const total = company.shareholders.reduce((sum, item) => sum + item.percentage, 0);
      if (Math.abs(total - 100) > 0.001) throw new Error(`Los porcentajes de ${company.name} deben sumar 100%.`);
    }
    return companies;
  }

  const profileTeamAreas = [
    ['technical', 'Área técnica'],
    ['financial', 'Área financiera'],
    ['commercial', 'Área comercial'],
    ['legal', 'Área legal']
  ];

  function renderProfileTeam(internalTeam = {}, teamContacts = {}) {
    const container = document.getElementById('pp-teamAreas');
    if (!container) return;
    container.innerHTML = profileTeamAreas.map(([key, label]) => {
      const contact = teamContacts[key] || {};
      const active = !!internalTeam[key];
      return `<div class="profile-team-card${active ? ' is-active' : ''}" data-team-area="${key}">
        <label class="profile-team-toggle"><input id="pp-team-${key}" data-team-toggle type="checkbox"${active ? ' checked' : ''}> ${label} cubierta</label>
        <div class="profile-team-contact">
          <label class="wide">Nombre y apellidos<input data-team-field="fullName" type="text" value="${escapeHtml(contact.fullName || '')}" placeholder="Responsable del área"></label>
          <label>Cargo<input data-team-field="title" type="text" value="${escapeHtml(contact.title || '')}" placeholder="Ej: Director técnico"></label>
          <label>Vinculación<select data-team-field="relationship"><option value="">No definida</option><option value="Interno"${contact.relationship === 'Interno' ? ' selected' : ''}>Equipo interno</option><option value="Externo"${contact.relationship === 'Externo' ? ' selected' : ''}>Colaborador externo</option></select></label>
          <label>Correo profesional<input data-team-field="email" type="email" value="${escapeHtml(contact.email || '')}" placeholder="correo@empresa.com"></label>
          <label>Teléfono<input data-team-field="phone" type="tel" value="${escapeHtml(contact.phone || '')}" placeholder="Teléfono profesional"></label>
        </div>
      </div>`;
    }).join('');
  }

  function collectProfileTeamContacts() {
    return Object.fromEntries(profileTeamAreas.map(([key]) => {
      const card = document.querySelector(`[data-team-area="${key}"]`);
      const value = field => card?.querySelector(`[data-team-field="${field}"]`)?.value.trim() || '';
      return [key, { fullName: value('fullName'), title: value('title'), relationship: value('relationship'), email: value('email'), phone: value('phone') }];
    }));
  }

  function updateProfileButton(completion = {}) {
    if (!profileBtn || role !== 'promoter') return;
    profileBtn.style.display = '';
    const percent = Number(completion.percent) || 0;
    const status = completion.status || (completion.sufficient ? 'complete' : percent >= 70 ? 'partial' : 'incomplete');
    profileBtn.classList.toggle('is-complete', status === 'complete');
    profileBtn.classList.toggle('is-partial', status === 'partial');
    profileBtn.classList.toggle('is-incomplete', status === 'incomplete');
    profileBtn.title = `Perfil de promotora: ${percent}% completado`;
    if (profileCompletionText) {
      profileCompletionText.textContent = `Completitud: ${completion.percent || 0}% · Scoring: ${promoterProfileState?.promoterCategory || 'No definido'}`;
    }
  }

  function fillProfileModal(data = {}) {
    const p = data.promoterProfile || {};
    promoterProfileState = data;
    renderProfileCompanies(Array.isArray(p.companies) && p.companies.length
      ? p.companies
      : [{ name: p.companyName || '', incorporationYear: p.incorporationYear ?? '', isPrimary: true }]);
    setProfileField('pp-promoterType', p.promoterType || 'No definido');
    setProfileField('pp-yearsExperience', p.yearsExperience);
    setProfileField('pp-deliveredProjects', p.deliveredProjects);
    setProfileField('pp-activeProjects', p.activeProjects);
    setProfileField('pp-developedUnits', p.developedUnits);
    setProfileField('pp-countries', (p.countries || []).join(', '));
    setProfileField('pp-developedVolume', formatProfileMoney(p.developedVolume));
    setProfileField('pp-averageProjectTicket', formatProfileMoney(p.averageProjectTicket));
    const bankExperience = String(p.bankFinancingExperience || '').trim().toLowerCase();
    setProfileField('pp-bankFinancingExperience', bankExperience === 'sí' || bankExperience === 'si' ? 'Sí' : bankExperience === 'no' ? 'No' : '');
    setProfileField('pp-banksWorkedWith', (p.banksWorkedWith || []).join(', '));
    setProfileField('pp-onTimeDeliveryHistory', p.onTimeDeliveryHistory);
    setProfileField('pp-incidentHistory', p.incidentHistory);
    setProfileField('pp-documentationLevel', p.documentationLevel);
    renderProfileTeam(p.internalTeam || {}, p.teamContacts || {});
    setProfileField('pp-employeeCount', p.employeeCount);
    setProfileField('pp-notes', p.notes);
    bindProfileMoneyInputs();
    updateProfileButton(data.promoterProfileCompletion || {});
  }

  function collectProfileModal() {
    const companies = collectProfileCompanies();
    const primaryCompany = companies.find(company => company.isPrimary) || companies[0] || {};
    return {
      companyName: primaryCompany.name || '',
      incorporationYear: primaryCompany.incorporationYear ?? null,
      companies,
      promoterType: getProfileField('pp-promoterType') || 'No definido',
      yearsExperience: numberOrNull(getProfileField('pp-yearsExperience')),
      deliveredProjects: numberOrNull(getProfileField('pp-deliveredProjects')),
      activeProjects: numberOrNull(getProfileField('pp-activeProjects')),
      developedUnits: numberOrNull(getProfileField('pp-developedUnits')),
      countries: splitCsv(getProfileField('pp-countries')),
      developedVolume: numberOrNull(getProfileField('pp-developedVolume')),
      averageProjectTicket: numberOrNull(getProfileField('pp-averageProjectTicket')),
      bankFinancingExperience: getProfileField('pp-bankFinancingExperience').trim(),
      banksWorkedWith: splitCsv(getProfileField('pp-banksWorkedWith')),
      onTimeDeliveryHistory: getProfileField('pp-onTimeDeliveryHistory').trim(),
      incidentHistory: getProfileField('pp-incidentHistory').trim(),
      documentationLevel: getProfileField('pp-documentationLevel'),
      internalTeam: {
        technical: getProfileField('pp-team-technical'),
        financial: getProfileField('pp-team-financial'),
        commercial: getProfileField('pp-team-commercial'),
        legal: getProfileField('pp-team-legal')
      },
      teamContacts: collectProfileTeamContacts(),
      employeeCount: numberOrNull(getProfileField('pp-employeeCount')),
      notes: getProfileField('pp-notes').trim()
    };
  }

  async function loadPromoterProfile() {
    if (role !== 'promoter' || !profileBtn) return;
    try {
      const data = await API.get('/api/auth/promoter-profile');
      fillProfileModal(data);
      return data;
    } catch (e) {
      console.warn('No se pudo cargar el perfil de promotora', e);
      updateProfileButton({ sufficient: false, percent: 0 });
      return null;
    }
  }

  function showPromoterProfileRequired(completion = {}) {
    const percent = Math.max(0, Math.min(100, Number(completion.percent) || 0));
    const minimum = Math.max(0, Math.min(100, Number(completion.minimumPercent) || 90));
    const progress = document.getElementById('profileRequiredProgress');
    const text = document.getElementById('profileRequiredPercent');
    if (progress) progress.style.width = `${percent}%`;
    if (text) text.textContent = `Perfil completado al ${percent}% · mínimo actual: ${minimum}%`;
    profileRequiredBackdrop?.classList.add('show');
  }

  async function loadPromotersForFilters() {
    if (!filterPromoter || promoterOptionsLoaded) return;

    filterPromoter.innerHTML = '<option value="">Cargando promotores...</option>';
    try {
      const data = await API.get('/api/projects/assignees?role=promoter');
      const list = (data && data.users) || [];
      if (!list.length) {
        filterPromoter.innerHTML = '<option value="">No hay promotores disponibles</option>';
        return;
      }

      filterPromoter.innerHTML = '<option value="">Todos los promotores</option>';
      list.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u._id;
        opt.textContent = `${u.name || '(sin nombre)'} — ${u.email || ''}`.trim();
        filterPromoter.appendChild(opt);
        promoterMap.set(String(u._id), u.name || u.email || 'Promotor');
      });
      promoterOptionsLoaded = true;
      decoratePromoterNames();
    } catch (e) {
      filterPromoter.innerHTML = '<option value="">No se pudieron cargar los promotores</option>';
      console.warn('Error cargando promotores:', e);
    }
  }

  function decoratePromoterNames() {
    FULL_LIST.forEach(p => {
      const ids = Array.isArray(p.assignedPromoters) ? p.assignedPromoters : [];
      p.promoterNames = ids
        .map(id => promoterMap.get(String(id)))
        .filter(Boolean);
    });
  }

  function sortProjects(list) {
    const sortBy = filterSort?.value || 'updatedAt_desc';
    return [...list].sort((a, b) => {
      if (sortBy === 'updatedAt_desc') return new Date(b.updatedAt) - new Date(a.updatedAt);
      if (sortBy === 'updatedAt_asc') return new Date(a.updatedAt) - new Date(b.updatedAt);
      if (sortBy === 'createdAt_desc') return new Date(b.createdAt) - new Date(a.createdAt);
      if (sortBy === 'createdAt_asc') return new Date(a.createdAt) - new Date(b.createdAt);
      if (sortBy === 'name_asc') return String(a.name || '').localeCompare(String(b.name || ''));
      if (sortBy === 'name_desc') return String(b.name || '').localeCompare(String(a.name || ''));
      return 0;
    });
  }

  function normalizeProjectStatus(status) {
    const normalized = String(status || 'EN_CURSO').trim().toUpperCase();
    return normalized === 'EN_MARCHA' ? 'EN_CURSO' : normalized;
  }

  function filterProjects(list) {
    if (!Array.isArray(list)) return [];

    const search = norm(searchInput?.value || '');
    const promoterId = filterPromoter?.value || '';
    const status = filterStatus?.value || '';
    const soldOnly = filterSoldOnly?.checked;

    let filtered = list;

    if (search) {
      filtered = filtered.filter(p => {
        const hay = norm(`${p.name || ''} ${p.description || ''} ${p.status || ''} ${p.promoterNames?.join(' ') || ''}`);
        return hay.includes(search);
      });
    }

    if (promoterId) {
      filtered = filtered.filter(p => {
        const ids = Array.isArray(p.assignedPromoters) ? p.assignedPromoters : [];
        return ids.some(id => String(id) === promoterId);
      });
    }

    if (status) {
      filtered = filtered.filter(p => normalizeProjectStatus(p.status) === status);
    }

    if (soldOnly) {
      filtered = filtered.filter(p => Number(p.unitsSold || 0) > 0);
    }

    return sortProjects(filtered);
  }

  function applyAllFilters() {
    renderList(filterProjects(FULL_LIST));
  }

  // ===== UI Cards =====
  function statusBadge(status) {
    const s = normalizeProjectStatus(status);
    return `<span class="badge portfolio-status-pill">${escapeHtml(s.replaceAll('_', ' '))}</span>`;
  }

  function statusClass(status) {
    const s = normalizeProjectStatus(status);
    return `status-${escapeHtml(s)}`;
  }

  function card(p) {
    const soldPct = p.unitsTotal ? Math.round((p.unitsSold / p.unitsTotal) * 100) : 0;
    const promoterText = Array.isArray(p.promoterNames) && p.promoterNames.length
      ? `Promotor: ${escapeHtml(p.promoterNames.join(', '))}`
      : '';
    const displayProjectType = p.projectType || p.tipoProyecto || '';
    const typeText = displayProjectType ? escapeHtml(displayProjectType) : '';
    const unitsSold = p.unitsSold || 0;
    const unitsTotal = p.unitsTotal || 0;
    const pendingDisbursementRequests = Number(p.pendingDisbursementRequests || 0);
    const pendingDisbursementAmount = Number(p.pendingDisbursementAmount || 0);
    const returnedDisbursementRequests = Number(p.returnedDisbursementRequests || 0);
    const pendingDisbursementAlert = ['bank', 'admin'].includes(role) && pendingDisbursementRequests > 0
      ? `<button type="button" class="portfolio-disbursement-alert" data-review-disbursements="${escapeHtml(p._id)}"><span>${pendingDisbursementRequests} ${pendingDisbursementRequests === 1 ? 'solicitud de desembolso pendiente' : 'solicitudes de desembolso pendientes'}</span><strong>${pendingDisbursementAmount.toLocaleString('es-PA', { style: 'currency', currency: p.currency || 'PAB' })}</strong><small>Revisar ahora →</small></button>`
      : '';
    const returnedDisbursementAlert = ['promoter', 'admin'].includes(role) && returnedDisbursementRequests > 0
      ? `<button type="button" class="portfolio-disbursement-alert is-returned" data-review-disbursements="${escapeHtml(p._id)}"><span>${returnedDisbursementRequests} ${returnedDisbursementRequests === 1 ? 'solicitud devuelta' : 'solicitudes devueltas'}</span><small>Ver motivo →</small></button>`
      : '';

    return `
      <article class="card portfolio-project-card ${statusClass(p.status)}">
        <div class="portfolio-card-cover">
          <img src="${escapeHtml(p.coverImage?.path || DEFAULT_PROJECT_COVER)}" alt="Portada de ${escapeHtml(p.name || 'proyecto')}" loading="lazy">
        </div>
        <div class="portfolio-card-body">
          <div class="portfolio-card-head">
            <h3 class="portfolio-card-title">${escapeHtml(p.name)}</h3>
            <div class="portfolio-card-pills">
              ${statusBadge(p.status)}
              ${typeText ? `<span class="portfolio-type-pill">${typeText}</span>` : ''}
            </div>
          </div>
        <div class="portfolio-card-meta">
          <div class="portfolio-card-summary ${p.description ? '' : 'is-empty'}">
            <span class="portfolio-card-summary-label">Resumen</span>
            <p class="portfolio-card-description">${p.description ? escapeHtml(truncateText(p.description)) : 'Sin descripci&oacute;n disponible.'}</p>
          </div>
          <p class="small muted portfolio-card-type ${typeText ? '' : 'is-empty'}">${typeText || '&nbsp;'}</p>
          <p class="small muted">${p.location ? `Ubicación: ${escapeHtml(p.location)}` : '&nbsp;'}</p>
          <p class="small muted portfolio-card-promoter ${promoterText ? '' : 'is-empty'}">${promoterText || '&nbsp;'}</p>
        </div>
          ${pendingDisbursementAlert}
          ${returnedDisbursementAlert}
          <div class="portfolio-card-commercial">
            <span class="portfolio-card-progress-title">Avance comercial</span>
            <progress class="portfolio-card-progress" max="100" value="${soldPct}" aria-label="${soldPct}% de unidades vendidas">${soldPct}%</progress>
            <p class="portfolio-card-sales">${escapeHtml(String(unitsSold))}/${escapeHtml(String(unitsTotal))} unidades vendidas <span aria-hidden="true">&middot;</span> ${soldPct} %</p>
          </div>
          <div class="portfolio-card-actions">
            <a class="btn portfolio-card-open" href="/project?id=${encodeURIComponent(p._id)}&ref=portfolio">Abrir</a>
          </div>
        </div>
      </article>
    `;
  }

  async function openPortfolioSecureFile(url) {
    const token = API.getToken?.() || localStorage.getItem('token') || '';
    const tenant = API.getTenant?.() || localStorage.getItem('tenantKey') || localStorage.getItem('tenant') || '';
    const headers = {};
    if (token) headers.Authorization = String(token).toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`;
    if (tenant) { headers['X-Tenant'] = tenant; headers['X-Tenant-Key'] = tenant; }
    const response = await fetch(url, { headers, credentials: 'include' });
    if (!response.ok) throw new Error('No se pudo abrir el documento.');
    const objectUrl = URL.createObjectURL(await response.blob());
    window.open(objectUrl, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  }

  function requirementStatusLabel(status) {
    return status === 'compliant' ? 'Cumplido' : status === 'expired' ? 'Vencido' : 'Pendiente';
  }

  function verdictLabel(verdict) {
    return ({ favorable: 'Favorable', conditional: 'Favorable con condiciones', unfavorable: 'Desfavorable', not_assessed: 'Sin valorar' })[verdict] || 'Sin valorar';
  }

  async function openDisbursementReview(projectId) {
    const overlay = document.createElement('div');
    overlay.className = 'portfolio-disbursement-review-backdrop';
    overlay.innerHTML = '<section class="portfolio-disbursement-review"><p>Cargando solicitud…</p></section>';
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', event => { if (event.target === overlay || event.target.closest('[data-close-disbursement-review]')) close(); });
    try {
      const data = await API.get(`/api/projects/${encodeURIComponent(projectId)}/finance/disbursement-requests`);
      const requests = (data.requests || []).filter(item => {
        if (role === 'bank') return item.status === 'requested';
        if (role === 'promoter') return item.status === 'returned' && !item.returnAlertAcknowledgedAt;
        return item.status === 'requested' || (item.status === 'returned' && !item.returnAlertAcknowledgedAt);
      });
      overlay.querySelector('section').innerHTML = `
        <header><div><span class="small muted">Revisión bancaria</span><h2>${escapeHtml(data.project?.name || 'Proyecto')}</h2><p>Comprueba los tres elementos necesarios antes de confirmar la transferencia.</p></div><button class="btn btn-ghost" type="button" data-close-disbursement-review>✕ Cerrar</button></header>
        <div class="portfolio-disbursement-review-list">
          ${requests.length ? requests.map(item => {
            const issues = Number(item.requirementSummary?.issues || 0);
            if (item.status === 'returned') return `<article class="portfolio-disbursement-request is-returned" data-line-id="${escapeHtml(item.lineId)}" data-entry-id="${escapeHtml(item.entryId)}">
              <div class="portfolio-disbursement-request-head"><div><span class="finance-status is-danger">Solicitud devuelta</span><h3>${escapeHtml(item.report?.accountName || `Cuenta n.º ${item.advanceAccountNumber || '—'}`)} · ${escapeHtml(item.phaseName || 'Fase')}</h3></div><div class="portfolio-request-bank-amount"><span>Importe solicitado</span><strong>${Number(item.bankAmount || 0).toLocaleString('es-PA', { style: 'currency', currency: data.project?.currency || 'PAB' })}</strong></div></div>
              <section class="portfolio-return-reason"><b>Motivo indicado por el banco</b><p>${escapeHtml(item.returnComment || 'Sin detalle adicional.')}</p></section>
              <footer><a class="btn" href="/project?id=${encodeURIComponent(projectId)}&ref=portfolio#finanzas">Corregir en Finanzas</a><button class="btn btn-ghost" type="button" data-acknowledge-return>Marcar atendida</button></footer>
            </article>`;
            return `<article class="portfolio-disbursement-request" data-line-id="${escapeHtml(item.lineId)}" data-entry-id="${escapeHtml(item.entryId)}" data-has-issues="${issues > 0 ? '1' : '0'}">
              <div class="portfolio-disbursement-request-head"><div><span class="finance-status is-warn">Solicitud de desembolso</span><h3>${escapeHtml(item.report?.accountName || `Cuenta n.º ${item.advanceAccountNumber || '—'}`)}${Number(item.report?.revision || 1) > 1 ? ` · Revisión ${Number(item.report.revision)}` : ''}</h3><small>${escapeHtml(item.phaseName || 'Fase')} · ${escapeHtml(item.lineName)}</small>${item.fundingParty === 'mixed' ? `<small>Aporte promotor: ${Number(item.promoterAmount || 0).toLocaleString('es-PA', { style: 'currency', currency: data.project?.currency || 'PAB' })} · ${item.promoterContributionStatus === 'contributed' ? 'confirmado' : 'pendiente'}</small>` : ''}</div><div class="portfolio-request-bank-amount"><span>Solicitado al banco</span><strong>${Number(item.bankAmount || 0).toLocaleString('es-PA', { style: 'currency', currency: data.project?.currency || 'PAB' })}</strong></div></div>
              <div class="portfolio-disbursement-checks">
                <section><b>1. Solicitud firmada</b><p>${escapeHtml(item.requestDocument?.name || 'No adjuntada')}</p>${item.requestDocument ? `<button class="btn btn-xs" type="button" data-open-secure="${escapeHtml(item.requestDocument.url)}">Ver carta PDF</button>` : '<span class="finance-status is-missing">Falta documento</span>'}</section>
                <section><b>2. Informe del avaluador</b><p>${escapeHtml(item.report?.number || 'Sin informe')} ${item.report ? `· Avance ${Number(item.report.progress || 0).toFixed(1)}%` : ''}</p>${item.report ? `<span class="finance-status ${item.report.verdict === 'unfavorable' ? 'is-danger' : item.report.verdict === 'favorable' ? 'is-ok' : 'is-warn'}">${escapeHtml(verdictLabel(item.report.verdict))}</span>${item.report.conditions ? `<small class="portfolio-report-conditions">${escapeHtml(item.report.conditions)}</small>` : ''}<button class="btn btn-xs" type="button" data-open-secure="${escapeHtml(item.report.url)}">Ver informe PDF</button>` : '<span class="finance-status is-missing">Falta informe</span>'}</section>
                <section><b>3. Requisitos de la fase</b><p>${item.requirementSummary?.compliant || 0} de ${item.requirementSummary?.total || 0} cumplidos al solicitar</p><span class="finance-status ${issues ? 'is-warn' : 'is-ok'}">${issues ? `${issues} por revisar` : 'Todo conforme'}</span></section>
              </div>
              <details class="portfolio-requirement-review" ${issues ? 'open' : ''}><summary>Ver requisitos</summary><div>${(item.requirements || []).map(req => `<div><span class="finance-status ${req.reviewStatus === 'compliant' ? 'is-ok' : 'is-warn'}">${requirementStatusLabel(req.reviewStatus)}</span><span><b>${escapeHtml(req.title || 'Requisito')}</b>${req.information || req.manualInformation || req.observations ? `<small>${escapeHtml(req.manualInformation || req.information || req.observations)}</small>` : ''}${(req.documents || []).length ? `<span class="portfolio-requirement-docs">${req.documents.map(document => `<button class="btn btn-ghost btn-xs" type="button" data-open-secure="${escapeHtml(document.url)}">${escapeHtml(document.name)}</button>`).join('')}</span>` : ''}</span></div>`).join('') || '<p class="muted">La fase no tiene requisitos configurados.</p>'}</div></details>
              <div class="portfolio-disbursement-decision"><label><span>Fecha de transferencia</span><input class="input" type="date" data-transfer-date value="${new Date().toISOString().slice(0, 10)}"></label><label><span>Referencia <em>(opcional)</em></span><input class="input" data-transfer-reference maxlength="120"></label>${issues ? '<label class="is-wide"><span>Justificación para continuar con requisitos pendientes</span><textarea class="input" data-override-comment rows="2" maxlength="500" required></textarea></label>' : ''}</div>
              <footer><a class="btn btn-ghost" href="/project?id=${encodeURIComponent(projectId)}&ref=portfolio#finanzas">Abrir detalle financiero</a><button class="btn btn-danger" type="button" data-return-request>Devolver al promotor</button><button class="btn btn-success" type="button" data-confirm-request>Marcar como desembolsado</button></footer>
            </article>`;
          }).join('') : '<div class="card"><p>No quedan solicitudes pendientes en este proyecto.</p></div>'}
        </div>`;

      overlay.querySelector('section').addEventListener('click', async event => {
        const secure = event.target.closest('[data-open-secure]');
        if (secure) {
          try { await openPortfolioSecureFile(secure.dataset.openSecure); } catch (error) { alert(error.message); }
          return;
        }
        const card = event.target.closest('[data-entry-id]');
        if (!card) return;
        const endpoint = `/api/projects/${encodeURIComponent(projectId)}/finance/loan-lines/${encodeURIComponent(card.dataset.lineId)}/entries/${encodeURIComponent(card.dataset.entryId)}/status`;
        const acknowledgeButton = event.target.closest('[data-acknowledge-return]');
        if (acknowledgeButton) {
          acknowledgeButton.disabled = true;
          try { await API.patch(endpoint, { action: 'acknowledge_return' }); close(); await loadList(); } catch (error) { acknowledgeButton.disabled = false; alert(error.message || 'No se pudo atender la alerta.'); }
          return;
        }
        const returnButton = event.target.closest('[data-return-request]');
        if (returnButton) {
          const comment = prompt('Indica claramente qué debe corregir el promotor:');
          if (!comment?.trim()) return;
          returnButton.disabled = true;
          try { await API.patch(endpoint, { action: 'return', comment: comment.trim() }); close(); await loadList(); } catch (error) { returnButton.disabled = false; alert(error.message || 'No se pudo devolver la solicitud.'); }
          return;
        }
        const confirmButton = event.target.closest('[data-confirm-request]');
        if (confirmButton) {
          const transferDate = card.querySelector('[data-transfer-date]')?.value;
          const overrideComment = card.querySelector('[data-override-comment]')?.value?.trim() || '';
          if (!transferDate) return alert('Indica la fecha efectiva de transferencia.');
          if (card.dataset.hasIssues === '1' && !overrideComment) return alert('Explica por qué se continúa con requisitos pendientes o vencidos.');
          confirmButton.disabled = true;
          try {
            await API.patch(endpoint, { action: 'disburse', transferDate, transferReference: card.querySelector('[data-transfer-reference]')?.value?.trim() || '', overrideComment });
            close();
            await loadList();
          } catch (error) { confirmButton.disabled = false; alert(error.message || 'No se pudo confirmar el desembolso.'); }
        }
      });
    } catch (error) {
      overlay.querySelector('section').innerHTML = `<header><h2>No se pudo abrir la solicitud</h2><button class="btn btn-ghost" data-close-disbursement-review>✕ Cerrar</button></header><p>${escapeHtml(error.message || 'Inténtalo de nuevo.')}</p>`;
    }
  }

  container?.addEventListener('click', event => {
    const button = event.target.closest('[data-review-disbursements]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    openDisbursementReview(button.dataset.reviewDisbursements);
  });

  // ===== Portfolio list + search =====
  let FULL_LIST = [];

  function renderList(list) {
    if (!Array.isArray(list) || list.length === 0) {
      const showPlaceholder = FULL_LIST.length === 0;
      container.innerHTML = showPlaceholder ? placeholderCard() : '';
      if (banner) banner.style.display = showPlaceholder ? 'none' : 'block';
      return;
    }
    if (banner) banner.style.display = 'none';
    container.innerHTML = list.map(card).join('');
  }

  async function loadList() {
    try {
      const list = await API.get('/api/projects/portfolio');
      FULL_LIST = Array.isArray(list) ? list : [];
      decoratePromoterNames();
      applyAllFilters();

      // Reaplicar filtro si ya había texto
      if (searchInput && searchInput.value) applyAllFilters();
    } catch (e) {
      container.innerHTML = `<div class="card">Error: ${escapeHtml(e.message || e)}</div>`;
      if (banner) banner.style.display = 'none';
    }
  }

  // Hook buscador (NO se inyecta nada, existe en tu HTML)
  const searchInput = document.getElementById('portfolioSearch');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => applyAllFilters(), 120));
  }

  if (filterBtn) {
    filterBtn.addEventListener('click', async () => {
      if (filterModalBackdrop) filterModalBackdrop.classList.add('show');
      await loadPromotersForFilters();
    });
  }

  if (closeFilterModalBtn) {
    closeFilterModalBtn.addEventListener('click', () => {
      if (filterModalBackdrop) filterModalBackdrop.classList.remove('show');
    });
  }

  if (applyFiltersBtn) {
    applyFiltersBtn.addEventListener('click', () => {
      applyAllFilters();
      if (filterModalBackdrop) filterModalBackdrop.classList.remove('show');
    });
  }

  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', () => {
      if (filterPromoter) filterPromoter.value = '';
      if (filterStatus) filterStatus.value = '';
      if (filterSort) filterSort.value = 'updatedAt_desc';
      if (filterSoldOnly) filterSoldOnly.checked = false;
      applyAllFilters();
    });
  }

  if (filterModalBackdrop) {
    filterModalBackdrop.addEventListener('click', (e) => {
      if (e.target === filterModalBackdrop) {
        filterModalBackdrop.classList.remove('show');
      }
    });
  }

  if (filterStatus) {
    filterStatus.addEventListener('change', () => applyAllFilters());
  }

  if (filterSort) {
    filterSort.addEventListener('change', () => applyAllFilters());
  }

  if (filterSoldOnly) {
    filterSoldOnly.addEventListener('change', () => applyAllFilters());
  }

  // ===== Modal crear proyecto =====
  const modal = document.getElementById('modalBackdrop');
  const fab = document.getElementById('fabPlus');
  const btnCancel = document.getElementById('cancelCreate');
  const btnCloseCreate = document.getElementById('closeCreateModal');
  const btnExpandCreate = document.getElementById('expandCreateModal');
  const btnCreate = document.getElementById('createProject');
  const createFacilities = document.getElementById('createFacilities');
  const createStepTabs = Array.from(document.querySelectorAll('[data-create-step]'));
  const createStepPanels = Array.from(document.querySelectorAll('[data-create-panel]'));
  const prevCreateStepBtn = document.getElementById('prevCreateStep');
  const nextCreateStepBtn = document.getElementById('nextCreateStep');
  const createModalBody = modal?.querySelector('.create-modal-body');
  const createBoardMembers = document.getElementById('createBoardMembers');
  const createShareholders = document.getElementById('createShareholders');
  const createHousingModels = document.getElementById('createHousingModels');
  const createFinancePhases = document.getElementById('createFinancePhases');
  const createDatoUnicoFileInput = document.getElementById('createDatoUnicoFile');
  const createDatoUnicoFileName = document.getElementById('createDatoUnicoFileName');
  const clearCreateDatoUnicoFileBtn = document.getElementById('clearCreateDatoUnicoFile');
  const createDatoUnicoWarning = document.getElementById('createDatoUnicoWarning');
  const createDatoUnicoPreviewPanel = document.getElementById('createDatoUnicoPreview');
  const createDatoUnicoPreviewSummary = document.getElementById('createDatoUnicoPreviewSummary');
  const createDatoUnicoPreviewMessage = document.getElementById('createDatoUnicoPreviewMessage');
  const createDatoUnicoModels = document.getElementById('createDatoUnicoModels');
  const createImportModeNotice = document.getElementById('createImportModeNotice');
  const createManualModelsPanel = document.getElementById('createManualModelsPanel');
  const CREATE_STEP_ORDER = ['general', 'legal', 'technical', 'progress', 'financial', 'team'];
  let activeCreateStep = 'general';
  let createDatoUnicoFileState = null;
  let createDatoUnicoPreviewState = null;
  let createDatoUnicoPreviewRequest = 0;
  let createDatoUnicoTemplateState = null;
  let createManualTotalUnitsSnapshot = '';
  let isCreatingProject = false;
  const BANK_REQUIREMENT_TITLES = [
    'Presupuesto del proyecto',
    'Experiencia del promotor y contratista en el desarrollo y promoción de proyectos',
    'Composición accionaria',
    'Imágenes del proyecto y planta arquitectónica del modelo de la unidad',
    'Estudio de mercado realizado por un tercero',
    'Avalúo del terreno donde se desarrollará el proyecto',
    'Estados financieros de la sociedad deudora (si aplica)',
    'Estados financieros y/o declaración de renta de los accionistas',
    'Identificación de accionistas y dignatarios',
    'Estudio de Impacto Ambiental (EIA) con resolución aprobada',
    'Cronograma de ejecución de la obra',
    'Flujo de fondos del proyecto',
    'Aviso de operaciones',
    'Formulario para consulta APC de accionistas y sociedad',
    'Paz y Salvo de la Caja de Seguro Social',
    'Planos de anteproyecto firmados por arquitecto e ingeniero',
    'Formulario de Debida Diligencia',
    'Manual de Cumplimiento',
    'Estudio hidrológico del río y validación de niveles de inundación en planos aprobados por el MOP',
    'Preventas netas requeridas de la etapa a financiar y cesión suficiente para cubrir la facilidad aprobada',
    'Certificación inicial del inspector independiente sobre costos, permisos, pólizas y documentos requeridos',
    'Revisión y validación del presupuesto de construcción por la Gerencia de Ingeniería',
    'Contrato de construcción',
    'Póliza CAR por el 100% del valor de construcción, endosada al Banco / Póliza incendio',
    'Fianza de cumplimiento requerida sobre el valor de la etapa',
    'Fianza de pago requerida sobre el valor de la etapa',
    'Informe de Inspección de Ingeniería',
    'Revisión y validación del presupuesto de construcción por la Gerencia de Ingeniería',
    'Cuenta Avance'
  ];
  const REQUIREMENT_PROMOTER_FIELDS = [
    ['yearsExperience','Años de experiencia','number'], ['deliveredProjects','Proyectos entregados','number'], ['activeProjects','Proyectos activos','number'],
    ['developedUnits','Unidades desarrolladas','number'], ['countries','Países de operación','list'], ['developedVolume','Volumen total desarrollado','number'],
    ['averageProjectTicket','Ticket medio de proyecto','number'], ['bankFinancingExperience','Experiencia con financiación bancaria','yesno'],
    ['banksWorkedWith','Bancos con los que ha trabajado','list'], ['onTimeDeliveryHistory','Historial de entregas a tiempo','text'],
    ['incidentHistory','Historial de incidencias legales o técnicas','text'], ['documentationLevel','Nivel de documentación disponible','doclevel']
  ];
  const createPhaseRequirementsState = new Map();
  const createRequirementFilesState = new Map();
  let createArchitecturalPlanFilesState = [];
  let createRequirementPromoterDraft = null;
  let createRequirementPromoterOriginal = null;
  let createRequirementLegalDraft = null;
  let createTotalUnitsManuallyEdited = false;
  let createLastSuggestedUnitsTotal = 0;

  function setCreateArchitecturalPlanFiles(files = []) {
    createArchitecturalPlanFilesState = Array.from(files || []);
    const text = createArchitecturalPlanFilesState.length
      ? createArchitecturalPlanFilesState.map(file => file.name).join(', ')
      : 'Sin planos adjuntos';
    const technicalLabel = document.getElementById('createArchitecturalPlansName');
    if (technicalLabel) technicalLabel.textContent = text;
    document.querySelectorAll('[data-create-architectural-plan-name]').forEach(label => { label.textContent = text; });
  }

  function createInsuranceUnitOptions(selectedRefs = []) {
    const selected = new Set((selectedRefs || []).map(String));
    const units = hasCreateDatoUnicoFile()
      ? (createDatoUnicoPreviewState?.units || [])
      : collectInitialUnits();
    return units.map(unit => {
      const ref = String(unit.reference || unit.code || `${unit.manzana || unit.modelo || ''}-${unit.lote || ''}`).trim();
      return ref ? `<label><input type="checkbox" data-insurance-unit-ref value="${escapeHtml(ref)}" ${selected.has(ref) ? 'checked' : ''}> ${escapeHtml(ref)}</label>` : '';
    }).join('') || '<span class="small muted">Define primero las unidades del proyecto.</span>';
  }

  function createInsurancePolicyRow(policy = {}) {
    const appliesAll = policy.appliesToAllUnits !== false;
    return `<div class="insurance-policy-row" data-create-insurance-policy>
      <button type="button" class="btn btn-ghost btn-xs insurance-policy-remove" data-remove-insurance-policy aria-label="Eliminar póliza">×</button>
      <label>Tipo<select data-insurance-field="type"><option value="CAR" ${policy.type !== 'INCENDIO' ? 'selected' : ''}>CAR</option><option value="INCENDIO" ${policy.type === 'INCENDIO' ? 'selected' : ''}>Incendio</option></select></label>
      <label>Aseguradora<input data-insurance-field="insurer" value="${escapeHtml(policy.insurer || '')}"></label>
      <label>Nº de póliza<input data-insurance-field="policyNumber" value="${escapeHtml(policy.policyNumber || '')}"></label>
      <label>Suma asegurada<input data-insurance-field="insuredAmount" data-bank-number inputmode="decimal" value="${policy.insuredAmount ? escapeHtml(formatBankNumber(policy.insuredAmount)) : ''}"></label>
      <label>Fecha de inicio<input data-insurance-field="startDate" type="date" value="${policy.startDate ? String(policy.startDate).slice(0,10) : ''}"></label>
      <label>Fecha de vencimiento<input data-insurance-field="expiryDate" type="date" value="${policy.expiryDate ? String(policy.expiryDate).slice(0,10) : ''}"></label>
      <label>Endosada al banco<select data-insurance-field="endorsedToBank"><option value="false" ${policy.endorsedToBank ? '' : 'selected'}>No</option><option value="true" ${policy.endorsedToBank ? 'selected' : ''}>Sí</option></select></label>
      <label>Banco<input data-insurance-field="bank" value="${escapeHtml(policy.bank || '')}" ${policy.endorsedToBank ? '' : 'disabled'}></label>
      <label class="insurance-policy-wide">Aplicación<select data-insurance-field="appliesToAllUnits"><option value="true" ${appliesAll ? 'selected' : ''}>Todas las unidades</option><option value="false" ${appliesAll ? '' : 'selected'}>Unidades concretas</option></select></label>
      <div class="insurance-policy-wide insurance-policy-units" data-insurance-units style="display:${appliesAll ? 'none' : 'grid'}">${createInsuranceUnitOptions(policy.unitRefs || [])}</div>
      <label class="insurance-policy-wide">Documento<input data-insurance-document type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"><span class="small muted" data-insurance-document-name>${escapeHtml(policy.documentName || 'Sin documento')}</span></label>
    </div>`;
  }

  function bindCreateInsurancePolicyRow(row) {
    bindBankNumberFormatting(row);
    row.querySelector('[data-remove-insurance-policy]')?.addEventListener('click', () => row.remove());
    row.querySelector('[data-insurance-field="appliesToAllUnits"]')?.addEventListener('change', event => {
      row.querySelector('[data-insurance-units]').style.display = event.target.value === 'true' ? 'none' : 'grid';
    });
    row.querySelector('[data-insurance-field="endorsedToBank"]')?.addEventListener('change', event => {
      const bank = row.querySelector('[data-insurance-field="bank"]');
      bank.disabled = event.target.value !== 'true';
      if (bank.disabled) bank.value = '';
    });
    row.querySelector('[data-insurance-document]')?.addEventListener('change', event => {
      row.querySelector('[data-insurance-document-name]').textContent = event.target.files?.[0]?.name || 'Sin documento';
    });
  }

  function addCreateInsurancePolicy(policy = {}) {
    const host = document.getElementById('createInsurancePolicies');
    if (!host) return;
    host.insertAdjacentHTML('beforeend', createInsurancePolicyRow(policy));
    bindCreateInsurancePolicyRow(host.lastElementChild);
  }

  function collectCreateInsurancePolicies({ includeFiles = false } = {}) {
    return Array.from(document.querySelectorAll('[data-create-insurance-policy]')).map(row => {
      const get = key => row.querySelector(`[data-insurance-field="${key}"]`)?.value || '';
      const appliesToAllUnits = get('appliesToAllUnits') !== 'false';
      const item = {
        type: get('type') || 'CAR', insurer: get('insurer').trim(), policyNumber: get('policyNumber').trim(),
        insuredAmount: numberFromCreate(get('insuredAmount')), startDate: get('startDate') || null, expiryDate: get('expiryDate') || null,
        endorsedToBank: get('endorsedToBank') === 'true', bank: get('bank').trim(), appliesToAllUnits,
        unitRefs: appliesToAllUnits ? [] : Array.from(row.querySelectorAll('[data-insurance-unit-ref]:checked')).map(input => input.value),
        documentId: row.dataset.documentId || null,
        documentName: row.querySelector('[data-insurance-document]')?.files?.[0]?.name || row.querySelector('[data-insurance-document-name]')?.textContent || ''
      };
      if (includeFiles) item.__file = row.querySelector('[data-insurance-document]')?.files?.[0] || null;
      return item;
    });
  }

  function refreshCreatePolicyUnitOptions() {
    document.querySelectorAll('[data-create-insurance-policy]').forEach(row => {
      const box = row.querySelector('[data-insurance-units]');
      if (!box) return;
      const selected = Array.from(box.querySelectorAll('[data-insurance-unit-ref]:checked')).map(input => input.value);
      box.innerHTML = createInsuranceUnitOptions(selected);
    });
  }

  document.getElementById('addCreateInsurancePolicy')?.addEventListener('click', () => addCreateInsurancePolicy());

  function syncCreateFundingRequestVisibility() {
    const seeks = fundingModuleEnabled && document.getElementById('pSeeksFinancing')?.value === 'true';
    const section = document.getElementById('createFundingRequestSection');
    const requested = document.getElementById('fundingRequestedAmount');
    const deadlineLabel = document.getElementById('pFundingDeadlineLabel');
    const deadline = document.getElementById('pFundingDeadline');
    const legalAssessment = document.getElementById('createLegalAssessmentSection');
    const technicalAssessment = document.getElementById('createTechnicalAssessmentSection');
    const progressChecks = document.getElementById('createProgressChecks');
    const fundingDocumentsNotice = document.getElementById('createFundingDocumentsNotice');
    if (section) section.style.display = seeks ? '' : 'none';
    if (requested) requested.required = seeks;
    if (deadlineLabel) deadlineLabel.style.display = seeks ? '' : 'none';
    if (deadline) deadline.required = seeks;
    if (legalAssessment) legalAssessment.style.display = seeks ? '' : 'none';
    if (technicalAssessment) technicalAssessment.style.display = seeks ? '' : 'none';
    if (progressChecks) progressChecks.classList.toggle('show-financing-docs', seeks);
    if (fundingDocumentsNotice) fundingDocumentsNotice.style.display = seeks ? '' : 'none';
    if (!seeks) {
      const error = document.getElementById('createFundingRequestError');
      if (error) error.style.display = 'none';
      const deadlineError = document.getElementById('pFundingDeadlineError');
      if (deadlineError) deadlineError.style.display = 'none';
    }
  }

  function setCreateStep(step) {
    activeCreateStep = CREATE_STEP_ORDER.includes(step) ? step : 'general';
    createStepTabs.forEach(btn => btn.classList.toggle('active', btn.dataset.createStep === activeCreateStep));
    createStepPanels.forEach(panel => panel.classList.toggle('active', panel.dataset.createPanel === activeCreateStep));
    const idx = CREATE_STEP_ORDER.indexOf(activeCreateStep);
    if (prevCreateStepBtn) prevCreateStepBtn.disabled = idx <= 0;
    if (nextCreateStepBtn) nextCreateStepBtn.style.display = idx >= CREATE_STEP_ORDER.length - 1 ? 'none' : '';
    requestAnimationFrame(() => {
      if (createModalBody) createModalBody.scrollTop = 0;
    });
  }

  function createCompletionFieldApplies(field, panel) {
    if (!field || field.disabled || field.readOnly || field.dataset.completionOptional !== undefined) return false;
    if (field.matches('button, [type="button"], [type="submit"], [type="reset"], [type="hidden"]')) return false;
    let node = field;
    while (node && node !== panel) {
      if (node.hidden || node.style?.display === 'none') return false;
      node = node.parentElement;
    }
    return true;
  }

  function createCompletionFieldFilled(field) {
    if (field.matches('[type="checkbox"], [type="radio"]')) return field.checked;
    if (field.matches('[type="file"]')) return !!field.files?.length;
    if (field.matches('select[multiple]')) return Array.from(field.selectedOptions || []).some(option => String(option.value || '').trim());
    return String(field.value ?? '').trim() !== '';
  }

  function updateCreateStepCompletion() {
    createStepTabs.forEach(tab => {
      const step = tab.dataset.createStep;
      const panel = createStepPanels.find(item => item.dataset.createPanel === step);
      if (!panel) return;
      const fields = Array.from(panel.querySelectorAll('input, select, textarea'))
        .filter(field => createCompletionFieldApplies(field, panel));
      const pending = fields.filter(field => !createCompletionFieldFilled(field)).length;
      const complete = fields.length > 0 && pending === 0;
      tab.classList.toggle('is-complete', complete);
      tab.classList.toggle('is-incomplete', !complete);
      const status = tab.querySelector('.create-step-status');
      const statusText = complete ? '✓' : String(pending);
      if (status && status.textContent !== statusText) status.textContent = statusText;
      const stateLabel = complete ? 'Completa' : `${pending} campo${pending === 1 ? '' : 's'} pendiente${pending === 1 ? '' : 's'}`;
      tab.title = stateLabel;
      tab.setAttribute('aria-label', `${tab.textContent.replace(/\s*[✓…\d]+\s*$/, '').trim()}. ${stateLabel}.`);
    });
  }

  let createCompletionFrame = 0;
  function scheduleCreateStepCompletion() {
    cancelAnimationFrame(createCompletionFrame);
    createCompletionFrame = requestAnimationFrame(updateCreateStepCompletion);
  }

  modal?.addEventListener('input', scheduleCreateStepCompletion);
  modal?.addEventListener('change', scheduleCreateStepCompletion);
  modal?.addEventListener('click', () => setTimeout(scheduleCreateStepCompletion, 0));
  if (createModalBody && window.MutationObserver) {
    new MutationObserver(scheduleCreateStepCompletion).observe(createModalBody, { childList: true, subtree: true });
  }

  document.getElementById('pSeeksFinancing')?.addEventListener('change', syncCreateFundingRequestVisibility);
  syncCreateFundingRequestVisibility();

  function applyFundingModuleVisibility() {
    const choice = document.getElementById('createFundingChoice');
    const section = document.getElementById('fundingOpportunitiesSection');
    // Oculto temporalmente en el alta de proyectos. Se conserva el campo para
    // poder reactivar la funcionalidad sin cambiar el formato del formulario.
    if (choice) {
      choice.hidden = true;
      choice.style.display = 'none';
    }
    const createSeeksFinancing = document.getElementById('pSeeksFinancing');
    if (createSeeksFinancing) createSeeksFinancing.value = 'false';
    if (!fundingModuleEnabled) {
      if (section) section.style.display = 'none';
      document.getElementById('fundingOpportunityModal')?.remove();
    }
    syncCreateFundingRequestVisibility();
  }

  async function syncFundingModuleVisibility() {
    try {
      const settings = await API.get('/api/funding/module-settings');
      fundingModuleEnabled = settings?.enabled === true;
    } catch (_error) {
      fundingModuleEnabled = false;
    }
    applyFundingModuleVisibility();
  }

  function fundingDeadlineLabel(value, fallback = '') {
    if (!value) return fallback || 'Fecha límite no indicada';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback || 'Fecha límite no indicada';
    return `Hasta ${date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
  }

  async function getFundingOpportunityDetail(opportunityId) {
    if (fundingOpportunityDetailCache.has(opportunityId)) return fundingOpportunityDetailCache.get(opportunityId);
    if (fundingOpportunityDetailRequests.has(opportunityId)) return fundingOpportunityDetailRequests.get(opportunityId);
    const request = API.get(`/api/funding/opportunities/${encodeURIComponent(opportunityId)}`)
      .then(item => {
        fundingOpportunityDetailCache.set(opportunityId, item);
        return item;
      })
      .finally(() => fundingOpportunityDetailRequests.delete(opportunityId));
    fundingOpportunityDetailRequests.set(opportunityId, request);
    return request;
  }

  async function loadFundingOpportunities() {
    const section = document.getElementById('fundingOpportunitiesSection');
    const target = document.getElementById('fundingOpportunityCards');
    if (!fundingModuleEnabled || !section || !target) return;
    try {
      const list = await API.get('/api/funding/opportunities');
      section.style.display = '';
      target.innerHTML = list.length ? list.map(item => {
        const currency = escapeHtml(item.currency || 'PAB');
        const moneyLabel = value => `${Number(value || 0).toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${currency}`;
        return `
        <article class="card funding-opportunity-card">
          <div class="funding-opportunity-cover">
            <img src="${escapeHtml(item.coverImage?.path || DEFAULT_PROJECT_COVER)}" alt="Portada de ${escapeHtml(item.name || 'proyecto')}">
            <div class="funding-opportunity-cover-tags">
              <span class="funding-opportunity-pill">${escapeHtml(item.projectType || 'Proyecto inmobiliario')}</span>
              <span class="funding-opportunity-pill is-term">${escapeHtml(fundingDeadlineLabel(item.fundingDeadline, item.estimatedTerm))}</span>
            </div>
          </div>
          <div class="funding-opportunity-body">
            <h3 class="funding-opportunity-title">${escapeHtml(item.name)}</h3>
            <p class="funding-opportunity-subtitle">Oportunidad de financiación publicada por Bank73</p>
            <div class="funding-opportunity-metrics">
              <div class="funding-opportunity-metric is-primary"><div><span>Monto solicitado a través de Bank73</span><strong>${moneyLabel(item.requestedAmount)}</strong></div><span>Solicitud financiera</span></div>
              <div class="funding-opportunity-metric"><span>Fondos asegurados</span><strong>${moneyLabel(item.securedRequestAmount)}</strong></div>
              <div class="funding-opportunity-metric"><span>Pendiente de financiar</span><strong>${moneyLabel(item.requestPendingAmount)}</strong></div>
              <div class="funding-opportunity-metric"><span>Coste total</span><strong>${moneyLabel(item.totalCost)}</strong></div>
              <div class="funding-opportunity-metric is-viability"><span>Venta potencial del inventario</span><strong>${moneyLabel(item.potentialSalesValue)}</strong></div>
            </div>
            <div class="funding-opportunity-coverage">
              <div class="funding-opportunity-coverage-head"><span>Cobertura de la solicitud</span><strong>${Math.round(item.requestCoveredPct || 0)}% asegurado</strong></div>
              <div class="progress funding-opportunity-progress"><div style="width:${Math.min(100, Number(item.requestCoveredPct || 0))}%"></div></div>
              <div class="funding-opportunity-coverage-caption">${moneyLabel(item.securedRequestAmount)} asegurados · ${moneyLabel(item.requestPendingAmount)} pendientes</div>
            </div>
            <div class="funding-opportunity-coverage is-presales">
              <div class="funding-opportunity-coverage-head"><span>Avance de preventas</span><strong>${Number(item.unitsSold || 0)}/${Number(item.unitsTotal || 0)} unidades (${Math.round(item.presalesPct || 0)}%)</strong></div>
              <div class="progress funding-opportunity-progress is-presales"><div style="width:${Math.min(100, Number(item.presalesPct || 0))}%"></div></div>
            </div>
            <p class="funding-opportunity-viability-note">La venta potencial se calcula con los precios de lista actuales; no equivale a beneficio neto.</p>
            <div class="funding-opportunity-actions"><button class="btn" type="button" data-funding-opportunity="${escapeHtml(item._id)}">Ver oferta completa</button></div>
          </div>
        </article>`;
      }).join('') : '<p class="funding-marketplace-empty muted">No hay oportunidades publicadas en este momento.</p>';
    } catch (err) { section.style.display = 'none'; console.warn(err); }
  }

  async function loadCreatePromoterProfiles() {
    const select = document.getElementById('ld-promoterProfileSelect');
    if (!select || createPromoterProfilesLoaded) return;
    if (!['admin', 'bank'].includes(role)) {
      select.closest('label')?.setAttribute('hidden', '');
      return;
    }
    select.innerHTML = '<option value="">Cargando promotores...</option>';
    try {
      const data = await API.get('/api/projects/assignees?role=promoter');
      const list = (data && data.users) || [];
      createPromoterProfiles.clear();
      select.innerHTML = '<option value="">Seleccionar promotor</option><option value="__manual__">Rellenar manualmente</option>';
      list.forEach(user => {
        const opt = document.createElement('option');
        opt.value = user._id;
        const company = primaryPromoterCompany(user.promoterProfile);
        opt.textContent = `${user.name || user.email || 'Promotor'}${company ? ` - ${company}` : ''}`;
        select.appendChild(opt);
        createPromoterProfiles.set(String(user._id), user);
      });
      createPromoterProfilesLoaded = true;
    } catch (e) {
      select.innerHTML = '<option value="">Seleccionar promotor</option><option value="__manual__">Rellenar manualmente</option>';
      console.warn('No se pudieron cargar promotores para creacion', e);
    }
  }

  function primaryPromoterCompany(profile = {}) {
    const companies = Array.isArray(profile?.companies) ? profile.companies : [];
    return String((companies.find(company => company?.isPrimary) || companies[0])?.name || profile?.companyName || '').trim();
  }

  function promoterCompanies(profile = {}) {
    const companies = Array.isArray(profile?.companies) ? profile.companies : [];
    const values = companies.filter(company => String(company?.name || '').trim()).map(company => ({
      ...company,
      companyId: String(company?.companyId || company?._id || '').trim()
    }));
    const legacy = String(profile?.companyName || '').trim();
    if (!values.length && legacy) values.push({ companyId: '', name: legacy, ruc: '', shareholders: [] });
    return values;
  }

  function populateCreatePromoterCompanies(profile = {}, preferred = '') {
    const select = document.getElementById('ld-promoterCompanySelect');
    if (!select) return;
    const companies = promoterCompanies(profile);
    createPromoterCompanies.clear();
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = companies.length ? 'Seleccionar sociedad' : 'El promotor no tiene sociedades registradas';
    select.appendChild(placeholder);
    companies.forEach(company => {
      const option = document.createElement('option');
      option.value = company.companyId || company.name;
      option.textContent = company.name;
      select.appendChild(option);
      createPromoterCompanies.set(option.value, company);
    });
    const requested = String(preferred || '').trim();
    const preferredCompany = companies.find(company => company.companyId === requested || company.name === requested);
    select.value = preferredCompany ? (preferredCompany.companyId || preferredCompany.name) : (companies.length === 1 ? (companies[0].companyId || companies[0].name) : '');
    select.disabled = companies.length === 0;
    syncCreateCompanyLegalData();
  }

  function createPromoterIsManual() {
    return role !== 'promoter' && document.getElementById('ld-promoterProfileSelect')?.value === '__manual__';
  }

  function syncCreateCompanyLegalData() {
    const manual = createPromoterIsManual();
    const companySelect = document.getElementById('ld-promoterCompanySelect');
    const company = manual ? null : createPromoterCompanies.get(String(companySelect?.value || ''));
    const manualPromoterLabel = document.getElementById('ld-manualPromoterNameLabel');
    const companySelectLabel = document.getElementById('ld-promoterCompanySelectLabel');
    const manualCompanyLabel = document.getElementById('ld-manualCompanyNameLabel');
    const ruc = document.getElementById('ld-promoterRuc');
    const notice = document.getElementById('createRegisteredCompanyNotice');
    if (manualPromoterLabel) manualPromoterLabel.hidden = !manual;
    if (companySelectLabel) companySelectLabel.hidden = manual;
    if (manualCompanyLabel) manualCompanyLabel.hidden = !manual;
    if (notice) notice.hidden = manual || !company;
    if (ruc) {
      ruc.readOnly = !manual;
      ruc.value = manual ? ruc.value : (company?.ruc || '');
    }
    const legalName = document.getElementById('ld-promoterLegalName');
    if (!manual && legalName) legalName.value = company?.name || '';
    if (!manual) {
      createShareholders.innerHTML = (company?.shareholders || []).map(createShareholderRow).join('');
    } else if (!createShareholders.children.length) {
      createShareholders.insertAdjacentHTML('beforeend', createShareholderRow());
    }
    createShareholders?.querySelectorAll('input, button').forEach(control => { control.disabled = !manual; });
    const addShareholder = document.getElementById('addCreateShareholder');
    if (addShareholder) addShareholder.hidden = !manual;
    scheduleCreateStepCompletion();
  }

  function syncCreateTrustNameVisibility() {
    const applies = document.getElementById('ld-trustApplies')?.value === 'true';
    const label = document.getElementById('ld-trustNameLabel');
    const input = document.getElementById('ld-trustName');
    if (label) label.hidden = !applies;
    if (input) {
      input.disabled = !applies;
      if (!applies) input.value = '';
    }
  }

  let createProcessTemplateLoaded = false;
  let createPermitTemplatesLoaded = false;
  let createPermitTemplates = [];

  function phaseLabel(key) {
    return String(key || 'General').replace(/_/g, ' ');
  }

  async function loadCreateProgressChecks() {
    const host = document.getElementById('createProgressChecks');
    if (!host || createProcessTemplateLoaded) return;
    host.innerHTML = '<div class="small muted">Cargando checks...</div>';
    try {
      const tpl = await API.get('/api/process/templates/active');
      const groups = new Map();
      (tpl.steps || []).forEach(step => {
        if (!step?.key || !step?.title) return;
        const phase = step.phase || 'GENERAL';
        if (!groups.has(phase)) groups.set(phase, []);
        groups.get(phase).push(step);
      });
      const normalizeProgressTitle = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const isPriorityDocument = step => {
        const title = normalizeProgressTitle(step.title);
        const relevantArea = /(jurid|urban|tecnic|comercial|financier)/.test(title);
        return (/(dictamen|opinion)/.test(title) && relevantArea) || (/viabilidad/.test(title) && /financier/.test(title));
      };
      const progressItem = (step, priority = false) => `
        <div class="create-progress-item${priority ? ' is-priority' : ''}">
          <input type="checkbox" data-create-checklist-key="${escapeHtml(step.key)}">
          <div class="create-progress-item-copy">
            <span>${escapeHtml(step.title)}</span>
            ${priority ? '<small>Prioritario para la evaluación financiera</small>' : ''}
          </div>
          <div class="create-checklist-upload">
            <label class="create-checklist-upload-button">
              <span aria-hidden="true">＋</span> Adjuntar
              <input type="file" multiple data-create-checklist-file="${escapeHtml(step.key)}" data-completion-optional aria-label="Adjuntar archivos a ${escapeHtml(step.title)}">
            </label>
            <span class="create-checklist-upload-name" data-create-checklist-file-name>Sin archivos</span>
          </div>
        </div>`;
      const groupedHtml = Array.from(groups.entries()).map(([phase, steps]) => {
        return `
        <details class="create-progress-group">
          <summary class="create-progress-group-title">${escapeHtml(phaseLabel(phase))}</summary>
          <div class="create-progress-group-body">
            ${steps.map(step => progressItem(step, isPriorityDocument(step))).join('')}
          </div>
        </details>
      `;
      }).join('');
      host.innerHTML = groupedHtml || '<div class="small muted">No hay checks configurados.</div>';
      host.addEventListener('change', event => {
        const input = event.target.closest('[data-create-checklist-file]');
        if (!input) return;
        const files = Array.from(input.files || []);
        const name = input.closest('.create-checklist-upload')?.querySelector('[data-create-checklist-file-name]');
        if (name) name.textContent = files.length ? (files.length === 1 ? files[0].name : `${files.length} archivos seleccionados`) : 'Sin archivos';
        input.closest('.create-checklist-upload')?.classList.toggle('has-files', files.length > 0);
      });
      createProcessTemplateLoaded = true;
      syncCreateFundingRequestVisibility();
    } catch (e) {
      host.innerHTML = '<div class="small muted">No se pudieron cargar los checks de avances.</div>';
      console.warn('No se pudieron cargar avances iniciales', e);
    }
  }

  async function loadCreatePermitTemplates() {
    const select = document.getElementById('createPermitTemplate');
    if (!select || createPermitTemplatesLoaded) return;
    try {
      createPermitTemplates = await API.get('/api/permits/templates');
      select.innerHTML = '<option value="">Sin plantilla inicial</option>' + (createPermitTemplates || [])
        .map(t => `<option value="${escapeHtml(t._id)}">${escapeHtml(t.name || 'Plantilla')} (v${escapeHtml(t.version || 1)})</option>`)
        .join('');
      createPermitTemplatesLoaded = true;
    } catch (e) {
      select.innerHTML = '<option value="">No se pudieron cargar plantillas</option>';
      console.warn('No se pudieron cargar plantillas de permisos', e);
    }
  }

  function renderCreateDatoUnicoTemplate() {
    const button = document.getElementById('downloadCreateDatoUnicoTemplate');
    const status = document.getElementById('createDatoUnicoTemplateStatus');
    if (!button || !status) return;
    const available = Boolean(createDatoUnicoTemplateState?.path);
    button.disabled = !available;
    status.textContent = available
      ? `Plantilla publicada por el administrador: ${createDatoUnicoTemplateState.originalname || 'plantilla-dato-unico.xlsx'}`
      : 'El administrador todavía no ha publicado una plantilla general.';
  }

  async function loadCreateDatoUnicoTemplate() {
    try {
      const result = await API.get('/api/projects/commercial-template/info');
      createDatoUnicoTemplateState = result?.commercialTemplate || null;
    } catch (error) {
      console.warn('[commercial-template:create] No se pudo consultar la plantilla', error);
      createDatoUnicoTemplateState = null;
    }
    renderCreateDatoUnicoTemplate();
  }

  async function downloadCreateDatoUnicoTemplate() {
    const button = document.getElementById('downloadCreateDatoUnicoTemplate');
    if (!button || !createDatoUnicoTemplateState?.path) return;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Descargando...';
    try {
      const currentAuth = API.getAuth();
      const response = await fetch('/api/projects/commercial-template/download', {
        headers: {
          Authorization: `Bearer ${API.getToken()}`,
          'x-tenant': currentAuth.tenantKey || currentAuth.tenant || ''
        },
        credentials: 'include'
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'No se pudo descargar la plantilla.');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = createDatoUnicoTemplateState.originalname || 'plantilla-dato-unico.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      alert(error.message || 'No se pudo descargar la plantilla.');
    } finally {
      button.textContent = originalText;
      renderCreateDatoUnicoTemplate();
    }
  }

  function renderCreatePermitItems() {
    const select = document.getElementById('createPermitTemplate');
    const host = document.getElementById('createPermitItems');
    if (!select || !host) return;
    const tpl = createPermitTemplates.find(t => String(t._id) === String(select.value));
    if (!tpl) {
      host.innerHTML = '';
      return;
    }
    const groups = new Map();
    (tpl.items || []).forEach(item => {
      const phase = item.type || String(item.title || '').split(' - ')[0] || 'General';
      if (!groups.has(phase)) groups.set(phase, []);
      groups.get(phase).push(item);
    });
    host.innerHTML = Array.from(groups.entries()).map(([phase, items]) => `
      <details class="create-progress-group">
        <summary class="create-progress-group-title">${escapeHtml(phase)}</summary>
        <div class="create-progress-group-body">
          ${items.map(item => `
            <label class="create-progress-item">
              <span></span>
              <span>${escapeHtml(item.title || item.code)}</span>
              <select data-create-permit-status="${escapeHtml(item.code)}">
                <option value="pending">Pendiente</option>
                <option value="in_progress">En curso</option>
                <option value="submitted">Presentado</option>
                <option value="approved">Aprobado</option>
                <option value="rejected">Rechazado</option>
                <option value="waived">No aplica</option>
              </select>
            </label>
          `).join('')}
        </div>
      </details>
    `).join('');
  }

  function collectInitialProgress() {
    const documentKeys = Array.from(document.querySelectorAll('[data-create-checklist-file]'))
      .filter(input => input.files?.length)
      .map(input => input.dataset.createChecklistFile)
      .filter(Boolean);
    return {
      initialChecklistCompletedKeys: Array.from(document.querySelectorAll('[data-create-checklist-key]:checked'))
        .map(input => input.dataset.createChecklistKey)
        .filter(Boolean),
      initialChecklistDocumentKeys: documentKeys,
      initialPermits: {
        templateId: document.getElementById('createPermitTemplate')?.value || '',
        statuses: Object.fromEntries(Array.from(document.querySelectorAll('[data-create-permit-status]'))
          .map(select => [select.dataset.createPermitStatus, select.value || 'pending']))
      }
    };
  }

  createStepTabs.forEach(btn => btn.addEventListener('click', () => setCreateStep(btn.dataset.createStep)));
  prevCreateStepBtn?.addEventListener('click', () => {
    const idx = CREATE_STEP_ORDER.indexOf(activeCreateStep);
    setCreateStep(CREATE_STEP_ORDER[Math.max(0, idx - 1)]);
  });
  nextCreateStepBtn?.addEventListener('click', () => {
    const idx = CREATE_STEP_ORDER.indexOf(activeCreateStep);
    setCreateStep(CREATE_STEP_ORDER[Math.min(CREATE_STEP_ORDER.length - 1, idx + 1)]);
  });

  function createBoardMemberRow(item = {}) {
    return `<div class="create-repeat-row" data-create-board-row>
      <label>Nombre<input data-create-board="name" value="${escapeHtml(item.name || '')}"></label>
      <label>Cedula<input data-create-board="cedula" value="${escapeHtml(item.cedula || '')}"></label>
      <label>Puesto<input data-create-board="position" value="${escapeHtml(item.position || '')}"></label>
      <button class="btn ghost" type="button" data-remove-create-row>Quitar</button>
    </div>`;
  }

  function createShareholderRow(item = {}) {
    return `<div class="create-repeat-row" data-create-shareholder-row>
      <label>Nombre<input data-create-shareholder="name" value="${escapeHtml(item.name || '')}"></label>
      <label>Cedula<input data-create-shareholder="cedula" value="${escapeHtml(item.cedula || '')}"></label>
      <label>Porcentaje<input data-create-shareholder="percentage" type="number" step="any" value="${item.percentage ?? ''}"></label>
      <button class="btn ghost" type="button" data-remove-create-row>Quitar</button>
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

  function formatBankInput(input, decimals = 2) {
    if (!input || !String(input.value || '').trim()) return;
    const n = parseBankNumber(input.value);
    if (Number.isFinite(n)) input.value = formatBankNumber(n, decimals);
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

  function bindBankNumberFormatting(root = document) {
    root.querySelectorAll('[data-bank-number]').forEach(input => {
      if (input.__bankFormatBound) return;
      input.__bankFormatBound = true;
      input.addEventListener('blur', () => formatBankInput(input));
    });
  }

  function bankChoiceHtml(field, current = '') {
    const options = window.BankSelect?.bankOptionsHtml?.(current) || `<option value="${escapeHtml(current)}">${escapeHtml(current)}</option>`;
    const isOther = current && !(window.BANKS_PANAMA || []).some(bank => norm(bank) === norm(current));
    return `
      <select data-create-phase-condition="${field}" data-bank-choice>${options}</select>
      <input data-bank-choice-other="${field}" value="${isOther ? escapeHtml(current) : ''}" placeholder="Especificar banco" style="display:${isOther ? '' : 'none'};margin-top:6px;">
    `;
  }

  function readBankChoice(select) {
    if (!select) return '';
    if (select.value === '__OTHER__') {
      return select.parentElement?.querySelector(`[data-bank-choice-other="${select.dataset.createPhaseCondition}"]`)?.value?.trim() || '';
    }
    return select.value || '';
  }

  function bindBankChoices(root = document) {
    if (window.BankSelect) {
      const ld = document.getElementById('ld-interimBank');
      if (ld && !ld.children.length) ld.innerHTML = window.BankSelect.bankOptionsHtml('');
      window.BankSelect.bindBankSelect('ld-interimBank');
    }
    root.querySelectorAll('[data-bank-choice]').forEach(select => {
      if (select.dataset.bankChoiceBound) return;
      select.dataset.bankChoiceBound = '1';
      select.addEventListener('change', () => {
        const other = select.parentElement?.querySelector(`[data-bank-choice-other="${select.dataset.createPhaseCondition}"]`);
        if (!other) return;
        other.style.display = select.value === '__OTHER__' ? '' : 'none';
        if (select.value !== '__OTHER__') other.value = '';
      });
      select.dispatchEvent(new Event('change'));
    });
  }

  function createHousingModelRow(item = {}) {
    const statuses = item.initialStatuses || {};
    return `<div class="create-repeat-row create-model-row" data-create-model-row>
      <label>Modelo<input data-create-model="name" value="${escapeHtml(item.name || '')}"></label>
      <label>Recamaras<input data-create-model="bedrooms" type="number" min="0" step="1" value="${item.bedrooms ?? ''}"></label>
      <label>Banos<input data-create-model="bathrooms" type="number" min="0" step="any" value="${item.bathrooms ?? ''}"></label>
      <label>Cantidad unidades<input data-create-model="unitsCount" type="number" min="0" step="1" value="${item.unitsCount ?? ''}"></label>
      <label>Area abierta m2<input data-create-model="openAreaM2" data-bank-number type="text" inputmode="decimal" value="${item.openAreaM2 ? formatBankNumber(item.openAreaM2) : ''}"></label>
      <label>Area cerrada m2<input data-create-model="closedAreaM2" data-bank-number type="text" inputmode="decimal" value="${item.closedAreaM2 ? formatBankNumber(item.closedAreaM2) : ''}"></label>
      <label>Precio<input data-create-model="price" data-bank-number type="text" inputmode="decimal" value="${item.price ? formatBankNumber(item.price) : ''}"></label>
      <label>Coste por unidad<input data-create-model="cost" data-bank-number type="text" inputmode="decimal" value="${item.cost ? formatBankNumber(item.cost) : ''}"></label>
      <label>Observaciones<input data-create-model="observations" value="${escapeHtml(item.observations || '')}"></label>
      <div class="create-model-statuses" style="grid-column:1/-1;border:1px solid #dbeafe;background:#f8fbff;border-radius:14px;padding:12px;margin-top:4px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
          <strong style="color:#0f172a;">Estados iniciales de unidades</strong>
          <span class="small muted" data-create-model-status-summary>Define cantidad de unidades por estado</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;">
          ${[
            ['disponible','Disponible'],
            ['inventario','Inventario'],
            ['reservado','Reservado'],
            ['con_cpp','Con CPP o venta al contado'],
            ['tramite_legal_activado','Trámite legal activado'],
            ['escriturado_traspasado','Escriturado / Traspasado'],
            ['vivienda_entregada','Vivienda entregada']
          ].map(([key,label]) => `<label>${label}<input data-create-model-status="${key}" type="number" min="0" step="1" value="${statuses[key] ?? ''}"></label>`).join('')}
        </div>
        <div class="small muted" data-create-model-status-warning style="margin-top:8px;"></div>
        </div>
      </article>
      <details class="create-model-units-preview" data-create-units-preview style="grid-column:1/-1;border:1px solid #dbe2ea;border-radius:12px;padding:10px;background:#fff;margin-top:6px;">
        <summary><strong>Unidades generadas</strong> <span class="small muted" data-create-units-summary></span></summary>
        <div data-create-units-box style="overflow:auto;margin-top:10px;"></div>
      </details>
      <button class="btn ghost" type="button" data-remove-create-row>Quitar</button>
    </div>`;
  }

  function numberFromCreate(value) {
    const n = parseBankNumberLive(value);
    return Number.isFinite(n) ? n : 0;
  }

  function collectLegalData() {
    const trustApplies = document.getElementById('ld-trustApplies')?.value === 'true';
    const manual = createPromoterIsManual();
    const selectedPromoter = createPromoterProfiles.get(String(document.getElementById('ld-promoterProfileSelect')?.value || ''));
    return {
      promoterEntryMode: manual ? 'manual' : 'registered',
      promoterCompanyId: manual ? '' : (document.getElementById('ld-promoterCompanySelect')?.value?.trim() || ''),
      promoterName: manual
        ? (document.getElementById('ld-manualPromoterName')?.value?.trim() || '')
        : (selectedPromoter?.name || selectedPromoter?.email || ''),
      promoterLegalName: document.getElementById('ld-promoterLegalName')?.value?.trim() || '',
      promoterRuc: document.getElementById('ld-promoterRuc')?.value?.trim() || '',
      interimBank: window.BankSelect?.getBankValue?.('ld-interimBank') || document.getElementById('ld-interimBank')?.value?.trim() || '',
      trustApplies,
      trustName: trustApplies ? (document.getElementById('ld-trustName')?.value?.trim() || '') : '',
      boardMembers: Array.from(document.querySelectorAll('[data-create-board-row]')).map(row => ({
        name: row.querySelector('[data-create-board="name"]')?.value.trim() || '',
        cedula: row.querySelector('[data-create-board="cedula"]')?.value.trim() || '',
        position: row.querySelector('[data-create-board="position"]')?.value.trim() || ''
      })),
      assessment: Object.fromEntries(Array.from(document.querySelectorAll('[data-legal-assessment]')).map(input => [input.dataset.legalAssessment, input.value === '' ? null : input.value === 'true'])),
      shareholders: Array.from(document.querySelectorAll('[data-create-shareholder-row]')).map(row => ({
        name: row.querySelector('[data-create-shareholder="name"]')?.value.trim() || '',
        cedula: row.querySelector('[data-create-shareholder="cedula"]')?.value.trim() || '',
        percentage: numberFromCreate(row.querySelector('[data-create-shareholder="percentage"]')?.value)
      }))
    };
  }

  function collectTechnicalData() {
    return {
      phasesCount: numberFromCreate(document.getElementById('td-phasesCount')?.value),
      totalUnits: numberFromCreate(document.getElementById('td-totalUnits')?.value),
      notes: document.getElementById('td-notes')?.value?.trim() || '',
      insurancePolicies: collectCreateInsurancePolicies(),
      assessment: Object.fromEntries(Array.from(document.querySelectorAll('[data-technical-assessment]')).map(input => [input.dataset.technicalAssessment, input.value === '' ? null : input.value === 'true']))
    };
  }

  function hasCreateDatoUnicoFile() {
    return !!createDatoUnicoFileState;
  }

  function hasManualInventoryData() {
    return Array.from(document.querySelectorAll('[data-create-model-row]')).some(row =>
      Array.from(row.querySelectorAll('input, textarea, select')).some(input => String(input.value || '').trim() !== '')
    );
  }

  function excelModelField(model, field, label, options = {}) {
    const raw = model?.[field];
    const value = raw === null || raw === undefined ? '' : raw;
    const conflict = model?.conflicts?.includes(field);
    const formatted = options.money && value !== '' ? formatBankNumber(value) : value;
    const attrs = options.readonly
      ? 'readonly'
      : (options.money ? 'data-bank-number type="text" inputmode="decimal"' : 'type="number" min="0" step="any"');
    return `<label>${label}<input data-create-excel-model="${field}" ${attrs} value="${escapeHtml(formatted)}" ${conflict ? 'aria-describedby="excel-model-conflict"' : ''}></label>`;
  }

  function renderCreateDatoUnicoPreview(preview = null, { loading = false, error = '' } = {}) {
    if (!createDatoUnicoPreviewPanel) return;
    const visible = loading || !!error || !!preview;
    createDatoUnicoPreviewPanel.style.display = visible ? '' : 'none';
    if (createDatoUnicoPreviewSummary) createDatoUnicoPreviewSummary.innerHTML = '';
    if (createDatoUnicoModels) createDatoUnicoModels.innerHTML = '';
    if (loading) {
      if (createDatoUnicoPreviewMessage) createDatoUnicoPreviewMessage.textContent = 'Analizando unidades y modelos del Excel...';
      return;
    }
    if (error) {
      if (createDatoUnicoPreviewMessage) {
        createDatoUnicoPreviewMessage.className = 'create-dato-preview-error';
        createDatoUnicoPreviewMessage.textContent = error;
      }
      return;
    }
    if (!preview) return;

    if (createDatoUnicoPreviewSummary) {
      createDatoUnicoPreviewSummary.innerHTML = `
        <span>${escapeHtml(preview.sheet || 'Hoja detectada')}</span>
        <span>${Number(preview.unitsTotal || 0)} unidades</span>
        <span>${Number(preview.models?.length || 0)} modelos</span>
      `;
    }
    if (createDatoUnicoPreviewMessage) {
      createDatoUnicoPreviewMessage.className = preview.valid ? 'small muted' : 'create-dato-preview-error';
      if (!preview.valid) {
        const duplicateText = (preview.duplicates || []).slice(0, 5).map(item => `${item.manzana || '-'} / ${item.lote || '-'}`).join(', ');
        createDatoUnicoPreviewMessage.textContent = duplicateText
          ? `No se puede importar: hay unidades duplicadas (${duplicateText}).`
          : (preview.error || 'No se encontraron unidades válidas en el Excel.');
      } else if (preview.unnamedUnits) {
        createDatoUnicoPreviewMessage.textContent = `${preview.unnamedUnits} unidades no tienen modelo. Se importarán sin modelo asignado.`;
      } else {
        createDatoUnicoPreviewMessage.textContent = 'Revisa y completa las características sugeridas. Las cantidades y estados proceden del Excel.';
      }
    }

    if (createDatoUnicoModels) {
      createDatoUnicoModels.innerHTML = (preview.models || []).map(model => {
        const statusText = Object.entries(model.initialStatuses || {})
          .filter(([, count]) => Number(count) > 0)
          .map(([status, count]) => `${status.replaceAll('_', ' ')}: ${count}`)
          .join(' · ');
        const conflictLabels = {
          bedrooms: 'recámaras', bathrooms: 'baños', openAreaM2: 'área abierta', closedAreaM2: 'área cerrada', price: 'precio'
        };
        const conflicts = (model.conflicts || []).map(field => conflictLabels[field] || field);
        return `<div class="create-dato-model" data-create-excel-model-row>
          <label>Modelo<input data-create-excel-model="name" value="${escapeHtml(model.name || '')}" readonly></label>
          ${excelModelField(model, 'unitsCount', 'Cantidad de unidades', { readonly: true })}
          ${excelModelField(model, 'bedrooms', 'Recámaras')}
          ${excelModelField(model, 'bathrooms', 'Baños')}
          ${excelModelField(model, 'openAreaM2', 'Área abierta m²', { money: true })}
          ${excelModelField(model, 'closedAreaM2', 'Área cerrada m²', { money: true })}
          ${excelModelField(model, 'price', 'Precio base', { money: true })}
          <label>Observaciones<input data-create-excel-model="observations" value=""></label>
          <input data-create-excel-model="initialStatuses" type="hidden" value="${escapeHtml(JSON.stringify(model.initialStatuses || {}))}">
          <p class="create-dato-model-note">${escapeHtml(statusText || 'Sin estados detectados')}${conflicts.length ? `<br>El Excel contiene varios valores de ${escapeHtml(conflicts.join(', '))}; completa el valor base que corresponda.` : ''}</p>
        </div>`;
      }).join('') || '<p class="small muted">No se detectó ninguna columna MODELO con valores.</p>';
      bindBankNumberFormatting(createDatoUnicoModels);
    }
  }

  function collectCreateDatoUnicoModels() {
    return Array.from(document.querySelectorAll('[data-create-excel-model-row]')).map(row => {
      const get = field => row.querySelector(`[data-create-excel-model="${field}"]`)?.value ?? '';
      let initialStatuses = {};
      try { initialStatuses = JSON.parse(get('initialStatuses') || '{}'); } catch (_) {}
      return {
        name: String(get('name')).trim(),
        unitsCount: numberFromCreate(get('unitsCount')),
        bedrooms: numberFromCreate(get('bedrooms')),
        bathrooms: numberFromCreate(get('bathrooms')),
        openAreaM2: numberFromCreate(get('openAreaM2')),
        closedAreaM2: numberFromCreate(get('closedAreaM2')),
        price: numberFromCreate(get('price')),
        observations: String(get('observations')).trim(),
        initialStatuses
      };
    }).filter(model => model.name);
  }

  async function loadCreateDatoUnicoPreview(file) {
    const requestId = ++createDatoUnicoPreviewRequest;
    createDatoUnicoPreviewState = null;
    renderCreateDatoUnicoPreview(null, { loading: true });
    const form = new FormData();
    form.append('file', file);
    try {
      const preview = await API.upload('/api/projects/import-dato-unico/preview', form);
      if (requestId !== createDatoUnicoPreviewRequest) return;
      createDatoUnicoPreviewState = preview;
      const total = document.getElementById('td-totalUnits');
      if (total) total.value = String(preview.unitsTotal || 0);
      renderCreateDatoUnicoPreview(preview);
      refreshCreatePolicyUnitOptions();
      updateCreateUnitsReconciliation();
    } catch (error) {
      if (requestId !== createDatoUnicoPreviewRequest) return;
      createDatoUnicoPreviewState = { valid: false, error: error.message };
      renderCreateDatoUnicoPreview(null, { error: error.message || 'No se pudo analizar el Excel.' });
    }
  }

  function updateCreateDatoUnicoMode() {
    const file = createDatoUnicoFileState;
    const fileName = file?.name || 'Ningun archivo seleccionado';
    if (createDatoUnicoFileName) createDatoUnicoFileName.textContent = fileName;
    if (clearCreateDatoUnicoFileBtn) clearCreateDatoUnicoFileBtn.style.display = file ? '' : 'none';
    if (createDatoUnicoWarning) createDatoUnicoWarning.style.display = file ? '' : 'none';
    if (createImportModeNotice) {
      createImportModeNotice.classList.toggle('is-excel', !!file);
      createImportModeNotice.classList.toggle('is-manual', !file);
      createImportModeNotice.textContent = file
        ? `Modo actual: importacion Excel (${fileName}). Las unidades se crearán desde el archivo.`
        : 'Modo actual: manual. Se crearán unidades desde los modelos indicados abajo.';
    }
    if (createManualModelsPanel) createManualModelsPanel.classList.toggle('is-disabled', !!file);
    createManualModelsPanel?.querySelectorAll('input, select, textarea, button').forEach(el => {
      el.disabled = !!file;
    });
    const totalUnits = document.getElementById('td-totalUnits');
    if (totalUnits) totalUnits.disabled = !!file;
  }

  function clearCreateDatoUnicoFile() {
    createDatoUnicoPreviewRequest += 1;
    createDatoUnicoFileState = null;
    createDatoUnicoPreviewState = null;
    if (createDatoUnicoFileInput) createDatoUnicoFileInput.value = '';
    const total = document.getElementById('td-totalUnits');
    if (total) total.value = createManualTotalUnitsSnapshot;
    renderCreateDatoUnicoPreview();
    updateCreateDatoUnicoMode();
    syncTechnicalUnitsFromModels();
    refreshCreatePolicyUnitOptions();
  }

  function collectHousingModels() {
    if (hasCreateDatoUnicoFile()) return [];
    return Array.from(document.querySelectorAll('[data-create-model-row]')).map(row => ({
      name: row.querySelector('[data-create-model="name"]')?.value.trim() || '',
      bedrooms: numberFromCreate(row.querySelector('[data-create-model="bedrooms"]')?.value),
      bathrooms: numberFromCreate(row.querySelector('[data-create-model="bathrooms"]')?.value),
      unitsCount: numberFromCreate(row.querySelector('[data-create-model="unitsCount"]')?.value),
      openAreaM2: numberFromCreate(row.querySelector('[data-create-model="openAreaM2"]')?.value),
      closedAreaM2: numberFromCreate(row.querySelector('[data-create-model="closedAreaM2"]')?.value),
      price: numberFromCreate(row.querySelector('[data-create-model="price"]')?.value),
      cost: numberFromCreate(row.querySelector('[data-create-model="cost"]')?.value),
      initialStatuses: Object.fromEntries(Array.from(row.querySelectorAll('[data-create-model-status]')).map(input => [
        input.dataset.createModelStatus,
        numberFromCreate(input.value)
      ])),
      observations: row.querySelector('[data-create-model="observations"]')?.value.trim() || ''
    })).filter(item => item.name || item.unitsCount || item.price || item.openAreaM2 || item.closedAreaM2);
  }

  const CREATE_UNIT_FIELDS = [
    ['code', 'Unidad', 'text'],
    ['estado', 'Estado', 'status'],
    ['ubicacion', 'Ubicacion', 'text'],
    ['numeroFinca', 'No. finca', 'text'],
    ['codigoUbicacion', 'Cod. ubicacion', 'text'],
    ['calle', 'Calle', 'text'],
    ['loteEsquina', 'Lote esquina', 'corner'],
    ['metrosExtra', 'm2 extra', 'number'],
    ['precioLoteEsquina', 'Precio esquina', 'money'],
    ['precioM2Extra', 'Precio m2 extra', 'money'],
    ['valorMejoras', 'Valor mejoras', 'money'],
    ['valorTerreno', 'Valor terreno', 'money']
  ];

  const UNIT_STATUS_OPTIONS = [
    ['disponible','Disponible'],
    ['inventario','Inventario'],
    ['reservado','Reservado'],
    ['con_cpp','Con CPP o venta al contado'],
    ['tramite_legal_activado','Tramite legal activado'],
    ['escriturado_traspasado','Escriturado / Traspasado'],
    ['vivienda_entregada','Vivienda entregada']
  ];

  function modelDefaultsFromRow(row) {
    const name = row.querySelector('[data-create-model="name"]')?.value.trim() || 'Modelo';
    const open = numberFromCreate(row.querySelector('[data-create-model="openAreaM2"]')?.value);
    const closed = numberFromCreate(row.querySelector('[data-create-model="closedAreaM2"]')?.value);
    return {
      modelo: name,
      ubicacion: document.getElementById('pLocation')?.value?.trim() || '',
      m2: open + closed,
      precioVenta: numberFromCreate(row.querySelector('[data-create-model="price"]')?.value),
      costoUnidad: numberFromCreate(row.querySelector('[data-create-model="cost"]')?.value),
      costoUnidadManual: false,
      areaAbierta: open,
      areaCerrada: closed,
      areaTotalConstruccion: open + closed,
      recamaras: numberFromCreate(row.querySelector('[data-create-model="bedrooms"]')?.value),
      banos: numberFromCreate(row.querySelector('[data-create-model="bathrooms"]')?.value)
    };
  }

  function readCreateUnitRow(row) {
    const out = {};
    row.querySelectorAll('[data-create-unit]').forEach(input => {
      const field = input.dataset.createUnit;
      const raw = String(input.value ?? '').trim();
      if (!raw && !['code', 'estado', 'ubicacion'].includes(field)) return;
      out[field] = ['m2','precioVenta','metrosExtra','precioLoteEsquina','precioM2Extra','areaAbierta','areaCerrada','areaTotalConstruccion','recamaras','banos','valorMejoras','valorTerreno'].includes(field)
        ? numberFromCreate(raw)
        : raw;
    });
    out.__manualEstado = row.dataset.statusManual === '1';
    out.__manualUbicacion = row.dataset.locationManual === '1';
    return out;
  }

  function unitInputHtml(field, type, value) {
    if (type === 'status') {
      return `<select data-create-unit="${field}">${UNIT_STATUS_OPTIONS.map(([v,l]) => `<option value="${v}" ${value === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    }
    if (type === 'corner') {
      return `<select data-create-unit="${field}"><option value=""></option><option value="SI" ${value === 'SI' ? 'selected' : ''}>Si</option><option value="NO" ${value === 'NO' ? 'selected' : ''}>No</option></select>`;
    }
    const attrs = type === 'money' ? 'data-bank-number type="text" inputmode="decimal"' : (type === 'number' ? 'type="number" step="any" min="0"' : 'type="text"');
    const display = type === 'money' && value ? formatBankNumber(value) : value;
    return `<input data-create-unit="${field}" ${attrs} value="${escapeHtml(display ?? '')}">`;
  }

  function syncCreateUnitsPreview(row, { force = false } = {}) {
    const box = row.querySelector('[data-create-units-box]');
    if (!box) return;
    const count = Math.max(0, Math.round(numberFromCreate(row.querySelector('[data-create-model="unitsCount"]')?.value)));
    const defaults = modelDefaultsFromRow(row);
    const existing = Array.from(box.querySelectorAll('[data-create-unit-row]')).map(readCreateUnitRow);
    const statusInputs = Array.from(row.querySelectorAll('[data-create-model-status]'));
    const statusQueue = [];
    statusInputs.forEach(input => {
      const n = Math.max(0, Math.round(numberFromCreate(input.value)));
      for (let i = 0; i < n; i++) statusQueue.push(input.dataset.createModelStatus);
    });
    while (statusQueue.length < count) statusQueue.push('disponible');

    const rows = Array.from({ length: count }, (_, idx) => {
      const prev = existing[idx] || {};
      const code = prev.code || `${defaults.modelo}-${idx + 1}`;
      const item = {
        ...prev,
        code,
        estado: prev.__manualEstado ? (prev.estado || 'disponible') : (statusQueue[idx] || 'disponible'),
        ubicacion: prev.__manualUbicacion ? (prev.ubicacion || '') : defaults.ubicacion
      };
      return `<tr data-create-unit-row ${prev.__manualEstado ? 'data-status-manual="1"' : ''} ${prev.__manualUbicacion ? 'data-location-manual="1"' : ''}>${CREATE_UNIT_FIELDS.map(([field, _label, type]) => `<td>${unitInputHtml(field, type, item[field] ?? '')}</td>`).join('')}</tr>`;
    }).join('');

    box.innerHTML = count ? `
      <table class="table create-units-preview-table" style="min-width:1250px;">
        <thead><tr>${CREATE_UNIT_FIELDS.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    ` : '<div class="small muted">Indica cantidad de unidades para generar la vista previa.</div>';
    const summary = row.querySelector('[data-create-units-summary]');
    if (summary) summary.textContent = count ? `${count} unidades editables` : 'sin unidades';
    bindBankNumberFormatting(box);
  }

  function collectInitialUnits() {
    if (hasCreateDatoUnicoFile()) return [];
    return Array.from(document.querySelectorAll('[data-create-model-row]')).flatMap(row =>
      Array.from(row.querySelectorAll('[data-create-unit-row]')).map(unitRow => {
        const item = { ...modelDefaultsFromRow(row), ...readCreateUnitRow(unitRow) };
        delete item.__manualEstado;
        delete item.__manualUbicacion;
        return item;
      })
    ).filter(item => item.code || item.modelo);
  }

  function syncCreateModelStatusRow(row, { autoFill = false } = {}) {
    if (!row) return true;
    const total = numberFromCreate(row.querySelector('[data-create-model="unitsCount"]')?.value);
    const inputs = Array.from(row.querySelectorAll('[data-create-model-status]'));
    let values = inputs.map(input => Math.max(0, Math.round(numberFromCreate(input.value))));
    let statusTotal = values.reduce((sum, value) => sum + value, 0);

    if (autoFill && total > 0 && statusTotal < total) {
      const emptyInputs = inputs.filter(input => String(input.value || '').trim() === '');
      if (emptyInputs.length === inputs.length) {
        emptyInputs[0].value = total;
      } else if (emptyInputs.length === 1) {
        emptyInputs[0].value = total - statusTotal;
      }
      values = inputs.map(input => Math.max(0, Math.round(numberFromCreate(input.value))));
      statusTotal = values.reduce((sum, value) => sum + value, 0);
    }

    const remaining = total - statusTotal;
    const summary = row.querySelector('[data-create-model-status-summary]');
    const warning = row.querySelector('[data-create-model-status-warning]');
    if (summary) {
      summary.textContent = total
        ? `Total ${total} · Asignadas ${statusTotal} · Restantes ${Math.max(remaining, 0)}`
        : 'Define primero la cantidad total de unidades';
      summary.style.color = remaining < 0 ? '#b91c1c' : (remaining === 0 && total ? '#166534' : '#475569');
    }
    if (warning) {
      if (!total) {
        warning.textContent = 'Cuando indiques el total, este bloque calcula automaticamente las unidades restantes.';
        warning.style.color = '';
      } else if (remaining > 0) {
        warning.textContent = `Faltan ${remaining} unidades por asignar a algun estado. Si dejas una sola casilla vacia, se completa automaticamente.`;
        warning.style.color = '#92400e';
      } else if (remaining < 0) {
        warning.textContent = `Te pasaste por ${Math.abs(remaining)} unidades. Ajusta el reparto antes de guardar.`;
        warning.style.color = '#b91c1c';
      } else {
        warning.textContent = 'Reparto completo: la suma de estados coincide con el total.';
        warning.style.color = '#166534';
      }
    }
    return !total || statusTotal === total || statusTotal === 0;
  }

  function validateCreateModelStatuses({ alertOnError = false } = {}) {
    if (hasCreateDatoUnicoFile()) return true;
    for (const row of Array.from(document.querySelectorAll('[data-create-model-row]'))) {
      syncCreateModelStatusRow(row);
      const total = numberFromCreate(row.querySelector('[data-create-model="unitsCount"]')?.value);
      const statusTotal = Array.from(row.querySelectorAll('[data-create-model-status]'))
        .reduce((sum, input) => sum + numberFromCreate(input.value), 0);
      const warning = row.querySelector('[data-create-model-status-warning]');
      const hasSplit = statusTotal > 0;
      const ok = !total || !hasSplit || total === statusTotal;
      if (!ok) {
        if (alertOnError) alert('La suma de estados por modelo debe coincidir con la cantidad total de unidades.');
        return false;
      }
    }
    return true;
  }

  function syncTechnicalUnitsFromModels() {
    if (hasCreateDatoUnicoFile()) {
      updateCreateUnitsReconciliation();
      return;
    }
    const totalEl = document.getElementById('td-totalUnits');
    if (!totalEl) return;
    const total = Array.from(document.querySelectorAll('[data-create-model-row]'))
      .reduce((sum, row) => sum + numberFromCreate(row.querySelector('[data-create-model="unitsCount"]')?.value), 0);
    const currentValue = String(totalEl.value || '').trim();
    const canSuggest = !createTotalUnitsManuallyEdited || !currentValue || numberFromCreate(currentValue) === createLastSuggestedUnitsTotal;
    createLastSuggestedUnitsTotal = total;
    if (canSuggest) {
      totalEl.value = total ? Math.round(total) : '';
      createTotalUnitsManuallyEdited = false;
    }
    updateCreateUnitsReconciliation();
  }

  function createModelsUnitsTotal() {
    return Array.from(document.querySelectorAll('[data-create-model-row]'))
      .reduce((sum, row) => sum + numberFromCreate(row.querySelector('[data-create-model="unitsCount"]')?.value), 0);
  }

  function updateCreateUnitsReconciliation() {
    const box = document.getElementById('createUnitsReconciliation');
    if (!box) return true;
    const total = numberFromCreate(document.getElementById('td-totalUnits')?.value);
    const modelsTotal = createModelsUnitsTotal();
    const difference = total - modelsTotal;
    const matches = Math.abs(difference) < 0.001;
    box.querySelector('[data-units-total]').textContent = String(total);
    box.querySelector('[data-units-models]').textContent = String(modelsTotal);
    box.querySelector('[data-units-difference]').textContent = String(difference);
    box.querySelector('[data-units-message]').textContent = hasCreateDatoUnicoFile()
      ? 'La comprobación no bloquea la creación porque las unidades se importarán mediante Excel.'
      : matches ? 'Los totales coinciden.' : 'La suma de unidades de los modelos debe coincidir con el total indicado.';
    box.classList.toggle('has-difference', !matches && !hasCreateDatoUnicoFile());
    box.classList.toggle('is-match', matches || hasCreateDatoUnicoFile());
    return matches;
  }

  function updateCreateFundingSummary() {
    const box = document.getElementById('createFundingSummary');
    if (!box) return;
    const total = numberFromCreate(document.getElementById('fc-projectTotal')?.value);
    const requested = numberFromCreate(document.getElementById('fundingRequestedAmount')?.value);
    const secured = numberFromCreate(document.getElementById('fundingSecuredAmount')?.value);
    const pending = Math.max(0, requested - secured);
    const covered = requested ? secured / requested * 100 : 0;
    const values = { total, requested, secured, pending };
    Object.entries(values).forEach(([key, value]) => {
      const target = box.querySelector(`[data-funding-summary="${key}"]`);
      if (target) target.textContent = formatBankNumber(value);
    });
    const coveredEl = box.querySelector('[data-funding-summary="covered"]');
    if (coveredEl) coveredEl.textContent = `${covered.toFixed(2)}%`;
  }

  function syncFinancialTriplet(sourceId = '') {
    const totalEl = document.getElementById('fc-projectTotal');
    const amountEl = document.getElementById('fc-bankFinancedAmount');
    const pctEl = document.getElementById('fc-bankFinancedPct');
    const promoterEl = document.getElementById('fc-promoterContribution');
    const promoterPctEl = document.getElementById('fc-promoterContributionPct');
    const total = numberFromCreate(totalEl?.value);
    let amount = numberFromCreate(amountEl?.value);
    let pct = numberFromCreate(pctEl?.value);
    let promoter = numberFromCreate(promoterEl?.value);
    let promoterPct = numberFromCreate(promoterPctEl?.value);
    if (!total) return;
    pct = Math.min(Math.max(pct, 0), 100);
    promoterPct = Math.min(Math.max(promoterPct, 0), 100);

    if (sourceId === 'fc-bankFinancedPct') amount = total * pct / 100;
    else if (sourceId === 'fc-promoterContributionPct') {
      promoter = total * promoterPct / 100;
      amount = total - promoter;
    } else if (sourceId === 'fc-promoterContribution') {
      promoter = Math.min(Math.max(promoter, 0), total);
      amount = total - promoter;
    } else if (sourceId === 'fc-bankFinancedAmount') {
      amount = Math.min(Math.max(amount, 0), total);
      promoter = total - amount;
    } else if (sourceId === 'fc-projectTotal') {
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
    syncCreatePhaseSources();
    updateCreateFundingSummary();
  }

  ['fc-projectTotal'].forEach(fieldId => {
    document.getElementById(fieldId)?.setAttribute('data-bank-number', '');
  });
  bindBankNumberFormatting();

  ['fc-projectTotal'].forEach(fieldId => {
    document.getElementById(fieldId)?.addEventListener('input', () => syncFinancialTriplet(fieldId));
  });
  ['fundingRequestedAmount', 'fundingSecuredAmount'].forEach(fieldId => {
    document.getElementById(fieldId)?.addEventListener('input', updateCreateFundingSummary);
  });

  const PHASE_CONDITION_FIELDS = [
    ['generalConditions', 'Condiciones generales de la fase', 'textarea', 'Facilidad aprobada sujeta a cumplimiento de hitos tecnicos y legales'],
    ['guarantees', 'Garantias', 'textarea', 'Hipoteca, fideicomiso de garantia, cesion de ventas, fianza solidaria'],
    ['insurance', 'Seguros', 'textarea', 'CAR, incendio, cumplimiento, fianza de pago'],
    ['requiredPresales', 'Preventa requerida', 'textarea', '40% de preventa evidenciada mediante CPP cedida al banco'],
    ['precedentConditions', 'Condiciones precedentes', 'textarea', 'Permisos aprobados, planos aprobados, seguros entregados, garantias constituidas'],
    ['otherRequirements', 'Detalle de otros requisitos', 'textarea', 'Permisos especiales, aprobaciones municipales o condiciones adicionales del banco'],
    ['disbursementConditions', 'Condiciones de desembolso', 'textarea', 'Contra avance certificado por inspector autorizado'],
    ['amortizationConditions', 'Condiciones de amortizacion/pago', 'textarea', 'Intereses y FECI mensuales, capital al vencimiento'],
    ['promoterObligations', 'Obligaciones del promotor', 'textarea', 'Aportes de capital previos a cada desembolso y entrega mensual de reportes'],
    ['covenants', 'Restricciones/covenants', 'textarea', 'No endeudamiento con otros bancos, no cambios accionarios sin autorizacion'],
    ['trustee', 'Fiduciaria', 'input', 'BG Trust, S.A.'],
    ['trustType', 'Tipo de fideicomiso', 'input', 'Fideicomiso de garantia y administracion'],
    ['technicalInspector', 'Inspector tecnico', 'input', 'Inspector autorizado por el banco'],
    ['financialInspector', 'Inspector financiero', 'input', 'Auditor financiero del banco'],
    ['generalObservations', 'Observaciones generales', 'textarea', 'Condiciones sujetas a contrato definitivo y aprobaciones internas']
  ];

  const DEFAULT_PHASE_PLAN_USES = ['Terreno', 'Infraestructura', 'Construcción', 'Costes directos', 'Costes indirectos', 'Honorarios', 'Licencias', 'Comercialización', 'Imprevistos'];

  function phaseSelectedBanks(item = {}) {
    const saved = Array.isArray(item.financierBanks) ? item.financierBanks.filter(Boolean) : [];
    if (saved.length) return [...new Set(saved.map(value => String(value).trim()).filter(Boolean))];
    const historical = String(item.financialConditions?.interimBank || '').trim();
    return historical ? [historical] : [];
  }

  function phaseBankOptionsHtml(selected = []) {
    const chosen = new Set(selected.map(value => String(value)));
    const banks = [...new Set([...(window.BANKS_PANAMA || []), ...selected].filter(Boolean))];
    return `<option value="">Por definir</option>${banks.map(bank => `<option value="${escapeHtml(bank)}"${chosen.has(bank) ? ' selected' : ''}>${escapeHtml(bank)}</option>`).join('')}`;
  }

  function hideGlobalCreateFinancialConditionFields() {
    [
      'fc-bankFinancedAmount', 'fc-bankFinancedPct',
      'fc-promoterContribution', 'fc-promoterContributionPct',
      'fc-interestRate', 'fc-term', 'fc-paymentMethod', 'fc-commission',
      'fc-disbursementMethod', 'fc-disbursementConditions', 'fc-amortizationConditions',
      'fc-requiredPresales', 'fc-guarantees', 'fc-insurance'
    ].forEach(id => {
      const el = document.getElementById(id);
      const label = el?.closest('label');
      if (label) label.style.display = 'none';
    });
    const precedentSection = document.querySelector('[data-create-precedent]')?.closest('.create-finance-section');
    if (precedentSection) precedentSection.style.display = 'none';
    const operationSection = document.getElementById('fc-trustee')?.closest('.create-finance-section');
    if (operationSection) operationSection.style.display = 'none';
  }

  const CREATE_PHASE_SOURCE_NAMES = ['Banco', 'Promotor', 'Preventas'];

  function aggregateCreatePhaseSources(uses = []) {
    const grouped = new Map();
    (uses || []).forEach(use => (use.fundingSources || []).forEach(source => {
      const name = String(source?.name || '').trim();
      if (!name) return;
      const key = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const current = grouped.get(key) || { name, amount: 0 };
      current.amount += numberFromCreate(source?.amount);
      grouped.set(key, current);
    }));
    return Array.from(grouped.values()).map(source => ({
      ...source,
      amount: Math.round(source.amount * 100) / 100
    }));
  }

  function createPhaseUsesWithSources(items = [], fallbackSources = [], { defaults = false } = {}) {
    const uses = (Array.isArray(items) && items.length
      ? items
      : (defaults ? DEFAULT_PHASE_PLAN_USES.map(name => ({ name, amount: 0 })) : [])
    ).map(item => ({ ...item }));
    if (!uses.length) return [];
    if (uses.some(use => Array.isArray(use?.fundingSources))) {
      return uses.map(use => ({
        ...use,
        fundingSources: Array.isArray(use.fundingSources) && use.fundingSources.length
          ? use.fundingSources.map(source => ({ ...source }))
          : CREATE_PHASE_SOURCE_NAMES.map(name => ({ name, amount: 0 }))
      }));
    }
    const total = uses.reduce((sum, use) => sum + numberFromCreate(use.amount), 0);
    const sourceTemplates = (Array.isArray(fallbackSources) ? fallbackSources : [])
      .map(source => ({ name: String(source?.name || '').trim(), amount: numberFromCreate(source?.amount) }))
      .filter(source => source.name || source.amount);
    CREATE_PHASE_SOURCE_NAMES.forEach(name => {
      if (!sourceTemplates.some(source => source.name.toLowerCase() === name.toLowerCase())) sourceTemplates.push({ name, amount: 0 });
    });
    return uses.map((use, useIndex) => ({
      ...use,
      fundingSources: sourceTemplates.map(source => {
        const allocatedBefore = uses.slice(0, useIndex).reduce((sum, previous) => (
          sum + (total ? Math.round(numberFromCreate(source.amount) * numberFromCreate(previous.amount) / total * 100) / 100 : 0)
        ), 0);
        const amount = useIndex === uses.length - 1
          ? Math.max(0, numberFromCreate(source.amount) - allocatedBefore)
          : (total ? Math.round(numberFromCreate(source.amount) * numberFromCreate(use.amount) / total * 100) / 100 : 0);
        return { name: source.name, amount };
      })
    }));
  }

  function createPhaseSourceRow(source = {}, useAmount = 0) {
    const amount = numberFromCreate(source.amount);
    const pct = useAmount ? amount / useAmount * 100 : 0;
    return `<div class="finance-use-source-row" data-create-use-source>
      <input class="input" data-create-source-name value="${escapeHtml(source.name || '')}" placeholder="Otra fuente">
      <div class="finance-use-source-pct"><input class="input" data-create-source-pct type="number" min="0" step="0.01" value="${pct.toFixed(2)}"><em>%</em></div>
      <input class="input" data-create-source-amount data-bank-number type="text" inputmode="decimal" value="${amount ? formatBankNumber(amount) : ''}">
      <button class="btn btn-danger btn-xs" type="button" data-remove-create-source>Quitar</button>
    </div>`;
  }

  function createPhaseUseCards(kind, uses = []) {
    return (uses || []).map(use => {
      const amount = numberFromCreate(use.amount);
      const sources = Array.isArray(use.fundingSources) && use.fundingSources.length
        ? use.fundingSources
        : CREATE_PHASE_SOURCE_NAMES.map(name => ({ name, amount: 0 }));
      return `<article class="finance-plan-use-card" data-create-use-kind="${kind}">
        <div class="finance-plan-use-head">
          <label><span>Uso</span><input class="input" data-create-use-name value="${escapeHtml(use.name || '')}" placeholder="Infraestructura"></label>
          <label><span>Importe del uso</span><input class="input" data-create-use-amount data-bank-number type="text" inputmode="decimal" value="${amount ? formatBankNumber(amount) : ''}"></label>
          <button class="btn btn-danger btn-xs" type="button" data-remove-create-use>Quitar</button>
        </div>
        <div class="finance-use-sources-head"><span>Fuentes</span><span>Porcentaje</span><span>Importe</span><span></span></div>
        <div data-create-use-sources>${sources.map(source => createPhaseSourceRow(source, amount)).join('')}</div>
        <button class="btn ghost btn-xs" type="button" data-add-create-source>+ Fuente</button>
        <div class="finance-source-balance" data-create-use-balance></div>
      </article>`;
    }).join('');
  }

  function collectCreatePhaseUses(row, kind) {
    return Array.from(row?.querySelectorAll(`[data-create-use-kind="${kind}"]`) || []).map(useRow => ({
      name: useRow.querySelector('[data-create-use-name]')?.value.trim() || '',
      amount: numberFromCreate(useRow.querySelector('[data-create-use-amount]')?.value),
      fundingSources: Array.from(useRow.querySelectorAll('[data-create-use-source]')).map(sourceRow => ({
        name: sourceRow.querySelector('[data-create-source-name]')?.value.trim() || '',
        amount: numberFromCreate(sourceRow.querySelector('[data-create-source-amount]')?.value)
      })).filter(source => source.name || source.amount)
    })).filter(use => use.name || use.amount);
  }

  function createPhaseFinanceBlock(index, item = {}) {
    const condition = item.financialConditions || {};
    const selectedBanks = phaseSelectedBanks(item);
    const legacySources = Array.isArray(item.planSources) && item.planSources.length ? item.planSources : [
      { name: 'Banco', amount: numberFromCreate(condition.bankFinancedAmount) },
      { name: 'Promotor', amount: numberFromCreate(condition.promoterContribution) },
      { name: 'Preventas', amount: 0 }
    ];
    const planUses = createPhaseUsesWithSources(item.planUses || [], legacySources, { defaults: true });
    const realUses = createPhaseUsesWithSources(item.uses || [], item.sources || []);
    const planSources = aggregateCreatePhaseSources(planUses);
    const planTotal = planUses.reduce((sum, use) => sum + numberFromCreate(use.amount), 0);
    const bankAmount = numberFromCreate(planSources.find(source => source.name.toLowerCase() === 'banco')?.amount);
    const promoterAmount = numberFromCreate(planSources.find(source => source.name.toLowerCase() === 'promotor')?.amount);
    const presalesAmount = numberFromCreate(planSources.find(source => source.name.toLowerCase() === 'preventas')?.amount);
    const realTotal = realUses.reduce((sum, use) => sum + numberFromCreate(use.amount), 0);
    return `<details class="create-phase-block finance-phase-overview" data-create-phase-row="${index}" open>
      <summary><strong>${escapeHtml(item.name || `Fase ${index + 1}`)}</strong></summary>
      <div class="create-phase-overview-body">
        <div class="create-phase-requirements-head">
          <div><strong>Requisitos</strong><div class="small muted">${BANK_REQUIREMENT_TITLES.length} requisitos aplicables a esta fase. Bank73 precarga la información disponible.</div></div>
          <button class="btn" type="button" data-open-create-requirements="${index}">Requisitos</button>
        </div>
        <div class="finance-phase-core-fields">
          <label><span>Nombre</span><input class="input" data-create-phase="name" value="${escapeHtml(item.name || `Fase ${index + 1}`)}"></label>
        </div>
        <label class="create-phase-bank-field"><span>Bancos financiadores de la fase</span>
          <select data-create-phase-banks multiple size="5">${phaseBankOptionsHtml(selectedBanks)}</select>
          <span class="small muted">Deja la selección vacía o elige “Por definir” si todavía no hay banco. Esta selección no concede acceso ni crea tenants.</span>
        </label>
        <div class="finance-phase-plan-summary" aria-label="Resumen previsto">
          <article><span>Total previsto</span><strong data-create-summary="plan-total">${formatBankNumber(planTotal)}</strong><small>Suma de usos</small></article>
          <article><span>Banco</span><strong data-create-summary="plan-bank">${formatBankNumber(bankAmount)}</strong><small data-create-summary="plan-bank-pct">${planTotal ? (bankAmount / planTotal * 100).toFixed(1) : '0.0'}%</small></article>
          <article><span>Promotor</span><strong data-create-summary="plan-promoter">${formatBankNumber(promoterAmount)}</strong><small data-create-summary="plan-promoter-pct">${planTotal ? (promoterAmount / planTotal * 100).toFixed(1) : '0.0'}%</small></article>
          <article><span>Preventas</span><strong data-create-summary="plan-presales">${formatBankNumber(presalesAmount)}</strong><small>Fuente prevista</small></article>
        </div>
        <div class="finance-phase-view-tabs" role="tablist" aria-label="Vista de la fase">
          <button class="is-active" type="button" data-create-phase-view="plan" aria-pressed="true">Estimación</button>
          <button type="button" data-create-phase-view="real" aria-pressed="false">Realidad</button>
        </div>
        <section class="finance-phase-budget-panel" data-create-phase-panel="plan">
          <div class="finance-phase-real-dates finance-phase-planned-dates">
            <label><span>Inicio previsto</span><input class="input" data-create-phase="startDate" type="date" value="${escapeHtml(String(item.startDate || '').slice(0, 10))}"></label>
            <label><span>Fin previsto</span><input class="input" data-create-phase="endDate" type="date" value="${escapeHtml(String(item.endDate || '').slice(0, 10))}"></label>
          </div>
          <div class="finance-phase-section-head"><div><h4>Usos y fuentes previstas</h4><p>Cada uso puede tener un reparto diferente. Los totales y porcentajes se calculan automáticamente.</p></div><button class="btn ghost btn-xs" type="button" data-copy-create-real-to-plan>Usar realidad como estimación</button></div>
          <div data-create-uses-list="planUses">${createPhaseUseCards('planUses', planUses)}</div>
          <button class="btn ghost btn-xs" type="button" data-add-create-use="planUses">+ Uso</button>
        </section>
        <section class="finance-phase-budget-panel" data-create-phase-panel="real" hidden>
          <div class="finance-phase-section-head"><div><h4>Ejecución real</h4><p>Registra aquí únicamente la ejecución conocida. Dato Único seguirá siendo la fuente del inventario y de los datos comerciales.</p></div><button class="btn ghost btn-xs" type="button" data-copy-create-plan-to-real>Copiar estimación</button></div>
          <div class="finance-real-comparison"><span>Previsto <b data-create-real-comparison="plan">${formatBankNumber(planTotal)}</b></span><span>Real <b data-create-real-comparison="real">${formatBankNumber(realTotal)}</b></span><span>Diferencia <b data-create-real-comparison="difference">${formatBankNumber(realTotal - planTotal)}</b></span></div>
          <div class="finance-phase-real-dates"><label><span>Inicio real</span><input class="input" type="date" data-create-phase="actualStartDate" value="${escapeHtml(String(item.actualStartDate || '').slice(0, 10))}"></label><label><span>Fin real (opcional)</span><input class="input" type="date" data-create-phase="actualEndDate" data-completion-optional value="${escapeHtml(String(item.actualEndDate || '').slice(0, 10))}"></label></div>
          <div class="create-phase-progress-status" data-create-phase-progress-status></div>
          <div class="finance-phase-section-head create-real-uses-head"><div><h4>Usos y fuentes reales</h4><p>Introduce solamente la ejecución conocida hasta la fecha.</p></div></div>
          <div data-create-uses-list="uses">${createPhaseUseCards('uses', realUses)}</div>
          <button class="btn ghost btn-xs" type="button" data-add-create-use="uses">+ Uso real</button>
          ${createPhaseFinancingLinesBlock(index, item)}
        </section>
        <div hidden><input data-create-phase-financial="phaseTotal" value="${planTotal}"><input data-create-phase-financial="bankFinancedAmount" value="${bankAmount}"><input data-create-phase-financial="bankFinancedPct" value="${planTotal ? bankAmount / planTotal * 100 : 0}"><input data-create-phase-financial="promoterContribution" value="${promoterAmount}"><input data-create-phase-financial="promoterContributionPct" value="${planTotal ? promoterAmount / planTotal * 100 : 0}"></div>
      </div>
    </details>`;
  }

  function createPhaseFinancingLinesBlock(index, item = {}) {
    const financingRows = (Array.isArray(item.financingLines) ? item.financingLines : []).map(line => createPhaseFinancingLineCard(line)).join('');
    return `<section class="create-real-financing-lines" data-create-phase-financing-row="${index}">
      <div class="finance-phase-section-head">
        <div><h4>Líneas de financiación</h4><p>Se gestionan en la realidad de la fase. Los desembolsos, amortizaciones e intereses se completarán después en Finanzas.</p></div>
        <button class="btn ghost btn-xs" type="button" data-generate-create-financing-lines>Generar desde usos previstos</button>
      </div>
      <div class="create-line-summary-grid">
        <article><span>Financiación bancaria aprobada</span><strong data-line-bank-amount>0</strong></article>
        <article><span>Distribuido en líneas</span><strong data-line-total>0</strong></article>
        <article><span>Pendiente</span><strong data-line-pending>0</strong></article>
        <article><span>Distribuido</span><strong data-line-percent>0%</strong></article>
      </div>
      <div class="small" data-phase-financing-lines-summary></div>
      <div data-create-phase-financing-lines>${financingRows}</div>
      <button class="btn ghost btn-xs" type="button" data-add-phase-financing-line>+ Línea manual</button>
    </section>`;
  }

  function createPhaseFinancingLineCard(line = {}) {
    return `<article class="create-financing-line-card" data-create-phase-financing-line>
      <label><span>Nombre de la línea</span><input class="input" data-create-phase-financing="name" placeholder="Construcción" value="${escapeHtml(line.name || '')}"></label>
      <label><span>Importe aprobado</span><input class="input" data-create-phase-financing="approvedAmount" data-bank-number type="text" inputmode="decimal" placeholder="0.00" value="${line.approvedAmount ? formatBankNumber(line.approvedAmount) : ''}"></label>
      <label><span>Notas</span><input class="input" data-create-phase-financing="observations" placeholder="Opcional" value="${escapeHtml(line.observations || '')}"></label>
      <button class="btn btn-danger btn-xs" type="button" data-remove-phase-financing-line>Quitar</button>
    </article>`;
  }

  function financingLinesFromPlannedUses(row) {
    return collectCreatePhaseUses(row, 'planUses').map(use => {
      const bankAmount = (use.fundingSources || []).reduce((sum, source) => (
        String(source?.name || '').trim().toLowerCase() === 'banco'
          ? sum + numberFromCreate(source.amount)
          : sum
      ), 0);
      return {
        name: use.name || 'Línea',
        approvedAmount: Math.round(bankAmount * 100) / 100,
        observations: ''
      };
    }).filter(line => line.approvedAmount > 0);
  }

  function generateCreateFinancingLines(row, { confirmReplace = true } = {}) {
    const lines = financingLinesFromPlannedUses(row);
    if (!lines.length) {
      alert('No hay importes financiados por Banco en los usos previstos de esta fase.');
      return false;
    }
    const container = row.querySelector('[data-create-phase-financing-lines]');
    if (!container) return false;
    if (confirmReplace && container.querySelector('[data-create-phase-financing-line]') && !confirm('Las líneas actuales se reemplazarán usando el reparto Banco de los usos previstos. ¿Continuar?')) return false;
    container.innerHTML = lines.map(line => createPhaseFinancingLineCard(line)).join('');
    bindBankNumberFormatting(createFinancePhases);
    syncCreatePhaseSources();
    return true;
  }

  function currentCreateFinancialNumbers() {
    return {
      total: numberFromCreate(document.getElementById('fc-projectTotal')?.value),
      bankAmount: numberFromCreate(document.getElementById('fc-bankFinancedAmount')?.value),
      bankPct: numberFromCreate(document.getElementById('fc-bankFinancedPct')?.value),
      promoterAmount: numberFromCreate(document.getElementById('fc-promoterContribution')?.value),
      promoterPct: numberFromCreate(document.getElementById('fc-promoterContributionPct')?.value)
    };
  }

  function phaseUsesTotal(row) {
    return collectPhaseLineItems(row, 'planUses').reduce((sum, item) => sum + numberFromCreate(item.amount), 0);
  }

  function currentPhaseFinancialNumbers(row) {
    return {
      phaseTotal: numberFromCreate(row?.querySelector('[data-create-phase-financial="phaseTotal"]')?.value),
      bankAmount: numberFromCreate(row?.querySelector('[data-create-phase-financial="bankFinancedAmount"]')?.value),
      bankPct: numberFromCreate(row?.querySelector('[data-create-phase-financial="bankFinancedPct"]')?.value),
      promoterAmount: numberFromCreate(row?.querySelector('[data-create-phase-financial="promoterContribution"]')?.value),
      promoterPct: numberFromCreate(row?.querySelector('[data-create-phase-financial="promoterContributionPct"]')?.value)
    };
  }

  function phaseFinancingLinesTotal(row) {
    return Array.from(row?.querySelectorAll('[data-create-phase-financing="approvedAmount"]') || [])
      .reduce((sum, input) => sum + numberFromCreate(input.value), 0);
  }

  function syncCreatePhaseProgressStatus(row) {
    const status = row?.querySelector('[data-create-phase-progress-status]');
    if (!status) return;
    const startValue = row.querySelector('[data-create-phase="actualStartDate"]')?.value || '';
    const endValue = row.querySelector('[data-create-phase="actualEndDate"]')?.value || '';
    status.classList.remove('is-running', 'is-completed');
    if (!startValue) {
      status.textContent = 'Pendiente de iniciar. El fin real se dejará vacío hasta que termine la fase.';
      return;
    }
    const dateAtUtcMidnight = value => {
      const [year, month, day] = String(value || '').split('-').map(Number);
      return year && month && day ? Date.UTC(year, month - 1, day) : null;
    };
    const start = dateAtUtcMidnight(startValue);
    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const end = dateAtUtcMidnight(endValue) ?? today;
    const days = start === null ? 0 : Math.max(0, Math.ceil((end - start) / 86400000));
    if (endValue) {
      status.classList.add('is-completed');
      status.textContent = `Finalizada · ${days} día${days === 1 ? '' : 's'} de duración real.`;
    } else {
      status.classList.add('is-running');
      status.textContent = `Sigue en curso · ${days} día${days === 1 ? '' : 's'} transcurrido${days === 1 ? '' : 's'} hasta hoy.`;
    }
  }

  function syncPhaseFinancialTriplet(row, sourceKey = '') {
    if (!row) return;
    const totalEl = row.querySelector('[data-create-phase-financial="phaseTotal"]');
    const total = numberFromCreate(totalEl?.value);
    const amountEl = row.querySelector('[data-create-phase-financial="bankFinancedAmount"]');
    const pctEl = row.querySelector('[data-create-phase-financial="bankFinancedPct"]');
    const promoterEl = row.querySelector('[data-create-phase-financial="promoterContribution"]');
    const promoterPctEl = row.querySelector('[data-create-phase-financial="promoterContributionPct"]');
    let amount = numberFromCreate(amountEl?.value);
    let pct = numberFromCreate(pctEl?.value);
    let promoter = numberFromCreate(promoterEl?.value);
    let promoterPct = numberFromCreate(promoterPctEl?.value);

    if (sourceKey === 'bankFinancedPct') amount = total * Math.min(Math.max(pct, 0), 100) / 100;
    else if (sourceKey === 'promoterContributionPct') {
      promoter = total * Math.min(Math.max(promoterPct, 0), 100) / 100;
      amount = total - promoter;
    } else if (sourceKey === 'promoterContribution') {
      promoter = Math.min(Math.max(promoter, 0), total);
      amount = total - promoter;
    } else if (sourceKey === 'bankFinancedAmount') {
      amount = Math.min(Math.max(amount, 0), total);
      promoter = total - amount;
    } else if (sourceKey === 'phaseTotal' || total) {
      if (pct) amount = total * pct / 100;
      else if (amount) amount = Math.min(amount, total);
      else if (promoter) amount = total - Math.min(promoter, total);
    }

    amount = Math.min(Math.max(amount, 0), total);
    promoter = Math.max(total - amount, 0);
    pct = total ? amount / total * 100 : 0;
    promoterPct = total ? promoter / total * 100 : 0;

    if (amountEl) amountEl.value = amount ? formatBankNumber(amount) : '';
    if (pctEl) pctEl.value = total ? formatPercentNumber(pct) : '';
    if (promoterEl) promoterEl.value = promoter ? formatBankNumber(promoter) : '';
    if (promoterPctEl) promoterPctEl.value = total ? formatPercentNumber(promoterPct) : '';
  }

  function autoPhaseSourcesForUses(usesTotal, financial = {}) {
    const baseTotal = numberFromCreate(usesTotal) || numberFromCreate(financial.phaseTotal);
    const explicitBank = numberFromCreate(financial.bankAmount);
    const bank = Math.round(Math.min(
      Math.max(explicitBank || baseTotal * numberFromCreate(financial.bankPct) / 100, 0),
      baseTotal
    ) * 100) / 100;
    // La segunda fuente absorbe el redondeo para que usos y fuentes siempre cuadren.
    const promoter = Math.round(Math.max(baseTotal - bank, 0) * 100) / 100;
    return [
      { name: 'Banco', amount: bank },
      { name: 'Promotor', amount: promoter }
    ];
  }

  function syncCreatePhaseSources() {
    let totalUsesAll = 0;
    document.querySelectorAll('[data-create-phase-row]').forEach((row, idx) => {
      syncCreatePhaseProgressStatus(row);
      const planUses = collectCreatePhaseUses(row, 'planUses');
      const realUses = collectCreatePhaseUses(row, 'uses');
      const usesTotal = planUses.reduce((sum, item) => sum + numberFromCreate(item.amount), 0);
      const sources = aggregateCreatePhaseSources(planUses);
      const bank = numberFromCreate(sources.find(item => item.name.toLowerCase() === 'banco')?.amount);
      const promoter = numberFromCreate(sources.find(item => item.name.toLowerCase() === 'promotor')?.amount);
      const presales = numberFromCreate(sources.find(item => item.name.toLowerCase() === 'preventas')?.amount);
      const total = sources.reduce((sum, item) => sum + numberFromCreate(item.amount), 0);
      const realTotal = realUses.reduce((sum, item) => sum + numberFromCreate(item.amount), 0);
      const derived = {
        phaseTotal: usesTotal,
        bankFinancedAmount: bank,
        bankFinancedPct: usesTotal ? bank / usesTotal * 100 : 0,
        promoterContribution: promoter,
        promoterContributionPct: usesTotal ? promoter / usesTotal * 100 : 0
      };
      Object.entries(derived).forEach(([key, value]) => {
        const input = row.querySelector(`[data-create-phase-financial="${key}"]`);
        if (input) input.value = value;
      });
      const phaseFinancial = currentPhaseFinancialNumbers(row);
      const lineRow = document.querySelector(`[data-create-phase-financing-row="${idx}"]`);
      const linesTotal = phaseFinancingLinesTotal(lineRow);
      const linesDiff = bank - linesTotal;
      const phaseTitle = lineRow?.querySelector('[data-line-phase-title]');
      if (phaseTitle) phaseTitle.textContent = row.querySelector('[data-create-phase="name"]')?.value.trim() || `Fase ${idx + 1}`;
      totalUsesAll += usesTotal;
      const setText = (selector, value) => {
        const el = row.querySelector(selector);
        if (el) el.textContent = formatBankNumber(value);
      };
      setText('[data-create-summary="plan-total"]', usesTotal);
      setText('[data-create-summary="plan-bank"]', bank);
      setText('[data-create-summary="plan-promoter"]', promoter);
      setText('[data-create-summary="plan-presales"]', presales);
      const bankPct = row.querySelector('[data-create-summary="plan-bank-pct"]');
      const promoterPct = row.querySelector('[data-create-summary="plan-promoter-pct"]');
      if (bankPct) bankPct.textContent = `${(usesTotal ? bank / usesTotal * 100 : 0).toFixed(1)}%`;
      if (promoterPct) promoterPct.textContent = `${(usesTotal ? promoter / usesTotal * 100 : 0).toFixed(1)}%`;
      setText('[data-create-real-comparison="plan"]', usesTotal);
      setText('[data-create-real-comparison="real"]', realTotal);
      setText('[data-create-real-comparison="difference"]', realTotal - usesTotal);
      setText('[data-phase-financial-total]', phaseFinancial.phaseTotal);
      setText('[data-phase-total-uses]', usesTotal);
      setText('[data-phase-bank-source]', bank);
      setText('[data-phase-promoter-source]', promoter);
      setText('[data-phase-total-sources]', total);
      row.querySelectorAll('[data-create-use-kind]').forEach(useRow => {
        const useAmount = numberFromCreate(useRow.querySelector('[data-create-use-amount]')?.value);
        const sourceTotal = Array.from(useRow.querySelectorAll('[data-create-source-amount]'))
          .reduce((sum, input) => sum + numberFromCreate(input.value), 0);
        const difference = useAmount - sourceTotal;
        const balance = useRow.querySelector('[data-create-use-balance]');
        if (!balance) return;
        balance.classList.toggle('is-danger', Math.abs(difference) > 0.01);
        balance.textContent = Math.abs(difference) <= 0.01
          ? 'Fuentes equilibradas: 100%.'
          : difference > 0
            ? `Faltan B/. ${formatBankNumber(difference)} para cubrir este uso.`
            : `Exceso de B/. ${formatBankNumber(Math.abs(difference))}.`;
      });
      const lineSummary = lineRow?.querySelector('[data-phase-financing-lines-summary]');
      const setLineText = (selector, value) => {
        const el = lineRow?.querySelector(selector);
        if (el) el.textContent = value;
      };
      setLineText('[data-line-bank-amount]', formatBankNumber(bank));
      setLineText('[data-line-total]', formatBankNumber(linesTotal));
      setLineText('[data-line-pending]', formatBankNumber(linesDiff));
      setLineText('[data-line-percent]', bank ? `${Math.max(0, linesTotal / bank * 100).toFixed(1)}%` : '0.0%');
      if (lineSummary) {
        const over = linesTotal > bank + 0.05;
        const pending = bank > linesTotal + 0.05;
        lineSummary.style.color = over ? '#b91c1c' : (pending ? '#92400e' : '#166534');
        lineSummary.innerHTML = over
          ? 'Las lineas de financiacion superan la financiacion bancaria aprobada para esta fase.'
          : pending
            ? `Quedan B/. ${formatBankNumber(linesDiff)} pendientes de asignar a una linea de financiacion.`
            : 'Las lineas coinciden con la financiacion bancaria aprobada para esta fase.';
      }
    });
    const projectTotalEl = document.getElementById('fc-projectTotal');
    if (projectTotalEl) projectTotalEl.value = totalUsesAll ? formatBankNumber(totalUsesAll) : '';
    const financial = currentCreateFinancialNumbers();
    renderCreatePhasesGlobalSummary({
      totalUses: totalUsesAll,
      financial
    });
    updateCreateFundingSummary();
  }

  function ensureCreatePhasesGlobalSummary() {
    if (!createFinancePhases) return null;
    let el = document.getElementById('createFinancePhasesSummary');
    if (!el) {
      el = document.createElement('div');
      el.id = 'createFinancePhasesSummary';
      el.style.cssText = 'border:1px solid #bfdbfe;background:#eff6ff;border-radius:12px;padding:12px;margin:0 0 10px;color:#0f172a;';
      createFinancePhases.parentNode?.insertBefore(el, createFinancePhases);
    }
    return el;
  }

  function renderCreatePhasesGlobalSummary({ totalUses, financial }) {
    const el = ensureCreatePhasesGlobalSummary();
    if (!el) return;
    const projectTotal = numberFromCreate(financial.total);
    const diff = projectTotal - numberFromCreate(totalUses);
    const ok = Math.abs(diff) <= 0.05 && projectTotal > 0;
    const totalBank = 0;
    const totalPromoter = 0;
    el.innerHTML = `
      <strong>Resumen de fases</strong>
      <div class="small" style="margin-top:6px;">
        Usos fases: <b>${formatBankNumber(totalUses)}</b> · Banco: <b>${formatBankNumber(totalBank)}</b> · Promotor: <b>${formatBankNumber(totalPromoter)}</b> · Total fuentes: <b>${formatBankNumber(totalBank + totalPromoter)}</b>
      </div>
      <div class="small" style="margin-top:4px;color:${ok ? '#166534' : '#92400e'};">
        ${financial.total ? (ok ? 'Las fases coinciden con el total del proyecto.' : `Diferencia contra total del proyecto: ${formatBankNumber(diff)}`) : 'Indica el total del proyecto para comparar la suma de fases.'}
      </div>
    `;
    el.innerHTML = `
      <strong>Resumen de fases</strong>
      <div class="small" style="margin-top:6px;">
        Total del proyecto: <b>${formatBankNumber(projectTotal)}</b> &middot; Total de las fases: <b>${formatBankNumber(totalUses)}</b>
      </div>
      <div class="small" style="margin-top:4px;color:${ok ? '#166534' : '#92400e'};">
        ${projectTotal ? (ok ? 'El total del proyecto coincide con el total de las fases.' : `Diferencia: ${formatBankNumber(diff)}`) : 'Indica el total del proyecto para comparar la suma de fases.'}
      </div>
    `;
  }

  function placeholderCard() {
    return `
      <div class="card status-EN_CURSO">
        <div class="portfolio-card-head">
          <h3 class="portfolio-card-title">Aquí verás tus proyectos cuando estén creados.</h3>
          <span class="badge">PORTFOLIO</span>
        </div>
        <div class="portfolio-card-meta">
          <p class="muted portfolio-card-description">Crea tu primer proyecto y quedará enviado a revisión del administrador.</p>
          <p class="small muted portfolio-card-type">&nbsp;</p>
          <p class="small muted portfolio-card-promoter">&nbsp;</p>
        </div>
        <div class="progress portfolio-card-progress"><div style="width:0%"></div></div>
        <p class="small muted portfolio-card-sales">0/0 unidades vendidas (0%)</p>
        ${CAN_CREATE ? `
          <div class="row">
            <button class="btn" type="button" data-create-project-placeholder>Crear proyecto</button>
          </div>
        ` : ''}
      </div>
    `;
  }

  function syncCreateFinancePhases() {
    if (!createFinancePhases) return;
    const count = Math.max(0, Math.round(numberFromCreate(document.getElementById('td-phasesCount')?.value)));
    const current = collectFinancePhases();
    createFinancePhases.innerHTML = Array.from({ length: count }, (_, idx) => createPhaseFinanceBlock(idx, current[idx] || {})).join('');
    bindBankNumberFormatting(createFinancePhases);
    syncCreatePhaseSources();
  }

  function collectPhaseLineItems(row, kind) {
    return collectCreatePhaseUses(row, kind);
  }

  function collectPhaseFinancialConditions(row) {
    const out = {};
    row.querySelectorAll('[data-create-phase-condition]').forEach(input => {
      out[input.dataset.createPhaseCondition] = input.matches('[data-bank-choice]')
        ? readBankChoice(input)
        : (input.value?.trim() || '');
    });
    const phaseFinancial = currentPhaseFinancialNumbers(row);
    out.phaseTotal = phaseFinancial.phaseTotal;
    out.bankFinancedAmount = phaseFinancial.bankAmount;
    out.bankFinancedPct = phaseFinancial.bankPct;
    out.promoterContribution = phaseFinancial.promoterAmount;
    out.promoterContributionPct = phaseFinancial.promoterPct;
    return out;
  }

  function collectPhaseFinancingLines(row) {
    return Array.from(row.querySelectorAll('[data-create-phase-financing-line]')).map(line => ({
      name: line.querySelector('[data-create-phase-financing="name"]')?.value.trim() || '',
      concept: line.querySelector('[data-create-phase-financing="name"]')?.value.trim() || '',
      approvedAmount: numberFromCreate(line.querySelector('[data-create-phase-financing="approvedAmount"]')?.value),
      observations: line.querySelector('[data-create-phase-financing="observations"]')?.value.trim() || ''
    })).filter(item => Object.values(item).some(value => String(value ?? '').trim() !== '' && numberFromCreate(value) !== 0));
  }

  function createRequirementAutomaticInformation(number, phaseIndex) {
    const row = document.querySelector(`[data-create-phase-row="${phaseIndex}"]`);
    const legal = createRequirementLegalDraft || collectLegalData();
    const technical = collectTechnicalData();
    const models = collectHousingModels();
    const selectedPromoter = createPromoterProfiles.get(String(document.getElementById('ld-promoterProfileSelect')?.value || ''));
    const profile = createRequirementPromoterDraft || selectedPromoter?.promoterProfile || promoterProfileState?.promoterProfile || {};
    const conditions = row ? collectPhaseFinancialConditions(row) : {};
    const lineList = items => items.map(item => `${item.name || 'Partida'}: B/. ${formatBankNumber(item.amount)}`).join('; ');
    const uses = row ? collectPhaseLineItems(row, 'planUses') : [];
    const sources = row ? aggregateCreatePhaseSources(collectPhaseLineItems(row, 'planUses')) : [];

    if (number === 1) return [
      `Presupuesto total del proyecto: B/. ${formatBankNumber(numberFromCreate(document.getElementById('fc-projectTotal')?.value))}`,
      `Presupuesto de la fase: B/. ${formatBankNumber(numberFromCreate(conditions.phaseTotal))}`,
      uses.length ? `Usos: ${lineList(uses)}` : ''
    ].filter(Boolean).join('\n');
    if (number === 2) {
      const experience = [
      profile.yearsExperience != null ? `${profile.yearsExperience} años de experiencia` : '',
      profile.deliveredProjects != null ? `${profile.deliveredProjects} proyectos entregados` : '',
      profile.activeProjects != null ? `${profile.activeProjects} proyectos activos` : '',
      profile.developedUnits != null ? `${profile.developedUnits} unidades desarrolladas` : '',
      profile.bankFinancingExperience ? `Experiencia bancaria: ${profile.bankFinancingExperience}` : '',
      profile.banksWorkedWith?.length ? `Bancos: ${profile.banksWorkedWith.join(', ')}` : ''
      ].filter(Boolean).join('; ');
      return experience ? `Promotor (perfil Bank73): ${experience}` : '';
    }
    if (number === 3) return legal.shareholders.map(item => `${item.name || 'Accionista'}: ${item.percentage || 0}%`).join('; ');
    if (number === 4) return '';
    if (number === 9) return [
      ...legal.shareholders.map(item => `Accionista: ${item.name || ''}${item.cedula ? `, identificación ${item.cedula}` : ''}`),
      ...legal.boardMembers.map(item => `Dignatario: ${item.name || ''}${item.position ? `, ${item.position}` : ''}${item.cedula ? `, identificación ${item.cedula}` : ''}`)
    ].join('\n');
    if (number === 10) return document.querySelector('[data-create-precedent="environmentalStudyApproved"]')?.checked ? 'Estudio ambiental marcado como aprobado en Bank73.' : '';
    if (number === 11) return `Fase prevista: ${row?.querySelector('[data-create-phase="name"]')?.value.trim() || `Fase ${phaseIndex + 1}`}`;
    if (number === 12) return [uses.length ? `Usos: ${lineList(uses)}` : '', sources.length ? `Fuentes: ${lineList(sources)}` : ''].filter(Boolean).join('\n');
    if (number === 16 && fundingModuleEnabled && document.getElementById('pSeeksFinancing')?.value === 'true') return technical.assessment?.preliminaryDesign === true || technical.assessment?.approvedPlans === true
      ? `Anteproyecto: ${technical.assessment.preliminaryDesign === true ? 'informado' : 'no informado'}; planos aprobados: ${technical.assessment.approvedPlans === true ? 'sí' : 'no informado'}. Bank73 no registra aquí las firmas del arquitecto y el ingeniero.`
      : '';
    if (number === 20) {
      const commercial = models.reduce((summary, model) => {
        const states = model.initialStatuses || {};
        summary.total += numberFromCreate(model.unitsCount);
        summary.reserved += numberFromCreate(states.reservado);
        summary.cpp += numberFromCreate(states.con_cpp);
        summary.legal += numberFromCreate(states.tramite_legal_activado);
        summary.deeded += numberFromCreate(states.escriturado_traspasado);
        summary.delivered += numberFromCreate(states.vivienda_entregada);
        return summary;
      }, { total: 0, reserved: 0, cpp: 0, legal: 0, deeded: 0, delivered: 0 });
      const presales = commercial.reserved + commercial.cpp + commercial.legal + commercial.deeded + commercial.delivered;
      const pct = commercial.total ? (presales / commercial.total * 100).toFixed(1) : '0.0';
      return [
        commercial.total || presales
          ? `Comercial: ${commercial.total} unidades totales; ${commercial.reserved} reservadas; ${commercial.cpp} con CPP; ${commercial.legal} en trámite legal; ${commercial.deeded} escrituradas/traspasadas; ${commercial.delivered} entregadas. Preventas/comercializadas: ${presales} (${pct}%).`
          : '',
        conditions.requiredPresales ? `Condición financiera registrada: ${conditions.requiredPresales}` : ''
      ].filter(Boolean).join('\n');
    }
    if (number === 21) return conditions.technicalInspector ? `Inspector técnico registrado: ${conditions.technicalInspector}. Este dato no acredita por sí solo la certificación inicial.` : '';
    if (number === 22 || number === 28) return technical.assessment?.constructionBudget === true ? 'Bank73 registra la existencia de un presupuesto de construcción; no consta aquí su validación por la Gerencia de Ingeniería.' : '';
    if (number === 24) return technical.insurancePolicies?.length ? `${technical.insurancePolicies.length} póliza(s) CAR/incendio registrada(s) en Datos técnicos.` : '';
    if (number === 25) return numberFromCreate(conditions.phaseTotal) ? `Valor de la fase: B/. ${formatBankNumber(numberFromCreate(conditions.phaseTotal))}. Fianza de cumplimiento requerida: 50%.` : '';
    if (number === 26) return numberFromCreate(conditions.phaseTotal) ? `Valor de la fase: B/. ${formatBankNumber(numberFromCreate(conditions.phaseTotal))}. Fianza de pago requerida: 25%.` : '';
    return '';
  }

  function createRequirementStructuredData(number, phaseIndex) {
    const row = document.querySelector(`[data-create-phase-row="${phaseIndex}"]`);
    const conditions = row ? collectPhaseFinancialConditions(row) : {};
    const legal = createRequirementLegalDraft || collectLegalData();
    const selectedPromoter = createPromoterProfiles.get(String(document.getElementById('ld-promoterProfileSelect')?.value || ''));
    const profile = createRequirementPromoterDraft || selectedPromoter?.promoterProfile || promoterProfileState?.promoterProfile || {};
    const technical = collectTechnicalData();
    if (number === 1) return { kind:'budget', projectTotal:numberFromCreate(document.getElementById('fc-projectTotal')?.value), phaseTotal:numberFromCreate(conditions.phaseTotal), uses:row ? collectPhaseLineItems(row, 'planUses') : [] };
    if (number === 2) return { kind:'experience', promoter: Object.fromEntries(REQUIREMENT_PROMOTER_FIELDS.map(([key]) => [key, profile[key] ?? (['countries','banksWorkedWith'].includes(key) ? [] : null)])) };
    if (number === 3) return { kind:'shareholders', shareholders:legal.shareholders || [] };
    if (number === 4) return { kind:'architecturalPlans', models:collectHousingModels().map(model => ({ name:model.name || '', bedrooms:numberFromCreate(model.bedrooms), bathrooms:numberFromCreate(model.bathrooms), openAreaM2:numberFromCreate(model.openAreaM2), closedAreaM2:numberFromCreate(model.closedAreaM2), unitsCount:numberFromCreate(model.unitsCount) })).filter(model => model.name || model.unitsCount) };
    if (number === 9) return { kind:'legalParties', shareholders:legal.shareholders || [], dignitaries:legal.boardMembers || [] };
    if (number === 12) return { kind:'cashflow', uses:row ? collectPhaseLineItems(row, 'planUses') : [], sources:row ? aggregateCreatePhaseSources(collectPhaseLineItems(row, 'planUses')) : [] };
    if (number === 20) {
      const data = collectHousingModels().reduce((out, model) => { const states = model.initialStatuses || {}; const marketed = numberFromCreate(states.reservado) + numberFromCreate(states.con_cpp) + numberFromCreate(states.tramite_legal_activado) + numberFromCreate(states.escriturado_traspasado) + numberFromCreate(states.vivienda_entregada); out.total += numberFromCreate(model.unitsCount); out.reserved += numberFromCreate(states.reservado); out.cpp += numberFromCreate(states.con_cpp); out.legal += numberFromCreate(states.tramite_legal_activado); out.deeded += numberFromCreate(states.escriturado_traspasado); out.delivered += numberFromCreate(states.vivienda_entregada); out.saleValue += marketed * numberFromCreate(model.price); return out; }, { total:0,reserved:0,cpp:0,legal:0,deeded:0,delivered:0,saleValue:0 });
      data.presales = data.reserved + data.cpp + data.legal + data.deeded + data.delivered;
      data.presalesPct = data.total ? data.presales / data.total * 100 : 0;
      const requiredMatch = String(conditions.requiredPresales || '50').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
      const requiredPresalesPct = Math.max(0, Math.min(100, Number(requiredMatch?.[0] ?? 50)));
      return { kind:'presales', ...data, cppAmount:0, requiredPresales:conditions.requiredPresales || '50%', requiredPresalesPct };
    }
    if (number === 11) return { kind:'schedule', phaseName:row?.querySelector('[data-create-phase="name"]')?.value || `Fase ${phaseIndex + 1}` };
    if (number === 10) return { kind:'flag', label:'EIA aprobado', value:!!document.querySelector('[data-create-precedent="environmentalStudyApproved"]')?.checked };
    if (number === 16 && fundingModuleEnabled && document.getElementById('pSeeksFinancing')?.value === 'true') return { kind:'plans', preliminaryDesign:technical.assessment?.preliminaryDesign ?? null, approvedPlans:technical.assessment?.approvedPlans ?? null };
    if (number === 21) return { kind:'inspector', technicalInspector:conditions.technicalInspector || '' };
    if (number === 22 || number === 28) return { kind:'constructionBudget', exists:technical.assessment?.constructionBudget ?? null };
    if (number === 24) return { kind:'insurancePolicies', policies:technical.insurancePolicies || [] };
    if (number === 25) {
      const phaseValue = numberFromCreate(conditions.phaseTotal);
      return { kind:'performanceBond', phaseValue, requiredPct:50, requiredAmount:phaseValue * 0.5, actualAmount:0, bondNumber:'', issuer:'', startDate:null, expiryDate:null, alertDaysBefore:30 };
    }
    if (number === 26) {
      const phaseValue = numberFromCreate(conditions.phaseTotal);
      return { kind:'paymentBond', phaseValue, requiredPct:25, requiredAmount:phaseValue * 0.25, actualAmount:0, bondNumber:'', issuer:'', startDate:null, expiryDate:null, alertDaysBefore:30 };
    }
    if (number === 27) return { kind:'periodicFollowUp', followUpType:'engineeringInspection', periodicityMonths:4, lastRecordDate:null, nextReviewDate:null };
    if (number === 29) return { kind:'periodicFollowUp', followUpType:'accountAdvance', periodicityMonths:1, lastRecordDate:null, nextReviewDate:null };
    return undefined;
  }

  function requirementsForCreatePhase(phaseIndex) {
    const saved = createPhaseRequirementsState.get(phaseIndex) || [];
    const byNumber = new Map(saved.map(item => [Number(item.number), item]));
    const requirements = BANK_REQUIREMENT_TITLES.map((title, index) => {
      const number = index + 1;
      const current = byNumber.get(number) || {};
      const automatic = createRequirementAutomaticInformation(number, phaseIndex);
      let structuredData = createRequirementStructuredData(number, phaseIndex);
      if (number === 25 && structuredData && current.structuredData) {
        const requiredPct = Math.max(0, Math.min(100, Number(current.structuredData.requiredPct ?? 50)));
        structuredData = { ...structuredData, requiredPct, requiredAmount:structuredData.phaseValue * requiredPct / 100 };
      }
      if (number === 26 && structuredData && current.structuredData) {
        const requiredPct = Math.max(0, Math.min(100, Number(current.structuredData.requiredPct ?? 25)));
        structuredData = { ...structuredData, requiredPct, requiredAmount:structuredData.phaseValue * requiredPct / 100 };
      }
      if ([27, 29].includes(number) && structuredData && current.structuredData) {
        const defaultMonths = number === 27 ? 4 : 1;
        structuredData = { ...structuredData, periodicityMonths:Math.max(1, Math.min(120, Math.round(Number(current.structuredData.periodicityMonths) || defaultMonths))) };
      }
      const useAutomatic = !byNumber.has(number) || current.sourceKey === 'bank73';
      const hasAutomaticSource = Boolean(automatic || structuredData);
      return {
        number,
        title,
        information: useAutomatic ? automatic : current.information,
        manualInformation: current.manualInformation || '',
        structuredData,
        sourceKey: useAutomatic ? (hasAutomaticSource ? 'bank73' : 'manual') : (current.sourceKey || 'manual'),
        sourceLabel: useAutomatic && hasAutomaticSource ? (number === 4 ? 'Contexto desde Bank73' : 'Precargado desde Bank73') : 'Entrada manual',
        status: 'PENDIENTE',
        observations: current.observations || ''
      };
    });
    createPhaseRequirementsState.set(phaseIndex, requirements);
    return requirements;
  }

  function requirementInputGuidance(title) {
    return `Información solicitada: ${title}. Describe los datos disponibles y adjunta la documentación correspondiente.`;
  }

  function createRequirementMetric(label, value, type = '') {
    const shown = type === 'money' ? `B/. ${formatBankNumber(value || 0)}` : type === 'pct' ? `${Number(value || 0).toFixed(1)}%` : (value ?? '—');
    return `<div class="requirement-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(shown))}</strong></div>`;
  }

  function createLegalRowsHtml(rows = [], kind) {
    const source = rows.length ? rows : [{}];
    return source.map(item => `<div class="requirement-legal-row" data-create-legal-row="${kind}"><input data-create-legal-field="name" value="${escapeHtml(item.name || '')}" placeholder="Nombre">${kind !== 'shareholder' ? `<input data-create-legal-field="cedula" value="${escapeHtml(item.cedula || '')}" placeholder="Identificación">` : ''}${kind === 'shareholder' ? `<input data-create-legal-field="percentage" type="number" min="0" max="100" value="${escapeHtml(item.percentage ?? '')}" placeholder="%">` : kind === 'dignitary' ? `<input data-create-legal-field="position" value="${escapeHtml(item.position || '')}" placeholder="Cargo">` : ''}<button class="btn btn-ghost btn-xs" type="button" data-remove-create-legal-row>✕</button></div>`).join('');
  }

  function createStructuredRequirementHtml(item) {
    const data = item.structuredData || {};
    if (data.kind === 'budget') return `<div class="requirement-structured"><div class="requirement-metrics">${createRequirementMetric('Total del proyecto',data.projectTotal,'money')}${createRequirementMetric('Presupuesto de fase',data.phaseTotal,'money')}</div><div class="requirement-line-list">${(data.uses || []).map(use => `<div><span>${escapeHtml(use.name || 'Partida')}</span><b>B/. ${escapeHtml(formatBankNumber(use.amount))}</b></div>`).join('')}</div></div>`;
    if (data.kind === 'presales') return `<div class="requirement-structured"><div class="requirement-metrics">${createRequirementMetric('Unidades totales',data.total)}${createRequirementMetric('Reservadas',data.reserved)}${createRequirementMetric('Con CPP',data.cpp)}${createRequirementMetric('Trámite legal',data.legal)}${createRequirementMetric('Escrituradas',data.deeded)}${createRequirementMetric('Entregadas',data.delivered)}${createRequirementMetric('Preventas',data.presales)}${createRequirementMetric('% preventa actual',data.presalesPct,'pct')}${createRequirementMetric('Valor asociado',data.saleValue,'money')}</div><label class="requirement-presales-target"><span>% de preventas requerido</span><input type="number" min="0" max="100" step="0.1" data-create-required-presales-pct value="${escapeHtml(data.requiredPresalesPct ?? 50)}"><b>%</b></label></div>`;
    if (data.kind === 'performanceBond') return `<div class="requirement-structured"><div class="requirement-metrics">${createRequirementMetric('Valor de la fase',data.phaseValue,'money')}<div class="requirement-metric"><span>Importe de fianza requerido</span><strong data-performance-bond-required-amount>B/. ${escapeHtml(formatBankNumber(data.requiredAmount || 0))}</strong></div></div><label class="requirement-presales-target"><span>% de fianza requerido</span><input type="number" min="0" max="100" step="0.1" data-create-performance-bond-pct value="${escapeHtml(data.requiredPct ?? 50)}"><b>%</b></label></div>`;
    if (data.kind === 'paymentBond') return `<div class="requirement-structured"><div class="requirement-metrics">${createRequirementMetric('Valor de la fase',data.phaseValue,'money')}<div class="requirement-metric"><span>Importe de fianza de pago requerido</span><strong data-payment-bond-required-amount>B/. ${escapeHtml(formatBankNumber(data.requiredAmount || 0))}</strong></div></div><label class="requirement-presales-target"><span>% de fianza de pago requerido</span><input type="number" min="0" max="100" step="0.1" data-create-payment-bond-pct value="${escapeHtml(data.requiredPct ?? 25)}"><b>%</b></label></div>`;
    if (data.kind === 'periodicFollowUp') return `<div class="requirement-structured"><label class="requirement-presales-target"><span>Periodicidad del seguimiento</span><input type="number" min="1" max="120" step="1" data-create-follow-up-months="${escapeHtml(item.number)}" value="${escapeHtml(data.periodicityMonths ?? (item.number === 27 ? 4 : 1))}"><b>meses</b></label></div>`;
    if (data.kind === 'experience') return `<div class="requirement-structured"><div class="requirement-structured-section"><strong>Experiencia del promotor</strong><div class="requirement-profile-grid">${REQUIREMENT_PROMOTER_FIELDS.map(([key,label,type]) => { const value = Array.isArray(data.promoter?.[key]) ? data.promoter[key].join(', ') : (data.promoter?.[key] ?? ''); const field = type === 'yesno' ? `<select data-create-promoter-field="${key}" data-field-type="${type}"><option value="">No definido</option><option value="Sí" ${value === 'Sí' ? 'selected' : ''}>Sí</option><option value="No" ${value === 'No' ? 'selected' : ''}>No</option></select>` : type === 'doclevel' ? `<select data-create-promoter-field="${key}" data-field-type="${type}"><option value="">No definido</option>${['Baja','Media','Alta'].map(option => `<option value="${option}" ${value === option ? 'selected' : ''}>${option}</option>`).join('')}</select>` : `<input data-create-promoter-field="${key}" data-field-type="${type}" ${type === 'number' ? 'type="number" min="0"' : ''} value="${escapeHtml(value)}">`; return `<label><span>${escapeHtml(label)}</span>${field}</label>`; }).join('')}</div></div></div>`;
    if (data.kind === 'shareholders') return `<div class="requirement-structured"><strong>Accionistas</strong><div data-create-legal-rows="shareholder">${createLegalRowsHtml(data.shareholders || [],'shareholder')}</div><button class="btn btn-ghost btn-xs" type="button" data-add-create-legal-row="shareholder">+ Accionista</button></div>`;
    if (data.kind === 'architecturalPlans') return `<div class="requirement-structured"><div class="requirement-structured-section"><strong>Modelos/tipologías — información de contexto</strong><div class="requirement-model-grid">${(data.models || []).map(model => `<div><strong>${escapeHtml(model.name || 'Modelo')}</strong><span>${escapeHtml(String(model.unitsCount || 0))} unidades · ${escapeHtml(String(model.bedrooms || 0))} rec. · ${escapeHtml(String(model.bathrooms || 0))} baños</span><span>${escapeHtml(formatBankNumber(model.openAreaM2 || 0))} m² abiertos · ${escapeHtml(formatBankNumber(model.closedAreaM2 || 0))} m² cerrados</span></div>`).join('') || '<span class="requirement-empty">Sin modelos informados.</span>'}</div><p class="requirement-context-warning">Las tipologías son solo contexto y no acreditan la existencia de planos o plantas arquitectónicas.</p></div></div>`;
    if (data.kind === 'legalParties') return `<div class="requirement-structured"><div class="requirement-structured-section"><strong>Accionistas e identificación</strong><div data-create-legal-rows="shareholder-id">${createLegalRowsHtml(data.shareholders || [],'shareholder-id')}</div><button class="btn btn-ghost btn-xs" type="button" data-add-create-legal-row="shareholder-id">+ Accionista</button></div><div class="requirement-structured-section"><strong>Dignatarios</strong><div data-create-legal-rows="dignitary">${createLegalRowsHtml(data.dignitaries || [],'dignitary')}</div><button class="btn btn-ghost btn-xs" type="button" data-add-create-legal-row="dignitary">+ Dignatario</button></div></div>`;
    if (data.kind === 'cashflow') return `<div class="requirement-structured">${['uses','sources'].map(key => `<div class="requirement-structured-section"><strong>${key === 'uses' ? 'Usos' : 'Fuentes'}</strong><div class="requirement-line-list">${(data[key] || []).map(line => `<div><span>${escapeHtml(line.name || 'Partida')}</span><b>B/. ${escapeHtml(formatBankNumber(line.amount))}</b></div>`).join('')}</div></div>`).join('')}</div>`;
    if (data.kind === 'schedule') return `<div class="requirement-structured"><div class="requirement-metrics">${createRequirementMetric('Fase',data.phaseName || '—')}</div></div>`;
    if (data.kind === 'plans') return `<div class="requirement-structured"><div class="requirement-metrics">${createRequirementMetric('Anteproyecto',data.preliminaryDesign === true ? 'Informado' : 'No informado')}${createRequirementMetric('Planos aprobados',data.approvedPlans === true ? 'Sí' : 'No informado')}</div></div>`;
    if (data.kind === 'flag') return `<div class="requirement-structured"><div class="requirement-metrics">${createRequirementMetric(data.label || 'Estado',data.value ? 'Sí' : 'No')}</div></div>`;
    if (data.kind === 'inspector') return `<div class="requirement-structured"><div class="requirement-metrics">${createRequirementMetric('Inspector técnico',data.technicalInspector || 'No informado')}</div></div>`;
    if (data.kind === 'constructionBudget') return `<div class="requirement-structured"><div class="requirement-metrics">${createRequirementMetric('Presupuesto de construcción registrado',data.exists === true ? 'Sí' : 'No informado')}</div></div>`;
    if (data.kind === 'insurancePolicies') return `<div class="requirement-structured"><div class="requirement-structured-section"><strong>Pólizas registradas en Datos técnicos</strong><div style="display:grid;gap:8px;margin-top:8px;">${(data.policies || []).map(policy => {
      const coverage = policy.appliesToAllUnits !== false ? 'Todas las unidades' : ((policy.unitRefs || []).join(', ') || 'Sin unidades seleccionadas');
      return `<div class="insurance-policy-card ${policy.endorsedToBank ? 'is-endorsed' : 'is-not-endorsed'}"><div style="display:flex;justify-content:space-between;gap:8px;"><strong>${escapeHtml(policy.type || 'CAR')} · ${escapeHtml(policy.policyNumber || 'Sin número')}</strong><span class="insurance-endorsement ${policy.endorsedToBank ? 'yes' : 'no'}">${policy.endorsedToBank ? '✓ Endosada al banco' : '⚠ No endosada al banco'}</span></div><div class="insurance-policy-card-grid"><div><span>Aseguradora</span><strong>${escapeHtml(policy.insurer || 'No informada')}</strong></div><div><span>Suma asegurada</span><strong>${escapeHtml(formatBankNumber(policy.insuredAmount || 0))}</strong></div><div><span>Vencimiento</span><strong>${escapeHtml(policy.expiryDate ? String(policy.expiryDate).slice(0,10) : 'No informado')}</strong></div><div><span>Banco</span><strong>${escapeHtml(policy.bank || 'No informado')}</strong></div><div><span>Cobertura</span><strong>${escapeHtml(coverage)}</strong></div><div><span>Documento</span><strong>${escapeHtml(policy.documentName || 'Sin documento')}</strong></div></div></div>`;
    }).join('') || '<span class="requirement-empty">Sin pólizas. Añádelas en Datos técnicos.</span>'}</div></div></div>`;
    if (data.kind === 'insurance' || data.kind === 'guarantees') return `<div class="requirement-structured"><div class="requirement-metrics">${createRequirementMetric(data.kind === 'insurance' ? 'Seguros registrados' : 'Garantías registradas',data.value || 'No informado')}</div></div>`;
    return '';
  }

  function setCreateRequirementsFullscreen(modal, full) {
    modal.classList.toggle('is-fullscreen', full);
    const button = modal.querySelector('[data-toggle-create-requirements-fullscreen]');
    if (button) {
      button.textContent = full ? '□' : '⛶';
      button.title = full ? 'Restaurar tamaño' : 'Pantalla completa';
      button.setAttribute('aria-label', button.title);
    }
    const bodyZoom = Number.parseFloat(getComputedStyle(document.body).zoom) || 1;
    modal.style.zoom = full && bodyZoom < 1 ? String(1 / bodyZoom) : '';
  }

  function readCreateRequirementLegalRows(modal, kind) {
    return Array.from(modal.querySelectorAll(`[data-create-legal-row="${kind}"]`)).map(row => ({
      name: row.querySelector('[data-create-legal-field="name"]')?.value.trim() || '',
      cedula: row.querySelector('[data-create-legal-field="cedula"]')?.value.trim() || '',
      percentage: numberFromCreate(row.querySelector('[data-create-legal-field="percentage"]')?.value),
      position: row.querySelector('[data-create-legal-field="position"]')?.value.trim() || ''
    }));
  }

  function syncCreateRequirementStructuredDrafts(modal) {
    const promoterInputs = modal.querySelectorAll('[data-create-promoter-field]');
    if (promoterInputs.length) {
      createRequirementPromoterDraft ||= {};
      promoterInputs.forEach(input => {
        const key = input.dataset.createPromoterField;
        createRequirementPromoterDraft[key] = input.dataset.fieldType === 'number'
          ? (input.value === '' ? null : numberFromCreate(input.value))
          : input.dataset.fieldType === 'list'
            ? input.value.split(',').map(value => value.trim()).filter(Boolean)
            : input.value.trim();
      });
    }
    createRequirementLegalDraft ||= collectLegalData();
    const composition = readCreateRequirementLegalRows(modal, 'shareholder');
    const identities = readCreateRequirementLegalRows(modal, 'shareholder-id');
    if (composition.length) createRequirementLegalDraft.shareholders = composition;
    if (identities.length) {
      const current = createRequirementLegalDraft.shareholders || [];
      createRequirementLegalDraft.shareholders = identities.map((item, index) => ({
        ...(current[index] || {}), name: item.name, cedula: item.cedula
      }));
    }
    const dignitaries = readCreateRequirementLegalRows(modal, 'dignitary');
    if (dignitaries.length) createRequirementLegalDraft.boardMembers = dignitaries;
  }

  function ensureCreateRequirementsModal() {
    let modal = document.getElementById('createRequirementsModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'createRequirementsModal';
    modal.className = 'modal-backdrop requirements-modal-backdrop';
    modal.style.display = 'none';
    modal.innerHTML = `<div class="modal requirements-modal">
      <header class="requirements-modal-header">
        <div><div class="requirements-modal-eyebrow">CONFIGURACIÓN DE LA FASE</div><h3>Requisitos</h3><div class="requirements-modal-subtitle" data-create-requirements-phase></div></div>
        <div class="requirements-modal-header-actions"><button class="btn btn-ghost requirements-modal-icon" type="button" data-toggle-create-requirements-fullscreen aria-label="Pantalla completa" title="Pantalla completa">⛶</button><button class="btn btn-ghost" type="button" data-close-create-requirements>✕ Cerrar</button></div>
      </header>
      <div class="requirements-copy-toolbar" data-create-requirements-copy>
        <label><span>Reutilizar información de otra fase</span><select data-create-requirements-source></select></label>
        <button class="btn btn-ghost" type="button" data-copy-create-requirements>Copiar información</button>
      </div>
      <div class="requirements-modal-list" data-create-requirements-list></div>
      <footer class="requirements-modal-actions"><button class="btn" type="button" data-save-create-requirements>Guardar requisitos</button></footer>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('[data-close-create-requirements]').onclick = () => {
      setCreateRequirementsFullscreen(modal, false);
      modal.style.display = 'none';
    };
    modal.querySelector('[data-toggle-create-requirements-fullscreen]').onclick = () => {
      setCreateRequirementsFullscreen(modal, !modal.classList.contains('is-fullscreen'));
    };
    modal.querySelector('[data-save-create-requirements]').onclick = () => {
      syncCreateRequirementStructuredDrafts(modal);
      setCreateRequirementsFullscreen(modal, false);
      modal.style.display = 'none';
    };
    modal.addEventListener('input', event => {
      if (event.target.matches('[data-create-promoter-field],[data-create-legal-field]')) syncCreateRequirementStructuredDrafts(modal);
    });
    modal.addEventListener('click', event => {
      if (event.target.closest('[data-add-policy-from-requirement]')) {
        syncCreateRequirementStructuredDrafts(modal);
        addCreateInsurancePolicy();
        setCreateRequirementsFullscreen(modal, false);
        modal.style.display = 'none';
        setCreateStep('technical');
        document.getElementById('createInsurancePolicies')?.scrollIntoView({ behavior:'smooth', block:'center' });
        return;
      }
      const remove = event.target.closest('[data-remove-create-legal-row]');
      if (remove) {
        remove.closest('[data-create-legal-row]')?.remove();
        syncCreateRequirementStructuredDrafts(modal);
        return;
      }
      const add = event.target.closest('[data-add-create-legal-row]');
      if (add) {
        const kind = add.dataset.addCreateLegalRow;
        modal.querySelector(`[data-create-legal-rows="${kind}"]`)?.insertAdjacentHTML('beforeend', createLegalRowsHtml([{}], kind));
        syncCreateRequirementStructuredDrafts(modal);
      }
    });
    return modal;
  }

  function openCreateRequirements(phaseIndex) {
    const modal = ensureCreateRequirementsModal();
    const selectedPromoter = createPromoterProfiles.get(String(document.getElementById('ld-promoterProfileSelect')?.value || ''));
    if (!createRequirementPromoterDraft) {
      const profile = selectedPromoter?.promoterProfile || promoterProfileState?.promoterProfile || {};
      createRequirementPromoterOriginal = JSON.parse(JSON.stringify(profile));
      createRequirementPromoterDraft = JSON.parse(JSON.stringify(profile));
    }
    if (!createRequirementLegalDraft) createRequirementLegalDraft = JSON.parse(JSON.stringify(collectLegalData()));
    const requirements = requirementsForCreatePhase(phaseIndex);
    modal.dataset.phaseIndex = String(phaseIndex);
    setCreateRequirementsFullscreen(modal, false);
    const phaseName = document.querySelector(`[data-create-phase-row="${phaseIndex}"] [data-create-phase="name"]`)?.value || `Fase ${phaseIndex + 1}`;
    modal.querySelector('[data-create-requirements-phase]').textContent = phaseName;
    const phaseRows = Array.from(document.querySelectorAll('[data-create-phase-row]'));
    const copyToolbar = modal.querySelector('[data-create-requirements-copy]');
    const sourceSelect = modal.querySelector('[data-create-requirements-source]');
    const otherPhases = phaseRows.map((row, index) => ({
      index,
      name: row.querySelector('[data-create-phase="name"]')?.value.trim() || `Fase ${index + 1}`
    })).filter(item => item.index !== phaseIndex);
    copyToolbar.style.display = otherPhases.length ? '' : 'none';
    sourceSelect.innerHTML = otherPhases.map(item => `<option value="${item.index}">${escapeHtml(item.name)}</option>`).join('');
    modal.querySelector('[data-create-requirements-list]').innerHTML = requirements.map(item => {
      const fileKey = `${phaseIndex}:${item.number}`;
      const files = item.number === 4 ? createArchitecturalPlanFilesState : (createRequirementFilesState.get(fileKey) || []);
      const isManual = item.sourceKey !== 'bank73';
      const guidance = requirementInputGuidance(item.title);
      return `<article class="requirement-card" data-create-requirement="${item.number}">
        <div class="requirement-card-heading"><strong class="requirement-title"><span>${item.number}</span>${escapeHtml(item.title)}</strong><span class="requirement-source ${isManual ? 'is-manual' : 'is-bank73'}">${escapeHtml(item.sourceLabel)}</span></div>
        ${createStructuredRequirementHtml(item)}
        <div class="requirement-help">${escapeHtml(guidance)}</div>
        <label class="requirement-field"><span>${item.number === 2 ? 'Experiencia del contratista' : 'Información manual o adicional'}</span><textarea rows="3" data-create-requirement-information placeholder="Introduce información adicional…">${escapeHtml(item.manualInformation || '')}</textarea></label>
        ${item.number === 24 ? '<div class="requirement-documents-row"><button class="btn btn-ghost btn-xs" type="button" data-add-policy-from-requirement>+ Añadir póliza en Datos técnicos</button><span class="small muted">La póliza y su documento se guardarán en una única fuente.</span></div>' : `<div class="requirement-documents-row"><label class="btn btn-ghost btn-xs requirement-upload-button">${item.number === 4 ? 'Adjuntar planos' : 'Adjuntar documentos'}<input type="file" multiple ${item.number === 4 ? 'data-create-architectural-plan-files accept=".pdf,.jpg,.jpeg,.png"' : `data-create-requirement-files="${item.number}"`}></label><span class="requirement-file-name" ${item.number === 4 ? 'data-create-architectural-plan-name' : 'data-create-requirement-file-name'}>${files.length ? files.map(file => escapeHtml(file.name)).join(', ') : (item.number === 4 ? 'Sin planos adjuntos' : 'Sin archivos seleccionados')}</span></div>`}
      </article>`;
    }).join('');
    modal.querySelectorAll('[data-create-requirement-information]').forEach(input => {
      input.addEventListener('input', () => {
        const number = Number(input.closest('[data-create-requirement]').dataset.createRequirement);
        const item = requirements.find(entry => entry.number === number);
        if (item) item.manualInformation = input.value;
      });
    });
    modal.querySelector('[data-create-required-presales-pct]')?.addEventListener('input', event => {
      const pct = Math.max(0, Math.min(100, Number(event.target.value || 0)));
      const phaseCondition = document.querySelector(`[data-create-phase-row="${phaseIndex}"] [data-create-phase-condition="requiredPresales"]`);
      if (phaseCondition) phaseCondition.value = `${pct}%`;
      const requirement = requirements.find(entry => entry.number === 20);
      if (requirement?.structuredData) {
        requirement.structuredData.requiredPresalesPct = pct;
        requirement.structuredData.requiredPresales = `${pct}%`;
      }
      createPhaseRequirementsState.set(phaseIndex, requirements);
    });
    modal.querySelector('[data-create-performance-bond-pct]')?.addEventListener('input', event => {
      const pct = Math.max(0, Math.min(100, Number(event.target.value || 0)));
      const requirement = requirements.find(entry => entry.number === 25);
      if (requirement?.structuredData) {
        requirement.structuredData.requiredPct = pct;
        requirement.structuredData.requiredAmount = Number(requirement.structuredData.phaseValue || 0) * pct / 100;
        requirement.information = requirement.structuredData.phaseValue ? `Valor de la fase: B/. ${formatBankNumber(requirement.structuredData.phaseValue)}. Fianza de cumplimiento requerida: ${pct}%.` : '';
        const card = event.target.closest('[data-create-requirement]');
        const amount = card?.querySelector('[data-performance-bond-required-amount]');
        if (amount) amount.textContent = `B/. ${formatBankNumber(requirement.structuredData.requiredAmount)}`;
      }
      createPhaseRequirementsState.set(phaseIndex, requirements);
    });
    modal.querySelector('[data-create-payment-bond-pct]')?.addEventListener('input', event => {
      const pct = Math.max(0, Math.min(100, Number(event.target.value || 0)));
      const requirement = requirements.find(entry => entry.number === 26);
      if (requirement?.structuredData) {
        requirement.structuredData.requiredPct = pct;
        requirement.structuredData.requiredAmount = Number(requirement.structuredData.phaseValue || 0) * pct / 100;
        requirement.information = requirement.structuredData.phaseValue ? `Valor de la fase: B/. ${formatBankNumber(requirement.structuredData.phaseValue)}. Fianza de pago requerida: ${pct}%.` : '';
        const card = event.target.closest('[data-create-requirement]');
        const amount = card?.querySelector('[data-payment-bond-required-amount]');
        if (amount) amount.textContent = `B/. ${formatBankNumber(requirement.structuredData.requiredAmount)}`;
      }
      createPhaseRequirementsState.set(phaseIndex, requirements);
    });
    modal.querySelectorAll('[data-create-follow-up-months]').forEach(input => input.addEventListener('input', event => {
      const number = Number(event.target.dataset.createFollowUpMonths);
      const requirement = requirements.find(entry => entry.number === number);
      if (requirement?.structuredData) requirement.structuredData.periodicityMonths = Math.max(1, Math.min(120, Math.round(Number(event.target.value) || (number === 27 ? 4 : 1))));
      createPhaseRequirementsState.set(phaseIndex, requirements);
    }));
    modal.querySelector('[data-copy-create-requirements]').onclick = () => {
      const sourceIndex = Number(sourceSelect.value);
      if (!Number.isInteger(sourceIndex)) return;
      const source = requirementsForCreatePhase(sourceIndex);
      const conflicts = requirements.filter((target, index) => target.manualInformation && source[index]?.manualInformation && target.manualInformation !== source[index].manualInformation);
      if (conflicts.length && !confirm(`La fase destino ya tiene información manual en ${conflicts.length} requisito(s). ¿Quieres sustituirla?`)) return;
      requirements.forEach((target, index) => {
        if (source[index]?.manualInformation) target.manualInformation = source[index].manualInformation;
      });
      createPhaseRequirementsState.set(phaseIndex, requirements);
      openCreateRequirements(phaseIndex);
    };
    modal.querySelectorAll('[data-create-requirement-files]').forEach(input => {
      input.addEventListener('change', () => {
        const number = Number(input.dataset.createRequirementFiles);
        const files = Array.from(input.files || []);
        createRequirementFilesState.set(`${phaseIndex}:${number}`, files);
        const label = input.closest('[data-create-requirement]').querySelector('[data-create-requirement-file-name]');
        if (label) label.textContent = files.length ? files.map(file => file.name).join(', ') : 'Sin archivos';
      });
    });
    modal.querySelector('[data-create-architectural-plan-files]')?.addEventListener('change', event => {
      setCreateArchitecturalPlanFiles(event.target.files);
    });
    modal.style.display = 'flex';
  }

  function collectFinancePhases() {
    return Array.from(document.querySelectorAll('[data-create-phase-row]')).map((row, idx) => {
      const lineRow = document.querySelector(`[data-create-phase-financing-row="${idx}"]`) || row;
      return {
        name: row.querySelector('[data-create-phase="name"]')?.value.trim() || `Fase ${idx + 1}`,
        startDate: row.querySelector('[data-create-phase="startDate"]')?.value || null,
        endDate: row.querySelector('[data-create-phase="endDate"]')?.value || null,
        actualStartDate: row.querySelector('[data-create-phase="actualStartDate"]')?.value || null,
        actualEndDate: row.querySelector('[data-create-phase="actualEndDate"]')?.value || null,
        financierBanks: Array.from(row.querySelector('[data-create-phase-banks]')?.selectedOptions || []).map(option => option.value).filter(Boolean),
        planUses: collectPhaseLineItems(row, 'planUses'),
        planSources: aggregateCreatePhaseSources(collectPhaseLineItems(row, 'planUses')),
        uses: collectPhaseLineItems(row, 'uses'),
        sources: aggregateCreatePhaseSources(collectPhaseLineItems(row, 'uses')),
        financialConditions: collectPhaseFinancialConditions(row),
        financingLines: collectPhaseFinancingLines(lineRow),
        requirements: requirementsForCreatePhase(idx)
      };
    });
  }

  function validateCreateFinancePhases({ alertOnError = false } = {}) {
    const financial = currentCreateFinancialNumbers();
    const phases = collectFinancePhases();
    const usesTotal = phases.reduce((sum, phase) => (
      sum + phase.planUses.reduce((phaseSum, item) => phaseSum + numberFromCreate(item.amount), 0)
    ), 0);
    const bankTotal = phases.reduce((sum, phase) => sum + numberFromCreate(phase.planSources.find(item => item.name === 'Banco')?.amount), 0);
    const promoterTotal = phases.reduce((sum, phase) => sum + numberFromCreate(phase.planSources.find(item => item.name === 'Promotor')?.amount), 0);
    const close = (a, b) => Math.abs(numberFromCreate(a) - numberFromCreate(b)) <= 0.05;
    const fail = (message) => {
      if (alertOnError) alert(message);
      return false;
    };
    if (financial.total > 0 && phases.length && !close(usesTotal, financial.total)) {
      return fail(`La suma de usos por fase (${formatBankNumber(usesTotal)}) debe coincidir con el total del proyecto (${formatBankNumber(financial.total)}).`);
    }
    for (const phase of phases) {
      const hasPlannedAmounts = phase.planUses.some(use => numberFromCreate(use.amount) > 0);
      if (hasPlannedAmounts && (!phase.startDate || !phase.endDate)) return fail(`Indica el inicio y el fin previstos de ${phase.name}.`);
      if (phase.startDate && phase.endDate && new Date(phase.endDate).getTime() < new Date(phase.startDate).getTime()) {
        return fail(`En ${phase.name}, el fin previsto no puede ser anterior al inicio previsto.`);
      }
      for (const use of phase.planUses) {
        const allocated = (use.fundingSources || []).reduce((sum, source) => sum + numberFromCreate(source.amount), 0);
        if (!close(allocated, use.amount)) return fail(`En ${phase.name}, las fuentes del uso "${use.name || 'Sin nombre'}" deben sumar el importe del uso.`);
      }
      const uses = phase.planUses.reduce((a, item) => a + numberFromCreate(item.amount), 0);
      const sources = phase.planSources.reduce((a, item) => a + numberFromCreate(item.amount), 0);
      if (!close(uses, sources)) return fail(`En ${phase.name}, total usos (${formatBankNumber(uses)}) debe coincidir con total fuentes (${formatBankNumber(sources)}).`);
      const bankAmount = numberFromCreate(phase.financialConditions?.bankFinancedAmount);
      const financingLinesTotal = (phase.financingLines || []).reduce((sum, line) => sum + numberFromCreate(line.approvedAmount), 0);
      if (phase.financingLines.length && !close(financingLinesTotal, bankAmount)) {
        return fail(`En ${phase.name}, las lineas de financiacion (${formatBankNumber(financingLinesTotal)}) deben coincidir con la financiacion bancaria (${formatBankNumber(bankAmount)}).`);
      }
      if (phase.actualStartDate || phase.actualEndDate || phase.uses.length) {
        if (!phase.actualStartDate) return fail(`Indica el inicio real de ${phase.name}.`);
        if (phase.actualEndDate && new Date(phase.actualEndDate).getTime() < new Date(phase.actualStartDate).getTime()) {
          return fail(`En ${phase.name}, el fin real no puede ser anterior al inicio real.`);
        }
        for (const use of phase.uses) {
          const allocated = (use.fundingSources || []).reduce((sum, source) => sum + numberFromCreate(source.amount), 0);
          if (!close(allocated, use.amount)) return fail(`En ${phase.name}, las fuentes reales del uso "${use.name || 'Sin nombre'}" deben sumar el importe real.`);
        }
      }
    }
    return true;
  }

  document.getElementById('addCreateBoardMember')?.addEventListener('click', () => createBoardMembers?.insertAdjacentHTML('beforeend', createBoardMemberRow()));
  document.getElementById('addCreateShareholder')?.addEventListener('click', () => createShareholders?.insertAdjacentHTML('beforeend', createShareholderRow()));
  document.getElementById('addCreateHousingModel')?.addEventListener('click', () => {
    createHousingModels?.insertAdjacentHTML('beforeend', createHousingModelRow());
    bindBankNumberFormatting(createHousingModels || document);
    const row = createHousingModels?.lastElementChild;
    if (row) syncCreateUnitsPreview(row);
    syncTechnicalUnitsFromModels();
    refreshCreatePolicyUnitOptions();
  });
  document.getElementById('createArchitecturalPlans')?.addEventListener('change', event => {
    setCreateArchitecturalPlanFiles(event.target.files);
  });
  [createBoardMembers, createShareholders, createHousingModels].forEach(container => {
    container?.addEventListener('click', event => {
      event.target.closest('[data-remove-create-row]')?.closest('.create-repeat-row')?.remove();
      syncTechnicalUnitsFromModels();
      validateCreateModelStatuses();
      refreshCreatePolicyUnitOptions();
    });
  });
  createHousingModels?.addEventListener('input', event => {
    if (event.target?.matches?.('[data-create-unit]')) return;
      syncTechnicalUnitsFromModels();
    createHousingModels.querySelectorAll('[data-create-model-row]').forEach(row => {
      syncCreateModelStatusRow(row, { autoFill: true });
      syncCreateUnitsPreview(row);
    });
    refreshCreatePolicyUnitOptions();
  });
  createHousingModels?.addEventListener('change', event => {
    const unitStatus = event.target?.matches?.('[data-create-unit="estado"]') ? event.target : null;
    if (unitStatus) unitStatus.closest('[data-create-unit-row]')?.setAttribute('data-status-manual', '1');
  });
  createHousingModels?.addEventListener('input', event => {
    const unitLocation = event.target?.matches?.('[data-create-unit="ubicacion"]') ? event.target : null;
    if (unitLocation) unitLocation.closest('[data-create-unit-row]')?.setAttribute('data-location-manual', '1');
  });
  document.getElementById('td-phasesCount')?.addEventListener('input', syncCreateFinancePhases);
  document.getElementById('td-totalUnits')?.addEventListener('input', event => {
    const raw = String(event.target.value || '').trim();
    createTotalUnitsManuallyEdited = !!raw && numberFromCreate(raw) !== createLastSuggestedUnitsTotal;
    updateCreateUnitsReconciliation();
  });
  document.getElementById('pLocation')?.addEventListener('input', () => {
    createHousingModels?.querySelectorAll('[data-create-model-row]').forEach(row => syncCreateUnitsPreview(row));
  });
  createFinancePhases?.addEventListener('click', event => {
    const phaseRow = event.target.closest('[data-create-phase-row]');
    const viewBtn = event.target.closest('[data-create-phase-view]');
    if (phaseRow && viewBtn) {
      const view = viewBtn.dataset.createPhaseView;
      phaseRow.querySelectorAll('[data-create-phase-panel]').forEach(panel => { panel.hidden = panel.dataset.createPhasePanel !== view; });
      phaseRow.querySelectorAll('[data-create-phase-view]').forEach(button => {
        const active = button.dataset.createPhaseView === view;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      return;
    }
    const addUseBtn = event.target.closest('[data-add-create-use]');
    if (phaseRow && addUseBtn) {
      const kind = addUseBtn.dataset.addCreateUse;
      phaseRow.querySelector(`[data-create-uses-list="${kind}"]`)?.insertAdjacentHTML(
        'beforeend',
        createPhaseUseCards(kind, [{ name: '', amount: 0, fundingSources: CREATE_PHASE_SOURCE_NAMES.map(name => ({ name, amount: 0 })) }])
      );
      bindBankNumberFormatting(createFinancePhases);
      syncCreatePhaseSources();
      return;
    }
    const removeUseBtn = event.target.closest('[data-remove-create-use]');
    if (removeUseBtn) {
      removeUseBtn.closest('[data-create-use-kind]')?.remove();
      syncCreatePhaseSources();
      return;
    }
    const addSourceBtn = event.target.closest('[data-add-create-source]');
    if (addSourceBtn) {
      const useRow = addSourceBtn.closest('[data-create-use-kind]');
      useRow?.querySelector('[data-create-use-sources]')?.insertAdjacentHTML('beforeend', createPhaseSourceRow({}, numberFromCreate(useRow.querySelector('[data-create-use-amount]')?.value)));
      bindBankNumberFormatting(createFinancePhases);
      syncCreatePhaseSources();
      return;
    }
    const removeSourceBtn = event.target.closest('[data-remove-create-source]');
    if (removeSourceBtn) {
      removeSourceBtn.closest('[data-create-use-source]')?.remove();
      syncCreatePhaseSources();
      return;
    }
    const copyPlanBtn = event.target.closest('[data-copy-create-plan-to-real]');
    const copyRealBtn = event.target.closest('[data-copy-create-real-to-plan]');
    if (phaseRow && (copyPlanBtn || copyRealBtn)) {
      const sourceKind = copyPlanBtn ? 'planUses' : 'uses';
      const targetKind = copyPlanBtn ? 'uses' : 'planUses';
      const sourceUses = collectCreatePhaseUses(phaseRow, sourceKind);
      if (!sourceUses.length) return alert(`No hay datos en ${copyPlanBtn ? 'la estimación' : 'la realidad'} para copiar.`);
      if (copyRealBtn && !confirm('La estimación se reemplazará con una copia de la realidad actual. Úsalo solo para reconstruir la línea base de un proyecto ya iniciado. ¿Continuar?')) return;
      const target = phaseRow.querySelector(`[data-create-uses-list="${targetKind}"]`);
      if (target) target.innerHTML = createPhaseUseCards(targetKind, sourceUses.map(use => ({
        ...use,
        fundingSources: (use.fundingSources || []).map(source => ({ ...source }))
      })));
      if (copyPlanBtn) {
        if (!phaseRow.querySelector('[data-create-phase-financing-line]') && financingLinesFromPlannedUses(phaseRow).length) {
          generateCreateFinancingLines(phaseRow, { confirmReplace: false });
        }
      }
      bindBankNumberFormatting(createFinancePhases);
      syncCreatePhaseSources();
      return;
    }
    const generateLinesBtn = event.target.closest('[data-generate-create-financing-lines]');
    if (phaseRow && generateLinesBtn) {
      generateCreateFinancingLines(phaseRow);
      return;
    }
    const addFinancingBtn = event.target.closest('[data-add-phase-financing-line]');
    if (phaseRow && addFinancingBtn) {
      phaseRow.querySelector('[data-create-phase-financing-lines]')?.insertAdjacentHTML('beforeend', createPhaseFinancingLineCard({}));
      bindBankNumberFormatting(createFinancePhases);
      syncCreatePhaseSources();
      return;
    }
    const removeFinancingBtn = event.target.closest('[data-remove-phase-financing-line]');
    if (removeFinancingBtn) {
      removeFinancingBtn.closest('[data-create-phase-financing-line]')?.remove();
      syncCreatePhaseSources();
      return;
    }
    const requirementsBtn = event.target.closest('[data-open-create-requirements]');
    if (requirementsBtn) {
      openCreateRequirements(Number(requirementsBtn.dataset.openCreateRequirements));
      return;
    }
    const addBtn = event.target.closest('[data-add-create-phase-line]');
    if (!addBtn) return;
    const kind = addBtn.dataset.addCreatePhaseLine;
    const box = addBtn.closest('[data-create-phase-row]')?.querySelector(`[data-create-phase-lines-box="${kind}"]`);
    box?.insertAdjacentHTML('beforeend', `
      <div style="display:grid;grid-template-columns:1fr 140px;gap:8px;margin-bottom:6px;" data-create-phase-line="${kind}">
        <input data-create-phase-line-name placeholder="Concepto">
        <input data-create-phase-line-amount data-bank-number type="text" inputmode="decimal" placeholder="Monto">
      </div>
    `);
    bindBankNumberFormatting(createFinancePhases);
    syncCreatePhaseSources();
  });
  createFinancePhases?.addEventListener('input', event => {
    const useRow = event.target.closest?.('[data-create-use-kind]');
    const sourceRow = event.target.closest?.('[data-create-use-source]');
    if (useRow) {
      const useAmount = numberFromCreate(useRow.querySelector('[data-create-use-amount]')?.value);
      if (event.target.matches('[data-create-use-amount]')) {
        useRow.querySelectorAll('[data-create-use-source]').forEach(row => {
          const pct = numberFromCreate(row.querySelector('[data-create-source-pct]')?.value);
          const amount = row.querySelector('[data-create-source-amount]');
          if (amount) amount.value = formatBankNumber(useAmount * pct / 100);
        });
      } else if (sourceRow && event.target.matches('[data-create-source-pct]')) {
        const amount = sourceRow.querySelector('[data-create-source-amount]');
        if (amount) amount.value = formatBankNumber(useAmount * numberFromCreate(event.target.value) / 100);
      } else if (sourceRow && event.target.matches('[data-create-source-amount]')) {
        const pct = sourceRow.querySelector('[data-create-source-pct]');
        if (pct) pct.value = (useAmount ? numberFromCreate(event.target.value) / useAmount * 100 : 0).toFixed(2);
      }
    }
    const financialInput = event.target?.closest?.('[data-create-phase-financial]');
    if (financialInput) {
      syncPhaseFinancialTriplet(financialInput.closest('[data-create-phase-row]'), financialInput.dataset.createPhaseFinancial);
    }
    syncCreatePhaseSources();
  });
  createFinancePhases?.addEventListener('change', syncCreatePhaseSources);
  createFinancePhases?.addEventListener('keyup', syncCreatePhaseSources);
  createDatoUnicoFileInput?.addEventListener('change', async event => {
    const file = event.target.files?.[0] || null;
    if (!file) {
      clearCreateDatoUnicoFile();
      return;
    }
    const wasExcelMode = !!createDatoUnicoFileState;
    if (!wasExcelMode && hasManualInventoryData()) {
      const proceed = confirm('Ya has rellenado datos del inventario manual. Al usar el Excel, esos modelos y unidades no se enviarán. ¿Quieres cambiar al modo Excel?');
      if (!proceed) {
        event.target.value = '';
        return;
      }
    }
    if (!wasExcelMode) createManualTotalUnitsSnapshot = String(document.getElementById('td-totalUnits')?.value || '');
    createDatoUnicoFileState = file;
    updateCreateDatoUnicoMode();
    await loadCreateDatoUnicoPreview(file);
  });
  clearCreateDatoUnicoFileBtn?.addEventListener('click', clearCreateDatoUnicoFile);
  document.addEventListener('input', event => {
    if (event.target?.matches?.('[data-create-phase-line-amount], [data-create-phase-line-name]')) syncCreatePhaseSources();
  }, true);

  // Nuevo contenedor de roles (tu HTML final lo trae)
  const assigneesContainer = document.getElementById('assigneesContainer');

  // (Legacy ocultos por si existen; no los usamos si hay contenedor nuevo)
  const selPromotersLegacy = document.getElementById('pPromoters');
  const selCommercialsLegacy = document.getElementById('pCommercials');

  // Cache por rol para no pegarle al server 10 veces si abres/cierra modal
  const assigneesCache = new Map(); // role -> users[]
  const selectsByRole = new Map();  // role -> selectEl

  async function fetchAssignees(roleName) {
    if (assigneesCache.has(roleName)) return assigneesCache.get(roleName);
    const data = await API.get(`/api/projects/assignees?role=${encodeURIComponent(roleName)}`);
    const list = (data && data.users) || [];
    assigneesCache.set(roleName, list);
    return list;
  }

  function buildRoleBlock(roleName, users) {
    // Estructura compatible con tu CSS (role-block / role-search / role-select)
    const block = document.createElement('div');
    block.className = 'role-block';

    const title = document.createElement('div');
    title.className = 'role-title';
    title.textContent = roleName.toUpperCase() + (roleName === 'promoter' ? ' (OBLIGATORIO)' : '');

    const search = document.createElement('input');
    search.className = 'role-search';
    search.type = 'search';
    search.placeholder = `Buscar ${roleName}...`;
    search.autocomplete = 'off';

    const select = document.createElement('select');
    select.className = 'role-select';
    select.multiple = true;
    select.size = 6;

    select.innerHTML = '';
    if (!users || !users.length) {
      const opt = document.createElement('option');
      opt.disabled = true;
      opt.textContent = `No hay ${roleName}s activos`;
      select.appendChild(opt);
    } else {
      users.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u._id;
        opt.textContent = `${u.name || '(sin nombre)'} — ${u.email || ''}`.trim();
        select.appendChild(opt);
      });
    }

    // Filtro por buscador
    const doFilter = () => {
      const q = norm(search.value);
      Array.from(select.options).forEach(o => {
        if (o.disabled) return;
        if (!q) { o.hidden = false; return; }
        o.hidden = !norm(o.textContent).includes(q);
      });
    };
    search.addEventListener('input', debounce(doFilter, 100));

    block.appendChild(title);
    block.appendChild(search);
    block.appendChild(select);

    selectsByRole.set(roleName, select);
    return block;
  }

  async function loadAllRoleAssignees() {
    if (!assigneesContainer) return;

    assigneesContainer.innerHTML = '';
    selectsByRole.clear();

    for (const r of ASSIGNABLE_ROLES) {
      // bloque "cargando"
      const loading = document.createElement('div');
      loading.className = 'role-block';
      loading.innerHTML = `<div class="role-title">${r.toUpperCase()}</div><div class="muted">Cargando...</div>`;
      assigneesContainer.appendChild(loading);

      try {
        const users = await fetchAssignees(r);
        const block = buildRoleBlock(r, users);
        assigneesContainer.replaceChild(block, loading);
      } catch (e) {
        loading.innerHTML = `<div class="role-title">${r.toUpperCase()}</div><div class="muted">Error al cargar</div>`;
      }
    }
  }

  function getSelectedValues(selectEl) {
    return Array.from(selectEl?.selectedOptions || []).map(o => o.value);
  }

  function splitSuggestions(value) {
    return String(value || '')
      .split(/\r?\n|,/)
      .map(x => x.trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  function collectTeamSuggestion() {
    const roles = ['promoter','commercial','legal','tecnico','gerencia','socios','financiero','contable'];
    const out = {};
    roles.forEach(r => {
      out[r] = splitSuggestions(document.getElementById(`ts-${r}`)?.value);
    });
    out.notes = document.getElementById('ts-notes')?.value?.trim() || '';
    return out;
  }

  const openModal = async () => {
    if (!modal) return;
    if (role === 'promoter') {
      const profileData = await loadPromoterProfile();
      const completion = profileData?.promoterProfileCompletion || promoterProfileState?.promoterProfileCompletion || {};
      if (completion.sufficient !== true) {
        showPromoterProfileRequired(completion);
        return;
      }
    }
    modal.classList.remove('is-fullscreen');
    if (btnExpandCreate) { btnExpandCreate.textContent = '⛶'; btnExpandCreate.title = 'Pantalla completa'; }
    modal.classList.add('show');
    setCreateStep('general');
    if (createBoardMembers && !createBoardMembers.children.length) createBoardMembers.insertAdjacentHTML('beforeend', createBoardMemberRow());
    if (createShareholders && !createShareholders.children.length) createShareholders.insertAdjacentHTML('beforeend', createShareholderRow());
    if (createHousingModels && !createHousingModels.children.length) createHousingModels.insertAdjacentHTML('beforeend', createHousingModelRow());
    bindBankNumberFormatting(modal);
    bindBankChoices(modal);
    createHousingModels?.querySelectorAll('[data-create-model-row]').forEach(row => syncCreateUnitsPreview(row));
    syncTechnicalUnitsFromModels();
    updateCreateDatoUnicoMode();
    hideGlobalCreateFinancialConditionFields();
    await loadCreatePromoterProfiles();
    if (role === 'promoter') {
      populateCreatePromoterCompanies(promoterProfileState?.promoterProfile || {}, document.getElementById('ld-promoterLegalName')?.value);
    } else {
      const selectedUser = createPromoterProfiles.get(String(document.getElementById('ld-promoterProfileSelect')?.value || ''));
      populateCreatePromoterCompanies(selectedUser?.promoterProfile || {}, document.getElementById('ld-promoterLegalName')?.value);
    }
    syncCreateTrustNameVisibility();
    await loadCreateDatoUnicoTemplate();
    await loadCreateProgressChecks();
    await loadCreatePermitTemplates();
    renderCreatePermitItems();
    scheduleCreateStepCompletion();

    // Modo nuevo (todos los roles)
    // Por privacidad, la creacion no carga ni muestra directorios de usuarios.

    // Fallback legacy (por si falta el contenedor por cualquier razón)
    if (!assigneesContainer && selPromotersLegacy) {
      selPromotersLegacy.innerHTML = `<option>Cargando...</option>`;
      try {
        const data = await API.get(`/api/projects/assignees?role=promoter`);
        const list = (data && data.users) || [];
        selPromotersLegacy.innerHTML = '';
        if (!list.length) {
          selPromotersLegacy.innerHTML = `<option disabled>No hay promoters activos</option>`;
        } else {
          list.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u._id;
            opt.textContent = `${u.name || '(sin nombre)'} — ${u.email}`;
            selPromotersLegacy.appendChild(opt);
          });
        }
      } catch (e) {
        selPromotersLegacy.innerHTML = `<option disabled>Error al cargar promoters</option>`;
      }
    }

    if (!assigneesContainer && selCommercialsLegacy) {
      selCommercialsLegacy.innerHTML = `<option>Cargando...</option>`;
      try {
        const data = await API.get(`/api/projects/assignees?role=commercial`);
        const list = (data && data.users) || [];
        selCommercialsLegacy.innerHTML = '';
        if (!list.length) {
          selCommercialsLegacy.innerHTML = `<option disabled>No hay commercials activos</option>`;
        } else {
          list.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u._id;
            opt.textContent = `${u.name || '(sin nombre)'} — ${u.email}`;
            selCommercialsLegacy.appendChild(opt);
          });
        }
      } catch (e) {
        selCommercialsLegacy.innerHTML = `<option disabled>Error al cargar commercials</option>`;
      }
    }
  };

  const closeModal = () => {
    if (!modal) return;
    modal.classList.remove('is-fullscreen');
    modal.classList.remove('show');
  };

  if (CAN_CREATE) {
    if (fab) fab.style.display = '';
    if (fab) fab.addEventListener('click', openModal);
    container?.addEventListener('click', event => {
      if (event.target.closest('[data-create-project-placeholder]')) openModal();
    });
    if (btnCancel) btnCancel.addEventListener('click', closeModal);
    if (btnCloseCreate) btnCloseCreate.addEventListener('click', closeModal);
    document.getElementById('createPermitTemplate')?.addEventListener('change', renderCreatePermitItems);
    document.getElementById('downloadCreateDatoUnicoTemplate')?.addEventListener('click', downloadCreateDatoUnicoTemplate);
    document.getElementById('ld-promoterProfileSelect')?.addEventListener('change', ev => {
      const user = createPromoterProfiles.get(String(ev.target.value || ''));
      if (ev.target.value === '__manual__') {
        const promoterName = document.getElementById('ld-manualPromoterName');
        const legalName = document.getElementById('ld-promoterLegalName');
        const ruc = document.getElementById('ld-promoterRuc');
        if (promoterName) promoterName.value = '';
        if (legalName) legalName.value = '';
        if (ruc) ruc.value = '';
        if (createShareholders) createShareholders.innerHTML = '';
      }
      populateCreatePromoterCompanies(user?.promoterProfile || {});
      createRequirementPromoterOriginal = JSON.parse(JSON.stringify(user?.promoterProfile || {}));
      createRequirementPromoterDraft = JSON.parse(JSON.stringify(user?.promoterProfile || {}));
    });
    document.getElementById('ld-promoterCompanySelect')?.addEventListener('change', syncCreateCompanyLegalData);
    document.getElementById('ld-trustApplies')?.addEventListener('change', syncCreateTrustNameVisibility);
    if (btnExpandCreate) btnExpandCreate.addEventListener('click', () => {
      modal.classList.toggle('is-fullscreen');
      const full = modal.classList.contains('is-fullscreen');
      btnExpandCreate.textContent = full ? '□' : '⛶';
      btnExpandCreate.title = full ? 'Restaurar tamaño' : 'Pantalla completa';
    });

    if (btnCreate) {
      btnCreate.addEventListener('click', async () => {
        if (isCreatingProject || btnCreate.disabled) return;
        isCreatingProject = true;
        btnCreate.disabled = true;
        const originalCreateText = btnCreate.textContent;
        btnCreate.textContent = 'Creando...';
        let creationWarning = '';
        try {
          const name = document.getElementById('pName')?.value?.trim() || '';
          const description = document.getElementById('pDesc')?.value?.trim() || '';
          const location = document.getElementById('pLocation')?.value?.trim() || '';
          const status = document.getElementById('pStatus')?.value || 'EN_CURSO';
          const projectType = document.getElementById('pProjectType')?.value || '';
          const seeksFinancing = fundingModuleEnabled && document.getElementById('pSeeksFinancing')?.value === 'true';
          const fundingDeadline = document.getElementById('pFundingDeadline')?.value || '';
          const fundingRequestedAmount = numberFromCreate(document.getElementById('fundingRequestedAmount')?.value);
          const fundingSecuredAmount = numberFromCreate(document.getElementById('fundingSecuredAmount')?.value);
          const fundingRequestError = document.getElementById('createFundingRequestError');
          const fundingDeadlineError = document.getElementById('pFundingDeadlineError');
          if (fundingRequestError) fundingRequestError.style.display = 'none';
          if (fundingDeadlineError) fundingDeadlineError.style.display = 'none';
          if (seeksFinancing && !fundingDeadline) {
            if (fundingDeadlineError) {
              fundingDeadlineError.textContent = 'Indica la fecha límite para completar la financiación.';
              fundingDeadlineError.style.display = '';
            }
            setCreateStep('general');
            document.getElementById('pFundingDeadline')?.focus();
            return;
          }
          if (seeksFinancing && (!fundingRequestedAmount || fundingSecuredAmount > fundingRequestedAmount)) {
            if (fundingRequestError) {
              fundingRequestError.textContent = !fundingRequestedAmount
                ? 'Indica un monto exacto solicitado mayor que cero.'
                : 'Los fondos asegurados no pueden superar el monto solicitado.';
              fundingRequestError.style.display = '';
            }
            setCreateStep('financial');
            document.getElementById('fundingRequestedAmount')?.focus();
            return;
          }
          const coverFile = document.getElementById('pCoverImage')?.files?.[0];
          let coverPath = '';
          if (coverFile) {
            if (!['image/jpeg','image/png','image/webp'].includes(coverFile.type) || coverFile.size > 5 * 1024 * 1024) return alert('La portada debe ser JPG, PNG o WebP y no superar 5 MB.');
            coverPath = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = reject; reader.readAsDataURL(coverFile); });
          }

          // (Estos inputs no están en tu HTML actual, pero lo mantengo sin romper)
          const kLoan = document.getElementById('kLoanApproved');
          const kBudg = document.getElementById('kBudgetApproved');
          const loanApproved = kLoan ? Number(kLoan.value || 0) : 0;
          const budgetApproved = kBudg ? Number(kBudg.value || 0) : 0;

          if (!validateBankNumberInputs(modal || document)) return;
          syncFinancialTriplet('fc-projectTotal');
          const conditionNumbers = ['projectTotal'];
          const conditionTexts = [];
          const financialConditions = {};
          conditionNumbers.forEach(key => {
            const raw = document.getElementById(`fc-${key}`)?.value;
            if (raw !== '' && raw != null && Number.isFinite(numberFromCreate(raw))) financialConditions[key] = numberFromCreate(raw);
          });
          conditionTexts.forEach(key => {
            financialConditions[key] = document.getElementById(`fc-${key}`)?.value?.trim() || '';
          });
          financialConditions.facilities = [];
          if (!name) return alert('El nombre es obligatorio.');
          if (hasCreateDatoUnicoFile() && createDatoUnicoPreviewState?.valid !== true) {
            setCreateStep('technical');
            return alert(createDatoUnicoPreviewState?.error || 'Espera a que termine la validación del Excel y corrige los errores antes de crear el proyecto.');
          }
          if (!hasCreateDatoUnicoFile() && String(document.getElementById('td-totalUnits')?.value || '').trim() !== '' && !updateCreateUnitsReconciliation()) {
            setCreateStep('technical');
            document.getElementById('td-totalUnits')?.focus();
            return alert('La suma de unidades de todos los modelos debe coincidir con la cantidad total de unidades.');
          }
          if (!validateCreateModelStatuses({ alertOnError: true })) return;
          if (!validateCreateFinancePhases({ alertOnError: true })) return;
          const projectTotal = numberFromCreate(document.getElementById('fc-projectTotal')?.value);
          if (seeksFinancing && fundingRequestedAmount > projectTotal) {
            if (fundingRequestError) {
              fundingRequestError.textContent = 'El monto solicitado no puede superar el coste total.';
              fundingRequestError.style.display = '';
            }
            setCreateStep('financial');
            document.getElementById('fundingRequestedAmount')?.focus();
            return;
          }
          const collectedLegalData = collectLegalData();
          const legalData = createRequirementLegalDraft ? {
            ...collectedLegalData,
            shareholders: collectedLegalData.promoterEntryMode === 'registered'
              ? collectedLegalData.shareholders
              : (createRequirementLegalDraft.shareholders || collectedLegalData.shareholders),
            boardMembers: createRequirementLegalDraft.boardMembers || collectedLegalData.boardMembers
          } : collectedLegalData;
          if (legalData.promoterEntryMode === 'manual' && !legalData.promoterName) {
            alert('Indica el nombre del promotor.');
            setCreateStep('legal');
            document.getElementById('ld-manualPromoterName')?.focus();
            return;
          }
          if (!legalData.promoterLegalName) {
            alert(legalData.promoterEntryMode === 'manual' ? 'Indica la sociedad promotora.' : 'Selecciona la sociedad promotora del proyecto. Si no aparece, añádela primero al perfil del promotor.');
            setCreateStep('legal');
            (legalData.promoterEntryMode === 'manual' ? document.getElementById('ld-promoterLegalName') : document.getElementById('ld-promoterCompanySelect'))?.focus();
            return;
          }
          if (!legalData.promoterRuc) {
            alert('Indica el RUC de la sociedad promotora.');
            setCreateStep('legal');
            document.getElementById('ld-promoterRuc')?.focus();
            return;
          }
          if (!legalData.shareholders.length || legalData.shareholders.some(item => !item.name || !item.cedula || !(item.percentage > 0) || item.percentage > 100)) {
            alert('Completa nombre, cédula y porcentaje de todos los accionistas.');
            setCreateStep('legal');
            return;
          }
          const shareholderTotal = legalData.shareholders.reduce((sum, item) => sum + Number(item.percentage || 0), 0);
          if (Math.abs(shareholderTotal - 100) > 0.001) {
            alert('Los porcentajes de los accionistas deben sumar 100%.');
            setCreateStep('legal');
            return;
          }
          const selectedPromoterIdRaw = String(document.getElementById('ld-promoterProfileSelect')?.value || '');
          const selectedPromoterId = selectedPromoterIdRaw === '__manual__' ? '' : selectedPromoterIdRaw;
          const promoterExperienceValues = createRequirementPromoterDraft
            ? Object.fromEntries(REQUIREMENT_PROMOTER_FIELDS.map(([key]) => [key, createRequirementPromoterDraft[key]]))
            : null;
          const promoterExperienceChanged = promoterExperienceValues && REQUIREMENT_PROMOTER_FIELDS.some(([key]) =>
            JSON.stringify(promoterExperienceValues[key] ?? null) !== JSON.stringify(createRequirementPromoterOriginal?.[key] ?? null)
          );
          const promoterExperienceConflicts = promoterExperienceChanged && REQUIREMENT_PROMOTER_FIELDS.some(([key]) => {
            const before = createRequirementPromoterOriginal?.[key];
            const after = promoterExperienceValues[key];
            const hadValue = Array.isArray(before) ? before.length > 0 : before !== null && before !== undefined && String(before).trim() !== '';
            return hadValue && JSON.stringify(before) !== JSON.stringify(after);
          });
          if (promoterExperienceConflicts && !confirm('Has modificado datos de experiencia que ya existían en el perfil del promotor. ¿Quieres actualizar también el perfil original?')) return;
          const importFile = createDatoUnicoFileState;
          const checklistFiles = Array.from(document.querySelectorAll('[data-create-checklist-file]'))
            .flatMap(input => Array.from(input.files || []).map(file => ({ key: input.dataset.createChecklistFile, file })))
            .filter(item => item.key && item.file);
          const insurancePoliciesWithFiles = collectCreateInsurancePolicies({ includeFiles: true });

          const payload = {
            name,
            description,
            descripcion: description,
            location,
            projectType,
            coverImage: coverPath ? { path: coverPath, originalname: coverFile.name, mimetype: coverFile.type } : undefined,
            seeksFinancing,
            fundingRequestedAmount: seeksFinancing ? fundingRequestedAmount : undefined,
            fundingSecuredAmount: seeksFinancing ? fundingSecuredAmount : undefined,
            fundingDeadline: seeksFinancing ? fundingDeadline : undefined,
            status,
            loanApproved,
            budgetApproved,
            legalData,
            legalCompanyName: legalData.promoterLegalName,
            technicalData: collectTechnicalData(),
            housingModels: collectHousingModels(),
            initialUnits: collectInitialUnits(),
            financePhases: collectFinancePhases(),
            financialConditions,
            assignedPromoters: selectedPromoterId ? [selectedPromoterId] : undefined,
            teamSuggestion: collectTeamSuggestion(),
            ...collectInitialProgress()
          };

          const createdProject = await API.post('/api/projects', payload);
          if (createdProject?._id && promoterExperienceChanged) {
            try {
              await API.put(`/api/projects/${createdProject._id}/finance/promoter-experience`, {
                base: Object.fromEntries(REQUIREMENT_PROMOTER_FIELDS.map(([key]) => [key, createRequirementPromoterOriginal?.[key]])),
                values: promoterExperienceValues,
                allowOverwrite: Boolean(promoterExperienceConflicts)
              });
            } catch (profileErr) {
              console.error(profileErr);
              alert('Proyecto creado, pero no se pudo actualizar la experiencia en el perfil del promotor.');
            }
          }
          if (createdProject?._id && checklistFiles.length) {
            const checklistIds = createdProject.initialChecklistIds || {};
            const uploadFailures = [];
            for (const item of checklistFiles) {
              const checklistId = checklistIds[item.key];
              if (!checklistId) {
                uploadFailures.push(item.file.name);
                continue;
              }
              const fd = new FormData();
              fd.append('files', item.file);
              fd.append('projectId', createdProject._id);
              fd.append('checklistId', checklistId);
              try {
                await API.upload('/api/documents/upload', fd);
              } catch (uploadErr) {
                console.error(uploadErr);
                uploadFailures.push(item.file.name);
              }
            }
            if (uploadFailures.length) alert(`Proyecto creado, pero no se pudieron adjuntar: ${uploadFailures.join(', ')}.`);
          }
          if (createdProject?._id && createArchitecturalPlanFilesState.length) {
            const uploadFailures = [];
            for (const file of createArchitecturalPlanFilesState) {
              const fd = new FormData();
              fd.append('files', file);
              fd.append('projectId', createdProject._id);
              fd.append('category', 'architecturalPlans');
              fd.append('folder', 'tecnico');
              try { await API.upload('/api/documents/upload?category=architecturalPlans', fd); }
              catch (uploadErr) { console.error(uploadErr); uploadFailures.push(file.name); }
            }
            if (uploadFailures.length) alert(`Proyecto creado, pero no se pudieron adjuntar estos planos: ${uploadFailures.join(', ')}.`);
          }
          if (createdProject?._id && insurancePoliciesWithFiles.length) {
            const savedPolicies = [];
            const uploadFailures = [];
            for (const sourcePolicy of insurancePoliciesWithFiles) {
              const { __file, ...policy } = sourcePolicy;
              if (__file) {
                const fd = new FormData();
                fd.append('files', __file);
                fd.append('projectId', createdProject._id);
                fd.append('category', 'insurancePolicy');
                fd.append('folder', 'tecnico');
                try {
                  const uploaded = await API.upload('/api/documents/upload?category=insurancePolicy', fd);
                  const document = Array.isArray(uploaded) ? uploaded[0] : uploaded;
                  policy.documentId = document?._id || null;
                  policy.documentName = document?.originalname || __file.name;
                } catch (uploadErr) {
                  console.error(uploadErr);
                  uploadFailures.push(__file.name);
                }
              }
              savedPolicies.push(policy);
            }
            try {
              await API.put(`/api/projects/${createdProject._id}/insurance-policies`, { insurancePolicies: savedPolicies });
            } catch (policyErr) {
              console.error(policyErr);
              alert('Proyecto creado, pero no se pudieron guardar las pólizas.');
            }
            if (uploadFailures.length) alert(`Proyecto creado, pero no se pudieron adjuntar estas pólizas: ${uploadFailures.join(', ')}.`);
          }
          if (createdProject?._id && createRequirementFilesState.size) {
            const requirementIds = createdProject.initialRequirementIds || {};
            const phaseIds = createdProject.initialFinancePhaseIds || {};
            const uploadFailures = [];
            for (const [key, files] of createRequirementFilesState.entries()) {
              const [phaseIndex] = key.split(':');
              const requirementId = requirementIds[key];
              const financePhaseId = phaseIds[phaseIndex];
              for (const file of files) {
                if (!requirementId || !financePhaseId) { uploadFailures.push(file.name); continue; }
                const fd = new FormData();
                fd.append('files', file);
                fd.append('projectId', createdProject._id);
                fd.append('requirementId', requirementId);
                fd.append('financePhaseId', financePhaseId);
                fd.append('category', 'financeRequirement');
                fd.append('folder', 'financiero');
                try { await API.upload('/api/documents/upload?category=financeRequirement', fd); }
                catch (uploadErr) { console.error(uploadErr); uploadFailures.push(file.name); }
              }
            }
            if (uploadFailures.length) alert(`Proyecto creado, pero no se pudieron adjuntar estos documentos de requisitos: ${uploadFailures.join(', ')}.`);
          }
          if (importFile && createdProject?._id) {
            const fd = new FormData();
            fd.append('file', importFile);
            fd.append('importMode', 'create');
            fd.append('models', JSON.stringify(collectCreateDatoUnicoModels()));
            try {
              await API.upload(`/api/projects/${createdProject._id}/import-dato-unico`, fd);
              createDatoUnicoFileState = null;
              createDatoUnicoPreviewState = null;
            } catch (importErr) {
              console.error(importErr);
              creationWarning = 'El proyecto se creó, pero no se pudo importar el Excel Dato Único. Puedes reintentar la importación desde Comercial.';
            }
          }

          closeModal();

          // reset campos
          ['pName', 'pDesc', 'pLocation', 'pProjectType', 'pCoverImage', 'pFundingDeadline', 'ld-promoterProfileSelect', 'kLoanApproved', 'kBudgetApproved', 'ts-promoter', 'ts-commercial', 'ts-legal', 'ts-tecnico', 'ts-gerencia', 'ts-socios', 'ts-financiero', 'ts-contable', 'ts-notes', 'fundingRequestedAmount', 'fundingSecuredAmount', ...conditionNumbers.map(x => `fc-${x}`), ...conditionTexts.map(x => `fc-${x}`)].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
          });

          const st = document.getElementById('pStatus');
          if (st) st.value = 'EN_CURSO';
          if (createFacilities) createFacilities.innerHTML = '';
          if (createBoardMembers) createBoardMembers.innerHTML = '';
          if (createShareholders) createShareholders.innerHTML = '';
          if (createHousingModels) createHousingModels.innerHTML = '';
          const createInsurancePolicies = document.getElementById('createInsurancePolicies');
          if (createInsurancePolicies) createInsurancePolicies.innerHTML = '';
          if (createFinancePhases) createFinancePhases.innerHTML = '';
          createPhaseRequirementsState.clear();
          createRequirementFilesState.clear();
          setCreateArchitecturalPlanFiles([]);
          createRequirementPromoterDraft = null;
          createRequirementPromoterOriginal = null;
          createRequirementLegalDraft = null;
          createTotalUnitsManuallyEdited = false;
          createLastSuggestedUnitsTotal = 0;
          document.querySelectorAll('[data-create-precedent]').forEach(input => { input.checked = false; });
          document.querySelectorAll('[data-legal-assessment],[data-technical-assessment]').forEach(input => { input.value = ''; });
          document.querySelectorAll('[data-create-checklist-key]').forEach(input => { input.checked = false; });
          document.querySelectorAll('[data-create-checklist-file]').forEach(input => {
            input.value = '';
            const upload = input.closest('.create-checklist-upload');
            upload?.classList.remove('has-files');
            const name = upload?.querySelector('[data-create-checklist-file-name]');
            if (name) name.textContent = 'Sin archivos';
          });
          const architecturalPlansInput = document.getElementById('createArchitecturalPlans');
          if (architecturalPlansInput) architecturalPlansInput.value = '';
          const createPermitTemplate = document.getElementById('createPermitTemplate');
          if (createPermitTemplate) createPermitTemplate.value = '';
          renderCreatePermitItems();
          ['fc-otherRequirements','fc-trustee','fc-trustType','fc-technicalInspector','fc-financialInspector','ld-promoterLegalName','ld-trustName','td-phasesCount','td-totalUnits','td-notes'].forEach(fieldId => {
            const field = document.getElementById(fieldId); if (field) field.value = '';
          });
          createManualTotalUnitsSnapshot = '';
          clearCreateDatoUnicoFile();
          const trustApplies = document.getElementById('ld-trustApplies');
          if (trustApplies) trustApplies.value = 'false';
          syncCreateTrustNameVisibility();
          const seeks = document.getElementById('pSeeksFinancing'); if (seeks) seeks.value = 'false';
          const secured = document.getElementById('fundingSecuredAmount'); if (secured) secured.value = '0';
          syncCreateFundingRequestVisibility();
          setCreateStep('general');

          // reset selects
          if (assigneesContainer) {
            for (const r of ASSIGNABLE_ROLES) {
              const sel = selectsByRole.get(r);
              if (sel) sel.selectedIndex = -1;
            }
          } else {
            if (selPromotersLegacy) selPromotersLegacy.selectedIndex = -1;
            if (selCommercialsLegacy) selCommercialsLegacy.selectedIndex = -1;
          }

          alert(creationWarning || 'Proyecto enviado a revisión del administrador. Aparecerá aquí cuando sea aprobado.');
          await loadList();
        } catch (e) {
          alert('Error al crear proyecto: ' + (e.message || e));
        } finally {
          isCreatingProject = false;
          btnCreate.disabled = false;
          btnCreate.textContent = originalCreateText || 'Crear';
        }
      });
    }

    if (new URLSearchParams(location.search).get('create') === '1') {
      setTimeout(() => { openModal(); }, 0);
    }
  } else {
    // 🔒 otros roles: quitar FAB y modal
    if (fab && fab.parentNode) fab.parentNode.removeChild(fab);
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
  }

  document.getElementById('fundingOpportunityCards')?.addEventListener('click', async ev => {
    if (!fundingModuleEnabled) return;
    const btn = ev.target.closest('[data-funding-opportunity]'); if (!btn) return;
    const opportunityId = btn.dataset.fundingOpportunity;
    document.getElementById('fundingOpportunityModal')?.remove();
    const wrap = document.createElement('div'); wrap.id = 'fundingOpportunityModal'; wrap.className = 'modal-backdrop show';
    wrap.innerHTML = `<div class="modal create-modal funding-detail-modal funding-detail-loading"><button class="modal-close" type="button" data-close-funding aria-label="Cerrar">×</button><div class="funding-detail-loading-body"><span class="funding-detail-spinner" aria-hidden="true"></span><strong>Preparando la oferta completa</strong><span>Estamos cargando el expediente, el inventario y la documentación publicada.</span></div></div>`;
    document.body.appendChild(wrap);
    wrap.querySelector('[data-close-funding]')?.addEventListener('click', () => wrap.remove());
    wrap.addEventListener('click', event => { if (event.target === wrap) wrap.remove(); });
    const originalButtonText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Abriendo oferta…';
    let item;
    try {
      item = await getFundingOpportunityDetail(opportunityId);
    } catch (error) {
      wrap.innerHTML = `<div class="modal profile-required-modal"><div class="profile-required-body"><div class="profile-required-icon" aria-hidden="true">!</div><h3>No se pudo abrir la oferta</h3><p>${escapeHtml(error.message || 'No se pudo cargar el detalle de la oportunidad.')}</p></div><div class="profile-required-actions"><button class="btn" type="button" data-close-funding>Cerrar</button></div></div>`;
      wrap.querySelector('[data-close-funding]')?.addEventListener('click', () => wrap.remove());
      return;
    } finally {
      btn.disabled = false;
      btn.textContent = originalButtonText;
    }
    const currency = escapeHtml(item.currency || 'PAB');
    const moneyLabel = value => `${Number(value || 0).toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${currency}`;
    const requestCoverage = Math.max(0, Math.min(100, Number(item.requestCoveredPct || 0)));
    const presalesPct = Math.max(0, Math.min(100, Number(item.presalesPct || 0)));
    const modelNames = (item.housingModels || []).map(model => escapeHtml(model.name)).filter(Boolean);
    const phaseNames = (item.phases || []).map(phase => escapeHtml(phase.name)).filter(Boolean);
    wrap.innerHTML = `<div class="modal create-modal funding-detail-modal"><button class="modal-close" type="button" data-close-funding aria-label="Cerrar">×</button><div class="funding-detail-scroll">
      <section class="funding-detail-top">
        <div class="funding-detail-hero">
          <img src="${escapeHtml(item.coverImage?.path || DEFAULT_PROJECT_COVER)}" alt="Portada de ${escapeHtml(item.name || 'proyecto')}">
          <div class="funding-detail-hero-content">
            <div class="funding-detail-badges"><span class="funding-detail-badge">${escapeHtml(item.projectType || 'Proyecto inmobiliario')}</span><span class="funding-detail-badge">Oportunidad Bank73</span></div>
            <h2>${escapeHtml(item.name || 'Oportunidad de financiación')}</h2>
            <p class="funding-detail-location">${escapeHtml(item.location || 'Ubicación general no publicada')}</p>
          </div>
        </div>
        <aside class="funding-detail-summary">
          <span class="funding-detail-summary-kicker">Resumen de la solicitud</span><h3>Financiación requerida</h3>
          <div class="funding-detail-request"><span>Monto solicitado</span><strong>${moneyLabel(item.requestedAmount)}</strong></div>
          <div class="funding-detail-summary-grid">
            <div class="funding-detail-summary-row"><span>Fondos asegurados</span><strong>${moneyLabel(item.securedRequestAmount)}</strong></div>
            <div class="funding-detail-summary-row"><span>Pendiente de financiar</span><strong>${moneyLabel(item.requestPendingAmount)}</strong></div>
            <div class="funding-detail-summary-row"><span>Coste total del proyecto</span><strong>${moneyLabel(item.totalCost)}</strong></div>
            <div class="funding-detail-summary-row"><span>Venta potencial inventario</span><strong>${moneyLabel(item.potentialSalesValue)}</strong></div>
            <div class="funding-detail-summary-row"><span>Fecha límite</span><strong>${escapeHtml(fundingDeadlineLabel(item.fundingDeadline, item.estimatedTerm))}</strong></div>
            <div class="funding-detail-summary-row"><span>Scoring Bank73</span><strong>${Number(item.finalScore || 0).toFixed(1)} / 100</strong></div>
          </div>
          <div class="funding-opportunity-coverage"><div class="funding-opportunity-coverage-head"><span>Cobertura de la solicitud</span><strong>${Math.round(requestCoverage)}%</strong></div><div class="progress funding-opportunity-progress"><div style="width:${requestCoverage}%"></div></div></div>
          <div class="funding-opportunity-coverage is-presales"><div class="funding-opportunity-coverage-head"><span>Avance de preventas</span><strong>${Number(item.unitsSold || 0)}/${Number(item.unitsTotal || 0)} (${Math.round(presalesPct)}%)</strong></div><div class="progress funding-opportunity-progress is-presales"><div style="width:${presalesPct}%"></div></div></div>
        </aside>
      </section>
      <div class="funding-detail-main">
        <main class="funding-detail-column">
          <section class="funding-detail-section"><h3>Descripción del proyecto</h3><p>${escapeHtml(item.description || 'La descripción detallada no se ha incluido en la información pública de esta oportunidad.')}</p>
            <div class="funding-detail-kpis"><div class="funding-detail-kpi"><span>Inventario</span><strong>${Number(item.unitsTotal || 0)} unidades</strong></div><div class="funding-detail-kpi"><span>Preventas</span><strong>${Number(item.unitsSold || 0)} unidades</strong></div><div class="funding-detail-kpi"><span>Valor potencial de venta</span><strong>${moneyLabel(item.potentialSalesValue)}</strong></div></div>
          </section>
          <section class="funding-detail-section"><h3>Cómo se formaliza la financiación</h3><p>Proceso orientativo coordinado por Bank73. Los hitos y condiciones definitivos dependerán del análisis del expediente y de la entidad financiadora.</p><div class="funding-process-list">
            <div class="funding-process-step"><div><strong>Manifestación de interés</strong><span>El banco indica el importe que estudiaría y designa a las personas responsables.</span></div></div>
            <div class="funding-process-step"><div><strong>Revisión inicial de Bank73</strong><span>Validación del encaje de la propuesta, documentación disponible y alcance de la solicitud.</span></div></div>
            <div class="funding-process-step"><div><strong>Análisis financiero y de riesgos</strong><span>Revisión económica, comercial, jurídica, urbanística y técnica; pueden solicitarse aclaraciones o documentación adicional.</span></div></div>
            <div class="funding-process-step"><div><strong>Carta de condiciones</strong><span>La entidad define importe, plazo, garantías, desembolsos, amortización y condiciones precedentes.</span></div></div>
            <div class="funding-process-step"><div><strong>Contratos, garantías y notaría</strong><span>Formalización contractual y, cuando corresponda, constitución notarial de hipoteca, fideicomiso u otras garantías.</span></div></div>
            <div class="funding-process-step"><div><strong>Desembolso y seguimiento</strong><span>Cumplidas las condiciones, se ejecutan los desembolsos y el control técnico-financiero acordado.</span></div></div>
          </div></section>
          <section class="funding-detail-section"><h3>Aspectos que se revisarán</h3><p>No representan incidencias confirmadas; son los principales bloques de diligencia debida antes de aprobar una financiación.</p><div class="funding-risk-grid">
            <div class="funding-risk-item"><strong>Jurídico y garantías</strong><span>Titularidad, cargas, contratos, estructura societaria y garantías propuestas.</span></div>
            <div class="funding-risk-item"><strong>Urbanístico y licencias</strong><span>Uso de suelo, normativa, permisos, aprobaciones y condicionantes administrativos.</span></div>
            <div class="funding-risk-item"><strong>Técnico y construcción</strong><span>Presupuesto, diseño, cronograma, contratista, contingencias y control de obra.</span></div>
            <div class="funding-risk-item"><strong>Comercial y preventas</strong><span>Demanda, precios, ritmo de absorción, cancelaciones y calidad de las reservas.</span></div>
            <div class="funding-risk-item"><strong>Financiero</strong><span>Fuentes y usos, aportes, cobertura, flujo de caja, repago y sensibilidad de costes.</span></div>
            <div class="funding-risk-item"><strong>Condiciones de desembolso</strong><span>Hitos, certificaciones, seguros, aportes previos y demás condiciones precedentes.</span></div>
          </div></section>
          ${(modelNames.length || phaseNames.length || item.publicConclusions) ? `<section class="funding-detail-section"><h3>Estructura del proyecto</h3>${(modelNames.length || phaseNames.length) ? `<div class="funding-detail-kpis">${modelNames.length ? `<div class="funding-detail-kpi"><span>Tipologías publicadas</span><strong>${modelNames.join(', ')}</strong></div>` : ''}${phaseNames.length ? `<div class="funding-detail-kpi"><span>Fases publicadas</span><strong>${phaseNames.join(', ')}</strong></div>` : ''}</div>` : ''}${item.publicConclusions ? `<p style="margin-top:${modelNames.length || phaseNames.length ? '14px' : '0'};">${escapeHtml(item.publicConclusions)}</p>` : ''}</section>` : ''}
          ${(item.documents || []).length ? `<section class="funding-detail-section"><h3>Documentación pública</h3><p>Documentos seleccionados expresamente para esta oportunidad.</p><div class="funding-doc-list">${item.documents.map(doc => `<button type="button" class="btn ghost small" data-public-doc-url="${escapeHtml(doc.downloadUrl)}" data-public-doc-name="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</button>`).join('')}</div></section>` : ''}
          ${(item.units || []).length ? `<section class="funding-detail-section"><h3>Inventario publicado</h3><div class="table-scroll"><table class="table"><thead><tr><th>Unidad</th><th>Modelo</th><th>Área</th><th>Precio</th><th>Estado</th></tr></thead><tbody>${item.units.map(unit => `<tr><td>${escapeHtml(unit.reference)}</td><td>${escapeHtml(unit.model)}</td><td>${Number(unit.areaM2 || 0)}</td><td>${unit.price === undefined ? 'No publicado' : moneyLabel(unit.price)}</td><td>${escapeHtml(unit.status)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
        </main>
        <aside class="funding-detail-column funding-detail-interest"><section class="funding-detail-section"><h3>Estoy interesado en financiar</h3><p style="margin-bottom:16px;">Envía una manifestación de interés a Bank73. No constituye todavía una oferta vinculante.</p><form id="fundingInterestForm"><label>Monto que desea estudiar<input name="amount" required inputmode="decimal"><span id="fundingInterestAmountMeta" class="small muted">0% del coste total · 0% del importe pendiente</span></label><label>Persona responsable<input name="responsiblePerson" required></label><label>Contacto interno<input name="internalContact" required></label><label>Comentario<textarea name="comment" rows="4" placeholder="Indica condiciones iniciales, dudas o documentación necesaria"></textarea></label><p id="fundingInterestMessage" class="msg" style="display:none;" aria-live="polite"></p><button class="btn" type="submit">Enviar interés a Bank73</button><div class="funding-detail-disclaimer">Bank73 revisará la solicitud y coordinará el intercambio de información. La aprobación depende del análisis y de las políticas de la entidad financiadora.</div></form></section></aside>
      </div>
    </div></div>`;
    wrap.querySelector('[data-close-funding]').addEventListener('click', () => wrap.remove());
    wrap.querySelectorAll('[data-public-doc-url]').forEach(downloadBtn => downloadBtn.addEventListener('click', async () => {
      const auth = API.getAuth();
      const response = await fetch(downloadBtn.dataset.publicDocUrl, { headers: { Authorization: `Bearer ${API.getToken()}`, 'x-tenant': auth.tenantKey || auth.tenant } });
      if (!response.ok) return alert('No se pudo descargar el documento.');
      const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = downloadBtn.dataset.publicDocName || 'documento'; a.click(); URL.revokeObjectURL(url);
    }));
    wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });
    const interestAmountInput = wrap.querySelector('#fundingInterestForm [name="amount"]');
    const interestAmountMeta = wrap.querySelector('#fundingInterestAmountMeta');
    interestAmountInput?.addEventListener('input', () => {
      const amount = numberFromCreate(interestAmountInput.value);
      const total = Number(item.totalCost || 0);
      const pending = Number(item.pendingAmount || 0);
      const totalPct = total > 0 ? amount / total * 100 : 0;
      const pendingText = pending > 0 ? `${(amount / pending * 100).toFixed(2)}% del importe pendiente` : 'Sin importe pendiente de financiar';
      if (interestAmountMeta) interestAmountMeta.textContent = `${totalPct.toFixed(2)}% del coste total · ${pendingText}`;
    });
    wrap.querySelector('#fundingInterestForm').addEventListener('submit', async e => {
      e.preventDefault();
      const message = e.currentTarget.querySelector('#fundingInterestMessage');
      if (role !== 'bank') {
        if (message) { message.textContent = 'Vista previa del marketplace bancario. Solo un banco puede enviar interés.'; message.className = 'msg error'; message.style.display = ''; }
        return;
      }
      const submitBtn = e.currentTarget.querySelector('[type="submit"]');
      const form = new FormData(e.currentTarget);
      try {
        if (submitBtn) submitBtn.disabled = true;
        await API.post(`/api/funding/opportunities/${encodeURIComponent(btn.dataset.fundingOpportunity)}/interests`, { amount: numberFromCreate(form.get('amount')), responsiblePerson: form.get('responsiblePerson'), internalContact: form.get('internalContact'), comment: form.get('comment') });
        if (message) { message.textContent = 'Interés registrado. Bank73 revisará la propuesta.'; message.className = 'msg success'; message.style.display = ''; }
        e.currentTarget.reset();
      } catch (error) {
        if (message) { message.textContent = error.message || 'No se pudo registrar el interés.'; message.className = 'msg error'; message.style.display = ''; }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  });

  document.getElementById('fundingOpportunityCards')?.addEventListener('pointerover', event => {
    const button = event.target.closest('[data-funding-opportunity]');
    const opportunityId = button?.dataset.fundingOpportunity;
    if (!opportunityId || fundingOpportunityDetailCache.has(opportunityId)) return;
    getFundingOpportunityDetail(opportunityId).catch(() => {});
  });

  if (role === 'promoter') {
    const closeProfileRequired = () => profileRequiredBackdrop?.classList.remove('show');
    closeProfileRequiredBtn?.addEventListener('click', closeProfileRequired);
    profileRequiredBackdrop?.addEventListener('click', event => {
      if (event.target === profileRequiredBackdrop) closeProfileRequired();
    });
    goToPromoterProfileBtn?.addEventListener('click', async () => {
      closeProfileRequired();
      await loadPromoterProfile();
      profileModalBackdrop?.classList.add('show');
    });
    profileBtn?.addEventListener('click', async () => {
      await loadPromoterProfile();
      profileModalBackdrop?.classList.add('show');
    });
    document.getElementById('pp-addCompany')?.addEventListener('click', () => {
      const rows = Array.from(document.querySelectorAll('#pp-companies .profile-company-row')).map(row => ({
        companyId: row.dataset.companyId || '',
        name: row.querySelector('[data-company-name]')?.value || '',
        incorporationYear: row.querySelector('[data-company-year]')?.value || '',
        ruc: row.querySelector('[data-company-ruc]')?.value || '',
        shareholders: Array.from(row.querySelectorAll('[data-company-shareholder-row]')).map(shareholder => ({
          name: shareholder.querySelector('[data-company-shareholder="name"]')?.value || '',
          cedula: shareholder.querySelector('[data-company-shareholder="cedula"]')?.value || '',
          percentage: shareholder.querySelector('[data-company-shareholder="percentage"]')?.value || ''
        })),
        isPrimary: !!row.querySelector('[data-company-primary]')?.checked
      }));
      renderProfileCompanies([...rows, { name: '', incorporationYear: '', ruc: '', shareholders: [], isPrimary: rows.length === 0 }]);
    });
    document.getElementById('pp-companies')?.addEventListener('click', event => {
      const addShareholderButton = event.target.closest('[data-add-company-shareholder]');
      if (addShareholderButton) {
        addShareholderButton.closest('.profile-company-row')?.querySelector('[data-company-shareholders]')?.insertAdjacentHTML('beforeend', profileCompanyShareholderRow());
        return;
      }
      const removeShareholderButton = event.target.closest('[data-remove-company-shareholder]');
      if (removeShareholderButton) {
        removeShareholderButton.closest('[data-company-shareholder-row]')?.remove();
        return;
      }
      const removeButton = event.target.closest('[data-remove-company]');
      if (!removeButton) return;
      const container = document.getElementById('pp-companies');
      removeButton.closest('.profile-company-row')?.remove();
      const remaining = container?.querySelectorAll('.profile-company-row') || [];
      if (!remaining.length) renderProfileCompanies();
      else if (!container.querySelector('[data-company-primary]:checked')) {
        remaining[0].querySelector('[data-company-primary]').checked = true;
      }
    });
    document.getElementById('pp-teamAreas')?.addEventListener('change', event => {
      if (!event.target.matches('[data-team-toggle]')) return;
      event.target.closest('.profile-team-card')?.classList.toggle('is-active', event.target.checked);
    });
    const closeProfile = () => profileModalBackdrop?.classList.remove('show');
    closeProfileModalBtn?.addEventListener('click', closeProfile);
    cancelProfileModalBtn?.addEventListener('click', closeProfile);
    profileModalBackdrop?.addEventListener('click', event => {
      if (event.target === profileModalBackdrop) closeProfile();
    });
    saveProfileModalBtn?.addEventListener('click', async () => {
      try {
        saveProfileModalBtn.disabled = true;
        const data = await API.patch('/api/auth/promoter-profile', { promoterProfile: collectProfileModal() });
        fillProfileModal(data);
        closeProfile();
      } catch (e) {
        alert('No se pudo guardar el perfil: ' + (e.message || e));
      } finally {
        saveProfileModalBtn.disabled = false;
      }
    });
    await loadPromoterProfile();
  }

  // Init
  await syncFundingModuleVisibility();
  await loadList();

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      API.logout();
      location.href = '/login';
    });
  }
})();
