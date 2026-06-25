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
  const createPromoterProfiles = new Map();
  let createPromoterProfilesLoaded = false;

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
    const displayProjectType = p.projectType || p.tipoProyecto || '';
    const typeText = displayProjectType
      ? `Tipo de proyecto: ${escapeHtml(displayProjectType)}`
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
  const createFinancePhases = document.getElementById('createFinancePhases');
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

  async function loadCreatePromoterProfiles() {
    const select = document.getElementById('ld-promoterProfileSelect');
    if (!select || createPromoterProfilesLoaded) return;
    if (!(role === 'admin' || role === 'bank')) {
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
        const company = user.promoterProfile?.companyName || '';
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
      initialStatuses: Object.fromEntries(Array.from(row.querySelectorAll('[data-create-model-status]')).map(input => [
        input.dataset.createModelStatus,
        numberFromCreate(input.value)
      ])),
      observations: row.querySelector('[data-create-model="observations"]')?.value.trim() || ''
    })).filter(item => item.name || item.unitsCount || item.price || item.openAreaM2 || item.closedAreaM2);
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
    const totalEl = document.getElementById('td-totalUnits');
    if (!totalEl || String(totalEl.value || '').trim()) return;
    const total = collectHousingModels().reduce((sum, item) => sum + numberFromCreate(item.unitsCount), 0);
    if (total) totalEl.value = total;
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
  }

  ['fc-projectTotal'].forEach(fieldId => {
    document.getElementById(fieldId)?.setAttribute('data-bank-number', '');
  });
  bindBankNumberFormatting();

  ['fc-projectTotal'].forEach(fieldId => {
    document.getElementById(fieldId)?.addEventListener('input', () => syncFinancialTriplet(fieldId));
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

  const DEFAULT_PHASE_FINANCING_LINES = ['Terreno', 'Infraestructura', 'Construccion', 'Costos directos', 'Costos indirectos', 'Otra'];
  const PHASE_FINANCING_GRID = 'display:grid;grid-template-columns:minmax(150px,1.1fr) 120px 110px 110px minmax(180px,1fr) minmax(200px,1fr) 110px minmax(180px,1fr) 76px;gap:6px;align-items:start;min-width:1250px;';
  const PHASE_FINANCING_HEADER = `
    <div style="${PHASE_FINANCING_GRID}font-size:.72rem;font-weight:700;color:#475569;margin-bottom:6px;">
      <span>Nombre/facilidad</span><span>Monto</span><span>Tasa</span><span>Plazo</span><span>Forma de pago</span><span>Forma de desembolso</span><span>Comision</span><span>Observaciones</span><span></span>
    </div>
  `;

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
      const rows = items.length ? items : [{ name: '', amount: '' }];
      return rows.map(row => `
        <div style="display:grid;grid-template-columns:1fr 140px;gap:8px;margin-bottom:6px;" data-create-phase-line="${kind}">
          <input data-create-phase-line-name placeholder="Concepto" value="${escapeHtml(row.name || '')}">
          <input data-create-phase-line-amount data-bank-number type="text" inputmode="decimal" placeholder="Monto" value="${row.amount ? formatBankNumber(row.amount) : ''}">
        </div>
      `).join('');
    };
    const condition = item.financialConditions || {};
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
    const financingRows = (Array.isArray(item.financingLines) && item.financingLines.length ? item.financingLines : DEFAULT_PHASE_FINANCING_LINES.map(name => ({ name }))).map(line => `
      <div data-create-phase-financing-line style="${PHASE_FINANCING_GRID}margin-bottom:6px;">
        <input data-create-phase-financing="name" placeholder="Terreno" value="${escapeHtml(line.name || '')}">
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
    return `<details open class="create-phase-block" data-create-phase-row="${index}" style="border:1px solid #dbe2ea;border-radius:12px;padding:10px;margin-bottom:10px;background:#fff;">
      <summary><strong>${escapeHtml(item.name || `Fase ${index + 1}`)}</strong></summary>
      <div class="create-grid" style="margin-top:10px;">
        <label>Nombre<input data-create-phase="name" value="${escapeHtml(item.name || `Fase ${index + 1}`)}"></label>
        <label>Banco/interino<input data-create-phase-condition="interimBank" placeholder="Banco General / Banistmo" value="${escapeHtml(condition.interimBank || '')}"></label>
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
        <label style="grid-column:1/-1">Lineas de financiacion aprobadas
          <div style="overflow-x:auto;padding-bottom:4px;">${PHASE_FINANCING_HEADER}<div data-create-phase-financing-lines>${financingRows}</div></div>
          <div class="small" data-phase-financing-lines-summary style="margin-top:6px;color:#475569;"></div>
          <button class="btn ghost" type="button" data-add-phase-financing-line>+ Linea</button>
        </label>
        <div style="grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">
          ${PHASE_CONDITION_FIELDS.map(conditionField).join('')}
        </div>
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
    document.querySelectorAll('[data-create-phase-row]').forEach(row => {
      const usesTotal = phaseUsesTotal(row);
      syncPhaseFinancialTriplet(row);
      const phaseFinancial = currentPhaseFinancialNumbers(row);
      const sources = autoPhaseSourcesForUses(usesTotal, phaseFinancial);
      const bank = sources.find(item => item.name === 'Banco')?.amount || 0;
      const promoter = sources.find(item => item.name === 'Promotor')?.amount || 0;
      const total = bank + promoter;
      const linesTotal = phaseFinancingLinesTotal(row);
      const linesDiff = bank - linesTotal;
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
      const lineSummary = row.querySelector('[data-phase-financing-lines-summary]');
      if (lineSummary) {
        const ok = Math.abs(linesDiff) <= 0.05 || (!bank && !linesTotal);
        lineSummary.style.color = ok ? '#166534' : '#92400e';
        lineSummary.innerHTML = `Banco fase: <b>${formatBankNumber(bank)}</b> &middot; Lineas aprobadas: <b>${formatBankNumber(linesTotal)}</b>${ok ? '' : ` &middot; Diferencia: <b>${formatBankNumber(linesDiff)}</b>`}`;
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

  function syncCreateFinancePhases() {
    if (!createFinancePhases) return;
    const count = Math.max(0, Math.round(numberFromCreate(document.getElementById('td-phasesCount')?.value)));
    const current = collectFinancePhases();
    createFinancePhases.innerHTML = Array.from({ length: count }, (_, idx) => createPhaseFinanceBlock(idx, current[idx] || {})).join('');
    bindBankNumberFormatting(createFinancePhases);
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
      out[input.dataset.createPhaseCondition] = input.value?.trim() || '';
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
    return Array.from(document.querySelectorAll('[data-create-phase-row]')).map((row, idx) => ({
      name: row.querySelector('[data-create-phase="name"]')?.value.trim() || `Fase ${idx + 1}`,
      planUses: collectPhaseLineItems(row, 'planUses'),
      planSources: autoPhaseSourcesForUses(phaseUsesTotal(row), currentPhaseFinancialNumbers(row)),
      financialConditions: collectPhaseFinancialConditions(row),
      financingLines: collectPhaseFinancingLines(row)
    }));
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
      if ((bankAmount > 0 || financingLinesTotal > 0) && !close(bankAmount, financingLinesTotal)) {
        return fail(`En ${phase.name}, la suma de lineas aprobadas (${formatBankNumber(financingLinesTotal)}) debe coincidir con la financiacion bancaria de la fase (${formatBankNumber(bankAmount)}).`);
      }
    }
    return true;
  }

  document.getElementById('addCreateBoardMember')?.addEventListener('click', () => createBoardMembers?.insertAdjacentHTML('beforeend', createBoardMemberRow()));
  document.getElementById('addCreateShareholder')?.addEventListener('click', () => createShareholders?.insertAdjacentHTML('beforeend', createShareholderRow()));
  document.getElementById('addCreateHousingModel')?.addEventListener('click', () => {
    createHousingModels?.insertAdjacentHTML('beforeend', createHousingModelRow());
    bindBankNumberFormatting(createHousingModels || document);
  });
  [createBoardMembers, createShareholders, createHousingModels].forEach(container => {
    container?.addEventListener('click', event => {
      event.target.closest('[data-remove-create-row]')?.closest('.create-repeat-row')?.remove();
      syncTechnicalUnitsFromModels();
      validateCreateModelStatuses();
    });
  });
  createHousingModels?.addEventListener('input', () => {
    syncTechnicalUnitsFromModels();
    createHousingModels.querySelectorAll('[data-create-model-row]').forEach(row => syncCreateModelStatusRow(row, { autoFill: true }));
  });
  document.getElementById('td-phasesCount')?.addEventListener('input', syncCreateFinancePhases);
  createFinancePhases?.addEventListener('click', event => {
    const addBtn = event.target.closest('[data-add-create-phase-line]');
    const addFinancingBtn = event.target.closest('[data-add-phase-financing-line]');
    const removeFinancingBtn = event.target.closest('[data-remove-phase-financing-line]');
    if (addFinancingBtn) {
      const box = addFinancingBtn.closest('[data-create-phase-row]')?.querySelector('[data-create-phase-financing-lines]');
      box?.insertAdjacentHTML('beforeend', `
        <div data-create-phase-financing-line style="${PHASE_FINANCING_GRID}margin-bottom:6px;">
          <input data-create-phase-financing="name" placeholder="Terreno">
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
      bindBankNumberFormatting(createFinancePhases);
      return;
    }
    if (removeFinancingBtn) {
      removeFinancingBtn.closest('[data-create-phase-financing-line]')?.remove();
      return;
    }
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
    const financialInput = event.target?.closest?.('[data-create-phase-financial]');
    if (financialInput) {
      syncPhaseFinancialTriplet(financialInput.closest('[data-create-phase-row]'), financialInput.dataset.createPhaseFinancial);
    }
    syncCreatePhaseSources();
  });
  createFinancePhases?.addEventListener('change', syncCreatePhaseSources);
  createFinancePhases?.addEventListener('keyup', syncCreatePhaseSources);
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
    modal.classList.remove('is-fullscreen');
    if (btnExpandCreate) { btnExpandCreate.textContent = '⛶'; btnExpandCreate.title = 'Pantalla completa'; }
    modal.classList.add('show');
    setCreateStep('general');
    if (createBoardMembers && !createBoardMembers.children.length) createBoardMembers.insertAdjacentHTML('beforeend', createBoardMemberRow());
    if (createShareholders && !createShareholders.children.length) createShareholders.insertAdjacentHTML('beforeend', createShareholderRow());
    if (createHousingModels && !createHousingModels.children.length) createHousingModels.insertAdjacentHTML('beforeend', createHousingModelRow());
    bindBankNumberFormatting(modal);
    hideGlobalCreateFinancialConditionFields();
    await loadCreatePromoterProfiles();

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
    document.getElementById('ld-promoterProfileSelect')?.addEventListener('change', ev => {
      const user = createPromoterProfiles.get(String(ev.target.value || ''));
      const legalName = user?.promoterProfile?.companyName || '';
      const input = document.getElementById('ld-promoterLegalName');
      if (input && legalName) input.value = legalName;
    });
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
          const location = document.getElementById('pLocation')?.value?.trim() || '';
          const status = document.getElementById('pStatus')?.value || 'EN_CURSO';
          const projectType = document.getElementById('pProjectType')?.value || '';

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
          if (!validateCreateModelStatuses({ alertOnError: true })) return;
          if (!validateCreateFinancePhases({ alertOnError: true })) return;
          const legalData = collectLegalData();

          const payload = {
            name,
            description,
            descripcion: description,
            location,
            projectType,
            status,
            loanApproved,
            budgetApproved,
            legalData,
            legalCompanyName: legalData.promoterLegalName,
            technicalData: collectTechnicalData(),
            housingModels: collectHousingModels(),
            financePhases: collectFinancePhases(),
            financialConditions,
            teamSuggestion: collectTeamSuggestion()
          };

          await API.post('/api/projects', payload);

          closeModal();

          // reset campos
          ['pName', 'pDesc', 'pLocation', 'pProjectType', 'ld-promoterProfileSelect', 'kLoanApproved', 'kBudgetApproved', 'ts-promoter', 'ts-commercial', 'ts-legal', 'ts-tecnico', 'ts-gerencia', 'ts-socios', 'ts-financiero', 'ts-contable', 'ts-notes', ...conditionNumbers.map(x => `fc-${x}`), ...conditionTexts.map(x => `fc-${x}`)].forEach(id => {
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
