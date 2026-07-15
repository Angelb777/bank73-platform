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
  let createPromoterProfilesLoaded = false;

  // Auth / rol
  const auth = API.getAuth ? API.getAuth() : {
    role: (localStorage.getItem('role') || '').toLowerCase(),
    userId: localStorage.getItem('userId')
  };
  const role = (auth.role || '').toLowerCase();
  let fundingModuleEnabled = role === 'admin';
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
      row.innerHTML = `
        <label><span>Sociedad ${index + 1} · Nombre</span><input data-company-name type="text" placeholder="Razón social"></label>
        <label><span>Año de constitución</span><input data-company-year type="number" min="1800" max="${new Date().getFullYear()}" step="1" placeholder="Ej: 2012"></label>
        <label class="profile-company-primary" title="Usar esta sociedad por defecto"><input data-company-primary type="radio" name="pp-primary-company"> Sociedad principal</label>
        <button class="btn ghost profile-company-remove" data-remove-company type="button" title="Eliminar sociedad" aria-label="Eliminar sociedad">×</button>`;
      row.querySelector('[data-company-name]').value = company.name || '';
      row.querySelector('[data-company-year]').value = company.incorporationYear ?? '';
      row.querySelector('[data-company-primary]').checked = !!company.isPrimary || (!rows.some(item => item.isPrimary) && index === 0);
      container.appendChild(row);
    });
  }

  function collectProfileCompanies() {
    const currentYear = new Date().getFullYear();
    const companies = Array.from(document.querySelectorAll('#pp-companies .profile-company-row')).map(row => ({
      name: row.querySelector('[data-company-name]')?.value.trim() || '',
      incorporationYear: numberOrNull(row.querySelector('[data-company-year]')?.value),
      isPrimary: !!row.querySelector('[data-company-primary]')?.checked
    })).filter(company => company.name || company.incorporationYear !== null);
    if (companies.some(company => !company.name || !Number.isInteger(company.incorporationYear) || company.incorporationYear < 1800 || company.incorporationYear > currentYear)) {
      throw new Error(`Cada sociedad debe tener nombre y un año de constitución entre 1800 y ${currentYear}.`);
    }
    if (companies.length && !companies.some(company => company.isPrimary)) companies[0].isPrimary = true;
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
      filtered = filtered.filter(p => String(p.status || '') === status);
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
    const s = status || 'EN_CURSO';
    return `<span class="badge portfolio-status-pill">${escapeHtml(s.replaceAll('_', ' '))}</span>`;
  }

  function statusClass(status) {
    const s = (status || 'EN_CURSO').toUpperCase();
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

    return `
      <article class="card portfolio-project-card ${statusClass(p.status)}">
        <div class="portfolio-card-cover">
          ${p.coverImage?.path
            ? `<img src="${escapeHtml(p.coverImage.path)}" alt="Portada de ${escapeHtml(p.name || 'proyecto')}" loading="lazy">`
            : '<div class="portfolio-card-cover-fallback" aria-hidden="true"><span>Bank73</span></div>'}
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
          <div class="portfolio-card-metrics" aria-label="Resumen de unidades">
            <div><span>Total</span><strong>${escapeHtml(String(unitsTotal))}</strong><small>unidades</small></div>
            <div><span>Vendidas</span><strong>${escapeHtml(String(unitsSold))}</strong><small>unidades</small></div>
          </div>
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
      if (fundingModuleEnabled && ['bank', 'admin'].includes((API.getRole?.() || '').toLowerCase())) loadFundingOpportunities();
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
  const createFinanceLines = document.getElementById('createFinanceLines');
  const createDatoUnicoFileInput = document.getElementById('createDatoUnicoFile');
  const createDatoUnicoFileName = document.getElementById('createDatoUnicoFileName');
  const clearCreateDatoUnicoFileBtn = document.getElementById('clearCreateDatoUnicoFile');
  const createDatoUnicoWarning = document.getElementById('createDatoUnicoWarning');
  const createImportModeNotice = document.getElementById('createImportModeNotice');
  const createManualModelsPanel = document.getElementById('createManualModelsPanel');
  const CREATE_STEP_ORDER = ['general', 'legal', 'technical', 'progress', 'financial', 'team'];
  let activeCreateStep = 'general';
  let createDatoUnicoFileState = null;
  let isCreatingProject = false;
  let createTotalUnitsManuallyEdited = false;
  let createLastSuggestedUnitsTotal = 0;

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

  document.getElementById('pSeeksFinancing')?.addEventListener('change', syncCreateFundingRequestVisibility);
  syncCreateFundingRequestVisibility();

  function applyFundingModuleVisibility() {
    const choice = document.getElementById('createFundingChoice');
    const section = document.getElementById('fundingOpportunitiesSection');
    if (choice) choice.style.display = fundingModuleEnabled ? '' : 'none';
    if (!fundingModuleEnabled) {
      const seeks = document.getElementById('pSeeksFinancing');
      if (seeks) seeks.value = 'false';
      if (section) section.style.display = 'none';
      document.getElementById('fundingOpportunityModal')?.remove();
    }
    syncCreateFundingRequestVisibility();
  }

  async function syncFundingModuleVisibility() {
    try {
      const settings = await API.get('/api/funding/module-settings');
      fundingModuleEnabled = role === 'admin' || settings?.enabled === true;
    } catch (_error) {
      fundingModuleEnabled = role === 'admin';
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
            ${item.coverImage?.path ? `<img src="${escapeHtml(item.coverImage.path)}" alt="Portada de ${escapeHtml(item.name || 'proyecto')}">` : ''}
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
      select.innerHTML = '<option value="">Escribir manualmente</option>';
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
      select.innerHTML = '<option value="">Escribir manualmente</option>';
      console.warn('No se pudieron cargar promotores para creacion', e);
    }
  }

  function primaryPromoterCompany(profile = {}) {
    const companies = Array.isArray(profile?.companies) ? profile.companies : [];
    return String((companies.find(company => company?.isPrimary) || companies[0])?.name || profile?.companyName || '').trim();
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
              <input type="file" multiple data-create-checklist-file="${escapeHtml(step.key)}" aria-label="Adjuntar archivos a ${escapeHtml(step.title)}">
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
    return {
      promoterLegalName: document.getElementById('ld-promoterLegalName')?.value?.trim() || '',
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
      assessment: Object.fromEntries(Array.from(document.querySelectorAll('[data-technical-assessment]')).map(input => [input.dataset.technicalAssessment, input.value === '' ? null : input.value === 'true']))
    };
  }

  function hasCreateDatoUnicoFile() {
    return !!createDatoUnicoFileState;
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
  }

  function clearCreateDatoUnicoFile() {
    createDatoUnicoFileState = null;
    if (createDatoUnicoFileInput) createDatoUnicoFileInput.value = '';
    updateCreateDatoUnicoMode();
    syncTechnicalUnitsFromModels();
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
      precioLista: numberFromCreate(row.querySelector('[data-create-model="price"]')?.value),
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
      out[field] = ['m2','precioLista','metrosExtra','precioLoteEsquina','precioM2Extra','areaAbierta','areaCerrada','areaTotalConstruccion','recamaras','banos','valorMejoras','valorTerreno'].includes(field)
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
  const DEFAULT_PHASE_FINANCING_LINES = ['Terreno', 'Infraestructura', 'Construccion', 'Costos directos', 'Costos indirectos', 'Otra'];
  const PHASE_FINANCING_GRID = 'display:grid;grid-template-columns:minmax(150px,1.1fr) minmax(150px,1fr) minmax(140px,1fr) 120px 110px 110px minmax(180px,1fr) minmax(200px,1fr) 110px minmax(180px,1fr) 76px;gap:6px;align-items:start;min-width:1550px;';
  const PHASE_FINANCING_HEADER = `
    <div style="${PHASE_FINANCING_GRID}font-size:.72rem;font-weight:700;color:#475569;margin-bottom:6px;">
      <span>Nombre/facilidad</span><span>Entidad financiadora</span><span>Concepto</span><span>Monto</span><span>Tasa</span><span>Plazo</span><span>Forma de pago</span><span>Forma de desembolso</span><span>Comision</span><span>Observaciones</span><span></span>
    </div>
  `;

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

  function lineFinancierOptionsHtml(banks = [], current = '', currentType = 'bank') {
    const value = String(current || '').trim();
    const nonBank = currentType && currentType !== 'bank';
    const historical = value && !banks.includes(value) && !nonBank;
    return `
      <option value=""${!value ? ' selected' : ''}>Por definir</option>
      ${banks.map(bank => `<option value="${escapeHtml(bank)}"${value === bank && !nonBank ? ' selected' : ''}>${escapeHtml(bank)}</option>`).join('')}
      <option value="__NON_BANK__"${nonBank ? ' selected' : ''}>Otra fuente no bancaria</option>
      ${historical ? `<option value="${escapeHtml(value)}" selected>${escapeHtml(value)} (histórico)</option>` : ''}
    `;
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

  function createPhaseFinanceBlock(index, item = {}) {
    const itemRows = (items = [], kind) => {
      const defaults = kind === 'planUses' ? DEFAULT_PHASE_PLAN_USES.map(name => ({ name })) : [{ name: '', amount: '' }];
      const rows = items.length ? items : defaults;
      return rows.map(row => `
        <div style="display:grid;grid-template-columns:1fr 140px;gap:8px;margin-bottom:6px;" data-create-phase-line="${kind}">
          <input data-create-phase-line-name placeholder="Concepto" value="${escapeHtml(row.name || '')}">
          <input data-create-phase-line-amount data-bank-number type="text" inputmode="decimal" placeholder="Monto" value="${row.amount ? formatBankNumber(row.amount) : ''}">
        </div>
      `).join('');
    };
    const condition = item.financialConditions || {};
    const selectedBanks = phaseSelectedBanks(item);
    const phaseFinancial = {
      phaseTotal: numberFromCreate(condition.phaseTotal),
      bankFinancedAmount: numberFromCreate(condition.bankFinancedAmount),
      bankFinancedPct: numberFromCreate(condition.bankFinancedPct),
      promoterContribution: numberFromCreate(condition.promoterContribution),
      promoterContributionPct: numberFromCreate(condition.promoterContributionPct)
    };
    const conditionField = ([key, label, type, placeholder]) => {
      const value = condition[key] || '';
      const attrs = `data-create-phase-condition="${key}" placeholder="${escapeHtml(placeholder || '')}"`;
      if (type === 'textarea') return `<label style="grid-column:1/-1">${label}<textarea ${attrs} rows="2">${escapeHtml(value)}</textarea></label>`;
      return `<label>${label}<input ${attrs} value="${escapeHtml(value)}"></label>`;
    };
    return `<details class="create-phase-block" data-create-phase-row="${index}" style="border:1px solid #dbe2ea;border-radius:12px;padding:10px;margin-bottom:10px;background:#fff;">
      <summary><strong>${escapeHtml(item.name || `Fase ${index + 1}`)}</strong></summary>
      <div class="create-grid" style="margin-top:10px;">
        <label>Nombre<input data-create-phase="name" value="${escapeHtml(item.name || `Fase ${index + 1}`)}"></label>
        <label style="grid-column:1/-1">Bancos financiadores de la fase
          <select data-create-phase-banks multiple size="5">${phaseBankOptionsHtml(selectedBanks)}</select>
          <span class="small muted">Deja la selección vacía o elige “Por definir” si todavía no hay banco. Esta selección no concede acceso ni crea tenants.</span>
        </label>
        <label>Fecha de carta<input data-create-phase-condition="letterDate" type="date" value="${escapeHtml((condition.letterDate || '').slice(0, 10))}"></label>
        <label>Numero o referencia de carta<input data-create-phase-condition="letterReference" placeholder="Carta term sheet BG-2026-015" value="${escapeHtml(condition.letterReference || '')}"></label>
        <div style="grid-column:1/-1;border:1px solid #dbeafe;background:#f8fbff;border-radius:12px;padding:10px;">
          <strong>Datos financieros de la fase</strong>
          <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:8px;">
            <label>Total de la fase<input data-create-phase-financial="phaseTotal" data-bank-number type="text" inputmode="decimal" placeholder="Monto total fase" value="${phaseFinancial.phaseTotal ? formatBankNumber(phaseFinancial.phaseTotal) : ''}"></label>
            <label>Financiacion bancaria<input data-create-phase-financial="bankFinancedAmount" data-bank-number type="text" inputmode="decimal" placeholder="Monto banco" value="${phaseFinancial.bankFinancedAmount ? formatBankNumber(phaseFinancial.bankFinancedAmount) : ''}"></label>
            <label>Aporte del promotor<input data-create-phase-financial="promoterContribution" data-bank-number type="text" inputmode="decimal" placeholder="Monto promotor" value="${phaseFinancial.promoterContribution ? formatBankNumber(phaseFinancial.promoterContribution) : ''}"></label>
            <label>% banco<input data-create-phase-financial="bankFinancedPct" type="text" inputmode="decimal" placeholder="70" value="${phaseFinancial.bankFinancedPct ? formatPercentNumber(phaseFinancial.bankFinancedPct) : ''}"></label>
            <label>% promotor<input data-create-phase-financial="promoterContributionPct" type="text" inputmode="decimal" placeholder="30" value="${phaseFinancial.promoterContributionPct ? formatPercentNumber(phaseFinancial.promoterContributionPct) : ''}"></label>
          </div>
        </div>
        <label style="grid-column:1/-1">Usos estimados
          <div data-create-phase-lines-box="planUses">${itemRows(item.planUses || [], 'planUses')}</div>
          <button class="btn ghost" type="button" data-add-create-phase-line="planUses">+ Uso</button>
        </label>
        <div style="grid-column:1/-1;border:1px solid #dbeafe;background:#f8fbff;border-radius:12px;padding:10px;" data-create-phase-sources-summary>
          <strong>Fuentes estimadas automaticas</strong>
          <div class="small muted" style="margin-top:6px;">Total usos: <b data-phase-total-uses>0</b> · Banco: <b data-phase-bank-source>0</b> · Promotor: <b data-phase-promoter-source>0</b> · Total fuentes: <b data-phase-total-sources>0</b></div>
        </div>
        <div style="grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">
          ${PHASE_CONDITION_FIELDS.map(conditionField).join('')}
        </div>
      </div>
    </details>`;
  }

  function createPhaseFinancingLinesBlock(index, item = {}) {
    const selectedBanks = phaseSelectedBanks(item);
    const financingRows = (Array.isArray(item.financingLines) && item.financingLines.length ? item.financingLines : DEFAULT_PHASE_FINANCING_LINES.map(name => ({ name }))).map(line => `
      <div data-create-phase-financing-line style="${PHASE_FINANCING_GRID}margin-bottom:6px;">
        <input data-create-phase-financing="name" placeholder="Terreno" value="${escapeHtml(line.name || '')}">
        <select data-create-phase-financing="financierName">${lineFinancierOptionsHtml(selectedBanks, line.financierName, line.financierType)}</select>
        <input data-create-phase-financing="concept" placeholder="Concepto" value="${escapeHtml(line.concept || line.name || '')}">
        <input data-create-phase-financing="approvedAmount" data-bank-number type="text" inputmode="decimal" placeholder="Monto" value="${line.approvedAmount ? formatBankNumber(line.approvedAmount) : ''}">
        <input data-create-phase-financing="interestRate" placeholder="SOFR + 3.50%" value="${escapeHtml(line.interestRate || '')}">
        <input data-create-phase-financing="term" placeholder="24 meses" value="${escapeHtml(line.term || '')}">
        <input data-create-phase-financing="paymentMethod" placeholder="Intereses y FECI mensuales, capital al vencimiento" value="${escapeHtml(line.paymentMethod || '')}">
        <input data-create-phase-financing="disbursementMethod" placeholder="Contra avance certificado por inspector autorizado" value="${escapeHtml(line.disbursementMethod || '')}">
        <input data-create-phase-financing="commission" placeholder="1% flat" value="${escapeHtml(line.commission || '')}">
        <input data-create-phase-financing="observations" placeholder="Observaciones" value="${escapeHtml(line.observations || '')}">
        <button class="btn ghost" type="button" data-remove-phase-financing-line style="width:76px;padding:7px 6px;">Quitar</button>
      </div>
    `).join('');
    return `<details class="create-phase-block" data-create-phase-financing-row="${index}" style="border:1px solid #dbe2ea;border-radius:12px;padding:10px;margin-bottom:10px;background:#fff;">
      <summary><strong data-line-phase-title>${escapeHtml(item.name || `Fase ${index + 1}`)}</strong></summary>
      <div style="margin-top:10px;">
        <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:10px;">
          <div class="small muted" style="border:1px solid #dbeafe;background:#f8fbff;border-radius:10px;padding:8px;">Financiacion bancaria prevista<br><b data-line-bank-amount>0</b></div>
          <div class="small muted" style="border:1px solid #dbeafe;background:#f8fbff;border-radius:10px;padding:8px;">Total distribuido en lineas<br><b data-line-total>0</b></div>
          <div class="small muted" style="border:1px solid #dbeafe;background:#f8fbff;border-radius:10px;padding:8px;">Pendiente por distribuir<br><b data-line-pending>0</b></div>
          <div class="small muted" style="border:1px solid #dbeafe;background:#f8fbff;border-radius:10px;padding:8px;">Porcentaje distribuido<br><b data-line-percent>0%</b></div>
        </div>
        <div class="small" data-phase-financing-lines-summary style="margin-bottom:8px;color:#475569;"></div>
        <div style="overflow-x:auto;padding-bottom:4px;">${PHASE_FINANCING_HEADER}<div data-create-phase-financing-lines>${financingRows}</div></div>
        <button class="btn ghost" type="button" data-add-phase-financing-line>+ Linea</button>
      </div>
    </details>`;
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
    const baseTotal = numberFromCreate(financial.phaseTotal);
    const bank = baseTotal * numberFromCreate(financial.bankPct) / 100;
    const promoter = baseTotal * numberFromCreate(financial.promoterPct) / 100;
    return [
      { name: 'Banco', amount: Math.round(bank * 100) / 100 },
      { name: 'Promotor', amount: Math.round(promoter * 100) / 100 }
    ];
  }

  function syncCreatePhaseSources() {
    const financial = currentCreateFinancialNumbers();
    let totalUsesAll = 0;
    document.querySelectorAll('[data-create-phase-row]').forEach((row, idx) => {
      const usesTotal = phaseUsesTotal(row);
      syncPhaseFinancialTriplet(row);
      const phaseFinancial = currentPhaseFinancialNumbers(row);
      const sources = autoPhaseSourcesForUses(usesTotal, phaseFinancial);
      const bank = sources.find(item => item.name === 'Banco')?.amount || 0;
      const promoter = sources.find(item => item.name === 'Promotor')?.amount || 0;
      const total = bank + promoter;
      const lineRow = document.querySelector(`[data-create-phase-financing-row="${idx}"]`);
      const linesTotal = phaseFinancingLinesTotal(lineRow);
      const linesDiff = bank - linesTotal;
      const phaseTitle = lineRow?.querySelector('[data-line-phase-title]');
      if (phaseTitle) phaseTitle.textContent = row.querySelector('[data-create-phase="name"]')?.value.trim() || `Fase ${idx + 1}`;
      totalUsesAll += numberFromCreate(phaseFinancial.phaseTotal);
      const setText = (selector, value) => {
        const el = row.querySelector(selector);
        if (el) el.textContent = formatBankNumber(value);
      };
      setText('[data-phase-financial-total]', phaseFinancial.phaseTotal);
      setText('[data-phase-total-uses]', usesTotal);
      setText('[data-phase-bank-source]', bank);
      setText('[data-phase-promoter-source]', promoter);
      setText('[data-phase-total-sources]', total);
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
            : 'Las lineas estan dentro de la financiacion bancaria aprobada para esta fase.';
      }
    });
    renderCreatePhasesGlobalSummary({
      totalUses: totalUsesAll,
      financial
    });
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
    if (createFinanceLines) {
      createFinanceLines.innerHTML = Array.from({ length: count }, (_, idx) => createPhaseFinancingLinesBlock(idx, current[idx] || {})).join('');
    }
    bindBankNumberFormatting(createFinancePhases);
    bindBankNumberFormatting(createFinanceLines || document);
    syncCreatePhaseSources();
  }

  function collectPhaseLineItems(row, kind) {
    return Array.from(row.querySelectorAll(`[data-create-phase-line="${kind}"]`)).map(line => ({
      name: line.querySelector('[data-create-phase-line-name]')?.value.trim() || '',
      amount: numberFromCreate(line.querySelector('[data-create-phase-line-amount]')?.value)
    })).filter(item => item.name || item.amount);
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
      financierName: line.querySelector('[data-create-phase-financing="financierName"]')?.value === '__NON_BANK__'
        ? 'Otra fuente no bancaria'
        : (line.querySelector('[data-create-phase-financing="financierName"]')?.value.trim() || ''),
      financierType: line.querySelector('[data-create-phase-financing="financierName"]')?.value === '__NON_BANK__' ? 'other' : 'bank',
      concept: line.querySelector('[data-create-phase-financing="concept"]')?.value.trim() || '',
      approvedAmount: numberFromCreate(line.querySelector('[data-create-phase-financing="approvedAmount"]')?.value),
      interestRate: line.querySelector('[data-create-phase-financing="interestRate"]')?.value.trim() || '',
      term: line.querySelector('[data-create-phase-financing="term"]')?.value.trim() || '',
      paymentMethod: line.querySelector('[data-create-phase-financing="paymentMethod"]')?.value.trim() || '',
      disbursementMethod: line.querySelector('[data-create-phase-financing="disbursementMethod"]')?.value.trim() || '',
      commission: line.querySelector('[data-create-phase-financing="commission"]')?.value.trim() || '',
      observations: line.querySelector('[data-create-phase-financing="observations"]')?.value.trim() || ''
    })).filter(item => Object.values(item).some(value => String(value ?? '').trim() !== '' && numberFromCreate(value) !== 0));
  }

  function collectFinancePhases() {
    return Array.from(document.querySelectorAll('[data-create-phase-row]')).map((row, idx) => {
      const lineRow = document.querySelector(`[data-create-phase-financing-row="${idx}"]`) || row;
      return {
        name: row.querySelector('[data-create-phase="name"]')?.value.trim() || `Fase ${idx + 1}`,
        financierBanks: Array.from(row.querySelector('[data-create-phase-banks]')?.selectedOptions || []).map(option => option.value).filter(Boolean),
        planUses: collectPhaseLineItems(row, 'planUses'),
        planSources: autoPhaseSourcesForUses(phaseUsesTotal(row), currentPhaseFinancialNumbers(row)),
        financialConditions: collectPhaseFinancialConditions(row),
        financingLines: collectPhaseFinancingLines(lineRow)
      };
    });
  }

  function validateCreateFinancePhases({ alertOnError = false } = {}) {
    const financial = currentCreateFinancialNumbers();
    const phases = collectFinancePhases();
    const usesTotal = phases.reduce((sum, phase) => sum + numberFromCreate(phase.financialConditions?.phaseTotal), 0);
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
      const uses = phase.planUses.reduce((a, item) => a + numberFromCreate(item.amount), 0);
      const sources = phase.planSources.reduce((a, item) => a + numberFromCreate(item.amount), 0);
      if (!close(uses, sources)) return fail(`En ${phase.name}, total usos (${formatBankNumber(uses)}) debe coincidir con total fuentes (${formatBankNumber(sources)}).`);
      const bankAmount = numberFromCreate(phase.financialConditions?.bankFinancedAmount);
      const financingLinesTotal = (phase.financingLines || []).reduce((sum, line) => sum + numberFromCreate(line.approvedAmount), 0);
      if (financingLinesTotal > bankAmount + 0.05) {
        return fail('Las lineas de financiacion superan la financiacion bancaria aprobada para esta fase.');
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
  });
  [createBoardMembers, createShareholders, createHousingModels].forEach(container => {
    container?.addEventListener('click', event => {
      event.target.closest('[data-remove-create-row]')?.closest('.create-repeat-row')?.remove();
      syncTechnicalUnitsFromModels();
      validateCreateModelStatuses();
    });
  });
  createHousingModels?.addEventListener('input', event => {
    if (event.target?.matches?.('[data-create-unit]')) return;
    syncTechnicalUnitsFromModels();
    createHousingModels.querySelectorAll('[data-create-model-row]').forEach(row => {
      syncCreateModelStatusRow(row, { autoFill: true });
      syncCreateUnitsPreview(row);
    });
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
  createFinanceLines?.addEventListener('click', event => {
    const addFinancingBtn = event.target.closest('[data-add-phase-financing-line]');
    const removeFinancingBtn = event.target.closest('[data-remove-phase-financing-line]');
    if (addFinancingBtn) {
      const box = addFinancingBtn.closest('[data-create-phase-financing-row]')?.querySelector('[data-create-phase-financing-lines]');
      box?.insertAdjacentHTML('beforeend', `
        <div data-create-phase-financing-line style="${PHASE_FINANCING_GRID}margin-bottom:6px;">
          <input data-create-phase-financing="name" placeholder="Terreno">
          <select data-create-phase-financing="financierName">${lineFinancierOptionsHtml(
            Array.from(document.querySelector(`[data-create-phase-row="${addFinancingBtn.closest('[data-create-phase-financing-row]')?.dataset.createPhaseFinancingRow}"] [data-create-phase-banks]`)?.selectedOptions || []).map(option => option.value).filter(Boolean)
          )}</select>
          <input data-create-phase-financing="concept" placeholder="Concepto">
          <input data-create-phase-financing="approvedAmount" data-bank-number type="text" inputmode="decimal" placeholder="Monto">
          <input data-create-phase-financing="interestRate" placeholder="SOFR + 3.50%">
          <input data-create-phase-financing="term" placeholder="24 meses">
          <input data-create-phase-financing="paymentMethod" placeholder="Intereses y FECI mensuales, capital al vencimiento">
          <input data-create-phase-financing="disbursementMethod" placeholder="Contra avance certificado por inspector autorizado">
          <input data-create-phase-financing="commission" placeholder="1% flat">
          <input data-create-phase-financing="observations" placeholder="Observaciones">
          <button class="btn ghost" type="button" data-remove-phase-financing-line style="width:76px;padding:7px 6px;">Quitar</button>
        </div>
      `);
      bindBankNumberFormatting(createFinanceLines);
      syncCreatePhaseSources();
      return;
    }
    if (removeFinancingBtn) {
      removeFinancingBtn.closest('[data-create-phase-financing-line]')?.remove();
      syncCreatePhaseSources();
    }
  });
  createFinancePhases?.addEventListener('input', event => {
    const financialInput = event.target?.closest?.('[data-create-phase-financial]');
    if (financialInput) {
      syncPhaseFinancialTriplet(financialInput.closest('[data-create-phase-row]'), financialInput.dataset.createPhaseFinancial);
    }
    syncCreatePhaseSources();
  });
  createFinancePhases?.addEventListener('change', event => {
    const bankSelect = event.target?.closest?.('[data-create-phase-banks]');
    if (bankSelect) {
      const phaseIndex = bankSelect.closest('[data-create-phase-row]')?.dataset.createPhaseRow;
      const banks = Array.from(bankSelect.selectedOptions || []).map(option => option.value).filter(Boolean);
      document.querySelectorAll(`[data-create-phase-financing-row="${phaseIndex}"] [data-create-phase-financing="financierName"]`).forEach(select => {
        const current = select.value;
        const currentType = current === '__NON_BANK__' ? 'other' : 'bank';
        const allowedCurrent = currentType === 'other' || banks.includes(current) ? current : '';
        select.innerHTML = lineFinancierOptionsHtml(banks, allowedCurrent === '__NON_BANK__' ? 'Otra fuente no bancaria' : allowedCurrent, currentType);
      });
    }
    syncCreatePhaseSources();
  });
  createFinancePhases?.addEventListener('keyup', syncCreatePhaseSources);
  createFinanceLines?.addEventListener('input', syncCreatePhaseSources);
  createFinanceLines?.addEventListener('change', syncCreatePhaseSources);
  createFinanceLines?.addEventListener('keyup', syncCreatePhaseSources);
  createDatoUnicoFileInput?.addEventListener('change', event => {
    createDatoUnicoFileState = event.target.files?.[0] || null;
    updateCreateDatoUnicoMode();
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
      const legalInput = document.getElementById('ld-promoterLegalName');
      const company = primaryPromoterCompany(promoterProfileState?.promoterProfile);
      if (legalInput && !legalInput.value.trim() && company) legalInput.value = company;
    }
    await loadCreateProgressChecks();
    await loadCreatePermitTemplates();
    renderCreatePermitItems();

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
    document.getElementById('ld-promoterProfileSelect')?.addEventListener('change', ev => {
      const user = createPromoterProfiles.get(String(ev.target.value || ''));
      const legalName = primaryPromoterCompany(user?.promoterProfile);
      const input = document.getElementById('ld-promoterLegalName');
      if (input) input.value = legalName;
    });
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
          const legalData = collectLegalData();
          const importFile = createDatoUnicoFileState;
          const checklistFiles = Array.from(document.querySelectorAll('[data-create-checklist-file]'))
            .flatMap(input => Array.from(input.files || []).map(file => ({ key: input.dataset.createChecklistFile, file })))
            .filter(item => item.key && item.file);

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
            teamSuggestion: collectTeamSuggestion(),
            ...collectInitialProgress()
          };

          const createdProject = await API.post('/api/projects', payload);
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
          if (importFile && createdProject?._id) {
            const fd = new FormData();
            fd.append('file', importFile);
            try {
              await API.upload(`/api/projects/${createdProject._id}/import-dato-unico`, fd);
              createDatoUnicoFileState = null;
            } catch (importErr) {
              console.error(importErr);
              alert('Proyecto creado, pero no se pudo importar el Excel Dato Unico.');
            }
          }

          closeModal();

          // reset campos
          ['pName', 'pDesc', 'pLocation', 'pProjectType', 'pFundingDeadline', 'ld-promoterProfileSelect', 'kLoanApproved', 'kBudgetApproved', 'ts-promoter', 'ts-commercial', 'ts-legal', 'ts-tecnico', 'ts-gerencia', 'ts-socios', 'ts-financiero', 'ts-contable', 'ts-notes', 'fundingRequestedAmount', 'fundingSecuredAmount', ...conditionNumbers.map(x => `fc-${x}`), ...conditionTexts.map(x => `fc-${x}`)].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
          });

          const st = document.getElementById('pStatus');
          if (st) st.value = 'EN_CURSO';
          if (createFacilities) createFacilities.innerHTML = '';
          if (createBoardMembers) createBoardMembers.innerHTML = '';
          if (createShareholders) createShareholders.innerHTML = '';
          if (createHousingModels) createHousingModels.innerHTML = '';
          if (createFinancePhases) createFinancePhases.innerHTML = '';
          if (createFinanceLines) createFinanceLines.innerHTML = '';
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
          const createPermitTemplate = document.getElementById('createPermitTemplate');
          if (createPermitTemplate) createPermitTemplate.value = '';
          renderCreatePermitItems();
          ['fc-otherRequirements','fc-trustee','fc-trustType','fc-technicalInspector','fc-financialInspector','ld-promoterLegalName','ld-trustName','td-phasesCount','td-totalUnits','td-notes'].forEach(fieldId => {
            const field = document.getElementById(fieldId); if (field) field.value = '';
          });
          clearCreateDatoUnicoFile();
          const trustApplies = document.getElementById('ld-trustApplies');
          if (trustApplies) trustApplies.value = 'false';
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

          alert('Proyecto enviado a revisión del administrador. Aparecerá aquí cuando sea aprobado.');
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
          ${item.coverImage?.path ? `<img src="${escapeHtml(item.coverImage.path)}" alt="Portada de ${escapeHtml(item.name || 'proyecto')}">` : ''}
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
        name: row.querySelector('[data-company-name]')?.value || '',
        incorporationYear: row.querySelector('[data-company-year]')?.value || '',
        isPrimary: !!row.querySelector('[data-company-primary]')?.checked
      }));
      renderProfileCompanies([...rows, { name: '', incorporationYear: '', isPrimary: rows.length === 0 }]);
    });
    document.getElementById('pp-companies')?.addEventListener('click', event => {
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
