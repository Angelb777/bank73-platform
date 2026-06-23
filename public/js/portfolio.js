(async function () {
  if (!API.getToken()) location.href = '/';

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
  const promoterMap = new Map();
  let promoterOptionsLoaded = false;

  // Auth / rol
  const auth = API.getAuth ? API.getAuth() : {
    role: (localStorage.getItem('role') || '').toLowerCase(),
    userId: localStorage.getItem('userId')
  };
  const role = (auth.role || '').toLowerCase();

  // ✅ Solo admin, bank y promoter pueden crear
  const CAN_CREATE = role === 'admin' || role === 'bank' || role === 'promoter';

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

  const debounce = (fn, ms = 120) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

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
    return `<span class="badge">${escapeHtml(s)}</span>`;
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
    const typeText = p.projectType
      ? `Tipo de proyecto: ${escapeHtml(p.projectType)}`
      : '';

    return `
      <div class="card ${statusClass(p.status)}">
        <div class="portfolio-card-head">
          <h3 class="portfolio-card-title">${escapeHtml(p.name)}</h3>
          ${statusBadge(p.status)}
        </div>
        <div class="portfolio-card-meta">
          <p class="muted portfolio-card-description">${p.description ? escapeHtml(p.description) : ''}</p>
          <p class="small muted portfolio-card-type ${typeText ? '' : 'is-empty'}">${typeText || '&nbsp;'}</p>
          <p class="small muted portfolio-card-promoter ${promoterText ? '' : 'is-empty'}">${promoterText || '&nbsp;'}</p>
        </div>
        <div class="progress portfolio-card-progress"><div style="width:${soldPct}%"></div></div>
        <p class="small muted portfolio-card-sales">${p.unitsSold || 0}/${p.unitsTotal || 0} unidades vendidas (${soldPct}%)</p>
        <div class="row">
          <a class="btn" href="/project?id=${encodeURIComponent(p._id)}&ref=portfolio">Abrir</a>
        </div>
      </div>
    `;
  }

  // ===== Portfolio list + search =====
  let FULL_LIST = [];

  function renderList(list) {
    if (!Array.isArray(list) || list.length === 0) {
      container.innerHTML = '';
      if (banner) banner.style.display = 'block';
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
  const createBoardMembers = document.getElementById('createBoardMembers');
  const createShareholders = document.getElementById('createShareholders');
  const createHousingModels = document.getElementById('createHousingModels');
  const CREATE_STEP_ORDER = ['general', 'legal', 'technical', 'models', 'financial', 'team'];
  let activeCreateStep = 'general';

  function setCreateStep(step) {
    activeCreateStep = CREATE_STEP_ORDER.includes(step) ? step : 'general';
    createStepTabs.forEach(btn => btn.classList.toggle('active', btn.dataset.createStep === activeCreateStep));
    createStepPanels.forEach(panel => panel.classList.toggle('active', panel.dataset.createPanel === activeCreateStep));
    const idx = CREATE_STEP_ORDER.indexOf(activeCreateStep);
    if (prevCreateStepBtn) prevCreateStepBtn.disabled = idx <= 0;
    if (nextCreateStepBtn) nextCreateStepBtn.style.display = idx >= CREATE_STEP_ORDER.length - 1 ? 'none' : '';
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

  function createFacilityRow(item = {}) {
    return `<div class="create-facility-row" data-create-facility-row>
      <label>Tipo de facilidad<input data-create-facility="facilityType" list="createFacilityTypes" value="${escapeHtml(item.facilityType || '')}"></label>
      <label>Destino del préstamo<input data-create-facility="loanPurpose" value="${escapeHtml(item.loanPurpose || '')}"></label>
      <label>% financiado por banco<input data-create-facility="bankFinancedPct" type="number" step="any" value="${item.bankFinancedPct ?? ''}"></label>
      <label>% CPP/ventas a amortización<input data-create-facility="cppSalesAmortizationPct" type="number" step="any" value="${item.cppSalesAmortizationPct ?? ''}"></label>
      <label>Aporte requerido promotor<input data-create-facility="promoterRequiredContribution" type="number" step="any" value="${item.promoterRequiredContribution ?? ''}"></label>
      <button class="btn ghost" type="button" data-remove-create-facility>Quitar</button>
    </div>`;
  }

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

  function createHousingModelRow(item = {}) {
    return `<div class="create-repeat-row create-model-row" data-create-model-row>
      <label>Modelo<input data-create-model="name" value="${escapeHtml(item.name || '')}"></label>
      <label>Recamaras<input data-create-model="bedrooms" type="number" min="0" step="1" value="${item.bedrooms ?? ''}"></label>
      <label>Banos<input data-create-model="bathrooms" type="number" min="0" step="any" value="${item.bathrooms ?? ''}"></label>
      <label>Cantidad unidades<input data-create-model="unitsCount" type="number" min="0" step="1" value="${item.unitsCount ?? ''}"></label>
      <label>Area abierta m2<input data-create-model="openAreaM2" type="number" min="0" step="any" value="${item.openAreaM2 ?? ''}"></label>
      <label>Area cerrada m2<input data-create-model="closedAreaM2" type="number" min="0" step="any" value="${item.closedAreaM2 ?? ''}"></label>
      <label>Precio<input data-create-model="price" type="number" min="0" step="any" value="${item.price ?? ''}"></label>
      <label>Observaciones<input data-create-model="observations" value="${escapeHtml(item.observations || '')}"></label>
      <button class="btn ghost" type="button" data-remove-create-row>Quitar</button>
    </div>`;
  }

  function numberFromCreate(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function collectLegalData() {
    const trustApplies = document.getElementById('ld-trustApplies')?.value === 'true';
    return {
      promoterLegalName: document.getElementById('ld-promoterLegalName')?.value?.trim() || '',
      interimBank: document.getElementById('ld-interimBank')?.value?.trim() || '',
      trustApplies,
      trustName: trustApplies ? (document.getElementById('ld-trustName')?.value?.trim() || '') : '',
      boardMembers: Array.from(document.querySelectorAll('[data-create-board-row]')).map(row => ({
        name: row.querySelector('[data-create-board="name"]')?.value.trim() || '',
        cedula: row.querySelector('[data-create-board="cedula"]')?.value.trim() || '',
        position: row.querySelector('[data-create-board="position"]')?.value.trim() || ''
      })),
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
      notes: document.getElementById('td-notes')?.value?.trim() || ''
    };
  }

  function collectHousingModels() {
    return Array.from(document.querySelectorAll('[data-create-model-row]')).map(row => ({
      name: row.querySelector('[data-create-model="name"]')?.value.trim() || '',
      bedrooms: numberFromCreate(row.querySelector('[data-create-model="bedrooms"]')?.value),
      bathrooms: numberFromCreate(row.querySelector('[data-create-model="bathrooms"]')?.value),
      unitsCount: numberFromCreate(row.querySelector('[data-create-model="unitsCount"]')?.value),
      openAreaM2: numberFromCreate(row.querySelector('[data-create-model="openAreaM2"]')?.value),
      closedAreaM2: numberFromCreate(row.querySelector('[data-create-model="closedAreaM2"]')?.value),
      price: numberFromCreate(row.querySelector('[data-create-model="price"]')?.value),
      observations: row.querySelector('[data-create-model="observations"]')?.value.trim() || ''
    })).filter(item => item.name || item.unitsCount || item.price || item.openAreaM2 || item.closedAreaM2);
  }

  function syncTechnicalUnitsFromModels() {
    const totalEl = document.getElementById('td-totalUnits');
    if (!totalEl || String(totalEl.value || '').trim()) return;
    const total = collectHousingModels().reduce((sum, item) => sum + numberFromCreate(item.unitsCount), 0);
    if (total) totalEl.value = total;
  }

  document.getElementById('addCreateBoardMember')?.addEventListener('click', () => createBoardMembers?.insertAdjacentHTML('beforeend', createBoardMemberRow()));
  document.getElementById('addCreateShareholder')?.addEventListener('click', () => createShareholders?.insertAdjacentHTML('beforeend', createShareholderRow()));
  document.getElementById('addCreateHousingModel')?.addEventListener('click', () => createHousingModels?.insertAdjacentHTML('beforeend', createHousingModelRow()));
  [createBoardMembers, createShareholders, createHousingModels].forEach(container => {
    container?.addEventListener('click', event => {
      event.target.closest('[data-remove-create-row]')?.closest('.create-repeat-row')?.remove();
      syncTechnicalUnitsFromModels();
    });
  });
  createHousingModels?.addEventListener('input', syncTechnicalUnitsFromModels);

  document.getElementById('addCreateFacility')?.addEventListener('click', () => createFacilities?.insertAdjacentHTML('beforeend', createFacilityRow()));
  createFacilities?.addEventListener('click', event => {
    event.target.closest('[data-remove-create-facility]')?.closest('[data-create-facility-row]')?.remove();
  });

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
    modal.classList.remove('is-fullscreen');
    if (btnExpandCreate) { btnExpandCreate.textContent = '⛶'; btnExpandCreate.title = 'Pantalla completa'; }
    modal.classList.add('show');
    setCreateStep('general');
    if (createFacilities && !createFacilities.children.length) createFacilities.insertAdjacentHTML('beforeend', createFacilityRow());
    if (createBoardMembers && !createBoardMembers.children.length) createBoardMembers.insertAdjacentHTML('beforeend', createBoardMemberRow());
    if (createShareholders && !createShareholders.children.length) createShareholders.insertAdjacentHTML('beforeend', createShareholderRow());
    if (createHousingModels && !createHousingModels.children.length) createHousingModels.insertAdjacentHTML('beforeend', createHousingModelRow());

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
    if (btnCancel) btnCancel.addEventListener('click', closeModal);
    if (btnCloseCreate) btnCloseCreate.addEventListener('click', closeModal);
    if (btnExpandCreate) btnExpandCreate.addEventListener('click', () => {
      modal.classList.toggle('is-fullscreen');
      const full = modal.classList.contains('is-fullscreen');
      btnExpandCreate.textContent = full ? '□' : '⛶';
      btnExpandCreate.title = full ? 'Restaurar tamaño' : 'Pantalla completa';
    });

    if (btnCreate) {
      btnCreate.addEventListener('click', async () => {
        try {
          const name = document.getElementById('pName')?.value?.trim() || '';
          const description = document.getElementById('pDesc')?.value?.trim() || '';
          const status = document.getElementById('pStatus')?.value || 'EN_CURSO';
          const projectType = document.getElementById('pProjectType')?.value || '';

          // (Estos inputs no están en tu HTML actual, pero lo mantengo sin romper)
          const kLoan = document.getElementById('kLoanApproved');
          const kBudg = document.getElementById('kBudgetApproved');
          const loanApproved = kLoan ? Number(kLoan.value || 0) : 0;
          const budgetApproved = kBudg ? Number(kBudg.value || 0) : 0;

          const conditionNumbers = ['projectTotal','bankFinancedAmount','bankFinancedPct','promoterContribution','promoterContributionPct','interestRate'];
          const conditionTexts = ['term','paymentMethod','commission','disbursementMethod','disbursementConditions','amortizationConditions','requiredPresales','guarantees','insurance'];
          const financialConditions = {};
          conditionNumbers.forEach(key => {
            const raw = document.getElementById(`fc-${key}`)?.value;
            if (raw !== '' && raw != null && Number.isFinite(Number(raw))) financialConditions[key] = Number(raw);
          });
          conditionTexts.forEach(key => {
            financialConditions[key] = document.getElementById(`fc-${key}`)?.value?.trim() || '';
          });
          financialConditions.facilities = Array.from(document.querySelectorAll('[data-create-facility-row]')).map(row => ({
            facilityType: row.querySelector('[data-create-facility="facilityType"]')?.value.trim() || '',
            loanPurpose: row.querySelector('[data-create-facility="loanPurpose"]')?.value.trim() || '',
            bankFinancedPct: Number(row.querySelector('[data-create-facility="bankFinancedPct"]')?.value || 0),
            cppSalesAmortizationPct: Number(row.querySelector('[data-create-facility="cppSalesAmortizationPct"]')?.value || 0),
            promoterRequiredContribution: Number(row.querySelector('[data-create-facility="promoterRequiredContribution"]')?.value || 0)
          }));
          financialConditions.precedentConditions = {};
          document.querySelectorAll('[data-create-precedent]').forEach(input => { financialConditions.precedentConditions[input.dataset.createPrecedent] = input.checked; });
          financialConditions.precedentConditions.otherRequirements = document.getElementById('fc-otherRequirements')?.value?.trim() || '';
          financialConditions.operationStructure = {
            trustee: document.getElementById('fc-trustee')?.value?.trim() || '',
            trustType: document.getElementById('fc-trustType')?.value?.trim() || '',
            technicalInspector: document.getElementById('fc-technicalInspector')?.value?.trim() || '',
            financialInspector: document.getElementById('fc-financialInspector')?.value?.trim() || ''
          };

          if (!name) return alert('El nombre es obligatorio.');

          const payload = {
            name,
            description,
            projectType,
            status,
            loanApproved,
            budgetApproved,
            legalData: collectLegalData(),
            technicalData: collectTechnicalData(),
            housingModels: collectHousingModels(),
            financialConditions,
            teamSuggestion: collectTeamSuggestion()
          };

          await API.post('/api/projects', payload);

          closeModal();

          // reset campos
          ['pName', 'pDesc', 'pProjectType', 'kLoanApproved', 'kBudgetApproved', 'ts-promoter', 'ts-commercial', 'ts-legal', 'ts-tecnico', 'ts-gerencia', 'ts-socios', 'ts-financiero', 'ts-contable', 'ts-notes', ...conditionNumbers.map(x => `fc-${x}`), ...conditionTexts.map(x => `fc-${x}`)].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
          });

          const st = document.getElementById('pStatus');
          if (st) st.value = 'EN_CURSO';
          if (createFacilities) createFacilities.innerHTML = '';
          if (createBoardMembers) createBoardMembers.innerHTML = '';
          if (createShareholders) createShareholders.innerHTML = '';
          if (createHousingModels) createHousingModels.innerHTML = '';
          document.querySelectorAll('[data-create-precedent]').forEach(input => { input.checked = false; });
          ['fc-otherRequirements','fc-trustee','fc-trustType','fc-technicalInspector','fc-financialInspector','ld-promoterLegalName','ld-interimBank','ld-trustName','td-phasesCount','td-totalUnits','td-notes'].forEach(fieldId => {
            const field = document.getElementById(fieldId); if (field) field.value = '';
          });
          const trustApplies = document.getElementById('ld-trustApplies');
          if (trustApplies) trustApplies.value = 'false';
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
        }
      });
    }
  } else {
    // 🔒 otros roles: quitar FAB y modal
    if (fab && fab.parentNode) fab.parentNode.removeChild(fab);
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
  }

  // Init
  await loadList();

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      API.logout();
      location.href = '/';
    });
  }
})();
