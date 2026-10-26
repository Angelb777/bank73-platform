// public/js/project.js
(async function () {
  if (!API.getToken()) {
    API.logout?.();
    location.replace('/login');
    return;
  }

  // ====== Parámetros URL y navegación ======
  const params = new URLSearchParams(location.search);
  const id   = params.get('id');
  const ref  = params.get('ref'); // 'dashboard' | 'portfolio' | null
  if (!id) { location.href = '/portfolio'; return; }

  function finishInitialProjectLoad() {
    window.scrollTo(0, 0);
    document.body.classList.remove('project-loading');
    document.getElementById('projectLoadingScreen')?.setAttribute('aria-hidden', 'true');
  }

  const backA = document.querySelector('.topbar .brand a.link');
  if (backA) backA.href = (ref === 'dashboard') ? '/dashboard' : '/portfolio';

  // ====== UI base ======
  const pname       = document.getElementById('pname');
  const pdesc       = document.getElementById('pdesc');
  const pdesc2      = document.getElementById('pdesc2');
  const kpisDiv     = document.getElementById('kpis');

  const statusWrap  = document.getElementById('statusControls');
  const statusSel   = document.getElementById('pstatusSel');
  const projectCurrencySel = document.getElementById('projectCurrencySel');
  const projectTypeText = document.getElementById('projectTypeText');
  const startBtn    = document.getElementById('startBtn');
  const projectAlertsBtn = document.getElementById('projectAlertsBtn');
  const projectCoverBtn = document.getElementById('projectCoverBtn');
  const projectCoverPreview = document.getElementById('projectCoverPreview');
  const projectCoverFallback = document.getElementById('projectCoverFallback');
  const projectCoverFile = document.getElementById('projectCoverFile');

  const disbRow     = document.getElementById('disbRow');
  const disbBtn     = document.getElementById('disbBtn');

  // ROLE-SEP: banner de revisión + usuario actual
const reviewBanner = document.getElementById('reviewBanner');
const currentUser = {
  role:   (localStorage.getItem('role')   || '').toLowerCase().trim(),
  status: (localStorage.getItem('status') || '').toLowerCase().trim()
};
const projectDashboardBtn = document.getElementById('projectDashboardBtn');
if (projectDashboardBtn && ['admin', 'bank'].includes(currentUser.role)) {
  projectDashboardBtn.style.display = '';
  projectDashboardBtn.addEventListener('click', () => { location.href = '/dashboard'; });
}

// Flag global (se setea tras cargar el proyecto)
window.__COMMERCIAL_LOCKED = false; // bloquea edición comercial si proyecto no aprobado


  // ====== Tabs (delegación robusta) ======
  const panes = {
    resumen:   document.getElementById('tab-resumen'),
    proyecto:  document.getElementById('tab-proyecto'),
    finanzas:  document.getElementById('tab-finanzas'),
    comercial: document.getElementById('tab-comercial'),
    tecnico:   document.getElementById('tab-tecnico'),
    proveedores: document.getElementById('tab-proveedores'),
    docs:      document.getElementById('tab-docs'),
    avaluadores: document.getElementById('tab-avaluadores'),
    chat:      document.getElementById('tab-chat'),
  };
  let __summaryDirty = false;
  let providersModuleEnabled = true;

  function applyProvidersModuleVisibility() {
    const btn = document.getElementById('tabBtn-proveedores');
    const pane = document.getElementById('tab-proveedores');
    if (!providersModuleEnabled && btn) btn.style.display = 'none';
    if (!providersModuleEnabled && pane) pane.style.display = 'none';
    if (!providersModuleEnabled && pane?.classList.contains('active')) {
      activateTab('resumen');
    }
  }

  async function syncProvidersModuleVisibility() {
    try {
      const settings = await API.get('/api/providers/module-settings');
      providersModuleEnabled = settings?.enabled !== false;
    } catch (err) {
      console.warn('[Providers] No se pudo cargar la visibilidad del módulo', err);
      providersModuleEnabled = false;
    }
    applyProvidersModuleVisibility();
  }

  const PROJECT_CURRENCIES = {
    PAB: { code: 'PAB', label: 'B/. Balboa', symbol: 'B/.' },
    USD: { code: 'USD', label: '$ Dolar estadounidense', symbol: '$' },
    EUR: { code: 'EUR', label: '€ Euro', symbol: '€' }
  };
  let currentProjectCurrency = 'PAB';
  let isProjectSettingsSaving = false;
  let isProjectCoverSaving = false;

  function normalizeProjectCurrency(value) {
    const code = String(value || '').trim().toUpperCase();
    return PROJECT_CURRENCIES[code] ? code : 'PAB';
  }

  function projectCurrencySymbol(currency = currentProjectCurrency) {
    return PROJECT_CURRENCIES[normalizeProjectCurrency(currency)].symbol;
  }

  function parsePanamaNumber(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const cleaned = String(value)
      .trim()
      .replace(/B\/\.|\$|€/gi, '')
      .replace(/\s/g, '')
      .replace(/,/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }

  function formatPanamaNumber(value, decimals = 2) {
    const n = typeof value === 'number' ? value : parsePanamaNumber(value);
    const safe = Number.isFinite(n) ? n : 0;
    return safe.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function formatProjectMoney(value, decimals = 2) {
    return `${projectCurrencySymbol()} ${formatPanamaNumber(value, decimals)}`;
  }

  function updateCurrencyControlMeta() {
    if (!projectCurrencySel) return;
    const meta = PROJECT_CURRENCIES[normalizeProjectCurrency(projectCurrencySel.value)];
    projectCurrencySel.title = meta.label;
    projectCurrencySel.closest('.currency-picker')?.setAttribute('title', meta.label);
  }

  const PROJECT_DATA_CACHE = Object.create(null);

  function invalidateProjectDataCache(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    list.filter(Boolean).forEach(key => {
      delete PROJECT_DATA_CACHE[key];
    });
  }

  async function cachedProjectGet(key, urlFactory, { force = false } = {}) {
    if (!key) return API.get(urlFactory());
    const current = PROJECT_DATA_CACHE[key];
    if (!force && current?.data !== undefined) return current.data;
    if (!force && current?.promise) return current.promise;

    const entry = PROJECT_DATA_CACHE[key] || {};
    entry.promise = API.get(urlFactory()).then(data => {
      entry.data = data;
      entry.promise = null;
      PROJECT_DATA_CACHE[key] = entry;
      return data;
    }).catch(err => {
      if (PROJECT_DATA_CACHE[key] === entry) entry.promise = null;
      throw err;
    });
    PROJECT_DATA_CACHE[key] = entry;
    return entry.promise;
  }

  function cacheBustQuery(force) {
    return force ? `&ts=${Date.now()}` : '';
  }

  function getProjectUnitsAll({ force = false } = {}) {
    return cachedProjectGet(
      'unitsAll',
      () => `/api/units?projectId=${id}${cacheBustQuery(force)}`,
      { force }
    );
  }

  function getProjectVentas({ force = false } = {}) {
    return cachedProjectGet(
      'ventas',
      () => `/api/ventas?projectId=${id}${cacheBustQuery(force)}`,
      { force }
    );
  }

  function getProjectPortfolio({ force = false } = {}) {
    return cachedProjectGet(
      'portfolio',
      () => `/api/projects/portfolio${force ? `?ts=${Date.now()}` : ''}`,
      { force }
    );
  }

  function getProjectFinanceSnapshot({ force = false } = {}) {
    return cachedProjectGet(
      'finance',
      () => `/api/projects/${id}/finance${force ? `?ts=${Date.now()}` : ''}`,
      { force }
    );
  }

  async function refreshSummaryFromServer() {
    if (typeof loadSummary === 'function') {
      await loadSummary();
      __summaryDirty = false;
      return;
    }

    const payload = await API.get(`/api/projects/${id}/summary?ts=${Date.now()}`);
    window.__LAST_SUMMARY_PAYLOAD__ = payload;
    if (typeof renderSummaryUI === 'function') await renderSummaryUI(payload);
    if (typeof renderResumen === 'function') await renderResumen(payload);
    if (typeof renderSummary === 'function') await renderSummary(payload);
    __summaryDirty = false;
  }

  async function markProjectDataChanged({ refreshSummary = false, refreshHeader = true } = {}) {
    __summaryDirty = true;
    invalidateProjectDataCache(['unitsAll', 'ventas', 'portfolio', 'finance']);

    try {
      if (refreshHeader && typeof refreshTopHeaderKpis === 'function') {
        await refreshTopHeaderKpis();
      }

      const resumenActive = !!panes.resumen?.classList.contains('active');
      if (refreshSummary || resumenActive) {
        await refreshSummaryFromServer();
      }
      window.__PROJECT_3D?.refresh?.();
    } catch (e) {
      console.warn('[Project] No se pudo refrescar el resumen tras guardar cambios', e);
    }
  }

  const PROVIDER_STAGES = [
    { title: 'Antes de comprar el suelo', accent: '#22c55e', services: ['Urbanista', 'Arquitecto', 'Estudio de viabilidad', 'Tasador', 'Abogado urbanístico'] },
    { title: 'Desarrollo del proyecto', accent: '#3b82f6', services: ['Arquitecto', 'Ingeniero', 'Topógrafo', 'Geotécnico', 'Licencias', 'Consultores'] },
    { title: 'Financiación', accent: '#a855f7', services: ['Bancos', 'Fideicomisos', 'Avales', 'Seguros', 'Due diligence'] },
    { title: 'Construcción', accent: '#f59e0b', services: ['Constructora', 'Dirección facultativa', 'Project Manager', 'Seguridad y salud', 'Laboratorio de materiales', 'Organismo de control'] },
    { title: 'Seguimiento', accent: '#06b6d4', services: ['Banco', 'Promotor', 'Avaluador', 'Inspector', 'Fotografías', 'Informes', 'Desembolsos'] },
    { title: 'Comercialización', accent: '#ef4444', services: ['CRM', 'Comercializadora', 'Tour 3D', 'Marketing', 'Hipotecas para compradores'] },
    { title: 'Entrega', accent: '#64748b', services: ['Notaría', 'Escrituración', 'Registro', 'Postventa'] },
  ];
  let activeProviderService = null;
  let providersCache = null;
  let providersLoading = null;

  function providerInitials(name) {
    return String(name || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase() || 'B73';
  }

  function providerLogoSrc(name, color = '#2563eb') {
    const initials = providerInitials(name);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 112 112"><rect width="112" height="112" rx="24" fill="${color}"/><circle cx="88" cy="24" r="18" fill="rgba(255,255,255,.18)"/><text x="56" y="66" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" font-weight="800" fill="#fff">${initials}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function providerSlug(stageTitle, service) {
    return `${stageTitle}::${service}`;
  }

  function findProviderService(slug) {
    for (const stage of PROVIDER_STAGES) {
      const service = stage.services.find(item => providerSlug(stage.title, item) === slug);
      if (service) return { stage, service };
    }
    return null;
  }

  async function loadProviders({ force = false } = {}) {
    if (!force && Array.isArray(providersCache)) return providersCache;
    if (!force && providersLoading) return providersLoading;
    providersLoading = API.get('/api/providers?active=true')
      .then(data => {
        providersCache = Array.isArray(data?.providers) ? data.providers : [];
        providersLoading = null;
        return providersCache;
      })
      .catch(err => {
        providersLoading = null;
        throw err;
      });
    return providersLoading;
  }

  function providerLocation(provider = {}) {
    return [provider.city, provider.country].filter(Boolean).join(', ') || '—';
  }

  async function renderProvidersDetail(slug) {
    const detail = document.getElementById('providersDetail');
    if (!detail) return;
    const match = findProviderService(slug);
    if (!match) {
      detail.classList.remove('active');
      detail.innerHTML = '';
      return;
    }

    activeProviderService = slug;
    document.querySelectorAll('.providers-service-card').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.providerService === slug);
    });

    detail.classList.add('active');
    detail.innerHTML = '<div class="small muted">Cargando proveedores...</div>';

    let providers = [];
    try {
      const allProviders = await loadProviders();
      providers = allProviders.filter(provider =>
        provider?.isActive !== false &&
        provider.stage === match.stage.title &&
        provider.serviceType === match.service
      );
    } catch (err) {
      console.error('[Providers] No se pudieron cargar proveedores', err);
      detail.innerHTML = '<div class="small muted">No se pudieron cargar los proveedores.</div>';
      return;
    }

    detail.innerHTML = `
      <div class="providers-detail-head">
        <div>
          <h3>${escapeHtml(match.service)}</h3>
          <div class="small muted">${escapeHtml(match.stage.title)}</div>
        </div>
        <button type="button" class="btn btn-ghost btn-xs" id="providersCloseDetail">Cerrar</button>
      </div>
      ${providers.length ? `
      <div class="providers-detail-grid">
        ${providers.map(provider => `
          <article class="provider-card">
            <div class="provider-card-head">
              <img class="provider-logo" src="${escapeHtml(provider.logoUrl || providerLogoSrc(provider.commercialName))}" alt="Logo de ${escapeHtml(provider.commercialName)}">
              <h4 class="provider-name">${escapeHtml(provider.commercialName)}</h4>
            </div>
            <p class="provider-description">${escapeHtml(provider.description)}</p>
            <div class="provider-meta">
              <div class="provider-meta-row"><span>Ubicación</span><strong>${escapeHtml(providerLocation(provider))}</strong></div>
              <div class="provider-meta-row"><span>Experiencia</span><strong>${escapeHtml(provider.specialty)}</strong></div>
            </div>
            <div class="provider-exclusive">${escapeHtml(provider.exclusiveCondition)}</div>
            <button type="button" class="btn provider-budget-btn" data-provider-id="${escapeHtml(provider._id)}">Solicitar presupuesto</button>
          </article>
        `).join('')}
      </div>
      ` : '<div class="small muted">Próximamente incorporaremos proveedores para este servicio.</div>'}
    `;
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderProvidersTab() {
    const host = document.getElementById('providersStages');
    if (!host || host.dataset.rendered === '1') return;
    host.dataset.rendered = '1';
    host.innerHTML = PROVIDER_STAGES.map(stage => `
      <section class="providers-stage" style="--provider-accent:${stage.accent};">
        <div class="providers-stage-head">
          <h3 class="providers-stage-title">${escapeHtml(stage.title)}</h3>
          <span class="providers-stage-count">${stage.services.length} servicios</span>
        </div>
        <div class="providers-service-grid">
          ${stage.services.map(service => `
            <button type="button" class="providers-service-card" data-provider-service="${escapeHtml(providerSlug(stage.title, service))}">
              <strong>${escapeHtml(service)}</strong>
              <span aria-hidden="true">+</span>
            </button>
          `).join('')}
        </div>
      </section>
    `).join('');

    if (!host.__providersBound) {
      host.__providersBound = true;
      document.getElementById('tab-proveedores')?.addEventListener('click', (ev) => {
        const serviceBtn = ev.target.closest('.providers-service-card[data-provider-service]');
        if (serviceBtn) {
          renderProvidersDetail(serviceBtn.dataset.providerService).catch(err => console.error('[Providers] detail', err));
          return;
        }

        const closeBtn = ev.target.closest('#providersCloseDetail');
        if (closeBtn) {
          activeProviderService = null;
          document.querySelectorAll('.providers-service-card.active').forEach(btn => btn.classList.remove('active'));
          const detail = document.getElementById('providersDetail');
          if (detail) {
            detail.classList.remove('active');
            detail.innerHTML = '';
          }
          return;
        }

        const budgetBtn = ev.target.closest('.provider-budget-btn[data-provider-id]');
        if (budgetBtn) {
          const providerId = budgetBtn.dataset.providerId;
          const comments = prompt('Comentarios para la solicitud (opcional):', '');
          if (comments === null) return;
          budgetBtn.disabled = true;
          const originalText = budgetBtn.textContent;
          budgetBtn.textContent = 'Enviando...';
          API.post(`/api/providers/${encodeURIComponent(providerId)}/requests`, {
            projectId: id,
            comments: String(comments || '').trim()
          }).then(() => {
            budgetBtn.textContent = 'Solicitud enviada';
            setTimeout(() => { budgetBtn.textContent = originalText; budgetBtn.disabled = false; }, 1600);
          }).catch(err => {
            console.error('[Providers] solicitud', err);
            budgetBtn.textContent = originalText;
            budgetBtn.disabled = false;
            alert('No se pudo registrar la solicitud.');
          });
          return;
        }

      });
    }

    if (activeProviderService) renderProvidersDetail(activeProviderService).catch(err => console.error('[Providers] detail', err));
  }

  function activateTab(key){
    if (key === 'proveedores' && !providersModuleEnabled) key = 'resumen';
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === key));
    Object.entries(panes).forEach(([k,el]) => el && el.classList.toggle('active', k === key));
    if (key === 'proveedores') renderProvidersTab();
    if (key === 'tecnico' && typeof loadTechnicalWorkspace === 'function') {
      loadTechnicalWorkspace().catch(e => console.error('[Técnico] No se pudo cargar el workspace', e));
    }
    if (key === 'docs' && window.__docsModuleReady && typeof loadDocs === 'function') {
      invalidateProjectDocsCache();
      loadDocs({ q: (document.getElementById('docsSearch')?.value || '') }).catch(e => {
        console.warn('[Docs] No se pudo refrescar al abrir la pestana', e);
      });
    }
    if (key === 'resumen' && __summaryDirty) {
      refreshSummaryFromServer().catch(e => {
        console.warn('[Summary] No se pudo refrescar al abrir la pestana resumen', e);
      });
    }
    window.__PROJECT_3D?.setModeFromTab?.(key);
  }
  document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.tab[data-tab]');
  if (!btn) return;
  ev.preventDefault();
  const key = btn.dataset.tab;
  activateTab(key);
  if (key === 'chat') loadChatMessages({ append:false }); // 👈
  });
  activateTab(document.querySelector('.tab.active')?.dataset.tab || 'resumen');

  setTimeout(() => bindDatoUnicoImportControls(), 0);

const modalBackdrop = document.getElementById('modalBackdrop');
const modalTitle    = document.getElementById('modalTitle');
const modalBody     = document.getElementById('modalBody');
const modalPrimary  = document.getElementById('modalPrimary');
const modalCloseBtn = document.getElementById('modalClose');

if (modalCloseBtn && modalBackdrop) {
  modalCloseBtn.onclick = () => {
    const wasPermits = /permisos/i.test(modalTitle?.textContent || '');
    modalBackdrop.style.display = 'none';
    if (wasPermits) window.refreshTechnicalWorkspace?.({ force:true, preserveSelection:true });
  };
}

function openModal(title, bodyHTML, primaryText = 'Guardar', onPrimary = null) {
  if (!modalBackdrop || !modalTitle || !modalBody || !modalPrimary) {
    console.warn('[modal] Falta el esqueleto del modal en el HTML');
    alert('No se puede abrir el modal: falta el contenedor en la página.');
    return;
  }
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHTML;

  const addBtn = document.getElementById('permAddFromTpl');
if (addBtn) {
  addBtn.onclick = async () => {
    const box = document.getElementById('permAddBox');
    box.textContent = 'Cargando plantillas…';
    try {
      const tpls = await apiPermitsGetTemplates();
      box.innerHTML = `
        <select id="permTplSel2" class="w-100" style="max-width:360px;">
          ${tpls.map(t => `<option value="${t._id}">${t.name} (v${t.version||1})</option>`).join('')}
        </select>
        <button class="btn btn-xs" id="permTplApply2">Agregar</button>
      `;
      document.getElementById('permTplApply2').onclick = async () => {
        const tplId = document.getElementById('permTplSel2').value;
        await apiPermitsInit(tplId);              // 👈 tu endpoint ya hace el merge por code
        __permits = await apiPermitsGetProject(true);
        renderPermitsModal();
        await reloadProyecto(false);
        await markProjectDataChanged({ refreshSummary: true });
      };
    } catch (e) {
      console.error(e);
      box.textContent = 'No se pudieron cargar las plantillas';
    }
  };
}

  // añade esto UNA VEZ, después de declarar modalBody (p.ej. debajo de openModal)
if (!modalBody.__permitsBound) {
  modalBody.__permitsBound = true;

  // change en cualquier select de estado
  modalBody.addEventListener('change', async (ev) => {
    const sel = ev.target.closest('select.perm-state');
    if (!sel) return;
    const code = sel.dataset.code;
    const status = sel.value;

    try {
  await apiPermitsPatchItem(code, { status });      // 1) guarda en BD

  __permits = await apiPermitsGetProject(true);     // 2) lee fresco (modal)
  renderPermitsModal();                             // 3) repinta modal

  // 4) ✅ refresca RESUMEN (gráficas)
  await markProjectDataChanged({ refreshSummary: true });

} catch (e) {
  console.error(e);
  alert('No se pudo actualizar el estado.');
}
  });

  // clicks delegados (desbloquear / adjuntar), si quieres mantenerlos aquí
  // 🔁 REEMPLAZA tu handler actual de clicks delegados por ESTE:
modalBody.addEventListener('click', (ev) => {
  // 1) desbloqueo manual (igual que antes)
  const unlockBtn = ev.target.closest('.js-unlock');
  if (unlockBtn) {
    const code = unlockBtn.dataset.code;
    if (!confirm('¿Desbloquear este trámite manualmente para trabajar en paralelo?')) return;
    __permitsUnlockOverrides.add(code);
    renderPermitsModal();
    return;
  }

  // 2) Adjuntar documentos por TRÁMITE (sin panel global)
  const docsBtn = ev.target.closest('.js-perm-docs');
  if (docsBtn) {
    ev.preventDefault();
    ev.stopPropagation();

    const code = docsBtn.dataset.code; // por si luego guardamos permitCode en backend
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = true;

    picker.onchange = async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;

      // fecha de caducidad opcional (YYYY-MM-DD)
      let expiry = prompt('Fecha de caducidad (YYYY-MM-DD, opcional):', '');
      expiry = (expiry || '').trim();
      if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
        alert('Formato inválido. Usa YYYY-MM-DD o deja vacío.');
        return;
      }

      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      fd.append('projectId', id);
      fd.append('category', 'permits');
      if (expiry) fd.append('expiryDate', expiry);

      // 👉 Si añades "permitCode" en el backend, entonces:
      fd.append('permitCode', code);

      try {
        const headers = { ...authHeaders(), ...tenantHeaders() }; // ya los tienes definidos en tu archivo
        const resp = await fetch('/api/documents/upload', {
          method: 'POST',
          body: fd,
          headers,
          credentials: 'include'
        });
        const data = await resp.json().catch(()=> ({}));
        if (!resp.ok) {
          if (data?.error === 'Falta projectId') return alert('Falta projectId en la subida.');
          if (data?.error === 'Falta archivo(s)') return alert('No llegaron archivos al servidor.');
          throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
        }
        // feedback sutil
        docsBtn.textContent = '✅ Adjuntado';
        setTimeout(() => { docsBtn.textContent = '📎 Adjuntar'; }, 1500);
      } catch (err) {
        console.error('[permits.item.upload]', err);
        alert('No se pudo subir el/los archivo(s).');
      }
    };

    picker.click(); // abre el selector
  }
});

}

  // --- Layout del modal para un único scroll en el body ---
const card = document.getElementById('modalCard');      // si existe en tu HTML
if (card) {
  card.style.width = 'min(1380px, 96vw)';
  card.style.maxHeight = '94vh';
  card.style.display = 'flex';
  card.style.flexDirection = 'column';
  card.style.overflow = 'hidden';
}
if (modalBody) {
  modalBody.style.flex = '1 1 auto';
  modalBody.style.padding = '18px 22px 28px';
  modalBody.style.minHeight = '0';
  modalBody.style.overflowY = 'auto';   // 👈 scroll SOLO aquí
  modalBody.style.maxHeight = 'none';
}

  modalPrimary.textContent = primaryText;
  modalPrimary.onclick = async () => { if (onPrimary) await onPrimary(); };
  modalBackdrop.style.display = 'flex';
}

function authHeaders() {
  // intenta por API wrapper y por localStorage (tkn y token)
  const raw =
    (API.getToken && API.getToken()) ||
    localStorage.getItem('tkn') ||
    localStorage.getItem('token') || '';

  const v = String(raw || '').trim();
  if (!v) return {};
  return { Authorization: v.toLowerCase().startsWith('bearer ') ? v : `Bearer ${v}` };
}

function tenantHeaders() {
  const tenant =
    (API.getTenant && API.getTenant()) ||
    localStorage.getItem('tenant') ||
    localStorage.getItem('tenantKey') ||
    '';
  const h = {};
  if (tenant) { h['X-Tenant'] = tenant; h['X-Tenant-Key'] = tenant; }
  return h;
}

function secureDocUrl(docId) {
  return docId ? `/api/documents/${encodeURIComponent(docId)}/download` : '';
}

async function fetchSecureBlob(url) {
  const resp = await fetch(url, {
    headers: { ...authHeaders(), ...tenantHeaders() },
    credentials: 'include'
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(txt || `HTTP ${resp.status}`);
  }

  return resp.blob();
}

async function openSecureFile(url, filename, action = 'view') {
  if (!url) return;

  const blob = await fetchSecureBlob(url);
  const objectUrl = URL.createObjectURL(blob);

  if (action === 'download') {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename || 'documento';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return;
  }

  window.open(objectUrl, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60 * 1000);
}

async function hydrateSecureImages(root = document) {
  const imgs = Array.from(root.querySelectorAll('img[data-secure-src]'));

  await Promise.all(imgs.map(async (img) => {
    const url = img.dataset.secureSrc;
    if (!url || img.dataset.secureLoaded === '1') return;

    try {
      const blob = await fetchSecureBlob(url);
      const objectUrl = URL.createObjectURL(blob);
      img.src = objectUrl;
      img.dataset.secureLoaded = '1';
      img.dataset.objectUrl = objectUrl;
    } catch (err) {
      console.error('[secure image]', err);
      img.alt = 'No se pudo cargar la imagen';
    }
  }));
}

document.addEventListener('click', (ev) => {
  const link = ev.target.closest('.js-secure-file');
  if (!link) return;

  ev.preventDefault();
  openSecureFile(link.dataset.url, link.dataset.filename, link.dataset.action || 'view')
    .catch(err => {
      console.error('[secure file]', err);
      alert('No se pudo abrir el documento.');
    });
});


async function openChecklistDocs(clId) {
  const cl = state.checklists.find(x => x._id === clId);
  const docs = state.docsByChecklist[clId] || [];

  const listHTML = docs.length ? docs.map(d => `
    <div class="row" data-doc="${escapeHtml(d._id)}" style="justify-content:space-between;border:1px solid #eef2f7;border-radius:8px;padding:6px 10px;margin-bottom:6px;">
      <div>
        <b>${escapeHtml(d.originalname || d.name || 'Documento')}</b>
        <div class="small muted">${escapeHtml(d.mimetype || '')} — ${(d.size||0)} bytes</div>
        <div class="small ${d.expiryDate && new Date(d.expiryDate).getTime() < Date.now() ? 'warn' : ''}">
          Expira: ${d.expiryDate ? new Date(d.expiryDate).toISOString().slice(0,10) : '—'}
        </div>
      </div>
      <div class="row" style="gap:6px;">
        <a class="btn btn-ghost btn-xs js-secure-file" href="#" data-url="${secureDocUrl(d._id)}" data-filename="${escapeHtml(d.originalname || d.name || 'documento')}" data-action="view">Ver</a>
        <button class="btn btn-danger btn-xs js-del-doc" data-doc="${escapeHtml(d._id)}" data-cl="${escapeHtml(clId)}">Eliminar</button>
      </div>
    </div>
  `).join('') : '<div class="small muted">Sin documentos</div>';

  const body = `
    <div class="small muted" style="margin-bottom:8px;">Checklist: <b>${cl?.title || '—'}</b></div>
    <div id="docsList-${clId}">
      ${listHTML}
    </div>
    <hr style="margin:12px 0;">
    <div>
      <div class="small muted" style="margin-bottom:6px;">Subir nuevo documento</div>
      <div class="row" style="gap:8px;align-items:center;">
        <input type="file" id="docFile-${clId}" />
        <label>Expira</label><input type="date" id="docExp-${clId}">
        <button class="btn btn-ghost btn-xs" id="docUploadBtn-${clId}">Subir</button>
      </div>
    </div>
  `;

  openModal('Documentos del checklist', body, 'Cerrar', () => {
    modalBackdrop.style.display = 'none';
  });

  await refreshDocsListInModal(clId);

  // Bind subir
  const upBtn = document.getElementById(`docUploadBtn-${clId}`);
  const fileInp = document.getElementById(`docFile-${clId}`);
  const expInp  = document.getElementById(`docExp-${clId}`);
  if (upBtn && fileInp) {
    upBtn.onclick = async () => {
      // Activo por secuencia
      const active = isChecklistActive(cl);
      if (!active) {
        alert('Checklist bloqueado: valida los anteriores o desbloquéalo manualmente tocando la tarjeta.');
        return;
      }
      const f = fileInp.files?.[0];
      if (!f) return alert('Selecciona un archivo');
      const fd = new FormData();
      fd.append('file', f);
      fd.append('projectId', id);
      fd.append('checklistId', clId);
      if (expInp?.value) fd.append('expiryDate', expInp.value);
      await API.upload('/api/documents/upload', fd);
      if (typeof invalidateProjectDocsCache === 'function') invalidateProjectDocsCache();
      await reloadProyecto(false);
      await refreshDocsListInModal(clId);
      if (document.getElementById('tab-docs')?.classList.contains('active') && typeof loadDocs === 'function') {
        await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
      }
      fileInp.value = '';
      expInp.value = '';
    };
  }

  // Bind eliminar dentro del modal
  bindDeleteButtonsInModal(clId);
}

let __permits = null;

async function apiPermitsGetProject(noCache=false) {
  // ✅ Nueva ruta correcta según backend
  let url = `/api/permits?projectId=${id}`;
  
  if (noCache) url += `&ts=${Date.now()}`;   // rompe ETag

  const res = await fetch(url, { 
    headers: { ...tenantHeaders(), ...authHeaders() },
    cache: 'no-store'                         // no usar caché del navegador
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiPermitsGetTemplates() {
  try {
    return await withTimeout(API.get('/api/permits/templates'), 1000);
  } catch (_) {
    const res = await fetch('/api/permits/templates', {
    headers: { ...tenantHeaders(), ...authHeaders() }
    });
 
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
}

async function apiPermitsInit(templateId) {
  const headers = { 'Content-Type': 'application/json', ...tenantHeaders(), ...authHeaders() };

  const res = await fetch(`/api/permits/projects/${id}/init`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ templateId })
  });
  if (!res.ok) {
    const txt = await res.text().catch(()=> '');
    throw new Error(`HTTP ${res.status}: ${txt || 'init_error'}`);
  }
  return res.json();
}


async function apiPermitsPatchItem(code, payload) {
  try {
    return await withTimeout(API.patch(`/api/permits/projects/${id}/items/${encodeURIComponent(code)}`, payload), 1000);
  } catch (_) {
    const res = await fetch(`/api/permits/projects/${id}/items/${encodeURIComponent(code)}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', ...tenantHeaders(), ...authHeaders() },
  body: JSON.stringify(payload)
});

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
}

function withTimeout(promise, ms, onTimeout) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => {
      try { onTimeout && onTimeout(); } catch(_) {}
      reject(new Error('timeout'));
    }, ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(t)), timeout]);
}

// ====== Permisos: UI ======
const PERMIT_STATES = ['pending','in_progress','submitted','approved','rejected','waived'];
const PERMIT_LABEL = {
  pending: 'Pendiente', in_progress: 'En curso', submitted: 'Presentado',
  approved: 'Aprobado', rejected: 'Rechazado', waived: 'No aplica'
};

// ====== Permisos: agregación para gráficas (buckets) ======
function permitBucket(status) {
  const s = String(status || '').toLowerCase().trim();

  if (s === 'pending') return 'pending';

  // ✅ TODO lo "intermedio" cuenta como "En trámite"
  if (s === 'in_progress' || s === 'submitted') return 'inProcess';

  if (s === 'approved') return 'approved';
  if (s === 'rejected') return 'rejected';

  // waived = no aplica (no lo contamos en la gráfica)
  return 'waived';
}

function buildPermitsByInstitution(items = []) {
  const map = {}; // institución -> contadores

  for (const it of items) {
    const inst = (it.institution || '—').trim();
    if (!map[inst]) {
      map[inst] = { institution: inst, pending: 0, inProcess: 0, approved: 0, rejected: 0 };
    }

    const effectiveStatus = window.__technicalWorkspace?.loaded
      ? technicalPermitEffectiveStatus(it)
      : it.status;
    const b = permitBucket(effectiveStatus);
    if (b === 'pending')   map[inst].pending++;
    if (b === 'inProcess') map[inst].inProcess++;
    if (b === 'approved')  map[inst].approved++;
    if (b === 'rejected')  map[inst].rejected++;
  }

  // orden: los que más tienen primero
  return Object.values(map).sort((a,b) =>
    (b.pending+b.inProcess+b.approved+b.rejected) - (a.pending+a.inProcess+a.approved+a.rejected)
  );
}

function updatePermitsByInstitutionChart() {
  // si no hay chart creado, no hacemos nada
  if (!__sumCharts?.p2) return;

  const inst = buildPermitsByInstitution(__permits?.items || []);

  __sumCharts.p2.data.labels = inst.map(x => x.institution);
  __sumCharts.p2.data.datasets[0].data = inst.map(x => x.pending);
  __sumCharts.p2.data.datasets[1].data = inst.map(x => x.inProcess);
  __sumCharts.p2.data.datasets[2].data = inst.map(x => x.approved);
  __sumCharts.p2.data.datasets[3].data = inst.map(x => x.rejected);

  __sumCharts.p2.update();
}


function permitProgress(pp) {
  if (!pp?.items?.length) return 0;
  const total = pp.items.filter(i => i.status !== 'waived').length || 0;
  const done  = pp.items.filter(i => i.status === 'approved').length;
  return total ? Math.round((done / total) * 100) : 0;
}

async function openPermitsModal() {

  // abre el modal ya con un “cargando…”
  openModal('Permisos del proyecto', `
    <div class="row" style="align-items:center; gap:8px;">
      <div class="spinner" style="width:16px;height:16px;border:2px solid #cbd5e1;border-top-color:#111827;border-radius:50%;animation:spin 1s linear infinite"></div>
      <span class="small muted">Cargando permisos…</span>
    </div>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
  `, 'Cerrar', async () => {
    modalBackdrop.style.display='none';
    await window.refreshTechnicalWorkspace?.({ force:true, preserveSelection:true });
  });

  try {
  __permits = await apiPermitsGetProject();
} catch (e) {
  console.error('[Permits] GET project error', e);
  modalBody.innerHTML = `
    <div class="error">
      <b>No se pudieron cargar los permisos.</b>
      <div class="small muted">${e?.message || e?.status || 'Error'}</div>
    </div>`;
  return;
}


  if (!__permits) {
    // no inicializado: pide plantilla
    let tpls = [];
    try { tpls = await apiPermitsGetTemplates(); }        // GET /api/permits/templates
    catch (e) {
      console.error('[Permits] GET templates error', e);
      alert('No se pudieron cargar las plantillas de permisos');
      return;
    }
    if (!tpls || !tpls.length) {
      modalBody.innerHTML = '<div class="small muted">No hay plantillas. Pídele a Admin/Gerencia que cargue una.</div>';
      return;
    }
    modalBody.innerHTML = `
      <div class="small muted" style="margin-bottom:8px;">Selecciona plantilla para este proyecto</div>
      <select id="permTplSel" class="w-100">
        ${tpls.map(t => `<option value="${t._id}">${t.name} (v${t.version||1})</option>`).join('')}
      </select>
      <div class="row end" style="margin-top:10px;">
        <button class="btn" id="permTplApply">Instanciar</button>
      </div>
    `;
    // delegación robusta para el botón Instanciar
// ✅ así nos aseguramos de enganchar justo el botón visible
const applyBtn = modalBody.querySelector('#permTplApply');
applyBtn.onclick = async () => {
  const tplSel = document.getElementById('permTplSel');
  const tplId  = tplSel?.value;
  if (!tplId) return alert('Selecciona una plantilla');
  try {
    await apiPermitsInit(tplId);                // POST
    __permits = await apiPermitsGetProject();   // GET
    renderPermitsModal();
    updatePermitsByInstitutionChart();
    await markProjectDataChanged({ refreshSummary: true });
  } catch (e) {
    console.error('[Permits] init error', e);
    alert(`No se pudo instanciar la plantilla de permisos:\n${e.message || e}`);
  }
};

    return;
  }

  // ya había permisos → render
renderPermitsModal();
updatePermitsByInstitutionChart(); // ✅ para que el resumen use __permits ya cargado

}

// ===== Helpers de Permisos (fases, dependencias) =====
const PHASE_ORDER = [
  'Anteproyecto',
  'Informe SINAPROC',
  'Estudio de Impacto',
  'Permiso Provisional',
  'Construcción',
  'Permiso de Construcción',
  'Permiso de Ocupación',
  'Urbanización',
  'Movimientos de tierra',
  'Segregación',
  'Inscripción',
  'Traspaso de calle'
];

function inferType(it) {
  if (it.type) return it.type;
  const t = String(it.title||'').split(' - ')[0].trim();
  return t || 'General';
}

function groupByPhase(items) {
  const g = {};
  for (const it of (items || [])) {
    const phase = inferType(it);
    if (!g[phase]) g[phase] = [];
    g[phase].push(it);
  }
  const phases = Object.keys(g).sort((a,b) => {
    const ia = PHASE_ORDER.indexOf(a); const ib = PHASE_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return { groups: g, order: phases };
}

function buildIndexByCode(items) { const m={}; (items||[]).forEach(i=>m[i.code]=i); return m; }
function depsApproved(it, idx) { return (it.dependencies||[]).every(c => idx[c] && idx[c].status==='approved'); }
function phaseProgress(list) {
  const valid = (list || []).filter(i => i.status !== 'waived');
  const tot   = valid.length;
  const done  = valid.filter(i => i.status === 'approved').length; // o incluye 'submitted' si quieres sumar presentados
  const pct   = tot ? Math.round((done / tot) * 100) : 0;
  return { pct, done, tot };
}

// Overrides de desbloqueo manual (solo sesión)
const __permitsUnlockOverrides = new Set();
function isUnlocked(it, idx) { return __permitsUnlockOverrides.has(it.code) || depsApproved(it, idx); }

let __commercialUnitsForPermits = [];

function __normTxt(v) {
  return String(v || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isConstructionPermit(it) {
  const title = __normTxt(it?.title || '');
  const type  = __normTxt(it?.type || '');
  const code  = __normTxt(it?.code || '');

  return (
    title === 'permiso de construccion - municipio' ||
    title === 'permiso de construccion' ||
    type === 'permiso de construccion' ||
    code === 'permiso_construccion' ||
    code === 'permiso-de-construccion'
  );
}

function isOccupationPermit(it) {
  const title = __normTxt(it?.title || '');
  const type  = __normTxt(it?.type || '');
  const code  = __normTxt(it?.code || '');

  return (
    title === 'permiso de ocupacion - municipio' ||
    title === 'permiso de ocupacion' ||
    type === 'permiso de ocupacion' ||
    code === 'permiso_ocupacion' ||
    code === 'permiso-de-ocupacion'
  );
}

function commercialUnitName(u) {
  return u.nombre || u.name || u.codigo || u.code || u.numero || u.unitNumber || u.lote || u._id || 'Unidad';
}

function getCommercialPermitData(u, kind) {
  const isCons = kind === 'construction';
  const venta = u.__venta || {};

  const number = isCons
    ? (venta.permisoConstruccionNum || '')
    : (venta.permisoOcupacionNum || '');

  const approved = !!String(number || '').trim();

  return {
    number: number || '—',
    status: approved ? 'approved' : 'pending',
    label: approved ? 'Aprobado' : 'Pendiente'
  };
}

async function apiCommercialUnitsForPermits() {
  let units = [];
  let ventas = [];

  try {
    units = await API.get(`/api/units?projectId=${id}`);
  } catch (e) {
    console.error('[Permits] units error', e);
    units = [];
  }

  try {
    ventas = await API.get(`/api/ventas?projectId=${id}`);
  } catch (e) {
    console.error('[Permits] ventas error', e);
    ventas = [];
  }

  const ventasByUnit = new Map(
    (ventas || []).map(v => [String(v.unitId), v])
  );

  return (units || []).map(u => ({
    ...u,
    __venta: ventasByUnit.get(String(u._id)) || {}
  }));
}

function buildAggregatedPermitSummary(kind) {
  const units = __commercialUnitsForPermits || [];
  const rows = units.map(u => ({
    unit: commercialUnitName(u),
    ...getCommercialPermitData(u, kind)
  }));

  const total = rows.length;
  const approved = rows.filter(r => r.status === 'approved').length;

  return {
    total,
    approved,
    status: total > 0 && approved === total ? 'approved' : 'pending',
    label: total > 0 && approved === total ? 'Aprobado' : 'Pendiente',
    rows
  };
}

async function renderPermitsModal() {
  try {
    __commercialUnitsForPermits = await apiCommercialUnitsForPermits();
  } catch (e) {
    console.error('[Commercial units permits]', e);
    __commercialUnitsForPermits = [];
  }

  const idx = buildIndexByCode(__permits.items);
  const { groups, order } = groupByPhase(__permits.items);

  (__permits.items || []).forEach(it => {
    if (isConstructionPermit(it)) {
      it.__aggregate = buildAggregatedPermitSummary('construction');
      it.__computedStatus = it.__aggregate.status;
    }

    if (isOccupationPermit(it)) {
      it.__aggregate = buildAggregatedPermitSummary('occupation');
      it.__computedStatus = it.__aggregate.status;
    }
  });

  const pct = permitProgress({
    ...__permits,
    items: (__permits.items || []).map(it => ({
      ...it,
      status: it.__computedStatus || it.status
    }))
  });

  const head = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
      <div style="min-width:140px;">Progreso:</div>
      <div class="progress" style="flex:1"><div style="width:${pct}%;"></div></div>
      <div style="min-width:70px;text-align:right;"><b>${pct}%</b></div>
    </div>

    <div class="small muted">Plantilla: v${__permits?.templateVersion || 1}</div>

    <div class="small muted" style="margin-top:6px;">
      Los permisos de construcción y ocupación se calculan automáticamente desde la pestaña Comercial.
    </div>

    <hr style="margin:10px 0;">

    <div class="row" style="gap:8px; align-items:center; margin:4px 0 12px 0;">
      <button class="btn btn-ghost btn-xs" id="permAddFromTpl">+ Agregar trámites de una plantilla…</button>
      <div id="permAddBox" class="small muted"></div>
    </div>
  `;

  const permPhaseProgress = (list) => {
    const valid = (list || []).filter(i => i.status !== 'waived');
    const tot = valid.length;
    const done = valid.filter(i => (i.__computedStatus || i.status) === 'approved').length;
    const pct = tot ? Math.round((done / tot) * 100) : 0;
    return { pct, done, tot };
  };

  const accordions = order.map(phase => {
    const list = groups[phase] || [];
    const phasePctObj = permPhaseProgress(list);
    const phasePct = Number(phasePctObj.pct || 0);

    const rows = list.map(it => {
      const isAggregated = !!it.__aggregate;
      const aggregate = it.__aggregate;

      if (isAggregated) {
        const reqs = (it.requirements || []).map(r => `<li>${r}</li>`).join('');
        const obs = (it.observations || []).map(r => `<li>${r}</li>`).join('');

        const docsViewer = `
          <div class="small" id="permDocs-${it.code}">
            <div class="muted">Cargando documentos…</div>
          </div>
        `;

        const aggRows = aggregate.rows.map(r => `
          <tr>
            <td class="small">${r.unit}</td>
            <td class="small">${r.number}</td>
            <td class="small">
              <span class="badge ${r.status === 'approved' ? 'ok' : ''}">
                ${r.label}
              </span>
            </td>
          </tr>
        `).join('');

        return `
          <tr class="perm-main-row" data-code="${it.code}">
            <td style="white-space:nowrap">
              <select class="perm-state" disabled>
                ${PERMIT_STATES.map(s => `
                  <option value="${s}" ${aggregate.status === s ? 'selected' : ''}>
                    ${PERMIT_LABEL[s]}
                  </option>
                `).join('')}
              </select>
            </td>

            <td>
              <b>${it.title || it.code}</b><br/>
              <span class="small muted">${it.institution || ''}</span>
              <div class="small muted" style="margin-top:4px;">
                ${aggregate.approved} / ${aggregate.total} permisos aprobados
              </div>
            </td>

            <td class="small">
              ${it.slaDays ? (it.slaDays + ' días hábiles') : '—'}
            </td>

            <td class="small">
              <button type="button" class="perm-see-btn js-toggle-perm-details" data-code="${it.code}">
                Ver detalles
              </button>
            </td>

            <td class="small">
              <button class="btn btn-ghost btn-xs js-perm-docs" data-code="${it.code}">📎 Adjuntar</button>
            </td>
          </tr>

          <tr class="perm-extra-row" data-extra-code="${it.code}">
            <td colspan="5">
              <div class="perm-details-box">
                ${reqs ? `
                  <div>
                    <b>Requisitos</b>
                    <ul>${reqs}</ul>
                  </div>
                ` : ''}

                ${obs ? `
                  <div style="margin-top:14px;">
                    <b>Observaciones</b>
                    <ul>${obs}</ul>
                  </div>
                ` : ''}

                <div style="margin-top:14px;">
                  <b>Resumen por unidad comercial</b>
                  <div class="small muted" style="margin:4px 0 8px;">
                    Información alimentada automáticamente desde Comercial.
                  </div>

                  <div class="table-wrap">
                    <table class="table compact">
                      <thead>
                        <tr>
                          <th>Unidad comercial</th>
                          <th>Nº permiso</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${aggRows || `<tr><td colspan="3" class="small muted">No hay unidades comerciales registradas.</td></tr>`}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div style="margin-top:14px;"><b>Documentos adjuntos</b></div>
                ${docsViewer}
              </div>
            </td>
          </tr>
        `;
      }

      const unlocked = isUnlocked(it, idx);
      const lockedBadge = unlocked ? '' :
        `<span class="badge" title="Debes completar: ${(it.dependencies || []).join(', ')}">🔒 Bloqueado</span>`;

      const sel = `
        <select class="perm-state" data-code="${it.code}" ${unlocked ? '' : 'disabled'}>
          ${PERMIT_STATES.map(s => `<option value="${s}" ${it.status === s ? 'selected' : ''}>${PERMIT_LABEL[s]}</option>`).join('')}
        </select>
      `;

      const reqs = (it.requirements || []).map(r => `<li>${r}</li>`).join('');
      const obs = (it.observations || []).map(r => `<li>${r}</li>`).join('');

      const depsHtml = (it.dependencies || []).length ? `
        <div class="small muted">Depende de: ${(it.dependencies || []).map(c => {
          const dep = idx[c];
          return dep ? (dep.title || c) : c;
        }).join(', ')}</div>` : '';

      const unlockBtn = unlocked ? '' : `
        <button class="btn btn-ghost btn-xs js-unlock" data-code="${it.code}">Desbloquear manualmente</button>
      `;

      const docsViewer = `
        <div class="small" id="permDocs-${it.code}">
          <div class="muted">Cargando documentos…</div>
        </div>
      `;

      return `
        <tr class="perm-main-row" data-code="${it.code}">
          <td style="white-space:nowrap">${sel}${lockedBadge}</td>

          <td>
            <b>${it.title || it.code}</b><br/>
            <span class="small muted">${it.institution || ''}</span>
            ${depsHtml}
          </td>

          <td class="small">${it.slaDays ? (it.slaDays + ' días hábiles') : '—'}</td>

          <td class="small">
            <button type="button" class="perm-see-btn js-toggle-perm-details" data-code="${it.code}">
              Ver detalles
            </button>
          </td>

          <td class="small">
            <button class="btn btn-ghost btn-xs js-perm-docs" data-code="${it.code}">📎 Adjuntar</button>
            ${unlockBtn}
          </td>
        </tr>

        <tr class="perm-extra-row" data-extra-code="${it.code}">
          <td colspan="5">
            <div class="perm-details-box">
              ${reqs ? `<div><b>Requisitos</b><ul>${reqs}</ul></div>` : ''}
              ${obs ? `<div style="margin-top:14px;"><b>Observaciones</b><ul>${obs}</ul></div>` : ''}
              ${(!reqs && !obs) ? `<div class="small muted">Sin requisitos / observaciones.</div>` : ''}

              <div style="margin-top:14px;"><b>Documentos adjuntos</b></div>
              ${docsViewer}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <section class="phase-card permits-phase-card" data-phase="${phase}">
        <header class="row permits-phase-header">
          <div style="font-weight:700;">${phase}</div>
          <div class="progress small" style="flex:1;background:#ffffff22;">
            <div style="width:${phasePct}%; background:#22c55e;"></div>
          </div>
          <div><b>${phasePct}%</b></div>
        </header>

        <div class="table-wrap permits-table-wrap">
          <table class="table dark">
            <thead>
              <tr>
                <th>Estado</th>
                <th>Trámite</th>
                <th>Tiempo</th>
                <th>Detalles</th>
                <th>Docs</th>
              </tr>
            </thead>
            <tbody>${rows || `<tr><td colspan="5" class="small muted">—</td></tr>`}</tbody>
          </table>
        </div>
      </section>
    `;
  }).join('');

  openModal(
    'Permisos del proyecto',
    head + accordions,
    'Cerrar',
    () => { modalBackdrop.style.display = 'none'; }
  );

  const fmt = (n) => (typeof n === 'number' ? (Math.round(n / 1024)) + ' KB' : '—');

  async function fetchDocsFor(code) {
    const host = modalBody.querySelector(`#permDocs-${CSS.escape(code)}`);
    if (!host) return;

    host.innerHTML = '<div class="small muted">Cargando…</div>';

    try {
      let url = `/api/documents?projectId=${id}&category=permits&permitCode=${encodeURIComponent(code)}&ts=${Date.now()}`;
      let res = await fetch(url, { headers: { ...authHeaders(), ...tenantHeaders() } });
      let docs;

      if (res.ok) {
        docs = await res.json();
      } else {
        url = `/api/documents?projectId=${id}&category=permits&ts=${Date.now()}`;
        res = await fetch(url, { headers: { ...authHeaders(), ...tenantHeaders() } });
        docs = res.ok ? await res.json() : [];

        const rx = new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        docs = (docs || []).filter(d => rx.test(d.title || '') || rx.test(d.originalname || ''));
      }

      if (!Array.isArray(docs) || !docs.length) {
        host.innerHTML = '<div class="small muted">Sin documentos para este trámite.</div>';
        return;
      }

      host.innerHTML = `
        <div class="table-wrap">
          <table class="table compact">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Tamaño</th>
                <th>Subido</th>
                <th>Caduca</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${docs.map(d => `
                <tr data-id="${escapeHtml(d._id)}">
                  <td class="small">${escapeHtml(d.originalname || d.filename || 'Documento')}</td>
                  <td class="small">${escapeHtml(d.mimetype || '—')}</td>
                  <td class="small">${fmt(d.size)}</td>
                  <td class="small">${d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '—'}</td>
                  <td class="small">${d.expiryDate ? new Date(d.expiryDate).toLocaleDateString() : '—'}</td>
                  <td class="small" style="white-space:nowrap;">
                    <a class="btn btn-light btn-xs js-secure-file" href="#" data-url="${secureDocUrl(d._id)}" data-filename="${escapeHtml(d.originalname || d.filename || 'documento')}" data-action="view">Ver</a>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (e) {
      console.error('[permits.docs.fetch]', e);
      host.innerHTML = '<div class="small error">No se pudieron cargar los documentos.</div>';
    }
  }

  (__permits.items || []).forEach(it => fetchDocsFor(it.code));

  document.querySelectorAll('.js-toggle-perm-details').forEach(btn => {
  btn.onclick = () => {
    const code = btn.dataset.code;

    const row = document.querySelector(`tr[data-code="${CSS.escape(code)}"]`);
    const extra = document.querySelector(`tr[data-extra-code="${CSS.escape(code)}"]`);

    if (!extra || !row) return;

    const open = extra.classList.toggle('is-open');

    row.classList.toggle('is-open', open);
    btn.classList.toggle('open', open);
  };
});

  modalBody.querySelectorAll('select.perm-state[data-code]').forEach(sel => {
    sel.onchange = async () => {
      const code = sel.dataset.code;
      const status = sel.value;

      try {
        await apiPermitsPatchItem(code, { status });
        __permits = await apiPermitsGetProject(true);
        renderPermitsModal();
        updatePermitsByInstitutionChart();
        await markProjectDataChanged({ refreshSummary: true });
      } catch (e) {
        console.error(e);
        alert('No se pudo actualizar el estado.');
      }
    };
  });

  modalBody.querySelectorAll('.js-unlock').forEach(btn => {
    btn.onclick = () => {
      const code = btn.dataset.code;
      if (!confirm('¿Desbloquear este trámite manualmente para trabajar en paralelo?')) return;
      __permitsUnlockOverrides.add(code);
      renderPermitsModal();
    };
  });

  modalBody.querySelectorAll('.js-perm-docs').forEach(btn => {
    btn.onclick = () => {
      const code = btn.dataset.code;

      const picker = document.createElement('input');
      picker.type = 'file';
      picker.multiple = true;

      picker.onchange = async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;

        let expiry = prompt('Fecha de caducidad (YYYY-MM-DD, opcional):', '');
        expiry = (expiry || '').trim();

        if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
          alert('Formato inválido. Usa YYYY-MM-DD o deja vacío.');
          return;
        }

        const fd = new FormData();
        files.forEach(f => fd.append('files', f));
        fd.append('projectId', id);
        fd.append('category', 'permits');
        fd.append('permitCode', code);

        if (expiry) fd.append('expiryDate', expiry);

        try {
          const headers = { ...authHeaders(), ...tenantHeaders() };

          const resp = await fetch('/api/documents/upload', {
            method: 'POST',
            body: fd,
            headers,
            credentials: 'include'
          });

          const data = await resp.json().catch(() => ({}));

          if (!resp.ok) {
            if (data?.error === 'Falta projectId') return alert('Falta projectId en la subida.');
            if (data?.error === 'Falta archivo(s)') return alert('No llegaron archivos al servidor.');
            throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
          }

          btn.textContent = '✅ Adjuntado';
          setTimeout(() => { btn.textContent = '📎 Adjuntar'; }, 1200);

          fetchDocsFor(code);

          const docsPane = document.getElementById('tab-docs');
          if (docsPane && docsPane.classList.contains('active') && typeof loadDocs === 'function') {
            loadDocs();
          }
        } catch (err) {
          console.error('[permits.item.upload]', err);
          alert('No se pudo subir el/los archivo(s).');
        }
      };

      picker.click();
    };
  });
}

function bindDeleteButtonsInModal(clId) {
  const container = document.getElementById(`docsList-${clId}`);
  if (!container) return;
  container.querySelectorAll('.js-del-doc').forEach(btn => {
    btn.onclick = async () => {
      // Activo por secuencia
      const cl = state.checklists.find(c => c._id === clId);
      if (!isChecklistActive(cl)) {
        alert('Checklist bloqueado: valida los anteriores o desbloquéalo manualmente tocando la tarjeta.');
        return;
      }
      if (!askPinOrAbort('Para eliminar el documento, introduce el PIN:')) return;
      const docId = btn.dataset.doc;
      try { await API.del(`/api/documents/${docId}`); }
      catch { await API.post(`/api/documents/${docId}/delete`, { pin: PIN }); }
      await reloadProyecto(false);
      await refreshDocsListInModal(clId);
    };
  });
}

async function refreshDocsListInModal(clId) {
  try {
    const docsList = await API.get(`/api/documents?projectId=${id}&checklistId=${clId}`);

    // 🔴 NUEVO: sincroniza el estado global para que el botón muestre el número real
    state.docsByChecklist[clId] = docsList || [];
    setDocsCount(clId, state.docsByChecklist[clId].length);   // <- actualiza el texto del botón

    const container = document.getElementById(`docsList-${clId}`);
    if (!container) return;
    container.innerHTML = (docsList && docsList.length)
      ? docsList.map(d => `
        <div class="row" data-doc="${escapeHtml(d._id)}" style="justify-content:space-between;border:1px solid #eef2f7;border-radius:8px;padding:6px 10px;margin-bottom:6px;">
          <div>
            <b>${escapeHtml(d.originalname || d.name || 'Documento')}</b>
            <div class="small muted">${escapeHtml(d.mimetype || '')} — ${(d.size||0)} bytes</div>
            <div class="small ${d.expiryDate && new Date(d.expiryDate).getTime() < Date.now() ? 'warn' : ''}">
              Expira: ${d.expiryDate ? new Date(d.expiryDate).toISOString().slice(0,10) : '—'}
            </div>
          </div>
          <div class="row" style="gap:6px;">
            <a class="btn btn-ghost btn-xs js-secure-file" href="#" data-url="${secureDocUrl(d._id)}" data-filename="${escapeHtml(d.originalname || d.name || 'documento')}" data-action="view">Ver</a>
            <button class="btn btn-danger btn-xs js-del-doc" data-doc="${escapeHtml(d._id)}" data-cl="${escapeHtml(clId)}">Eliminar</button>
          </div>
        </div>
      `).join('')
      : '<div class="small muted">Sin documentos</div>';

    bindDeleteButtonsInModal(clId);
  } catch (e) {
    console.error('refreshDocsListInModal error', e);
  }
}


/* ================== DOCS de PERMISOS (helpers) ================== */
// Lista docs de category=permits
async function loadPermitsDocsList(targetEl) {
  if (!targetEl) return;
  targetEl.innerHTML = '<div class="small muted">Cargando…</div>';
  try {
    const docs = await API.get(`/api/documents?projectId=${id}&category=permits&ts=${Date.now()}`);
    if (!Array.isArray(docs) || !docs.length) {
      targetEl.innerHTML = '<div class="small muted">No hay documentos de permisos.</div>';
      return;
    }
    targetEl.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Nombre</th><th>Tipo</th><th>Tamaño</th><th>Subido</th><th>Caduca</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${docs.map(d => `
              <tr data-id="${escapeHtml(d._id)}">
                <td>${escapeHtml(d.originalname || d.filename || 'Documento')}</td>
                <td>${escapeHtml(d.mimetype || '—')}</td>
                <td>${d.size ? (Math.round(d.size/1024))+' KB' : '—'}</td>
                <td>${d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '—'}</td>
                <td>${d.expiryDate ? new Date(d.expiryDate).toLocaleDateString() : '—'}</td>
                <td style="white-space:nowrap;">
                  <a class="btn btn-light btn-xs js-secure-file" href="#" data-url="${secureDocUrl(d._id)}" data-filename="${escapeHtml(d.originalname || d.filename || 'documento')}" data-action="view">Ver</a>
                  <button class="btn btn-danger btn-xs js-permit-doc-del">Eliminar</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Borrado con PIN (usa tu route POST /:id/delete)
    targetEl.querySelectorAll('.js-permit-doc-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const tr = e.target.closest('tr[data-id]');
        const docId = tr?.dataset?.id;
        if (!docId) return;
        const pin = prompt('PIN para eliminar (por defecto 2580):', '');
        if (pin === null) return;
        try {
          await API.post(`/api/documents/${docId}/delete`, { pin });
          tr.remove();
        } catch (err) {
          console.error('[permits.doc.delete]', err);
          alert('No se pudo eliminar el documento.');
        }
      });
    });
  } catch (err) {
    console.error('[permits.docs.list]', err);
    targetEl.innerHTML = '<div class="error">Error cargando documentos.</div>';
  }
}

// Subir docs a category=permits
async function uploadPermitsDocs(files, expiryInput, onDone) {
  const arr = Array.from(files || []);
  if (!arr.length) { alert('Selecciona al menos un archivo.'); return; }
  const fd = new FormData();
  arr.forEach(f => fd.append('files', f));
  fd.append('projectId', id);
  fd.append('category', 'permits');
  const exp = (expiryInput?.value || '').trim();
  if (exp) fd.append('expiryDate', exp); // YYYY-MM-DD

  // OJO: no fijes Content-Type manualmente (deja que el navegador ponga multipart)
  const headers = { ...authHeaders(), ...tenantHeaders() };
  try {
    const res = await fetch('/api/documents/upload', { method:'POST', body: fd, headers, credentials:'include' });
    const data = await res.json().catch(()=> ({}));
    if (!res.ok) {
      if (data?.error === 'Falta projectId') return alert('Falta projectId en la subida.');
      if (data?.error === 'Falta archivo(s)') return alert('No llegaron archivos al servidor.');
      throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
    }
    if (typeof onDone === 'function') onDone();
  } catch (err) {
    console.error('[permits.docs.upload]', err);
    alert('No se pudo subir el/los archivo(s).');
  }
}


function setDocsCount(clId, n) {
  const btn = document.querySelector(`.js-open-docs[data-cl="${clId}"]`);
  if (btn) btn.innerHTML = `📎 Docs (${n})`;
}




// ====== Rol del usuario (para visibilidad/validación) ======  // ROLE-SEP
// TECH DEBT: este espejo frontend debe mantenerse alineado con utils/roles.js hasta modularizar project.js.
const FULL_ACCESS_ROLES = ['admin','bank','promoter','gerencia','socios','financiero','contable'];
let myRole = (currentUser.role || 'promoter').toLowerCase().trim();

try {
  const me = await API.get('/api/auth/me').catch(() => null);
  if (me?.role)   myRole = String(me.role).toLowerCase().trim();
  if (me?.status) currentUser.status = String(me.status).toLowerCase().trim();
} catch (_) {}

let __ALLOWED_ROLES = null; // null => sin filtro (ver todo)

function isPartialProyectoRole() {
  return ['tecnico','legal','commercial'].includes(myRole) && !FULL_ACCESS_ROLES.includes(myRole);
}

function syncPartialProyectoUI() {
  const hideIt = isPartialProyectoRole();
  const globalPhasePanel = document.querySelector('#tab-proyecto .project-tab-lead > .phase, #tab-proyecto > .phase');
  const asideRoles       = document.querySelector('#tab-proyecto aside.roles-panel');
  const phaseActions     = globalPhasePanel?.querySelector('.phase-actions');

  if (globalPhasePanel) globalPhasePanel.style.display = '';
  if (phaseActions)     phaseActions.style.display     = hideIt ? 'none' : '';
  if (asideRoles)       asideRoles.style.display       = '';

  document.querySelectorAll('#tab-proyecto .js-add-cl').forEach(el => { el.style.display = hideIt ? 'none' : ''; });
  document.querySelectorAll('#tab-proyecto .js-del-sub, #tab-proyecto .js-complete, #tab-proyecto .js-validate, #tab-proyecto .js-edit, #tab-proyecto .js-del-cl').forEach(el => {
    el.style.display = hideIt ? 'none' : '';
  });
  ['verHistorialBtn','configProyectoBtn','toggleAllPhasesBtn'].forEach(id=>{
    const b = document.getElementById(id); if (b) b.style.display = hideIt ? 'none' : '';
  });
}


function applyRoleVisibility() {                                // ROLE-SEP
  const isAdminOrBank = (myRole === 'admin');
  const isFull = FULL_ACCESS_ROLES.includes(myRole);            // <- clave

  // Mapas de tabs (botones y panes)
  const tabBtns = {
    resumen:   document.getElementById('tabBtn-resumen'),
    proyecto:  document.getElementById('tabBtn-proyecto'),
    finanzas:  document.getElementById('tabBtn-finanzas'),
    comercial: document.getElementById('tabBtn-comercial'),
    tecnico:   document.getElementById('tabBtn-tecnico'),
    proveedores: document.getElementById('tabBtn-proveedores'),
    docs:      document.getElementById('tabBtn-docs'),
    avaluadores: document.getElementById('tabBtn-avaluadores'),
    chat:      document.getElementById('tabBtn-chat'),
  };
  const tabPanes = {
    resumen:   document.getElementById('tab-resumen'),
    proyecto:  document.getElementById('tab-proyecto'),
    finanzas:  document.getElementById('tab-finanzas'),
    comercial: document.getElementById('tab-comercial'),
    tecnico:   document.getElementById('tab-tecnico'),
    proveedores: document.getElementById('tab-proveedores'),
    docs:      document.getElementById('tab-docs'),
    avaluadores: document.getElementById('tab-avaluadores'),
    chat:      document.getElementById('tab-chat'), 
  };
  const show = (k) => { if (tabBtns[k]) tabBtns[k].style.display = '';  if (tabPanes[k]) tabPanes[k].style.display = '';  };
  const hide = (k) => { if (tabBtns[k]) tabBtns[k].style.display = 'none'; if (tabPanes[k]) tabPanes[k].style.display = 'none'; };

  // Controles de estado del proyecto: sólo admin/bank
  if (statusWrap) statusWrap.style.display = isAdminOrBank ? '' : 'none';
  if (disbRow)    disbRow.style.display    = isAdminOrBank ? '' : 'none';

  // === Header (descripción + KPIs) ===
  const isPartial = isPartialProyectoRole();
  if (pdesc)   pdesc.style.display   = isPartial ? 'none' : '';
  if (kpisDiv) kpisDiv.style.display = isPartial ? 'none' : '';

  // Utilidad para ocultar/mostrar piezas dentro de "Proyecto"
  const togglePartialUI = (hideIt) => {
    syncPartialProyectoUI();
  };

  // === MATRIZ DE VISIBILIDAD DE CHECKLISTS ===
  // Full access => ver TODO (sin filtro)
  __ALLOWED_ROLES = null;
  if (typeof state !== 'undefined' && state) state.allowedChecklistRoles = null;

  if (isFull) {
    ['resumen','proyecto','finanzas','comercial','tecnico','proveedores','docs','chat'].forEach(show);
    if (myRole === 'bank') show('avaluadores'); else hide('avaluadores');
    activateTab('resumen');
    togglePartialUI(false);
    if (typeof renderProyecto === 'function') renderProyecto();
    if (document.getElementById('tab-docs')?.classList.contains('active') && typeof loadDocs === 'function') loadDocs();
    return;
  }

  // TÉCNICO
  if (myRole === 'tecnico') {
    __ALLOWED_ROLES = ['TECNICO'];
    if (state) state.allowedChecklistRoles = __ALLOWED_ROLES;
    ['resumen','finanzas','comercial','proveedores'].forEach(hide);
    ['proyecto','tecnico','docs','chat'].forEach(show);
    activateTab('tecnico');
    togglePartialUI(true);
    if (typeof renderProyecto === 'function') renderProyecto();
    if (document.getElementById('tab-docs')?.classList.contains('active') && typeof loadDocs === 'function') loadDocs();
    return;
  }

  // LEGAL
  if (myRole === 'legal') {
    __ALLOWED_ROLES = ['LEGAL'];
    if (state) state.allowedChecklistRoles = __ALLOWED_ROLES;
    ['resumen','finanzas','comercial','tecnico','proveedores'].forEach(hide);
    ['proyecto','docs'].forEach(show);
    activateTab('proyecto');
    togglePartialUI(true);
    if (typeof renderProyecto === 'function') renderProyecto();
    if (document.getElementById('tab-docs')?.classList.contains('active') && typeof loadDocs === 'function') loadDocs();
    return;
  }

  // COMERCIAL
  if (myRole === 'commercial') {
    __ALLOWED_ROLES = ['COMERCIAL'];
    if (state) state.allowedChecklistRoles = __ALLOWED_ROLES;
    ['resumen','finanzas','tecnico'].forEach(hide);
    ['proyecto','comercial','proveedores','docs'].forEach(show);
    activateTab('proyecto');
    togglePartialUI(true);
    if (typeof renderProyecto === 'function') renderProyecto();
    if (document.getElementById('tab-docs')?.classList.contains('active') && typeof loadDocs === 'function') loadDocs();
    return;
  }

  // Fallback ultra-restringido
  ['resumen','finanzas','comercial','tecnico','proveedores','docs'].forEach(hide);
  ['proyecto'].forEach(show);
  activateTab('proyecto');
  __ALLOWED_ROLES = null;
  if (state) state.allowedChecklistRoles = __ALLOWED_ROLES;
  togglePartialUI(true);
  if (typeof renderProyecto === 'function') renderProyecto();
  if (document.getElementById('tab-docs')?.classList.contains('active') && typeof loadDocs === 'function') loadDocs();
}

function bindSummaryOnce() {
  if (bindSummaryOnce.bound) return;
  bindSummaryOnce.bound = true;

  const beforeInp = document.getElementById('uploadBefore');
  const afterInp  = document.getElementById('uploadAfter');
  const prevB     = document.getElementById('previewBefore');
  const prevA     = document.getElementById('previewAfter');

  const showPreview = (file, targetDiv) => {
    if (!file || !targetDiv) return;
    const reader = new FileReader();
    reader.onload = () => {
      // Imagen → muestra img | PDF/otros → link
      if (/image\//.test(file.type)) {
        targetDiv.innerHTML = `<img src="${reader.result}" style="max-width:100%; border-radius:8px;" />`;
      } else if (file.type === 'application/pdf') {
        targetDiv.innerHTML = `<a class="btn" href="${reader.result}" target="_blank">Ver PDF</a>`;
      } else {
        targetDiv.innerHTML = `<div class="small muted">${file.name} (${file.type || 'archivo'})</div>`;
      }
    };
    reader.readAsDataURL(file);
  };

  if (beforeInp) beforeInp.addEventListener('change', e => showPreview(e.target.files?.[0], prevB));
  if (afterInp)  afterInp.addEventListener('change',  e => showPreview(e.target.files?.[0], prevA));
}

// ====== Resumen (KPIs + Charts + Antes/Después) ======
let __sumCharts = {};

function sumDestroy(key){
  if (__sumCharts[key] && typeof __sumCharts[key].destroy === 'function') {
    __sumCharts[key].destroy();
  }
}

function kpiCard(label, value, sub=''){
  return `<div class="kpi">
    <div class="label">${label}</div>
    <div class="value">${value ?? '—'}</div>
    ${sub ? `<div class="small muted">${sub}</div>` : ''}
  </div>`;
}

const TOP_HEADER_KPI_LABELS = {
  commercialValue: 'Valor total ventas',
  budgetApproved: 'Presupuesto Total',
  loanApproved: 'Cuantía Bancaria Aprobada',
  loanDisbursed: 'Desembolsado',
  budgetSpent: 'Gasto',
  unitsTotal: 'Unidades totales',
  unitsSold: 'Unidades vendidas'
};

function buildTopHeaderKpiTiles(project = {}, hs = {}, kpis = {}) {
  const financeKpis = window.FINANCE_KPIS || {};
  const financeControlTotals = window.FINANCE_CONTROL?.totals || {};
  const summaryFinanceTotals = window.__LAST_SUMMARY_PAYLOAD__?.financial?.totals || {};
  const summaryKpis = Object.keys(kpis || {}).length ? kpis : (window.__PROJECT_SUMMARY_KPIS || {});
  const commercialValue = summaryKpis.inventoryValue ?? project.inventoryValue ?? 0;
  const loanApproved = financeControlTotals.loanApproved
    ?? summaryFinanceTotals.loanApproved
    ?? project.loanApproved
    ?? hs.loanApproved
    ?? kpis.loan?.approved
    ?? 0;
  const loanDisbursed = financeControlTotals.totalDisbursed
    ?? summaryFinanceTotals.disbursed
    ?? project.loanDisbursed
    ?? hs.loanDisbursed
    ?? kpis.loan?.disbursed
    ?? 0;
  const budgetApproved = financeControlTotals.budgetApproved
    ?? summaryFinanceTotals.budgetApproved
    ?? project.budgetApproved
    ?? hs.budgetApproved
    ?? 0;
  const budgetSpent = financeKpis?.real?.uses ?? project.budgetSpent ?? project.expense ?? 0;

  return [
    { key: 'commercial-value', label: TOP_HEADER_KPI_LABELS.commercialValue, value: formatProjectMoney(commercialValue) },
    { key: 'budget-approved', label: TOP_HEADER_KPI_LABELS.budgetApproved, value: formatProjectMoney(budgetApproved) },
    { key: 'loan-approved', label: TOP_HEADER_KPI_LABELS.loanApproved, value: formatProjectMoney(loanApproved) },
    { key: 'disbursed', label: TOP_HEADER_KPI_LABELS.loanDisbursed, value: formatProjectMoney(loanDisbursed) },
    { key: 'expense', label: TOP_HEADER_KPI_LABELS.budgetSpent, value: formatProjectMoney(budgetSpent) },
    { key: 'units-total', label: TOP_HEADER_KPI_LABELS.unitsTotal, value: (hs.unitsTotal ?? project.unitsTotal ?? 0) },
    { key: 'units-sold', label: TOP_HEADER_KPI_LABELS.unitsSold, value: (hs.unitsSold ?? project.unitsSold ?? 0) },
  ];
}

function renderTopHeaderKpis(project = {}, hs = {}, kpis = {}) {
  if (!kpisDiv) return;
  const tiles = buildTopHeaderKpiTiles(project, hs, kpis);

  kpisDiv.innerHTML = tiles.map(t => `
    <div class="kpi" data-key="${t.key}">
      <div class="label">${t.label}</div>
      <div class="value">${t.value}</div>
    </div>
  `).join('');
}

// cerca de tus helpers en public/js/project.js
function renderHeaderKpis(project, hs = {}, kpis = {}) {
  renderTopHeaderKpis(project, hs, kpis);
}

function authHeadersFromApp(){
  const h = {};

  const token =
    (window.API && typeof API.getToken === 'function' && API.getToken()) ||
    (document.cookie.split('; ').find(r=>r.startsWith('token='))?.split('=')[1]) ||
    localStorage.getItem('authToken') ||
    localStorage.getItem('token') ||
    sessionStorage.getItem('authToken') ||
    sessionStorage.getItem('token');

  // SOLO si hay token real (no null/undefined/cadena vacía)
  if (token && token !== 'null' && token !== 'undefined') {
    h['Authorization'] = `Bearer ${token}`;
    h['x-auth-token'] = token; // compat
  }

  const tenant =
    (window.API && typeof API.getTenantKey === 'function' && API.getTenantKey()) ||
    (document.cookie.split('; ').find(r=>r.startsWith('tenantKey='))?.split('=')[1]) ||
    localStorage.getItem('tenantKey') ||
    sessionStorage.getItem('tenantKey');

  if (tenant && tenant !== 'null' && tenant !== 'undefined') {
    h['x-tenant'] = tenant;
    h['x-tenant-key'] = tenant; // compat
  }
  return h;
}

// --- 1) ÚNICA versión de renderBeforeAfter (tolerante a tag/baTag)
function renderBeforeAfter(items){
  const getTag = (x) => (x?.tag || x?.baTag || '').toUpperCase();
  const before = (items||[]).filter(x => getTag(x) === 'BEFORE');
  const after  = (items||[]).filter(x => getTag(x) === 'AFTER');

  const paint = (arr, gridId) => {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    if (!arr.length){
      grid.innerHTML = '<div class="small muted">Sin imágenes.</div>';
      return;
    }
    grid.innerHTML = arr.map(it=>{
      const src = secureDocUrl(it._id);
      const title = it.label || 'Foto';
      const downloadUrl = src;

      return `
      <figure class="ba-card">
        <button
          type="button"
          class="ba-photo-btn js-ba-open"
          data-src="${escapeHtml(src)}"
          data-title="${escapeHtml(title)}"
          data-download="${escapeHtml(downloadUrl)}"
          aria-label="Ver imagen en grande"
        >
          <img src="" data-secure-src="${escapeHtml(src)}" alt="${escapeHtml(title)}" style="width:100%;height:180px;object-fit:cover;border-radius:10px"/>
        </button>
        <figcaption class="small" style="margin-top:6px">${escapeHtml(title)}</figcaption>
        <div class="row space-between small muted">
          <span>${getTag(it)}</span>
          <button class="btn btn-ghost btn-xs js-ba-delete" data-id="${it._id}">Eliminar</button>
        </div>
      </figure>
    `;
    }).join('');
    hydrateSecureImages(grid);
  };

  paint(before, 'baBeforeGrid');
  paint(after,  'baAfterGrid');
}

// --- 2) Helper que SÍ lee la fuente real
function ensureBAImageViewer(){
  let viewer = document.getElementById('baImageViewer');
  if (viewer) return viewer;

  viewer = document.createElement('div');
  viewer.id = 'baImageViewer';
  viewer.className = 'ba-viewer';
  viewer.innerHTML = `
    <div class="ba-viewer-dialog" role="dialog" aria-modal="true" aria-label="Vista ampliada de imagen">
      <div class="ba-viewer-head">
        <b id="baViewerTitle">Foto</b>
        <div class="ba-viewer-actions">
          <a id="baViewerDownload" class="btn btn-primary btn-xs" href="#" download>Descargar</a>
          <button type="button" class="btn btn-ghost btn-xs" data-ba-viewer-close aria-label="Cerrar">X</button>
        </div>
      </div>
      <div class="ba-viewer-body">
        <img id="baViewerImg" src="" alt="" />
      </div>
    </div>
  `;
  document.body.appendChild(viewer);
  return viewer;
}

function closeBAImageViewer(){
  const viewer = document.getElementById('baImageViewer');
  if (!viewer) return;
  viewer.classList.remove('is-open');
  document.body.classList.remove('ba-viewer-open');
}

async function openBAImageViewer(src, title, downloadUrl){
  const viewer = ensureBAImageViewer();
  const img = viewer.querySelector('#baViewerImg');
  const titleEl = viewer.querySelector('#baViewerTitle');
  const downloadEl = viewer.querySelector('#baViewerDownload');

  if (img) {
    img.src = '';
    img.alt = title || 'Foto';
    try {
      const blob = await fetchSecureBlob(src);
      const objectUrl = URL.createObjectURL(blob);
      if (img.dataset.objectUrl) URL.revokeObjectURL(img.dataset.objectUrl);
      img.src = objectUrl;
      img.dataset.objectUrl = objectUrl;
    } catch (err) {
      console.error('[BA viewer image]', err);
      alert('No se pudo cargar la imagen.');
    }
  }
  if (titleEl) titleEl.textContent = title || 'Foto';
  if (downloadEl) {
    downloadEl.href = downloadUrl || src;
    downloadEl.setAttribute('download', '');
  }

  viewer.classList.add('is-open');
  document.body.classList.add('ba-viewer-open');
}

async function downloadBAImage(url, filename){
  if (!url) return;

  const resp = await fetch(url, {
    headers: { ...authHeaders(), ...tenantHeaders() },
    credentials: 'include'
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(txt || `HTTP ${resp.status}`);
  }

  const blob = await resp.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename || 'foto';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

(function bindBAImageViewerOnce(){
  if (window.__BA_VIEWER_BOUND__) return;
  window.__BA_VIEWER_BOUND__ = true;

  document.addEventListener('click', (e) => {
    const download = e.target.closest('#baViewerDownload');
    if (download) {
      e.preventDefault();
      const title = document.getElementById('baViewerTitle')?.textContent?.trim() || 'foto';
      downloadBAImage(download.href, title).catch(err => {
        console.error('[BA download]', err);
        alert('No se pudo descargar la imagen.');
      });
      return;
    }

    const opener = e.target.closest('.js-ba-open');
    if (opener) {
      e.preventDefault();
      openBAImageViewer(opener.dataset.src, opener.dataset.title, opener.dataset.download);
      return;
    }

    if (e.target.closest('[data-ba-viewer-close]') || e.target.id === 'baImageViewer') {
      closeBAImageViewer();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeBAImageViewer();
  });
})();

async function refreshBeforeAfter() {
  try {
    // 1) Trae docs de beforeAfter
    const list = await API.get(`/api/documents?projectId=${id}&category=beforeAfter&ts=${Date.now()}`);

    // 2) Normaliza a array
    const docs = Array.isArray(list) ? list : (list?.documents || list?.items || []);

    // ===============================
    // ✅ Export: preparar Antes/Después
    // ===============================
    const toAbs = (u) => {
      if (!u) return null;
      if (/^https?:\/\//i.test(u)) return u;
      return `${location.origin}${u.startsWith('/') ? '' : '/'}${u}`;
    };

    // URL del archivo (ajusta si tu backend usa otro nombre)
    const getUrl = (d) => d?._id ? secureDocUrl(d._id) : (d?.url || d?.fileUrl || d?.downloadUrl || d?.href || null);

    // Filtra SOLO imágenes y ordénalas por fecha
    const imgDocs = (docs || [])
      .filter(d => String(d?.mimetype || d?.contentType || '').startsWith('image/'))
      .slice()
      .sort((a,b) => new Date(a.createdAt || a.updatedAt || 0) - new Date(b.createdAt || b.updatedAt || 0));

    // ✅ MODO SEGURO: exporta todas las fotos en orden (sin depender de side)
    window.__BEFORE_AFTER__ = imgDocs
      .map(d => ({
        src: toAbs(getUrl(d)),
        createdAt: d.createdAt || d.updatedAt || null
      }))
      .filter(d => d.src);

    // 3) En informe de periodo, mostrar solo evidencia subida en ese intervalo.
    const activePeriod = window.__ACTIVE_SUMMARY_PERIOD__;
    const visibleDocs = activePeriod
      ? docs.filter(d => {
          const rawDate = d.createdAt || d.updatedAt;
          if (!rawDate) return false;
          const time = new Date(rawDate).getTime();
          const start = new Date(`${activePeriod.from}T00:00:00.000Z`).getTime();
          const end = new Date(`${activePeriod.to}T23:59:59.999Z`).getTime();
          return Number.isFinite(time) && time >= start && time <= end;
        })
      : docs;
    renderBeforeAfter(visibleDocs);

  } catch (e) {
    console.error('refreshBeforeAfter error', e);
  }
}

// --- 3) Subida usando refreshBeforeAfter
async function uploadBA(which, files) {
  if (!files?.length) return;

  const fd = new FormData();
  [...files].forEach(f => fd.append('files', f));
  if (window.__activeChecklistId) fd.append('checklistId', window.__activeChecklistId);
  if (window.__currentUnitId)     fd.append('unitId', window.__currentUnitId);

  const url = `/api/documents/upload?projectId=${encodeURIComponent(id)}&category=beforeAfter&baTag=${encodeURIComponent(which)}`;
  const headers = { ...authHeaders(), ...tenantHeaders() }; // ya los tienes definidos arriba

  const resp = await fetch(url, { method:'POST', body: fd, credentials:'include', headers });
  if (!resp.ok) {
    const txt = await resp.text().catch(()=> '');
    console.error('uploadBA error:', resp.status, txt);
    alert(`Error subiendo archivos (${resp.status}).`);
    return;
  }
  await refreshBeforeAfter();
}

// ✅ Bind global: borrar fotos Antes/Después
(function bindBADeleteOnce(){
  if (window.__BA_DELETE_BOUND__) return;
  window.__BA_DELETE_BOUND__ = true;

  // roles que NO necesitan PIN (igual que FULL_ACCESS_ROLES del backend)
  const FULL = ['admin','bank','promoter','gerencia','socios',];

  const getRole = () => {
    try {
      // si tienes API.getAuth() úsalo
      const a = (typeof API !== 'undefined' && typeof API.getAuth === 'function') ? API.getAuth() : null;
      const r = (a?.role || localStorage.getItem('role') || '').toString().toLowerCase().trim();
      return r;
    } catch {
      return (localStorage.getItem('role') || '').toString().toLowerCase().trim();
    }
  };

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.js-ba-delete');
    if (!btn) return;

    const docId = btn.dataset.id;
    if (!docId) return;

    if (!confirm('¿Eliminar esta imagen?')) return;

    const role = getRole();
    const needsPin = !FULL.includes(role);

    // ✅ si NO es rol alto, pedimos PIN
    let pin = '';
    if (needsPin) {
      pin = prompt('Introduce el PIN para borrar:') || '';
      pin = pin.trim();
      if (!pin) return; // cancelado / vacío
    }

    try {
      // ✅ manda pin por query (más robusto que body en DELETE)
      const url = needsPin
        ? `/api/documents/${docId}?pin=${encodeURIComponent(pin)}`
        : `/api/documents/${docId}`;

      const resp = await fetch(url, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          ...(typeof authHeaders === 'function' ? authHeaders() : {}),
          ...(typeof tenantHeaders === 'function' ? tenantHeaders() : {})
        }
      });

      if (!resp.ok) {
        const txt = await resp.text().catch(()=> '');
        throw new Error(`No se pudo eliminar (HTTP ${resp.status}) ${txt}`);
      }

      await refreshBeforeAfter();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Error eliminando');
    }
  });
})();

function wireBAUploads(){
  const bInput = document.getElementById('baBeforeInput');
  const aInput = document.getElementById('baAfterInput');
  const bBtn   = document.getElementById('baBeforeBtn');
  const aBtn   = document.getElementById('baAfterBtn');
  if (bBtn && bInput) bBtn.onclick = ()=> uploadBA('BEFORE', bInput.files);
  if (aBtn && aInput) aBtn.onclick = ()=> uploadBA('AFTER',  aInput.files);
}

function formatNum(v) {
  const n = Number(v || 0);
  return n.toLocaleString('en-US');
}

function formatMoney(v) {
  return formatProjectMoney(v);
}

function formatMoneyCompact(v) {
  return formatProjectMoney(v);
}

function isSummarySoldUnit(u) {
  const estado = normalizeUnitEstadoFrontend(u?.estado || u?.status || '');

  return [
    'con_cpp',
    'tramite_legal_activado',
    'escriturado_traspasado',
    'vivienda_entregada'
  ].includes(estado);
}

function isSummaryActiveCpp(v) {
  const hasCpp =
    String(v?.estatusCPP || '').toLowerCase().includes('cpp') ||
    String(v?.statusBanco || '').toLowerCase().includes('cpp') ||
    String(v?.numCPP || '').trim();

  if (!hasCpp) return false;

  const exp = v?.fechaVencimientoCPP || v?.vencimientoCPPBnMivi;
  if (!exp) return true;

  const d = new Date(exp);
  if (isNaN(d.getTime())) return false;

  d.setHours(23, 59, 59, 999);
  return d.getTime() >= Date.now();
}

function calcTotal(arr, key = 'count') {
  return (arr || []).reduce((acc, x) => acc + Number(x?.[key] || 0), 0);
}

function renderChartSummary(containerId, items, {
  labelKey = 'label',
  valueKey = 'value',
  totalLabel = 'Total',
  formatter = formatNum
} = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const total = (items || []).reduce((acc, x) => acc + Number(x?.[valueKey] || 0), 0);

  if (!items || !items.length) {
    el.innerHTML = `<div class="small muted">Sin datos</div>`;
    return;
  }

  el.innerHTML = `
    <div class="summary-mini-box">
      ${(items || []).map(item => `
        <div class="summary-mini-row">
          <span class="summary-mini-label">${item[labelKey] ?? '—'}</span>
          <span class="summary-mini-value">${formatter(item[valueKey], item)}</span>
        </div>
      `).join('')}
      <div class="summary-mini-row summary-mini-total">
        <span class="summary-mini-label">${totalLabel}</span>
        <span class="summary-mini-value">${formatter(total)}</span>
      </div>
    </div>
  `;
}

function renderFinancePhaseSummary(phases = []) {
  const el = document.getElementById('sumPhaseChartSummary');
  if (!el) return;

  el.closest('.summary-chart-card')?.classList.add('summary-phase-card');

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const sum = (items) => (items || []).reduce((acc, item) => acc + parsePanamaNumber(item?.amount || 0), 0);
  const money = (amount) => formatMoney(amount);

  const rows = (items) => {
    const data = Array.isArray(items) ? items : [];
    if (!data.length) return `<div class="summary-phase-line"><span>Sin partidas</span><strong>${money(0)}</strong></div>`;
    return data.map(item => `
      <div class="summary-phase-line">
        <span>${escapeHtml(item?.name || 'Partida')}</span>
        <strong>${money(item?.amount)}</strong>
      </div>
    `).join('');
  };

  const group = (title, items) => `
    <div class="summary-phase-group">
      <div class="summary-phase-group-title">${title}</div>
      ${rows(items)}
      <div class="summary-phase-line summary-phase-total">
        <span>Total</span>
        <strong>${money(sum(items))}</strong>
      </div>
    </div>
  `;

  if (!Array.isArray(phases) || !phases.length) {
    el.innerHTML = '<div class="small muted">Sin fases financieras registradas</div>';
    return;
  }

  el.innerHTML = phases.map((phase) => `
    <section class="summary-phase-item">
      <div class="summary-phase-title">${escapeHtml(phase?.name || phase?.title || phase?.phase || 'Fase')}</div>
      <div class="summary-phase-columns">
        ${group('Usos estimados', phase?.planUses)}
        ${group('Fuentes estimadas', phase?.planSources)}
        ${group('Usos reales', phase?.uses)}
        ${group('Fuentes reales', phase?.sources)}
      </div>
    </section>
  `).join('');
}

function renderMiniKpiBox(containerId, rows = []) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!rows.length) {
    el.innerHTML = `<div class="small muted">Sin resumen disponible</div>`;
    return;
  }

  el.innerHTML = `
    <div class="summary-resume-box">
      ${rows.map(r => `
        <div class="summary-resume-item ${r.className || ''}">
          <div class="summary-resume-title">${r.title}</div>
          <div class="summary-resume-value">${r.value}</div>
          ${r.sub ? `<div class="summary-resume-sub">${r.sub}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

async function renderSummaryUI(payload) {
  // 1) Datos base
  const project = payload.project || {};
  currentProjectCurrency = normalizeProjectCurrency(project.currency || currentProjectCurrency);
  if (projectCurrencySel) {
    projectCurrencySel.value = currentProjectCurrency;
    updateCurrencyControlMeta();
  }
  const headerKpis = payload.headerKpis || {};
  const reportPeriod = payload.reportPeriod || null;
  const isPeriodView = !!reportPeriod;

  // ✅ Cargar permisos reales para que la gráfica salga bien desde el inicio
  try {
    if (!isPeriodView && !__permits?.items?.length) {
      __permits = await apiPermitsGetProject(true);
    }
  } catch (e) {
    console.warn('[Summary] No se pudieron cargar permisos para gráfica', e);
  }

  // 2) Datos de series PRIMERO
  const progressByPhase      = payload.progressByPhase      || [];
  const permitsByInstitution = payload.permitsByInstitution || [];
  const cppByBank            = payload.cppByBank            || [];
  const proformasByBank      = payload.proformasByBank      || [];
  const unitsByStatus        = payload.unitsByStatus        || [];
  const salesMonthly         = payload.salesMonthly         || [];
  const disbursements        = payload.disbursements        || { planCum: [], realCum: [] };
  const mortgagesByBank      = payload.mortgagesByBank      || [];
  const alerts               = payload.alerts               || { expiries: [], notes: [], bySeverity: [] };
  const beforeAfter          = payload.beforeAfter          || [];
  const financePhases        = payload?.finance?.phases     || [];
  const commercial = payload.commercial || {};
  const legal      = payload.legal      || {};
  const technical  = payload.technical  || {};
  const financial  = payload.financial  || {};
  const periodActivity = payload.periodActivity || null;

  // Helpers locales
  const toNum = (v) => {
    const n = parsePanamaNumber(v);
    return Number.isFinite(n) ? n : 0;
  };

  const toStr = (v) => (v === null || v === undefined) ? '' : String(v).trim();

  const monthKey = (m) => {
    const s = toStr(m).replace('/', '-');
    if (/^\d{4}-\d{2}$/.test(s)) return s;
    const mmYYYY = s.match(/^(\d{2})-(\d{4})$/);
    if (mmYYYY) return `${mmYYYY[2]}-${mmYYYY[1]}`;
    return s;
  };

  const sortByMonth = (arr) =>
    (arr || []).slice().sort((a, b) => monthKey(a.month).localeCompare(monthKey(b.month)));

  const uniq = (arr) => Array.from(new Set(arr || []));

  const ctx = (id) => {
    const el = document.getElementById(id);
    return (el && typeof Chart !== 'undefined') ? el.getContext('2d') : null;
  };

  function calcAbsorption3mFromSalesMonthly(salesMonthly) {
    const sm = sortByMonth(salesMonthly).map(x => ({
      month: monthKey(x.month),
      units: toNum(x.units)
    }));

    const last3 = sm.slice(-3);
    if (!last3.length) return 0;

    const sum = last3.reduce((a, x) => a + (x.units || 0), 0);
    const avg = sum / last3.length;
    return Math.round(avg * 10) / 10;
  }

  const summaryChartOpts = (extra = {}) => ({
    responsive: true,
    maintainAspectRatio: false,
    ...extra
  });
  const summaryLegend = (position = 'bottom') => ({
    position,
    labels: {
      boxWidth: 16,
      boxHeight: 10,
      padding: 12,
      font: { size: 13, weight: '600' }
    }
  });

  const renderTargetKpis = (targetId, items) => {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.innerHTML = (items || []).filter(Boolean).map(x =>
      kpiCard(x.title, x.value, x.sub || '')
    ).join('');
  };

  const renderPieLike = (chartKey, canvasId, data, labelKey, valueKey, summaryId, totalLabel, type = 'doughnut') => {
    sumDestroy(chartKey);

    const list = data || [];
    if (ctx(canvasId)) {
      __sumCharts[chartKey] = new Chart(ctx(canvasId), {
        type,
        data: {
          labels: list.map(x => x[labelKey]),
          datasets: [{ data: list.map(x => toNum(x[valueKey])) }]
        },
        options: summaryChartOpts({
          plugins: { legend: summaryLegend() }
        })
      });
    }

    renderChartSummary(
      summaryId,
      list.map(x => ({ label: x[labelKey], value: toNum(x[valueKey]) })),
      { totalLabel }
    );
  };

  const renderBarSimple = (chartKey, canvasId, data, labelKey, valueKey, summaryId, totalLabel, formatter) => {
    sumDestroy(chartKey);

    const list = data || [];
    if (ctx(canvasId)) {
      __sumCharts[chartKey] = new Chart(ctx(canvasId), {
        type: 'bar',
        data: {
          labels: list.map(x => x[labelKey]),
          datasets: [{
            label: totalLabel || 'Total',
            data: list.map(x => toNum(x[valueKey]))
          }]
        },
        options: summaryChartOpts({
          plugins: { legend: { display: false } },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { precision: 0 }
            }
          }
        })
      });
    }

    renderChartSummary(
      summaryId,
      list.map(x => ({ label: x[labelKey], value: toNum(x[valueKey]), ...x })),
      { totalLabel, formatter }
    );
  };

  const summaryTab = document.getElementById('tab-resumen');
  const periodSection = document.getElementById('summaryPeriodActivity');
  if (summaryTab) summaryTab.classList.toggle('is-period-report', isPeriodView);
  if (periodSection) periodSection.hidden = !isPeriodView;

  if (isPeriodView) {
    const projectNameEl = document.getElementById('summaryProjectName');
    const updatedAtEl = document.getElementById('summaryUpdatedAt');
    if (projectNameEl) projectNameEl.textContent = project.name || 'Proyecto';
    if (updatedAtEl) updatedAtEl.textContent = `Avances registrados: ${reportPeriod.from} a ${reportPeriod.to}`;

    const totals = periodActivity?.totals || {};
    renderTargetKpis('summaryPeriodKpis', [
      { title: 'Avances registrados', value: totals.events || 0 },
      { title: 'Ventas formalizadas (contrato)', value: totals.contracts || 0, sub: formatMoney(totals.salesAmount || 0) },
      { title: 'Permisos aprobados', value: totals.permitsApproved || 0, sub: `${totals.permitsSubmitted || 0} presentados` },
      { title: 'Tareas completadas', value: totals.tasksCompleted || 0, sub: `${totals.tasksValidated || 0} validadas` },
      { title: 'CPP emitidos', value: totals.cpp || 0, sub: formatMoney(totals.cppAmount || 0) },
      { title: 'Desembolsos recibidos', value: formatMoney(totals.disbursedAmount || 0) }
    ]);

    const periodComparison = payload.periodComparison || null;
    const comparisonCard = document.getElementById('summaryPeriodCompareCard');
    const salesSeries = periodComparison?.salesSeries || null;
    if (comparisonCard) comparisonCard.hidden = !periodComparison || (!Array.isArray(periodComparison.metrics) || !periodComparison.metrics.length) && !salesSeries;

    // Si backend envío series de ventas, renderizar comparación por mes (preferible)
    if (salesSeries && ctx('sumPeriodComparison')) {
      sumDestroy('periodComparison');
      __sumCharts.periodComparison = new Chart(ctx('sumPeriodComparison'), {
        type: 'line',
        data: {
          labels: salesSeries.labels.map(l => l),
          datasets: [
            { label: 'Periodo actual', data: salesSeries.current.map(n => Number(n)), borderColor: 'rgba(54, 162, 235, 1)', backgroundColor: 'rgba(54, 162, 235, 0.08)', tension: 0.35, fill: false, pointRadius: 3 },
            { label: 'Periodo comparativo', data: salesSeries.previous.map(n => Number(n)), borderColor: 'rgba(220, 53, 69, 1)', backgroundColor: 'rgba(220, 53, 69, 0.08)', tension: 0.35, fill: false, pointRadius: 3 }
          ]
        },
        options: summaryChartOpts({
          plugins: { legend: summaryLegend() },
          scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
        })
      });

      const comparisonSummary = document.getElementById('sumPeriodComparisonSummary');
      if (comparisonSummary) {
        const totalCur = (salesSeries.current || []).reduce((a, b) => a + (Number(b) || 0), 0);
        const totalPrev = (salesSeries.previous || []).reduce((a, b) => a + (Number(b) || 0), 0);
        const diff = totalCur - totalPrev;
        const diffPct = totalPrev ? Math.round((diff / Math.abs(totalPrev)) * 100) : 0;
        const trend = diff > 0 ? `+${formatMoney(diff)} (${diffPct}%)` : diff < 0 ? `${formatMoney(diff)} (${diffPct}%)` : 'Sin cambio';
        const granularity = salesSeries.granularity === 'day' ? 'Días' : 'Meses';

        comparisonSummary.innerHTML = `
          <div class="summary-chart-summary-row"><strong>Periodo actual:</strong> ${periodComparison.period || reportPeriod.label} · ${formatMoney(totalCur)}</div>
          <div class="summary-chart-summary-row"><strong>Periodo comparativo:</strong> ${periodComparison.previousPeriod || 'Mismo periodo del año anterior'} · ${formatMoney(totalPrev)}</div>
          <div class="summary-chart-summary-row"><strong>Variación:</strong> ${trend}</div>
          <div class="summary-chart-summary-row"><strong>Granularidad:</strong> ${granularity}</div>
          <div class="summary-chart-summary-row small muted">Si no se indica comparativo, se usa por defecto el mismo intervalo del año anterior.</div>
        `;
      }

    } else {
      // Fallback: usar métricas agregadas
      if (comparisonCard) comparisonCard.hidden = !periodComparison || !Array.isArray(periodComparison.metrics) || !periodComparison.metrics.length;
      const comparisonItems = (periodComparison?.metrics || []).map(item => ({ label: item.label, current: item.current || 0, previous: item.previous || 0 }));
      if (ctx('sumPeriodComparison') && comparisonItems.length) {
        sumDestroy('periodComparison');
        __sumCharts.periodComparison = new Chart(ctx('sumPeriodComparison'), {
          type: 'bar',
          data: {
            labels: comparisonItems.map(x => x.label),
            datasets: [
              { label: 'Periodo actual', data: comparisonItems.map(x => x.current), backgroundColor: 'rgba(54, 162, 235, 0.8)' },
              { label: 'Periodo comparativo', data: comparisonItems.map(x => x.previous), backgroundColor: 'rgba(153, 102, 255, 0.8)' }
            ]
          },
          options: summaryChartOpts({ plugins: { legend: summaryLegend() }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } })
        });
      }

      const comparisonSummary = document.getElementById('sumPeriodComparisonSummary');
      if (comparisonSummary) {
        const rows = (periodComparison?.metrics || []).map(item => `
          <div class="summary-chart-summary-row"><strong>${item.label}:</strong> ${item.current.toLocaleString()} vs ${item.previous.toLocaleString()}</div>
        `).join('');
        comparisonSummary.innerHTML = rows || '<div class="small muted">No hay datos comparativos disponibles para este periodo.</div>';
      }
    }

    sumDestroy('periodEvents');
    const eventCounts = periodActivity?.counts || [];
    const periodChartCard = document.getElementById('summaryPeriodChartCard');
    // Ocultar 'Hitos por tipo' cuando estamos mostrando series de ventas (no aporta)
    if (periodChartCard) periodChartCard.hidden = !!salesSeries || eventCounts.length === 0;
    if (!salesSeries && ctx('sumPeriodEvents')) {
      __sumCharts.periodEvents = new Chart(ctx('sumPeriodEvents'), {
        type: 'bar',
        data: {
          labels: eventCounts.map(x => x.type),
          datasets: [{ label: 'Avances', data: eventCounts.map(x => toNum(x.count)) }]
        },
        options: summaryChartOpts({
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
        })
      });
    }
    renderChartSummary(
      'sumPeriodEventsSummary',
      eventCounts.map(x => ({ label: x.type, value: toNum(x.count) })),
      { totalLabel: 'Total avances' }
    );

    const timeline = document.getElementById('summaryPeriodTimeline');
    if (timeline) {
      timeline.innerHTML = (periodActivity?.events || []).map(event => `
        <div class="summary-period-row">
          <span>${new Date(event.date).toLocaleDateString()}</span>
          <strong>${event.type}</strong>
          <span>${event.detail || ''}</span>
        </div>
      `).join('') || '<div class="small muted">No hay avances fechados dentro del periodo seleccionado.</div>';
    }

    if (typeof refreshBeforeAfter === 'function') await refreshBeforeAfter();
    addInfoBadges();
    wireInfoTooltips();
    return;
  }

  // 3) Cabecera fija
  const periodUnits = payload.kpis?.units || {};
  const headerKpisFixed = {
    ...headerKpis,
    unitsTotal: isPeriodView ? (periodUnits.total || 0) : (project.unitsTotal ?? headerKpis.unitsTotal ?? 0),
    unitsSold:  isPeriodView ? (periodUnits.sold || 0) : (project.unitsSold  ?? headerKpis.unitsSold  ?? 0),
  };

    // 4) Texto unidades vendidas
  let sold = headerKpisFixed.unitsSold ?? 0;
  let total = headerKpisFixed.unitsTotal ?? 0;
  let pct = total ? Math.round(100 * sold / total) : 0;

  // 5) KPIs
  let kpis = payload.kpis || {
    progressPct: Number(payload?.progress?.globalPct || 0),
    units: {
      total: project.unitsTotal || 0,
      available: project.unitsAvailable || 0,
      sold: project.unitsSold || 0,
      escrituradas: project.unitsDeeded || 0
    },
    absorption3m: project.absorption3m || 0,
    avgTicket: project.avgTicket || 0,
    inventoryValue: project.inventoryValue || 0,
    loan: {
      approved: project.loanApproved || 0,
      disbursed: project.loanDisbursed || 0,
      pct: (project.loanApproved
        ? Math.round(100 * (project.loanDisbursed || 0) / project.loanApproved)
        : 0)
    },
    cpp: {
      active: project.cppActive || 0,
      due30: project.cppDue30 || 0,
      due60: project.cppDue60 || 0,
      due90: project.cppDue90 || 0
    },
    permits: {
      approved: project.permitsApproved || 0,
      inProcess: project.permitsInProcess || 0,
      pending: project.permitsPending || 0,
      pct: project.permitsPct || 0
    },
    appraisal: {
      avg: project.appraisalAvg || 0,
      min: project.appraisalMin || 0,
      max: project.appraisalMax || 0
    },
    clientMortgages30d: project.clientMortgages30d || 0,
    delaysByStage: []
  };

    // ✅ FIX SUMMARY: recalcula ventas y CPP activos desde datos reales
  if (!isPeriodView) try {
    const unitsFix = await getProjectUnitsAll();
    const ventasFix = await getProjectVentas();

    total = Array.isArray(unitsFix) ? unitsFix.length : total;
    sold = (unitsFix || []).filter(isSummarySoldUnit).length;
    pct = total ? Math.round(100 * sold / total) : 0;

    kpis.units = kpis.units || {};
    kpis.units.total = total;
    kpis.units.sold = sold;
    kpis.units.available = Math.max(0, total - sold);

    const cppActive = (ventasFix || []).filter(isSummaryActiveCpp).length;

    kpis.cpp = kpis.cpp || {};
    kpis.cpp.active = cppActive;

  } catch (e) {
    console.warn('[Summary FIX] No se pudo recalcular ventas/CPP', e);
  }

  // ✅ Si no viene absorción, la calculamos desde ventas mensuales
  if (!kpis.absorption3m || Number(kpis.absorption3m) === 0) {
    kpis.absorption3m = calcAbsorption3mFromSalesMonthly(salesMonthly);
  }

  window.__PROJECT_SUMMARY_KPIS = kpis;

  if (!isPeriodView) {
    renderHeaderKpis(project, { ...headerKpisFixed, unitsTotal: total, unitsSold: sold }, kpis);
  }

  const unitsTxt = document.getElementById('summaryUnits');
  if (unitsTxt) unitsTxt.textContent = `${sold}/${total} unidades vendidas (${pct}%)`;

  renderPhaseChart(financePhases, 'sumPhaseChart');
  renderPhaseSourceChart(financePhases, 'sumPhaseSourceChart');
  renderFinanceTimeCharts(financePhases, {
    durationCanvasId: 'sumPhaseTimeDurationChart',
    delayCanvasId: 'sumPhaseTimeDelayChart',
    delaySummaryId: 'sumPhaseTimeDelaySummary',
    durationSummaryId: 'sumPhaseTimeDurationSummary',
  });
  renderFinancePhaseLineCharts(financePhases, 'summaryPhaseLineCharts', 'sumPhaseLineChart', {
    lines: financial.creditLines || [],
    summary: true,
  });
  renderFinancePhaseSummary(financePhases);

  // Cabecera textual
  const name = project.name || 'Proyecto';
  const projectNameEl = document.getElementById('summaryProjectName');
  const updatedAtEl = document.getElementById('summaryUpdatedAt');

  if (projectNameEl) projectNameEl.textContent = name;
  if (updatedAtEl) {
    updatedAtEl.textContent = isPeriodView
      ? `Actividad del periodo: ${reportPeriod.from} a ${reportPeriod.to}`
      : 'Actualizado: ' + (new Date(project?.updatedAt || Date.now())).toLocaleString();
  }

  // Tarjetas KPI
  const u = kpis.units || {};
const loan = kpis.loan || {};
let cpp = kpis.cpp || {};
const app = kpis.appraisal || {};

// ✅ FIX: usar la misma fuente que los KPIs globales del proyecto
if (!isPeriodView) try {
  const portfolio = await getProjectPortfolio();
  const me = (portfolio || []).find(p => String(p._id) === String(id));

  if (me) {
    total = Number(me.unitsTotal || 0);
    sold = Number(me.unitsSold || 0);
    pct = total ? Math.round(100 * sold / total) : 0;

    kpis.units = kpis.units || {};
    kpis.units.total = total;
    kpis.units.sold = sold;
    kpis.units.available = Math.max(0, total - sold);
  }
} catch (e) {
  console.warn('[Summary] No se pudo sincronizar ventas con portfolio', e);
}

// ✅ FIX: CPP activos = tienen numCPP y NO están vencidos
if (!isPeriodView) try {
  const ventas = await getProjectVentas();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffDays = (dateValue) => {
    if (!dateValue) return null;
    const d = new Date(dateValue);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  };

  const cppVigentes = (ventas || []).filter(v => {
    const hasCpp = String(v?.numCPP || '').trim();
    const days = diffDays(v?.fechaVencimientoCPP);
    return hasCpp && days !== null && days >= 0;
  });

  cpp = {
    ...cpp,
    active: cppVigentes.length,
    due30: cppVigentes.filter(v => {
      const d = diffDays(v.fechaVencimientoCPP);
      return d >= 0 && d <= 30;
    }).length,
    due60: cppVigentes.filter(v => {
      const d = diffDays(v.fechaVencimientoCPP);
      return d > 30 && d <= 60;
    }).length,
    due90: cppVigentes.filter(v => {
      const d = diffDays(v.fechaVencimientoCPP);
      return d > 60 && d <= 90;
    }).length,
  };

  kpis.cpp = cpp;
} catch (e) {
  console.warn('[Summary] No se pudo recalcular CPP activos', e);
}

  const cards = [
    kpiCard('Progreso global', (kpis.progressPct || 0) + '%'),
    kpiCard('Unidades', `${u.total || 0} totales`, `${u.available || 0} disp · ${u.sold || 0} vend · ${u.escrituradas || 0} escr.`),
    kpiCard('Absorción 3m', (kpis.absorption3m || 0) + ' u/mes'),
    kpiCard('Ticket promedio', formatMoney(kpis.avgTicket || 0)),
    (kpis.inventoryValue ? kpiCard('Inventario a valor', formatMoney(kpis.inventoryValue || 0)) : ''),
    kpiCard('CPP', `${cpp.active || 0} activos`, `30d:${cpp.due30 || 0} · 60d:${cpp.due60 || 0} · 90d:${cpp.due90 || 0}`),
    kpiCard('Permisos', `${kpis.permits?.approved || 0} A / ${kpis.permits?.inProcess || 0} T / ${kpis.permits?.pending || 0} P`, (kpis.permits?.pct || 0) + '%'),
    ((app.avg || app.min || app.max) ? kpiCard('Avalúo promedio', formatMoney(app.avg || 0), `min ${formatMoney(app.min || 0)} · max ${formatMoney(app.max || 0)}`) : ''),
    kpiCard('Hipotecas 30d', kpis.clientMortgages30d || 0)
  ].filter(Boolean);

  const summaryKpisEl = document.getElementById('summaryKpis');
  if (summaryKpisEl) summaryKpisEl.innerHTML = cards.join('');

  const projectTypeLabel = project.projectType || project.tipoProyecto || 'No definido';
  const promoterNames = Array.isArray(project.promoters)
    ? project.promoters.map(p => p?.name || p?.email).filter(Boolean)
    : [];
  const promoterLabel = promoterNames.length
    ? promoterNames.join(', ')
    : (project.promoterName || 'No definido');
  const promoterCompanyLabel =
    project.legalData?.promoterLegalName ||
    project.promoterCompanyName ||
    project.promoterSocietyName ||
    project.legalCompanyName ||
    project.sociedad ||
    project.promoterProfile?.companyName ||
    (Array.isArray(project.promoters)
      ? project.promoters.map(p => p?.promoterProfile?.companyName).find(Boolean)
      : '') ||
    'Sociedad no definida';
  const promoterCategoryLabel = project.promoterCategory || 'No definido';
  const promoterTypeLabel =
    project.promoterType ||
    project.promoterProfile?.promoterType ||
    (Array.isArray(project.promoters)
      ? project.promoters.map(p => p?.promoterType || p?.promoterProfile?.promoterType).find(Boolean)
      : '') ||
    'No definido';

  // Resumen general extra
  renderMiniKpiBox('summaryResumeBox', [
    {
      title: 'Perfil del proyecto',
      value: `Tipo de proyecto: ${projectTypeLabel}`,
      sub: `Sociedad: ${promoterCompanyLabel} · Promotor: ${promoterLabel} · Tipo promotor: ${promoterTypeLabel} · Perfil del promotor: ${promoterCategoryLabel}`,
      className: 'project-profile-kpi'
    },
    {
      title: 'Ventas',
      value: `${sold}/${total}`,
      sub: `${pct}% vendido`
    },
    {
      title: 'CPP activos',
      value: String(cpp.active || 0),
      sub: `30d:${cpp.due30 || 0} · 60d:${cpp.due60 || 0} · 90d:${cpp.due90 || 0}`
    },
    {
      title: 'Hipotecas',
      value: String(calcTotal(mortgagesByBank, 'count')),
      sub: `${mortgagesByBank.length} bancos`
    },
    {
      title: 'Proformas',
      value: String(calcTotal(proformasByBank, 'count')),
      sub: `${proformasByBank.length} bancos`
    }
  ]);

  const legalData = project.legalData || {};
  document.getElementById('summaryLegalDataBox')?.remove();
  const legalRows = [
    ['Sociedad promotora', legalData.promoterLegalName || project.legalCompanyName || project.sociedad],
    ['Fideicomiso', legalData.trustApplies ? 'Aplica' : 'No aplica'],
    ['Nombre del fideicomiso', legalData.trustName],
    ['Representantes legales', (legalData.legalRepresentatives || legalData.representantesLegales || []).map(x => x.name || x.nombre || x).filter(Boolean).join(', ')]
  ].filter(([, value]) => String(value || '').trim());
  const boardRows = (legalData.boardMembers || []).map(item =>
    [item.name, item.cedula, item.position].filter(Boolean).join(' - ')
  ).filter(Boolean);
  const shareholderRows = (legalData.shareholders || []).map(item =>
    [item.name, item.cedula, item.percentage ? `${item.percentage}%` : ''].filter(Boolean).join(' - ')
  ).filter(Boolean);
  const legalBox = document.getElementById('summaryLegalProjectData');
  if (legalBox) legalBox.innerHTML = `
    <div class="finance-conditions-subgrid summary-legal-project-data">
      ${legalRows.map(([label, value]) => `<div class="finance-condition-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '---')}</strong></div>`).join('') || '<div class="small muted">Sin datos legales registrados.</div>'}
    </div>
    <div class="charts-grid" style="margin-top:12px;">
      <div class="card summary-chart-card"><h3>Junta directiva</h3><div class="small muted">${boardRows.map(escapeHtml).join('<br>') || 'Sin directivos registrados.'}</div></div>
      <div class="card summary-chart-card"><h3>Accionistas</h3><div class="small muted">${shareholderRows.map(escapeHtml).join('<br>') || 'Sin accionistas registrados.'}</div></div>
    </div>
  `;
  renderMiniKpiBox('summaryFinancialProfile', [
    {
      title: 'Estado del proyecto',
      value: project.status || project.estado || 'No definido',
      sub: `Tipo: ${projectTypeLabel} · Actualizado: ${project?.updatedAt ? new Date(project.updatedAt).toLocaleDateString() : '—'}`
    },
    {
      title: 'Datos del promotor',
      value: promoterLabel,
      sub: `Sociedad: ${promoterCompanyLabel} · Tipo: ${promoterTypeLabel} · Perfil: ${promoterCategoryLabel}`
    }
  ]);

  // Finanzas
  if (!isPeriodView) try {
    const fin = await getProjectFinanceSnapshot();
    const phases = fin?.finance?.phases || [];
    window.__LAST_SUMMARY_PAYLOAD__ = window.__LAST_SUMMARY_PAYLOAD__ || {};
    window.__LAST_SUMMARY_PAYLOAD__.finance = {
      ...(window.__LAST_SUMMARY_PAYLOAD__.finance || {}),
      phases
    };
    if (phases.length) {
      renderPhaseChart(phases, 'sumPhaseChart');
      renderPhaseSourceChart(phases, 'sumPhaseSourceChart');
      renderFinanceTimeCharts(phases, {
        durationCanvasId: 'sumPhaseTimeDurationChart',
        delayCanvasId: 'sumPhaseTimeDelayChart',
        delaySummaryId: 'sumPhaseTimeDelaySummary',
        durationSummaryId: 'sumPhaseTimeDurationSummary',
      });
      renderFinancePhaseLineCharts(phases, 'summaryPhaseLineCharts', 'sumPhaseLineChart', {
        lines: financial.creditLines || [],
        summary: true,
      });
      renderFinancePhaseSummary(phases);
    } else {
      renderPhaseChart([], 'sumPhaseChart');
      renderPhaseSourceChart([], 'sumPhaseSourceChart');
      renderFinanceTimeCharts([], {
        durationCanvasId: 'sumPhaseTimeDurationChart',
        delayCanvasId: 'sumPhaseTimeDelayChart',
        delaySummaryId: 'sumPhaseTimeDelaySummary',
        durationSummaryId: 'sumPhaseTimeDurationSummary',
      });
      renderFinancePhaseLineCharts([], 'summaryPhaseLineCharts', 'sumPhaseLineChart', {
        lines: financial.creditLines || [],
        summary: true,
      });
      renderFinancePhaseSummary([]);
      console.warn('[Resumen] Finanzas sin fases');
    }
  } catch (e) {
    console.error('[Resumen] Error cargando fases de finanzas', e);
  }

  // Barra progreso global
  const progressPct = Number(kpis?.progressPct || 0);
  const spT = document.getElementById('summaryProgressText');
  const spB = document.getElementById('summaryProgressBar');
  if (spT) spT.textContent = `${progressPct}% completado`;
  if (spB) spB.style.width = `${progressPct}%`;

  // ---------- Progreso por fase ----------
  sumDestroy('p1');
  if (ctx('sumProgressByPhase')) {
    __sumCharts.p1 = new Chart(ctx('sumProgressByPhase'), {
      type: 'bar',
      data: {
        labels: progressByPhase.map(x => x.phase),
        datasets: [{
          label: '% completado',
          data: progressByPhase.map(x => toNum(x.pct))
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 100 } }
      }
    });
  }
  renderChartSummary('sumProgressByPhaseSummary',
    progressByPhase.map(x => ({ label: x.phase, value: toNum(x.pct) })),
    { totalLabel: 'Suma', formatter: (v) => `${v}%` }
  );

  // ---------- Permisos por institución ----------
  sumDestroy('p2');
  if (ctx('sumPermitsByInstitution')) {
    const inst = (!isPeriodView && __permits?.items?.length)
      ? buildPermitsByInstitution(__permits.items)
      : permitsByInstitution;

    __sumCharts.p2 = new Chart(ctx('sumPermitsByInstitution'), {
      type: 'bar',
      data: {
        labels: inst.map(x => x.institution),
        datasets: [
          { label: 'Pendiente',  data: inst.map(x => toNum(x.pending)),   stack: 's' },
          { label: 'En trámite', data: inst.map(x => toNum(x.inProcess)), stack: 's' },
          { label: 'Aprobado',   data: inst.map(x => toNum(x.approved)),  stack: 's' },
          { label: 'Rechazado',  data: inst.map(x => toNum(x.rejected)),  stack: 's' },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true }
        }
      }
    });

    renderChartSummary('sumPermitsByInstitutionSummary',
      inst.map(x => ({
        label: x.institution,
        value: toNum(x.pending) + toNum(x.inProcess) + toNum(x.approved) + toNum(x.rejected)
      })),
      { totalLabel: 'Total permisos' }
    );
  }

  // ---------- CPP por banco ----------
  sumDestroy('p3');
  if (ctx('sumCppPie')) {
    __sumCharts.p3 = new Chart(ctx('sumCppPie'), {
      type: 'pie',
      data: {
        labels: cppByBank.map(x => x.bank),
        datasets: [{ data: cppByBank.map(x => toNum(x.count)) }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: summaryLegend()
        }
      }
    });
  }
  renderChartSummary('sumCppPieSummary',
    cppByBank.map(x => ({ label: x.bank, value: toNum(x.count) })),
    { totalLabel: 'Total CPP' }
  );

  // ---------- Proformas por banco ----------
  sumDestroy('p4');
  const pfLabels = proformasByBank.map(x => x.bank);
  const pfData = proformasByBank.map(x => toNum(x.count));

  const pfTotal = pfData.reduce((a, v) => a + (Number(v) || 0), 0);
  const elTot = document.getElementById('sumProformasTotal');
  if (elTot) elTot.textContent = pfTotal;

  if (ctx('sumProformasBar')) {
    __sumCharts.p4 = new Chart(ctx('sumProformasBar'), {
      type: 'bar',
      data: {
        labels: pfLabels,
        datasets: [{
          label: 'Proformas',
          data: pfData
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (c) => ` ${c.label}: ${c.parsed.y}`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0 }
          }
        }
      }
    });
  }
  renderChartSummary('sumProformasBarSummary',
    proformasByBank.map(x => ({ label: x.bank, value: toNum(x.count) })),
    { totalLabel: 'Total proformas' }
  );

  // ---------- Estado de unidades ----------
  sumDestroy('p5');
  if (ctx('sumUnitsDonut')) {
    __sumCharts.p5 = new Chart(ctx('sumUnitsDonut'), {
      type: 'doughnut',
      data: {
        labels: unitsByStatus.map(x => x.status),
        datasets: [{ data: unitsByStatus.map(x => toNum(x.count)) }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: summaryLegend()
        }
      }
    });
  }
  renderChartSummary('sumUnitsDonutSummary',
    unitsByStatus.map(x => ({ label: x.status, value: toNum(x.count) })),
    { totalLabel: 'Total unidades' }
  );

  // ---------- Ventas mensuales ----------
  sumDestroy('p6');
  if (ctx('sumSalesMonthly')) {
    const sm = sortByMonth(salesMonthly).map(x => ({
      month: monthKey(x.month),
      units: toNum(x.units)
    }));

    __sumCharts.p6 = new Chart(ctx('sumSalesMonthly'), {
      type: 'line',
      data: {
        labels: sm.map(x => x.month),
        datasets: [{
          label: 'Unidades',
          data: sm.map(x => x.units),
          tension: .3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true } }
      }
    });

    renderChartSummary('sumSalesMonthlySummary',
      sm.map(x => ({ label: x.month, value: x.units })),
      { totalLabel: 'Total ventas' }
    );
  }

  // ---------- Desembolsos plan vs real ----------
  sumDestroy('p7');
  if (ctx('sumDisbPlanReal')) {
    const planRaw = sortByMonth(disbursements?.planCum || []).map(x => ({
      month: monthKey(x.month),
      amount: toNum(x.amount)
    }));
    const realRaw = sortByMonth(disbursements?.realCum || []).map(x => ({
      month: monthKey(x.month),
      amount: toNum(x.amount)
    }));

    const months = uniq([
      ...planRaw.map(x => x.month),
      ...realRaw.map(x => x.month)
    ]).sort((a, b) => a.localeCompare(b));

    const planMap = new Map(planRaw.map(x => [x.month, x.amount]));
    const realMap = new Map(realRaw.map(x => [x.month, x.amount]));

    __sumCharts.p7 = new Chart(ctx('sumDisbPlanReal'), {
      type: 'line',
      data: {
        labels: months,
        datasets: [
          { label: 'Plan', data: months.map(m => planMap.get(m) ?? 0), tension: .3 },
          { label: 'Real', data: months.map(m => realMap.get(m) ?? 0), tension: .3 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  // ---------- Hipotecas por banco ----------
sumDestroy('p8');
if (ctx('sumMortgagesByBank')) {
  __sumCharts.p8 = new Chart(ctx('sumMortgagesByBank'), {
    type: 'bar',
    data: {
      labels: mortgagesByBank.map(x => x.bank),
      datasets: [{
        label: 'Hipotecas',
        data: mortgagesByBank.map(x => toNum(x.count))
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            label: (context) => {
              const item = mortgagesByBank[context.dataIndex] || {};
              const count = toNum(item.count);
              const amount = toNum(item.amount);
              return ` ${count} hipotecas · ${formatMoneyCompact(amount)}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0 }
        }
      }
    }
  });
}
renderChartSummary(
  'sumMortgagesByBankSummary',
  mortgagesByBank.map(x => ({
    label: x.bank,
    value: toNum(x.count),
    amount: toNum(x.amount)
  })),
  {
    totalLabel: 'Total hipotecas',
    formatter: (v, item) => {
      const amount = toNum(item?.amount);
      return `${toNum(v)} · ${formatMoneyCompact(amount)}`;
    }
  }
);

  // =========================================================
  // NUEVO RESUMEN COMERCIAL / LEGAL / TÉCNICO / FINANCIERO
  // =========================================================

  // ---------- Comercial: ventas vs caídas ----------
  const commercialFallenSales = (commercial.salesVsFallenByYear || [])
    .reduce((sum, item) => sum + toNum(item.fallen), 0);
  const commercialCppAmount = calcTotal(commercial.cppAmountByBank || [], 'amount');

  renderTargetKpis('summaryCommercialKpis', [
    { title: 'Unidades totales', value: u.total || 0 },
    {
      title: 'Unidades vendidas',
      value: u.sold || 0,
      sub: `${pct}% del inventario`
    },
    { title: 'Unidades disponibles', value: u.available || 0 },
    { title: 'Absorción 3m', value: `${kpis.absorption3m || 0} u/mes` },
    { title: 'Ticket promedio', value: formatMoney(kpis.avgTicket || 0) },
    { title: 'Ventas caídas', value: commercialFallenSales },
    {
      title: 'CPP activos',
      value: cpp.active || 0,
      sub: formatMoney(commercialCppAmount)
    }
  ]);

  sumDestroy('p11');
  const salesVsFallen = commercial.salesVsFallenByYear || [];
  if (ctx('sumSalesVsFallen')) {
    __sumCharts.p11 = new Chart(ctx('sumSalesVsFallen'), {
      type: 'bar',
      data: {
        labels: salesVsFallen.map(x => x.year),
        datasets: [
          { label: 'Ventas', data: salesVsFallen.map(x => toNum(x.sales)), stack: 's' },
          { label: 'Ventas caídas', data: salesVsFallen.map(x => toNum(x.fallen)), stack: 's' }
        ]
      },
      options: summaryChartOpts({
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }
        }
      })
    });
  }
  renderChartSummary(
    'sumSalesVsFallenSummary',
    salesVsFallen.map(x => ({ label: x.year, value: toNum(x.sales), fallen: toNum(x.fallen) })),
    {
      totalLabel: 'Ventas reales',
      formatter: (v, item) => `${toNum(v)} ventas · ${toNum(item?.fallen)} caídas`
    }
  );

  // ---------- Comercial: modelos / perfiles ----------
  renderPieLike('p12', 'sumSalesByModel', commercial.salesByModel || [], 'model', 'count', 'sumSalesByModelSummary', 'Total ventas por modelo', 'pie');
  renderPieLike('p13', 'sumClientProfile', commercial.clientProfile || [], 'profile', 'count', 'sumClientProfileSummary', 'Total perfiles', 'doughnut');
  renderPieLike('p14', 'sumCompanyType', commercial.companyType || [], 'type', 'count', 'sumCompanyTypeSummary', 'Total empresas', 'doughnut');
  renderPieLike('p15', 'sumBankStatus', commercial.bankStatus || [], 'status', 'count', 'sumBankStatusSummary', 'Total estados banco', 'doughnut');

  // ---------- Comercial: montos CPP por banco ----------
  renderBarSimple(
    'p16',
    'sumCppAmountByBank',
    commercial.cppAmountByBank || [],
    'bank',
    'amount',
    'sumCppAmountByBankSummary',
    'Total monto CPP',
    (v, item) => `${formatMoneyCompact(toNum(item?.amount || v))}`
  );

  // ---------- Legal: KPIs ----------
  const lt = legal.totals || {};
  renderTargetKpis('summaryLegalKpis', [
    { title: 'Contratos firmados', value: lt.contratosFirmados || 0 },
    { title: 'Minutas liberación', value: lt.minutasLiberacion || 0 },
    { title: 'Minutas segregación', value: lt.minutasSegregacion || 0 },
    { title: 'Minutas préstamo', value: lt.minutasPrestamo || 0 },
    { title: 'Protocolos cliente', value: lt.protocolosCliente || 0 },
    { title: 'Protocolos banco cliente', value: lt.protocolosBancoCliente || 0 },
    { title: 'Protocolos banco', value: lt.protocolosBanco || 0 },
    { title: 'Escrituras inscritas', value: lt.escriturasInscritas || 0 },
    { title: 'Fincas segregadas', value: lt.fincasSegregadas || 0 }
  ]);

  renderPieLike('p17', 'sumLegalLiberacion', legal.minutasLiberacion || [], 'status', 'count', 'sumLegalLiberacionSummary', 'Total minutas', 'pie');
  renderPieLike('p18', 'sumLegalSegregacion', legal.minutasSegregacion || [], 'status', 'count', 'sumLegalSegregacionSummary', 'Total minutas', 'pie');
  renderPieLike('p19', 'sumLegalPrestamo', legal.minutasPrestamo || [], 'status', 'count', 'sumLegalPrestamoSummary', 'Total minutas', 'pie');

  // ---------- Legal: firma protocolo por banco ----------
  sumDestroy('p20');
  const protocolByBank = legal.protocolByBank || [];
  if (ctx('sumProtocolByBank')) {
    __sumCharts.p20 = new Chart(ctx('sumProtocolByBank'), {
      type: 'bar',
      data: {
        labels: protocolByBank.map(x => x.bank),
        datasets: [
          { label: 'Cliente', data: protocolByBank.map(x => toNum(x.cliente)) },
          { label: 'Banco cliente', data: protocolByBank.map(x => toNum(x.bancoCliente)) },
          { label: 'Banco interino', data: protocolByBank.map(x => toNum(x.bancoInterino)) }
        ]
      },
      options: summaryChartOpts({
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } }
        }
      })
    });
  }
  renderChartSummary(
    'sumProtocolByBankSummary',
    protocolByBank.map(x => ({
      label: x.bank,
      value: toNum(x.cliente) + toNum(x.bancoCliente) + toNum(x.bancoInterino)
    })),
    { totalLabel: 'Total firmas protocolo' }
  );

  // ---------- Técnico: KPIs ----------
  const tt = technical.permitsTotals || {};
  renderTargetKpis('summaryTechnicalKpis', [
    { title: 'Permisos construcción', value: tt.construction || 0 },
    { title: 'Permisos ocupación', value: tt.occupation || 0 },
    { title: 'Fases construcción', value: (technical.constructionPhase || []).length },
    { title: 'Modelos en construcción', value: (technical.modelsInConstruction || []).length }
  ]);

  renderPieLike('p21', 'sumConstructionStatus', technical.constructionStatus || [], 'status', 'count', 'sumConstructionStatusSummary', 'Total estatus', 'doughnut');
  renderBarSimple('p22', 'sumConstructionPhase', technical.constructionPhase || [], 'phase', 'count', 'sumConstructionPhaseSummary', 'Total fases');
  renderPieLike('p23', 'sumModelsInConstruction', technical.modelsInConstruction || [], 'model', 'count', 'sumModelsInConstructionSummary', 'Total modelos', 'pie');
  renderBarSimple('p24', 'sumConstructionProgressRanges', technical.constructionProgressRanges || [], 'range', 'count', 'sumConstructionProgressRangesSummary', 'Total unidades');

  // ---------- Financiero: KPIs ----------
  const fc = financial.cppCoverage || {};
  const financeTotals = financial.totals || {};

  const loanApprovedSummary =
    project.loanApproved ??
    headerKpis.loanApproved ??
    kpis.loan?.approved ??
    0;

  const loanDisbursedSummary =
    financeTotals.disbursed ??
    project.loanDisbursed ??
    headerKpis.loanDisbursed ??
    kpis.loan?.disbursed ??
    0;

  const budgetApprovedSummary =
    project.budgetApproved ??
    headerKpis.budgetApproved ??
    0;

  renderTargetKpis('summaryFinancialKpis', isPeriodView ? [
    {
      title: 'Totales financieros',
      value: 'Sin historico',
      sub: 'No existen movimientos fechados para reconstruir este periodo'
    },
    {
      title: 'CPP del periodo',
      value: formatMoney(fc.cppVigenteAmount || 0),
      sub: `${fc.coverageCppVigentePct || 0}% cobertura sobre datos fechables`
    },
    {
      title: 'CPP en tramite',
      value: `${cpp.active || 0} activos`,
      sub: `30d:${cpp.due30 || 0} - 60d:${cpp.due60 || 0} - 90d:${cpp.due90 || 0}`
    }
  ] : [
    {
      title: 'Loan aprobado',
      value: formatMoney(loanApprovedSummary)
    },
    {
      title: 'Desembolsado',
      value: formatMoney(loanDisbursedSummary)
    },
    {
      title: 'Amortización total',
      value: formatMoney(financeTotals.amortized || 0),
      sub: `${formatMoney(financeTotals.manualAmortized || 0)} manual · ${formatMoney(financeTotals.allocatedAmortized || 0)} ventas`
    },
    {
      title: 'Intereses pagados',
      value: formatMoney(financeTotals.interestPaid || 0)
    },
    {
      title: 'Total pagado al banco',
      value: formatMoney(financeTotals.totalPaidToBank || 0),
      sub: 'Amortizaciones + intereses'
    },
    {
      title: 'Saldo por pagar',
      value: formatMoney(financeTotals.debt || 0)
    },
    {
      title: 'Budget aprobado',
      value: formatMoney(budgetApprovedSummary)
    },
    {
      title: 'Valor base / cheques',
      value: formatMoney(financeTotals.checkAmountTotal || 0)
    },
    {
      title: 'Total promotor',
      value: formatMoney(financeTotals.promoterTotal || 0)
    },
    {
      title: 'CPP vigente',
      value: formatMoney(fc.cppVigenteAmount || 0),
      sub: `${fc.coverageCppVigentePct || 0}% cobertura`
    },
    {
      title: 'CPP en trámite',
      value: `${cpp.active || 0} activos`,
      sub: `30d:${cpp.due30 || 0} · 60d:${cpp.due60 || 0} · 90d:${cpp.due90 || 0}`
    }
  ]);

  // ---------- Financiero: líneas crédito ----------
  renderMiniKpiBox('summaryFinanceControlCards', [
    {
      title: 'Prestamo promotor',
      value: `Desembolsado: ${formatMoney(financeTotals.disbursed || 0)}`,
      sub: `Saldo por pagar: ${formatMoney(financeTotals.debt || 0)}`
    },
    {
      title: 'Recuperacion del banco',
      value: formatMoney(financeTotals.amortized || 0),
      sub: `Manual: ${formatMoney(financeTotals.manualAmortized || 0)} · Ventas: ${formatMoney(financeTotals.allocatedAmortized || 0)}`
    },
    {
      title: 'Intereses pagados',
      value: formatMoney(financeTotals.interestPaid || 0),
      sub: `Total pagado al banco: ${formatMoney(financeTotals.totalPaidToBank || 0)}`
    },
    {
      title: 'Ventas / cheques',
      value: formatMoney(financeTotals.checkAmountTotal || 0),
      sub: `Destinado a promotor: ${formatMoney(financeTotals.promoterTotal || 0)}`
    }
  ]);

  sumDestroy('p25');
  const creditLines = financial.creditLines || [];
  const creditLineLabel = line => line.phaseName ? `${line.phaseName} · ${line.name}` : `Sin fase · ${line.name}`;
  if (ctx('sumCreditLines')) {
    __sumCharts.p25 = new Chart(ctx('sumCreditLines'), {
      type: 'bar',
      data: {
        labels: creditLines.map(creditLineLabel),
        datasets: [
          { label: 'Desembolsado', data: creditLines.map(x => toNum(x.disbursementAmount ?? x.disbursedAmount)) },
          { label: 'Amortizado total', data: creditLines.map(x => toNum(x.totalRecovered ?? x.amortizedAmount)) }
        ]
      },
      options: summaryChartOpts({
        scales: {
          x: { stacked: false },
          y: { stacked: false, beginAtZero: true }
        }
      })
    });
  }
  renderChartSummary(
    'sumCreditLinesSummary',
    creditLines.map(x => ({
      label: creditLineLabel(x),
      value: toNum(x.totalRecovered ?? x.amortizedAmount),
      balance: toNum(x.balanceAfterSales ?? x.debt),
      disbursed: toNum(x.disbursementAmount ?? x.disbursedAmount),
      amortized: toNum(x.totalRecovered ?? x.amortizedAmount)
    })),
    {
      totalLabel: 'Total amortizado',
      formatter: (v, item) => `${formatMoneyCompact(toNum(item?.disbursed))} desemb. - ${formatMoneyCompact(toNum(v))} amort. - ${formatMoneyCompact(toNum(item?.balance))} saldo`
    }
  );

  // ---------- Financiero: cobertura CPP ----------
  sumDestroy('p26');
  const coverageRows = [
    { label: 'Deuda actual', amount: toNum(fc.totalDebt) },
    { label: 'CPP vigentes', amount: toNum(fc.cppVigenteAmount) },
    { label: 'CPP en trámite', amount: toNum(fc.cppTramiteAmount) }
  ];

  if (ctx('sumCppCoverage')) {
    __sumCharts.p26 = new Chart(ctx('sumCppCoverage'), {
      type: 'bar',
      data: {
        labels: coverageRows.map(x => x.label),
        datasets: [{
          label: 'Monto',
          data: coverageRows.map(x => x.amount)
        }]
      },
      options: summaryChartOpts({
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      })
    });
  }
  renderChartSummary(
    'sumCppCoverageSummary',
    coverageRows.map(x => ({ label: x.label, value: x.amount })),
    {
      totalLabel: 'Referencia',
      formatter: (v) => formatMoneyCompact(toNum(v))
    }
  );

  // ---------- Alertas por severidad ----------
  sumDestroy('p9');
  if (ctx('sumAlertsSeverity')) {
    const sev = alerts?.bySeverity || [];
    __sumCharts.p9 = new Chart(ctx('sumAlertsSeverity'), {
      type: 'bar',
      data: {
        labels: sev.map(x => x.severity),
        datasets: [{
          label: 'Alertas',
          data: sev.map(x => toNum(x.count))
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true } }
      }
    });

    renderChartSummary('sumAlertsSeveritySummary',
      sev.map(x => ({ label: x.severity, value: toNum(x.count) })),
      { totalLabel: 'Total alertas' }
    );
  }

  // ---------- Expedientes atrasados por etapa ----------
  sumDestroy('p10');
  if (ctx('sumDelaysByStage')) {
    const d = kpis?.delaysByStage || [];
    __sumCharts.p10 = new Chart(ctx('sumDelaysByStage'), {
      type: 'bar',
      data: {
        labels: d.map(x => x.stage),
        datasets: [{
          label: 'Expedientes atrasados',
          data: d.map(x => toNum(x.count))
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true } }
      }
    });

    renderChartSummary('sumDelaysByStageSummary',
      d.map(x => ({ label: x.stage, value: toNum(x.count) })),
      { totalLabel: 'Total atrasados' }
    );
  }

  // Alertas / conclusiones
  const isActiveDoc = (a) => !a?.status || String(a?.status || '').toUpperCase() === 'ACTIVE';
  const alertsDiv = document.getElementById('summaryAlerts');
  if (alertsDiv) {
    alertsDiv.innerHTML = (alerts?.expiries || []).filter(isActiveDoc)
      .sort((a, b) => new Date(a.due || 0) - new Date(b.due || 0))
      .slice(0, 10)
      .map(a => {
        const due = a.due ? new Date(a.due).toISOString().slice(0, 10) : '—';
        const days = Number(a.daysLeft);
        const daysText = Number.isFinite(days)
          ? days < 0
            ? `Vencido hace ${Math.abs(days)} dias`
            : `Vence en ${days} dias`
          : due;
        const extra = a.balance ? ` · Saldo ${formatMoney(a.balance)}` : '';
        return `<div class="row space-between small" style="padding:8px 10px;border:1px solid rgba(148,163,184,.25);border-radius:10px;margin-bottom:7px;">
          <div>${a.type} — <b>${a.name || a.bank || a.institution || ''}</b><span class="muted">${extra}</span></div>
          <div>${daysText}</div>
        </div>`;
      })
      .join('') || '<div class="small muted">Sin vencimientos próximos</div>';
  }

  const notesUl = document.getElementById('summaryNotes');
  if (notesUl) {
    notesUl.innerHTML = (alerts?.notes || []).map(n => `<li>${n}</li>`).join('') || '<li class="muted">Sin observaciones</li>';
  }

  // Antes / Después
  if (typeof wireBADeleteDelegation === 'function') {
  wireBADeleteDelegation();
}

if (typeof refreshBeforeAfter === 'function') {
  await refreshBeforeAfter();
}

addInfoBadges();
wireInfoTooltips();
}

async function syncUnitsSoldFromPortfolio() {
  try {
    // 1) Traemos el mismo listado que usa el portfolio
    const list = await getProjectPortfolio();
    const me = (list || []).find(p => String(p._id) === String(id));
    if (!me) return;

    // 2) Actualizamos los tiles de cabecera por data-key, no por texto visible.
    const setHeaderKpiValue = (key, value) => {
      const valEl = kpisDiv?.querySelector(`.kpi[data-key="${key}"] .value`);
      if (valEl) valEl.textContent = Number(value || 0).toLocaleString();
    };
    setHeaderKpiValue('units-sold', me.unitsSold);
    setHeaderKpiValue('units-total', me.unitsTotal);

    // 3) (opcional) Línea pequeña “x/y unidades vendidas (%)” si la tienes
    const unitsTxt = document.getElementById('summaryUnits');
    if (unitsTxt) {
      let sold = Number(me.unitsSold || 0);
      let total = Number(me.unitsTotal || 0);
      let pct = total ? Math.round(100 * sold / total) : 0;
      unitsTxt.textContent = `${sold}/${total} unidades vendidas (${pct}%)`;
    }
  } catch (e) {
    console.error('syncUnitsSoldFromPortfolio error', e);
  }
}

window.__BEFORE_AFTER__ = [];

async function loadSummary() {
  try {
    const activePeriod = window.__ACTIVE_SUMMARY_PERIOD__ || null;
    const periodQuery = activePeriod
      ? `&dateFrom=${encodeURIComponent(activePeriod.from)}&dateTo=${encodeURIComponent(activePeriod.to)}${activePeriod.compareFrom && activePeriod.compareTo ? `&compareDateFrom=${encodeURIComponent(activePeriod.compareFrom)}&compareDateTo=${encodeURIComponent(activePeriod.compareTo)}` : ''}`
      : '';
    // evitar caché del navegador
    const res = await API.get(`/api/projects/${id}/summary?ts=${Date.now()}${periodQuery}`);
    window.__LAST_SUMMARY_PAYLOAD__ = res;

    // 🔥 recalcular progreso EXACTAMENTE igual que Proyecto
 if (!activePeriod) try {
  const raw = await API.get(`/api/projects/${id}/checklists?ts=${Date.now()}`);
  const list = (raw?.checklists || raw || []);

  const filtered = list.filter(c => true); // igual que globalProgress (sin onlyPending)
  const total = filtered.reduce((acc, c) => acc + checklistProgress(c), 0);
  const pct = filtered.length ? Math.round(total / filtered.length) : 0;

  res.kpis = res.kpis || {};
  res.kpis.progressPct = pct;

  res.progress = res.progress || {};
  res.progress.globalPct = pct;
} catch (e) {
  console.warn('Error recalculando progreso', e);
}

    // ===== Exportación (RESUMEN) => POST + incluir gráficas (canvas) =====
    const exl = document.getElementById('exportSummaryXlsx');
    const pdf = document.getElementById('exportSummaryPdf');
    const reportDateFrom = document.getElementById('summaryReportDateFrom');
    const reportDateTo = document.getElementById('summaryReportDateTo');
    const compareDateFrom = document.getElementById('summaryCompareDateFrom');
    const compareDateTo = document.getElementById('summaryCompareDateTo');
    const reportDateApply = document.getElementById('summaryReportDateApply');
    const reportDateClear = document.getElementById('summaryReportDateClear');

    if (activePeriod) {
      if (reportDateFrom) reportDateFrom.value = activePeriod.from || '';
      if (reportDateTo) reportDateTo.value = activePeriod.to || '';
      if (compareDateFrom) compareDateFrom.value = activePeriod.compareFrom || '';
      if (compareDateTo) compareDateTo.value = activePeriod.compareTo || '';
    }

    if (reportDateApply && !reportDateApply.dataset.bound) {
      reportDateApply.dataset.bound = '1';
      reportDateApply.addEventListener('click', async () => {
        try {
          window.__ACTIVE_SUMMARY_PERIOD__ = selectedReportPeriod();
          await loadSummary();
        } catch (err) {
          alert(err.message || 'No se pudo aplicar el periodo.');
        }
      });
    }

    if (reportDateClear && !reportDateClear.dataset.bound) {
      reportDateClear.dataset.bound = '1';
      reportDateClear.addEventListener('click', async () => {
        if (reportDateFrom) reportDateFrom.value = '';
        if (reportDateTo) reportDateTo.value = '';
        if (compareDateFrom) compareDateFrom.value = '';
        if (compareDateTo) compareDateTo.value = '';
        window.__ACTIVE_SUMMARY_PERIOD__ = null;
        await loadSummary();
      });
    }

    const selectedReportPeriod = () => {
      const from = reportDateFrom?.value || '';
      const to = reportDateTo?.value || '';
      const compareFrom = compareDateFrom?.value || '';
      const compareTo = compareDateTo?.value || '';
      if (!from && !to && (compareFrom || compareTo)) throw new Error('Selecciona primero el periodo del resumen antes de indicar un comparativo.');
      if (!from && !to) return null;
      if (!from || !to) throw new Error('Selecciona las dos fechas del periodo o limpia el filtro para generar el informe global.');
      if (from > to) throw new Error('La fecha inicial no puede ser posterior a la fecha final.');
      if ((compareFrom && !compareTo) || (!compareFrom && compareTo)) throw new Error('Selecciona las dos fechas del periodo de comparación o déjalo vacío.');
      if (compareFrom && compareTo && compareFrom > compareTo) throw new Error('La fecha inicial de comparación no puede ser posterior a la fecha final.');
      const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00.000Z`).getTime() - new Date(`${a}T00:00:00.000Z`).getTime()) / 86400000) + 1;
      if (compareFrom && compareTo) {
        const currentDays = daysBetween(from, to);
        const comparisonDays = daysBetween(compareFrom, compareTo);
        const daysDifference = Math.abs(currentDays - comparisonDays);
        const currentStart = new Date(`${from}T00:00:00.000Z`);
        const comparisonStart = new Date(`${compareFrom}T00:00:00.000Z`);
        const monthShift = Math.abs((comparisonStart.getFullYear() - currentStart.getFullYear()) * 12 + (comparisonStart.getMonth() - currentStart.getMonth()));
        const sameStartDay = currentStart.getDate() === comparisonStart.getDate();
        const isAdjacentMonth = sameStartDay && monthShift === 1 && daysDifference <= 4;
        if (currentDays !== comparisonDays && !isAdjacentMonth) {
          throw new Error('El periodo de comparación debe tener la misma duración que el periodo analizado, salvo meses consecutivos con distinta cantidad de días.');
        }
      }
      return { from, to, compareFrom, compareTo, label: `${from} - ${to}` };
    };

    const inReportPeriod = (value, period) => {
      if (!period) return true;
      const time = new Date(value || 0).getTime();
      const from = new Date(`${period.from}T00:00:00.000Z`).getTime();
      const to = new Date(`${period.to}T23:59:59.999Z`).getTime();
      return Number.isFinite(time) && time >= from && time <= to;
    };

    const captureCanvas = (canvasId) => {
      const c = document.getElementById(canvasId);
      if (!c) return null;

      // 2x + fondo blanco (para que no salga transparente en PDF/Excel)
      const scale = 2;
      const off = document.createElement('canvas');
      off.width = c.width * scale;
      off.height = c.height * scale;

      const ctx2 = off.getContext('2d');
      ctx2.fillStyle = '#ffffff';
      ctx2.fillRect(0, 0, off.width, off.height);
      ctx2.drawImage(c, 0, 0, off.width, off.height);

      return off.toDataURL('image/png');
    };

    const downloadBlob = async (resp, filename) => {
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    };

    const safeReportFilenamePart = (value, fallback = 'Proyecto') => {
      const clean = String(value || fallback)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return (clean || fallback).slice(0, 90);
    };

    const downloadDateStamp = () => {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };

    const exportReportFilename = (payload, ext, reportPeriod) => {
      const projectName =
        payload?.project?.name ||
        payload?.projectName ||
        document.getElementById('pname')?.textContent ||
        'Proyecto';

      const periodPart = reportPeriod ? ` - ${reportPeriod.from}_a_${reportPeriod.to}` : '';
      return `Informe Bank73 - ${safeReportFilenamePart(projectName)}${periodPart} - ${downloadDateStamp()}.${ext}`;
    };

    const exportSummary = async (format) => {
  const btn = format === 'pdf' ? pdf : exl;
  const originalText = btn?.textContent || '';

  if (btn?.dataset.loading === '1') return;

  try {
    [pdf, exl].forEach(b => {
  if (!b) return;
  b.dataset.loading = '1';
  b.style.pointerEvents = 'none';
  b.style.opacity = '0.6';
});

if (btn) {
  btn.textContent = format === 'pdf' ? 'Generando PDF...' : 'Generando Excel...';
}
      const reportPeriod = selectedReportPeriod();
      const activePeriod = window.__ACTIVE_SUMMARY_PERIOD__ || null;
      const periodKey = (period) => period ? `${period.from}|${period.to}|${period.compareFrom || ''}|${period.compareTo || ''}` : '';
      if (periodKey(reportPeriod) !== periodKey(activePeriod)) {
        window.__ACTIVE_SUMMARY_PERIOD__ = reportPeriod;
        await loadSummary();
      }
      const payload = window.__LAST_SUMMARY_PAYLOAD__ || {};

      // Capturamos charts (los que existan)
      const charts = reportPeriod ? {
        'Avances registrados en el periodo': captureCanvas('sumPeriodComparison') || captureCanvas('sumPeriodEvents'),
      } : {
        'Estatus lotes / unidades': captureCanvas('sumUnitsDonut'),
        'Ventas mensuales': captureCanvas('sumSalesMonthly'),
        'Ventas vs ventas caídas': captureCanvas('sumSalesVsFallen'),
        'Ventas por modelo de vivienda': captureCanvas('sumSalesByModel'),
        'Estatus en banco': captureCanvas('sumBankStatus'),
        'CPP por banco': captureCanvas('sumCppPie'),
        'Montos CPP por banco': captureCanvas('sumCppAmountByBank'),
        'Proformas por banco': captureCanvas('sumProformasBar'),
        'Hipotecas por banco': captureCanvas('sumMortgagesByBank'),

        'Minutas de liberación': captureCanvas('sumLegalLiberacion'),
        'Minutas de segregación': captureCanvas('sumLegalSegregacion'),
        'Minutas de préstamo': captureCanvas('sumLegalPrestamo'),
        'Firma de protocolo por banco': captureCanvas('sumProtocolByBank'),

        'Estatus construcción': captureCanvas('sumConstructionStatus'),
        'Fase de construcción': captureCanvas('sumConstructionPhase'),
        'Modelos en construcción': captureCanvas('sumModelsInConstruction'),
        'Permisos por institución': captureCanvas('sumPermitsByInstitution'),

        'Comparación por fase (Usos)': captureCanvas('sumPhaseChart'),
        'Comparación por fase (Fuentes)': captureCanvas('sumPhaseSourceChart'),
        'Desviación temporal - Duración por fase': captureCanvas('sumPhaseTimeDurationChart'),
        'Desviación temporal - Fecha final': captureCanvas('sumPhaseTimeDelayChart'),
        'Cobertura CPP vs préstamo': captureCanvas('sumCppCoverage'),

      };

      document.querySelectorAll('[data-summary-phase-line-chart]').forEach(canvas => {
        const title = canvas.dataset.chartTitle || `Gráfica líneas ${canvas.id || ''}`.trim();
        charts[title] = captureCanvas(canvas.id);
      });

      // Limpia nulls
Object.keys(charts).forEach(k => { if (!charts[k]) delete charts[k]; });

// Datasets del resumen global o del periodo seleccionado.
const datasets = {
  permitsByInstitution: payload.permitsByInstitution || [],
  cppByBank: payload.cppByBank || [],
  proformasByBank: payload.proformasByBank || [],
  unitsByStatus: payload.unitsByStatus || [],
  salesMonthly: payload.salesMonthly || [],
  mortgagesByBank: payload.mortgagesByBank || [],
  progressByPhase: payload.progressByPhase || [],
  alerts: payload.alerts || {},
  kpis: payload.kpis || {},
  project: payload.project || {},

  commercial: payload.commercial || {},
  legal: payload.legal || {},
  technical: payload.technical || {},
  financial: payload.financial || {},
  finance: payload.finance || {},
  periodActivity: payload.periodActivity || null,
  periodComparison: payload.periodComparison || null,
};

// 3) ✅ antes/después desde la UI (si no existe, manda [])
const beforeAfter = (Array.isArray(window.__BEFORE_AFTER__) ? window.__BEFORE_AFTER__ : [])
  .filter(item => !reportPeriod || inReportPeriod(item?.createdAt, reportPeriod));

const resp2 = await fetch(`/api/projects/${id}/summary/export`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(typeof authHeaders === 'function' ? authHeaders() : {}),
    ...(typeof tenantHeaders === 'function' ? tenantHeaders() : {}),
  },
  body: JSON.stringify({ format, charts, datasets, beforeAfter, reportPeriod })
});

      if (!resp2.ok) {
        const txt = await resp2.text().catch(() => '');
        throw new Error(`Export falló (HTTP ${resp2.status}) ${txt}`);
      }

      const ext = (format === 'pdf') ? 'pdf' : 'xlsx';
      await downloadBlob(resp2, exportReportFilename(payload, ext, reportPeriod));
      } finally {
  [pdf, exl].forEach(b => {
    if (!b) return;
    b.dataset.loading = '0';
    b.style.pointerEvents = '';
    b.style.opacity = '';
  });

  if (btn) {
    btn.textContent = originalText;
  }
}
    };

    // Bind una sola vez (Excel)
    if (exl) {
      exl.href = '#';
      if (!exl.dataset.bound) {
        exl.dataset.bound = '1';
        exl.addEventListener('click', (e) => {
          e.preventDefault();
          exportSummary('xlsx').catch(err => {
            console.error(err);
            alert(err.message || 'Error exportando Excel');
          });
        });
      }
    }

    // Bind una sola vez (PDF)
    if (pdf) {
      pdf.href = '#';
      if (!pdf.dataset.bound) {
        pdf.dataset.bound = '1';
        pdf.addEventListener('click', (e) => {
          e.preventDefault();
          exportSummary('pdf').catch(err => {
            console.error(err);
            alert(err.message || 'Error exportando PDF');
          });
        });
      }
    }

    // ===== Pintar todo el resumen =====
    await renderSummaryUI(res);

    // ===== Importar Dato Único (bind una sola vez) =====
    const importBtn = document.getElementById('importDatoUnicoBtn');
    const datoUnicoInput = document.getElementById('datoUnicoFile');
    const datoUnicoFileName = document.getElementById('datoUnicoFileName');
    if (datoUnicoInput && datoUnicoFileName && !datoUnicoInput.dataset.bound) {
      datoUnicoInput.dataset.bound = '1';
      datoUnicoInput.addEventListener('change', () => {
        datoUnicoFileName.textContent = datoUnicoInput.files?.[0]?.name || 'Ningún archivo seleccionado';
      });
    }
    if (importBtn && !importBtn.dataset.bound) {
      importBtn.dataset.bound = '1';
      importBtn.addEventListener('click', async () => {
  if (importBtn.disabled) return;

  try {
    const input = document.getElementById('datoUnicoFile');
    const f = input?.files?.[0];
    if (!f) return alert('Selecciona el Excel primero');

    // 🔒 bloquear botón
    importBtn.disabled = true;
    const originalText = importBtn.innerText;
    importBtn.innerText = 'Importando...';

    const fd = new FormData();
    fd.append('file', f);

    const resp3 = await fetch(`/api/projects/${id}/import-dato-unico`, {
      method: 'POST',
      body: fd,
      headers: {
        ...(typeof authHeaders === 'function' ? authHeaders() : {}),
        ...(typeof tenantHeaders === 'function' ? tenantHeaders() : {}),
      }
    });

    if (!resp3.ok) {
      const txt = await resp3.text().catch(() => '');
      console.error(txt);
      let message = txt || 'Error importando Dato Único';
      try { message = JSON.parse(txt)?.error || message; } catch {}
      alert(message);
      return;
    }

    const json = await resp3.json();

    alert(`Importado: ${json.ventasUpserted} ventas / ${json.unitsUpserted} unidades`);

    invalidateProjectDataCache(['unitsAll', 'ventas', 'portfolio', 'finance']);
    await loadSummary();
    await refreshTopHeaderKpis();
    if (typeof loadCommercial === 'function') {
      await loadCommercial();
    }

  } catch (err) {
    console.error(err);
    alert(err.message || 'Error importando Dato Único');

  } finally {
  importBtn.disabled = false;
  importBtn.innerText = 'Importar Dato Único';
}
});
    }

    // Wire de subida Antes/Después
    wireBAUploads();

    if (!activePeriod) await syncUnitsSoldFromPortfolio();
    __summaryDirty = false;
  } catch (e) {
    console.error('Error cargando resumen', e);
  }
}

function bindDatoUnicoImportControls() {
  const importBlock = document.querySelector('.summary-import-actions');
  const slot = document.getElementById('commercialImportDatoUnicoSlot');
  if (importBlock && slot && importBlock.parentElement !== slot) {
    importBlock.style.display = '';
    slot.appendChild(importBlock);
  }

  const importBtn = document.getElementById('importDatoUnicoBtn');
  const datoUnicoInput = document.getElementById('datoUnicoFile');
  const datoUnicoFileName = document.getElementById('datoUnicoFileName');
  if (datoUnicoInput && datoUnicoFileName && !datoUnicoInput.dataset.bound) {
    datoUnicoInput.dataset.bound = '1';
    datoUnicoInput.addEventListener('change', () => {
      datoUnicoFileName.textContent = datoUnicoInput.files?.[0]?.name || 'Ningun archivo seleccionado';
    });
  }
  if (importBtn && !importBtn.dataset.bound) {
    importBtn.dataset.bound = '1';
    importBtn.addEventListener('click', async () => {
      if (importBtn.disabled) return;

      try {
        const f = datoUnicoInput?.files?.[0];
        if (!f) return alert('Selecciona el Excel primero');

        importBtn.disabled = true;
        importBtn.innerText = 'Importando...';

        const fd = new FormData();
        fd.append('file', f);

        const resp3 = await fetch(`/api/projects/${id}/import-dato-unico`, {
          method: 'POST',
          body: fd,
          headers: {
            ...(typeof authHeaders === 'function' ? authHeaders() : {}),
            ...(typeof tenantHeaders === 'function' ? tenantHeaders() : {}),
          }
        });

        if (!resp3.ok) {
          const txt = await resp3.text().catch(() => '');
          console.error(txt);
          let message = txt || 'Error importando Dato Unico';
          try { message = JSON.parse(txt)?.error || message; } catch {}
          alert(message);
          return;
        }

        const json = await resp3.json();
        alert(`Importado: ${json.ventasUpserted} ventas / ${json.unitsUpserted} unidades`);

        invalidateProjectDataCache(['unitsAll', 'ventas', 'portfolio', 'finance']);
        await loadSummary();
        await refreshTopHeaderKpis();
        if (typeof loadCommercial === 'function') await loadCommercial();
      } catch (err) {
        console.error(err);
        alert(err.message || 'Error importando Dato Unico');
      } finally {
        importBtn.disabled = false;
        importBtn.innerText = 'Importar Dato Unico';
      }
    });
  }
}

function renderCommercialTemplate(project = state.project || {}) {
  const button = document.getElementById('downloadDatoUnicoTemplate');
  if (!button) return;
  const template = project?.commercialTemplate || {};
  button.disabled = !template.path;
  button.title = template.path
    ? `Descargar ${template.originalname || 'plantilla de Dato Unico'}`
    : 'El administrador todavia no ha publicado una plantilla para este proyecto';
}

async function loadCommercialTemplateStatus() {
  try {
    const result = await API.get(`/api/projects/${id}/commercial-template/info`);
    state.project ||= {};
    state.project.commercialTemplate = result?.commercialTemplate || null;
    state.project.commercialTemplateScope = result?.scope || null;
    renderCommercialTemplate(state.project);
  } catch (error) {
    console.warn('[commercial-template] No se pudo consultar la plantilla', error);
    renderCommercialTemplate({});
  }
}

document.getElementById('downloadDatoUnicoTemplate')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (button.disabled) return;
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = 'Descargando...';
  try {
    const template = state.project?.commercialTemplate || {};
    await openSecureFile(
      `/api/projects/${id}/commercial-template/download`,
      template.originalname || 'plantilla-dato-unico.xlsx',
      'download'
    );
  } catch (error) {
    alert(error.message || 'No se pudo descargar la plantilla.');
  } finally {
    button.textContent = originalText;
    renderCommercialTemplate(state.project || {});
  }
});

async function refreshTopHeaderKpis() {
  const payload = await API.get(`/api/projects/${id}/summary?ts=${Date.now()}`);

  const project    = payload.project || {};
  const headerKpis = payload.headerKpis || {};

  const headerKpisFixed = {
    ...headerKpis,
    unitsTotal: (project.unitsTotal ?? headerKpis.unitsTotal ?? 0),
    unitsSold:  (project.unitsSold  ?? headerKpis.unitsSold  ?? 0),
  };

  renderHeaderKpis(project, headerKpisFixed, payload.kpis || {});

  const pname = document.getElementById('pname');
  if (pname && project.name) pname.textContent = project.name;
}

function addInfoBadges(){
  const tips = {
    sumProgressByPhase: 'Promedio de avance por fase según checklists (level 1..6).',
    sumPermitsByInstitution: 'Permisos por institución: pendiente / trámite / aprobado.',
    sumCppPie: 'CPP/aprobaciones por banco: statusBanco contiene CPP/APROB o fechas CPP.',
    sumProformasBar: 'Proformas entregadas por banco (statusBanco contiene PROFORMA).',
    sumUnitsDonut: 'Unidades: disponibles, reservadas, vendidas, escrituradas, canceladas.',
    sumSalesMonthly: 'Contratos firmados por mes (fechaContratoCliente).',
    sumDisbPlanReal: 'Desembolsos plan vs. real (acumulado).',
    sumMortgagesByBank: 'Hipotecas aprobadas por banco (statusBanco contiene APROB).',
    sumSalesVsFallen: 'Compara ventas reales contra ventas caídas/canceladas por año.',
    sumSalesByModel: 'Distribución de ventas por modelo de vivienda.',
    sumClientProfile: 'Perfil del cliente comprador: independiente, asalariado o mixto.',
    sumCompanyType: 'Tipo de empresa del cliente: pública, privada o mixta.',
    sumBankStatus: 'Estado del expediente dentro del banco.',
    sumCppAmountByBank: 'Monto financiado o CPP acumulado por banco.',
    sumLegalLiberacion: 'Minutas de liberación completadas frente a pendientes.',
    sumLegalSegregacion: 'Minutas de segregación completadas frente a pendientes.',
    sumLegalPrestamo: 'Minutas de préstamo completadas frente a pendientes.',
    sumProtocolByBank: 'Firmas de protocolo agrupadas por banco.',
    sumConstructionStatus: 'Estado general de construcción de las unidades.',
    sumConstructionPhase: 'Fase constructiva actual de las unidades.',
    sumModelsInConstruction: 'Modelos de vivienda actualmente en construcción.',
    sumConstructionProgressRanges: 'Avance de construcción agrupado por rangos porcentuales.',
    sumCreditLines: 'Líneas de crédito: desembolsado frente a amortizado total.',
    sumCppCoverage: 'Cobertura de CPP vigente y en trámite frente a deuda actual.',
  };
  for (const [id, tip] of Object.entries(tips)) {
    const canvas = document.getElementById(id);
    if (!canvas) continue;
    const h3 = canvas.closest('.card')?.querySelector('h3');
    if (h3 && !h3.querySelector('.info-dot')) {
      const i = document.createElement('span');
      i.className = 'info-dot';
      i.dataset.tip = tip;
      i.textContent = 'i';
      h3.appendChild(i);
    }
  }
}

let __infoTogglesWired = false;
function wireInfoTooltips(){
  if (__infoTogglesWired) return;
  __infoTogglesWired = true;
  // Toggle por click (sirve para móvil); click fuera cierra
  document.addEventListener('click', (e)=>{
    const isDot = e.target.closest('.info-dot');
    document.querySelectorAll('#tab-resumen .info-dot[data-open="1"]')
      .forEach(el => el.setAttribute('data-open','0'));
    if (isDot) {
      isDot.setAttribute('data-open','1');
      e.stopPropagation();
    }
  });
}

  // ====== Catálogos: fases y roles ======
  const PHASES = [
    { key:'PREESTUDIOS',     name:'Pre-estudios',         color:'#1e90ff', pale:'#e6f2ff' },
    { key:'PERMISOS',        name:'Permisos',             color:'#2ecc71', pale:'#eafff2' },
    { key:'FINANCIACION',    name:'Financiación',         color:'#f39c12', pale:'#fff4e0' },
    { key:'CONTRATISTAS',    name:'Contratistas',         color:'#9b59b6', pale:'#f5e9fb' },
    { key:'OBRA',            name:'Obra',                 color:'#e74c3c', pale:'#ffe9e7' },
    { key:'ESCRITURACION',   name:'Escrituración',        color:'#16a085', pale:'#e6fffb' },
  ];
  const ROLE_COLORS = {
    'TECNICO'       : { color:'#60a5fa', pale:'#eaf2ff', label:'Técnico' },
    'LEGAL'         : { color:'#f87171', pale:'#fff0f0', label:'Legal' },
    'GERENCIA'      : { color:'#34d399', pale:'#ecfdf5', label:'Gerencia' },
    'COMERCIAL'     : { color:'#f59e0b', pale:'#fff7ed', label:'Comercial' },
    'FINANCIERO'    : { color:'#a78bfa', pale:'#f5f3ff', label:'Financiero' },
    'CONTABILIDAD'  : { color:'#22d3ee', pale:'#ecfeff', label:'Contabilidad' },
    'SOCIOS'        : { color:'#f472b6', pale:'#fdf2f8', label:'Socios' },
    'PROMOTOR_PM'   : { color:'#94a3b8', pale:'#f1f5f9', label:'Promotor' },
    'ADMIN'         : { color:'#0ea5e9', pale:'#e0f2fe', label:'Admin/Banco' },
    'BANCO'         : { color:'#0ea5e9', pale:'#e0f2fe', label:'Banco' },
  };

  // ====== Normalización ======
  const PHASE_ALIAS = new Map([
    ['PREESTUDIOS','PREESTUDIOS'], ['PRE-ESTUDIOS','PREESTUDIOS'], ['PRE ESTUDIOS','PREESTUDIOS'], ['FASE1','PREESTUDIOS'], ['FASE 1','PREESTUDIOS'],
    ['PERMISOS','PERMISOS'], ['LICENCIAS','PERMISOS'], ['FASE2','PERMISOS'], ['FASE 2','PERMISOS'],
    ['FINANCIACION','FINANCIACION'], ['FINANCIACIÓN','FINANCIACION'], ['FINANCIAMIENTO','FINANCIACION'], ['FASE3','FINANCIACION'], ['FASE 3','FINANCIACION'],
    ['CONTRATISTAS','CONTRATISTAS'], ['CONTRATOS','CONTRATISTAS'], ['FASE4','CONTRATISTAS'], ['FASE 4','CONTRATISTAS'],
    ['OBRA','OBRA'], ['CONSTRUCCION','OBRA'], ['CONSTRUCCIÓN','OBRA'], ['FASE5','OBRA'], ['FASE 5','OBRA'],
    ['ESCRITURACION','ESCRITURACION'], ['ESCRITURACIÓN','ESCRITURACION'], ['ENTREGA','ESCRITURACION'], ['FASE6','ESCRITURACION'], ['FASE 6','ESCRITURACION'],
  ]);
  const ROLE_ALIAS = new Map([
    ['TECNICO','TECNICO'], ['TÉCNICO','TECNICO'], ['ARQUITECTO','TECNICO'], ['INGENIERIA','TECNICO'],
    ['LEGAL','LEGAL'], ['JURIDICO','LEGAL'], ['JURÍDICO','LEGAL'],
    ['GERENCIA','GERENCIA'], ['DIRECCION','GERENCIA'], ['DIRECCIÓN','GERENCIA'],
    ['COMERCIAL','COMERCIAL'], ['COMMERCIAL','COMERCIAL'], ['VENTAS','COMERCIAL'], ['MARKETING','COMERCIAL'],
    ['FINANCIERO','FINANCIERO'], ['FINANCIAL','FINANCIERO'], ['FINANZAS','FINANCIERO'],
    ['CONTABILIDAD','CONTABILIDAD'], ['ACCOUNTING','CONTABILIDAD'], ['CONTABLE','CONTABILIDAD'],
    ['SOCIOS','SOCIOS'], ['ACREEDORES','SOCIOS'],
    ['PROMOTOR','PROMOTOR_PM'], ['PROMOTER','PROMOTOR_PM'], ['PROMOTOR_PM','PROMOTOR_PM'], ['PM','PROMOTOR_PM'],
    ['BANCO','BANCO'], ['ADMIN','ADMIN'], ['ADMIN/BANCO','ADMIN'], ['ADMON','ADMIN'],
  ]);

  function strip(s) {
    return (s||'').toString()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/['"`‘’“”]/g,'').replace(/\s+/g,' ').trim();
  }
  function canonPhase(s) {
    const raw = strip(s).toUpperCase().replace(/[\s\-]/g,'');
    return PHASE_ALIAS.get(raw) || PHASE_ALIAS.get(strip(s).toUpperCase()) || 'PREESTUDIOS';
  }
  function canonRole(s) {
    const raw = strip(s).toUpperCase();
    return ROLE_ALIAS.get(raw) || 'TECNICO';
  }
    // UI role (chips) -> owner del backend (minúsculas del schema)
function uiRoleToOwner(uiKey) {
  const map = {
    'TECNICO'      : 'tecnico',
    'LEGAL'        : 'legal',
    'GERENCIA'     : 'gerencia',
    'COMERCIAL'    : 'commercial',
    'FINANCIERO'   : 'financiero',
    'CONTABILIDAD' : 'contable',
    'SOCIOS'       : 'socios',
    'PROMOTOR_PM'  : 'promoter',
    'ADMIN'        : 'admin',
    'BANCO'        : 'bank'
  };
  return map[(uiKey||'').toUpperCase()] || 'tecnico';
}

  function pickOrder(c) {
    return Number(c.order ?? c.orderInLevel ?? c.level ?? c.nivel ?? c.sequence ?? c.seq ?? 0) || 0;
  }


  // ====== Estado del módulo Proyecto ======
const state = {
  project: null,
  checklists: [],
  docsByChecklist: {},
  filterRole: null,
  collapsed: new Set(),
  onlyPending: false,
  // NEW: filtro de roles permitidos en checklists (null = sin filtro)
  allowedChecklistRoles: __ALLOWED_ROLES,
  manualUnlocks: new Set()
};

  // ====== Utilidades ======
  const PIN = '2580';
  function askPinOrAbort(msg = 'Introduce PIN numérico (4 dígitos):') {
    const v = prompt(msg || '');
    if (v === null) return false;
    if (v.trim() !== PIN) { alert('PIN incorrecto'); return false; }
    return true;
  }
  function fmtDate(d) { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? '—' : x.toISOString().slice(0,10); }
  function phaseMeta(phaseKey) { return PHASES.find(p=>p.key===phaseKey) || {color:'#e5e7eb', pale:'#f3f4f6', name:phaseKey}; }
  function roleMeta(roleKey)  { return ROLE_COLORS[roleKey] || {color:'#d1d5db', pale:'#f3f4f6', label:roleKey || '—'}; }

  // Progreso por checklist (subtareas)
  function checklistProgress(cl) {
    const subs = cl?.subtasks || [];
    if (!subs.length) return (cl.status === 'COMPLETADO') ? 100 : (cl.status === 'EN_PROCESO' ? 50 : 0);
    const done = subs.filter(s=>!!s.completed).length;
    return Math.round((done / subs.length) * 100);
  }
  // Progreso por fase
  function phaseProgress(phaseKey) {
    const list = state.checklists.filter(c => c.phase === phaseKey && (!state.onlyPending || c.status!=='COMPLETADO'));
    if (!list.length) return 0;
    const total = list.reduce((acc,c)=>acc + checklistProgress(c),0);
    return Math.round(total / list.length);
  }
  // Progreso global
  function globalProgress() {
    const list = state.checklists.filter(c => (!state.onlyPending || c.status!=='COMPLETADO'));
    if (!list.length) return 0;
    const total = list.reduce((acc,c)=>acc + checklistProgress(c),0);
    return Math.round(total / list.length);
  }

// Secuencialidad: activo si está manualmente desbloqueado,
// o si todos los anteriores de la fase están validados o completados.
function isChecklistActive(cl) {
  if (!cl) return false;

  // Desbloqueo manual
  if (state.manualUnlocks && state.manualUnlocks.has(cl._id)) return true;

  const samePhase = state.checklists
    .filter(x => x.phase === cl.phase)
    .sort((a,b) => (a.order || 0) - (b.order || 0));

  const idx = samePhase.findIndex(x => x._id === cl._id);
  if (idx <= 0) return true; // primero de la fase

  // Los anteriores deben estar validados (o completados)
  return samePhase.slice(0, idx).every(x =>
    x.validated === true || x.status === 'COMPLETADO'
  );
}

  // Semáforo por rol
  // Semáforo por rol: considera SOLO checklists ACTIVOS y no completados.
// Rojo  = hay al menos 1 activo pendiente y vencido
// Amarillo = hay al menos 1 activo pendiente (no vencido)
// Verde = no hay activos pendientes para ese rol
function semaphoreForRole(roleKey) {
  const now = Date.now();

  // Solo los checklist de este rol que están ACTIVOS (secundados por validación o desbloqueo manual)
  const activeForRole = state.checklists.filter(c =>
    c.role === roleKey &&
    isChecklistActive(c) &&
    c.status !== 'COMPLETADO'
  );

  if (activeForRole.length === 0) {
    // No hay nada activo pendiente para este rol ahora mismo
    return '🟢';
  }

  const anyOverdue = activeForRole.some(c =>
    c.dueDate && new Date(c.dueDate).getTime() < now
  );

  return anyOverdue ? '🔴' : '🟡';
}


  function kpi(label, v) {
    const isMoney = /loan|desembols|budget|gasto/i.test(label);
    const value = isMoney ? formatProjectMoney(v) : formatNum(v);
    return `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div></div>`;
  }

  function renderProjectHeaderKpis(project = state.project || {}) {
    renderTopHeaderKpis(project);
  }

  function renderProjectCover(project = state.project || {}) {
    if (!projectCoverBtn) return;
    const canEditCover = myRole === 'admin';
    projectCoverBtn.style.display = canEditCover ? '' : 'none';
    if (!canEditCover) return;

    const path = String(project?.coverImage?.path || '');
    const hasCover = !!path;
    if (projectCoverPreview) {
      projectCoverPreview.src = hasCover ? path : '';
      projectCoverPreview.style.display = hasCover ? '' : 'none';
    }
    if (projectCoverFallback) projectCoverFallback.style.display = hasCover ? 'none' : '';
  }

  function setProjectCoverBusy(busy) {
    isProjectCoverSaving = busy;
    if (projectCoverBtn) projectCoverBtn.disabled = busy;
    if (projectCoverFile) projectCoverFile.disabled = busy;
  }

  async function saveProjectCover(coverImage) {
    if (isProjectCoverSaving || myRole !== 'admin') return;
    setProjectCoverBusy(true);
    try {
      await API.put(`/api/projects/${id}`, { coverImage });
      await loadProject();
      if (modalBackdrop) modalBackdrop.style.display = 'none';
    } catch (error) {
      alert(error.message || 'No se pudo actualizar la portada');
    } finally {
      setProjectCoverBusy(false);
      if (projectCoverFile) projectCoverFile.value = '';
    }
  }

  // ====== Carga de datos ======
  function normalizeProjectStatus(status) {
    const normalized = String(status || 'EN_CURSO').trim().toUpperCase();
    return normalized === 'EN_MARCHA' ? 'EN_CURSO' : normalized;
  }

  async function loadProject() {
    const p = await API.get('/api/projects/' + id);
    p.status = normalizeProjectStatus(p.status);
    state.project = p;
    window.__PROJECT_3D?.configure?.(p);
    currentProjectCurrency = normalizeProjectCurrency(p.currency);
    if (projectCurrencySel) {
      projectCurrencySel.value = currentProjectCurrency;
      updateCurrencyControlMeta();
    }
    if (pname)  pname.textContent  = p.name || 'Proyecto';
    if (pdesc)  pdesc.textContent  = p.description || '';
    if (pdesc2) pdesc2.textContent = p.description || '';
    if (statusSel) statusSel.value = p.status;
    if (projectTypeText) projectTypeText.textContent = `Tipo de proyecto: ${p.projectType || p.tipoProyecto || 'No definido'}`;
    renderProjectCover(p);
    if (!['tecnico','legal'].includes(myRole)) await loadCommercialTemplateStatus();

    renderProjectHeaderKpis(p);
      // ROLE-SEP: control de publicación y UI para commercial
  const pub = String(
    p.publishStatus || p.publicationStatus || p.pubStatus || p.statusPublicacion || p.statusPublish || ''
  ).toLowerCase();
  const isApproved = (pub === 'approved');

  if (myRole === 'commercial') {
    window.__COMMERCIAL_LOCKED = !isApproved;
    if (reviewBanner) {
      reviewBanner.style.display = window.__COMMERCIAL_LOCKED ? '' : 'none';
    }
  } else {
    window.__COMMERCIAL_LOCKED = false;
    if (reviewBanner) reviewBanner.style.display = 'none';
  }
  }

  function openProjectCoverManager() {
    const path = String(state.project?.coverImage?.path || '');
    if (!path) return projectCoverFile?.click();
    openModal('Portada', `
      <div style="display:grid;gap:16px;justify-items:center;">
        <img src="${escapeHtml(path)}" alt="Portada actual" style="width:min(520px,100%);max-height:320px;object-fit:cover;border-radius:12px;">
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
          <button id="projectCoverChange" class="btn" type="button">Cambiar portada</button>
          <button id="projectCoverDelete" class="btn btn-ghost" type="button">Eliminar portada</button>
        </div>
      </div>`, 'Cerrar', () => { if (modalBackdrop) modalBackdrop.style.display = 'none'; });
    document.getElementById('projectCoverChange')?.addEventListener('click', () => projectCoverFile?.click());
    document.getElementById('projectCoverDelete')?.addEventListener('click', async () => {
      if (isProjectCoverSaving || !confirm('¿Eliminar la imagen de portada del proyecto?')) return;
      await saveProjectCover(null);
    });
  }

  projectCoverBtn?.addEventListener('click', () => {
    if (!isProjectCoverSaving) openProjectCoverManager();
  });

  projectCoverFile?.addEventListener('change', async () => {
    const file = projectCoverFile.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      projectCoverFile.value = '';
      return alert('La portada debe ser JPG, PNG o WebP y no superar 5 MB.');
    }
    try {
      const path = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
        reader.readAsDataURL(file);
      });
      await saveProjectCover({ path, originalname: file.name, mimetype: file.type });
    } catch (error) {
      projectCoverFile.value = '';
      alert(error.message || 'No se pudo leer la imagen');
    }
  });

  async function saveProjectSettingsAuto() {
    if (myRole === 'bank') return;
    if (isProjectSettingsSaving) return;
    isProjectSettingsSaving = true;
    const previousCurrency = currentProjectCurrency;
    const nextCurrency = normalizeProjectCurrency(projectCurrencySel?.value || currentProjectCurrency);
    currentProjectCurrency = nextCurrency;
    updateCurrencyControlMeta();

    try {
      if (statusSel) statusSel.disabled = true;
      if (projectCurrencySel) projectCurrencySel.disabled = true;

      await API.put(`/api/projects/${id}`, {
        status: statusSel?.value || 'EN_CURSO',
        currency: nextCurrency
      });

      await loadProject();
      if (typeof loadSummary === 'function') await loadSummary();
      if (previousCurrency !== nextCurrency && typeof loadFinance === 'function') await loadFinance();
    } catch (e) {
      currentProjectCurrency = previousCurrency;
      if (projectCurrencySel) projectCurrencySel.value = previousCurrency;
      updateCurrencyControlMeta();
      alert(e.message || 'No se pudo guardar el proyecto');
    } finally {
      if (statusSel) statusSel.disabled = false;
      if (projectCurrencySel) projectCurrencySel.disabled = false;
      isProjectSettingsSaving = false;
    }
  }

  statusSel?.addEventListener('change', saveProjectSettingsAuto);
  projectCurrencySel?.addEventListener('change', saveProjectSettingsAuto);

  async function loadProyectoData() {
    try {
      let res = await API.get(`/api/projects/${id}/checklists?ts=${Date.now()}`);
      const listLen = Array.isArray(res) ? res.length : (res?.checklists?.length || 0);
      if (!listLen) {
        await API.post(`/api/projects/${id}/process/apply-template`, { force: true });
        res = await API.get(`/api/projects/${id}/checklists?ts=${Date.now()}`);
      }
      state.checklists = (res?.checklists || res || []).map(normalizeChecklist);
    } catch { state.checklists = []; }

    // Documentos
    try {
      const docs = await API.get(`/api/documents?projectId=${id}`);

      state.docsByChecklist = {};
      (docs || []).forEach(d => {
        if (!d.checklistId) return;
        if (!state.docsByChecklist[d.checklistId]) state.docsByChecklist[d.checklistId] = [];
        state.docsByChecklist[d.checklistId].push(d);
      });
    } catch { state.docsByChecklist = {}; }

    // Inicializa colapsado: todo cerrado salvo la primera fase con elementos
    if (state.collapsed.size === 0) {
      PHASES.forEach(p => state.collapsed.add(p.key));
      const firstWithItems = PHASES.find(p => state.checklists.some(c => c.phase===p.key));
      if (firstWithItems) state.collapsed.delete(firstWithItems.key);
    }
    // Precarga permisos para que la barra "Permisos" funcione a la primera
    try { __permits = await apiPermitsGetProject(true); } catch { __permits = null; }
  }

  function normalizeChecklist(c) {
    const phaseRaw = c.phase || c.phaseKey || c.fase || c.category || '';
    const roleRaw  = c.roleOwner || c.role || c.ownerRole || c.responsable || c.asignado || (Array.isArray(c.visibleToRoles) ? c.visibleToRoles[0] : '') || '';
    const st = (c.status || '').toUpperCase();

const rawSubs = Array.isArray(c.subtasks)
  ? c.subtasks
  : (Array.isArray(c.children) ? c.children : []);

const subs = (rawSubs || []).map(s => ({
  ...s,
  completed: !!s.completed
}));

// ✅ Status REAL derivado de subtareas (si existen)
let derivedStatus = null;
if (subs.length) {
  const done = subs.filter(s => !!s.completed).length;
  if (done === subs.length) derivedStatus = 'COMPLETADO';
  else if (done > 0) derivedStatus = 'EN_PROCESO';
  else derivedStatus = 'PENDIENTE';
}

// Si no hay subtareas, usa el status backend
const backendCompleted = (c.completed === true || st === 'COMPLETADO' || st === 'DONE');
const status = derivedStatus || (backendCompleted ? 'COMPLETADO'
  : (st === 'EN_PROCESO' || st === 'IN_PROGRESS' ? 'EN_PROCESO' : 'PENDIENTE'));

return {
  _id: c._id || c.id,
  title: c.title || c.name || 'Checklist',
  phase: canonPhase((c.phase || c.phaseKey || c.fase || c.category || '') || 'PREESTUDIOS'),
  role:  canonRole((c.roleOwner || c.role || c.ownerRole || c.responsable || c.asignado || (Array.isArray(c.visibleToRoles) ? c.visibleToRoles[0] : '') || '') || 'TECNICO'),
  status,
  order: pickOrder(c),
  dueDate: c.dueDate || c.vencimiento || null,
  validated: !!c.validated,
  notes: Array.isArray(c.notes) ? c.notes : [],
  subtasks: subs,
  documents: Array.isArray(c.documents) ? c.documents : [],
  createdAt: c.createdAt, updatedAt:c.updatedAt, completedAt:c.completedAt, validatedAt:c.validatedAt
};
  }

  // ====== Render Proyecto ======
  const phasesHost = document.getElementById('phasesHost');
  const rolesList  = document.getElementById('rolesList');
  const globalProgressText = document.getElementById('globalProgressText');
  const globalProgressBar  = document.getElementById('globalProgressBar');
  const verHistorialBtn    = document.getElementById('verHistorialBtn');
  const configProyectoBtn  = document.getElementById('configProyectoBtn');
  const limpiarFiltroRolBtn= document.getElementById('limpiarFiltroRol');
  const toggleAllPhasesBtn = document.getElementById('toggleAllPhasesBtn');
  const togglePendientesBtn= document.getElementById('togglePendientesBtn');

  if (verHistorialBtn) verHistorialBtn.onclick = openHistoryModal;
  if (configProyectoBtn) configProyectoBtn.onclick = openConfigureFlow;
  if (limpiarFiltroRolBtn) limpiarFiltroRolBtn.onclick = () => { state.filterRole = null; renderProyecto(); };
  if (togglePendientesBtn) togglePendientesBtn.onclick = () => {
    state.onlyPending = !state.onlyPending;
    if (togglePendientesBtn) {
  togglePendientesBtn.classList.toggle('is-on', state.onlyPending);
  const st = togglePendientesBtn.querySelector('.state');
  if (st) st.textContent = state.onlyPending ? 'on' : 'off';
   }

    renderProyecto();
  };
  if (toggleAllPhasesBtn) toggleAllPhasesBtn.onclick = () => {
    if (state.collapsed.size) { state.collapsed.clear(); }
    else { PHASES.forEach(p => state.collapsed.add(p.key)); }
    renderProyecto();
  };

  function renderProyecto() {
    const g = globalProgress();
    globalProgressText.textContent = `${g}% completado`;
    globalProgressBar.style.width = `${g}%`;

    // Roles panel
   const distinctRoles = Array.from(new Set(state.checklists.map(c => c.role))).sort();
   const roleKeys = distinctRoles.length ? distinctRoles : Object.keys(ROLE_COLORS);

   rolesList.innerHTML = roleKeys.map(rk => {
   const rm = roleMeta(rk);
   const sem = semaphoreForRole(rk);

   // métricas para tooltip
   const now = Date.now();
   const activePend = state.checklists.filter(c =>
    c.role === rk && isChecklistActive(c) && c.status !== 'COMPLETADO'
   );
   const cntActive  = activePend.length;
   const cntOverdue = activePend.filter(c => c.dueDate && new Date(c.dueDate).getTime() < now).length;
   const ttl = (cntActive > 0)
    ? `Activos pendientes: ${cntActive} · Vencidos: ${cntOverdue}`
    : 'Sin tareas activas pendientes';

   const cls = (state.filterRole === rk) ? 'role-row filter-on' : 'role-row';
   const readOnlyStyle = isPartialProyectoRole() ? ';cursor:default' : '';
   return `<div class="${cls}" data-role="${rk}" style="--role-color:${rm.color}${readOnlyStyle}" title="${ttl}">
    <div class="row"><span class="role-badge" style="--role-color:${rm.color};--role-pale:${rm.pale}">${rm.label}</span></div>
    <div class="light" title="${ttl}">
    <span class="sem-dot ${semClassFromEmoji(sem)}" aria-hidden="true"></span>
    </div>
   </div>`;
   }).join('');

   rolesList.querySelectorAll('.role-row').forEach(el=>{
   el.onclick = () => {
    if (isPartialProyectoRole()) return;
    state.filterRole = el.dataset.role;
    renderProyecto();
   };
   });

    // Fases
    phasesHost.innerHTML = PHASES.map(ph => renderPhase(ph)).join('');
    wireDynamicHandlers();
    syncPartialProyectoUI();

    // Texto del botón global
    if (toggleAllPhasesBtn) {
      toggleAllPhasesBtn.textContent = state.collapsed.size ? 'Expandir todo' : 'Colapsar todo';
    }
  }

  function semClassFromEmoji(sem) {
  if (sem === '🟢') return 'ok';
  if (sem === '🟡') return 'warn';
  return 'danger'; // 🔴 o cualquier cosa
  }

  function renderPhase(ph) {
  const list = state.checklists
    .filter(c => c.phase === ph.key)
    .filter(c => !state.filterRole || c.role === state.filterRole)
    .filter(c => !state.onlyPending || c.status !== 'COMPLETADO')
    .filter(c => !state.allowedChecklistRoles || state.allowedChecklistRoles.includes(c.role))
    .sort((a,b)=> (a.order??0) - (b.order??0));

  const prChecklist = phaseProgress(ph.key); // calcula por checklists
  let prUI = prChecklist;

  // Si es PERMISOS y ya tenemos los items, sustituimos por progreso real de permisos
  if (ph.key === 'PERMISOS' && __permits?.items?.length) {
    prUI = permitProgress(__permits);
  }

  const collapsedCls = state.collapsed.has(ph.key) ? 'collapsed' : '';
  const addBtn = `
    <button class="btn btn-ghost btn-xs js-add-cl" data-phase="${ph.key}">+ Checklist</button>
  `;

  return `
    <section class="phase ${collapsedCls}" style="--phase-color:${ph.color}; --phase-pale:${ph.pale}">
      <div class="phase-header">
        <div class="phase-toggle js-toggle-phase" data-phase="${ph.key}">
          <span class="chev">▾</span>
          <div class="phase-title">
            <span>${ph.name}</span>
            <span class="phase-badge">${prUI}% fase</span>   <!-- ✅ usa prUI -->
          </div>
        </div>
        <div class="phase-actions">${addBtn}</div>
      </div>
      <div class="progress"><div style="width:${prUI}%; --accent:${ph.color}"></div></div> <!-- ✅ usa prUI -->
      <div class="cl-list">
        ${list.map(cl => renderChecklistCard(cl, ph)).join('')}
      </div>
    </section>
  `;
}

  function renderChecklistCard(cl, ph) {
  const active = isChecklistActive(cl);
  const disabled = !active; // <- NUEVO
  const rm = roleMeta(cl.role);
  const prog = checklistProgress(cl);
  const delayed = (cl.status!=='COMPLETADO' && cl.dueDate && new Date(cl.dueDate).getTime() < Date.now());
  const docs = state.docsByChecklist[cl._id] || [];
  const statusText = delayed ? 'RETRASADO' : (cl.status || 'PENDIENTE');
  const normalizedTitle = String(cl.title || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const isPriorityFinancialDoc = /(dictamen|informe|estudio)/.test(normalizedTitle) && /(jurid|urban|tecnic|comercial|financier)/.test(normalizedTitle);

  return `
    <div class="cl-card ${disabled ? 'locked' : ''} ${isPriorityFinancialDoc ? 'is-priority-financial-doc' : ''}" data-id="${cl._id}" data-phase="${cl.phase}" style="--role-color:${rm.color}; --role-pale:${rm.pale}; ${disabled ? 'opacity:0.6;' : ''}">
      <div class="cl-head">
        <div class="cl-title">${cl.title}${isPriorityFinancialDoc ? '<span class="priority-financial-doc-badge">Prioritario para evaluación financiera</span>' : ''}</div>
        <div class="row">
          <span class="role-badge">${rm.label}</span>
          <span class="status-badge">${statusText}</span>
        </div>
      </div>

      <div class="cl-meta">
        <span class="tag">Fase: ${phaseMeta(cl.phase).name}</span>
        <span class="tag">Orden: ${cl.order ?? 0}</span>
        <span class="tag">Vence: ${fmtDate(cl.dueDate)}</span>
        <span class="tag">Validación: ${cl.validated ? '✔︎' : '—'}</span>
      </div>

      <div>
        <div class="progress progress-sm"><div style="width:${prog}%"></div></div>
        <div class="small muted">${prog}% subtareas</div>
      </div>

      <div class="subtasks">
        ${(cl.subtasks||[]).map(s => `
          <div class="subtask">
            <input type="checkbox" class="js-subtoggle subtask-check"
  data-id="${cl._id}"
  data-sid="${s._id||s.id||s.title}"
  ${s.completed ? 'checked':''}
  ${disabled ? 'disabled' : ''}
/>
            <span class="subtask-title">${s.title || s.name}</span>
            <button class="btn btn-danger btn-xs js-del-sub"
              data-id="${cl._id}"
              data-sid="${s._id||s.id||s.title}"
              ${disabled ? 'disabled' : ''}>X</button>
          </div>
        `).join('')}
        <div class="row">
          <input type="text" class="w-100" placeholder="Nueva subtarea…" data-newsub="${cl._id}" ${disabled ? 'disabled' : ''}/>
          <button class="btn btn-ghost btn-xs js-add-sub" data-id="${cl._id}" ${disabled ? 'disabled' : ''}>Añadir</button>
        </div>
      </div>

      <div class="cl-actions">
        <button class="btn btn-ghost btn-xs js-open-docs" data-cl="${cl._id}" ${disabled ? 'disabled' : ''}>
        📎 Docs (${(state.docsByChecklist[cl._id]||[]).length})
        </button>
        <button class="btn btn-success btn-xs js-complete" data-id="${cl._id}" ${disabled ? 'disabled' : ''}>
        ${cl.status === 'COMPLETADO' ? 'Descompletar' : 'Completar'}
        </button>
        <button class="btn btn-warning btn-xs js-validate" data-id="${cl._id}" ${disabled ? 'disabled' : ''}>Validar</button>
        <button class="btn btn-ghost btn-xs js-notes" data-id="${cl._id}">Notas</button>
        <button class="btn btn-ghost btn-xs js-edit" data-id="${cl._id}" ${disabled ? 'disabled' : ''}>Editar</button>
        <button class="btn btn-danger btn-xs js-del-cl" data-id="${cl._id}" ${disabled ? 'disabled' : ''}>Eliminar</button>
      </div>

      ${active ? '' : `
        <div class="lock">
          <span>🔒 Checklist bloqueado: valida los anteriores para continuar</span>
        </div>
      `}
    </div>
  `;
}


  function wireDynamicHandlers() {
  // Helper: ¿está activo este checklist según la secuencia?
  function isActiveById(clId) {
    const cl = state.checklists.find(c => c._id === clId);
    if (!cl) return false;
    return isChecklistActive(cl);
  }

  // Toggle de fase (accordion)
  document.querySelectorAll('.js-toggle-phase').forEach(btn => btn.onclick = (e) => {
    const key = btn.dataset.phase;
    if (state.collapsed.has(key)) state.collapsed.delete(key);
    else state.collapsed.add(key);
    renderProyecto();
  });

  // ===== NUEVO: click en tarjeta bloqueada → confirmar desbloqueo manual =====
  document.querySelectorAll('.cl-card.locked').forEach(card => {
    card.onclick = (ev) => {
      // Ignorar si se ha hecho click en controles interactivos de la tarjeta
      if (ev.target.closest('a,button,input,label,.js-toggle-phase,.js-add-cl')) return;

      const clId = card.dataset.id;
      // Si por alguna razón ya está activo, no hacemos nada
      if (isActiveById(clId)) return;

      const ok = confirm('Este checklist aún no está desbloqueado por secuencia.\n\n¿Quieres trabajar en este checklist igualmente?');
      if (!ok) return;

      // Marcar desbloqueo manual y re-renderizar
      state.manualUnlocks.add(clId);
      renderProyecto();
    };
  });

  // Añadir checklist
  document.querySelectorAll('.js-add-cl').forEach(btn => {
    btn.onclick = () => openCreateChecklist(btn.dataset.phase);
  });


  // Completar / Descompletar checklist (toggle)
  document.querySelectorAll('.js-complete').forEach(btn => {
   btn.onclick = async () => {
    const idCL = btn.dataset.id;

    if (!isActiveById(idCL)) {
      alert('Este checklist está bloqueado hasta validar los anteriores de la fase (o desbloquéalo manualmente tocando la tarjeta).');
      return;
    }

    const cl = state.checklists.find(c => c._id === idCL);
    const isDone = (cl?.status === 'COMPLETADO');

    if (isDone) {
      // ✅ DESCOMPLETAR
      try {
        // si algún día creas endpoint /uncomplete lo usas aquí
        await API.put(`/api/checklists/${idCL}`, { status: 'PENDIENTE' });
      } catch {
        await API.put(`/api/checklists/${idCL}`, { completed: false, status: 'PENDIENTE' });
      }
    } else {
      // ✅ COMPLETAR
      try {
        await API.post(`/api/checklists/${idCL}/complete`, { force: false });
      } catch {
        await API.put(`/api/checklists/${idCL}`, { status: 'COMPLETADO' });
      }
    }

    await reloadProyecto();
   };
  });


  // Validar checklist (solo si ACTIVO y rol permitido)
  document.querySelectorAll('.js-validate').forEach(btn => {
    btn.onclick = async () => {
      const idCL = btn.dataset.id;
      if (!isActiveById(idCL)) {
        alert('Este checklist está bloqueado hasta validar los anteriores de la fase (o desbloquéalo manualmente tocando la tarjeta).');
        return;
      }
      const canValidate = (myRole === 'admin' || myRole === 'gerencia');
      if (!canValidate) return alert('Solo Banco/Admin/Gerencia pueden validar.');
      await API.post(`/api/checklists/${idCL}/validate`, { validated: true })
        .catch(() => API.put(`/api/checklists/${idCL}`, { validated: true }));
      await reloadProyecto(); // desbloqueará el siguiente por la lógica nueva
    };
  });

  // Editar checklist (solo si ACTIVO)
  document.querySelectorAll('.js-edit').forEach(btn => {
    btn.onclick = () => {
      const idCL = btn.dataset.id;
      if (!isActiveById(idCL)) {
        alert('Checklist bloqueado: valida los anteriores o desbloquéalo manualmente tocando la tarjeta.');
        return;
      }
      openEditChecklist(idCL);
    };
  });

  // Eliminar checklist (solo si ACTIVO + PIN)
  document.querySelectorAll('.js-del-cl').forEach(btn => {
    btn.onclick = async () => {
      const idCL = btn.dataset.id;
      if (!isActiveById(idCL)) {
        alert('Checklist bloqueado: valida los anteriores o desbloquéalo manualmente tocando la tarjeta.');
        return;
      }
      if (!askPinOrAbort('Para eliminar este checklist, introduce el PIN:')) return;
      await API.del(`/api/checklists/${idCL}`).catch(() => API.post(`/api/checklists/${idCL}/delete`, {}));
      await reloadProyecto();
    };
  });

  // Notas (permitido aunque esté bloqueado)
  document.querySelectorAll('.js-notes').forEach(btn => {
    btn.onclick = () => openNotes(btn.dataset.id);
  });

  // Subtareas: toggle (solo si ACTIVO)
  document.querySelectorAll('.js-subtoggle').forEach(chk => {
    chk.onchange = async () => {
      const clId = chk.dataset.id, sid = chk.dataset.sid;
      if (!isActiveById(clId)) {
        chk.checked = !chk.checked; // revertir visualmente
        alert('Checklist bloqueado: valida los anteriores o desbloquéalo manualmente tocando la tarjeta.');
        return;
      }
      await API.put(`/api/checklists/${clId}/subtasks/${sid}`, { completed: chk.checked });
      await reloadProyecto(false);
    };
  });

  // Subtareas: añadir (solo si ACTIVO)
  document.querySelectorAll('.js-add-sub').forEach(btn => {
    btn.onclick = async () => {
      const clId = btn.dataset.id;
      if (!isActiveById(clId)) {
        alert('Checklist bloqueado: valida los anteriores o desbloquéalo manualmente tocando la tarjeta.');
        return;
      }
      const inp = document.querySelector(`input[data-newsub="${clId}"]`);
      const title = (inp?.value || '').trim();
      if (!title) return;
      await API.post(`/api/checklists/${clId}/subtasks`, { title });
      await reloadProyecto(false);
    };
  });

  // Subtareas: eliminar (solo si ACTIVO)
  document.querySelectorAll('.js-del-sub').forEach(btn => {
    btn.onclick = async () => {
      const clId = btn.dataset.id, sid = btn.dataset.sid;
      if (!isActiveById(clId)) {
        alert('Checklist bloqueado: valida los anteriores o desbloquéalo manualmente tocando la tarjeta.');
        return;
      }
      if (!confirm('¿Eliminar esta subtarea?')) return;
      await API.del(`/api/checklists/${clId}/subtasks/${sid}`);
      await reloadProyecto(false);
    };
  });

    // Botón de documentos por checklist (abre modal)
  document.querySelectorAll('.js-open-docs').forEach(btn => {
    btn.onclick = () => {
      const clId = btn.dataset.cl;
      openChecklistDocs(clId);
    };
  });

}

  async function reloadProyecto() {
    await loadProyectoData();
    renderProyecto();
  }

  // ====== Modales ======
  function openCreateChecklist(phaseKey) {
    const rolesOptions = Object.entries(ROLE_COLORS).map(([k,v]) => `<option value="${k}">${v.label}</option>`).join('');
    const phaseOptions = PHASES.map(p => `<option value="${p.key}" ${p.key===phaseKey?'selected':''}>${p.name}</option>`).join('');
    openModal('Nuevo checklist', `
      <div class="row w-100"><input id="clTitle" class="w-100" placeholder="Título del checklist"></div>
      <div class="row w-100">
        <label>Fase</label><select id="clPhase">${phaseOptions}</select>
        <label>Rol</label><select id="clRole">${rolesOptions}</select>
        <label>Orden</label><input id="clOrder" type="number" min="0" step="1" value="0" style="width:100px">
        <label>Vence</label><input id="clDue" type="date">
      </div>
    `, 'Crear', async () => {
      const payload = {
  projectId: id,
  title: document.getElementById('clTitle').value.trim() || 'Checklist',
  // Tu UI usa fases como claves: en el backend ya esperas `phase` en ese formato
  phase: document.getElementById('clPhase').value,
  // CAMBIO: roleOwner en vez de role
  roleOwner: uiRoleToOwner(document.getElementById('clRole').value),
  // CAMBIO: orderInLevel en vez de order
  orderInLevel: Number(document.getElementById('clOrder').value) || 0,
  // (opcional) Si quieres persistir el nivel desde la UI, añade level=1..n (no obligatorio)
  // level: PHASES.findIndex(p => p.key === document.getElementById('clPhase').value) + 1,
  dueDate: document.getElementById('clDue').value || null
};
await API.post('/api/checklists', payload);

      await API.post('/api/checklists', payload);
      modalBackdrop.style.display = 'none';
      await reloadProyecto();
    });
  }

  function openEditChecklist(clId) {
    const cl = state.checklists.find(x=>x._id===clId);
    if (!cl) return;
    const rolesOptions = Object.entries(ROLE_COLORS).map(([k,v]) => `<option value="${k}" ${k===cl.role?'selected':''}>${v.label}</option>`).join('');
    const phaseOptions = PHASES.map(p => `<option value="${p.key}" ${p.key===cl.phase?'selected':''}>${p.name}</option>`).join('');
    openModal('Editar checklist', `
      <div class="row w-100"><input id="eTitle" class="w-100" value="${cl.title}"></div>
      <div class="row w-100">
        <label>Fase</label><select id="ePhase">${phaseOptions}</select>
        <label>Rol</label><select id="eRole">${rolesOptions}</select>
        <label>Orden</label><input id="eOrder" type="number" min="0" step="1" value="${cl.order||0}" style="width:100px">
        <label>Vence</label><input id="eDue" type="date" value="${cl.dueDate ? fmtDate(cl.dueDate) : ''}">
      </div>
    `, 'Guardar', async () => {
      const payload = {
  title: document.getElementById('eTitle').value.trim() || cl.title,
  phase: document.getElementById('ePhase').value,
  // CAMBIO: roleOwner en vez de role
  roleOwner: uiRoleToOwner(document.getElementById('eRole').value),
  // CAMBIO: orderInLevel en vez de order
  orderInLevel: Number(document.getElementById('eOrder').value) || 0,
  dueDate: document.getElementById('eDue').value || null
};
await API.put(`/api/checklists/${clId}`, payload);

      await API.put(`/api/checklists/${clId}`, payload);
      modalBackdrop.style.display = 'none';
      await reloadProyecto();
    });
  }

  function openNotes(clId) {
    const cl = state.checklists.find(x=>x._id===clId);
    const existing = (cl?.notes || []).slice().reverse().map(n => `
      <div style="border:1px solid #eef2f7; border-radius:8px; padding:8px;">
        <div class="small muted">${fmtDate(n.date||n.createdAt)} — ${n.author||'—'}</div>
        <div>${(n.text||'').replace(/\n/g,'<br>')}</div>
      </div>
    `).join('') || '<div class="small muted">Sin notas</div>';

    openModal('Notas / observaciones', `
      <textarea id="noteText" rows="4" class="w-100" placeholder="Añadir nota interna..."></textarea>
      <div class="small muted">Historial</div>
      <div>${existing}</div>
    `, 'Guardar nota', async () => {
      const text = (document.getElementById('noteText').value || '').trim();
      if (!text) { modalBackdrop.style.display='none'; return; }
      await API.post(`/api/checklists/${clId}/notes`, { text });
      modalBackdrop.style.display='none';
      await reloadProyecto(false);
    });
  }

  async function openHistoryModal() {
    let html = '';
    try {
      const logs = await API.get(`/api/audit?projectId=${id}`);
      html = (logs||[]).slice(0,300).map(l => `
        <div style="border:1px solid #eef2f7; border-radius:8px; padding:8px;">
          <div class="small muted">${new Date(l.date||l.createdAt).toLocaleString()} — ${l.user||'—'}</div>
          <div><b>${l.action||l.type}</b> — ${l.entity||''} ${l.entityId||''}</div>
          <div class="small">${l.details ? JSON.stringify(l.details) : ''}</div>
        </div>
      `).join('') || '<div class="small muted">Sin actividad registrada</div>';
    } catch {
      html = '<div class="small muted">Historial no disponible</div>';
    }
    openModal('Historial de cambios', html, 'Cerrar', ()=> { modalBackdrop.style.display='none'; });
  }

  function openConfigureFlow() {
    const byPhase = PHASES.map(ph => {
      const items = state.checklists.filter(c=>c.phase===ph.key).sort((a,b)=>(a.order??0)-(b.order??0));
      return `
        <div class="phase" style="--phase-color:${ph.color}; --phase-pale:${ph.pale}; margin-bottom:8px;">
          <div class="phase-header"><div class="phase-title">${ph.name}</div></div>
          <ol style="margin-left:16px;">
            ${items.map(i=>`<li>${i.title} — <span class="small muted">Orden ${i.order??0}</span></li>`).join('') || '<div class="small muted">Sin checklists</div>'}
          </ol>
        </div>
      `;
    }).join('');
    openModal('Configuración del flujo', byPhase, 'Cerrar', ()=> { modalBackdrop.style.display='none'; });
  }

  // ==========================
// ====== FINANZAS v2 =======
// Plan por fases + Real por fases + Desembolso por fase
// ==========================
let FINANCE = null;
let FINANCE_KPIS = null;
let FINANCE_CONTROL = null;
let FINANCE_PROJECT = null;
let FINANCE_COMMERCIAL_UNITS = [];
let FINANCE_LOAN_LINES_SAVE_IN_PROGRESS = false;
let FINANCE_LOAN_LINES_RENDER_TIMER = null;
let FINANCE_LOAN_LINES_AUTOSAVE_TIMER = null;
let FINANCE_LOAN_LINES_DIRTY = false;
let FINANCE_LOAN_LINES_SAVE_QUEUE = Promise.resolve();
let FINANCE_UNIT_AUTOSAVE_TIMER = null;
let FINANCE_UNIT_DIRTY = false;
let FINANCE_UNIT_SAVE_QUEUE = Promise.resolve();
let FINANCE_CONTROL_SAVE_QUEUE = Promise.resolve();
let FINANCE_LOAN_LINE_EXPANDED = new Set();
let FINANCE_LOAN_LINE_COLLAPSED = new Set();
let FINANCE_ALL_LOAN_LINES = [];
let FINANCE_SELECTED_PHASE_ID = '';
let FINANCE_SELECTED_PHASE_NAME = '';
let FINANCE_AVALUATION_CONTEXT = { hasAssignedAvaluator: false, reports: [] };
let FINANCE_PHASE_MODAL_TAB = 'overview';
let FINANCE_MODAL_HOME = null;
let FINANCE_MODAL_NEXT = null;
let FINANCE_PHASE_AUTOSAVE_FLUSH = null;

const fmt = (n) => formatPanamaNumber(n);
const sumItems = (arr = []) => (arr || []).reduce((a, it) => a + parsePanamaNumber(it?.amount || 0), 0);
const isMongoIdLike = (v) => /^[a-f\d]{24}$/i.test(String(v || ''));

function numOr0(v) {
  const n = parsePanamaNumber(v);
  return Number.isFinite(n) ? n : 0;
}

function fillFinanceKpiInputsFromProject(project) {
  const a = document.getElementById('finLoanApproved');
  const d = document.getElementById('finLoanDisbursed');
  const b = document.getElementById('finBudgetApproved');
  const promoter = document.getElementById('finPromoterContribution');
  if (!a || !d || !b) return;

  const conditions = project?.financialConditions || {};
  a.value = formatPanamaNumber(conditions.bankFinancedAmount || project?.loanApproved);
  d.value = formatPanamaNumber(project?.loanDisbursed);
  b.value = formatPanamaNumber(conditions.projectTotal || project?.budgetApproved);
  a.readOnly = false;
  b.readOnly = false;
  a.title = '';
  b.title = '';
  if (promoter) promoter.value = formatPanamaNumber(
    conditions.promoterContribution || Math.max(0, numOr0(conditions.projectTotal || project?.budgetApproved) - numOr0(conditions.bankFinancedAmount || project?.loanApproved))
  );
}

function financeLinesForPhase(phaseId) {
  const target = String(phaseId || '');
  const firstPhaseId = String(FINANCE?.phases?.[0]?._id || '');
  return FINANCE_ALL_LOAN_LINES.filter(line => {
    const assigned = String(line.phaseId || '');
    if (assigned) return assigned === target;
    // Compatibilidad: las líneas históricas sin fase quedan en la primera fase
    // hasta que se guarden y reciban su asociación explícita.
    return target && target === firstPhaseId;
  });
}

function financeSeedLoanLinesFromApprovedPhaseLines(phase = {}) {
  const phaseId = String(phase?._id || FINANCE_SELECTED_PHASE_ID || '');
  const phaseName = phase?.name || FINANCE_SELECTED_PHASE_NAME || '';
  const approvedLines = Array.isArray(phase?.financingLines) ? phase.financingLines : [];
  return approvedLines
    .filter(line => String(line?.name || '').trim() || numOr0(line?.approvedAmount))
    .map((line, idx) => {
      const details = [
        numOr0(line.approvedAmount) ? `Aprobado: ${financeMoney(line.approvedAmount)}` : '',
        line.interestRate ? `Tasa: ${line.interestRate}` : '',
        line.term ? `Plazo: ${line.term}` : '',
        line.paymentMethod ? `Pago: ${line.paymentMethod}` : '',
        line.disbursementMethod ? `Desembolso: ${line.disbursementMethod}` : '',
        line.commission ? `Comision: ${line.commission}` : '',
        line.observations || ''
      ].filter(Boolean).join(' | ');
      return {
        _id: `approved-${phaseId || phaseName || 'phase'}-${idx}`,
        phaseId,
        phaseName,
        name: line.name || `Linea ${idx + 1}`,
        approvedAmount: numOr0(line.approvedAmount),
        notes: details,
        entries: [{
          _id: `approved-entry-${phaseId || phaseName || 'phase'}-${idx}`,
          disbursementDate: '',
          loanNumber: '',
          disbursementAmount: 0,
          maturityDate: '',
          amortizedAmount: 0,
          interestAmount: 0,
          notes: ''
        }]
      };
    });
}

function financeLoanLineHasMeaningfulData(line = {}, idx = 0) {
  const defaultName = new RegExp(`^linea\\s*${idx + 1}$`, 'i');
  const name = String(line.name || '').trim();
  const hasCustomName = name && !defaultName.test(name);
  const hasEntries = (Array.isArray(line.entries) ? line.entries : []).some(entry =>
    entry?.disbursementDate ||
    entry?.loanNumber ||
    numOr0(entry?.disbursementAmount) ||
    entry?.maturityDate ||
    numOr0(entry?.amortizedAmount) ||
    numOr0(entry?.interestAmount) ||
    String(entry?.notes || '').trim()
  );
  return hasCustomName || String(line.notes || '').trim() || numOr0(line.approvedAmount) || hasEntries || numOr0(line.disbursementAmount) || numOr0(line.amortizedAmount);
}

function financeLoanEntryHasData(entry = {}) {
  return !!(
    entry?.disbursementDate || entry?.movementDate || entry?.loanNumber ||
    numOr0(entry?.disbursementAmount) || entry?.maturityDate ||
    numOr0(entry?.amortizedAmount) || numOr0(entry?.interestAmount) ||
    String(entry?.notes || '').trim()
  );
}

function financeLoanLinesWithApprovedSeeds(savedLines = [], phase = {}) {
  const seeds = financeSeedLoanLinesFromApprovedPhaseLines(phase);
  if (!seeds.length) return savedLines;
  if (!savedLines.length) return seeds;
  if (!savedLines.some((line, idx) => financeLoanLineHasMeaningfulData(line, idx))) return seeds;
  const savedNames = new Set(savedLines.map(line => String(line.name || '').trim().toLowerCase()).filter(Boolean));
  const missingSeeds = seeds.filter(line => !savedNames.has(String(line.name || '').trim().toLowerCase()));
  return [...savedLines, ...missingSeeds];
}

function financeLoanLinesWithUseSeeds(savedLines = [], phase = {}) {
  const baseLines = financeLoanLinesWithApprovedSeeds(savedLines, phase).map(line => ({ ...line, entries: Array.isArray(line.entries) ? line.entries : [] }));
  const uses = (phase?.uses || []).filter(use => String(use?.name || '').trim() || numOr0(use?.amount));
  if (!uses.length) return baseLines;
  const normalizeName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(de|del|la|el|los|las)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  const legacyPlanUseIds = new Set((phase?.planUses || []).map(use => String(use?._id || '')).filter(Boolean));
  const claimed = new Set();
  uses.forEach((use, index) => {
    const useId = String(use?._id || '');
    let lineIndex = baseLines.findIndex(line => useId && String(line?.sourceUseId || '') === useId);
    if (lineIndex < 0) {
      lineIndex = baseLines.findIndex((line, idx) => (
        !claimed.has(idx) &&
        normalizeName(line?.name) === normalizeName(use?.name) &&
        (!line?.sourceUseId ||
          (line?.approvedAmountMode === 'auto' && legacyPlanUseIds.has(String(line?.sourceUseId || ''))))
      ));
    }
    if (lineIndex < 0) {
      baseLines.push({
        _id: `auto-use-${useId || index}-${Date.now()}`,
        phaseId: String(phase?._id || FINANCE_SELECTED_PHASE_ID || ''),
        phaseName: phase?.name || FINANCE_SELECTED_PHASE_NAME || '',
        sourceUseId: useId,
        approvedAmountMode: 'auto',
        name: use?.name || `Línea ${baseLines.length + 1}`,
        approvedAmount: 0,
        notes: '',
        entries: []
      });
      lineIndex = baseLines.length - 1;
    }
    if (lineIndex < 0) return;
    if (!baseLines[lineIndex].sourceUseId || legacyPlanUseIds.has(String(baseLines[lineIndex].sourceUseId || ''))) {
      const shouldBecomeAutomatic = baseLines[lineIndex].approvedAmountMode === 'auto' ||
        (!numOr0(baseLines[lineIndex].approvedAmount) && !(baseLines[lineIndex].entries || []).some(financeLoanEntryHasData));
      baseLines[lineIndex] = {
        ...baseLines[lineIndex],
        sourceUseId: useId,
        approvedAmountMode: shouldBecomeAutomatic ? 'auto' : baseLines[lineIndex].approvedAmountMode
      };
    }
    claimed.add(lineIndex);
    if (baseLines[lineIndex].approvedAmountMode === 'auto') baseLines[lineIndex].name = use?.name || baseLines[lineIndex].name;
  });

  const autoLines = baseLines.filter(line => line.approvedAmountMode === 'auto' && line.sourceUseId);
  const manualApproved = baseLines.filter(line => !autoLines.includes(line)).reduce((sum, line) => sum + numOr0(line.approvedAmount), 0);
  const available = Math.max(0, financePhaseApprovedBank(phase) - manualApproved);
  const useById = new Map(uses.map(use => [String(use?._id || ''), use]));
  const plannedBankForUse = use => {
    if (!Array.isArray(use?.fundingSources)) return null;
    return use.fundingSources.reduce((sum, source) => (
      financeSourceKind(source?.name) === 'bank' ? sum + numOr0(source?.amount) : sum
    ), 0);
  };
  const hasFundingByUse = autoLines.some(line => plannedBankForUse(useById.get(String(line.sourceUseId))) !== null);
  const allocationBasis = autoLines.map(line => {
    const use = useById.get(String(line.sourceUseId));
    const plannedBank = plannedBankForUse(use);
    return hasFundingByUse ? Math.max(0, plannedBank || 0) : Math.max(0, numOr0(use?.amount));
  });
  const allocationBasisTotal = allocationBasis.reduce((sum, amount) => sum + amount, 0);
  const floors = autoLines.map(line => (line.entries || []).reduce((sum, entry) => (
    sum + (entry.entryType === 'disbursement' && entry.paymentStatus === 'pending' ? 0 : numOr0(entry.disbursementAmount))
  ), 0));
  const floorTotal = floors.reduce((sum, amount) => sum + amount, 0);
  let remaining = Math.max(0, available - floorTotal);
  const desired = autoLines.map((line, index) => allocationBasisTotal > 0 ? available * allocationBasis[index] / allocationBasisTotal : available / autoLines.length);
  const gaps = desired.map((amount, index) => Math.max(0, amount - floors[index]));
  const gapTotal = gaps.reduce((sum, amount) => sum + amount, 0);
  const allocations = floors.slice();
  if (remaining > 0 && gapTotal > 0) {
    const used = Math.min(remaining, gapTotal);
    gaps.forEach((gap, index) => { allocations[index] += used * gap / gapTotal; });
    remaining -= used;
  }
  if (remaining > 0) autoLines.forEach((line, index) => {
    const weight = allocationBasisTotal > 0 ? allocationBasis[index] / allocationBasisTotal : 1 / autoLines.length;
    allocations[index] += remaining * weight;
  });
  autoLines.forEach((line, index) => { line.approvedAmount = Math.round(allocations[index] * 100) / 100; });
  return baseLines;
}

function financeProjectBasis() {
  const project = FINANCE_PROJECT || state.project || {};
  const conditions = project.financialConditions || {};
  const phases = Array.isArray(FINANCE?.phases) ? FINANCE.phases : [];
  const phaseProjectTotal = phases.reduce((sum, ph) => sum + numOr0(ph?.financialConditions?.phaseTotal), 0);
  const phaseBankApproved = phases.reduce((sum, ph) => sum + numOr0(ph?.financialConditions?.bankFinancedAmount), 0);
  const phasePromoterApproved = phases.reduce((sum, ph) => sum + numOr0(ph?.financialConditions?.promoterContribution), 0);
  const projectTotal = numOr0(conditions.projectTotal || project.budgetApproved || FINANCE_CONTROL?.totals?.budgetApproved) || phaseProjectTotal;
  const explicitBankApproved = numOr0(conditions.bankFinancedAmount || project.loanApproved || FINANCE_CONTROL?.totals?.loanApproved) || phaseBankApproved;
  const bankPct = numOr0(conditions.bankFinancedPct) || (projectTotal > 0 ? explicitBankApproved / projectTotal * 100 : 0);
  const bankApproved = explicitBankApproved || (projectTotal * bankPct / 100);
  const promoterApproved = numOr0(conditions.promoterContribution) || phasePromoterApproved || Math.max(0, projectTotal - bankApproved);
  const promoterPct = numOr0(conditions.promoterContributionPct) || (projectTotal > 0 ? promoterApproved / projectTotal * 100 : Math.max(0, 100 - bankPct));
  return { projectTotal, bankApproved, promoterApproved, bankPct, promoterPct };
}

function financePhaseFunding(ph = {}) {
  const basis = financeProjectBasis();
  const phaseConditions = ph.financialConditions || {};
  const planBudget = numOr0(phaseConditions.phaseTotal) || sumItems(ph.planUses);
  const phaseBankPct = numOr0(phaseConditions.bankFinancedPct) || basis.bankPct;
  const recommendedBank = numOr0(phaseConditions.bankFinancedAmount) || (planBudget * phaseBankPct / 100);
  const recommendedPromoter = numOr0(phaseConditions.promoterContribution) || Math.max(0, planBudget - recommendedBank);
  const phasePromoterPct = numOr0(phaseConditions.promoterContributionPct) || (planBudget > 0 ? recommendedPromoter / planBudget * 100 : Math.max(0, 100 - phaseBankPct));
  const lines = financeLinesForPhase(ph._id);
  const actual = lines.reduce((acc, line) => {
    const entries = Array.isArray(line.entries) && line.entries.length ? line.entries : [line];
    const disbursed = entries.reduce((sum, entry) => (
      sum + (entry.entryType === 'disbursement' && entry.paymentStatus === 'pending'
        ? 0
        : numOr0(entry.disbursementAmount))
    ), 0);
    const manual = entries.reduce((sum, entry) => sum + numOr0(entry.amortizedAmount), 0);
    const amortized = manual + numOr0(line.allocatedAmortized);
    acc.disbursed += disbursed;
    acc.amortized += amortized;
    acc.debt += Math.max(0, disbursed - amortized);
    return acc;
  }, { disbursed: 0, amortized: 0, debt: 0 });
  return {
    ...basis,
    projectTotal: planBudget,
    bankApproved: recommendedBank,
    promoterApproved: recommendedPromoter,
    bankPct: phaseBankPct,
    promoterPct: phasePromoterPct,
    planBudget,
    recommendedBank,
    recommendedPromoter,
    linesCount: lines.length,
    ...actual,
    pendingRecommendedDisbursement: Math.max(0, recommendedBank - actual.disbursed),
  };
}

function financeSourceKind(name = '') {
  const value = String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  if (/banco|financiacion bancaria|prestamo/.test(value)) return 'bank';
  if (/promotor|aporte propio|capital propio|fondos? propios?/.test(value)) return 'promoter';
  if (/preventa|venta anticipada/.test(value)) return 'presales';
  return 'other';
}

function financeSourceBuckets(items = []) {
  const result = { bank: 0, promoter: 0, presales: 0, hasBank: false, hasPromoter: false, hasPresales: false, other: [] };
  (items || []).forEach(item => {
    const kind = financeSourceKind(item?.name);
    if (kind === 'other') result.other.push({ name: item?.name || 'Otra fuente', amount: numOr0(item?.amount) });
    else {
      result[kind] += numOr0(item?.amount);
      if (kind === 'bank') result.hasBank = true;
      if (kind === 'promoter') result.hasPromoter = true;
      if (kind === 'presales') result.hasPresales = true;
    }
  });
  return result;
}

function financePhaseApprovedBank(ph = {}) {
  const plannedSources = financeSourceBuckets(ph.planSources || []);
  if (plannedSources.hasBank) return plannedSources.bank;
  const conditions = numOr0(ph?.financialConditions?.bankFinancedAmount);
  const lines = (ph.financingLines || []).reduce((sum, line) => sum + numOr0(line?.approvedAmount), 0);
  return conditions || lines || financePhaseFunding(ph).recommendedBank;
}

function renderFinanceCoherence(phases = FINANCE?.phases || []) {
  const box = document.getElementById('financeCoherenceSummary');
  const alertsBox = document.getElementById('financeCoherenceAlerts');
  if (!box || !alertsBox) return;
  const basis = financeProjectBasis();
  const planAllocated = phases.reduce((sum, ph) => sum + sumItems(ph.planUses), 0);
  const bankRecommended = phases.reduce((sum, ph) => sum + financePhaseFunding(ph).recommendedBank, 0);
  const promoterRecommended = phases.reduce((sum, ph) => sum + financePhaseFunding(ph).recommendedPromoter, 0);
  const totalDisbursed = numOr0(FINANCE_CONTROL?.totals?.totalBankDisbursed ?? FINANCE_CONTROL?.totals?.totalDisbursed);
  const totalAmortized = numOr0(FINANCE_CONTROL?.totals?.totalAmortized);
  const debt = Math.max(0, totalDisbursed - totalAmortized);
  const rows = [
    ['Proyecto', basis.projectTotal, planAllocated, basis.projectTotal - planAllocated, 'Presupuesto aprobado', 'Distribuido en fases', 'Por distribuir'],
    ['Banco', basis.bankApproved, bankRecommended, basis.bankApproved - bankRecommended, 'Financiación aprobada', 'Recomendada en fases', 'Por asignar'],
    ['Promotor', basis.promoterApproved, promoterRecommended, basis.promoterApproved - promoterRecommended, 'Aporte previsto', 'Recomendado en fases', 'Por asignar'],
    ['Deuda bancaria', totalDisbursed, totalAmortized, debt, 'Desembolsado real', 'Amortizado real', 'Saldo por devolver'],
  ];
  box.innerHTML = rows.map(([name, approved, distributed, pending, approvedLabel, distributedLabel, pendingLabel]) => `
    <article class="finance-coherence-row">
      <h4>${escapeHtml(name)}</h4>
      <div><span>${escapeHtml(approvedLabel)}</span><strong>${financeMoney(approved)}</strong></div>
      <div><span>${escapeHtml(distributedLabel)}</span><strong>${financeMoney(distributed)}</strong></div>
      <div class="${pending < -0.01 ? 'is-danger' : ''}"><span>${escapeHtml(pendingLabel)}</span><strong>${financeMoney(pending)}</strong></div>
    </article>`).join('');

  const notices = [];
  if (!basis.projectTotal || !basis.bankApproved) notices.push(['info', 'Completa el total del proyecto y la financiación bancaria para activar todas las recomendaciones.']);
  if (planAllocated > basis.projectTotal + 0.01 && basis.projectTotal > 0) notices.push(['danger', `El PLAN de fases supera el total del proyecto en ${financeMoney(planAllocated - basis.projectTotal)}.`]);
  if (bankRecommended > basis.bankApproved + 0.01 && basis.bankApproved > 0) notices.push(['danger', `La financiación recomendada en fases supera el préstamo aprobado en ${financeMoney(bankRecommended - basis.bankApproved)}.`]);
  if (totalDisbursed > basis.bankApproved + 0.01 && basis.bankApproved > 0) notices.push(['danger', `Los desembolsos reales superan el préstamo aprobado en ${financeMoney(totalDisbursed - basis.bankApproved)}.`]);
  if (!notices.length) notices.push(['ok', 'Las fases y las líneas están dentro de los límites financieros del proyecto.']);
  alertsBox.innerHTML = notices.map(([tone, message]) => `<div class="finance-coherence-notice is-${tone}">${escapeHtml(message)}</div>`).join('');
}

async function closeFinancePhaseModal() {
  const flushAutosave = FINANCE_PHASE_AUTOSAVE_FLUSH;
  try {
    if (flushAutosave) await flushAutosave();
    await flushFinanceLoanLinesAutosave({ showAlert: true });
    await flushFinanceUnitAutosave({ showAlert: true });
  } catch {
    return;
  }
  FINANCE_PHASE_AUTOSAVE_FLUSH = null;
  const modal = document.getElementById('financePhaseLinesModal');
  if (modal) {
    modal.hidden = true;
    modal.classList.remove('is-fullscreen');
    modal.style.zoom = '';
  }
  const expand = document.getElementById('financePhaseFullscreenBtn');
  if (expand) { expand.textContent = '⛶'; expand.title = 'Pantalla completa'; }
  document.body.classList.remove('finance-modal-open');
  const page = document.getElementById('tab-finanzas-page');
  const portal = document.querySelector('.finance-modal-portal');
  if (modal && FINANCE_MODAL_HOME) {
    FINANCE_MODAL_HOME.insertBefore(modal, FINANCE_MODAL_NEXT?.parentNode === FINANCE_MODAL_HOME ? FINANCE_MODAL_NEXT : null);
  }
  if (page) page.id = 'tab-finanzas';
  portal?.remove();
  if (flushAutosave) {
    await loadFinance();
    await markProjectDataChanged();
  }
}

async function setFinancePhaseModalTab(tab = 'overview') {
  const modal = document.getElementById('financePhaseLinesModal');
  const isRealContext = modal?.dataset.phaseContext === 'real';
  const requested = ['overview', 'lines', 'charts'].includes(tab) ? tab : 'overview';
  const selected = !isRealContext && requested !== 'overview' ? 'overview' : requested;
  const previous = FINANCE_PHASE_MODAL_TAB;
  if (selected !== previous) {
    try {
      if (previous === 'overview' && FINANCE_PHASE_AUTOSAVE_FLUSH) await FINANCE_PHASE_AUTOSAVE_FLUSH();
      if (previous === 'lines') {
        await flushFinanceLoanLinesAutosave({ showAlert: true });
        await flushFinanceUnitAutosave({ showAlert: true });
      }
    } catch {
      return;
    }
  }
  FINANCE_PHASE_MODAL_TAB = selected;
  document.querySelectorAll('[data-finance-phase-panel]').forEach(panel => { panel.hidden = panel.dataset.financePhasePanel !== selected; });
  document.querySelectorAll('[data-finance-phase-tab]').forEach(button => {
    const active = button.dataset.financePhaseTab === selected;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (selected === 'charts') setTimeout(() => window.Chart?.getChart?.(document.getElementById('financeLoanLinesChart'))?.resize(), 30);
}

function mountFinancePhaseModal() {
  const modal = document.getElementById('financePhaseLinesModal');
  const page = document.getElementById('tab-finanzas');
  if (!modal || !page || page.classList.contains('finance-modal-portal')) return modal;
  FINANCE_MODAL_HOME = modal.parentNode;
  FINANCE_MODAL_NEXT = modal.nextSibling;
  page.id = 'tab-finanzas-page';
  const portal = document.createElement('div');
  portal.id = 'tab-finanzas';
  portal.className = 'finance-modal-portal';
  document.body.appendChild(portal);
  portal.appendChild(modal);
  return modal;
}

function toggleFinancePhaseFullscreen() {
  const modal = document.getElementById('financePhaseLinesModal');
  const btn = document.getElementById('financePhaseFullscreenBtn');
  if (!modal) return;
  modal.classList.toggle('is-fullscreen');
  const full = modal.classList.contains('is-fullscreen');
  const bodyZoom = Number.parseFloat(getComputedStyle(document.body).zoom) || 1;
  modal.style.zoom = full && bodyZoom < 1 ? String(1 / bodyZoom) : '';
  if (btn) { btn.textContent = full ? '□' : '⛶'; btn.title = full ? 'Restaurar tamaño' : 'Pantalla completa'; }
  setTimeout(() => window.Chart?.getChart?.(document.getElementById('financeLoanLinesChart'))?.resize(), 30);
}

const FINANCE_CONDITION_FIELDS = [
  ['projectTotal','Total del proyecto','money'], ['bankFinancedAmount','Banco financia','money'],
  ['bankFinancedPct','% banco','pct'], ['promoterContribution','Promotor aporta','money'],
  ['promoterContributionPct','% promotor','pct'], ['interestRate','Tasa','pct'],
  ['term','Plazo'], ['paymentMethod','Forma de pago'], ['commission','Comisión'],
  ['disbursementMethod','Forma de desembolso'], ['disbursementConditions','Condiciones de desembolso'],
  ['amortizationConditions','Condiciones de amortización'], ['requiredPresales','Preventa requerida'],
  ['guarantees','Garantías'], ['insurance','Seguros']
];
const FINANCE_PRECEDENT_FIELDS = [
  ['presalesMet','Preventa cumplida'], ['constructionPermitsApproved','Permisos de construcción aprobados'],
  ['plansApproved','Planos aprobados'], ['insuranceDelivered','Seguros entregados'],
  ['guaranteesConstituted','Garantías constituidas'], ['environmentalStudyApproved','Estudio ambiental aprobado'],
  ['trustConstituted','Fideicomiso constituido'], ['otherRequirementsMet','Otros requisitos']
];
const FINANCE_OPERATION_FIELDS = [
  ['trustee','Fiduciaria'], ['trustType','Tipo de fideicomiso'],
  ['technicalInspector','Inspector técnico'], ['financialInspector','Inspector financiero']
];

const FINANCE_PHASE_CONDITION_FIELDS = [
  ['generalConditions','Condiciones generales'],
  ['phaseTotal','Total de la fase'],
  ['bankFinancedAmount','Financiacion bancaria'],
  ['promoterContribution','Aporte del promotor'],
  ['bankFinancedPct','% banco'],
  ['promoterContributionPct','% promotor'],
  ['guarantees','Garantias'],
  ['insurance','Seguros'],
  ['requiredPresales','Preventa requerida'],
  ['precedentConditions','Condiciones precedentes'],
  ['otherRequirements','Detalle de otros requisitos'],
  ['disbursementConditions','Condiciones de desembolso'],
  ['amortizationConditions','Condiciones de amortizacion/pago'],
  ['promoterObligations','Obligaciones del promotor'],
  ['covenants','Restricciones/covenants'],
  ['trustee','Fiduciaria'],
  ['trustType','Tipo de fideicomiso'],
  ['technicalInspector','Inspector tecnico'],
  ['financialInspector','Inspector financiero'],
  ['generalObservations','Observaciones generales']
];

function financePhaseConditionsHtml(ph = {}) {
  const c = ph.financialConditions || {};
  const hasConditions = Object.values(c || {}).some(value => String(value || '').trim());
  const lines = Array.isArray(ph.financingLines) ? ph.financingLines : [];
  const phaseBanks = Array.isArray(ph.financierBanks) && ph.financierBanks.length ? ph.financierBanks : (c.interimBank ? [c.interimBank] : []);
  const letterRows = [
    ['Entidades financiadoras', phaseBanks.join(', ') || 'Por definir'],
    ['Fecha de carta', financeDateInput(c.letterDate)],
    ['Referencia', c.letterReference]
  ].map(([label, value]) => `<div class="finance-condition-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '---')}</strong></div>`).join('');
  const conditionRows = FINANCE_PHASE_CONDITION_FIELDS
    .filter(([key]) => String(c[key] || '').trim())
    .map(([key,label]) => `<div class="finance-condition-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(c[key])}</strong></div>`)
    .join('');
  const lineRows = lines.map((line, idx) => `
    <tr>
      <td>${escapeHtml(line.name || `Linea ${idx + 1}`)}</td>
      <td>${escapeHtml(line.financierName || 'Por definir')}</td>
      <td class="right">${financeMoney(line.approvedAmount)}</td>
      <td>${escapeHtml(line.interestRate || '---')}</td>
      <td>${escapeHtml(line.term || '---')}</td>
      <td>${escapeHtml(line.paymentMethod || '---')}</td>
      <td>${escapeHtml(line.disbursementMethod || '---')}</td>
      <td>${escapeHtml(line.commission || '---')}</td>
      <td>${escapeHtml(line.observations || '---')}</td>
    </tr>`).join('');
  return `
    <details class="finance-condition-collapsible finance-phase-conditions-compact">
      <summary>Condiciones y lineas aprobadas <span>${lines.length} lineas</span></summary>
      <div class="finance-conditions-subgrid">${letterRows}${conditionRows || (!hasConditions ? '<div class="small muted">Sin condiciones de fase registradas.</div>' : '')}</div>
      <div style="overflow:auto;margin:10px;">
        <table class="table">
          <thead><tr><th>Nombre/facilidad</th><th>Entidad financiadora</th><th class="right">Monto aprobado</th><th>Tasa</th><th>Plazo</th><th>Forma de pago</th><th>Forma de desembolso</th><th>Comision</th><th>Observaciones</th></tr></thead>
          <tbody>${lineRows || '<tr><td colspan="9" class="muted">Sin lineas de financiacion aprobadas para esta fase.</td></tr>'}</tbody>
        </table>
      </div>
    </details>`;
}

function financeFacilityFormRow(item = {}) {
  return `<div class="finance-facility-form-row" data-facility-row>
    <label><span>Tipo de facilidad</span><input class="input" data-facility="facilityType" list="financeFacilityTypes" value="${escapeHtml(item.facilityType || '')}"></label>
    <label><span>Destino del préstamo</span><input class="input" data-facility="loanPurpose" value="${escapeHtml(item.loanPurpose || '')}"></label>
    <label><span>% financiado por banco</span><input class="input" data-facility="bankFinancedPct" type="number" step="any" value="${item.bankFinancedPct ?? ''}"></label>
    <label><span>% CPP/ventas a amortización</span><input class="input" data-facility="cppSalesAmortizationPct" type="number" step="any" value="${item.cppSalesAmortizationPct ?? ''}"></label>
    <label><span>Aporte requerido promotor</span><input class="input" data-facility="promoterRequiredContribution" type="number" step="any" value="${item.promoterRequiredContribution ?? ''}"></label>
    <button class="btn btn-danger btn-xs" type="button" data-remove-facility>Quitar</button>
  </div>`;
}

function renderFinanceConditions(project = state.project || {}) {
  const conditions = project.financialConditions || {};
  const effective = { ...conditions };
  if (!numOr0(effective.projectTotal)) effective.projectTotal = numOr0(project.budgetApproved);
  if (!numOr0(effective.bankFinancedAmount)) effective.bankFinancedAmount = numOr0(project.loanApproved);
  if (!numOr0(effective.promoterContribution)) effective.promoterContribution = Math.max(0, numOr0(effective.projectTotal) - numOr0(effective.bankFinancedAmount));
  if (!numOr0(effective.bankFinancedPct) && numOr0(effective.projectTotal)) effective.bankFinancedPct = numOr0(effective.bankFinancedAmount) / numOr0(effective.projectTotal) * 100;
  if (!numOr0(effective.promoterContributionPct) && numOr0(effective.projectTotal)) effective.promoterContributionPct = numOr0(effective.promoterContribution) / numOr0(effective.projectTotal) * 100;
  const view = document.getElementById('financeConditionsView');
  const form = document.getElementById('financeConditionsForm');
  const summary = document.getElementById('financeProjectFinancialSummary');
  const section = document.querySelector('.finance-conditions-card');
  if (!view || !form) return;
  if (summary) summary.innerHTML = `<h4>Datos financieros del proyecto</h4>` + [
    ['Total del proyecto', financeMoney(effective.projectTotal)],
    ['Financiación bancaria', financeMoney(effective.bankFinancedAmount)],
    ['Desembolsado', financeMoney(project.loanDisbursed)],
    ['Aporte promotor', financeMoney(effective.promoterContribution)],
    ['% banco', `${numOr0(effective.bankFinancedPct).toFixed(1)}%`],
    ['% promotor', `${numOr0(effective.promoterContributionPct).toFixed(1)}%`]
  ].map(([label,value]) => `<div class="finance-project-summary-item"><span>${label}</span><strong>${value}</strong></div>`).join('');

  const baseView = FINANCE_CONDITION_FIELDS.slice(5).map(([key,label,type]) => {
    const raw = effective[key];
    const value = type === 'money' ? financeMoney(raw) : type === 'pct' ? `${numOr0(raw)}%` : (raw || '—');
    return `<div class="finance-condition-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }).join('');
  const facilities = Array.isArray(conditions.facilities) ? conditions.facilities : [];
  const precedent = conditions.precedentConditions || {};
  const operation = conditions.operationStructure || {};
  if (section) section.hidden = true;
  view.innerHTML = `
    <details class="finance-condition-collapsible"><summary>Condiciones generales heredadas</summary><div class="finance-conditions-subgrid">${baseView}</div></details>
    <details class="finance-condition-collapsible"><summary>Facilidades o líneas aprobadas <span>${facilities.length}</span></summary><div class="finance-facilities-view">${facilities.map((item, idx) => `
      <article class="finance-facility-card"><strong>${escapeHtml(item.facilityType || `Facilidad ${idx + 1}`)}</strong><span>${escapeHtml(item.loanPurpose || 'Sin destino indicado')}</span>
      <div><b>${numOr0(item.bankFinancedPct)}%</b> banco · <b>${numOr0(item.cppSalesAmortizationPct)}%</b> CPP/ventas · Promotor <b>${financeMoney(item.promoterRequiredContribution)}</b></div></article>
    `).join('') || '<div class="small muted">Sin facilidades registradas.</div>'}</div></details>
    <details class="finance-condition-collapsible"><summary>Condiciones precedentes <span>${FINANCE_PRECEDENT_FIELDS.filter(([key]) => precedent[key]).length}/${FINANCE_PRECEDENT_FIELDS.length}</span></summary><div class="finance-precedent-view">${FINANCE_PRECEDENT_FIELDS.map(([key,label]) => `<span class="finance-check-state ${precedent[key] ? 'is-done' : ''}">${precedent[key] ? '✓' : '○'} ${escapeHtml(label)}</span>`).join('')}</div>${precedent.otherRequirements ? `<p class="small muted">Otros: ${escapeHtml(precedent.otherRequirements)}</p>` : ''}</details>
    <details class="finance-condition-collapsible"><summary>Estructura de la operación</summary><div class="finance-conditions-subgrid">${FINANCE_OPERATION_FIELDS.map(([key,label]) => `<div class="finance-condition-item"><span>${label}</span><strong>${escapeHtml(operation[key] || '—')}</strong></div>`).join('')}</div></details>`;

  const formField = ([key,label,type]) => `
    <label><span>${escapeHtml(label)}</span>${['money','pct'].includes(type)
      ? `<input class="input" data-finance-condition="${key}" type="number" step="any" value="${effective[key] ?? ''}">`
      : ['disbursementConditions','amortizationConditions','guarantees','insurance'].includes(key)
        ? `<textarea class="input" data-finance-condition="${key}" rows="2">${escapeHtml(effective[key] || '')}</textarea>`
        : `<input class="input" data-finance-condition="${key}" value="${escapeHtml(effective[key] || '')}">`}</label>`;
  const financialForm = FINANCE_CONDITION_FIELDS.slice(0, 6).map(formField).join('');
  const generalForm = FINANCE_CONDITION_FIELDS.slice(6).map(formField).join('');
  form.innerHTML = `
    <datalist id="financeFacilityTypes"><option value="Préstamo a término"><option value="Línea de crédito interina"><option value="Línea revolutiva"><option value="Infraestructura"><option value="Costos directos"><option value="Costos indirectos"></datalist>
    <details class="finance-condition-form-section" open><summary>Datos financieros del proyecto</summary><div class="finance-conditions-subgrid">${financialForm}<label><span>Desembolsado manual</span><input class="input" data-project-finance-kpi="loanDisbursed" type="number" step="any" value="${numOr0(project.loanDisbursed)}"></label></div></details>
    <details class="finance-condition-form-section"><summary>Condiciones bancarias generales</summary><div class="finance-conditions-subgrid">${generalForm}</div></details>
    <details class="finance-condition-form-section"><summary>Facilidades o líneas aprobadas <span>${facilities.length}</span></summary><div id="financeFacilitiesForm">${facilities.map(financeFacilityFormRow).join('')}</div><button class="btn btn-ghost btn-xs" type="button" data-add-facility>+ Añadir facilidad</button></details>
    <details class="finance-condition-form-section"><summary>Condiciones precedentes</summary><div class="finance-precedent-form">${FINANCE_PRECEDENT_FIELDS.map(([key,label]) => `<label><input type="checkbox" data-precedent="${key}" ${precedent[key] ? 'checked' : ''}> <span>${label}</span></label>`).join('')}</div><label class="finance-wide-field"><span>Detalle de otros requisitos</span><textarea class="input" data-precedent-notes rows="2">${escapeHtml(precedent.otherRequirements || '')}</textarea></label></details>
    <details class="finance-condition-form-section"><summary>Estructura de la operación</summary><div class="finance-conditions-subgrid">${FINANCE_OPERATION_FIELDS.map(([key,label]) => `<label><span>${label}</span><input class="input" data-operation="${key}" value="${escapeHtml(operation[key] || '')}"></label>`).join('')}</div></details>`;
  form.onclick = event => {
    if (event.target.closest('[data-add-facility]')) document.getElementById('financeFacilitiesForm')?.insertAdjacentHTML('beforeend', financeFacilityFormRow());
    if (event.target.closest('[data-remove-facility]')) event.target.closest('[data-facility-row]')?.remove();
  };
}

function setFinanceConditionsEditing(editing) {
  document.getElementById('financeProjectFinancialSummary').hidden = editing;
  document.getElementById('financeConditionsView').hidden = editing;
  document.getElementById('financeConditionsForm').hidden = !editing;
  document.getElementById('financeConditionsActions').hidden = !editing;
  document.getElementById('editFinanceConditionsBtn').hidden = editing;
}

async function saveFinanceConditions() {
  const numeric = new Set(['projectTotal','bankFinancedAmount','bankFinancedPct','promoterContribution','promoterContributionPct','interestRate']);
  const financialConditions = {};
  const form = document.getElementById('financeConditionsForm');
  form.querySelectorAll('[data-finance-condition]').forEach(input => {
    financialConditions[input.dataset.financeCondition] = numeric.has(input.dataset.financeCondition) ? numOr0(input.value) : input.value.trim();
  });
  financialConditions.facilities = Array.from(form.querySelectorAll('[data-facility-row]')).map(row => ({
    facilityType: row.querySelector('[data-facility="facilityType"]')?.value.trim() || '',
    loanPurpose: row.querySelector('[data-facility="loanPurpose"]')?.value.trim() || '',
    bankFinancedPct: numOr0(row.querySelector('[data-facility="bankFinancedPct"]')?.value),
    cppSalesAmortizationPct: numOr0(row.querySelector('[data-facility="cppSalesAmortizationPct"]')?.value),
    promoterRequiredContribution: numOr0(row.querySelector('[data-facility="promoterRequiredContribution"]')?.value)
  }));
  financialConditions.precedentConditions = {};
  form.querySelectorAll('[data-precedent]').forEach(input => { financialConditions.precedentConditions[input.dataset.precedent] = input.checked; });
  financialConditions.precedentConditions.otherRequirements = form.querySelector('[data-precedent-notes]')?.value.trim() || '';
  financialConditions.operationStructure = {};
  form.querySelectorAll('[data-operation]').forEach(input => { financialConditions.operationStructure[input.dataset.operation] = input.value.trim(); });
  const loanDisbursed = numOr0(form.querySelector('[data-project-finance-kpi="loanDisbursed"]')?.value);
  await API.put(`/api/projects/${id}`, { financialConditions, loanDisbursed });
  await loadProject();
  await loadFinance();
  setFinanceConditionsEditing(false);
  await markProjectDataChanged();
}

async function saveFinanceProjectKpis() {
  const payload = {
    loanApproved:   numOr0(document.getElementById('finLoanApproved')?.value),
    disbursed:      numOr0(document.getElementById('finLoanDisbursed')?.value),
    budgetApproved: numOr0(document.getElementById('finBudgetApproved')?.value),
  };

  try {
    await API.put(`/api/projects/${id}/finance/kpis`, payload);
    await loadFinance();
    await markProjectDataChanged();
    alert('KPIs actualizados');
  } catch (e) {
    console.error(e);
    alert('No se pudieron guardar los KPIs');
  }
}


function renderFinanceAlerts(alerts) {
  const box = document.getElementById('financeAlerts');
  if (!box) return;
  box.innerHTML = '';
  const section = document.getElementById('financeAlertsSection');
  if (section) section.hidden = true;
}

function financeMoney(n) {
  return formatProjectMoney(n);
}

function financePct(value, base, decimals = 1) {
  const numerator = numOr0(value);
  const denominator = numOr0(base);
  if (denominator <= 0) return '0%';
  return `${((numerator / denominator) * 100).toFixed(decimals)}%`;
}

function financeProgressWidth(value, base) {
  const denominator = numOr0(base);
  if (denominator <= 0) return 0;
  return Math.max(0, Math.min(100, (numOr0(value) / denominator) * 100));
}

function financeRequirementProgress(requirements = []) {
  const items = Array.isArray(requirements) ? requirements : [];
  const total = items.length;
  const completed = items.filter(item => String(item?.status || '').toUpperCase() === 'CUMPLIDO').length;
  const pending = Math.max(0, total - completed);
  const percent = total ? Math.round(completed / total * 100) : 0;
  return { total, completed, pending, percent };
}

function financeRequirementProgressHtml(requirements = [], { compact = false } = {}) {
  const progress = financeRequirementProgress(requirements);
  const label = progress.total
    ? `${progress.completed} de ${progress.total} cumplidos · ${progress.pending} pendientes`
    : 'Sin requisitos configurados';
  return `<div class="finance-requirements-progress${compact ? ' is-compact' : ''}" aria-label="Avance de requisitos">
    <div class="finance-requirements-progress-copy"><span>Cumplimiento de requisitos</span><strong>${escapeHtml(label)}</strong></div>
    <div class="finance-requirements-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}" aria-label="${progress.percent}% de requisitos cumplidos"><div style="width:${progress.percent}%"></div></div>
    <b class="finance-requirements-progress-percent">${progress.percent}%</b>
  </div>`;
}

function financeDateInput(v) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function financeLineStatus(line) {
  const entries = Array.isArray(line?.entries) && line.entries.length ? line.entries : [line];
  const statuses = entries.map(financeEntryStatus).map(s => s.key);
  if (statuses.includes('overdue')) return { key: 'overdue', label: 'Vencido' };
  if (statuses.includes('upcoming')) return { key: 'upcoming', label: 'Proximo a vencer' };
  if (statuses.includes('pending-payment')) return { key: 'pending', label: 'Pendiente de pago' };
  if (statuses.includes('missing')) return { key: 'missing', label: 'Sin vencimiento' };
  const balance = financeLoanLineTotals(line).balance;
  if (balance <= 0) return { key: 'amortized', label: 'Amortizado' };
  return { key: 'ok', label: 'OK' };
}

function financeEntryStatus(line) {
  if (line?.entryType === 'disbursement' && line?.fundingParty === 'promoter' && line?.promoterContributionStatus === 'contributed') return { key: 'ok', label: 'Desembolsado por promotor' };
  if (line?.entryType === 'disbursement' && line?.paymentStatus === 'pending') return { key: 'pending-payment', label: 'Pendiente de pago' };
  const balance = Math.max(0, numOr0(line?.disbursementAmount) - numOr0(line?.amortizedAmount));
  if (balance <= 0) return { key: 'amortized', label: 'Amortizado' };
  if (!line?.maturityDate) return { key: 'missing', label: 'Sin vencimiento' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maturity = new Date(line.maturityDate);
  maturity.setHours(0, 0, 0, 0);
  const daysLeft = Math.ceil((maturity.getTime() - today.getTime()) / 86400000);
  if (daysLeft < 0) return { key: 'overdue', label: `Vencido hace ${Math.abs(daysLeft)} dias` };
  if (daysLeft <= 120) return { key: 'upcoming', label: `Vence en ${daysLeft} dias` };
  return { key: 'ok', label: 'OK' };
}

function collectFinanceLoanLines() {
  return Array.from(document.querySelectorAll('.finance-loan-line-card[data-line-card]')).map((card, idx) => ({
    _id: isMongoIdLike(card.dataset.id) ? card.dataset.id : undefined,
    phaseId: card.dataset.phaseId || FINANCE_SELECTED_PHASE_ID || null,
    phaseName: card.dataset.phaseName || FINANCE_SELECTED_PHASE_NAME || '',
    sourceUseId: card.dataset.sourceUseId || null,
    approvedAmountMode: card.dataset.approvedAmountMode === 'auto' ? 'auto' : 'manual',
    name: card.querySelector('[data-line-field="name"]')?.value || `Linea ${idx + 1}`,
    financierName: card.dataset.financierName || '',
    financierTenantKey: card.dataset.financierTenantKey || '',
    financierType: card.dataset.financierType || 'bank',
    concept: card.dataset.concept || '',
    approvedAmount: numOr0(card.querySelector('[data-line-field="approvedAmount"]')?.value),
    notes: card.querySelector('[data-line-field="notes"]')?.value || '',
    entries: Array.from(card.querySelectorAll('[data-entry-row]')).map(row => ({
      _id: isMongoIdLike(row.dataset.entryId) ? row.dataset.entryId : undefined,
      entryType: row.dataset.entryType || 'legacy',
      paymentStatus: row.dataset.paymentStatus || row.querySelector('[data-field="paymentStatus"]')?.value || 'legacy',
      workflowStatus: row.dataset.workflowStatus || '',
      advanceAccountNumber: numOr0(row.dataset.advanceAccountNumber) || null,
      fundingParty: row.querySelector('[data-field="fundingParty"]')?.value || row.dataset.fundingParty || 'bank',
      promoterContributionAmount: numOr0(row.querySelector('[data-field="promoterContributionAmount"]')?.value ?? row.dataset.promoterContributionAmount),
      promoterContributionStatus: row.dataset.promoterContributionStatus || 'pending',
      requestedAt: row.dataset.requestedAt || null,
      requestedBy: row.dataset.requestedBy || null,
      requestedByRole: row.dataset.requestedByRole || '',
      disbursedAt: row.dataset.disbursedAt || null,
      disbursedBy: row.dataset.disbursedBy || null,
      disbursedByRole: row.dataset.disbursedByRole || '',
      transferReference: row.dataset.transferReference || '',
      workflowNote: row.dataset.workflowNote || '',
      movementDate: row.querySelector('[data-field="movementDate"]')?.value || null,
      disbursementDate: row.querySelector('[data-field="disbursementDate"]')?.value || null,
      loanNumber: row.querySelector('[data-field="loanNumber"]')?.value || '',
      disbursementAmount: numOr0(row.querySelector('[data-field="disbursementAmount"]')?.value),
      maturityDate: row.querySelector('[data-field="maturityDate"]')?.value || null,
      amortizedAmount: numOr0(row.querySelector('[data-field="amortizedAmount"]')?.value),
      interestAmount: numOr0(row.querySelector('[data-field="interestAmount"]')?.value),
      inspectionId: row.querySelector('[data-field="inspectionId"]')?.value || null,
      notes: row.querySelector('[data-field="notes"]')?.value || '',
    })).filter(entry =>
      entry.disbursementDate || entry.movementDate || entry.loanNumber || entry.disbursementAmount ||
      entry.maturityDate || entry.amortizedAmount || entry.interestAmount || entry.inspectionId || entry.notes
    ),
  }));
}

function readFinanceUnitCards() {
  return Array.from(document.querySelectorAll('.finance-unit-card[data-unit-card]')).map(card => ({
    _id: card.dataset.financeId && !card.dataset.financeId.startsWith('new-') ? card.dataset.financeId : undefined,
    unitId: card.dataset.unitId || undefined,
    clientName: card.querySelector('[data-field="clientName"]')?.value || '',
    lot: card.querySelector('[data-field="lot"]')?.value || '',
    buyerBank: card.querySelector('[data-field="buyerBank"]')?.value || '',
    checkNumber: card.querySelector('[data-field="checkNumber"]')?.value || '',
    checkDate: card.querySelector('[data-field="checkDate"]')?.value || null,
    checkAmount: numOr0(card.querySelector('[data-field="checkAmount"]')?.value),
    checkAmountSource: card.querySelector('[data-field="checkAmountSource"]')?.value || 'cpp',
    amortizationLine1: numOr0(card.querySelector('[data-field="amortizationLine1"]')?.value),
    amortizationLine2: numOr0(card.querySelector('[data-field="amortizationLine2"]')?.value),
    allocations: Array.from(card.querySelectorAll('[data-allocation-line]')).map(row => ({
      loanLineId: row.dataset.loanLineId || '',
      loanLineName: row.dataset.loanLineName || '',
      amount: numOr0(row.querySelector('[data-field="allocationAmount"]')?.value),
    })).filter(a => a.loanLineId || a.loanLineName || a.amount),
    promoterAmount: numOr0(card.querySelector('[data-field="promoterAmount"]')?.value),
    notes: card.querySelector('[data-field="notes"]')?.value || '',
  }));
}

function collectFinanceUnitAmortizations() {
  const commercialByUnit = new Map((FINANCE_COMMERCIAL_UNITS || []).map(u => [String(u.unitId || ''), u]));
  const savedByUnit = new Map((FINANCE_CONTROL?.unitAmortizations || []).map(u => [String(u.unitId || ''), u]));
  const visibleLineKeys = new Set(financeLoanLineOptions().flatMap(line => [String(line.id || ''), String(line.name || '')]).filter(Boolean));
  return readFinanceUnitCards().map(item => {
    const base = commercialByUnit.get(String(item.unitId || '')) || {};
    const saved = savedByUnit.get(String(item.unitId || '')) || {};
    const hiddenAllocations = (saved.allocations || []).filter(allocation => {
      const idKey = String(allocation.loanLineId || '');
      const nameKey = String(allocation.loanLineName || '');
      return !visibleLineKeys.has(idKey) && !visibleLineKeys.has(nameKey);
    });
    item.allocations = [...hiddenAllocations, ...(item.allocations || [])];
    const hasExistingFinance = !!item._id;
    const allocationTotal = (item.allocations || []).reduce((acc, a) => acc + numOr0(a.amount), 0);
    const hasDistribution = item.checkNumber || item.checkDate || allocationTotal || item.amortizationLine1 || item.amortizationLine2 || item.promoterAmount || item.notes;
    const hasOverrides =
      String(item.clientName || '') !== String(base.clientName || '') ||
      String(item.lot || '') !== String(base.lot || base.unitLabel || '') ||
      String(item.buyerBank || '') !== String(base.buyerBank || '') ||
      Math.abs(numOr0(item.checkAmount) - numOr0(base.cppAmount)) > 0.01;
    return (hasExistingFinance || hasDistribution || hasOverrides) ? item : null;
  }).filter(Boolean);
}

function computeFinanceControlTotals() {
  const loanLines = collectFinanceLoanLines().length ? collectFinanceLoanLines() : (FINANCE_CONTROL?.loanLines || []);
  const unitAmortizations = currentFinanceUnitAmortizations();
  const totalBankDisbursed = loanLines.reduce((a, l) => a + financeLoanLineTotals(l).bankDisbursed, 0);
  const totalPromoterDisbursed = loanLines.reduce((a, l) => a + financeLoanLineTotals(l).promoterDisbursed, 0);
  const totalDisbursed = totalBankDisbursed + totalPromoterDisbursed;
  const totalManualAmortized = loanLines.reduce((a, l) => a + financeLoanLineTotals(l).amortized, 0);
  const totalAllocatedAmortized = unitAmortizations.reduce((a, u) =>
    a + (u.allocations || []).reduce((acc, allocation) => acc + numOr0(allocation.amount), 0), 0);
  const totalAmortized = totalManualAmortized + totalAllocatedAmortized;
  const totalInterestPaid = loanLines.reduce((a, l) => a + financeLoanLineTotals(l).interestPaid, 0);
  const loanApproved = numOr0(document.getElementById('finLoanApproved')?.value || FINANCE_CONTROL?.totals?.loanApproved);
  const budgetApproved = numOr0(document.getElementById('finBudgetApproved')?.value || FINANCE_CONTROL?.totals?.budgetApproved);
  const planUses = (FINANCE?.phases || []).reduce((a, ph) => a + sumItems(ph.planUses), 0);
  const realUses = (FINANCE?.phases || []).reduce((a, ph) => a + sumItems(ph.uses), 0);

  return {
    budgetApproved,
    loanApproved,
    totalDisbursed,
    totalBankDisbursed,
    totalPromoterDisbursed,
    availableToDisburse: loanApproved - totalBankDisbursed,
    totalAmortized,
    totalInterestPaid,
    totalPaidToBank: totalAmortized + totalInterestPaid,
    currentDebtBalance: totalBankDisbursed - totalAmortized,
    amortizationPct: totalBankDisbursed > 0 ? totalAmortized / totalBankDisbursed : 0,
    upcomingMaturities: loanLines.filter(l => financeLineStatus(l).key === 'upcoming').length,
    overdueMaturities: loanLines.filter(l => financeLineStatus(l).key === 'overdue').length,
    checkAmountTotal: unitAmortizations.reduce((a, u) => a + numOr0(u.checkAmount), 0),
    promoterTotal: unitAmortizations.reduce((a, u) => a + numOr0(u.promoterAmount), 0),
    totalManualAmortized,
    totalAllocatedAmortized,
    planVsRealDifference: realUses - planUses,
  };
}

function financeLoanLineTotals(line = {}) {
  const entries = Array.isArray(line.entries) && line.entries.length ? line.entries : [line];
  const bankDisbursed = entries.reduce((a, entry) => {
    const paid = entry.entryType !== 'disbursement' || entry.paymentStatus !== 'pending';
    return a + (paid && ['bank', 'mixed'].includes(entry.fundingParty || 'bank') ? numOr0(entry.disbursementAmount) : 0);
  }, 0);
  const promoterDisbursed = entries.reduce((a, entry) => {
    const paid = entry.entryType !== 'disbursement' || entry.paymentStatus !== 'pending';
    if (entry.fundingParty === 'promoter' && (paid || entry.promoterContributionStatus === 'contributed')) return a + (numOr0(entry.disbursementAmount) || numOr0(entry.promoterContributionAmount));
    if (entry.fundingParty === 'mixed' && entry.promoterContributionStatus === 'contributed') return a + numOr0(entry.promoterContributionAmount);
    return a;
  }, 0);
  const disbursed = bankDisbursed + promoterDisbursed;
  const amortized = entries.reduce((a, entry) => a + numOr0(entry.amortizedAmount), 0);
  const interestPaid = entries.reduce((a, entry) => a + numOr0(entry.interestAmount), 0);
  const allocated = financeAllocatedToLine(line);
  const recovered = amortized + allocated;
  return {
    disbursed,
    bankDisbursed,
    promoterDisbursed,
    amortized,
    allocated,
    recovered,
    interestPaid,
    totalPaidToBank: recovered + interestPaid,
    balance: Math.max(0, bankDisbursed - recovered),
  };
}

function financeLoanLineChartTotals(line = {}) {
  const hasSummaryShape = [
    'disbursedAmount',
    'totalRecovered',
    'balanceAfterSales',
    'debt'
  ].some(key => line[key] !== undefined && line[key] !== null);

  if (hasSummaryShape) {
    const disbursed = numOr0(line.disbursementAmount ?? line.disbursedAmount);
    const recovered = numOr0(line.totalRecovered ?? line.amortizedAmount);
    const balance = line.balanceAfterSales !== undefined || line.debt !== undefined
      ? numOr0(line.balanceAfterSales ?? line.debt)
      : Math.max(0, disbursed - recovered);
    return {
      disbursed,
      recovered,
      amortized: recovered,
      allocated: 0,
      balance,
    };
  }

  return financeLoanLineTotals(line);
}

function destroyChartsByPrefix(prefix) {
  if (!prefix || !__sumCharts) return;
  Object.keys(__sumCharts).forEach(key => {
    if (!String(key).startsWith(prefix)) return;
    __sumCharts[key]?.destroy?.();
    delete __sumCharts[key];
  });
}

function renderLoanLinesBarChart(canvas, lines = [], chartKey = '') {
  if (!canvas || typeof Chart === 'undefined') return null;
  const existingChart = Chart.getChart?.(canvas) || canvas._chart;
  existingChart?.destroy?.();
  if (chartKey && __sumCharts?.[chartKey]) {
    __sumCharts[chartKey]?.destroy?.();
    delete __sumCharts[chartKey];
  }

  const safeLines = Array.isArray(lines) ? lines : [];
  const labels = safeLines.map((line, idx) => line.name || `Línea ${idx + 1}`);
  const totals = safeLines.map(line => financeLoanLineChartTotals(line));

  if (!labels.length) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return null;
  }

  const chart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Desembolsado',
          data: totals.map(t => t.disbursed),
          backgroundColor: 'rgba(34,197,94,.78)',
          borderColor: 'rgba(34,197,94,1)',
          borderWidth: 1,
          borderRadius: 6,
        },
        {
          label: 'Amortizado total',
          data: totals.map(t => t.recovered),
          backgroundColor: 'rgba(59,130,246,.72)',
          borderColor: 'rgba(59,130,246,1)',
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#94a3b8' } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${financeMoney(ctx.raw)}`,
            footer: (items) => {
              const idx = items?.[0]?.dataIndex ?? 0;
              const lineTotals = totals[idx] || {};
              return [
                `Amortizado: ${financePct(lineTotals.recovered, lineTotals.disbursed)}`,
                `Saldo por pagar: ${financeMoney(lineTotals.balance || 0)} (${financePct(lineTotals.balance, lineTotals.disbursed)})`
              ];
            },
          },
        },
      },
      scales: {
        x: { stacked: false, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.10)' } },
        y: { stacked: false, beginAtZero: true, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.12)' } },
      },
    },
  });

  canvas._chart = chart;
  if (chartKey) __sumCharts[chartKey] = chart;
  return chart;
}

function financeAllocatedToLine(line = {}) {
  const lineId = String(line._id || '');
  const lineName = String(line.name || '');
  return currentFinanceUnitAmortizations().reduce((acc, unit) => {
    return acc + (unit.allocations || []).reduce((sum, allocation) => {
      const sameId = lineId && String(allocation.loanLineId || '') === lineId;
      const sameName = !lineId && lineName && String(allocation.loanLineName || '') === lineName;
      return sum + (sameId || sameName ? numOr0(allocation.amount) : 0);
    }, 0);
  }, 0);
}

function financeSalesAllocationsForLine(line = {}) {
  const lineId = String(line._id || '');
  const lineName = String(line.name || '');
  return currentFinanceUnitAmortizations().flatMap(unit => {
    return (unit.allocations || []).map(allocation => {
      const sameId = lineId && String(allocation.loanLineId || '') === lineId;
      const sameName = !lineId && lineName && String(allocation.loanLineName || '') === lineName;
      if (!sameId && !sameName) return null;
      if (numOr0(allocation.amount) <= 0) return null;
      return {
        unitId: unit.unitId || '',
        financeId: unit._id || '',
        lot: unit.lot || '',
        clientName: unit.clientName || '',
        checkNumber: unit.checkNumber || '',
        checkDate: unit.checkDate || '',
        amount: numOr0(allocation.amount),
      };
    }).filter(Boolean);
  });
}

function financeSortDateValue(value) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? Number.MAX_SAFE_INTEGER : d.getTime();
}

function financeIdTimeValue(id) {
  const raw = String(id || '');
  if (/^[a-f\d]{24}$/i.test(raw)) return parseInt(raw.slice(0, 8), 16) * 1000;
  const generated = raw.match(/(?:new|new-entry)-(\d+)/);
  if (generated) return Number(generated[1]);
  return Number.MAX_SAFE_INTEGER;
}

function financeMovementSortValue(row) {
  const dateValue = row.type === 'manual'
    ? financeSortDateValue(row.entry?.movementDate || row.entry?.disbursementDate)
    : financeSortDateValue(row.sale?.checkDate);
  if (dateValue !== Number.MAX_SAFE_INTEGER) return dateValue;
  const idValue = row.type === 'manual'
    ? financeIdTimeValue(row.entry?._id)
    : financeIdTimeValue(row.sale?.financeId || row.sale?.unitId);
  if (idValue !== Number.MAX_SAFE_INTEGER) return idValue;
  return Number.MAX_SAFE_INTEGER - 100000 + (row.sourceOrder || 0);
}

function currentFinanceUnitAmortizations() {
  const cards = document.querySelectorAll('#financeUnitAmortizations .finance-unit-card');
  return cards.length ? readFinanceUnitCards() : mergedFinanceUnitAmortizations();
}

function setFinanceButtonState(btn, label, isLoading = false) {
  if (!btn) return;
  btn.textContent = label;
  btn.disabled = !!isLoading;
  btn.classList.toggle('is-saving', !!isLoading);
}

function waitFinanceFeedback(ms = 350) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function renderFinanceLoanGlobalSummary(lines = collectFinanceLoanLines()) {
  const box = document.getElementById('financeLoanGlobalSummary');
  if (!box) return;
  const totals = lines.reduce((acc, line) => {
    const t = financeLoanLineTotals(line);
    acc.disbursed += t.disbursed;
    acc.amortized += t.amortized;
    acc.interestPaid += t.interestPaid;
    acc.balance += t.balance;
    return acc;
  }, { disbursed: 0, amortized: 0, interestPaid: 0, balance: 0 });
  const allocated = lines.reduce((a, l) => a + financeLoanLineTotals(l).allocated, 0);
  const totalAmortized = totals.amortized + allocated;
  box.innerHTML = [
    ['Total desembolsado', financeMoney(totals.disbursed), '100% base'],
    ['Amortizado manual', financeMoney(totals.amortized), `${financePct(totals.amortized, totals.disbursed)} del desembolsado`],
    ['Amortizado por ventas', financeMoney(allocated), `${financePct(allocated, totals.disbursed)} del desembolsado`],
    ['Amortización total', financeMoney(totalAmortized), `${financePct(totalAmortized, totals.disbursed)} del desembolsado`],
    ['Intereses pagados', financeMoney(totals.interestPaid), 'Coste financiero pagado'],
    ['Total pagado al banco', financeMoney(totalAmortized + totals.interestPaid), 'Amortizaciones + intereses'],
    ['Saldo por pagar', financeMoney(totals.balance), `${financePct(totals.balance, totals.disbursed)} pendiente`],
  ].map(([label, value, percent]) => `
    <article class="finance-loan-summary-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(percent)}</small>
    </article>
  `).join('');
}

function renderFinanceControlKpis(totals = null) {
  const box = document.getElementById('financeControlKpis');
  if (!box) return;
  totals = totals || FINANCE_CONTROL?.totals || computeFinanceControlTotals();
  const cards = [
    ['Presupuesto Total', financeMoney(totals.budgetApproved), 'budget'],
    ['Cuantía Bancaria Aprobada', financeMoney(totals.loanApproved), 'loan'],
    ['Aporte promotor', financeMoney(totals.promoterContribution), 'promoter'],
    ['Desembolsado por banco', financeMoney(totals.totalBankDisbursed ?? totals.totalDisbursed), 'loan'],
    ['Desembolsado por promotor', financeMoney(totals.totalPromoterDisbursed), 'promoter'],
    ['Desembolsado total', financeMoney(totals.totalDisbursed), 'disbursed'],
    ['Disponible por desembolsar', financeMoney(totals.availableToDisburse), totals.availableToDisburse < 0 ? 'danger' : 'ok'],
    ['Amortización total', financeMoney(totals.totalAmortized), 'ok'],
    ['Intereses pagados', financeMoney(totals.totalInterestPaid), 'warn'],
    ['Total pagado al banco', financeMoney(totals.totalPaidToBank), 'loan'],
    ['Saldo por pagar', financeMoney(totals.currentDebtBalance), 'debt'],
    ['% amortizacion', `${((totals.amortizationPct || 0) * 100).toFixed(1)}%`, 'ok'],
    ['Vencimientos proximos', fmt(totals.upcomingMaturities), totals.upcomingMaturities ? 'warn' : 'ok'],
    ['Vencimientos vencidos', fmt(totals.overdueMaturities), totals.overdueMaturities ? 'danger' : 'ok'],
    ['Total valor base / cheques', financeMoney(totals.checkAmountTotal), 'cpp'],
    ['Total destinado a promotor', financeMoney(totals.promoterTotal), 'promoter'],
    ['Amortizacion manual', financeMoney(totals.totalManualAmortized), 'line1'],
    ['Amortizacion por ventas', financeMoney(totals.totalAllocatedAmortized), 'line2'],
    ['Diferencia Plan vs Real', financeMoney(totals.planVsRealDifference), Math.abs(totals.planVsRealDifference) > 0 ? 'warn' : 'ok'],
  ];
  box.innerHTML = cards.map(([label, value, tone]) => `
    <article class="finance-kpi-card is-${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `).join('');
}

function renderFinanceLoanLinesChart(lines = collectFinanceLoanLines()) {
  const el = document.getElementById('financeLoanLinesChart');
  if (!el || typeof Chart === 'undefined') return;
  renderLoanLinesBarChart(el, lines || []);
}

function financeInspectionReport(reportId) {
  return (FINANCE_AVALUATION_CONTEXT.reports || []).find(item => String(item.id) === String(reportId || '')) || null;
}

function financeInspectionOptions(selectedId = '', usedIds = new Set()) {
  const selected = String(selectedId || '');
  const available = (FINANCE_AVALUATION_CONTEXT.reports || []).filter(report =>
    String(report.id) === selected || !usedIds.has(String(report.id))
  );
  const emptyLabel = FINANCE_AVALUATION_CONTEXT.hasAssignedAvaluator
    ? (available.length ? 'Selecciona un informe' : 'No hay informes disponibles')
    : 'No requerido';
  return `<option value="">${emptyLabel}</option>${available.map(report => {
    const date = financeDateInput(report.inspectionDate || report.finalizedAt);
    const account = report.accountName || `Cuenta n.º ${report.sequence || '—'}`;
    const revision = Number(report.revision || 1) > 1 ? ` · Rev. ${Number(report.revision)}` : '';
    return `<option value="${escapeHtml(report.id)}" ${String(report.id) === selected ? 'selected' : ''}>${escapeHtml(account)}${revision} · ${escapeHtml(report.reportNumber || 'Informe')} · ${escapeHtml(date || 'Sin fecha')} · ${numOr0(report.projectProgressPercent).toFixed(1)}%</option>`;
  }).join('')}`;
}

function financeDisbursementWorkflowStatus(entry = {}) {
  if (entry.paymentStatus === 'paid') return 'disbursed';
  if (['prepared', 'requested', 'returned', 'disbursed'].includes(entry.workflowStatus)) return entry.workflowStatus;
  return 'prepared';
}

function financeActorRoleLabel(role = '') {
  return ({ admin: 'Superadmin', promoter: 'Promotor', bank: 'Banco' })[String(role).toLowerCase()] || 'Usuario';
}

function financeDisbursementWorkflowCell(entry = {}, saved = false) {
  const status = financeDisbursementWorkflowStatus(entry);
  const promoterOnlyDone = entry.fundingParty === 'promoter' && entry.promoterContributionStatus === 'contributed';
  const requestedDate = financeDateInput(entry.requestedAt);
  const disbursedDate = financeDateInput(entry.disbursementDate || entry.disbursedAt);
  const canRequest = ['admin', 'promoter'].includes(myRole);
  const canConfirm = ['admin', 'promoter'].includes(myRole) || (myRole === 'bank' && status === 'requested');
  const requestDocument = entry.requestDocumentId ? `<button class="finance-report-link" type="button" data-open-request-document="${escapeHtml(entry.requestDocumentId)}">Ver carta</button>` : '';
  const statusHtml = promoterOnlyDone
    ? `<span class="finance-status is-ok">Desembolsado por promotor</span><small>Confirmado por ${escapeHtml(financeActorRoleLabel(entry.promoterContributedByRole || 'promoter'))}</small>`
    : status === 'disbursed'
    ? `<span class="finance-status is-ok">Desembolsado</span><small>${disbursedDate ? `el ${escapeHtml(disbursedDate)}` : ''}${entry.disbursedByRole ? ` · Confirmado por ${escapeHtml(financeActorRoleLabel(entry.disbursedByRole))}` : ''}</small>`
    : status === 'requested'
      ? `<span class="finance-status is-warn">Solicitado</span><small>${requestedDate ? `el ${escapeHtml(requestedDate)}` : 'Pendiente del banco'}</small>`
      : status === 'returned'
        ? `<span class="finance-status is-danger">Devuelto</span><small>${escapeHtml(entry.returnComment || 'Revisa la solicitud')}</small>`
      : '<span class="finance-status is-missing">Preparado</span><small>Aún no solicitado</small>';
  const actions = !saved
    ? '<small>Guarda la línea para continuar</small>'
    : status === 'disbursed' || promoterOnlyDone
      ? (entry.transferReference ? `<small>Ref. ${escapeHtml(entry.transferReference)}</small>` : '')
      : `${['prepared', 'returned'].includes(status) && canRequest && ['bank', 'mixed'].includes(entry.fundingParty || 'bank') && (entry.fundingParty !== 'mixed' || entry.promoterContributionStatus === 'contributed') ? '<button class="btn btn-xs" type="button" data-finance-disbursement-action="request">Solicitar al banco</button>' : ''}${entry.fundingParty === 'mixed' && entry.promoterContributionStatus !== 'contributed' ? '<small>Primero confirma el aporte del promotor</small>' : ''}${['promoter', 'mixed'].includes(entry.fundingParty) && entry.promoterContributionStatus !== 'contributed' && canRequest ? `<button class="btn btn-xs" type="button" data-finance-disbursement-action="contribute">${entry.fundingParty === 'promoter' ? 'Confirmar desembolso promotor' : 'Confirmar aporte promotor'}</button>` : ''}${canConfirm && ['bank', 'mixed'].includes(entry.fundingParty || 'bank') && (entry.fundingParty !== 'mixed' || entry.promoterContributionStatus === 'contributed') ? '<button class="btn btn-success btn-xs" type="button" data-finance-disbursement-action="disburse">Marcar desembolsado</button>' : ''}`;
  return `<div class="finance-disbursement-workflow is-${status}">${statusHtml}${requestDocument}<div class="finance-disbursement-actions">${actions}</div></div>`;
}

function openFinanceRequestDialog({ entry = {}, phase = {} } = {}) {
  return new Promise(resolve => {
    const requirements = Array.isArray(phase?.requirements) ? phase.requirements : [];
    const overlay = document.createElement('div');
    overlay.className = 'finance-disbursement-dialog-backdrop';
    overlay.innerHTML = `
      <form class="finance-disbursement-dialog finance-request-dialog">
        <h3>Solicitar desembolso · Cuenta de avance ${escapeHtml(String(entry.advanceAccountNumber || '—'))}</h3>
        <p>El banco recibirá la carta firmada, el informe del avaluador y esta fotografía de los requisitos de la fase.</p>
        <div class="finance-request-summary"><span>Importe solicitado</span><strong>${financeMoney(entry.disbursementAmount)}</strong></div>
        <label><span>Carta de solicitud firmada · PDF</span><input class="input" name="requestPdf" type="file" accept="application/pdf,.pdf" required></label>
        <div class="finance-request-requirements"><b>Requisitos de ${escapeHtml(phase?.name || 'la fase')}</b>${requirements.length ? requirements.map(item => `<div><span class="finance-status ${String(item.status).toUpperCase() === 'CUMPLIDO' ? 'is-ok' : 'is-warn'}">${String(item.status).toUpperCase() === 'CUMPLIDO' ? 'Cumplido' : 'Pendiente'}</span><span>${escapeHtml(item.title || 'Requisito')}</span></div>`).join('') : '<p class="small muted">No hay requisitos configurados en esta fase.</p>'}</div>
        <label class="finance-request-confirm"><input name="requirementsConfirmed" type="checkbox" required><span>He revisado los requisitos y confirmo que la solicitud está lista para el banco.</span></label>
        <div class="finance-disbursement-dialog-actions"><button class="btn btn-ghost" type="button" data-cancel>Cancelar</button><button class="btn" type="submit">Enviar solicitud</button></div>
      </form>`;
    document.body.appendChild(overlay);
    const close = value => { overlay.remove(); resolve(value); };
    overlay.querySelector('[data-cancel]')?.addEventListener('click', () => close(null));
    overlay.addEventListener('click', event => { if (event.target === overlay) close(null); });
    overlay.querySelector('form')?.addEventListener('submit', event => {
      event.preventDefault();
      const file = event.currentTarget.elements.requestPdf?.files?.[0];
      if (!file || !file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf')) return alert('Selecciona una carta firmada en formato PDF.');
      close({ file, requirementsConfirmed: true });
    });
  });
}

function openFinanceDisbursementDialog({ direct = false, hasRequirementIssues = false } = {}) {
  return new Promise(resolve => {
    const today = new Date().toISOString().slice(0, 10);
    const overlay = document.createElement('div');
    overlay.className = 'finance-disbursement-dialog-backdrop';
    overlay.innerHTML = `
      <form class="finance-disbursement-dialog">
        <h3>Confirmar desembolso</h3>
        <p>${direct ? 'Este desembolso no se solicitó previamente en la plataforma. Puedes registrarlo directamente como desembolsado.' : 'Registra los datos de la transferencia realizada.'}</p>
        <label><span>Fecha efectiva de transferencia</span><input class="input" name="transferDate" type="date" value="${today}" required></label>
        <label><span>Referencia bancaria <em>(opcional)</em></span><input class="input" name="transferReference" maxlength="120" placeholder="Número o referencia de transferencia"></label>
        <label><span>Comentario <em>(${hasRequirementIssues ? 'obligatorio: hay requisitos por revisar' : 'opcional'})</em></span><textarea class="input" name="note" maxlength="500" rows="3" placeholder="Observaciones" ${hasRequirementIssues ? 'required' : ''}></textarea></label>
        <div class="finance-disbursement-dialog-actions">
          <button class="btn btn-ghost" type="button" data-cancel>Cancelar</button>
          <button class="btn btn-success" type="submit">Confirmar desembolso</button>
        </div>
      </form>`;
    document.body.appendChild(overlay);
    const close = value => { overlay.remove(); resolve(value); };
    overlay.querySelector('[data-cancel]')?.addEventListener('click', () => close(null));
    overlay.addEventListener('click', event => { if (event.target === overlay) close(null); });
    overlay.querySelector('form')?.addEventListener('submit', event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      close({
        transferDate: String(form.get('transferDate') || ''),
        transferReference: String(form.get('transferReference') || '').trim(),
        note: String(form.get('note') || '').trim(),
        overrideComment: hasRequirementIssues ? String(form.get('note') || '').trim() : ''
      });
    });
  });
}

async function updateFinanceDisbursementStatus(button, action) {
  const card = button.closest('[data-line-card]');
  const row = button.closest('[data-entry-row]');
  const lineId = card?.dataset.id || '';
  const entryId = row?.dataset.entryId || '';
  if (!isMongoIdLike(lineId) || !isMongoIdLike(entryId)) {
    alert('Guarda primero la línea y el desembolso.');
    return;
  }
  const initialLabel = button.textContent;
  let payload = { action };
  if (action === 'request') {
    const phase = (FINANCE?.phases || []).find(item => String(item._id) === String(card?.dataset.phaseId || FINANCE_SELECTED_PHASE_ID));
    const line = (FINANCE_CONTROL?.loanLines || []).find(item => String(item._id) === String(lineId));
    const entry = (line?.entries || []).find(item => String(item._id) === String(entryId)) || {};
    const values = await openFinanceRequestDialog({ entry, phase });
    if (!values) return;
    setFinanceButtonState(button, 'Subiendo carta...', true);
    const fd = new FormData();
    fd.append('files', values.file);
    fd.append('projectId', id);
    fd.append('category', 'disbursementRequest');
    fd.append('folder', 'financiero');
    fd.append('subfolder', 'Solicitudes de desembolso');
    let uploaded;
    try {
      uploaded = await API.upload('/api/documents/upload?category=disbursementRequest&folder=financiero', fd);
    } catch (error) {
      setFinanceButtonState(button, initialLabel, false);
      alert(error.message || 'No se pudo subir la carta de solicitud.');
      return;
    }
    const documentItem = Array.isArray(uploaded) ? uploaded[0] : (uploaded?.documents?.[0] || uploaded?.document || uploaded);
    if (!documentItem?._id) {
      setFinanceButtonState(button, initialLabel, false);
      alert('La carta se subió, pero no se pudo asociar a la solicitud.');
      return;
    }
    payload = { action, documentId: documentItem._id, requirementsConfirmed: true };
  } else if (action === 'contribute') {
    if (!confirm('¿Confirmar que el promotor ya realizó este desembolso?')) return;
    payload = { action, contributionDate: new Date().toISOString().slice(0, 10) };
  } else {
    const values = await openFinanceDisbursementDialog({ direct: financeDisbursementWorkflowStatus({ workflowStatus: row.dataset.workflowStatus, paymentStatus: row.dataset.paymentStatus }) !== 'requested', hasRequirementIssues: row.dataset.requirementIssues === '1' });
    if (!values) return;
    payload = { ...payload, ...values };
  }
  const previousLabel = initialLabel;
  try {
    setFinanceButtonState(button, action === 'request' ? 'Solicitando...' : action === 'contribute' ? 'Confirmando aporte...' : 'Confirmando...', true);
    await API.patch(`/api/projects/${id}/finance/loan-lines/${encodeURIComponent(lineId)}/entries/${encodeURIComponent(entryId)}/status`, payload);
    await loadFinance();
    const phase = (FINANCE?.phases || []).find(item => String(item._id) === String(FINANCE_SELECTED_PHASE_ID));
    if (phase) {
      await openFinancePhaseLines(phase, 'real', 'lines');
      FINANCE_LOAN_LINE_EXPANDED.add(String(lineId));
      FINANCE_LOAN_LINE_COLLAPSED.delete(String(lineId));
      renderFinanceLoanLines(financeLoanLinesWithUseSeeds(financeLinesForPhase(phase._id), phase));
    }
    await markProjectDataChanged();
  } catch (error) {
    console.error('[Finance] estado de desembolso', error);
    setFinanceButtonState(button, previousLabel, false);
    alert(error.message || 'No se pudo actualizar el desembolso.');
  }
}

async function deleteFinanceDisbursementEntry(button) {
  const card = button.closest('[data-line-card]');
  const row = button.closest('[data-entry-row]');
  const lineId = card?.dataset.id || '';
  const entryId = row?.dataset.entryId || '';

  if (!['admin', 'promoter', 'bank'].includes(myRole)) {
    alert('Solo Promotor, Admin o Banco pueden eliminar una partida de desembolso.');
    return;
  }

  if (row?.dataset.entryType !== 'disbursement') {
    row?.remove();
    renderFinanceLoanLines(collectFinanceLoanLines());
    scheduleFinanceLoanLinesAutosave();
    return;
  }

  if (!isMongoIdLike(lineId) || !isMongoIdLike(entryId)) {
    row?.remove();
    renderFinanceLoanLines(collectFinanceLoanLines());
    return;
  }

  const credential = prompt('Introduce tu contraseña de acceso o el PIN de eliminación para borrar definitivamente esta partida:');
  if (credential === null) return;
  if (!credential.trim()) {
    alert('Debes introducir tu contraseña o el PIN de eliminación.');
    return;
  }

  const previousLabel = button.textContent;
  try {
    setFinanceButtonState(button, 'Eliminando...', true);
    await API.del(`/api/projects/${id}/finance/loan-lines/${encodeURIComponent(lineId)}/entries/${encodeURIComponent(entryId)}`, {
      body: JSON.stringify({ credential: credential.trim() })
    });
    await loadFinance();
    const phase = (FINANCE?.phases || []).find(item => String(item._id) === String(FINANCE_SELECTED_PHASE_ID));
    if (phase) {
      await openFinancePhaseLines(phase, 'real', 'lines');
      FINANCE_LOAN_LINE_EXPANDED.add(String(lineId));
      FINANCE_LOAN_LINE_COLLAPSED.delete(String(lineId));
      renderFinanceLoanLines(financeLoanLinesWithUseSeeds(financeLinesForPhase(phase._id), phase));
    }
    await markProjectDataChanged();
  } catch (error) {
    console.error('[Finance] eliminar desembolso', error);
    setFinanceButtonState(button, previousLabel, false);
    alert(error.message || 'No se pudo eliminar la partida de desembolso.');
  }
}

function renderFinancePhaseLineCharts(phases = [], containerId = 'financePhaseLineCharts', chartPrefix = 'financePhaseLineChart', options = {}) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  destroyChartsByPrefix(chartPrefix);

  const safePhases = Array.isArray(phases) ? phases : [];
  const sourceLines = Array.isArray(options.lines) ? options.lines : null;
  const getLinesForPhase = (phase) => {
    if (!sourceLines) return financeLinesForPhase(phase?._id);
    const phaseId = String(phase?._id || '');
    const phaseName = String(phase?.name || '');
    const firstPhaseId = String(safePhases?.[0]?._id || '');
    return sourceLines.filter(line => {
      const linePhaseId = String(line.phaseId || line.phase || '');
      const linePhaseName = String(line.phaseName || '');
      if ((phaseId && linePhaseId === phaseId) || (phaseName && linePhaseName === phaseName)) return true;
      return !linePhaseId && !linePhaseName && phaseId && phaseId === firstPhaseId;
    });
  };

  if (!safePhases.length) {
    wrap.innerHTML = '<div class="card small muted">Sin fases para construir gráficas de líneas.</div>';
    return;
  }

  wrap.innerHTML = safePhases.map((phase, index) => {
    const phaseName = phase?.name || `Fase ${index + 1}`;
    const canvasId = `${chartPrefix}-${index}`;
    const title = `Gráfica líneas ${phaseName}`;
    return `
      <div class="card finance-chart-card summary-chart-card">
        <h3>${escapeHtml(title)}</h3>
        <div class="small muted">Desembolsado frente a amortizado total de las líneas asociadas a esta fase.</div>
        <div class="finance-chart-box summary-chart-box">
          <canvas id="${escapeHtml(canvasId)}"${options.summary ? ` data-summary-phase-line-chart="1" data-chart-title="${escapeHtml(title)}"` : ''}></canvas>
        </div>
        <div id="${escapeHtml(canvasId)}Summary" class="summary-chart-summary finance-phase-line-summary"></div>
      </div>
    `;
  }).join('');

  safePhases.forEach((phase, index) => {
    const phaseName = phase?.name || `Fase ${index + 1}`;
    const canvasId = `${chartPrefix}-${index}`;
    const lines = getLinesForPhase(phase);
    const canvas = document.getElementById(canvasId);
    renderLoanLinesBarChart(canvas, lines, `${chartPrefix}-${index}`);
    const summary = document.getElementById(`${canvasId}Summary`);
    if (!summary) return;
    if (!lines.length) {
      summary.innerHTML = '<div class="small muted">Esta fase todavía no tiene líneas asociadas.</div>';
      return;
    }
    const totals = lines.map(line => ({ ...financeLoanLineChartTotals(line), label: line.name || 'Línea' }));
    renderChartSummary(
      `${canvasId}Summary`,
      totals.map(t => ({ label: t.label, value: t.recovered, disbursed: t.disbursed, balance: t.balance })),
      {
        totalLabel: `Total amortizado ${phaseName}`,
        formatter: (v, item) => item
          ? `${financeMoney(item?.disbursed || 0)} desemb. · ${financeMoney(v)} amort. · ${financeMoney(item?.balance || 0)} saldo`
          : financeMoney(v)
      }
    );
  });
}

function renderFinanceLoanLines(lines = []) {
  const body = document.getElementById('financeLoanLinesBody');
  if (!body) return;
  const safeLines = (lines || []).map((line, idx) => ({
    ...line,
    entries: Array.isArray(line.entries) ? line.entries : [{
      _id: line._id ? `legacy-${line._id}` : `new-entry-${Date.now()}-${idx}`,
      disbursementDate: line.disbursementDate || '',
      loanNumber: line.loanNumber || '',
      disbursementAmount: numOr0(line.disbursementAmount),
      maturityDate: line.maturityDate || '',
      amortizedAmount: numOr0(line.amortizedAmount),
      notes: line.notes || '',
    }]
  }));
  const usedReportIds = new Set(safeLines.flatMap(line => (line.entries || []).map(entry => String(entry.inspectionId || '')).filter(Boolean)));
  body.innerHTML = safeLines.map((line, idx) => {
    const totals = financeLoanLineTotals(line);
    const recoveredPct = financePct(totals.recovered, totals.disbursed);
    const balancePct = financePct(totals.balance, totals.disbursed);
    const lineStatus = financeLineStatus(line);
    const requestedCount = (line.entries || []).filter(entry => entry.entryType === 'disbursement' && financeDisbursementWorkflowStatus(entry) === 'requested').length;
    const status = !(line.entries || []).length
      ? { key: 'neutral', label: 'Sin movimientos' }
      : requestedCount
        ? { key: 'warn', label: `${requestedCount} ${requestedCount === 1 ? 'solicitud pendiente' : 'solicitudes pendientes'}` }
        : lineStatus.key === 'pending'
        ? lineStatus
        : totals.balance <= 0 ? { key: 'amortized', label: 'Amortizado' } : lineStatus;
    const salesAllocations = financeSalesAllocationsForLine(line);
    const combinedRows = [
      ...line.entries.map((entry, entryIdx) => ({ type: 'manual', entry, entryIdx, sourceOrder: entryIdx })),
      ...salesAllocations.map((sale, saleIdx) => ({ type: 'sale', sale, saleIdx, sourceOrder: line.entries.length + saleIdx }))
    ].sort((a, b) => {
      const ad = financeMovementSortValue(a);
      const bd = financeMovementSortValue(b);
      if (ad !== bd) return ad - bd;
      return (a.sourceOrder || 0) - (b.sourceOrder || 0);
    });
    const rowId = line._id || `new-${Date.now()}-${idx}`;
    const rowKey = String(rowId);
    const rowsCount = combinedRows.length;
    const isCollapsed = FINANCE_LOAN_LINE_COLLAPSED.has(rowKey) || !FINANCE_LOAN_LINE_EXPANDED.has(rowKey);
    return `
      <article class="finance-loan-line-card ${isCollapsed ? 'is-compact' : ''}" data-line-card data-id="${escapeHtml(rowId)}" data-phase-id="${escapeHtml(line.phaseId || FINANCE_SELECTED_PHASE_ID || '')}" data-phase-name="${escapeHtml(line.phaseName || FINANCE_SELECTED_PHASE_NAME || '')}" data-source-use-id="${escapeHtml(line.sourceUseId || '')}" data-approved-amount-mode="${line.approvedAmountMode === 'auto' ? 'auto' : 'manual'}" data-financier-name="${escapeHtml(line.financierName || '')}" data-financier-tenant-key="${escapeHtml(line.financierTenantKey || '')}" data-financier-type="${escapeHtml(line.financierType || 'bank')}" data-concept="${escapeHtml(line.concept || '')}">
        <div class="finance-loan-line-head">
          <label>
            <span>Nombre de la línea</span>
            <input data-line-field="name" value="${escapeHtml(line.name || `Linea ${idx + 1}`)}" placeholder="Infraestructura" ${line.approvedAmountMode === 'auto' ? 'readonly' : ''}>
          </label>
          <div class="finance-loan-line-metrics">
            <span>Aprobado <b>${financeMoney(line.approvedAmount)}</b></span>
            <span>Desembolsado <b>${financeMoney(totals.disbursed)}</b></span>
            <span>Total amort. <b>${financeMoney(totals.recovered)} · ${recoveredPct}</b></span>
            <span>Intereses pagados <b>${financeMoney(totals.interestPaid)}</b></span>
            <span>Saldo por pagar <b>${financeMoney(totals.balance)} · ${balancePct}</b></span>
            <span class="finance-status is-${status.key}">${status.label}</span>
            <div class="finance-line-progress" title="${recoveredPct} amortizado">
              <div style="width:${financeProgressWidth(totals.recovered, totals.disbursed)}%"></div>
            </div>
          </div>
          <div class="finance-inline-actions">
            <button class="btn btn-ghost btn-xs" type="button" data-finance-toggle-entries data-count="${rowsCount}" aria-expanded="${isCollapsed ? 'false' : 'true'}">${isCollapsed ? 'Ver detalle' : 'Ocultar detalle'} (${rowsCount})</button>
            <button class="btn btn-xs" type="button" data-finance-add-entry="disbursement">+ Desembolso</button>
            <button class="btn btn-ghost btn-xs" type="button" data-finance-add-entry="manual_amortization">+ Amortización manual</button>
            <button class="btn btn-ghost btn-xs" type="button" data-finance-add-entry="interest_payment">+ Interés pagado</button>
            <button class="btn btn-xs" type="button" data-finance-save-line>Guardar ahora</button>
            <button class="btn btn-danger btn-xs" type="button" data-finance-remove-line>Eliminar</button>
          </div>
        </div>
        <div class="finance-loan-line-notes">
          <label><span>Aprobado para esta línea ${line.approvedAmountMode === 'auto' ? '<span class="finance-auto-line-badge">Automático desde usos</span>' : ''}</span><div class="finance-approved-line-control"><input data-line-field="approvedAmount" type="text" inputmode="decimal" value="${formatPanamaNumber(line.approvedAmount)}" placeholder="0.00" ${line.approvedAmountMode === 'auto' ? 'readonly' : ''}>${line.approvedAmountMode === 'auto' ? '<button class="btn btn-ghost btn-xs" type="button" data-finance-manual-line>Ajustar</button>' : ''}</div></label>
          <label><span>Notas de la línea</span><input data-line-field="notes" value="${escapeHtml(line.notes || '')}" placeholder="Observaciones opcionales"></label>
        </div>
        <div class="finance-table-wrap ${isCollapsed ? 'is-collapsed' : ''}" data-finance-entries-wrap>
          <table class="finance-loan-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Cuenta / financiación</th>
                <th>Fecha</th>
                <th>No. préstamo</th>
                <th>Importe banco</th>
                <th>Vencimiento</th>
                <th>Amortización / interés</th>
                <th>Informe de avalúo</th>
                <th>Pago</th>
                <th>Saldo</th>
                <th>Notas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${combinedRows.map(row => {
                if (row.type === 'sale') {
                  const sale = row.sale;
                  return `
                    <tr class="finance-sale-entry-row">
                      <td><span class="finance-status is-ok">Venta</span></td>
                      <td><span class="small muted">—</span></td>
                      <td><input value="${escapeHtml(financeDateInput(sale.checkDate) || '-')}" disabled></td>
                      <td><input value="${escapeHtml(sale.checkNumber ? `Cheque ${sale.checkNumber}` : sale.lot || 'Venta')}" disabled></td>
                      <td><input value="${formatPanamaNumber(0)}" disabled></td>
                      <td><input value="-" disabled></td>
                      <td><input value="${formatPanamaNumber(sale.amount)}" disabled></td>
                      <td><span class="small muted">—</span></td>
                      <td><span class="finance-status is-ok">Automática</span></td>
                      <td class="finance-balance">-</td>
                      <td><input value="${escapeHtml(`${sale.lot || 'Unidad'} · ${sale.clientName || 'Cliente'}`)}" disabled></td>
                      <td><span class="small muted">Desde unidad</span></td>
                    </tr>
                  `;
                }
                const entry = row.entry;
                const entryIdx = row.entryIdx;
                const entryType = ['disbursement', 'manual_amortization', 'interest_payment'].includes(entry.entryType) ? entry.entryType : 'legacy';
                const isDisbursement = entryType === 'disbursement';
                const isManualAmortization = entryType === 'manual_amortization';
                const isInterestPayment = entryType === 'interest_payment';
                const workflowStatus = isDisbursement ? financeDisbursementWorkflowStatus(entry) : '';
                const workflowLocked = isDisbursement && (['requested', 'disbursed'].includes(workflowStatus) || entry.promoterContributionStatus === 'contributed');
                const savedEntry = isMongoIdLike(entry._id);
                const paidAmount = isDisbursement && workflowStatus !== 'disbursed' ? 0 : (entry.fundingParty === 'promoter' ? 0 : numOr0(entry.disbursementAmount));
                const entryBalance = Math.max(0, paidAmount - numOr0(entry.amortizedAmount));
                const entryStatus = financeEntryStatus(entry);
                const report = financeInspectionReport(entry.inspectionId);
                return `
                  <tr data-entry-row data-entry-id="${escapeHtml(entry._id || `new-entry-${Date.now()}-${entryIdx}`)}" data-entry-type="${entryType}" data-payment-status="${escapeHtml(entry.paymentStatus || 'legacy')}" data-workflow-status="${escapeHtml(workflowStatus)}" data-advance-account-number="${escapeHtml(entry.advanceAccountNumber || '')}" data-funding-party="${escapeHtml(entry.fundingParty || 'bank')}" data-promoter-contribution-amount="${escapeHtml(entry.promoterContributionAmount || '')}" data-promoter-contribution-status="${escapeHtml(entry.promoterContributionStatus || 'pending')}" data-requirement-issues="${(entry.requirementsSnapshot || []).some(item => item?.reviewStatus !== 'compliant') ? '1' : '0'}" data-requested-at="${escapeHtml(entry.requestedAt || '')}" data-requested-by="${escapeHtml(entry.requestedBy || '')}" data-requested-by-role="${escapeHtml(entry.requestedByRole || '')}" data-disbursed-at="${escapeHtml(entry.disbursedAt || '')}" data-disbursed-by="${escapeHtml(entry.disbursedBy || '')}" data-disbursed-by-role="${escapeHtml(entry.disbursedByRole || '')}" data-transfer-reference="${escapeHtml(entry.transferReference || '')}" data-workflow-note="${escapeHtml(entry.workflowNote || '')}">
                    <td><span class="finance-entry-kind is-${entryType}">${isDisbursement ? 'Desembolso' : isManualAmortization ? 'Amortización' : isInterestPayment ? 'Interés' : 'Histórica'}</span></td>
                    <td>${isDisbursement ? `<div class="finance-account-source"><b>Cuenta ${escapeHtml(String(entry.advanceAccountNumber || 'Nueva'))}</b><select data-field="fundingParty" ${workflowLocked ? 'disabled' : ''}><option value="bank" ${(entry.fundingParty || 'bank') === 'bank' ? 'selected' : ''}>Banco</option><option value="promoter" ${entry.fundingParty === 'promoter' ? 'selected' : ''}>Promotor</option>${entry.fundingParty === 'mixed' ? '<option value="mixed" selected>Banco + promotor (histórico)</option>' : ''}</select>${entry.promoterContributionStatus === 'contributed' ? '<small class="finance-status is-ok">Desembolsado</small>' : ''}</div>` : '<span class="small muted">—</span>'}</td>
                    <td><input data-field="${isDisbursement ? 'disbursementDate' : 'movementDate'}" type="date" value="${financeDateInput(isDisbursement ? entry.disbursementDate : entry.movementDate)}" ${workflowLocked ? 'disabled' : ''}></td>
                    <td><input data-field="loanNumber" value="${escapeHtml(entry.loanNumber || '')}" placeholder="Opcional" ${(!isDisbursement && !isInterestPayment) || workflowLocked ? 'disabled' : ''}></td>
                    <td><input data-field="disbursementAmount" type="text" inputmode="decimal" value="${formatPanamaNumber(entry.disbursementAmount)}" ${!isDisbursement || workflowLocked ? 'disabled' : ''}></td>
                    <td><input data-field="maturityDate" type="date" value="${financeDateInput(entry.maturityDate)}" ${!isDisbursement || workflowLocked ? 'disabled' : ''}></td>
                    <td><input data-field="${isInterestPayment ? 'interestAmount' : 'amortizedAmount'}" type="text" inputmode="decimal" value="${formatPanamaNumber(isInterestPayment ? entry.interestAmount : entry.amortizedAmount)}" ${isDisbursement ? 'disabled' : ''}></td>
                    <td>${isDisbursement ? `<select data-field="inspectionId" ${workflowLocked || (entry.inspectionId && savedEntry) || (FINANCE_AVALUATION_CONTEXT.hasAssignedAvaluator && !(FINANCE_AVALUATION_CONTEXT.reports || []).length) ? 'disabled' : ''}>${financeInspectionOptions(entry.inspectionId, usedReportIds)}</select>${report ? `<button class="finance-report-link" type="button" data-open-inspection="${escapeHtml(report.id)}">Ver PDF</button>` : ''}` : '<span class="small muted">—</span>'}</td>
                    <td>${isDisbursement ? financeDisbursementWorkflowCell(entry, savedEntry) : `<span class="finance-status is-${entryStatus.key}">${isManualAmortization ? 'Manual' : isInterestPayment ? 'Pagado' : entryStatus.label}</span>`}</td>
                    <td class="finance-balance">${isInterestPayment ? '—' : financeMoney(entryBalance)}</td>
                    <td><input data-field="notes" value="${escapeHtml(entry.notes || '')}" ${workflowLocked ? 'disabled' : ''}></td>
                    <td>${['admin', 'promoter', 'bank'].includes(myRole) ? `<button class="btn btn-danger btn-xs" type="button" data-finance-remove-entry>${workflowLocked ? 'Eliminar' : 'Quitar'}</button>` : '<span class="small muted">Bloqueado</span>'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }).join('') || `<div class="small muted">Sin líneas registradas.</div>`;
  document.getElementById('financeLoanLinesSummary').textContent = `${safeLines.length} ${safeLines.length === 1 ? 'línea' : 'líneas'} · saldo ${financeMoney(safeLines.reduce((a, l) => a + financeLoanLineTotals(l).balance, 0))}`;
  renderFinanceLoanGlobalSummary(safeLines);
  renderFinanceLoanLinesChart(safeLines);
  renderFinanceControlKpis();
}

function mergedFinanceUnitAmortizations() {
  const saved = FINANCE_CONTROL?.unitAmortizations || [];
  const savedByUnit = new Map(saved.filter(x => x.unitId).map(x => [String(x.unitId), x]));
  const out = (FINANCE_COMMERCIAL_UNITS || []).map((unit, idx) => {
    const savedItem = savedByUnit.get(String(unit.unitId)) || {};
    if (!savedItem._id && !String(unit.clientName || '').trim()) return null;
    const savedSource = savedItem.checkAmountSource || 'cpp';
    const baseCheckAmount = savedSource === 'cpp_initial'
      ? numOr0(unit.financeBaseAmountWithInitial)
      : savedSource === 'sale_price'
        ? numOr0(unit.salePrice)
        : numOr0(unit.cppAmount || unit.financeBaseAmount);
    const lines = financeLoanLineOptions();
    const legacyAllocations = [];
    if ((!savedItem.allocations || !savedItem.allocations.length) && (savedItem.amortizationLine1 || savedItem.amortizationLine2)) {
      if (lines[0] && savedItem.amortizationLine1) legacyAllocations.push({ loanLineId: lines[0].id, loanLineName: lines[0].name, amount: savedItem.amortizationLine1 });
      if (lines[1] && savedItem.amortizationLine2) legacyAllocations.push({ loanLineId: lines[1].id, loanLineName: lines[1].name, amount: savedItem.amortizationLine2 });
    }
    return {
      _id: savedItem._id || `new-${idx}`,
      unitId: unit.unitId,
      clientName: savedItem.clientName || unit.clientName || '',
      lot: savedItem.lot || unit.lot || unit.unitLabel || '',
      buyerBank: savedItem.buyerBank || unit.buyerBank || '',
      checkNumber: savedItem.checkNumber || '',
      checkDate: savedItem.checkDate || '',
      checkAmount: savedItem.checkAmount || baseCheckAmount || 0,
      checkAmountSource: savedSource,
      cppAmount: unit.cppAmount || 0,
      initialPayment: unit.initialPayment || 0,
      salePrice: unit.salePrice || 0,
      amortizationLine1: savedItem.amortizationLine1 || 0,
      amortizationLine2: savedItem.amortizationLine2 || 0,
      allocations: (savedItem.allocations && savedItem.allocations.length) ? savedItem.allocations : legacyAllocations,
      promoterAmount: savedItem.promoterAmount || 0,
      notes: savedItem.notes || '',
      commercialStatus: unit.commercialStatus || '',
      cppStatus: unit.cppStatus || '',
    };
  }).filter(Boolean);
  saved.filter(x => !x.unitId).forEach((item, idx) => out.push({ ...item, _id: item._id || `manual-${idx}` }));
  return out;
}

function financeUnitState(item) {
  const hasCore = item.clientName || item.lot || item.buyerBank || item.checkAmount;
  const allocationTotal = (item.allocations || []).reduce((acc, a) => acc + numOr0(a.amount), 0);
  const legacyTotal = numOr0(item.amortizationLine1) + numOr0(item.amortizationLine2);
  const distributed = (item.allocations?.length ? allocationTotal : legacyTotal) + numOr0(item.promoterAmount);
  const diff = numOr0(item.checkAmount) - distributed;
  if (!hasCore || !numOr0(item.checkAmount)) return { key: 'pending', label: 'Pendiente', diff, distributed };
  if (Math.abs(diff) > 0.01) return { key: 'warn', label: 'Descuadre', diff, distributed };
  return { key: 'ok', label: 'OK', diff, distributed };
}

function financeLoanLineOptions() {
  const domLines = collectFinanceLoanLines();
  const lines = domLines.length ? domLines : (FINANCE_CONTROL?.loanLines || []);
  return lines
    .filter(line => String(line.name || '').trim())
    .map((line, idx) => ({
      id: line._id || '',
      name: line.name || `Linea ${idx + 1}`,
    }));
}

function renderFinanceAllocationInputs(item) {
  const lines = financeLoanLineOptions();
  if (!lines.length) {
    return '<div class="finance-field-wide small muted">Crea primero una linea de prestamo para asignar amortizaciones.</div>';
  }
  const allocationByKey = new Map((item.allocations || []).map(a => [String(a.loanLineId || a.loanLineName || ''), a]));
  return lines.map(line => {
    const key = line.id || line.name;
    const saved = allocationByKey.get(String(key)) || allocationByKey.get(String(line.name)) || {};
    return `
      <label data-allocation-line data-loan-line-id="${escapeHtml(line.id)}" data-loan-line-name="${escapeHtml(line.name)}">
        Amortizacion ${escapeHtml(line.name)}
        <input data-field="allocationAmount" type="text" inputmode="decimal" value="${formatPanamaNumber(saved.amount)}">
      </label>
    `;
  }).join('');
}

function financeCheckAmountForSource(item, source) {
  if (source === 'cpp_initial') return numOr0(item.cppAmount) + numOr0(item.initialPayment);
  if (source === 'sale_price') return numOr0(item.salePrice);
  return numOr0(item.cppAmount);
}

function renderFinanceUnitAmortizations() {
  const box = document.getElementById('financeUnitAmortizations');
  if (!box) return;
  const items = mergedFinanceUnitAmortizations();
  renderFinanceUnitGlobalSummary(items);
  box.innerHTML = items.map(item => {
    const state = financeUnitState(item);
    const commercialStateClass = normalizeUnitEstadoFrontend(item.commercialStatus || '');
    return `
      <details class="finance-unit-card estado-${escapeHtml(commercialStateClass)}" data-unit-card data-finance-id="${escapeHtml(item._id || '')}" data-unit-id="${escapeHtml(item.unitId || '')}" data-cpp-amount="${numOr0(item.cppAmount)}" data-initial-payment="${numOr0(item.initialPayment)}" data-sale-price="${numOr0(item.salePrice)}">
        <summary>
          <div>
            <strong>${escapeHtml(item.lot || 'Unidad')}</strong>
            <span>${escapeHtml(item.clientName || 'Sin cliente')}</span>
          </div>
          <div class="finance-unit-money">
            <b>${financeMoney(item.checkAmount)}</b>
            <span class="finance-status is-${state.key}">${state.label}</span>
          </div>
        </summary>
        <div class="finance-unit-fields">
          <label>Nombre del cliente<input data-field="clientName" value="${escapeHtml(item.clientName || '')}"></label>
          <label>Lote / unidad<input data-field="lot" value="${escapeHtml(item.lot || '')}"></label>
          <label>Banco comprador<input data-field="buyerBank" value="${escapeHtml(item.buyerBank || '')}"></label>
          <label>No. cheque<input data-field="checkNumber" value="${escapeHtml(item.checkNumber || '')}"></label>
          <label>Base valor
            <select data-field="checkAmountSource">
              <option value="cpp" ${item.checkAmountSource === 'cpp' ? 'selected' : ''}>CPP</option>
              <option value="cpp_initial" ${item.checkAmountSource === 'cpp_initial' ? 'selected' : ''}>CPP + abono inicial</option>
              <option value="sale_price" ${item.checkAmountSource === 'sale_price' ? 'selected' : ''}>Precio venta</option>
            </select>
          </label>
          <label>Valor cheque / base<input data-field="checkAmount" type="text" inputmode="decimal" value="${formatPanamaNumber(item.checkAmount)}"></label>
          <label>Fecha cheque<input data-field="checkDate" type="date" value="${financeDateInput(item.checkDate)}"></label>
          <div class="finance-field-wide finance-commercial-base">
            CPP: <b>${financeMoney(item.cppAmount)}</b> · Abono inicial: <b>${financeMoney(item.initialPayment)}</b> · Precio venta: <b>${financeMoney(item.salePrice)}</b>
          </div>
          ${renderFinanceAllocationInputs(item)}
          <label>Promotor<input data-field="promoterAmount" type="text" inputmode="decimal" value="${formatPanamaNumber(item.promoterAmount)}"></label>
          <label class="finance-field-wide">Notas<input data-field="notes" value="${escapeHtml(item.notes || '')}"></label>
        </div>
        <div class="finance-unit-footer">
          <span>Total distribuido: <b data-unit-distributed>${financeMoney(state.distributed)}</b></span>
          <span>Diferencia: <b data-unit-difference>${financeMoney(state.diff)}</b></span>
          <button class="btn btn-xs" type="button" data-finance-save-unit>Guardar ahora</button>
          <button class="btn btn-ghost btn-xs" type="button" data-finance-reset-unit>Limpiar</button>
        </div>
      </details>
    `;
  }).join('') || '<div class="small muted">No hay unidades comerciales cargadas.</div>';
  renderFinanceLoanLines(collectFinanceLoanLines());
  renderFinanceControlKpis();
}

function renderFinanceUnitGlobalSummary(items = mergedFinanceUnitAmortizations()) {
  const box = document.getElementById('financeUnitGlobalSummary');
  if (!box) return;
  const totals = items.reduce((acc, item) => {
    acc.checkAmount += numOr0(item.checkAmount);
    acc.allocated += (item.allocations || []).reduce((sum, allocation) => sum + numOr0(allocation.amount), 0);
    acc.promoter += numOr0(item.promoterAmount);
    return acc;
  }, { checkAmount: 0, allocated: 0, promoter: 0 });
  box.innerHTML = [
    ['Valor base / cheques', financeMoney(totals.checkAmount)],
    ['Amortizado a líneas', financeMoney(totals.allocated)],
    ['Total promotor', financeMoney(totals.promoter)],
  ].map(([label, value]) => `
    <article class="finance-loan-summary-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `).join('');
}

function refreshFinanceDerivedUI() {
  renderFinanceLoanLines(collectFinanceLoanLines());
  document.querySelectorAll('.finance-unit-card[data-unit-card]').forEach(card => {
    const item = readFinanceUnitCards().find(x => String(x.unitId || '') === String(card.dataset.unitId || '')) || {};
    const state = financeUnitState(item);
    card.querySelector('[data-unit-distributed]').textContent = financeMoney(state.distributed);
    card.querySelector('[data-unit-difference]').textContent = financeMoney(state.diff);
    const badge = card.querySelector('.finance-status');
    if (badge) {
      badge.className = `finance-status is-${state.key}`;
      badge.textContent = state.label;
    }
  });
  renderFinanceControlKpis();
}

function setFinanceAutosaveStatus(elementId, label, tone = '') {
  const status = document.getElementById(elementId);
  if (!status) return;
  status.textContent = label;
  status.className = `finance-autosave-status${tone ? ` is-${tone}` : ''}`;
}

function applyFinanceControlSaveResponse(response = {}) {
  if (!response.financeControl) return;
  FINANCE_CONTROL = response.financeControl;
  FINANCE_ALL_LOAN_LINES = (FINANCE_CONTROL.loanLines || []).map(line => ({ ...line }));
}

function reconcileSavedFinanceLines(savedLines = []) {
  const phaseLines = savedLines.filter(line => String(line.phaseId || '') === String(FINANCE_SELECTED_PHASE_ID || ''));
  const claimed = new Set();
  document.querySelectorAll('#financeLoanLinesBody [data-line-card]').forEach((card, index) => {
    const oldId = String(card.dataset.id || '');
    let savedIndex = phaseLines.findIndex((line, idx) => !claimed.has(idx) && isMongoIdLike(oldId) && String(line._id || '') === oldId);
    if (savedIndex < 0) savedIndex = phaseLines.findIndex((line, idx) => !claimed.has(idx) && card.dataset.sourceUseId && String(line.sourceUseId || '') === String(card.dataset.sourceUseId));
    if (savedIndex < 0) savedIndex = phaseLines.findIndex((line, idx) => !claimed.has(idx) && String(line.name || '') === String(card.querySelector('[data-line-field="name"]')?.value || ''));
    if (savedIndex < 0 && phaseLines[index] && !claimed.has(index)) savedIndex = index;
    if (savedIndex < 0) return;
    claimed.add(savedIndex);
    const saved = phaseLines[savedIndex];
    card.dataset.id = String(saved._id || oldId);
    card.querySelectorAll('[data-entry-row]').forEach((row, entryIndex) => {
      const savedEntry = saved.entries?.[entryIndex];
      if (savedEntry?._id) row.dataset.entryId = String(savedEntry._id);
    });
    if (saved._id && oldId && oldId !== String(saved._id)) {
      document.querySelectorAll('#financeUnitAmortizations [data-allocation-line]').forEach(row => {
        if (String(row.dataset.loanLineId || '') === oldId || (!isMongoIdLike(row.dataset.loanLineId) && String(row.dataset.loanLineName || '') === String(saved.name || ''))) {
          row.dataset.loanLineId = String(saved._id);
          row.dataset.loanLineName = saved.name || row.dataset.loanLineName || '';
        }
      });
    }
  });
}

function saveFinanceLoanLines(btn = null, { showAlert = !!btn, force = !!btn } = {}) {
  if (force) FINANCE_LOAN_LINES_DIRTY = true;
  clearTimeout(FINANCE_LOAN_LINES_AUTOSAVE_TIMER);
  FINANCE_LOAN_LINES_AUTOSAVE_TIMER = null;
  if (!FINANCE_LOAN_LINES_DIRTY) return FINANCE_LOAN_LINES_SAVE_QUEUE;
  const originalLabel = btn?.textContent || 'Guardar ahora';
  const visibleLines = collectFinanceLoanLines();
  const visibleIds = new Set(visibleLines.map(line => String(line._id || '')).filter(isMongoIdLike));
  const loanLines = [
    ...FINANCE_ALL_LOAN_LINES.filter(line => {
      if (visibleIds.has(String(line._id || ''))) return false;
      return String(line.phaseId || '') !== String(FINANCE_SELECTED_PHASE_ID || '');
    }),
    ...visibleLines
  ];
  FINANCE_LOAN_LINES_DIRTY = false;
  FINANCE_LOAN_LINES_SAVE_IN_PROGRESS = true;
  setFinanceButtonState(btn, 'Guardando...', true);
  setFinanceAutosaveStatus('financeLoanLinesSaveStatus', 'Guardando...', 'saving');
  FINANCE_LOAN_LINES_SAVE_QUEUE = FINANCE_CONTROL_SAVE_QUEUE.catch(() => {}).then(async () => {
    const response = await API.put(`/api/projects/${id}/finance/loan-lines`, { loanLines });
    applyFinanceControlSaveResponse(response);
    reconcileSavedFinanceLines(FINANCE_CONTROL?.loanLines || []);
    setFinanceButtonState(btn, 'Guardado', true);
    setFinanceAutosaveStatus('financeLoanLinesSaveStatus', FINANCE_LOAN_LINES_DIRTY ? 'Cambios pendientes' : 'Guardado', FINANCE_LOAN_LINES_DIRTY ? 'pending' : 'saved');
    renderFinanceLoanGlobalSummary(collectFinanceLoanLines());
    renderFinanceControlKpis();
    await markProjectDataChanged({ refreshHeader: false });
    if (btn) {
      await waitFinanceFeedback();
      setFinanceButtonState(btn, originalLabel, false);
    }
    return response;
  }).catch(error => {
    FINANCE_LOAN_LINES_DIRTY = true;
    setFinanceButtonState(btn, originalLabel, false);
    setFinanceAutosaveStatus('financeLoanLinesSaveStatus', 'No se pudo guardar', 'error');
    console.error('[Finance] error guardando lineas', error);
    if (showAlert) alert(error.message || 'No se pudieron guardar las líneas bancarias');
    throw error;
  }).finally(() => {
    FINANCE_LOAN_LINES_SAVE_IN_PROGRESS = false;
  });
  FINANCE_CONTROL_SAVE_QUEUE = FINANCE_LOAN_LINES_SAVE_QUEUE;
  return FINANCE_LOAN_LINES_SAVE_QUEUE;
}

function scheduleFinanceLoanLinesAutosave() {
  FINANCE_LOAN_LINES_DIRTY = true;
  setFinanceAutosaveStatus('financeLoanLinesSaveStatus', 'Cambios pendientes', 'pending');
  clearTimeout(FINANCE_LOAN_LINES_AUTOSAVE_TIMER);
  FINANCE_LOAN_LINES_AUTOSAVE_TIMER = setTimeout(() => {
    saveFinanceLoanLines().catch(() => {});
  }, 800);
}

async function flushFinanceLoanLinesAutosave({ showAlert = true } = {}) {
  clearTimeout(FINANCE_LOAN_LINES_AUTOSAVE_TIMER);
  FINANCE_LOAN_LINES_AUTOSAVE_TIMER = null;
  try { await FINANCE_LOAN_LINES_SAVE_QUEUE; } catch {}
  if (FINANCE_LOAN_LINES_DIRTY) await saveFinanceLoanLines(null, { showAlert });
}

function saveFinanceUnitAmortizations(btn = null, { showAlert = !!btn, force = !!btn } = {}) {
  if (force) FINANCE_UNIT_DIRTY = true;
  clearTimeout(FINANCE_UNIT_AUTOSAVE_TIMER);
  FINANCE_UNIT_AUTOSAVE_TIMER = null;
  if (!FINANCE_UNIT_DIRTY) return FINANCE_UNIT_SAVE_QUEUE;
  const originalLabel = btn?.textContent || 'Guardar ahora';
  const unitAmortizations = collectFinanceUnitAmortizations();
  FINANCE_UNIT_DIRTY = false;
  setFinanceButtonState(btn, 'Guardando...', true);
  setFinanceAutosaveStatus('financeUnitSaveStatus', 'Guardando...', 'saving');
  FINANCE_UNIT_SAVE_QUEUE = FINANCE_CONTROL_SAVE_QUEUE.catch(() => {}).then(async () => {
    const response = await API.put(`/api/projects/${id}/finance/unit-amortizations`, { unitAmortizations });
    applyFinanceControlSaveResponse(response);
    const savedByUnit = new Map((FINANCE_CONTROL?.unitAmortizations || []).map(item => [String(item.unitId || ''), item]));
    document.querySelectorAll('#financeUnitAmortizations [data-unit-card]').forEach(card => {
      const saved = savedByUnit.get(String(card.dataset.unitId || ''));
      if (saved?._id) card.dataset.financeId = String(saved._id);
    });
    setFinanceButtonState(btn, 'Guardado', true);
    setFinanceAutosaveStatus('financeUnitSaveStatus', FINANCE_UNIT_DIRTY ? 'Cambios pendientes' : 'Guardado', FINANCE_UNIT_DIRTY ? 'pending' : 'saved');
    renderFinanceLoanGlobalSummary(collectFinanceLoanLines());
    renderFinanceUnitGlobalSummary(readFinanceUnitCards());
    renderFinanceControlKpis();
    await markProjectDataChanged({ refreshHeader: false });
    if (btn) {
      await waitFinanceFeedback();
      setFinanceButtonState(btn, originalLabel, false);
    }
    return response;
  }).catch(error => {
    FINANCE_UNIT_DIRTY = true;
    setFinanceButtonState(btn, originalLabel, false);
    setFinanceAutosaveStatus('financeUnitSaveStatus', 'No se pudo guardar', 'error');
    console.error('[Finance] error guardando amortizaciones', error);
    if (showAlert) alert(error.message || 'No se pudieron guardar las amortizaciones');
    throw error;
  });
  FINANCE_CONTROL_SAVE_QUEUE = FINANCE_UNIT_SAVE_QUEUE;
  return FINANCE_UNIT_SAVE_QUEUE;
}

function scheduleFinanceUnitAutosave() {
  FINANCE_UNIT_DIRTY = true;
  setFinanceAutosaveStatus('financeUnitSaveStatus', 'Cambios pendientes', 'pending');
  clearTimeout(FINANCE_UNIT_AUTOSAVE_TIMER);
  FINANCE_UNIT_AUTOSAVE_TIMER = setTimeout(() => {
    saveFinanceUnitAmortizations().catch(() => {});
  }, 800);
}

async function flushFinanceUnitAutosave({ showAlert = true } = {}) {
  clearTimeout(FINANCE_UNIT_AUTOSAVE_TIMER);
  FINANCE_UNIT_AUTOSAVE_TIMER = null;
  try { await FINANCE_UNIT_SAVE_QUEUE; } catch {}
  if (FINANCE_UNIT_DIRTY) await saveFinanceUnitAmortizations(null, { showAlert });
}

async function saveFinanceSingleUnit(card, btn = null) {
  if (!card) return saveFinanceUnitAmortizations(btn, { force: true, showAlert: true });
  return saveFinanceUnitAmortizations(btn, { force: true, showAlert: true });
}

// -------------------------
// Estado por fase (banca-friendly)
// -------------------------
function getPhaseStatus(ph, { deviationPct = 0.10 } = {}) {
  const planUses = sumItems(ph?.planUses);
  const realUses = sumItems(ph?.uses);

  const planSources = sumItems(ph?.planSources);
  const realSources = sumItems(ph?.sources);

  // 1) Desviación (plan vs real) — simple y entendible
  // Si no hay plan (0), no marcamos desviación por % (para no dar falsos rojos)
  if (planUses > 0) {
    const pct = Math.abs(realUses - planUses) / planUses;
    if (pct > deviationPct) return { key: 'DEVIATION', label: 'Desviación', tone: 'error' };
  }

  // 2) Control básico de consistencia (usos > fuentes) — típico de banca
  if (realUses > realSources + 1e-9) {
    return { key: 'DEVIATION', label: 'Desviación', tone: 'error' };
  }

  return { key: 'OK', label: 'OK', tone: 'ok' };
}

// -------------------------
// Load principal
// -------------------------
async function loadFinance({ force = true } = {}) {
  try {
    const res = await getProjectFinanceSnapshot({ force });
    FINANCE = res.finance;
    FINANCE_KPIS = res.kpis;
    FINANCE_CONTROL = res.financeControl || null;
    FINANCE_PROJECT = res.project || state.project || null;
    FINANCE_ALL_LOAN_LINES = (FINANCE_CONTROL?.loanLines || []).map(line => ({ ...line }));
    FINANCE_COMMERCIAL_UNITS = res.commercialUnits || [];
    window.FINANCE_KPIS = FINANCE_KPIS;
    window.FINANCE_CONTROL = FINANCE_CONTROL;
    renderProjectHeaderKpis(FINANCE_PROJECT || state.project || {});

    // ✅ Guardamos FINANCE en window para el modal "Iniciar REAL" (dropdown de fases)
    window.FINANCE = FINANCE;

    // ================================
    // ✅ Bind botones PLAN / REAL (solo 1 vez)
    // ================================
    const canEditFinanceStructure = ['admin', 'bank', 'financiero', 'gerencia', 'socios'].includes(myRole);
    const planBtn = document.getElementById('addPhasePlanBtn');
    if (planBtn) planBtn.hidden = !canEditFinanceStructure;
    if (planBtn && !planBtn.dataset.bound) {
      planBtn.addEventListener('click', () => {
        openPhaseEditor(null, 'plan');
      });
      planBtn.dataset.bound = '1';
    }

    const realBtn = document.getElementById('addPhaseRealBtn');
    if (realBtn) realBtn.hidden = !canEditFinanceStructure;
    if (realBtn && !realBtn.dataset.bound) {
      realBtn.addEventListener('click', () => {
        openPhaseEditor(null, 'real');
      });
      realBtn.dataset.bound = '1';
    }

    // (Legacy) si aún existe el botón antiguo, lo desactivamos para evitar confusión
    const legacyBtn = document.getElementById('addPhaseBtn');
    if (legacyBtn) legacyBtn.hidden = !canEditFinanceStructure;
    if (legacyBtn && !legacyBtn.dataset.bound) {
      legacyBtn.addEventListener('click', () => {
        // Por defecto, crear fase debe ser PLAN
        openPhaseEditor(null, 'plan');
      });
      legacyBtn.dataset.bound = '1';
    }
    const unifiedBtn = document.getElementById('addPhaseUnifiedBtn');
    if (unifiedBtn) unifiedBtn.hidden = !canEditFinanceStructure;

    // KPIs del proyecto (cabecera)
    if (res.project) {
      fillFinanceKpiInputsFromProject(res.project);
      renderFinanceConditions(res.project);
    }
    else {
      try {
        const pr = await API.get(`/api/projects/${id}`);
        fillFinanceKpiInputsFromProject(pr);
      } catch(_) {}
    }

    // KPIs tiles
    document.getElementById('kpiExec').textContent      = `${((FINANCE_KPIS?.percentExecution || 0) * 100).toFixed(1)}%`;
    document.getElementById('kpiIntereses').textContent = financeMoney(FINANCE_CONTROL?.totals?.totalInterestPaid || 0);
    document.getElementById('kpiPreventas').textContent = fmt(FINANCE_KPIS?.totalPreventas || 0);

    renderFinanceControlKpis(FINANCE_CONTROL?.totals || {});
    renderFinanceCoherence(FINANCE?.phases || []);
    const phaseLines = FINANCE_SELECTED_PHASE_ID
      ? financeLinesForPhase(FINANCE_SELECTED_PHASE_ID)
      : FINANCE_ALL_LOAN_LINES;
    renderFinanceLoanLines(phaseLines);
    renderFinanceUnitAmortizations();

    // Fases: cards
    renderPhases(FINANCE?.phases || []);
    renderUnifiedFinancePhases(FINANCE?.phases || []);

    // Bind UI una vez
    bindFinanceOnce();
  } catch (e) {
    console.error('loadFinance error', e);
  }
}

function bindFinanceOnce() {
  if (bindFinanceOnce.bound) return;
  bindFinanceOnce.bound = true;

  const formatFinanceMoneyInput = (el) => {
    if (!el || el.disabled || el.readOnly) return;
    const raw = String(el.value || '').trim();
    if (!raw) return;
    el.value = formatPanamaNumber(parsePanamaNumber(raw));
  };

  document.addEventListener('focusout', (ev) => {
    const input = ev.target.closest?.(
      '.amount, [data-field="disbursementAmount"], [data-field="amortizedAmount"], [data-field="interestAmount"], [data-field="allocationAmount"], [data-field="checkAmount"], [data-field="promoterAmount"], [data-line-field="approvedAmount"], [data-budget-amount], [data-fixed-source], #finLoanApproved, #finLoanDisbursed, #finBudgetApproved'
    );
    if (input) formatFinanceMoneyInput(input);
  });

  document.getElementById('addPhaseBtn')?.addEventListener('click', () => openPhaseEditor(null));
  document.getElementById('editFinanceConditionsBtn')?.addEventListener('click', () => setFinanceConditionsEditing(true));
  document.getElementById('cancelFinanceConditionsBtn')?.addEventListener('click', () => {
    renderFinanceConditions(state.project || {});
    setFinanceConditionsEditing(false);
  });
  document.getElementById('saveFinanceConditionsBtn')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    try { await saveFinanceConditions(); } catch (e) { console.error(e); alert(e.message || 'No se pudieron guardar las condiciones'); }
    finally { btn.disabled = false; }
  });
  document.getElementById('addPhaseUnifiedBtn')?.addEventListener('click', () => openPhaseEditor(null, 'plan'));
  document.querySelectorAll('[data-close-finance-phase]').forEach(el => el.addEventListener('click', closeFinancePhaseModal));
  document.getElementById('financePhaseFullscreenBtn')?.addEventListener('click', toggleFinancePhaseFullscreen);
  document.querySelectorAll('[data-finance-phase-tab]').forEach(button => button.addEventListener('click', async () => { await setFinancePhaseModalTab(button.dataset.financePhaseTab); }));
  document.getElementById('financeExportPhasePdf')?.addEventListener('click', () => downloadFinanceExport('pdf', FINANCE_SELECTED_PHASE_ID));
  document.getElementById('financeExportPhaseXlsx')?.addEventListener('click', () => downloadFinanceExport('xlsx', FINANCE_SELECTED_PHASE_ID));
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && !document.getElementById('financePhaseLinesModal')?.hidden) closeFinancePhaseModal();
  });
  document.getElementById('financeAddLoanLineBtn')?.addEventListener('click', () => {
    const lines = collectFinanceLoanLines();
    lines.push({
      _id: `new-${Date.now()}`,
      name: `Linea ${lines.length + 1}`,
      approvedAmount: 0,
      approvedAmountMode: 'manual',
      sourceUseId: null,
      notes: '',
      phaseId: FINANCE_SELECTED_PHASE_ID || null,
      phaseName: FINANCE_SELECTED_PHASE_NAME || '',
      entries: [],
    });
    renderFinanceLoanLines(lines);
    scheduleFinanceLoanLinesAutosave();
  });

  document.getElementById('financeLoanLinesBody')?.addEventListener('input', () => {
    renderFinanceControlKpis();
    scheduleFinanceLoanLinesAutosave();
  });
  document.getElementById('financeLoanLinesBody')?.addEventListener('change', () => {
    scheduleFinanceLoanLinesAutosave();
    if (FINANCE_LOAN_LINES_RENDER_TIMER) clearTimeout(FINANCE_LOAN_LINES_RENDER_TIMER);
    FINANCE_LOAN_LINES_RENDER_TIMER = setTimeout(() => {
      FINANCE_LOAN_LINES_RENDER_TIMER = null;
      if (FINANCE_LOAN_LINES_SAVE_IN_PROGRESS) return;
      renderFinanceLoanLines(collectFinanceLoanLines());
    }, 120);
  });
  document.getElementById('financeLoanLinesBody')?.addEventListener('click', async (ev) => {
    const workflowButton = ev.target.closest('[data-finance-disbursement-action]');
    if (workflowButton) {
      await updateFinanceDisbursementStatus(workflowButton, workflowButton.dataset.financeDisbursementAction);
      return;
    }
    const manualLineBtn = ev.target.closest('[data-finance-manual-line]');
    if (manualLineBtn) {
      const card = manualLineBtn.closest('.finance-loan-line-card');
      if (!card || !confirm('La línea dejará de recalcularse automáticamente desde el uso. ¿Continuar?')) return;
      card.dataset.approvedAmountMode = 'manual';
      card.querySelector('[data-line-field="name"]')?.removeAttribute('readonly');
      card.querySelector('[data-line-field="approvedAmount"]')?.removeAttribute('readonly');
      manualLineBtn.remove();
      card.querySelector('.finance-auto-line-badge')?.remove();
      scheduleFinanceLoanLinesAutosave();
      return;
    }
    const toggleEntriesBtn = ev.target.closest('[data-finance-toggle-entries]');
    if (toggleEntriesBtn) {
      const card = toggleEntriesBtn.closest('.finance-loan-line-card');
      const key = String(card?.dataset.id || '');
      const wrap = card?.querySelector('[data-finance-entries-wrap]');
      const nextCollapsed = !wrap?.classList.contains('is-collapsed');
      wrap?.classList.toggle('is-collapsed', nextCollapsed);
      card?.classList.toggle('is-compact', nextCollapsed);
      if (key) {
        if (nextCollapsed) {
          FINANCE_LOAN_LINE_COLLAPSED.add(key);
          FINANCE_LOAN_LINE_EXPANDED.delete(key);
        } else {
          FINANCE_LOAN_LINE_EXPANDED.add(key);
          FINANCE_LOAN_LINE_COLLAPSED.delete(key);
        }
      }
      const count = toggleEntriesBtn.dataset.count || '';
      toggleEntriesBtn.textContent = `${nextCollapsed ? 'Ver detalle' : 'Ocultar detalle'}${count ? ` (${count})` : ''}`;
      toggleEntriesBtn.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
      return;
    }

    const saveBtn = ev.target.closest('[data-finance-save-line]');
    if (saveBtn) {
      try { await saveFinanceLoanLines(saveBtn, { force: true, showAlert: true }); } catch {}
      return;
    }

    const addEntryBtn = ev.target.closest('[data-finance-add-entry]');
    if (addEntryBtn) {
      const entryType = addEntryBtn.dataset.financeAddEntry || 'disbursement';
      if (entryType === 'disbursement' && FINANCE_AVALUATION_CONTEXT.hasAssignedAvaluator) {
        const used = new Set(collectFinanceLoanLines().flatMap(line => (line.entries || []).map(entry => String(entry.inspectionId || '')).filter(Boolean)));
        const hasAvailableReport = (FINANCE_AVALUATION_CONTEXT.reports || []).some(report => !used.has(String(report.id)));
        if (!hasAvailableReport) {
          alert((FINANCE_AVALUATION_CONTEXT.reports || []).length
            ? 'Todos los informes finalizados ya están vinculados a un desembolso.'
            : 'No puedes crear un desembolso hasta que el avaluador finalice un informe.');
          return;
        }
      }
      const card = addEntryBtn.closest('.finance-loan-line-card');
      const lines = collectFinanceLoanLines();
      const target = lines.find(line => String(line._id || '') === String(card?.dataset.id || ''));
      const fallback = lines[Array.from(document.querySelectorAll('.finance-loan-line-card')).indexOf(card)];
      const line = target || fallback;
      if (line) {
        line.entries = line.entries || [];
        line.entries.push({
          _id: `new-entry-${Date.now()}`,
          entryType,
          paymentStatus: entryType === 'disbursement' ? 'pending' : 'legacy',
          workflowStatus: entryType === 'disbursement' ? 'prepared' : '',
          advanceAccountNumber: null,
          fundingParty: 'bank',
          promoterContributionAmount: 0,
          promoterContributionStatus: 'pending',
          movementDate: '',
          disbursementDate: '',
          loanNumber: '',
          disbursementAmount: 0,
          maturityDate: '',
          amortizedAmount: 0,
          interestAmount: 0,
          inspectionId: '',
          notes: '',
        });
      }
      if (card?.dataset.id) {
        FINANCE_LOAN_LINE_EXPANDED.add(String(card.dataset.id));
        FINANCE_LOAN_LINE_COLLAPSED.delete(String(card.dataset.id));
      }
      renderFinanceLoanLines(lines);
      return;
    }

    const reportBtn = ev.target.closest('[data-open-inspection]');
    if (reportBtn) {
      const report = financeInspectionReport(reportBtn.dataset.openInspection);
      if (!report?.reportPath) return;
      try {
        await openSecureFile(report.reportPath, `${report.reportNumber || 'informe-avaluo'}.pdf`, 'view');
      } catch (error) {
        console.error(error);
        alert('No se pudo abrir el informe de avalúo.');
      }
      return;
    }

    const requestDocumentBtn = ev.target.closest('[data-open-request-document]');
    if (requestDocumentBtn) {
      try {
        await openSecureFile(secureDocUrl(requestDocumentBtn.dataset.openRequestDocument), 'carta-solicitud-desembolso.pdf', 'view');
      } catch (error) {
        console.error(error);
        alert('No se pudo abrir la carta de solicitud.');
      }
      return;
    }

    const removeEntryBtn = ev.target.closest('[data-finance-remove-entry]');
    if (removeEntryBtn) {
      await deleteFinanceDisbursementEntry(removeEntryBtn);
      return;
    }

    const removeLineBtn = ev.target.closest('[data-finance-remove-line]');
    if (removeLineBtn) {
      removeLineBtn.closest('.finance-loan-line-card')?.remove();
      renderFinanceLoanLines(collectFinanceLoanLines());
      scheduleFinanceLoanLinesAutosave();
    }
  });

  document.getElementById('financeUnitAmortizations')?.addEventListener('input', () => {
    renderFinanceControlKpis();
    scheduleFinanceUnitAutosave();
  });
  document.getElementById('financeUnitAmortizations')?.addEventListener('change', (ev) => {
    const source = ev.target.closest('[data-field="checkAmountSource"]');
    if (source) {
      const card = source.closest('.finance-unit-card');
      const checkInput = card?.querySelector('[data-field="checkAmount"]');
      const cpp = numOr0(card?.dataset.cppAmount);
      const initial = numOr0(card?.dataset.initialPayment);
      const sale = numOr0(card?.dataset.salePrice);
      if (checkInput) {
        checkInput.value = source.value === 'cpp_initial' ? cpp + initial : source.value === 'sale_price' ? sale : cpp;
      }
    }
    refreshFinanceDerivedUI();
    scheduleFinanceUnitAutosave();
  });
  document.getElementById('financeUnitAmortizations')?.addEventListener('click', async (ev) => {
    const saveUnitBtn = ev.target.closest('[data-finance-save-unit]');
    if (saveUnitBtn) {
      try { await saveFinanceSingleUnit(saveUnitBtn.closest('.finance-unit-card'), saveUnitBtn); } catch {}
      return;
    }

    const btn = ev.target.closest('[data-finance-reset-unit]');
    if (!btn) return;
    const card = btn.closest('.finance-unit-card');
    card?.querySelectorAll('input').forEach(input => {
      if (['clientName', 'lot', 'buyerBank', 'checkAmount'].includes(input.dataset.field)) return;
      input.value = '';
    });
    refreshFinanceDerivedUI();
    scheduleFinanceUnitAutosave();
  });

  document.getElementById('exportXlsx')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await downloadFinanceExport('xlsx');
  });

  document.getElementById('exportPdf')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await downloadFinanceExport('pdf');
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function downloadFinanceExport(format, phaseId = '') {
  try {
    const token =
      localStorage.getItem('token') ||
      localStorage.getItem('authToken') ||
      sessionStorage.getItem('token');

    if (!token) return alert('No hay token. Vuelve a iniciar sesión.');

    const phaseQuery = phaseId ? `&phaseId=${encodeURIComponent(phaseId)}` : '';
    let url = `/api/projects/${id}/finance/export?format=${format}${phaseQuery}`;
    let method = 'GET';
    let body = null;
    const headers = { Authorization: `Bearer ${token}` };

    if (format === 'pdf' && !phaseId) {
      // Espera un poco por si Chart.js está terminando de renderizar
      await sleep(60);

      const el = document.getElementById('phaseChart');
      if (!el) return alert('No existe #phaseChart en el DOM.');

      // ✅ MEJOR: sacar imagen desde Chart.js (si existe)
      let chart = el._chart?.toBase64Image?.();

      // fallback
      if (!chart && el.toDataURL) chart = el.toDataURL('image/png', 1.0);

      if (!chart || !chart.startsWith('data:image/')) {
        console.warn('chart base64 inválido:', chart?.slice?.(0, 40));
        return alert('El gráfico no está listo / está vacío. Prueba otra vez.');
      }

      method = 'POST';
      url = `/api/projects/${id}/finance/export`;
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({ format: 'pdf', chart });
    }

    const resp = await fetch(url, { method, headers, body });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      console.error('Export error:', resp.status, txt);
      return alert(`No se pudo exportar (${resp.status}). Mira consola.`);
    }

    const blob = await resp.blob();
    const ext = format === 'xlsx' ? 'xlsx' : 'pdf';

    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = phaseId ? `fase_${FINANCE_SELECTED_PHASE_NAME || phaseId}.${ext}` : `finanzas_${id}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);

  } catch (e) {
    console.error(e);
    alert('Error exportando');
  }
}
// -------------------------
// Render: resumen acumulado final
// -------------------------
function renderAccumSummary(phases) {
  const planUses = (phases || []).reduce((a, ph) => a + sumItems(ph.planUses), 0);
  const planSources = (phases || []).reduce((a, ph) => a + sumItems(ph.planSources), 0);
  const realUses = (phases || []).reduce((a, ph) => a + sumItems(ph.uses), 0);
  const realSources = (phases || []).reduce((a, ph) => a + sumItems(ph.sources), 0);

  // si tienes esos IDs en HTML:
  const elPU = document.getElementById('accPlanUses');
  const elPS = document.getElementById('accPlanSources');
  const elRU = document.getElementById('accRealUses');
  const elRS = document.getElementById('accRealSources');
  const elPUPct = document.getElementById('accPlanUsesPct');
  const elPSPct = document.getElementById('accPlanSourcesPct');
  const elRUPct = document.getElementById('accRealUsesPct');
  const elRSPct = document.getElementById('accRealSourcesPct');
  if (elPU) elPU.textContent = fmt(planUses);
  if (elPS) elPS.textContent = fmt(planSources);
  if (elRU) elRU.textContent = fmt(realUses);
  if (elRS) elRS.textContent = fmt(realSources);
  if (elPUPct) elPUPct.textContent = '100% del plan de usos';
  if (elPSPct) elPSPct.textContent = `${financePct(planSources, planUses)} de cobertura del plan`;
  if (elRUPct) elRUPct.textContent = `${financePct(realUses, planUses)} ejecutado vs plan`;
  if (elRSPct) elRSPct.textContent = `${financePct(realSources, planSources)} ejecutado vs plan`;
}

function renderRealAccumFromPhases(phases) {
  const usesBody = document.querySelector('#realUsesTable tbody');
  const srcsBody = document.querySelector('#realSourcesTable tbody');
  if (!usesBody || !srcsBody) return;

  const realUses = (phases || []).reduce((a, ph) => a + sumItems(ph.uses), 0);
  const realSources = (phases || []).reduce((a, ph) => a + sumItems(ph.sources), 0);

  usesBody.innerHTML = `<tr><td>Total</td><td class="right">${fmt(realUses)}</td></tr>`;
  srcsBody.innerHTML = `<tr><td>Total</td><td class="right">${fmt(realSources)}</td></tr>`;

  const elUsesTotal = document.getElementById('realUsesTotal');
  if (elUsesTotal) elUsesTotal.textContent = fmt(realUses);

  const elSourcesTotal = document.getElementById('realSourcesTotal');
  if (elSourcesTotal) elSourcesTotal.textContent = fmt(realSources);
}

// -------------------------
// Render: gráfica por fases (dos barras plan vs real)
// ✅ FIX: ahora acepta canvasId para reusarla en RESUMEN sin romper FINANZAS
// -------------------------

// Paleta de colores: tonos azules para Plan, rojos para Real
function getPhaseColors(count, type = 'plan') {
  const blues = [
    '#1e40af', '#1e3a8a', '#1e3f5f', '#2563eb', '#3b82f6',
    '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe', '#eff6ff'
  ];
  const reds = [
    '#7f1d1d', '#991b1b', '#b91c1c', '#dc2626', '#ef4444',
    '#f87171', '#fca5a5', '#fecaca', '#fee2e2', '#fef2f2'
  ];
  const palette = type === 'plan' ? blues : reds;
  const colors = [];
  for (let i = 0; i < count; i++) {
    colors.push(palette[i % palette.length]);
  }
  return colors;
}

function renderPhaseChart(phases, canvasId = 'phaseChart') {
  const el = document.getElementById(canvasId);
  if (!el) return;

  const existingChart = Chart.getChart?.(el) || el._chart;
  if (existingChart && typeof existingChart.destroy === 'function') existingChart.destroy();

  const labels = (phases || []).map(p => p.name || p.title || p.phase || 'Fase');

  // Extraer todos los tipos de usos únicos
  const allUseTypes = new Set();
  (phases || []).forEach(p => {
    (p.planUses || []).forEach(u => allUseTypes.add(u.name || u.id || 'Sin nombre'));
    (p.uses || []).forEach(u => allUseTypes.add(u.name || u.id || 'Sin nombre'));
  });
  const useTypes = Array.from(allUseTypes).sort();

  // Paletas de colores
  const planColors = getPhaseColors(useTypes.length, 'plan');
  const realColors = getPhaseColors(useTypes.length, 'real');

  // Crear datasets: uno por cada tipo de uso (Plan y Real separados en stacks)
  const datasets = [];

  // Datasets para PLAN
  useTypes.forEach((useName, idx) => {
    const planData = (phases || []).map(p => {
      const item = (p.planUses || []).find(u => (u.name || u.id || 'Sin nombre') === useName);
      return parsePanamaNumber(item?.amount || 0);
    });
    datasets.push({
      label: `${useName} (Plan)`,
      data: planData,
      stack: 'plan',
      backgroundColor: planColors[idx],
      borderColor: planColors[idx]
    });
  });

  // Datasets para REAL
  useTypes.forEach((useName, idx) => {
    const realData = (phases || []).map(p => {
      const item = (p.uses || []).find(u => (u.name || u.id || 'Sin nombre') === useName);
      return parsePanamaNumber(item?.amount || 0);
    });
    datasets.push({
      label: `${useName} (Real)`,
      data: realData,
      stack: 'real',
      backgroundColor: realColors[idx],
      borderColor: realColors[idx]
    });
  });

  const chart = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: true, axis: 'xy' },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12 } },
        tooltip: {
          mode: 'nearest',
          intersect: true,
          callbacks: {
            title: (items) => items?.[0]?.label || '',
            label: (ctx) => {
              const value = numOr0(ctx.parsed.y);
              const stackTotal = (ctx.chart?.data?.datasets || [])
                .filter(ds => ds.stack === ctx.dataset.stack)
                .reduce((sum, ds) => sum + numOr0(ds.data?.[ctx.dataIndex]), 0);
              return `${ctx.dataset.label}: ${fmt(value)} (${financePct(value, stackTotal)})`;
            }
          }
        }
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true }
      }
    }
  });

  el._chart = chart;
}

// -------------------------
// Render: gráfica por fases FUENTES (barras apiladas por tipo de fuente)
// Similar a renderPhaseChart pero para sources en lugar de uses
// -------------------------
function renderPhaseSourceChart(phases, canvasId = 'phaseSourceChart') {
  const el = document.getElementById(canvasId);
  if (!el) return;

  const existingChart = Chart.getChart?.(el) || el._chart;
  if (existingChart && typeof existingChart.destroy === 'function') existingChart.destroy();

  const labels = (phases || []).map(p => p.name || p.title || p.phase || 'Fase');

  // Extraer todos los tipos de fuentes únicos
  const allSourceTypes = new Set();
  (phases || []).forEach(p => {
    (p.planSources || []).forEach(s => allSourceTypes.add(s.name || s.id || 'Sin nombre'));
    (p.sources || []).forEach(s => allSourceTypes.add(s.name || s.id || 'Sin nombre'));
  });
  const sourceTypes = Array.from(allSourceTypes).sort();

  // Paletas de colores
  const planColors = getPhaseColors(sourceTypes.length, 'plan');
  const realColors = getPhaseColors(sourceTypes.length, 'real');

  // Crear datasets: uno por cada tipo de fuente (Plan y Real separados en stacks)
  const datasets = [];

  // Datasets para PLAN
  sourceTypes.forEach((sourceName, idx) => {
    const planData = (phases || []).map(p => {
      const item = (p.planSources || []).find(s => (s.name || s.id || 'Sin nombre') === sourceName);
      return parsePanamaNumber(item?.amount || 0);
    });
    datasets.push({
      label: `${sourceName} (Plan)`,
      data: planData,
      stack: 'plan',
      backgroundColor: planColors[idx],
      borderColor: planColors[idx]
    });
  });

  // Datasets para REAL
  sourceTypes.forEach((sourceName, idx) => {
    const realData = (phases || []).map(p => {
      const item = (p.sources || []).find(s => (s.name || s.id || 'Sin nombre') === sourceName);
      return parsePanamaNumber(item?.amount || 0);
    });
    datasets.push({
      label: `${sourceName} (Real)`,
      data: realData,
      stack: 'real',
      backgroundColor: realColors[idx],
      borderColor: realColors[idx]
    });
  });

  const chart = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: true, axis: 'xy' },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12 } },
        tooltip: {
          mode: 'nearest',
          intersect: true,
          callbacks: {
            title: (items) => items?.[0]?.label || '',
            label: (ctx) => {
              const value = numOr0(ctx.parsed.y);
              const stackTotal = (ctx.chart?.data?.datasets || [])
                .filter(ds => ds.stack === ctx.dataset.stack)
                .reduce((sum, ds) => sum + numOr0(ds.data?.[ctx.dataIndex]), 0);
              return `${ctx.dataset.label}: ${fmt(value)} (${financePct(value, stackTotal)})`;
            }
          }
        }
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true }
      }
    }
  });

  el._chart = chart;
}

// -------------------------
// Render: fases (cards) con PLAN vs REAL + desembolso
// -------------------------
function renderFinanceTimeCharts(phases = [], opts = {}) {
  if (typeof Chart === 'undefined') return;
  const {
    durationCanvasId = 'phaseTimeDurationChart',
    delayCanvasId = 'phaseTimeDelayChart',
    delaySummaryId = 'phaseTimeDelaySummary',
    durationSummaryId = '',
  } = opts || {};
  const labels = phases.map((phase, index) => phase.name || `Fase ${index + 1}`);
  const dayMs = 86400000;
  const validDate = value => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  };
  const today = new Date();
  const plannedDuration = phases.map(phase => {
    const start = validDate(phase.startDate);
    const end = validDate(phase.endDate);
    return start && end ? Math.max(0, Math.ceil((end - start) / dayMs)) : null;
  });
  const actualDuration = phases.map(phase => {
    const hasLegacyReal = sumItems(phase.uses) > 0 || sumItems(phase.sources) > 0 || numOr0(phase.disbActual) > 0;
    const start = validDate(phase.actualStartDate) || (hasLegacyReal ? validDate(phase.startDate) : null);
    if (!start) return null;
    const end = validDate(phase.actualEndDate || phase.completedAt) || today;
    return Math.max(0, Math.ceil((end - start) / dayMs));
  });
  const timingStatus = phases.map(phase => {
    const plannedEnd = validDate(phase.endDate);
    const hasLegacyReal = sumItems(phase.uses) > 0 || sumItems(phase.sources) > 0 || numOr0(phase.disbActual) > 0;
    const actualStart = validDate(phase.actualStartDate) || (hasLegacyReal ? validDate(phase.startDate) : null);
    const finishedAt = validDate(phase.actualEndDate || phase.completedAt);
    if (!plannedEnd) return { value: 0, tone: 'neutral', label: 'Sin fecha final estimada' };
    const plannedLabel = plannedEnd.toLocaleDateString();
    if (!actualStart) return { value: 0, tone: 'neutral', label: `Sin iniciar · fin previsto ${plannedLabel}` };
    if (finishedAt) {
      const value = Math.ceil((finishedAt - plannedEnd) / dayMs);
      return value > 0
        ? { value, tone: 'danger', label: `Finalizada con ${value} día(s) de retraso` }
        : value < 0
          ? { value, tone: 'ok', label: `Finalizada ${Math.abs(value)} día(s) antes` }
          : { value: 0, tone: 'ok', label: 'Finalizada en fecha' };
    }
    const remaining = Math.ceil((plannedEnd - today) / dayMs);
    return remaining < 0
      ? { value: Math.abs(remaining), tone: 'danger', label: `En curso · ${Math.abs(remaining)} día(s) de retraso` }
      : { value: 0, tone: 'active', label: `En plazo · faltan ${remaining} día(s)` };
  });
  const endDeviation = timingStatus.map(item => item.value);

  const durationCanvas = document.getElementById(durationCanvasId);
  if (durationCanvas) {
    const existingDurationChart = Chart.getChart?.(durationCanvas) || durationCanvas._chart;
    existingDurationChart?.destroy?.();
    durationCanvas._chart = new Chart(durationCanvas.getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'Duración estimada', data: plannedDuration, backgroundColor: 'rgba(245,158,11,.72)', borderColor: '#f59e0b', borderWidth: 1, borderRadius: 6 },
        { label: 'Duración real', data: actualDuration, backgroundColor: 'rgba(56,189,248,.72)', borderColor: '#38bdf8', borderWidth: 1, borderRadius: 6 }
      ] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { tooltip: { callbacks: { label: context => `${context.dataset.label}: ${Number(context.raw || 0)} día(s)` } } },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'Días' } } }
      }
    });
  }

  const delayCanvas = document.getElementById(delayCanvasId);
  if (delayCanvas) {
    const existingDelayChart = Chart.getChart?.(delayCanvas) || delayCanvas._chart;
    existingDelayChart?.destroy?.();
    delayCanvas._chart = new Chart(delayCanvas.getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [{
        label: 'Desviación temporal',
        data: endDeviation,
        backgroundColor: timingStatus.map(item => item.tone === 'danger' ? 'rgba(239,68,68,.75)' : item.tone === 'ok' ? 'rgba(34,197,94,.72)' : item.tone === 'active' ? 'rgba(56,189,248,.72)' : 'rgba(148,163,184,.45)'),
        borderColor: timingStatus.map(item => item.tone === 'danger' ? '#ef4444' : item.tone === 'ok' ? '#22c55e' : item.tone === 'active' ? '#38bdf8' : '#94a3b8'),
        borderWidth: 1,
        borderRadius: 6,
        borderSkipped: false,
        minBarLength: 7
      }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { tooltip: { callbacks: { label: context => timingStatus[context.dataIndex]?.label || 'Sin datos' } } },
        scales: { y: {
          suggestedMin: -Math.max(1, ...endDeviation.map(value => Math.abs(value))) * 1.15,
          suggestedMax: Math.max(1, ...endDeviation.map(value => Math.abs(value))) * 1.15,
          ticks: { precision: 0 },
          title: { display: true, text: '+ retraso / − adelanto' }
        } }
      }
    });
  }
  const delaySummary = document.getElementById(delaySummaryId);
  if (delaySummary) delaySummary.innerHTML = timingStatus.map((item, index) => `
    <div class="finance-time-status is-${item.tone}"><strong>${escapeHtml(labels[index])}</strong><span>${escapeHtml(item.label)}</span></div>
  `).join('');
  if (durationSummaryId) {
    renderChartSummary(
      durationSummaryId,
      labels.map((label, index) => ({
        label,
        value: plannedDuration[index] || 0,
        actual: actualDuration[index] || 0
      })),
      {
        totalLabel: 'Duración estimada total',
        formatter: (v, item) => item
          ? `${Number(v || 0)} día(s) estimado · ${Number(item?.actual || 0)} día(s) real`
          : `${Number(v || 0)} día(s) estimado`
      }
    );
  }
}

function financePhaseBudgetRows(items = [], scope = '') {
  return (items || []).map(item => `
    <div class="finance-phase-budget-row" data-phase-budget-row="${escapeHtml(scope)}" data-budget-id="${escapeHtml(item?._id || '')}">
      <input class="input" data-budget-name value="${escapeHtml(item?.name || '')}" placeholder="Concepto">
      <input class="input" data-budget-amount type="text" inputmode="decimal" value="${formatPanamaNumber(item?.amount)}">
      <button class="btn btn-danger btn-xs" type="button" data-remove-budget-row>Quitar</button>
    </div>`).join('');
}

function financeDefaultUseSources() {
  return [
    { name: 'Banco', amount: 0 },
    { name: 'Promotor', amount: 0 },
    { name: 'Preventas', amount: 0 }
  ];
}

function financePlanUsesWithSources(phase = {}) {
  const uses = (phase?.planUses || []).map(use => ({ ...use }));
  if (uses.some(use => Array.isArray(use?.fundingSources))) {
    return uses.map(use => ({
      ...use,
      fundingSources: Array.isArray(use?.fundingSources)
        ? use.fundingSources.map(source => ({ ...source }))
        : financeDefaultUseSources()
    }));
  }

  const totalUses = sumItems(uses);
  const existingSources = (phase?.planSources || []).map(source => ({
    name: source?.name || '',
    amount: numOr0(source?.amount)
  })).filter(source => source.name || source.amount);
  const initialBank = financePhaseApprovedBank(phase);
  const sourceTemplates = existingSources.length
    ? existingSources
    : [
        { name: 'Banco', amount: initialBank },
        { name: 'Promotor', amount: Math.max(0, totalUses - initialBank) },
        { name: 'Preventas', amount: 0 }
      ];
  ['Banco', 'Promotor', 'Preventas'].forEach(name => {
    if (!sourceTemplates.some(source => financeSourceKind(source.name) === financeSourceKind(name))) {
      sourceTemplates.push({ name, amount: 0 });
    }
  });

  const allocations = uses.map(() => []);
  sourceTemplates.forEach(source => {
    const totalCents = Math.round(numOr0(source.amount) * 100);
    let allocatedCents = 0;
    uses.forEach((use, index) => {
      const isLast = index === uses.length - 1;
      const cents = isLast
        ? totalCents - allocatedCents
        : Math.round(totalUses > 0 ? totalCents * numOr0(use.amount) / totalUses : 0);
      allocatedCents += cents;
      allocations[index].push({ name: source.name, amount: cents / 100 });
    });
  });
  return uses.map((use, index) => ({ ...use, fundingSources: allocations[index] || financeDefaultUseSources() }));
}

function financeRealUsesWithSources(phase = {}) {
  const uses = (phase?.uses || []).map(use => ({ ...use }));
  if (uses.some(use => Array.isArray(use?.fundingSources))) {
    return uses.map(use => ({
      ...use,
      fundingSources: Array.isArray(use?.fundingSources)
        ? use.fundingSources.map(source => ({ ...source }))
        : financeDefaultUseSources()
    }));
  }

  const totalUses = sumItems(uses);
  const sourceTemplates = (phase?.sources || []).map(source => ({
    name: source?.name || '',
    amount: numOr0(source?.amount)
  })).filter(source => source.name || source.amount);
  ['Banco', 'Promotor', 'Preventas'].forEach(name => {
    if (!sourceTemplates.some(source => financeSourceKind(source.name) === financeSourceKind(name))) {
      sourceTemplates.push({ name, amount: 0 });
    }
  });

  const allocations = uses.map(() => []);
  sourceTemplates.forEach(source => {
    const totalCents = Math.round(numOr0(source.amount) * 100);
    let allocatedCents = 0;
    uses.forEach((use, index) => {
      const isLast = index === uses.length - 1;
      const cents = isLast
        ? totalCents - allocatedCents
        : Math.round(totalUses > 0 ? totalCents * numOr0(use.amount) / totalUses : 0);
      allocatedCents += cents;
      allocations[index].push({ name: source.name, amount: cents / 100 });
    });
  });
  return uses.map((use, index) => ({ ...use, fundingSources: allocations[index] || financeDefaultUseSources() }));
}

function financeUseSourceRow(source = {}, useAmount = 0) {
  const amount = numOr0(source?.amount);
  const pct = useAmount ? amount / useAmount * 100 : 0;
  return `
    <div class="finance-use-source-row" data-use-source data-source-id="${escapeHtml(source?._id || '')}">
      <input class="input" data-funding-name value="${escapeHtml(source?.name || '')}" placeholder="Otra fuente">
      <div class="finance-use-source-pct"><input class="input" data-funding-pct type="number" step="0.01" value="${pct.toFixed(2)}"><em>%</em></div>
      <input class="input" data-funding-amount type="text" inputmode="decimal" value="${formatPanamaNumber(amount)}">
      <button class="btn btn-danger btn-xs" type="button" data-remove-use-source>Quitar</button>
    </div>`;
}

function financePhasePlanUseRows(items = []) {
  return (items || []).map(item => {
    const amount = numOr0(item?.amount);
    const sources = Array.isArray(item?.fundingSources) ? item.fundingSources : financeDefaultUseSources();
    return `
      <article class="finance-plan-use-card" data-plan-use data-budget-id="${escapeHtml(item?._id || '')}">
        <div class="finance-plan-use-head">
          <label><span>Uso</span><input class="input" data-plan-use-name value="${escapeHtml(item?.name || '')}" placeholder="Infraestructura"></label>
          <label><span>Importe del uso</span><input class="input" data-plan-use-amount type="text" inputmode="decimal" value="${formatPanamaNumber(amount)}"></label>
          <button class="btn btn-danger btn-xs" type="button" data-remove-plan-use>Quitar</button>
        </div>
        <div class="finance-use-sources-head"><span>Fuentes</span><span>Porcentaje</span><span>Importe</span><span></span></div>
        <div data-use-sources>${sources.map(source => financeUseSourceRow(source, amount)).join('')}</div>
        <button class="btn btn-ghost btn-xs" type="button" data-add-use-source>+ Fuente</button>
        <div class="finance-source-balance" data-use-source-balance></div>
      </article>`;
  }).join('');
}

function financePhaseRealUseRows(items = []) {
  return (items || []).map(item => {
    const amount = numOr0(item?.amount);
    const sources = Array.isArray(item?.fundingSources) ? item.fundingSources : financeDefaultUseSources();
    return `
      <article class="finance-plan-use-card" data-real-use data-budget-id="${escapeHtml(item?._id || '')}">
        <div class="finance-plan-use-head">
          <label><span>Uso</span><input class="input" data-real-use-name value="${escapeHtml(item?.name || '')}" placeholder="Infraestructura"></label>
          <label><span>Importe del uso</span><input class="input" data-real-use-amount type="text" inputmode="decimal" value="${formatPanamaNumber(amount)}"></label>
          <button class="btn btn-danger btn-xs" type="button" data-remove-plan-use>Quitar</button>
        </div>
        <div class="finance-use-sources-head"><span>Fuentes</span><span>Porcentaje</span><span>Importe</span><span></span></div>
        <div data-use-sources>${sources.map(source => financeUseSourceRow(source, amount)).join('')}</div>
        <button class="btn btn-ghost btn-xs" type="button" data-add-use-source>+ Fuente</button>
        <div class="finance-source-balance" data-use-source-balance></div>
      </article>`;
  }).join('');
}

function financeAggregateUseSources(uses = []) {
  const grouped = new Map();
  uses.forEach(use => (use.fundingSources || []).forEach(source => {
    const name = String(source?.name || '').trim();
    if (!name) return;
    const key = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const current = grouped.get(key) || { name, amount: 0 };
    current.amount += numOr0(source?.amount);
    grouped.set(key, current);
  }));
  return Array.from(grouped.values()).map(source => ({
    ...source,
    amount: Math.round(source.amount * 100) / 100
  }));
}

function renderFinancePhaseOverview(phase, visibleLines = null, initialView = 'plan') {
  const host = document.getElementById('financePhaseOverview');
  if (!host) return;
  const initialPlanUses = financePlanUsesWithSources(phase);
  const initialRealUses = financeRealUsesWithSources(phase);
  const initialPlanSourcesList = financeAggregateUseSources(initialPlanUses);
  const planSources = financeSourceBuckets(initialPlanSourcesList);
  const phaseLines = Array.isArray(visibleLines) ? visibleLines : financeLinesForPhase(phase?._id);
  const approvedForLines = phaseLines.reduce((sum, line) => sum + numOr0(line?.approvedAmount), 0);
  const approvedBank = financePhaseApprovedBank(phase);
  const unassigned = approvedBank - approvedForLines;
  const initialPlanTotal = sumItems(initialPlanUses);
  const initialPlanBank = planSources.bank;
  const initialBankPct = initialPlanTotal > 0
    ? initialPlanBank / initialPlanTotal * 100
    : numOr0(phase?.financialConditions?.bankFinancedPct);
  host.innerHTML = `
    <div class="finance-phase-overview-head">
      <div><h3>Resumen de la fase</h3><p>Planifica una vez y registra después únicamente los cambios reales.</p></div>
      <div class="finance-phase-save-actions"><span data-phase-save-status>Guardado</span><button class="btn btn-xs" type="button" data-save-phase-overview>Guardar ahora</button></div>
    </div>
    <div class="finance-phase-core-fields">
      <label><span>Nombre</span><input class="input" data-phase-overview="name" value="${escapeHtml(phase?.name || '')}"></label>
      <label><span>Inicio previsto</span><input class="input" type="date" data-phase-overview="startDate" value="${financeDateInput(phase?.startDate)}"></label>
      <label><span>Fin previsto</span><input class="input" type="date" data-phase-overview="endDate" value="${financeDateInput(phase?.endDate)}"></label>
    </div>
    <div class="finance-phase-plan-summary" aria-label="Resumen previsto">
      <article><span>Total previsto</span><strong data-phase-summary="plan-total">${financeMoney(initialPlanTotal)}</strong><small>Suma de usos</small></article>
      <article><span>Banco</span><strong data-phase-summary="plan-bank">${financeMoney(initialPlanBank)}</strong><small data-phase-summary="plan-bank-pct">${initialBankPct.toFixed(1)}%</small></article>
      <article><span>Promotor</span><strong data-phase-summary="plan-promoter">${financeMoney(planSources.promoter)}</strong><small data-phase-summary="plan-promoter-pct">${initialPlanTotal ? (planSources.promoter / initialPlanTotal * 100).toFixed(1) : '0.0'}%</small></article>
      <article><span>Preventas</span><strong data-phase-summary="plan-presales">${financeMoney(planSources.presales)}</strong><small>Fuente prevista</small></article>
    </div>
    <div class="finance-phase-view-tabs" role="tablist" aria-label="Vista de la fase">
      <button class="is-active" type="button" data-phase-view="plan" aria-pressed="true">Estimación</button>
      <button type="button" data-phase-view="real" aria-pressed="false">Realidad</button>
    </div>
    <section class="finance-phase-budget-panel" data-phase-panel="plan">
        <div class="finance-phase-section-head"><div><h4>Usos y fuentes previstas</h4><p>Cada uso puede tener un reparto diferente. Puedes escribir el porcentaje o el importe.</p></div></div>
        <div data-plan-uses-list>${financePhasePlanUseRows(initialPlanUses)}</div>
        <button class="btn btn-ghost btn-xs" type="button" data-add-plan-use>+ Uso</button>
        <div class="finance-plan-global" data-plan-global-summary></div>
    </section>
    <section class="finance-phase-budget-panel" data-phase-panel="real" hidden>
        <div class="finance-phase-section-head">
          <div><h4>Ejecución real</h4><p>Copia la estimación como punto de partida y modifica solamente las diferencias.</p></div>
          <button class="btn btn-ghost btn-xs" type="button" data-copy-plan-to-real>Copiar estimación</button>
        </div>
        <div class="finance-real-comparison">
          <span>Previsto <b data-real-comparison="plan">${financeMoney(initialPlanTotal)}</b></span>
          <span>Real <b data-real-comparison="real">${financeMoney(sumItems(phase?.uses))}</b></span>
          <span>Diferencia <b data-real-comparison="difference">${financeMoney(sumItems(phase?.uses) - initialPlanTotal)}</b></span>
        </div>
        <div class="finance-phase-real-dates">
          <label><span>Inicio real</span><input class="input" type="date" data-phase-overview="actualStartDate" value="${financeDateInput(phase?.actualStartDate)}"></label>
          <label><span>Fin real</span><input class="input" type="date" data-phase-overview="actualEndDate" value="${financeDateInput(phase?.actualEndDate)}"></label>
        </div>
        <div class="finance-phase-section-head"><div><h4>Usos y fuentes reales</h4><p>Cada uso puede tener un reparto diferente. Puedes escribir el porcentaje o el importe.</p></div></div>
        <div data-real-uses-list>${financePhaseRealUseRows(initialRealUses)}</div>
        <button class="btn btn-ghost btn-xs" type="button" data-add-real-use>+ Uso</button>
        <div class="finance-plan-global" data-real-global-summary></div>
    </section>
    <div class="finance-line-allocation ${unassigned < -0.01 ? 'is-danger' : ''}" data-line-allocation>
      <span>Aprobado por el banco <b data-line-approved>${financeMoney(approvedBank)}</b></span>
      <span>Asignado a líneas <b>${financeMoney(approvedForLines)}</b></span>
      <span><span data-line-difference-label>${unassigned >= 0 ? 'Pendiente de asignar' : 'Exceso asignado'}</span> <b data-line-difference>${financeMoney(Math.abs(unassigned))}</b></span>
    </div>`;

  const collectRows = key => Array.from(host.querySelectorAll(`[data-phase-budget-row="${key}"]`)).map(row => ({
    _id: isMongoIdLike(row.dataset.budgetId) ? row.dataset.budgetId : undefined,
    name: row.querySelector('[data-budget-name]')?.value.trim() || '',
    amount: numOr0(row.querySelector('[data-budget-amount]')?.value)
  })).filter(item => item.name || item.amount);
  const collectPlanUses = () => Array.from(host.querySelectorAll('[data-plan-use]')).map(row => ({
    _id: isMongoIdLike(row.dataset.budgetId) ? row.dataset.budgetId : undefined,
    name: row.querySelector('[data-plan-use-name]')?.value.trim() || '',
    amount: numOr0(row.querySelector('[data-plan-use-amount]')?.value),
    fundingSources: Array.from(row.querySelectorAll('[data-use-source]')).map(sourceRow => {
      const amount = numOr0(sourceRow.querySelector('[data-funding-amount]')?.value);
      return {
        _id: isMongoIdLike(sourceRow.dataset.sourceId) ? sourceRow.dataset.sourceId : undefined,
        name: sourceRow.querySelector('[data-funding-name]')?.value.trim() || (amount ? 'Otra fuente' : ''),
        amount
      };
    }).filter(source => source.name || source.amount)
  })).filter(item => item.name || item.amount);
  const collectRealUses = () => Array.from(host.querySelectorAll('[data-real-use]')).map(row => ({
    _id: isMongoIdLike(row.dataset.budgetId) ? row.dataset.budgetId : undefined,
    name: row.querySelector('[data-real-use-name]')?.value.trim() || '',
    amount: numOr0(row.querySelector('[data-real-use-amount]')?.value),
    fundingSources: Array.from(row.querySelectorAll('[data-use-source]')).map(sourceRow => {
      const amount = numOr0(sourceRow.querySelector('[data-funding-amount]')?.value);
      return {
        _id: isMongoIdLike(sourceRow.dataset.sourceId) ? sourceRow.dataset.sourceId : undefined,
        name: sourceRow.querySelector('[data-funding-name]')?.value.trim() || (amount ? 'Otra fuente' : ''),
        amount
      };
    }).filter(source => source.name || source.amount)
  })).filter(item => item.name || item.amount);
  const setPhaseView = view => {
    host.querySelectorAll('[data-phase-panel]').forEach(panel => { panel.hidden = panel.dataset.phasePanel !== view; });
    host.querySelectorAll('[data-phase-view]').forEach(button => {
      const active = button.dataset.phaseView === view;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };
  const updateRealComparison = () => {
    const planTotal = sumItems(collectPlanUses());
    const realTotal = sumItems(collectRealUses());
    const values = { plan: planTotal, real: realTotal, difference: realTotal - planTotal };
    Object.entries(values).forEach(([key, value]) => {
      const output = host.querySelector(`[data-real-comparison="${key}"]`);
      if (output) output.textContent = financeMoney(value);
    });
  };
  const recalculateRealSources = () => {
    const uses = collectRealUses();
    const total = sumItems(uses);
    const sources = financeAggregateUseSources(uses);
    host.querySelectorAll('[data-real-use]').forEach(row => {
      const useAmount = numOr0(row.querySelector('[data-real-use-amount]')?.value);
      const sourceTotal = Array.from(row.querySelectorAll('[data-funding-amount]')).reduce((sum, input) => sum + numOr0(input.value), 0);
      const difference = useAmount - sourceTotal;
      const balance = row.querySelector('[data-use-source-balance]');
      if (!balance) return;
      balance.classList.toggle('is-danger', Math.abs(difference) > 0.01);
      balance.textContent = Math.abs(difference) <= 0.01
        ? 'Fuentes equilibradas: 100%.'
        : difference > 0
          ? `Faltan ${financeMoney(difference)} para cubrir este uso (${useAmount ? (sourceTotal / useAmount * 100).toFixed(2) : '0.00'}%).`
          : `Exceso de ${financeMoney(Math.abs(difference))} (${useAmount ? (sourceTotal / useAmount * 100).toFixed(2) : '0.00'}%).`;
    });
    const globalSummary = host.querySelector('[data-real-global-summary]');
    if (globalSummary) {
      const useRows = uses.map(use => {
        const sourceText = (use.fundingSources || []).filter(source => source.name || source.amount).map(source => {
          const pct = use.amount ? numOr0(source.amount) / use.amount * 100 : 0;
          return `${escapeHtml(source.name || 'Fuente')} ${financeMoney(source.amount)} (${pct.toFixed(2)}%)`;
        }).join(' · ');
        return `<article><div><strong>Uso: ${escapeHtml(use.name || 'Sin nombre')}</strong><span>${financeMoney(use.amount)}</span></div><small>${sourceText || 'Sin fuentes indicadas'}</small></article>`;
      }).join('');
      const globalSourceText = sources.filter(source => source.name || source.amount).map(source => (
        `${escapeHtml(source.name || 'Fuente')} ${financeMoney(source.amount)} (${total ? (numOr0(source.amount) / total * 100).toFixed(2) : '0.00'}%)`
      )).join(' · ');
      const globalDifference = total - sumItems(sources);
      globalSummary.innerHTML = `<h4>Resumen global</h4>${useRows}<article class="finance-plan-global-total"><div><strong>Total de la fase</strong><span>${financeMoney(total)}</span></div><small>${globalSourceText || 'Sin fuentes indicadas'}</small><p class="${Math.abs(globalDifference) > 0.01 ? 'is-danger' : ''}">${Math.abs(globalDifference) <= 0.01 ? 'Fuentes globales equilibradas.' : globalDifference > 0 ? `Faltan ${financeMoney(globalDifference)}.` : `Exceso de ${financeMoney(Math.abs(globalDifference))}.`}</p></article>`;
    }
    updateRealComparison();
  };
  const recalculatePlanSources = () => {
    const uses = collectPlanUses();
    const total = sumItems(uses);
    const sources = financeAggregateUseSources(uses);
    const buckets = financeSourceBuckets(sources);
    const bank = buckets.bank;
    const promoter = buckets.promoter;
    const presales = buckets.presales;
    const bankPct = total > 0 ? bank / total * 100 : 0;
    const promoterPct = total > 0 ? promoter / total * 100 : 0;
    const summary = {
      'plan-total': financeMoney(total),
      'plan-bank': financeMoney(bank),
      'plan-bank-pct': `${bankPct.toFixed(1)}%`,
      'plan-promoter': financeMoney(promoter),
      'plan-promoter-pct': `${promoterPct.toFixed(1)}%`,
      'plan-presales': financeMoney(presales)
    };
    Object.entries(summary).forEach(([key, value]) => {
      const output = host.querySelector(`[data-phase-summary="${key}"]`);
      if (output) output.textContent = value;
    });
    host.querySelectorAll('[data-plan-use]').forEach(row => {
      const useAmount = numOr0(row.querySelector('[data-plan-use-amount]')?.value);
      const sourceTotal = Array.from(row.querySelectorAll('[data-funding-amount]')).reduce((sum, input) => sum + numOr0(input.value), 0);
      const difference = useAmount - sourceTotal;
      const balance = row.querySelector('[data-use-source-balance]');
      if (!balance) return;
      balance.classList.toggle('is-danger', Math.abs(difference) > 0.01);
      balance.textContent = Math.abs(difference) <= 0.01
        ? 'Fuentes equilibradas: 100%.'
        : difference > 0
          ? `Faltan ${financeMoney(difference)} para cubrir este uso (${useAmount ? (sourceTotal / useAmount * 100).toFixed(2) : '0.00'}%).`
          : `Exceso de ${financeMoney(Math.abs(difference))} (${useAmount ? (sourceTotal / useAmount * 100).toFixed(2) : '0.00'}%).`;
    });
    const globalSummary = host.querySelector('[data-plan-global-summary]');
    if (globalSummary) {
      const useRows = uses.map(use => {
        const sourceText = (use.fundingSources || []).filter(source => source.name || source.amount).map(source => {
          const pct = use.amount ? numOr0(source.amount) / use.amount * 100 : 0;
          return `${escapeHtml(source.name || 'Fuente')} ${financeMoney(source.amount)} (${pct.toFixed(2)}%)`;
        }).join(' · ');
        return `<article><div><strong>Uso: ${escapeHtml(use.name || 'Sin nombre')}</strong><span>${financeMoney(use.amount)}</span></div><small>${sourceText || 'Sin fuentes indicadas'}</small></article>`;
      }).join('');
      const globalSourceText = sources.filter(source => source.name || source.amount).map(source => (
        `${escapeHtml(source.name || 'Fuente')} ${financeMoney(source.amount)} (${total ? (numOr0(source.amount) / total * 100).toFixed(2) : '0.00'}%)`
      )).join(' · ');
      const globalDifference = total - sumItems(sources);
      globalSummary.innerHTML = `<h4>Resumen global</h4>${useRows}<article class="finance-plan-global-total"><div><strong>Total de la fase</strong><span>${financeMoney(total)}</span></div><small>${globalSourceText || 'Sin fuentes indicadas'}</small><p class="${Math.abs(globalDifference) > 0.01 ? 'is-danger' : ''}">${Math.abs(globalDifference) <= 0.01 ? 'Fuentes globales equilibradas.' : globalDifference > 0 ? `Faltan ${financeMoney(globalDifference)}.` : `Exceso de ${financeMoney(Math.abs(globalDifference))}.`}</p></article>`;
    }
    const lineDifference = bank - approvedForLines;
    const allocation = host.querySelector('[data-line-allocation]');
    allocation?.classList.toggle('is-danger', lineDifference < -0.01);
    const lineApproved = host.querySelector('[data-line-approved]');
    const lineDifferenceLabel = host.querySelector('[data-line-difference-label]');
    const lineDifferenceValue = host.querySelector('[data-line-difference]');
    if (lineApproved) lineApproved.textContent = financeMoney(bank);
    if (lineDifferenceLabel) lineDifferenceLabel.textContent = lineDifference >= 0 ? 'Pendiente de asignar' : 'Exceso asignado';
    if (lineDifferenceValue) lineDifferenceValue.textContent = financeMoney(Math.abs(lineDifference));
    updateRealComparison();
  };

  const syncEditedFundingField = target => {
    const useRow = target.closest('[data-plan-use], [data-real-use]');
    const sourceRow = target.closest('[data-use-source]');
    if (!useRow) return;
    const useAmount = numOr0(useRow.querySelector('[data-plan-use-amount], [data-real-use-amount]')?.value);
    if (target.matches('[data-plan-use-amount], [data-real-use-amount]')) {
      useRow.querySelectorAll('[data-use-source]').forEach(row => {
        const pct = numOr0(row.querySelector('[data-funding-pct]')?.value);
        const amountInput = row.querySelector('[data-funding-amount]');
        if (amountInput) amountInput.value = formatPanamaNumber(useAmount * pct / 100);
      });
    } else if (sourceRow && target.matches('[data-funding-pct]')) {
      const amountInput = sourceRow.querySelector('[data-funding-amount]');
      if (amountInput) amountInput.value = formatPanamaNumber(useAmount * numOr0(target.value) / 100);
    } else if (sourceRow && target.matches('[data-funding-amount]')) {
      const pctInput = sourceRow.querySelector('[data-funding-pct]');
      if (pctInput) pctInput.value = (useAmount ? numOr0(target.value) / useAmount * 100 : 0).toFixed(2);
    }
  };

  const saveStatus = host.querySelector('[data-phase-save-status]');
  let autosaveTimer = null;
  let dirty = false;
  let requestedSaveVersion = 0;
  let savedVersion = 0;
  let saveQueue = Promise.resolve();
  const setSaveStatus = (label, tone = '') => {
    if (!saveStatus) return;
    saveStatus.textContent = label;
    saveStatus.className = tone ? `is-${tone}` : '';
  };
  const buildPhaseOverviewPayload = () => {
    const planUses = collectPlanUses();
    const planSourcesList = financeAggregateUseSources(planUses);
    const realUses = collectRealUses();
    const realSourcesList = realUses.length
      ? financeAggregateUseSources(realUses)
      : (phase?.sources || []).map(source => ({ ...source }));
    const plannedBuckets = financeSourceBuckets(planSourcesList);
    const planTotal = sumItems(planUses);
    return {
      name: host.querySelector('[data-phase-overview="name"]')?.value.trim() || 'Fase',
      startDate: host.querySelector('[data-phase-overview="startDate"]')?.value,
      endDate: host.querySelector('[data-phase-overview="endDate"]')?.value,
      actualStartDate: host.querySelector('[data-phase-overview="actualStartDate"]')?.value || null,
      actualEndDate: host.querySelector('[data-phase-overview="actualEndDate"]')?.value || null,
      planUses,
      planSources: planSourcesList,
      uses: realUses,
      sources: realSourcesList,
      financialConditions: {
        ...(phase?.financialConditions || {}),
        phaseTotal: planTotal,
        bankFinancedAmount: plannedBuckets.bank,
        bankFinancedPct: planTotal ? plannedBuckets.bank / planTotal * 100 : 0,
        promoterContribution: plannedBuckets.promoter,
        promoterContributionPct: planTotal ? plannedBuckets.promoter / planTotal * 100 : 0
      }
    };
  };
  const persistPhaseOverview = ({ showAlert = false } = {}) => {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    if (!dirty) return saveQueue;
    const payload = buildPhaseOverviewPayload();
    if (!payload.startDate || !payload.endDate) {
      const error = new Error('Las fechas estimadas de inicio y fin son obligatorias.');
      setSaveStatus('Pendiente: faltan fechas', 'error');
      if (showAlert) alert(error.message);
      return Promise.reject(error);
    }
    dirty = false;
    const version = ++requestedSaveVersion;
    setSaveStatus('Guardando...', 'saving');
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      const response = await API.put(`/api/projects/${id}/finance/phases/${phase._id}`, payload);
      if (response?.phase) {
        phase = response.phase;
        const phaseIndex = (FINANCE?.phases || []).findIndex(item => String(item?._id) === String(response.phase._id));
        if (phaseIndex >= 0) FINANCE.phases[phaseIndex] = response.phase;
      }
      if (Array.isArray(response?.loanLines)) {
        FINANCE_ALL_LOAN_LINES = response.loanLines.map(line => ({ ...line }));
        if (FINANCE_CONTROL) FINANCE_CONTROL.loanLines = FINANCE_ALL_LOAN_LINES;
        renderFinanceLoanLines(financeLinesForPhase(response.phase?._id || phase?._id));
        renderFinanceUnitAmortizations();
      }
      savedVersion = Math.max(savedVersion, version);
      if (!dirty && savedVersion === requestedSaveVersion) setSaveStatus('Guardado', 'saved');
      await markProjectDataChanged({ refreshHeader: false });
      return response;
    }).catch(error => {
      dirty = true;
      setSaveStatus('No se pudo guardar', 'error');
      console.error(error);
      if (showAlert) alert(error.message || 'No se pudo guardar la fase.');
      throw error;
    });
    return saveQueue;
  };
  const schedulePhaseAutosave = () => {
    dirty = true;
    setSaveStatus('Cambios pendientes', 'pending');
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      persistPhaseOverview().catch(() => {});
    }, 800);
  };
  FINANCE_PHASE_AUTOSAVE_FLUSH = async () => {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    try { await saveQueue; } catch {}
    if (dirty) await persistPhaseOverview({ showAlert: true });
  };

  host.onclick = async event => {
    const viewButton = event.target.closest('[data-phase-view]');
    if (viewButton) return setPhaseView(viewButton.dataset.phaseView);
    const remove = event.target.closest('[data-remove-budget-row]');
    if (remove) {
      remove.closest('[data-phase-budget-row]')?.remove();
      recalculatePlanSources();
      updateRealComparison();
      schedulePhaseAutosave();
      return;
    }
    const add = event.target.closest('[data-add-budget-row]');
    if (add) {
      const list = host.querySelector(`[data-budget-list="${add.dataset.addBudgetRow}"]`);
      list?.insertAdjacentHTML('beforeend', financePhaseBudgetRows([{ name: '', amount: 0 }], add.dataset.addBudgetRow));
      return;
    }
    const removeUse = event.target.closest('[data-remove-plan-use]');
    if (removeUse) {
      const useRow = removeUse.closest('[data-plan-use], [data-real-use]');
      const isRealUse = useRow?.hasAttribute('data-real-use');
      useRow?.remove();
      if (isRealUse) recalculateRealSources();
      else recalculatePlanSources();
      schedulePhaseAutosave();
      return;
    }
    const removeSource = event.target.closest('[data-remove-use-source]');
    if (removeSource) {
      const useRow = removeSource.closest('[data-plan-use], [data-real-use]');
      removeSource.closest('[data-use-source]')?.remove();
      if (useRow?.hasAttribute('data-real-use')) recalculateRealSources();
      else recalculatePlanSources();
      schedulePhaseAutosave();
      return;
    }
    const addUse = event.target.closest('[data-add-plan-use]');
    if (addUse) {
      host.querySelector('[data-plan-uses-list]')?.insertAdjacentHTML('beforeend', financePhasePlanUseRows([{ name: '', amount: 0, fundingSources: financeDefaultUseSources() }]));
      return recalculatePlanSources();
    }
    const addRealUse = event.target.closest('[data-add-real-use]');
    if (addRealUse) {
      host.querySelector('[data-real-uses-list]')?.insertAdjacentHTML('beforeend', financePhaseRealUseRows([{ name: '', amount: 0, fundingSources: financeDefaultUseSources() }]));
      return recalculateRealSources();
    }
    const addSource = event.target.closest('[data-add-use-source]');
    if (addSource) {
      const useRow = addSource.closest('[data-plan-use], [data-real-use]');
      const useAmount = numOr0(useRow?.querySelector('[data-plan-use-amount], [data-real-use-amount]')?.value);
      useRow?.querySelector('[data-use-sources]')?.insertAdjacentHTML('beforeend', financeUseSourceRow({ name: 'Otra fuente', amount: 0 }, useAmount));
      if (useRow?.hasAttribute('data-real-use')) recalculateRealSources();
      else recalculatePlanSources();
      schedulePhaseAutosave();
      return;
    }
    const copy = event.target.closest('[data-copy-plan-to-real]');
    if (copy) {
      const actualStart = host.querySelector('[data-phase-overview="actualStartDate"]');
      const actualEnd = host.querySelector('[data-phase-overview="actualEndDate"]');
      const existingReal = collectRealUses().length || actualStart?.value || actualEnd?.value;
      if (existingReal && !confirm('Esto reemplazará las fechas, usos y fuentes reales actuales por la estimación. ¿Continuar?')) return;
      const realUses = host.querySelector('[data-real-uses-list]');
      const plannedUses = collectPlanUses();
      if (realUses) realUses.innerHTML = financePhaseRealUseRows(plannedUses.map(({ _id, fundingSources = [], ...item }) => ({
        ...item,
        fundingSources: fundingSources.map(({ _id: sourceId, ...source }) => source)
      })));
      if (actualStart) actualStart.value = host.querySelector('[data-phase-overview="startDate"]')?.value || '';
      if (actualEnd) actualEnd.value = host.querySelector('[data-phase-overview="endDate"]')?.value || '';
      recalculateRealSources();
      setPhaseView('real');
      schedulePhaseAutosave();
      return;
    }
    const save = event.target.closest('[data-save-phase-overview]');
    if (!save) return;
    save.disabled = true;
    try {
      if (!dirty) schedulePhaseAutosave();
      await persistPhaseOverview({ showAlert: true });
    } catch {
      // El estado y el mensaje ya se gestionan en persistPhaseOverview.
    } finally {
      save.disabled = false;
    }
  };
  host.oninput = event => {
    if (event.target.closest('[data-phase-panel="plan"]')) {
      syncEditedFundingField(event.target);
      recalculatePlanSources();
    }
    else if (event.target.closest('[data-phase-panel="real"]')) {
      syncEditedFundingField(event.target);
      recalculateRealSources();
    }
    schedulePhaseAutosave();
  };
  recalculatePlanSources();
  recalculateRealSources();
  setPhaseView(initialView === 'real' ? 'real' : 'plan');
}

async function openFinancePhaseLines(phase, initialView = 'plan', initialTab = 'overview') {
  const existingModal = document.getElementById('financePhaseLinesModal');
  if (existingModal && !existingModal.hidden) {
    if (FINANCE_PHASE_AUTOSAVE_FLUSH) await FINANCE_PHASE_AUTOSAVE_FLUSH();
    await flushFinanceLoanLinesAutosave({ showAlert: true });
    await flushFinanceUnitAutosave({ showAlert: true });
    FINANCE_PHASE_AUTOSAVE_FLUSH = null;
  }
  FINANCE_SELECTED_PHASE_ID = String(phase?._id || '');
  FINANCE_SELECTED_PHASE_NAME = phase?.name || '';
  FINANCE_LOAN_LINES_DIRTY = false;
  FINANCE_UNIT_DIRTY = false;
  setFinanceAutosaveStatus('financeLoanLinesSaveStatus', 'Guardado', 'saved');
  setFinanceAutosaveStatus('financeUnitSaveStatus', 'Guardado', 'saved');
  const modal = mountFinancePhaseModal();
  if (!modal) return;
  const isRealContext = initialView === 'real';
  modal.dataset.phaseContext = isRealContext ? 'real' : 'plan';
  modal.querySelectorAll('[data-finance-phase-tab="lines"], [data-finance-phase-tab="charts"]').forEach(button => {
    button.hidden = !isRealContext;
  });
  const guide = modal.querySelector('.finance-phase-guide');
  if (guide) {
    guide.innerHTML = isRealContext
      ? '<b>Cómo se organiza:</b> el resumen registra la realidad de la fase; las líneas distribuyen el préstamo y los movimientos registran desembolsos, amortizaciones e intereses pagados.'
      : '<b>Cómo se organiza:</b> el resumen conserva la estimación y permite compararla con la realidad. Las líneas, los movimientos y sus gráficas se gestionan únicamente desde la fase real.';
  }
  modal.classList.remove('is-fullscreen');
  modal.style.zoom = '';
  const expand = document.getElementById('financePhaseFullscreenBtn');
  if (expand) { expand.textContent = '⛶'; expand.title = 'Pantalla completa'; }
  document.getElementById('financePhaseModalTitle').textContent = `Gestionar fase — ${FINANCE_SELECTED_PHASE_NAME}`;
  modal.hidden = false;
  document.body.classList.add('finance-modal-open');
  try {
    FINANCE_AVALUATION_CONTEXT = await API.get(`/api/projects/${id}/finance/avaluation-context`);
  } catch (error) {
    console.error('[Finance] informes de avalúo', error);
    FINANCE_AVALUATION_CONTEXT = { hasAssignedAvaluator: true, reports: [], loadError: true };
  }
  const savedLines = financeLinesForPhase(FINANCE_SELECTED_PHASE_ID);
  const lines = financeLoanLinesWithUseSeeds(savedLines, phase);
  FINANCE_LOAN_LINE_EXPANDED = new Set();
  FINANCE_LOAN_LINE_COLLAPSED = new Set();
  const funding = financePhaseFunding(phase);
  const fundingSummary = document.getElementById('financePhaseFundingSummary');
  const approvedBank = financePhaseApprovedBank(phase);
  if (fundingSummary) fundingSummary.innerHTML = [
    ['Aprobado para desembolso', approvedBank],
    ['Total desembolsado', funding.disbursed],
    ['Pendiente por desembolsar', Math.max(0, approvedBank - funding.disbursed)],
    ['Total amortizado', funding.amortized],
    ['Saldo por pagar', funding.debt],
  ].map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${financeMoney(value)}</strong></div>`).join('');
  renderFinancePhaseOverview(phase, lines, initialView);
  renderFinanceLoanLines(lines);
  renderFinanceUnitAmortizations();
  await setFinancePhaseModalTab(isRealContext ? initialTab : 'overview');
  const canEditPhase = ['admin', 'financiero', 'gerencia', 'socios'].includes(myRole);
  if (!canEditPhase) {
    modal.querySelectorAll('input, select, textarea').forEach(control => { control.disabled = true; });
    modal.querySelectorAll('[data-save-phase-overview], [data-copy-plan-to-real], #financeAddLoanLineBtn, [data-finance-add-entry], [data-finance-save-line], [data-finance-remove-line], [data-finance-manual-line], [data-remove-budget-row], [data-add-budget-row]').forEach(control => { control.hidden = true; });
    if (!['admin', 'promoter', 'bank'].includes(myRole)) {
      modal.querySelectorAll('[data-finance-remove-entry]').forEach(control => { control.hidden = true; });
    }
  }
  setTimeout(() => window.Chart?.getChart?.(document.getElementById('financeLoanLinesChart'))?.resize(), 30);
}

async function toggleFinancePhaseCompletion(phase) {
  const reopening = !!phase?.isCompleted;
  if (!confirm(reopening ? `¿Reabrir ${phase.name || 'esta fase'}?` : `¿Marcar ${phase.name || 'esta fase'} como finalizada?`)) return;
  const today = new Date().toISOString().slice(0, 10);
  try {
    await API.put(`/api/projects/${id}/finance/phases/${phase._id}`, reopening ? {
      isCompleted: false, completedAt: null, actualEndDate: null
    } : {
      isCompleted: true,
      completedAt: new Date().toISOString(),
      actualStartDate: phase.actualStartDate || today,
      actualEndDate: phase.actualEndDate || today
    });
    await loadFinance();
    await markProjectDataChanged();
  } catch (e) {
    console.error(e);
    alert('No se pudo actualizar el estado de la fase');
  }
}

function renderUnifiedFinancePhases(phases = []) {
  const wrap = document.getElementById('phasesUnifiedList');
  if (!wrap) return;
  const dateFmt = value => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : '—';
  };
  wrap.innerHTML = (phases || []).map(ph => {
    const planUses = sumItems(ph.planUses);
    const planSources = sumItems(ph.planSources);
    const realUses = sumItems(ph.uses);
    const realSources = sumItems(ph.sources);
    const expected = numOr0(ph.disbExpected);
    const actual = numOr0(ph.disbActual);
    const execution = planUses > 0 ? (realUses / planUses) * 100 : 0;
    const hasReal = !!ph.actualStartDate || !!ph.actualEndDate || realUses > 0 || realSources > 0 || actual > 0;
    const isCompleted = !!ph.isCompleted;
    const status = isCompleted
      ? { label: 'Finalizada', tone: 'ok' }
      : !hasReal
        ? { label: 'Estimación', tone: 'neutral' }
      : getPhaseStatus(ph).key === 'OK' ? { label: 'OK', tone: 'ok' } : { label: 'Desviación', tone: 'error' };
    const planEnd = ph.endDate ? new Date(ph.endDate) : null;
    const realEnd = ph.actualEndDate || ph.completedAt ? new Date(ph.actualEndDate || ph.completedAt) : null;
    const compareDate = realEnd || new Date();
    const dayDelta = planEnd && !Number.isNaN(planEnd.getTime()) ? Math.ceil((compareDate - planEnd) / 86400000) : 0;
    const timingText = isCompleted
      ? (dayDelta > 0 ? `Finalizada con ${dayDelta} día(s) de retraso` : dayDelta < 0 ? `Finalizada ${Math.abs(dayDelta)} día(s) antes` : 'Finalizada en la fecha prevista')
      : !hasReal ? 'Pendiente de iniciar ejecución real'
      : dayDelta > 0 ? `${dayDelta} día(s) de retraso sobre el plan` : `${Math.abs(dayDelta)} día(s) hasta el fin estimado`;
    return `
      <article class="card fin-phase-card finance-unified-phase" data-variant="unified" data-unified-phase="${escapeHtml(ph._id || '')}">
        <div class="fin-phase-head">
          <div class="fin-phase-left">
            <div class="fin-phase-name">${escapeHtml(ph.name || 'Fase')}</div>
            <div class="fin-phase-dates">${dateFmt(ph.startDate)} → ${dateFmt(ph.endDate)}</div>
            <div class="fin-phase-badges"><span class="fin-tag ${status.tone}">${status.label}</span></div>
          </div>
          <div class="fin-phase-actions">
            <button class="fin-btn fin-btn-edit" data-phase-manage>Gestionar fase</button>
            <button class="fin-btn fin-btn-del" data-phase-delete>Eliminar</button>
          </div>
        </div>
        <div class="fin-phase-body">
        <div class="finance-phase-comparison">
          <section class="finance-phase-side is-plan">
            <div class="finance-phase-side-head"><span class="fin-tag neutral">Estimación</span><span>${dateFmt(ph.startDate)} → ${dateFmt(ph.endDate)}</span></div>
            <div class="fin-kpi-grid">
              <div class="fin-kpi"><div class="label">Usos plan</div><div class="value">${fmt(planUses)}</div></div>
              <div class="fin-kpi"><div class="label">Fuentes plan</div><div class="value">${fmt(planSources)}</div></div>
            </div>
          </section>
          <section class="finance-phase-side is-real">
            <div class="finance-phase-side-head"><span class="fin-tag ${isCompleted ? 'ok' : 'neutral'}">Real</span><span>${hasReal ? `${dateFmt(ph.actualStartDate)} → ${isCompleted || ph.actualEndDate ? dateFmt(ph.actualEndDate || ph.completedAt) : 'En curso'}` : 'Sin iniciar'}</span></div>
            <div class="fin-kpi-grid">
              <div class="fin-kpi"><div class="label">Usos real</div><div class="value">${fmt(realUses)}</div></div>
              <div class="fin-kpi"><div class="label">Fuentes real</div><div class="value">${fmt(realSources)}</div></div>
            </div>
          </section>
        </div>
        <div class="fin-line finance-unified-disbursement">
          <div class="label">Desembolso banco</div>
          <div class="small">Esperado: <b>${fmt(expected)}</b> · Real: <b>${fmt(actual)}</b> · Ejecutado: <b>${financePct(actual, expected)}</b></div>
        </div>
        <div class="finance-phase-ratio">Ejecución real vs plan: <b>${execution.toFixed(1)}%</b> · Calendario: <b>${timingText}</b></div>
        <div class="finance-phase-progress"><div style="width:${Math.min(100, Math.max(0, execution))}%"></div></div>
        <div class="finance-unified-actions">
          <button class="btn ${isCompleted ? 'btn-ghost' : 'btn-success'}" data-phase-complete>${isCompleted ? 'Reabrir fase' : 'Marcar finalizada'}</button>
        </div>
        </div>
      </article>`;
  }).join('') || '<div class="small muted">Todavía no hay fases financieras.</div>';

  wrap.querySelectorAll('[data-unified-phase]').forEach(card => {
    const phase = phases.find(item => String(item._id) === String(card.dataset.unifiedPhase));
    card.querySelector('[data-phase-manage]')?.addEventListener('click', () => openFinancePhaseLines(phase));
    card.querySelector('[data-phase-delete]')?.addEventListener('click', async () => {
      if (!phase?._id || !confirm(`¿Eliminar ${phase.name || 'esta fase'}?`)) return;
      try {
        await API.del(`/api/projects/${id}/finance/phases/${phase._id}`);
        await loadFinance();
        await markProjectDataChanged();
      } catch (e) {
        console.error(e);
        alert('No se pudo eliminar la fase');
      }
    });
    card.querySelector('[data-phase-complete]')?.addEventListener('click', () => toggleFinancePhaseCompletion(phase));
  });
}

function renderPhases(phases = []) {
  const canEditFinanceStructure = ['admin', 'bank', 'financiero', 'gerencia', 'socios'].includes(myRole);
  const wrapPlan = document.getElementById('phasesPlanList');
  const wrapReal = document.getElementById('phasesRealList');

  // Fallback compat: si no existen los nuevos contenedores, usa el antiguo
  const wrapLegacy = document.getElementById('phasesList');

  if (!wrapPlan || !wrapReal) {
    // Si aún no has pegado el HTML nuevo, no rompas nada:
    if (!wrapLegacy) return;
    wrapLegacy.innerHTML = '<div class="small muted">⚠️ Faltan contenedores #phasesPlanList y #phasesRealList en el HTML.</div>';
    return;
  }

  wrapPlan.innerHTML = '';
  wrapReal.innerHTML = '';

  const allPlanUses = (phases || []).reduce((a, ph) => a + sumItems(ph?.planUses), 0);
  const allPlanSources = (phases || []).reduce((a, ph) => a + sumItems(ph?.planSources), 0);
  const allRealUses = (phases || []).reduce((a, ph) => a + sumItems(ph?.uses), 0);
  const allRealSources = (phases || []).reduce((a, ph) => a + sumItems(ph?.sources), 0);

  const dateFmt = (d) => {
    if (!d) return '—';
    const dt = (d instanceof Date) ? d : new Date(d);
    return isNaN(dt.getTime()) ? '—' : dt.toISOString().slice(0,10);
  };

  const makeCardShell = ({ variant, ph, titleRight = '' }) => {
    const card = document.createElement('div');
    card.className = 'card fin-phase-card';
    card.dataset.variant = variant; // plan | real

    const st = getPhaseStatus(ph);
    const editLabel = 'Gestionar fase';

    // Tono status solo lo muestro en REAL (para no ensuciar PLAN)
    const statusBadge = (variant === 'real')
      ? (ph?.isCompleted
          ? `<span class="fin-tag ok">Finalizada</span>`
          : (!!ph?.actualStartDate || !!ph?.actualEndDate || sumItems(ph?.uses) > 0 || sumItems(ph?.sources) > 0 || numOr0(ph?.disbActual) > 0) ? `<span class="fin-tag ${st.tone}">${st.label}</span>` : `<span class="fin-tag neutral">Pendiente de iniciar</span>`)
      : `<span class="fin-tag neutral">Estimación</span>`;

    card.innerHTML = `
      <div class="fin-phase-head">
        <div class="fin-phase-left">
          <div class="fin-phase-name">${ph?.name || 'Fase'}</div>
          <div class="fin-phase-dates">${dateFmt(ph?.startDate)} → ${dateFmt(ph?.endDate)}</div>
          <div class="fin-phase-badges">
            ${statusBadge}
          </div>
        </div>

        <div class="fin-phase-actions">
          <button class="fin-btn fin-btn-edit" data-act="edit">${canEditFinanceStructure ? editLabel : 'Ver fase'}</button>
          ${canEditFinanceStructure ? '<button class="fin-btn fin-btn-del" data-act="del">Eliminar</button>' : ''}
        </div>
      </div>

      <div class="fin-phase-body">
        ${titleRight}
      </div>
    `;
    return card;
  };

  (phases || []).forEach(ph => {
    const planUsesTotal = sumItems(ph?.planUses);
    const planSrcsTotal = sumItems(ph?.planSources);
    const realUsesTotal = sumItems(ph?.uses);
    const realSrcsTotal = sumItems(ph?.sources);

    const planUsesShare = financePct(planUsesTotal, allPlanUses);
    const planSourcesShare = financePct(planSrcsTotal, allPlanSources);
    const realUsesExecution = financePct(realUsesTotal, planUsesTotal);
    const realSourcesExecution = financePct(realSrcsTotal, planSrcsTotal);
    const funding = financePhaseFunding(ph);
    const plannedSources = financeSourceBuckets(ph?.planSources || []);
    const approvedBank = financePhaseApprovedBank(ph);
    const disbActual = funding.disbursed;
    const disbursementExecution = financePct(disbActual, approvedBank);

    // -------------------------
    // CARD PLAN (estimación)
    // -------------------------
    const planBody = `
      <div class="fin-kpi-grid">
        <div class="fin-kpi">
          <div class="label">Usos plan</div>
          <div class="value">${fmt(planUsesTotal)}</div>
          <div class="finance-percent-note">${planUsesShare} del plan total</div>
        </div>
        <div class="fin-kpi">
          <div class="label">Fuentes plan</div>
          <div class="value">${fmt(planSrcsTotal)}</div>
          <div class="finance-percent-note">${planSourcesShare} de las fuentes totales</div>
        </div>
      </div>
      <div class="finance-phase-ratio">
        Cobertura fuentes / usos: <b>${financePct(planSrcsTotal, planUsesTotal)}</b>
      </div>
      <div class="finance-phase-funding is-plan">
        <div class="finance-phase-funding-title">Distribución prevista de las fuentes</div>
        <div><span>Banco</span><b>${financeMoney(approvedBank)}</b></div>
        <div><span>Promotor</span><b>${financeMoney(plannedSources.promoter)}</b></div>
        <div><span>Preventas</span><b>${financeMoney(plannedSources.presales)}</b></div>
      </div>
      ${financeRequirementProgressHtml(ph?.requirements, { compact: true })}
      <div class="finance-phase-card-actions"><button class="btn btn-xs" data-act="requirements">Requisitos</button></div>
    `;

    const planCard = makeCardShell({ variant: 'plan', ph, titleRight: planBody });

    // Actions PLAN
    planCard.querySelector('[data-act="edit"]')?.addEventListener('click', () => openFinancePhaseLines(ph, 'plan', 'overview'));
    planCard.querySelector('[data-act="requirements"]')?.addEventListener('click', () => openFinanceRequirements(ph, 'plan'));

    planCard.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
      if (!ph?._id) return alert('Fase inválida');
      if (!confirm('¿Eliminar fase?')) return;
      try {
        await API.del(`/api/projects/${id}/finance/phases/${ph._id}`);
        await loadFinance();
        await markProjectDataChanged();
      } catch (e) {
        console.error(e);
        alert('No se pudo eliminar la fase');
      }
    });

    wrapPlan.appendChild(planCard);

const hasRealData =
  !!ph?.actualStartDate ||
  !!ph?.actualEndDate ||
  (realUsesTotal > 0) ||
  (realSrcsTotal > 0) ||
  (disbActual > 0);

    // -------------------------
    // CARD REAL (ejecución)
    // -------------------------
    const realBody = `
      <div class="finance-real-date-row">
        <span>Fechas plan: <b>${dateFmt(ph?.startDate)} → ${dateFmt(ph?.endDate)}</b></span>
        <span>Fechas real: <b>${ph?.actualStartDate ? dateFmt(ph.actualStartDate) : 'Sin iniciar'} → ${ph?.actualEndDate || ph?.completedAt ? dateFmt(ph.actualEndDate || ph.completedAt) : (hasRealData ? 'En curso' : '—')}</b></span>
      </div>
      <div class="fin-kpi-grid">
        <div class="fin-kpi">
          <div class="label">Usos real</div>
          <div class="value">${fmt(realUsesTotal)}</div>
          <div class="finance-percent-note">${realUsesExecution} ejecutado vs plan</div>
          <div class="finance-phase-progress"><div style="width:${financeProgressWidth(realUsesTotal, planUsesTotal)}%"></div></div>
        </div>
        <div class="fin-kpi">
          <div class="label">Fuentes real</div>
          <div class="value">${fmt(realSrcsTotal)}</div>
          <div class="finance-percent-note">${realSourcesExecution} ejecutado vs plan</div>
          <div class="finance-phase-progress"><div style="width:${financeProgressWidth(realSrcsTotal, planSrcsTotal)}%"></div></div>
        </div>
      </div>

      <div class="finance-phase-ratio">
        Peso en la ejecución total: usos <b>${financePct(realUsesTotal, allRealUses)}</b> · fuentes <b>${financePct(realSrcsTotal, allRealSources)}</b>
      </div>

      <div class="fin-line" style="margin-top:10px;">
        <div class="label">Financiación bancaria</div>
        <div class="row between" style="align-items:center;">
          <div class="small">
            Aprobado: <b>${fmt(approvedBank)}</b> · Desembolsado: <b>${fmt(disbActual)}</b> · Ejecutado: <b>${disbursementExecution}</b>
          </div>
        </div>
        <div class="finance-phase-progress"><div style="width:${financeProgressWidth(disbActual, approvedBank)}%"></div></div>
      </div>
      <div class="finance-phase-funding is-real">
        <div class="finance-phase-funding-title">Banco en esta fase · ${funding.linesCount} ${funding.linesCount === 1 ? 'línea' : 'líneas'}</div>
        <div><span>Desembolsado por líneas</span><b>${financeMoney(funding.disbursed)}</b></div>
        <div><span>Amortizado</span><b>${financeMoney(funding.amortized)}</b></div>
        <div class="is-debt"><span>Saldo por devolver</span><b>${financeMoney(funding.debt)}</b></div>
        <div><span>Pendiente vs recomendación</span><b>${financeMoney(funding.pendingRecommendedDisbursement)}</b></div>
      </div>
      ${financeRequirementProgressHtml(ph?.requirements, { compact: true })}
      <div class="finance-phase-card-actions">
        <button class="btn btn-xs" data-act="requirements">Requisitos</button>
        <button class="btn btn-xs ${ph?.isCompleted ? 'btn-ghost' : 'btn-success'}" data-act="complete">${ph?.isCompleted ? 'Reabrir fase' : 'Marcar finalizada'}</button>
      </div>
    `;

    const realCard = makeCardShell({ variant: 'real', ph, titleRight: realBody });

    // Actions REAL
    realCard.querySelector('[data-act="edit"]')?.addEventListener('click', () => openFinancePhaseLines(ph, 'real', 'overview'));
    realCard.querySelector('[data-act="requirements"]')?.addEventListener('click', () => openFinanceRequirements(ph, 'real'));
    realCard.querySelector('[data-act="complete"]')?.addEventListener('click', () => toggleFinancePhaseCompletion(ph));

    realCard.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
      if (!ph?._id) return alert('Fase inválida');
      if (!confirm('¿Eliminar fase?')) return;
      try {
        await API.del(`/api/projects/${id}/finance/phases/${ph._id}`);
        await loadFinance();
        await markProjectDataChanged();
      } catch (e) {
        console.error(e);
        alert('No se pudo eliminar la fase');
      }
    });

    wrapReal.appendChild(realCard);
  });

  // Mantén el legacy oculto vacío (por si tu CSS/JS lo toca)
  if (wrapLegacy) wrapLegacy.innerHTML = '';
}


// -------------------------
// Modal: crear/editar fase con 4 tablas:
// PLAN usos/fuentes + REAL usos/fuentes + desembolso esperado/real
// (SIMPLIFICADO: quitamos Intereses/Aportes/Preventas para evitar duplicidad)
const FINANCE_PHASE_CONDITION_FORM_FIELDS = [
  ['letterDate','Fecha de carta','date',''],
  ['letterReference','Numero o referencia de carta','input','Carta term sheet BG-2026-015'],
  ['phaseTotal','Total de la fase','number','10000000'],
  ['bankFinancedAmount','Financiacion bancaria','number','250000'],
  ['promoterContribution','Aporte del promotor','number','100000'],
  ['bankFinancedPct','% banco','number','70'],
  ['promoterContributionPct','% promotor','number','30'],
  ['generalConditions','Condiciones generales de la fase','textarea','Facilidad aprobada sujeta a cumplimiento de hitos tecnicos y legales'],
  ['guarantees','Garantias','textarea','Hipoteca, fideicomiso de garantia, cesion de ventas, fianza solidaria'],
  ['insurance','Seguros','textarea','CAR, incendio, cumplimiento, fianza de pago'],
  ['requiredPresales','Preventa requerida','textarea','40% de preventa evidenciada mediante CPP cedida al banco'],
  ['precedentConditions','Condiciones precedentes','textarea','Permisos aprobados, planos aprobados, seguros entregados, garantias constituidas'],
  ['otherRequirements','Detalle de otros requisitos','textarea','Permisos especiales, aprobaciones municipales o condiciones adicionales del banco'],
  ['disbursementConditions','Condiciones de desembolso','textarea','Contra avance certificado por inspector autorizado'],
  ['amortizationConditions','Condiciones de amortizacion/pago','textarea','Intereses y FECI mensuales, capital al vencimiento'],
  ['promoterObligations','Obligaciones del promotor','textarea','Aportes de capital previos a cada desembolso y entrega mensual de reportes'],
  ['covenants','Restricciones/covenants','textarea','No endeudamiento con otros bancos, no cambios accionarios sin autorizacion'],
  ['trustee','Fiduciaria','input','BG Trust, S.A.'],
  ['trustType','Tipo de fideicomiso','input','Fideicomiso de garantia y administracion'],
  ['technicalInspector','Inspector tecnico','input','Inspector autorizado por el banco'],
  ['financialInspector','Inspector financiero','input','Auditor financiero del banco'],
  ['generalObservations','Observaciones generales','textarea','Condiciones sujetas a contrato definitivo y aprobaciones internas']
];

function phaseConditionsFormHtml(conditions = {}) {
  return `<div class="finance-conditions-subgrid">${FINANCE_PHASE_CONDITION_FORM_FIELDS.map(([key, label, type, placeholder]) => {
    const value = key === 'letterDate' ? financeDateInput(conditions[key]) : (conditions[key] || '');
    if (type === 'textarea') return `<label><span>${escapeHtml(label)}</span><textarea class="input" data-phase-condition="${key}" rows="2" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea></label>`;
    if (key === 'interimBank' && window.BankSelect) {
      const known = (window.BANKS_PANAMA || []).some(bank => String(bank).toLowerCase() === String(value).toLowerCase());
      return `<label><span>${escapeHtml(label)}</span><select class="input" data-phase-condition="${key}" data-phase-bank>${window.BankSelect.bankOptionsHtml(value)}</select><input class="input" data-phase-bank-other value="${known ? '' : escapeHtml(value)}" placeholder="Especificar banco" style="display:${value && !known ? '' : 'none'};margin-top:6px;"></label>`;
    }
    return `<label><span>${escapeHtml(label)}</span><input class="input" data-phase-condition="${key}" type="${type}" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}"></label>`;
  }).join('')}</div>`;
}

function phaseFinancierOptionsHtml(banks = [], line = {}) {
  const current = String(line.financierName || '').trim();
  const nonBank = line.financierType === 'other';
  const historical = current && !banks.includes(current) && !nonBank;
  return `<option value=""${!current ? ' selected' : ''}>Por definir</option>${banks.map(bank => `<option value="${escapeHtml(bank)}"${current === bank && !nonBank ? ' selected' : ''}>${escapeHtml(bank)}</option>`).join('')}<option value="__NON_BANK__"${nonBank ? ' selected' : ''}>Otra fuente no bancaria</option>${historical ? `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} (histórico)</option>` : ''}`;
}

let FINANCE_REQUIREMENT_DOCS = [];
let ARCHITECTURAL_PLAN_DOCS = [];
let INSURANCE_UNITS_CACHE = [];

function financeRequirementInputGuidance(title) {
  return `Información solicitada: ${title}. Describe los datos disponibles y adjunta la documentación correspondiente.`;
}

const REQUIREMENT_PROMOTER_FIELDS = [
  ['yearsExperience','Años de experiencia','number'], ['deliveredProjects','Proyectos entregados','number'],
  ['activeProjects','Proyectos activos','number'], ['developedUnits','Unidades desarrolladas','number'],
  ['countries','Países de operación','list'], ['developedVolume','Volumen total desarrollado','number'],
  ['averageProjectTicket','Ticket medio de proyecto','number'], ['bankFinancingExperience','Experiencia con financiación bancaria','yesno'],
  ['banksWorkedWith','Bancos con los que ha trabajado','list'], ['onTimeDeliveryHistory','Historial de entregas a tiempo','text'],
  ['incidentHistory','Historial de incidencias legales o técnicas','text'], ['documentationLevel','Nivel de documentación disponible','doclevel']
];

function requirementMetric(label, value, { money = false, pct = false } = {}) {
  const shown = money ? financeMoney(value || 0) : pct ? `${numOr0(value).toFixed(1)}%` : (value ?? '—');
  return `<div class="requirement-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(shown))}</strong></div>`;
}

function requirementLinesHtml(title, items = []) {
  if (!items.length) return '';
  return `<div class="requirement-structured-section"><strong>${escapeHtml(title)}</strong><div class="requirement-line-list">${items.map(item => `<div><span>${escapeHtml(item.name || 'Partida')}</span><b>${escapeHtml(financeMoney(item.amount || 0))}</b></div>`).join('')}</div></div>`;
}

function legalRowsHtml(rows = [], kind, editable) {
  const source = rows.length ? rows : (editable ? [{}] : []);
  if (!source.length) return '<div class="requirement-empty">Sin datos registrados.</div>';
  return source.map(item => `<div class="requirement-legal-row" data-legal-row="${kind}">
    <input class="input" data-legal-field="name" value="${escapeHtml(item.name || '')}" placeholder="Nombre" ${editable ? '' : 'readonly'}>
    ${kind !== 'shareholder' ? `<input class="input" data-legal-field="cedula" value="${escapeHtml(item.cedula || '')}" placeholder="Identificación" ${editable ? '' : 'readonly'}>` : ''}
    ${kind === 'shareholder' ? `<input class="input" data-legal-field="percentage" type="number" min="0" max="100" value="${escapeHtml(item.percentage ?? '')}" placeholder="%" ${editable ? '' : 'readonly'}>` : kind === 'dignitary' ? `<input class="input" data-legal-field="position" value="${escapeHtml(item.position || '')}" placeholder="Cargo" ${editable ? '' : 'readonly'}>` : ''}
    ${editable ? '<button class="btn btn-ghost btn-xs" type="button" data-remove-legal-row>✕</button>' : ''}
  </div>`).join('');
}

function projectInsurancePolicies() {
  return Array.isArray(state.project?.technicalData?.insurancePolicies) ? state.project.technicalData.insurancePolicies : [];
}

function insuranceUnitReference(unit = {}) {
  return String(unit.code || `${unit.manzana || unit.modelo || ''}-${unit.lote || ''}`).trim();
}

function policyAppliesToUnit(policy = {}, unit = {}) {
  if (policy.appliesToAllUnits !== false) return true;
  const unitId = String(unit._id || '');
  const ref = insuranceUnitReference(unit);
  return (policy.unitIds || []).some(value => String(value) === unitId)
    || (policy.unitRefs || []).some(value => String(value) === ref);
}

function effectivePoliciesForUnit(unit = {}) {
  const applicable = projectInsurancePolicies().filter(policy => policyAppliesToUnit(policy, unit));
  return ['CAR', 'INCENDIO'].flatMap(type => {
    const typed = applicable.filter(policy => String(policy.type).toUpperCase() === type);
    const specific = typed.filter(policy => policy.appliesToAllUnits === false);
    return specific.length ? specific : typed.filter(policy => policy.appliesToAllUnits !== false);
  });
}

function insurancePolicyCardsHtml(policies = [], { showCoverage = true, editable = false } = {}) {
  if (!policies.length) return '<div class="requirement-empty">No hay pólizas CAR/incendio registradas.</div>';
  return `<div style="display:grid;gap:9px;">${policies.map(policy => {
    const docLink = policy.documentId ? `<a class="btn btn-ghost btn-xs js-secure-file" href="#" data-url="${secureDocUrl(policy.documentId)}" data-filename="${escapeHtml(policy.documentName || 'poliza')}" data-action="view">${escapeHtml(policy.documentName || 'Ver documento')}</a>` : '<span class="small muted">Sin documento</span>';
    const ids = (policy.unitIds || []).map(String);
    const refs = [...(policy.unitRefs || []).map(String), ...ids.map(unitId => insuranceUnitReference(INSURANCE_UNITS_CACHE.find(unit => String(unit._id) === unitId) || {}) || unitId)];
    const coverage = policy.appliesToAllUnits !== false ? 'Todas las unidades' : (Array.from(new Set(refs)).join(', ') || 'Sin unidades seleccionadas');
    const actions = editable && policy._id ? `<div class="insurance-policy-card-actions"><button class="btn btn-ghost btn-xs" type="button" data-edit-unit-policy="${escapeHtml(policy._id)}">Editar</button><button class="btn btn-danger btn-xs" type="button" data-delete-unit-policy="${escapeHtml(policy._id)}">Quitar de esta unidad</button></div>` : '';
    return `<div class="insurance-policy-card ${policy.endorsedToBank ? 'is-endorsed' : 'is-not-endorsed'}"><div class="insurance-policy-card-head"><strong>${escapeHtml(policy.type || 'CAR')} · ${escapeHtml(policy.policyNumber || 'Sin número')}</strong><span class="insurance-endorsement ${policy.endorsedToBank ? 'yes' : 'no'}">${policy.endorsedToBank ? '✓ Endosada al banco' : '⚠ No endosada al banco'}</span></div><div class="insurance-policy-card-grid"><div><span>Aseguradora</span><strong>${escapeHtml(policy.insurer || 'No informada')}</strong></div><div><span>Suma asegurada</span><strong>${escapeHtml(formatProjectMoney(policy.insuredAmount || 0))}</strong></div><div><span>Vigencia</span><strong>${escapeHtml(policy.startDate ? String(policy.startDate).slice(0,10) : '—')} → ${escapeHtml(policy.expiryDate ? String(policy.expiryDate).slice(0,10) : '—')}</strong></div><div><span>Banco</span><strong>${escapeHtml(policy.bank || 'No informado')}</strong></div>${showCoverage ? `<div><span>Cobertura</span><strong>${escapeHtml(coverage)}</strong></div>` : ''}<div><span>Documento</span>${docLink}</div></div>${actions}</div>`;
  }).join('')}</div>`;
}

function insurancePolicyUnitOptions(policy = {}, defaultUnitId = '') {
  const selectedIds = new Set((policy.unitIds || []).map(String));
  const selectedRefs = new Set((policy.unitRefs || []).map(String));
  const hasSavedCoverage = selectedIds.size > 0 || selectedRefs.size > 0;
  return INSURANCE_UNITS_CACHE.map(unit => {
    const unitId = String(unit._id || '');
    const ref = insuranceUnitReference(unit);
    const checked = selectedIds.has(unitId) || selectedRefs.has(ref) || (!hasSavedCoverage && defaultUnitId && unitId === String(defaultUnitId));
    return `<label><input type="checkbox" data-policy-unit-id="${escapeHtml(unitId)}" data-policy-unit-ref="${escapeHtml(ref)}" ${checked ? 'checked' : ''}> ${escapeHtml(ref || unitId)}</label>`;
  }).join('') || '<span class="small muted">No hay unidades cargadas.</span>';
}

function insurancePolicyEditorRow(policy = {}, { defaultUnitId = '' } = {}) {
  const appliesAll = defaultUnitId ? false : policy.appliesToAllUnits !== false;
  return `<div class="insurance-policy-row" data-insurance-policy-row data-policy-id="${escapeHtml(policy._id || '')}" data-document-id="${escapeHtml(policy.documentId || '')}" data-document-name="${escapeHtml(policy.documentName || '')}"><button class="btn btn-ghost btn-xs insurance-policy-remove" type="button" data-remove-policy>×</button><label>Tipo<select class="input" data-policy-field="type"><option value="CAR" ${policy.type !== 'INCENDIO' ? 'selected' : ''}>CAR</option><option value="INCENDIO" ${policy.type === 'INCENDIO' ? 'selected' : ''}>Incendio</option></select></label><label>Aseguradora<input class="input" data-policy-field="insurer" value="${escapeHtml(policy.insurer || '')}"></label><label>Nº de póliza<input class="input" data-policy-field="policyNumber" value="${escapeHtml(policy.policyNumber || '')}"></label><label>Suma asegurada<input class="input" data-policy-field="insuredAmount" type="number" min="0" step=".01" value="${escapeHtml(policy.insuredAmount || '')}"></label><label>Fecha de inicio<input class="input" data-policy-field="startDate" type="date" value="${policy.startDate ? String(policy.startDate).slice(0,10) : ''}"></label><label>Fecha de vencimiento<input class="input" data-policy-field="expiryDate" type="date" value="${policy.expiryDate ? String(policy.expiryDate).slice(0,10) : ''}"></label><label>Endosada al banco<select class="input" data-policy-field="endorsedToBank"><option value="false" ${policy.endorsedToBank ? '' : 'selected'}>No</option><option value="true" ${policy.endorsedToBank ? 'selected' : ''}>Sí</option></select></label><label>Banco<input class="input" data-policy-field="bank" value="${escapeHtml(policy.bank || '')}" ${policy.endorsedToBank ? '' : 'disabled'}></label><label class="insurance-policy-wide">Aplicación<select class="input" data-policy-field="appliesToAllUnits"><option value="true" ${appliesAll ? 'selected' : ''}>Todas las unidades</option><option value="false" ${appliesAll ? '' : 'selected'}>Unidades concretas</option></select></label><div class="insurance-policy-wide insurance-policy-units" data-policy-units style="display:${appliesAll ? 'none' : 'grid'}">${insurancePolicyUnitOptions(policy, defaultUnitId)}</div><label class="insurance-policy-wide">Documento<input data-policy-document type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"><span class="small muted" data-policy-document-name>${escapeHtml(policy.documentName || 'Sin documento')}</span></label></div>`;
}

function bindInsurancePolicyEditor(root) {
  root.querySelectorAll('[data-insurance-policy-row]').forEach(row => {
    if (row.dataset.policyBound === '1') return;
    row.dataset.policyBound = '1';
    row.querySelector('[data-remove-policy]')?.addEventListener('click', () => row.remove());
    row.querySelector('[data-policy-field="appliesToAllUnits"]')?.addEventListener('change', event => { row.querySelector('[data-policy-units]').style.display = event.target.value === 'true' ? 'none' : 'grid'; });
    row.querySelector('[data-policy-field="endorsedToBank"]')?.addEventListener('change', event => { const bank = row.querySelector('[data-policy-field="bank"]'); bank.disabled = event.target.value !== 'true'; if (bank.disabled) bank.value = ''; });
    row.querySelector('[data-policy-document]')?.addEventListener('change', event => { row.querySelector('[data-policy-document-name]').textContent = event.target.files?.[0]?.name || row.dataset.documentName || 'Sin documento'; });
  });
}

async function saveInsurancePoliciesFrom(root, { preserveUnrendered = false } = {}) {
  const policies = [];
  for (const row of Array.from(root.querySelectorAll('[data-insurance-policy-row]'))) {
    const get = key => row.querySelector(`[data-policy-field="${key}"]`)?.value || '';
    const appliesToAllUnits = get('appliesToAllUnits') !== 'false';
    const checkedUnits = Array.from(row.querySelectorAll('[data-policy-unit-id]:checked'));
    const policy = { _id:row.dataset.policyId || undefined, type:get('type') || 'CAR', insurer:get('insurer').trim(), policyNumber:get('policyNumber').trim(), insuredAmount:Number(get('insuredAmount') || 0), startDate:get('startDate') || null, expiryDate:get('expiryDate') || null, endorsedToBank:get('endorsedToBank') === 'true', bank:get('bank').trim(), appliesToAllUnits, unitIds:appliesToAllUnits ? [] : checkedUnits.map(input => input.dataset.policyUnitId).filter(Boolean), unitRefs:appliesToAllUnits ? [] : checkedUnits.map(input => input.dataset.policyUnitRef).filter(Boolean), documentId:row.dataset.documentId || null, documentName:row.dataset.documentName || '' };
    if (!appliesToAllUnits && !policy.unitIds.length) throw new Error('Selecciona al menos una unidad para la póliza.');
    if (policy.endorsedToBank && !policy.bank) throw new Error('Indica el banco de la póliza marcada como endosada.');
    const file = row.querySelector('[data-policy-document]')?.files?.[0];
    if (file) {
      const fd = new FormData(); fd.append('files', file); fd.append('projectId', id); fd.append('category', 'insurancePolicy'); fd.append('folder', 'tecnico');
      if (policy.documentId) fd.append('replaces', policy.documentId);
      const uploaded = await API.upload('/api/documents/upload?category=insurancePolicy', fd);
      const document = Array.isArray(uploaded) ? uploaded[0] : uploaded;
      policy.documentId = document?._id || policy.documentId; policy.documentName = document?.originalname || file.name;
    }
    policies.push(policy);
  }
  if (preserveUnrendered) {
    const renderedIds = new Set(policies.map(policy => String(policy._id || '')).filter(Boolean));
    projectInsurancePolicies().forEach(policy => {
      if (!renderedIds.has(String(policy._id || ''))) policies.push(policy);
    });
  }
  const result = await API.put(`/api/projects/${id}/insurance-policies`, { insurancePolicies: policies });
  state.project.technicalData ||= {};
  state.project.technicalData.insurancePolicies = result.insurancePolicies || policies;
  return state.project.technicalData.insurancePolicies;
}

function financeBondValidity(data = {}) {
  const start = String(data.startDate || '').slice(0, 10);
  const expiry = String(data.expiryDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return { status:'MISSING_DATES', label:'Fechas pendientes' };
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const startAt = Date.parse(`${start}T00:00:00Z`);
  const expiryAt = Date.parse(`${expiry}T00:00:00Z`);
  if (expiryAt < today) return { status:'EXPIRED', label:'Vencida' };
  if (startAt > today) return { status:'NOT_STARTED', label:'No iniciada' };
  return { status:'CURRENT', label:'Vigente' };
}

function financeBondValidityMetric(data = {}) {
  return `<div class="requirement-metric"><span>Vigencia</span><strong data-bond-validity-label>${escapeHtml(financeBondValidity(data).label)}</strong></div>`;
}

function financeAddMonthsClamped(dateValue, months) {
  const date = String(dateValue || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const [year, month, day] = date.split('-').map(Number);
  const targetMonth = month - 1 + Math.max(1, Math.round(Number(months) || 1));
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${String(normalizedMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

function financePeriodicFollowUpMeta(data = {}) {
  const nextReviewDate = String(data.nextReviewDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextReviewDate)) return { current:false, due:false, label:'Sin primer documento' };
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const dueAt = Date.parse(`${nextReviewDate}T00:00:00Z`);
  return dueAt > today
    ? { current:true, due:false, label:`Próxima revisión: ${nextReviewDate}` }
    : { current:false, due:true, label:`Revisión pendiente desde ${nextReviewDate}` };
}

function financeStructuredRequirementHtml(item, editable, mode = 'plan') {
  const data = item.structuredData || {};
  if (!data.kind) return '';
  if (data.kind === 'budget') return `<div class="requirement-structured"><div class="requirement-metrics">${requirementMetric('Total del proyecto', data.projectTotal, { money:true })}${requirementMetric('Presupuesto de la fase', data.phaseTotal, { money:true })}</div>${requirementLinesHtml('Usos de la fase', data.uses || [])}</div>`;
  if (data.kind === 'presales') return `<div class="requirement-structured"><div class="requirement-metrics">${requirementMetric('Unidades totales', data.total)}${requirementMetric('Reservadas', data.reserved)}${requirementMetric('Con CPP', data.cpp)}${requirementMetric('Trámite legal', data.legal)}${requirementMetric('Escrituradas', data.deeded)}${requirementMetric('Entregadas', data.delivered)}${requirementMetric('Preventas', data.presales)}${requirementMetric('% preventa actual', data.presalesPct, { pct:true })}${requirementMetric('% preventa requerido', data.requiredPresalesPct ?? 50, { pct:true })}${requirementMetric('Valor asociado', data.saleValue, { money:true })}${requirementMetric('Monto CPP', data.cppAmount, { money:true })}</div></div>`;
  if (data.kind === 'performanceBond') return `<div class="requirement-structured"><div class="requirement-metrics">${requirementMetric('Valor de la fase', data.phaseValue, { money:true })}${requirementMetric('% de fianza requerido', data.requiredPct ?? 50, { pct:true })}${requirementMetric('Importe requerido', data.requiredAmount, { money:true })}${mode === 'real' ? `${requirementMetric('Importe informado', data.actualAmount, { money:true })}${financeBondValidityMetric(data)}` : ''}</div>${mode === 'real' ? `<div class="requirement-profile-grid" style="margin-top:10px;"><label><span>Importe de la fianza</span><input class="input" type="number" min="0" step=".01" data-performance-bond-field="actualAmount" value="${escapeHtml(data.actualAmount || '')}" ${editable ? '' : 'readonly'}></label><label><span>Nº de fianza</span><input class="input" data-performance-bond-field="bondNumber" value="${escapeHtml(data.bondNumber || '')}" ${editable ? '' : 'readonly'}></label><label><span>Entidad emisora</span><input class="input" data-performance-bond-field="issuer" value="${escapeHtml(data.issuer || '')}" ${editable ? '' : 'readonly'}></label><label><span>Fecha de inicio</span><input class="input" type="date" data-performance-bond-field="startDate" value="${escapeHtml(String(data.startDate || '').slice(0,10))}" ${editable ? '' : 'readonly'}></label><label><span>Fecha de vencimiento</span><input class="input" type="date" data-performance-bond-field="expiryDate" value="${escapeHtml(String(data.expiryDate || '').slice(0,10))}" ${editable ? '' : 'readonly'}></label><label><span>Días de antelación para alerta</span><input class="input" type="number" min="0" max="3650" step="1" data-performance-bond-field="alertDaysBefore" value="${escapeHtml(data.alertDaysBefore ?? 30)}" ${editable ? '' : 'readonly'}></label></div>` : ''}</div>`;
  if (data.kind === 'paymentBond') return `<div class="requirement-structured"><div class="requirement-metrics">${requirementMetric('Valor de la fase', data.phaseValue, { money:true })}${requirementMetric('% de fianza de pago requerido', data.requiredPct ?? 25, { pct:true })}${requirementMetric('Importe requerido', data.requiredAmount, { money:true })}${mode === 'real' ? `${requirementMetric('Importe informado', data.actualAmount, { money:true })}${financeBondValidityMetric(data)}` : ''}</div>${mode === 'real' ? `<div class="requirement-profile-grid" style="margin-top:10px;"><label><span>Importe de la fianza de pago</span><input class="input" type="number" min="0" step=".01" data-payment-bond-field="actualAmount" value="${escapeHtml(data.actualAmount || '')}" ${editable ? '' : 'readonly'}></label><label><span>Nº de fianza</span><input class="input" data-payment-bond-field="bondNumber" value="${escapeHtml(data.bondNumber || '')}" ${editable ? '' : 'readonly'}></label><label><span>Entidad emisora</span><input class="input" data-payment-bond-field="issuer" value="${escapeHtml(data.issuer || '')}" ${editable ? '' : 'readonly'}></label><label><span>Fecha de inicio</span><input class="input" type="date" data-payment-bond-field="startDate" value="${escapeHtml(String(data.startDate || '').slice(0,10))}" ${editable ? '' : 'readonly'}></label><label><span>Fecha de vencimiento</span><input class="input" type="date" data-payment-bond-field="expiryDate" value="${escapeHtml(String(data.expiryDate || '').slice(0,10))}" ${editable ? '' : 'readonly'}></label><label><span>Días de antelación para alerta</span><input class="input" type="number" min="0" max="3650" step="1" data-payment-bond-field="alertDaysBefore" value="${escapeHtml(data.alertDaysBefore ?? 30)}" ${editable ? '' : 'readonly'}></label></div>` : ''}</div>`;
  if (data.kind === 'periodicFollowUp') return `<div class="requirement-structured"><div class="requirement-metrics">${requirementMetric('Periodicidad', `${data.periodicityMonths || (item.number === 27 ? 4 : 1)} meses`)}${mode === 'real' ? `${requirementMetric('Último documento', data.lastRecordDate || '—')}<div class="requirement-metric"><span>Seguimiento</span><strong data-follow-up-status-label>${escapeHtml(financePeriodicFollowUpMeta(data).label)}</strong></div>` : ''}</div>${mode === 'real' ? `<div class="requirement-profile-grid" style="margin-top:10px;"><label><span>Periodicidad (meses)</span><input class="input" type="number" min="1" max="120" step="1" data-follow-up-field="periodicityMonths" value="${escapeHtml(data.periodicityMonths || (item.number === 27 ? 4 : 1))}" ${editable ? '' : 'readonly'}></label><label><span>Fecha del nuevo documento</span><input class="input" type="date" data-follow-up-field="lastRecordDate" value="${escapeHtml(String(data.lastRecordDate || '').slice(0,10))}" ${editable ? '' : 'readonly'}></label><label><span>Próxima revisión</span><input class="input" type="date" data-follow-up-field="nextReviewDate" value="${escapeHtml(String(data.nextReviewDate || '').slice(0,10))}" readonly></label></div>` : ''}</div>`;
  if (data.kind === 'experience') return `<div class="requirement-structured" data-promoter-experience data-promoter-id="${escapeHtml(data.promoterId || '')}"><div class="requirement-structured-section"><strong>Experiencia del promotor</strong><div class="requirement-profile-grid">${REQUIREMENT_PROMOTER_FIELDS.map(([key,label,type]) => { const value = Array.isArray(data.promoter?.[key]) ? data.promoter[key].join(', ') : (data.promoter?.[key] ?? ''); const field = type === 'yesno' ? `<select class="input" data-promoter-field="${key}" data-field-type="${type}" ${editable ? '' : 'disabled'}><option value="">No definido</option><option value="Sí" ${value === 'Sí' ? 'selected' : ''}>Sí</option><option value="No" ${value === 'No' ? 'selected' : ''}>No</option></select>` : type === 'doclevel' ? `<select class="input" data-promoter-field="${key}" data-field-type="${type}" ${editable ? '' : 'disabled'}><option value="">No definido</option>${['Baja','Media','Alta'].map(option => `<option value="${option}" ${value === option ? 'selected' : ''}>${option}</option>`).join('')}</select>` : `<input class="input" data-promoter-field="${key}" data-field-type="${type}" ${type === 'number' ? 'type="number" min="0"' : ''} value="${escapeHtml(value)}" ${editable ? '' : 'readonly'}>`; return `<label><span>${escapeHtml(label)}</span>${field}</label>`; }).join('')}</div></div></div>`;
  if (data.kind === 'shareholders') return `<div class="requirement-structured"><div class="requirement-structured-section"><strong>Accionistas</strong><div data-legal-rows="shareholder">${legalRowsHtml(data.shareholders || [], 'shareholder', editable)}</div>${editable ? '<button class="btn btn-ghost btn-xs" type="button" data-add-legal-row="shareholder">+ Accionista</button>' : ''}</div></div>`;
  if (data.kind === 'architecturalPlans') return `<div class="requirement-structured"><div class="requirement-structured-section"><strong>Modelos/tipologías — información actual de Comercial</strong><div class="requirement-model-grid">${(data.models || []).map(model => `<div><strong>${escapeHtml(model.name || 'Modelo')}</strong><span>${escapeHtml(String(model.unitsCount || 0))} unidades · ${escapeHtml(String(model.bedrooms || 0))} rec. · ${escapeHtml(String(model.bathrooms || 0))} baños</span><span>${escapeHtml(String(model.openAreaM2 || 0))} m² abiertos · ${escapeHtml(String(model.closedAreaM2 || 0))} m² cerrados</span></div>`).join('') || '<span class="requirement-empty">Sin modelos informados.</span>'}</div><p class="requirement-context-warning">Las tipologías son solo contexto. No cuentan como planos ni acreditan por sí solas el requisito.</p></div></div>`;
  if (data.kind === 'legalParties') return `<div class="requirement-structured"><div class="requirement-structured-section"><strong>Accionistas e identificación</strong><div data-legal-rows="shareholder-id">${legalRowsHtml(data.shareholders || [], 'shareholder-id', editable)}</div>${editable ? '<button class="btn btn-ghost btn-xs" type="button" data-add-legal-row="shareholder-id">+ Accionista</button>' : ''}</div><div class="requirement-structured-section"><strong>Dignatarios</strong><div data-legal-rows="dignitary">${legalRowsHtml(data.dignitaries || [], 'dignitary', editable)}</div>${editable ? '<button class="btn btn-ghost btn-xs" type="button" data-add-legal-row="dignitary">+ Dignatario</button>' : ''}</div></div>`;
  if (data.kind === 'cashflow') return `<div class="requirement-structured">${requirementLinesHtml('Usos', data.uses || [])}${requirementLinesHtml('Fuentes', data.sources || [])}</div>`;
  if (data.kind === 'schedule') return `<div class="requirement-structured"><div class="requirement-metrics">${requirementMetric('Fase', data.phaseName || '—')}${requirementMetric('Inicio previsto', data.startDate ? String(data.startDate).slice(0,10) : '—')}${requirementMetric('Fin previsto', data.endDate ? String(data.endDate).slice(0,10) : '—')}</div></div>`;
  if (data.kind === 'plans') return `<div class="requirement-structured"><div class="requirement-metrics">${requirementMetric('Anteproyecto', data.preliminaryDesign === true ? 'Informado' : 'No informado')}${requirementMetric('Planos aprobados', data.approvedPlans === true ? 'Sí' : 'No informado')}</div></div>`;
  if (data.kind === 'flag') return `<div class="requirement-structured"><div class="requirement-metrics">${requirementMetric(data.label || 'Estado', data.value ? 'Sí' : 'No')}</div></div>`;
  if (data.kind === 'insurancePolicies') return `<div class="requirement-structured"><div class="requirement-structured-section"><strong>Pólizas aplicables registradas en Datos técnicos</strong>${insurancePolicyCardsHtml(data.policies || projectInsurancePolicies())}</div></div>`;
  const simpleValue = data.technicalInspector ?? data.value ?? (data.exists === true ? 'Sí' : data.exists === false ? 'No' : 'No informado');
  return `<div class="requirement-structured"><div class="requirement-metrics">${requirementMetric('Dato registrado en Bank73', simpleValue || 'No informado')}</div></div>`;
}

function setFinanceRequirementsFullscreen(modal, full) {
  modal.classList.toggle('is-fullscreen', full);
  const button = modal.querySelector('[data-toggle-finance-requirements-fullscreen]');
  if (button) {
    button.textContent = full ? '□' : '⛶';
    button.title = full ? 'Restaurar tamaño' : 'Pantalla completa';
    button.setAttribute('aria-label', button.title);
  }
  const bodyZoom = Number.parseFloat(getComputedStyle(document.body).zoom) || 1;
  modal.style.zoom = full && bodyZoom < 1 ? String(1 / bodyZoom) : '';
}

function ensureFinanceRequirementsModal() {
  let modal = document.getElementById('financeRequirementsModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'financeRequirementsModal';
  modal.className = 'modal-backdrop requirements-modal-backdrop';
  modal.style.display = 'none';
  modal.innerHTML = `<div class="modal requirements-modal">
    <header class="requirements-modal-header">
      <div><div class="requirements-modal-eyebrow" data-finance-requirements-mode></div><h3 data-finance-requirements-title>Requisitos</h3></div>
      <div class="requirements-modal-header-actions"><button class="btn btn-ghost requirements-modal-icon" type="button" data-toggle-finance-requirements-fullscreen aria-label="Pantalla completa" title="Pantalla completa">⛶</button><button class="btn btn-ghost" type="button" data-close-finance-requirements>✕ Cerrar</button></div>
    </header>
    <div class="requirements-copy-toolbar" data-finance-requirements-copy><label>Reutilizar información de <select class="input" data-finance-requirements-source></select></label><button class="btn btn-ghost btn-xs" type="button" data-copy-finance-requirements>Copiar información</button></div>
    <div data-finance-requirements-progress></div>
    <div class="requirements-modal-list" data-finance-requirements-list></div>
    <footer class="requirements-modal-actions" data-finance-requirements-actions><button class="btn" type="button" data-save-finance-requirements>Guardar requisitos</button></footer>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector('[data-close-finance-requirements]').onclick = () => {
    setFinanceRequirementsFullscreen(modal, false);
    modal.style.display = 'none';
  };
  modal.querySelector('[data-toggle-finance-requirements-fullscreen]').onclick = () => {
    setFinanceRequirementsFullscreen(modal, !modal.classList.contains('is-fullscreen'));
  };
  return modal;
}

function updateFinanceRequirementProgressFromModal(modal) {
  const cards = Array.from(modal.querySelectorAll('[data-finance-requirement]'));
  const requirements = cards.map(card => ({
    status: card.querySelector('[data-requirement-status]')?.value
      || (card.querySelector('.requirement-status')?.classList.contains('is-complete') ? 'CUMPLIDO' : 'PENDIENTE')
  }));
  const host = modal.querySelector('[data-finance-requirements-progress]');
  if (host) host.innerHTML = financeRequirementProgressHtml(requirements);
}

function financeRequirementDocsHtml(requirement) {
  const requirementIds = new Set([requirement?._id, ...(requirement?.legacyRequirementIds || [])].map(String).filter(Boolean));
  const docs = Number(requirement?.number) === 4
    ? ARCHITECTURAL_PLAN_DOCS
    : FINANCE_REQUIREMENT_DOCS.filter(doc => requirementIds.has(String(doc.requirementId || '')));
  if (!docs.length) return '<span class="small muted">Sin documentos adjuntos</span>';
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;">${docs.map(doc => `<a class="btn btn-ghost btn-xs js-secure-file" href="#" data-url="${secureDocUrl(doc._id)}" data-filename="${escapeHtml(doc.originalname || 'documento')}" data-action="view">${escapeHtml(doc.originalname || 'Documento')}</a>`).join('')}</div>`;
}

async function openFinanceRequirements(phase, mode = 'plan') {
  const editable = mode === 'real' && ['admin', 'promoter', 'financiero', 'contable', 'gerencia', 'socios'].includes(myRole);
  const modal = ensureFinanceRequirementsModal();
  setFinanceRequirementsFullscreen(modal, false);
  const requirements = Array.isArray(phase?.requirements) ? phase.requirements.map(item => ({ ...item })) : [];
  if (!INSURANCE_UNITS_CACHE.length) {
    try { INSURANCE_UNITS_CACHE = await apiGet(`/api/units?projectId=${id}`); } catch (_) { /* La cobertura global sigue disponible. */ }
  }
  try {
    [FINANCE_REQUIREMENT_DOCS, ARCHITECTURAL_PLAN_DOCS] = await Promise.all([
      API.get(`/api/documents?projectId=${encodeURIComponent(id)}&category=financeRequirement&ts=${Date.now()}`),
      API.get(`/api/documents?projectId=${encodeURIComponent(id)}&category=architecturalPlans&ts=${Date.now()}`)
    ]);
  } catch (_) {
    FINANCE_REQUIREMENT_DOCS = [];
    ARCHITECTURAL_PLAN_DOCS = [];
  }
  modal.dataset.phaseId = String(phase?._id || '');
  modal.dataset.mode = mode;
  modal.querySelector('[data-finance-requirements-mode]').textContent = mode === 'real'
    ? 'REAL · Cumplimiento y evidencias'
    : 'ESTIMACIÓN · Información prevista/exigida';
  modal.querySelector('[data-finance-requirements-title]').textContent = `Requisitos — ${phase?.name || 'Fase'}`;
  modal.querySelector('[data-finance-requirements-actions]').style.display = editable ? '' : 'none';
  const progressHost = modal.querySelector('[data-finance-requirements-progress]');
  if (progressHost) progressHost.innerHTML = financeRequirementProgressHtml(requirements);
  const copyToolbar = modal.querySelector('[data-finance-requirements-copy]');
  const sourceSelect = modal.querySelector('[data-finance-requirements-source]');
  const otherPhases = (FINANCE?.phases || []).filter(item => String(item._id) !== String(phase?._id));
  copyToolbar.style.display = editable && otherPhases.length ? '' : 'none';
  sourceSelect.innerHTML = '<option value="">Selecciona una fase</option>' + otherPhases.map(item => `<option value="${escapeHtml(item._id)}">${escapeHtml(item.name || 'Fase')}</option>`).join('');
  modal.querySelector('[data-finance-requirements-list]').innerHTML = requirements.map(item => {
    const isManual = item.sourceKey !== 'bank73';
    const guidance = financeRequirementInputGuidance(item.title || '');
    const presalesTargetReached = mode === 'real' && Number(item.number) === 20
      && numOr0(item.structuredData?.presalesPct) >= numOr0(item.structuredData?.requiredPresalesPct ?? 50);
    const performanceBondReached = mode === 'real' && Number(item.number) === 25
      && financeBondValidity(item.structuredData).status === 'CURRENT'
      && numOr0(item.structuredData?.actualAmount) >= numOr0(item.structuredData?.requiredAmount)
      && numOr0(item.structuredData?.requiredAmount) > 0;
    const paymentBondReached = mode === 'real' && Number(item.number) === 26
      && financeBondValidity(item.structuredData).status === 'CURRENT'
      && numOr0(item.structuredData?.actualAmount) >= numOr0(item.structuredData?.requiredAmount)
      && numOr0(item.structuredData?.requiredAmount) > 0;
    const bondExpired = mode === 'real' && [25, 26].includes(Number(item.number))
      && financeBondValidity(item.structuredData).status === 'EXPIRED';
    const followUpMeta = mode === 'real' && [27, 29].includes(Number(item.number))
      ? financePeriodicFollowUpMeta(item.structuredData)
      : { current:false, due:false };
    const displayedStatus = bondExpired
      ? 'VENCIDA / PENDIENTE'
      : followUpMeta.due ? 'REVISIÓN PENDIENTE' : (item.status || 'PENDIENTE');
    return `
    <article class="requirement-card${presalesTargetReached || performanceBondReached || paymentBondReached || followUpMeta.current ? ' is-requirement-target-reached' : ''}${bondExpired || followUpMeta.due ? ' is-requirement-expired' : ''}" data-finance-requirement="${escapeHtml(item._id || '')}" data-requirement-number="${item.number}">
      <div class="requirement-card-heading">
        <strong class="requirement-title"><span>${item.number}</span>${escapeHtml(item.title || '')}</strong>
        <span class="requirement-status ${item.status === 'CUMPLIDO' && !bondExpired ? 'is-complete' : 'is-pending'}">${escapeHtml(displayedStatus)}</span>
      </div>
      <div class="requirement-source ${isManual ? 'is-manual' : 'is-bank73'}">${escapeHtml(item.sourceLabel || 'Entrada manual')}</div>
      <div class="requirement-help">${escapeHtml(guidance)}</div>
      ${financeStructuredRequirementHtml(item, editable, mode)}
      ${Number(item.number) === 24 && editable ? `<div class="requirement-structured-section"><strong>Editar pólizas en la fuente de Datos técnicos</strong><div data-requirement-policy-editor>${projectInsurancePolicies().map(policy => insurancePolicyEditorRow(policy)).join('')}</div><button class="btn btn-ghost btn-xs" type="button" data-add-requirement-policy>+ Añadir póliza</button></div>` : ''}
      <label class="requirement-field"><span>${item.number === 2 ? 'Experiencia del contratista' : 'Información manual o adicional'}</span>
        <textarea class="input" rows="3" data-requirement-information placeholder="Introduce información adicional…" ${editable ? '' : 'readonly'}>${escapeHtml(item.manualInformation || (item.sourceKey === 'manual' ? item.information || '' : ''))}</textarea>
      </label>
      ${mode === 'real' ? `<div style="display:grid;grid-template-columns:minmax(180px,260px) 1fr;gap:10px;margin-top:8px;">
        <label>Estado<select class="input" data-requirement-status ${editable && ![25, 26, 27, 29].includes(Number(item.number)) ? '' : 'disabled'}><option value="PENDIENTE" ${item.status !== 'CUMPLIDO' ? 'selected' : ''}>Pendiente</option><option value="CUMPLIDO" ${item.status === 'CUMPLIDO' ? 'selected' : ''}>Cumplido</option></select></label>
        <label>Observaciones<textarea class="input" rows="2" data-requirement-observations ${editable ? '' : 'readonly'}>${escapeHtml(item.observations || '')}</textarea></label>
      </div>` : ''}
      ${Number(item.number) === 24 ? '' : `<div class="requirement-evidence"><strong>${item.number === 4 ? 'Planos compartidos con Datos técnicos' : 'Documentos/evidencias'}</strong>${financeRequirementDocsHtml(item)}</div>`}
      ${editable && Number(item.number) !== 24 ? `<div class="requirement-documents-row"><label class="btn btn-ghost btn-xs requirement-upload-button">${item.number === 4 ? 'Adjuntar planos' : 'Adjuntar documentos'}<input type="file" multiple data-requirement-files ${item.number === 4 ? 'accept=".pdf,.jpg,.jpeg,.png"' : ''}></label><span class="requirement-file-name" data-requirement-file-name>Sin nuevos archivos</span></div>` : ''}
    </article>`;
  }).join('') || '<div class="small muted">No hay requisitos configurados para esta fase.</div>';

  modal.querySelectorAll('[data-requirement-files]').forEach(input => input.addEventListener('change', () => {
    const label = input.closest('[data-finance-requirement]').querySelector('[data-requirement-file-name]');
    const files = Array.from(input.files || []);
    if (label) label.textContent = files.length ? files.map(file => file.name).join(', ') : 'Sin nuevos archivos';
  }));
  modal.querySelectorAll('[data-requirement-status]').forEach(select => {
    select.addEventListener('change', () => {
      const badge = select.closest('[data-finance-requirement]')?.querySelector('.requirement-status');
      const completed = select.value === 'CUMPLIDO';
      if (badge) {
        badge.textContent = completed ? 'CUMPLIDO' : 'PENDIENTE';
        badge.classList.toggle('is-complete', completed);
        badge.classList.toggle('is-pending', !completed);
      }
      updateFinanceRequirementProgressFromModal(modal);
    });
  });
  const syncBondRequirementCard = card => {
    const number = Number(card?.dataset.requirementNumber);
    if (![25, 26].includes(number)) return;
    const prefix = number === 25 ? 'performance' : 'payment';
    const item = requirements.find(requirement => Number(requirement.number) === number);
    const read = field => card.querySelector(`[data-${prefix}-bond-field="${field}"]`)?.value || '';
    const draft = { ...(item?.structuredData || {}), actualAmount:numOr0(read('actualAmount')), startDate:read('startDate'), expiryDate:read('expiryDate') };
    const validity = financeBondValidity(draft);
    const reached = validity.status === 'CURRENT' && numOr0(draft.requiredAmount) > 0 && draft.actualAmount >= numOr0(draft.requiredAmount);
    const expired = validity.status === 'EXPIRED';
    card.classList.toggle('is-requirement-target-reached', reached);
    card.classList.toggle('is-requirement-expired', expired);
    const badge = card.querySelector('.requirement-status');
    if (badge) {
      badge.textContent = expired ? 'VENCIDA / PENDIENTE' : reached ? 'CUMPLIDO' : 'PENDIENTE';
      badge.classList.toggle('is-complete', reached);
      badge.classList.toggle('is-pending', !reached);
    }
    const status = card.querySelector('[data-requirement-status]');
    if (status) status.value = reached ? 'CUMPLIDO' : 'PENDIENTE';
    const validityLabel = card.querySelector('[data-bond-validity-label]');
    if (validityLabel) validityLabel.textContent = validity.label;
    updateFinanceRequirementProgressFromModal(modal);
  };
  modal.querySelectorAll('[data-performance-bond-field], [data-payment-bond-field]').forEach(input => {
    if (['actualAmount', 'startDate', 'expiryDate'].includes(input.getAttribute(input.hasAttribute('data-performance-bond-field') ? 'data-performance-bond-field' : 'data-payment-bond-field'))) {
      input.addEventListener('input', () => syncBondRequirementCard(input.closest('[data-finance-requirement]')));
    }
  });
  const syncPeriodicFollowUpCard = card => {
    if (!card) return;
    const periodicityMonths = Math.max(1, Math.min(120, Math.round(Number(card.querySelector('[data-follow-up-field="periodicityMonths"]')?.value) || (Number(card.dataset.requirementNumber) === 27 ? 4 : 1))));
    const lastRecordDate = card.querySelector('[data-follow-up-field="lastRecordDate"]')?.value || '';
    const nextReviewDate = financeAddMonthsClamped(lastRecordDate, periodicityMonths);
    const nextInput = card.querySelector('[data-follow-up-field="nextReviewDate"]');
    if (nextInput) nextInput.value = nextReviewDate;
    const meta = financePeriodicFollowUpMeta({ nextReviewDate });
    card.classList.toggle('is-requirement-target-reached', meta.current);
    card.classList.toggle('is-requirement-expired', meta.due);
    const label = card.querySelector('[data-follow-up-status-label]');
    if (label) label.textContent = meta.label;
    const badge = card.querySelector('.requirement-status');
    if (badge) {
      badge.textContent = meta.due ? 'REVISIÓN PENDIENTE' : meta.current ? 'CUMPLIDO' : 'PENDIENTE';
      badge.classList.toggle('is-complete', meta.current);
      badge.classList.toggle('is-pending', !meta.current);
    }
    const status = card.querySelector('[data-requirement-status]');
    if (status) status.value = meta.current ? 'CUMPLIDO' : 'PENDIENTE';
    updateFinanceRequirementProgressFromModal(modal);
  };
  modal.querySelectorAll('[data-follow-up-field="periodicityMonths"], [data-follow-up-field="lastRecordDate"]').forEach(input => {
    input.addEventListener('input', () => syncPeriodicFollowUpCard(input.closest('[data-finance-requirement]')));
  });
  bindInsurancePolicyEditor(modal);
  modal.querySelector('[data-add-requirement-policy]')?.addEventListener('click', event => {
    const host = event.currentTarget.parentElement.querySelector('[data-requirement-policy-editor]');
    host.insertAdjacentHTML('beforeend', insurancePolicyEditorRow({}));
    bindInsurancePolicyEditor(host);
  });

  modal.querySelector('[data-copy-finance-requirements]').onclick = () => {
    const sourcePhase = otherPhases.find(item => String(item._id) === String(sourceSelect.value));
    if (!sourcePhase) return alert('Selecciona una fase de origen.');
    const sourceByNumber = new Map((sourcePhase.requirements || []).map(item => [Number(item.number), item]));
    const targetRows = Array.from(modal.querySelectorAll('[data-finance-requirement]'));
    const conflicts = targetRows.some(row => {
      const current = row.querySelector('[data-requirement-information]')?.value.trim() || '';
      const incomingItem = sourceByNumber.get(Number(row.dataset.requirementNumber)) || {};
      const incoming = String(incomingItem.manualInformation || (incomingItem.sourceKey === 'manual' ? incomingItem.information || '' : '')).trim();
      return current && incoming && current !== incoming;
    });
    if (conflicts && !confirm('La fase destino ya contiene información manual. ¿Quieres sobrescribirla con la fase seleccionada?')) return;
    targetRows.forEach(row => {
      const incomingItem = sourceByNumber.get(Number(row.dataset.requirementNumber)) || {};
      const incoming = incomingItem.manualInformation || (incomingItem.sourceKey === 'manual' ? incomingItem.information || '' : '');
      const field = row.querySelector('[data-requirement-information]');
      if (field && (incoming || conflicts)) field.value = incoming;
    });
    alert('Información manual reutilizada. Guarda los requisitos para confirmar los cambios.');
  };

  modal.querySelector('[data-finance-requirements-list]').onclick = event => {
    const remove = event.target.closest('[data-remove-legal-row]');
    if (remove) return remove.closest('[data-legal-row]')?.remove();
    const add = event.target.closest('[data-add-legal-row]');
    if (!add) return;
    const kind = add.dataset.addLegalRow;
    const container = modal.querySelector(`[data-legal-rows="${kind}"]`);
    if (container) container.insertAdjacentHTML('beforeend', legalRowsHtml([{}], kind, true));
  };

  modal.querySelector('[data-save-finance-requirements]').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const rows = Array.from(modal.querySelectorAll('[data-finance-requirement]'));
      if (modal.querySelector('[data-requirement-policy-editor]')) await saveInsurancePoliciesFrom(modal);
      const experienceRow = rows.find(row => Number(row.dataset.requirementNumber) === 2);
      if (experienceRow?.querySelector('[data-promoter-experience]')) {
        const originalPromoter = requirements.find(item => Number(item.number) === 2)?.structuredData?.promoter || {};
        const values = {};
        experienceRow.querySelectorAll('[data-promoter-field]').forEach(input => {
          const type = input.dataset.fieldType;
          values[input.dataset.promoterField] = type === 'number' ? (input.value === '' ? null : Number(input.value)) : type === 'list' ? input.value.split(',').map(value => value.trim()).filter(Boolean) : input.value.trim();
        });
        const overwrites = Object.keys(values).some(key => originalPromoter[key] !== null && originalPromoter[key] !== '' && (!Array.isArray(originalPromoter[key]) || originalPromoter[key].length) && JSON.stringify(values[key]) !== JSON.stringify(originalPromoter[key]));
        if (overwrites && !confirm('Has modificado datos ya existentes del perfil del promotor. ¿Quieres actualizar también el perfil original?')) return;
        if (JSON.stringify(values) !== JSON.stringify(originalPromoter)) await API.put(`/api/projects/${id}/finance/promoter-experience`, { values, base: originalPromoter, allowOverwrite: overwrites });
      }

      const readLegalRows = selector => Array.from(modal.querySelectorAll(selector)).map(row => ({ name: row.querySelector('[data-legal-field="name"]')?.value.trim() || '', cedula: row.querySelector('[data-legal-field="cedula"]')?.value.trim() || '', percentage: Number(row.querySelector('[data-legal-field="percentage"]')?.value || 0), position: row.querySelector('[data-legal-field="position"]')?.value.trim() || '' })).filter(item => item.name || item.cedula || item.percentage || item.position);
      const composition = readLegalRows('[data-requirement-number="3"] [data-legal-row="shareholder"]');
      const identities = readLegalRows('[data-requirement-number="9"] [data-legal-row="shareholder-id"]');
      const shareholders = Array.from({ length: Math.max(composition.length, identities.length) }, (_, index) => ({
        ...(composition[index] || {}),
        name: composition[index]?.name || identities[index]?.name || '',
        cedula: identities[index]?.cedula || composition[index]?.cedula || '',
        percentage: Number(composition[index]?.percentage || 0)
      })).filter(item => item.name || item.cedula || item.percentage);
      const dignitaries = readLegalRows('[data-requirement-number="9"] [data-legal-row="dignitary"]');
      const legalBase = { shareholders: requirements.find(item => Number(item.number) === 3)?.structuredData?.shareholders || [], dignitaries: requirements.find(item => Number(item.number) === 9)?.structuredData?.dignitaries || [] };
      const legalValues = { shareholders, dignitaries };
      if (JSON.stringify(legalValues) !== JSON.stringify(legalBase)) {
        const hasExistingLegal = legalBase.shareholders.length || legalBase.dignitaries.length;
        if (hasExistingLegal && !confirm('Has modificado datos legales ya existentes. ¿Quieres actualizar también los datos legales originales del proyecto?')) return;
        await API.put(`/api/projects/${id}/finance/legal-parties`, { values: legalValues, base: legalBase, allowOverwrite: !!hasExistingLegal });
      }

      const followUpWithoutDate = rows.find(row => [27, 29].includes(Number(row.dataset.requirementNumber))
        && (row.querySelector('[data-requirement-files]')?.files?.length || 0) > 0
        && !row.querySelector('[data-follow-up-field="lastRecordDate"]')?.value);
      if (followUpWithoutDate) {
        followUpWithoutDate.querySelector('[data-follow-up-field="lastRecordDate"]')?.focus();
        alert('Indica la fecha del nuevo documento para calcular la siguiente revisión.');
        return;
      }

      const updated = rows.map(row => {
        const original = requirements.find(item => String(item._id) === String(row.dataset.financeRequirement)) || {};
        const manualInformation = row.querySelector('[data-requirement-information]')?.value.trim() || '';
        const number = Number(row.dataset.requirementNumber);
        const structuredData = number === 25 ? {
          ...(original.structuredData || {}),
          kind: 'performanceBond',
          actualAmount: Math.max(0, Number(row.querySelector('[data-performance-bond-field="actualAmount"]')?.value || 0)),
          bondNumber: row.querySelector('[data-performance-bond-field="bondNumber"]')?.value.trim() || '',
          issuer: row.querySelector('[data-performance-bond-field="issuer"]')?.value.trim() || '',
          startDate: row.querySelector('[data-performance-bond-field="startDate"]')?.value || null,
          expiryDate: row.querySelector('[data-performance-bond-field="expiryDate"]')?.value || null,
          alertDaysBefore: Math.max(0, Math.min(3650, Math.round(Number(row.querySelector('[data-performance-bond-field="alertDaysBefore"]')?.value ?? 30))))
        } : number === 26 ? {
          ...(original.structuredData || {}),
          kind: 'paymentBond',
          actualAmount: Math.max(0, Number(row.querySelector('[data-payment-bond-field="actualAmount"]')?.value || 0)),
          bondNumber: row.querySelector('[data-payment-bond-field="bondNumber"]')?.value.trim() || '',
          issuer: row.querySelector('[data-payment-bond-field="issuer"]')?.value.trim() || '',
          startDate: row.querySelector('[data-payment-bond-field="startDate"]')?.value || null,
          expiryDate: row.querySelector('[data-payment-bond-field="expiryDate"]')?.value || null,
          alertDaysBefore: Math.max(0, Math.min(3650, Math.round(Number(row.querySelector('[data-payment-bond-field="alertDaysBefore"]')?.value ?? 30))))
        } : [27, 29].includes(number) ? {
          ...(original.structuredData || {}),
          kind: 'periodicFollowUp',
          followUpType: number === 27 ? 'engineeringInspection' : 'accountAdvance',
          periodicityMonths: Math.max(1, Math.min(120, Math.round(Number(row.querySelector('[data-follow-up-field="periodicityMonths"]')?.value) || (number === 27 ? 4 : 1)))),
          lastRecordDate: row.querySelector('[data-follow-up-field="lastRecordDate"]')?.value || null,
          nextReviewDate: row.querySelector('[data-follow-up-field="nextReviewDate"]')?.value || null
        } : original.structuredData;
        const automaticStatus = [25, 26].includes(number)
          ? (financeBondValidity(structuredData).status === 'CURRENT' && numOr0(structuredData?.requiredAmount) > 0 && numOr0(structuredData?.actualAmount) >= numOr0(structuredData?.requiredAmount) ? 'CUMPLIDO' : 'PENDIENTE')
          : [27, 29].includes(number)
            ? (financePeriodicFollowUpMeta(structuredData).current ? 'CUMPLIDO' : 'PENDIENTE')
            : null;
        return {
          ...original,
          number,
          ...(structuredData ? { structuredData } : {}),
          manualInformation,
          information: original.information || manualInformation,
          sourceKey: original.structuredData?.kind ? (original.sourceKey || 'bank73') : 'manual',
          sourceLabel: original.structuredData?.kind ? (original.sourceLabel || 'Precargado desde Bank73') : 'Entrada manual',
          status: automaticStatus || row.querySelector('[data-requirement-status]')?.value || original.status || 'PENDIENTE',
          observations: row.querySelector('[data-requirement-observations]')?.value.trim() || ''
        };
      });
      await API.put(`/api/projects/${id}/finance/phases/${phase._id}`, { requirements: updated });
      for (const row of rows) {
        const requirementId = row.dataset.financeRequirement;
        const files = Array.from(row.querySelector('[data-requirement-files]')?.files || []);
        for (const file of files) {
          const fd = new FormData();
          fd.append('files', file);
          fd.append('projectId', id);
          const requirementNumber = Number(row.dataset.requirementNumber);
          if (requirementNumber === 4) {
            fd.append('category', 'architecturalPlans');
            fd.append('folder', 'tecnico');
            await API.upload('/api/documents/upload?category=architecturalPlans', fd);
          } else {
            fd.append('requirementId', requirementId);
            fd.append('financePhaseId', phase._id);
            fd.append('category', 'financeRequirement');
            fd.append('folder', 'financiero');
            await API.upload('/api/documents/upload?category=financeRequirement', fd);
          }
        }
      }
      setFinanceRequirementsFullscreen(modal, false);
      modal.style.display = 'none';
      await loadFinance();
      await markProjectDataChanged();
      await window.refreshProjectExpiryAlerts?.();
    } catch (error) {
      console.error(error);
      alert(error.message || 'No se pudieron guardar los requisitos.');
    } finally {
      button.disabled = false;
    }
  };
  modal.style.display = 'flex';
  await hydrateSecureImages(modal);
}

function phaseFinancingLinesFormHtml(lines = [], financierBanks = []) {
  const safeLines = Array.isArray(lines) && lines.length
    ? lines
    : ['Terreno', 'Infraestructura', 'Construccion', 'Costos directos', 'Costos indirectos', 'Otra'].map(name => ({ name }));
  return `<div id="ph-financing-lines">${safeLines.map(line => `
    <div class="finance-facility-form-row" data-phase-financing-line>
      <label><span>Nombre/facilidad</span><input class="input" data-phase-financing="name" value="${escapeHtml(line.name || '')}" placeholder="Terreno"></label>
      <label><span>Entidad financiadora</span><select class="input" data-phase-financing="financierName">${phaseFinancierOptionsHtml(financierBanks, line)}</select></label>
      <label><span>Monto aprobado</span><input class="input" data-phase-financing="approvedAmount" type="number" step="any" value="${numOr0(line.approvedAmount) || ''}" placeholder="250000"></label>
      <label><span>Tasa de interes</span><input class="input" data-phase-financing="interestRate" value="${escapeHtml(line.interestRate || '')}" placeholder="SOFR + 3.50%"></label>
      <label><span>Plazo</span><input class="input" data-phase-financing="term" value="${escapeHtml(line.term || '')}" placeholder="24 meses"></label>
      <label><span>Forma de pago</span><input class="input" data-phase-financing="paymentMethod" value="${escapeHtml(line.paymentMethod || '')}" placeholder="Intereses y FECI mensuales, capital al vencimiento"></label>
      <label><span>Forma de desembolso</span><input class="input" data-phase-financing="disbursementMethod" value="${escapeHtml(line.disbursementMethod || '')}" placeholder="Contra avance certificado por inspector autorizado"></label>
      <label><span>Comision</span><input class="input" data-phase-financing="commission" value="${escapeHtml(line.commission || '')}" placeholder="1% flat"></label>
      <label><span>Observaciones</span><input class="input" data-phase-financing="observations" value="${escapeHtml(line.observations || '')}" placeholder="Observaciones"></label>
      <button class="btn btn-danger btn-xs" type="button" data-remove-phase-financing>Quitar</button>
    </div>`).join('')}</div><button class="btn btn-ghost btn-xs" type="button" data-add-phase-financing>+ Añadir linea</button>`;
}

function collectPhaseFinancialConditionsFromModal() {
  const out = {};
  document.querySelectorAll('[data-phase-condition]').forEach(input => {
    out[input.dataset.phaseCondition] = input.matches('[data-phase-bank]')
      ? (input.value === '__OTHER__' ? input.parentElement?.querySelector('[data-phase-bank-other]')?.value?.trim() || '' : input.value || '')
      : (input.value?.trim() || '');
  });
  return out;
}

function collectPhaseFinancingLinesFromModal() {
  return Array.from(document.querySelectorAll('[data-phase-financing-line]')).map(row => ({
    name: row.querySelector('[data-phase-financing="name"]')?.value.trim() || '',
    financierName: row.querySelector('[data-phase-financing="financierName"]')?.value === '__NON_BANK__' ? 'Otra fuente no bancaria' : (row.querySelector('[data-phase-financing="financierName"]')?.value.trim() || ''),
    financierType: row.querySelector('[data-phase-financing="financierName"]')?.value === '__NON_BANK__' ? 'other' : 'bank',
    approvedAmount: numOr0(row.querySelector('[data-phase-financing="approvedAmount"]')?.value),
    interestRate: row.querySelector('[data-phase-financing="interestRate"]')?.value.trim() || '',
    term: row.querySelector('[data-phase-financing="term"]')?.value.trim() || '',
    paymentMethod: row.querySelector('[data-phase-financing="paymentMethod"]')?.value.trim() || '',
    disbursementMethod: row.querySelector('[data-phase-financing="disbursementMethod"]')?.value.trim() || '',
    commission: row.querySelector('[data-phase-financing="commission"]')?.value.trim() || '',
    observations: row.querySelector('[data-phase-financing="observations"]')?.value.trim() || ''
  })).filter(item => Object.values(item).some(value => String(value ?? '').trim() !== '' && numOr0(value) !== 0));
}

function openPhaseEditor(ph = null, focus = 'plan') {
  if (!['admin', 'bank', 'financiero', 'gerencia', 'socios'].includes(myRole)) {
    alert('No tienes permiso para editar las fases financieras.');
    return;
  }
  const isEdit = !!ph;
  const hasExistingReal = !!ph?.actualStartDate || !!ph?.actualEndDate || sumItems(ph?.uses) > 0 || sumItems(ph?.sources) > 0 || numOr0(ph?.disbActual) > 0;
  const fundingBasis = financeProjectBasis();

  // Necesario para "Iniciar REAL" sin crear fase nueva:
  const allPhases = (window.FINANCE?.phases || []);

  const tbl = (tableId, rows) => `
    <table class="table" id="${tableId}">
      <thead><tr><th>Partida</th><th class="right">Monto</th><th></th></tr></thead>
      <tbody>
        ${(rows || []).map(r => `
          <tr>
            <td><input class="input" type="text" value="${(r.name||'').replace(/"/g,'&quot;')}" placeholder="Partida"/></td>
            <td class="right"><input class="input amount" type="text" inputmode="decimal" value="${formatPanamaNumber(r.amount)}"/></td>
            <td class="right"><button class="btn btn-ghost btn-xs js-del-row">✕</button></td>
          </tr>
        `).join('')}
      </tbody>
      <tfoot><tr><td>Total</td><td class="right" id="${tableId}-total">0</td><td></td></tr></tfoot>
    </table>
    <button class="btn btn-ghost btn-xs js-add-row" data-target="${tableId}">+ Añadir</button>
  `;

  // Datos base
  const phaseData = {
    name: ph?.name || '',
    startDate: ph ? new Date(ph.startDate).toISOString().slice(0,10) : '',
    endDate:   ph ? new Date(ph.endDate).toISOString().slice(0,10)   : '',
    actualStartDate: ph?.actualStartDate ? new Date(ph.actualStartDate).toISOString().slice(0,10) : '',
    actualEndDate: ph?.actualEndDate ? new Date(ph.actualEndDate).toISOString().slice(0,10) : '',

    planUses: Array.isArray(ph?.planUses) ? ph.planUses.slice() : [],
    planSources: Array.isArray(ph?.planSources) ? ph.planSources.slice() : [],
    financialConditions: ph?.financialConditions || {},
    financierBanks: Array.isArray(ph?.financierBanks) && ph.financierBanks.length
      ? ph.financierBanks.slice()
      : (ph?.financialConditions?.interimBank ? [ph.financialConditions.interimBank] : []),
    financingLines: Array.isArray(ph?.financingLines) ? ph.financingLines.slice() : [],

    uses: Array.isArray(ph?.uses) ? ph.uses.slice() : [],
    sources: Array.isArray(ph?.sources) ? ph.sources.slice() : [],

    alertDaysBefore: Number.isFinite(ph?.alertDaysBefore) ? ph.alertDaysBefore : 15,

    disbExpected: Number(ph?.disbExpected || 0),
    disbActual:   Number(ph?.disbActual || 0),
    disbRequested: !!ph?.disbRequested,
    disbRequestedAt: ph?.disbRequestedAt || null,
  };

  // Título y botón
  const title =
    focus === 'plan'
      ? (isEdit ? 'Editar fase (PLAN)' : 'Nueva fase (PLAN)')
      : (hasExistingReal ? 'Editar fase (REAL)' : 'Iniciar fase (REAL)');

  const cta =
    isEdit ? 'Guardar' : (focus === 'plan' ? 'Crear' : 'Guardar');

  // =========================
  // HTML del modal (SEPARADO)
  // =========================
  const htmlPlan = `
    <div class="grid-2">
      <div>
        <label>Nombre</label>
        <input id="ph-name" class="input" value="${phaseData.name}" placeholder="Fase 1"/>
      </div>
      <div></div>
      <div>
        <label>Inicio</label>
        <input id="ph-start" type="date" class="input" value="${phaseData.startDate}"/>
      </div>
      <div>
        <label>Fin</label>
        <input id="ph-end" type="date" class="input" value="${phaseData.endDate}"/>
      </div>
    </div>

    <div style="margin-top:10px;">
      <label>Alertar X días antes del fin</label>
      <input id="ph-alert" type="number" class="input" value="${phaseData.alertDaysBefore}" min="0"/>
    </div>

    <h4 style="margin-top:14px;">PLAN (estimación) — Usos</h4>
    <div class="finance-phase-editor-recommendation">
      <div>
        <strong>Recomendación según las condiciones del proyecto</strong>
        <span>Se calcula sobre los usos de esta fase y no cambia tus datos automáticamente.</span>
      </div>
      <div><span>Banco (${fundingBasis.bankPct.toFixed(1)}%)</span><b id="ph-recommended-bank">${financeMoney(sumItems(phaseData.planUses) * fundingBasis.bankPct / 100)}</b></div>
      <div><span>Promotor (${fundingBasis.promoterPct.toFixed(1)}%)</span><b id="ph-recommended-promoter">${financeMoney(sumItems(phaseData.planUses) * fundingBasis.promoterPct / 100)}</b></div>
    </div>
    ${tbl('ph-plan-uses', phaseData.planUses)}

    <h4 style="margin-top:12px;">PLAN (estimación) — Fuentes</h4>
    ${tbl('ph-plan-sources', phaseData.planSources)}

    <h4 style="margin-top:14px;">Entidades financiadoras de la fase</h4>
    <label>Bancos financiadores de la fase</label>
    <select id="ph-financier-banks" class="input" multiple size="6"><option value="">Por definir</option>${[...new Set([...(window.BANKS_PANAMA || []), ...phaseData.financierBanks])].map(bank => `<option value="${escapeHtml(bank)}" ${phaseData.financierBanks.includes(bank) ? 'selected' : ''}>${escapeHtml(bank)}</option>`).join('')}</select>
    <p class="small muted">Esta selección es financiera y no crea tenants ni concede acceso al proyecto.</p>

    <h4 style="margin-top:14px;">Lineas de financiacion aprobadas</h4>
    ${phaseFinancingLinesFormHtml(phaseData.financingLines, phaseData.financierBanks)}
  `;

  const htmlReal = `
    ${(!isEdit) ? `
      <div style="margin-bottom:10px;">
        <label>Selecciona una fase del PLAN</label>
        <select id="ph-pick-existing" class="input">
          ${allPhases.map(p => `
            <option value="${p._id}">
              ${p?.name || 'Fase'} (${(p?.startDate||'').slice(0,10)} → ${(p?.endDate||'').slice(0,10)})
            </option>
          `).join('')}
        </select>
        <div class="small muted" style="margin-top:6px;">
          Esto registra ejecución REAL para una fase ya estimada.
        </div>
      </div>
    ` : ''}

    <div class="grid-2 finance-real-dates" style="margin-bottom:10px;">
      <div>
        <label>Inicio real</label>
        <input id="ph-actual-start" type="date" class="input" value="${phaseData.actualStartDate}"/>
      </div>
      <div>
        <label>Fin real</label>
        <input id="ph-actual-end" type="date" class="input" value="${phaseData.actualEndDate}"/>
      </div>
    </div>

    <div style="margin-top:10px;">
      <label>Alertar X días antes del fin</label>
      <input id="ph-alert" type="number" class="input" value="${phaseData.alertDaysBefore}" min="0"/>
    </div>

    <h4 style="margin-top:14px;">REAL (ejecución) — Usos</h4>
    ${tbl('ph-real-uses', phaseData.uses)}

    <h4 style="margin-top:12px;">REAL (ejecución) — Fuentes</h4>
    ${tbl('ph-real-sources', phaseData.sources)}
  `;

  openModal(title, (focus === 'plan') ? htmlPlan : htmlReal, cta, async () => {
    const collect = (tableId) => {
      const tbody = document.querySelector(`#${tableId} tbody`);
      const rows = [];
      tbody?.querySelectorAll('tr')?.forEach(tr => {
        const name = tr.querySelector('input[type="text"]')?.value?.trim();
        const amt  = parsePanamaNumber(tr.querySelector('input.amount')?.value || 0);
        if (name) rows.push({ name, amount: amt });
      });
      return rows;
    };

    // =========================
    // GUARDADO — SEPARADO
    // =========================
    try {
      if (focus === 'plan') {
        // Crear/editar PLAN
        const payload = {
          name: document.getElementById('ph-name').value.trim() || 'Fase',
          startDate: document.getElementById('ph-start').value,
          endDate:   document.getElementById('ph-end').value,
          alertDaysBefore: Number(document.getElementById('ph-alert').value || 15),
          planUses: collect('ph-plan-uses'),
          planSources: collect('ph-plan-sources'),
          financierBanks: Array.from(document.getElementById('ph-financier-banks')?.selectedOptions || []).map(option => option.value).filter(Boolean),
          financialConditions: phaseData.financialConditions,
          financingLines: collectPhaseFinancingLinesFromModal(),
        };

        if (!payload.startDate || !payload.endDate) {
          alert('Inicio y fin son obligatorios');
          return;
        }

        if (isEdit) {
          // solo toca PLAN, no toca REAL
          await API.put(`/api/projects/${id}/finance/phases/${ph._id}`, payload);
        } else {
          await API.post(`/api/projects/${id}/finance/phases`, payload);
        }
      }

      if (focus === 'real') {
        // Editar REAL / iniciar REAL
        const targetId = isEdit
          ? ph._id
          : (document.getElementById('ph-pick-existing')?.value);

        if (!targetId) {
          alert('Selecciona una fase del PLAN');
          return;
        }

const payload = {
  alertDaysBefore: Number(document.getElementById('ph-alert').value || 15),
  actualStartDate: document.getElementById('ph-actual-start')?.value || phaseData.actualStartDate || new Date().toISOString().slice(0, 10),
  actualEndDate: document.getElementById('ph-actual-end')?.value || null,
  uses: collect('ph-real-uses'),
  sources: collect('ph-real-sources'),
  // Los desembolsos se gestionan dentro del modal unificado de la fase.
};

        // solo toca REAL, no toca PLAN
        await API.put(`/api/projects/${id}/finance/phases/${targetId}`, payload);
      }

      modalBackdrop.style.display = 'none';
      await loadFinance();
      await markProjectDataChanged();
    } catch (e) {
      console.error(e);
      alert('No se pudo guardar la fase');
    }
  });

  // =========================
  // Totales y tablas (solo las que existan)
  // =========================
  const recalcTotal = (tableId) => {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;
    const total = [...tbody.querySelectorAll('input.amount')].reduce((a, inp) => a + parsePanamaNumber(inp.value || 0), 0);
    const cell = document.getElementById(`${tableId}-total`);
    if (cell) cell.textContent = formatProjectMoney(total);
    if (tableId === 'ph-plan-uses') {
      const bank = document.getElementById('ph-recommended-bank');
      const promoter = document.getElementById('ph-recommended-promoter');
      if (bank) bank.textContent = financeMoney(total * fundingBasis.bankPct / 100);
      if (promoter) promoter.textContent = financeMoney(total * fundingBasis.promoterPct / 100);
    }
  };

  const hookTable = (tableId) => {
    const box = modalBody;

    box.addEventListener('click', (ev) => {
      const btnAdd = ev.target.closest('.js-add-row');
      const btnDel = ev.target.closest('.js-del-row');

      if (btnAdd && btnAdd.dataset.target === tableId) {
        const tbody = document.querySelector(`#${tableId} tbody`);
        if (!tbody) return;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><input class="input" type="text" placeholder="Partida"/></td>
          <td class="right"><input class="input amount" type="text" inputmode="decimal" value="${formatPanamaNumber(0)}"/></td>
          <td class="right"><button class="btn btn-ghost btn-xs js-del-row">✕</button></td>
        `;
        tbody.appendChild(tr);
        recalcTotal(tableId);
      }

      if (btnDel && btnDel.closest(`#${tableId}`)) {
        btnDel.closest('tr')?.remove();
        recalcTotal(tableId);
      }
    });

    box.addEventListener('input', (ev) => {
      if (ev.target.closest(`#${tableId}`)) recalcTotal(tableId);
    });

    recalcTotal(tableId);
  };

  // Solo engancha las que existan en el modal actual
  modalBody?.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-add-phase-financing]')) {
      document.getElementById('ph-financing-lines')?.insertAdjacentHTML('beforeend', `
        <div class="finance-facility-form-row" data-phase-financing-line>
          <label><span>Nombre/facilidad</span><input class="input" data-phase-financing="name" placeholder="Terreno"></label>
          <label><span>Entidad financiadora</span><select class="input" data-phase-financing="financierName">${phaseFinancierOptionsHtml(Array.from(document.getElementById('ph-financier-banks')?.selectedOptions || []).map(option => option.value).filter(Boolean))}</select></label>
          <label><span>Monto aprobado</span><input class="input" data-phase-financing="approvedAmount" type="number" step="any" placeholder="250000"></label>
          <label><span>Tasa de interes</span><input class="input" data-phase-financing="interestRate" placeholder="SOFR + 3.50%"></label>
          <label><span>Plazo</span><input class="input" data-phase-financing="term" placeholder="24 meses"></label>
          <label><span>Forma de pago</span><input class="input" data-phase-financing="paymentMethod" placeholder="Intereses y FECI mensuales, capital al vencimiento"></label>
          <label><span>Forma de desembolso</span><input class="input" data-phase-financing="disbursementMethod" placeholder="Contra avance certificado por inspector autorizado"></label>
          <label><span>Comision</span><input class="input" data-phase-financing="commission" placeholder="1% flat"></label>
          <label><span>Observaciones</span><input class="input" data-phase-financing="observations" placeholder="Observaciones"></label>
          <button class="btn btn-danger btn-xs" type="button" data-remove-phase-financing>Quitar</button>
        </div>
      `);
    }
    if (ev.target.closest('[data-remove-phase-financing]')) {
      ev.target.closest('[data-phase-financing-line]')?.remove();
    }
  });
  document.getElementById('ph-financier-banks')?.addEventListener('change', event => {
    const banks = Array.from(event.target.selectedOptions || []).map(option => option.value).filter(Boolean);
    document.querySelectorAll('[data-phase-financing="financierName"]').forEach(select => {
      const current = select.value;
      const allowedCurrent = current === '__NON_BANK__' || banks.includes(current) ? current : '';
      select.innerHTML = phaseFinancierOptionsHtml(banks, {
        financierName: allowedCurrent === '__NON_BANK__' ? 'Otra fuente no bancaria' : allowedCurrent,
        financierType: allowedCurrent === '__NON_BANK__' ? 'other' : 'bank'
      });
    });
  });
  modalBody?.querySelectorAll('[data-phase-bank]').forEach(select => {
    if (select.dataset.bankBound) return;
    select.dataset.bankBound = '1';
    select.addEventListener('change', () => {
      const other = select.parentElement?.querySelector('[data-phase-bank-other]');
      if (!other) return;
      other.style.display = select.value === '__OTHER__' ? '' : 'none';
      if (select.value !== '__OTHER__') other.value = '';
    });
    select.dispatchEvent(new Event('change'));
  });
  hookTable('ph-plan-uses');
  hookTable('ph-plan-sources');
  hookTable('ph-real-uses');
  hookTable('ph-real-sources');
}

function normalizeUnitEstadoFrontend(v) {
  const s = String(v || '').trim().toLowerCase();
  const plain = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (s === 'inventory') return 'inventario';
  if (s === 'inventario') return 'inventario';
  if (plain === 'lote libre') return 'disponible';
  if (plain === 'con cpp') return 'con_cpp';
  if (plain === 'tramite legal') return 'tramite_legal_activado';
  if (plain === 'traspasado') return 'escriturado_traspasado';

  if (s === 'en_escrituracion') return 'tramite_legal_activado';
  if (s === 'escriturado') return 'escriturado_traspasado';
  // "Vivienda entregada" ya no es un estado comercial. Los registros
  // históricos entregados se muestran dentro del último estado aprobado.
  if (s === 'entregado' || s === 'vivienda_entregada') return 'escriturado_traspasado';

  return s || 'disponible';
}

// ====== Comercial ======
(function initComercial() {
    // ===== Export helpers (Comercial) =====
  function buildAuthTenantHeaders() {
    let token = '';
    if (window.API && typeof API.getToken === 'function') {
      token = API.getToken() || '';
    } else {
      token =
        localStorage.getItem('token') ||
        localStorage.getItem('jwt') ||
        localStorage.getItem('accessToken') ||
        '';
    }

    const tenantKey =
      localStorage.getItem('tenantKey') ||
      localStorage.getItem('tenant') ||
      '';

    const headers = {};
    if (token) headers['Authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    if (tenantKey) headers['x-tenant-key'] = tenantKey;
    return headers;
  }

  async function downloadFile(url, filename) {
    const headers = buildAuthTenantHeaders();

    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Export falló (${res.status}): ${txt || 'sin detalle'}`);
    }

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
  }

  async function downloadFileWithLoading(btn, url, filename) {
  if (!btn) return;

  const oldText = btn.textContent;
  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.textContent = 'Generando PDF...';

  try {
    await downloadFile(url, filename);
  } catch (e) {
    console.error(e);
    alert(e.message || 'Error generando PDF');
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.textContent = oldText;
  }
}

  const tab = document.getElementById('tab-comercial');
  if (!tab) return;

  // DOM
  const grid = document.getElementById('unitsGrid');
  const kpisDiv = document.getElementById('kpisComercial');
  const filtroEstado = document.getElementById('filtroEstado');
  const buscarInput = document.getElementById('buscarUnidad');
  const btnCrear = document.getElementById('btnCrearLote');
  const btnCrearModelo = document.getElementById('btnCrearModelo');
  const btnExportarCsv = document.getElementById('btnExportarCsv');
  const btnExportarExcel = document.getElementById('btnExportarExcel');
  const btnBatch = document.getElementById('btnEditarSel');
  const btnDel = document.getElementById('btnEliminarSel');
  const btnSelectAll = document.getElementById('btnSelectAll');

  // Modales
  const modalCrear = document.getElementById('modalCrearLote');
  const modalCrearCerrar = document.getElementById('modalCrearCerrar');
  const btnCrearSubmit = document.getElementById('cl-crear');
  const modalCrearModelo = document.getElementById('modalCrearModelo');
  const modalModeloCerrar = document.getElementById('modalModeloCerrar');

  const modalFicha = document.getElementById('fichaUnidadModal');
  const fichaCerrarX = document.getElementById('fichaCerrarX');
  const fichaExpandir = document.getElementById('fichaExpandir');
  const fichaGuardar = document.getElementById('fichaGuardar');

  const modalBatch = document.getElementById('modalBatch');
  const batchCerrar = document.getElementById('batchCerrar');
  const batchAplicar = document.getElementById('batchAplicar');

  const modalDel = document.getElementById('modalDel');
  const delCerrar = document.getElementById('delCerrar');
  const delAplicar = document.getElementById('delAplicar');

  // Las fichas y gestores son compartidos por Comercial y Técnico. Sacarlos del
  // panel evita que el tab inactivo oculte el modal cuando se abre desde Técnico.
  [modalCrear, modalCrearModelo, modalFicha, modalBatch, modalDel].forEach(modal => {
    if (modal && modal.parentElement !== document.body) document.body.appendChild(modal);
  });

  // Helpers API
  function mergedHeaders() {
  // Siempre enviamos token + tenant + content-type
  return { 'Content-Type': 'application/json', ...authHeaders(), ...tenantHeaders() };
}

async function parseJson(res) {
  if (res.status === 204) return {};
  const text = await res.text().catch(() => '');
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

async function apiGet(url) {
  if (API?.get) return API.get(url);
  const res = await fetch(url, { method: 'GET', headers: mergedHeaders() });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return parseJson(res);
}

async function apiPost(url, body) {
  if (API?.post) return API.post(url, body);
  const res = await fetch(url, { method: 'POST', headers: mergedHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return parseJson(res);
}

async function apiPatch(url, body) {
  if (API?.patch) return API.patch(url, body);
  const res = await fetch(url, { method: 'PATCH', headers: mergedHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return parseJson(res);
}

async function apiDelete(url, body) {
  if (API?.delete) return API.delete(url, body);
  const res = await fetch(url, { method: 'DELETE', headers: mergedHeaders(), body: JSON.stringify(body || {}) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return parseJson(res);
}

// === Helper para subir FormData (NO poner Content-Type manual) ===
async function apiUpload(url, formData) {
  // Si tu wrapper global lo soporta
  if (API?.upload) return API.upload(url, formData);

  // Encabezados de auth/tenant, SIN Content-Type
  const headers = { ...authHeaders(), ...tenantHeaders() };
  delete headers['Content-Type'];

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: formData
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  try {
    return await res.json();
  } catch {
    return {};
  }
}

// ===== Helpers UI para ficha comercial (pares label/control) =====
const seccion = (title, html, cls='form-grid-4') => `
  <div class="section">
    <h4><span>${title}</span><button type="button" class="toggle" aria-label="Mostrar/ocultar">▾</button></h4>
    <div class="body ${cls}">${html}</div>
  </div>
`;

// 🔒 Sanea cualquier valor antes de pintarlo en un <input>
function safeVal(x) {
  if (x == null) return '';
  if (typeof x === 'function') return '';     // <- evita "function Object() { [native code] }"
  return String(x);
}

// Cada helper devuelve DOS celdas de grid: <div class="label"> + <input>
const input = (id, label, value='', type='text') =>
  `<div class="label">${label}</div><input id="${id}" type="${type}" value="${safeVal(value)}">`;

const inputDate = (id, label, iso) =>
  `<div class="label">${label}</div><input id="${id}" type="date" value="${iso?String(iso).slice(0,10):''}">`;

const MONEY_FIELD_RE = /precio|valor|monto|ingreso|abono|financiamiento|contrato|mejoras|terreno/i;
const DECIMAL_MEASURE_FIELD_RE = /m2|metros|metraje|area|porcentaje/i;

function parseDecimalMeasureNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  let cleaned = String(value).trim().replace(/\s/g, '');
  if (!cleaned) return 0;

  if (cleaned.includes(',') && !cleaned.includes('.')) {
    cleaned = cleaned.replace(',', '.');
  } else {
    cleaned = cleaned.replace(/,/g, '');
  }

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function numberModeForId(id = '') {
  if (MONEY_FIELD_RE.test(id)) return 'money';
  if (DECIMAL_MEASURE_FIELD_RE.test(id)) return 'decimal';
  return 'integer';
}

function parseInputNumber(id, value) {
  return numberModeForId(id) === 'money'
    ? parsePanamaNumber(value)
    : parseDecimalMeasureNumber(value);
}

function formatInputNumber(id, value) {
  const mode = numberModeForId(id);
  if (mode === 'money') return formatPanamaNumber(value, 2);
  const n = parseDecimalMeasureNumber(value);
  return mode === 'integer' ? String(Math.round(n)) : n.toFixed(2);
}

const inputNum = (id, label, value = 0, opts = {}) => {
  const formatted = opts.decimals !== undefined
    ? formatPanamaNumber(value, opts.decimals)
    : formatInputNumber(id, value);
  return `<div class="label">${label}</div><input id="${id}" type="text" inputmode="decimal" data-number-input value="${formatted}" ${opts.readonly ? 'readonly' : ''}>`;
};

const inputChk = (id, label, on=false) =>
  `<div class="label">${label}</div><input id="${id}" class="chk-box" type="checkbox" ${on?'checked':''}>`;

const selectRow = (id, label, optionsHtml='') =>
  `<div class="label">${label}</div>
   <select id="${id}">
     ${optionsHtml}
   </select>`;

// Lectores seguros para guardar
function vVal(id){ const el = document.getElementById(id); return el ? el.value : undefined; }
function vNum(id){ const raw = vVal(id); if (raw === undefined) return undefined; const v = parseInputNumber(id, raw); return Number.isFinite(v) ? v : null; }
function vDate(id){ const s = vVal(id); if (s === undefined) return undefined; return s ? new Date(s).toISOString() : null; }
function vChk(id){ const el = document.getElementById(id); return el ? !!el.checked : undefined; }
function unitNamePartsFromInput() {
  const input = document.getElementById('fu-nombreUnidad');
  const value = String(input?.value || '').trim();
  const originalManzana = String(input?.dataset.originalManzana || '').trim();
  const originalLote = String(input?.dataset.originalLote || '').trim();
  if (!value) return { manzana: originalManzana, lote: originalLote };
  if (!value.includes('-')) {
    return originalLote && !originalManzana
      ? { manzana: '', lote: value }
      : { manzana: value, lote: '' };
  }
  const loteConPrefijo = value.match(/^(.*?)-(L-.+)$/i);
  if (loteConPrefijo) return { manzana: loteConPrefijo[1].trim(), lote: loteConPrefijo[2].trim() };
  const separator = value.lastIndexOf('-');
  return { manzana: value.slice(0, separator).trim(), lote: value.slice(separator + 1).trim() };
}

function reservationAgeInfo(u = {}, v = {}) {
  if (normalizeUnitEstadoFrontend(u.estado) !== 'reservado') return null;
  if (!v.fechaReserva) return { days: null, label: 'Reserva sin fecha registrada' };

  const reservedAt = new Date(v.fechaReserva);
  if (Number.isNaN(reservedAt.getTime())) return { days: null, label: 'Fecha de reserva no válida' };
  const today = new Date();
  const start = new Date(reservedAt.getFullYear(), reservedAt.getMonth(), reservedAt.getDate());
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.max(0, Math.floor((end - start) / 86400000));
  return { days, label: days === 0 ? 'Reservada hoy' : `Reservada hace ${days} ${days === 1 ? 'día' : 'días'}` };
}

function commercialStageStates(stageValues) {
  const present = value => value !== undefined && value !== null && value !== '' && value !== false;
  const states = stageValues.map((values, index) => {
    const filled = values.filter(present).length;
    const laterStageStarted = stageValues.slice(index + 1).some(nextValues => nextValues.some(present));
    return { filled, complete: filled === values.length || laterStageStarted };
  });
  const currentStageIndex = states.findIndex(state => !state.complete);
  states.forEach((state, index) => {
    state.cls = state.complete ? 'is-complete' : index === currentStageIndex ? 'is-current' : 'is-pending';
    state.label = state.complete ? 'Completa' : index === currentStageIndex ? 'En curso' : 'Pendiente';
  });
  return states;
}

function renderCommercialProcessFicha(u = {}, v = {}) {
  const options = (items, value = '') => {
    const current = String(value || '');
    const known = items.some(item => item.v === current);
    return `${!known && current ? `<option value="${safeVal(current)}" selected>${safeVal(current)}</option>` : ''}${items.map(item =>
      `<option value="${item.v}" ${current === item.v ? 'selected' : ''}>${item.l}</option>`
    ).join('')}`;
  };
  const field = (id, label, value = '', type = 'text', extra = '') => `
    <div class="unit-process-field"><label for="${id}">${label}</label>
    <input id="${id}" type="${type}" value="${safeVal(value)}" ${extra}></div>`;
  const number = (id, label, value = 0, extra = '') => field(id, label, formatInputNumber(id, value), 'text', `inputmode="decimal" data-number-input ${extra}`);
  const dateValue = value => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    const local = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (local) return `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
  };
  const date = (id, label, value) => field(id, label, dateValue(value), 'date');
  const check = (id, label, value) => `<div class="unit-process-field"><label class="unit-process-check" for="${id}"><input id="${id}" type="checkbox" ${value ? 'checked' : ''}><span>${label}</span></label></div>`;
  const select = (id, label, items, value = '') => `<div class="unit-process-field"><label for="${id}">${label}</label><select id="${id}">${options(items, value)}</select></div>`;
  const stage = (num, title, values, body, state) => {
    return `<details class="unit-process-stage ${state.cls}" data-stage-index="${num - 1}" ${state.cls === 'is-current' ? 'open' : ''}><summary>
      <span class="unit-stage-number">${state.cls === 'is-complete' ? '✓' : num}</span>
      <span class="unit-stage-copy"><strong>${title}</strong><small>${state.filled} de ${values.length} campos</small></span>
      <span class="unit-stage-status">${state.label}</span><span class="unit-stage-chevron">⌄</span>
    </summary><div class="unit-stage-body">${body}</div></details>`;
  };
  const profileOpts = [{v:'',l:'—'},{v:'Independiente',l:'Independiente'},{v:'Asalariado',l:'Asalariado'}];
  const companyOpts = [{v:'',l:'—'},{v:'Privada',l:'Privada'},{v:'Gubernamental',l:'Gubernamental'}];
  const sexOpts = [{v:'',l:'—'},{v:'Masculino',l:'Masculino'},{v:'Femenino',l:'Femenino'}];
  const civilOpts = [{v:'',l:'—'},{v:'Soltero',l:'Soltero/a'},{v:'Casado',l:'Casado/a'}];
  const minuteOpts = [{v:'',l:'—'},{v:'Solicitada',l:'Solicitada'},{v:'Lista',l:'Firmada / lista'},{v:'No aplica',l:'No aplica'}];
  const policyTypeOpts = [{v:'',l:'—'},{v:'Endosada',l:'Endosada'},{v:'Colectiva',l:'Colectiva'}];
  const client = second => {
    const composedName = second
      ? [v.cliente2PrimerNombre,v.cliente2SegundoNombre,v.cliente2PrimerApellido,v.cliente2SegundoApellido].filter(Boolean).join(' ')
      : (v.clienteNombre || [v.primerNombre,v.segundoNombre,v.primerApellido,v.segundoApellido].filter(Boolean).join(' '));
    const exists = second && !![composedName,v.cliente2Cedula,v.cliente2Celular,v.cliente2Correo].find(Boolean);
    const phoneId = second
      ? (v.cliente2Celular ? 'fv-cliente2Celular' : 'fv-cliente2TelefonoResidencial')
      : (v.celular ? 'fv-celular' : 'fv-telefonoResidencial');
    const phoneValue = second ? (v.cliente2Celular||v.cliente2TelefonoResidencial) : (v.celular||v.telefonoResidencial);
    return `<details class="unit-side-card" ${!second || exists ? 'open' : ''}><summary><strong>Datos del cliente ${second ? '2' : '1'}</strong>${second ? '<span class="optional-chip">Si aplica</span>' : ''}<span>⌄</span></summary><div class="unit-side-grid">
      ${field(second?'fv-cliente2NombreCompleto':'fv-clienteNombre','Nombre completo',composedName,'text',`readonly aria-readonly="true" data-original="${safeVal(composedName)}" data-persisted="${second || !!v.clienteNombre}"`)}
      ${field(second?'fv-cliente2PrimerNombre':'fv-primerNombre','Primer nombre',second?v.cliente2PrimerNombre:v.primerNombre)}
      ${field(second?'fv-cliente2SegundoNombre':'fv-segundoNombre','Segundo nombre',second?v.cliente2SegundoNombre:v.segundoNombre)}
      ${field(second?'fv-cliente2PrimerApellido':'fv-primerApellido','Apellido paterno',second?v.cliente2PrimerApellido:v.primerApellido)}
      ${field(second?'fv-cliente2SegundoApellido':'fv-segundoApellido','Apellido materno',second?v.cliente2SegundoApellido:v.segundoApellido)}
      ${field(second?'fv-cliente2ApellidoCasada':'fv-apellidoCasada','Apellido de casada',second?v.cliente2ApellidoCasada:v.apellidoCasada)}${field(second?'fv-cliente2Cedula':'fv-cedula','Cédula',second?v.cliente2Cedula:v.cedula)}
      ${select(second?'fv-cliente2Sexo':'fv-sexo','Sexo',sexOpts,second?v.cliente2Sexo:v.sexo)}${select(second?'fv-cliente2EstadoCivil':'fv-estadoCivil','Estado civil',civilOpts,second?v.cliente2EstadoCivil:v.estadoCivil)}
      ${field(phoneId,'Teléfono',phoneValue)}${field(second?'fv-cliente2Correo':'fv-correo','Email',second?v.cliente2Correo:v.correo)}
      ${field(second?'fv-cliente2Direccion':'fv-direccion','Dirección',second?v.cliente2Direccion:v.direccion)}
      ${select(second?'fv-cliente2PerfilCliente':'fv-perfilCliente','Perfil',profileOpts,second?v.cliente2PerfilCliente:v.perfilCliente)}
      ${select(second?'fv-cliente2TipoEmpresa':'fv-tipoEmpresa','Tipo de empresa',companyOpts,second?v.cliente2TipoEmpresa:v.tipoEmpresa)}
      ${field(second?'fv-cliente2Profesion':'fv-profesion','Profesión',second?v.cliente2Profesion:v.profesion)}
      ${number(second?'fv-cliente2IngresoMensual':'fv-ingresoMensual','Ingreso mensual',second?v.cliente2IngresoMensual:v.ingresoMensual)}
      ${field(second?'fv-cliente2AntiguedadLaboral':'fv-antiguedadLaboral','Antigüedad laboral',second?v.cliente2AntiguedadLaboral:v.antiguedadLaboral)}
    </div></details>`;
  };
  const legacyPoliciesDelivered = Boolean(v.polizas);
  const lifePolicyDelivered = v.polizaVidaEntregada === undefined ? legacyPoliciesDelivered : Boolean(v.polizaVidaEntregada);
  const firePolicyDelivered = v.polizaIncendioEntregada === undefined ? legacyPoliciesDelivered : Boolean(v.polizaIncendioEntregada);
  const lifePolicyType = v.tipoPolizaVida || v.tipoPoliza || '';
  const firePolicyType = v.tipoPolizaIncendio || v.tipoPoliza || '';
  const allPoliciesDelivered = lifePolicyDelivered && firePolicyDelivered;
  const stageValues = [
    [v.fechaReserva,v.fechaProforma,v.fechaProbableEntrega,v.cesionAFavorDe,v.estatusCPP],
    [v.numCPP,v.fechaValorCPP,v.fechaVencimientoCPP,v.aperturaCtaBanco,lifePolicyDelivered,lifePolicyType,firePolicyDelivered,firePolicyType,v.fechaContratoCliente,v.montoContrato,u.valorMejoras,u.valorTerreno,v.mLiberacion,v.mSegregacion],
    [v.solicitudAvaluo,v.fechaAvaluo,v.empresaAvaluadora],
    [v.mPrestamo,v.fechaFirma,v.protocoloFirmaCliente,v.protocoloFirmaPromotora,v.protocoloFirmaRLBancoInter,v.firmaProtocoloBancoCliente],
    [v.fechaPagoImpuesto,v.fechaIngresoRP,v.fechaInscripcion],
    [v.fechaDesembolso,v.fechaRecibidoCheque,v.fechaEntregaVivienda]
  ];
  // Si una etapa posterior ya contiene datos, las anteriores se consideran
  // cerradas aunque el histórico no tuviera todos sus campos antiguos.
  const stageStates = commercialStageStates(stageValues);
  const complete = stageStates.filter(state => state.complete).length;
  const reservationAge = reservationAgeInfo(u, v);
  const stages = [
    stage(1,'Reserva',stageValues[0],`${date('fv-fechaReserva','Fecha de reserva',v.fechaReserva)}${date('fv-fechaProforma','Fecha proforma',v.fechaProforma)}${date('fv-fechaProbableEntrega','Fecha probable de entrega',v.fechaProbableEntrega)}${field('fv-cesionAFavorDe','Cesión a favor de',v.cesionAFavorDe)}${select('fv-estatusCPP','Estatus de CPP',[{v:'',l:'—'},{v:'Documentación entregada',l:'Documentación entregada'},{v:'En comité',l:'En comité'},{v:'Aprobado',l:'Aprobado'},{v:'CPP recibida',l:'CPP recibida'}],v.estatusCPP)}`,stageStates[0]),
    stage(2,'Carta promesa de pago y contrato',stageValues[1],`<h4>Carta promesa de pago</h4>${field('fv-numCPP','No. de CPP',v.numCPP)}${date('fv-fechaValorCPP','Fecha de CPP',v.fechaValorCPP)}${date('fv-fechaVencimientoCPP','Vencimiento de CPP',v.fechaVencimientoCPP)}${check('fv-aperturaCtaBanco','Apertura de cuenta en banco',v.aperturaCtaBanco)}<h4>Pólizas</h4>${check('fv-polizaVidaEntregada','Póliza de vida entregada',lifePolicyDelivered)}${select('fv-tipoPolizaVida','Modalidad de póliza de vida',policyTypeOpts,lifePolicyType)}${check('fv-polizaIncendioEntregada','Póliza de incendio entregada',firePolicyDelivered)}${select('fv-tipoPolizaIncendio','Modalidad de póliza de incendio',policyTypeOpts,firePolicyType)}<div class="unit-process-field is-wide"><label class="unit-process-check unit-policy-summary" for="fv-polizas"><input id="fv-polizas" type="checkbox" ${allPoliciesDelivered ? 'checked' : ''} disabled aria-readonly="true"><span>Pólizas entregadas <small>Se marca automáticamente al recibir ambas</small></span></label></div><h4>Contrato</h4>${date('fv-fechaContratoCliente','Fecha de contrato',v.fechaContratoCliente)}${number('fv-montoContrato','Monto de contrato',v.montoContrato)}${number('fv-valorMejoras','Valor mejoras',u.valorMejoras||v.valorMejoras)}${number('fv-valorTerreno','Valor terreno',u.valorTerreno||v.valorTerreno)}<h4>Minutas</h4>${select('fv-mLiberacion','Minuta de liberación / desafectación',minuteOpts,v.mLiberacion)}${select('fv-mSegregacion','Minuta de segregación / venta',minuteOpts,v.mSegregacion)}`,stageStates[1]),
    stage(3,'Avalúo',stageValues[2],`${date('fv-solicitudAvaluo','Solicitud avalúo (fecha)',v.solicitudAvaluo)}${date('fv-fechaAvaluo','Avalúo (fecha)',v.fechaAvaluo)}${field('fv-empresaAvaluadora','Empresa avaluadora',v.empresaAvaluadora)}`,stageStates[2]),
    stage(4,'Protocolo / Escrituras',stageValues[3],`${select('fv-mPrestamo','Minuta préstamo / hipoteca',minuteOpts,v.mPrestamo)}${date('fv-fechaFirma','Fecha de escritura',v.fechaFirma)}${check('fv-protocoloFirmaCliente','Firmado por cliente',v.protocoloFirmaCliente)}${check('fv-protocoloFirmaPromotora','Firmado por promotor',v.protocoloFirmaPromotora)}${check('fv-protocoloFirmaRLBancoInter','Firmado por banco interino',v.protocoloFirmaRLBancoInter)}${check('fv-firmaProtocoloBancoCliente','Firmado por banco del cliente',v.firmaProtocoloBancoCliente)}`,stageStates[3]),
    stage(5,'Cierre notarial / Registro Público',stageValues[4],`${date('fv-fechaPagoImpuesto','Fecha de pago de impuestos',v.fechaPagoImpuesto)}${date('fv-fechaIngresoRP','Ingreso al Registro Público',v.fechaIngresoRP)}${date('fv-fechaInscripcion','Fecha de inscripción',v.fechaInscripcion)}`,stageStates[4]),
    stage(6,'Desembolso y entrega',stageValues[5],`${date('fv-fechaDesembolso','Fecha de desembolso',v.fechaDesembolso)}${date('fv-fechaRecibidoCheque','Fecha de cheque de desembolso',v.fechaRecibidoCheque)}${date('fv-fechaEntregaVivienda','Fecha de entrega de vivienda',v.fechaEntregaVivienda)}${!v.fechaEmisionPermisoOcupacion?'<div class="unit-stage-warning">Falta el permiso de ocupación. Es un aviso y no bloquea este paso.</div>':''}`,stageStates[5])
  ].join('');
  const captureChannel = v.captadoAtencionOficina ? 'Atención en oficina'
    : v.captadoMailInternet ? 'Mail / internet'
      : v.captadoEnProyecto ? 'En proyecto'
        : v.captadoMercadeoProspecto ? 'Mercadeo / prospecto' : '';
  const price = Number(v.precioVenta || 0);
  const cpp = Number(v.montoFinanciamientoCPP || 0);
  const financingPct = price > 0 ? (cpp / price) * 100 : 0;
  const statusKey = normalizeUnitEstadoFrontend(u.estado);
  const cppStatus = String(v.estatusCPP || '').trim();
  const cppTone = /aprob|recibid/i.test(cppStatus) ? 'is-positive' : /venc|rechaz/i.test(cppStatus) ? 'is-danger' : 'is-neutral';
  return `<div class="unit-process-shell unit-status-${statusKey}">
  <div class="unit-process-summary">
    <section class="unit-summary-card is-money"><span>Precio de venta</span>${number('fv-precioVenta','',price)}<small>Dato comercial único</small></section>
    <section class="unit-summary-card is-money"><span>Monto CPP</span>${number('fv-montoFinanciamientoCPP','',cpp)}<small id="fichaFinancingPctValue">${financingPct.toFixed(1)} % de financiación</small></section>
    <section class="unit-summary-card"><span>Banco del cliente</span><div class="bank-select-field">${window.BankSelect?.bankSelectHtml?.('fv-banco',v.banco||'')||`<input id="fv-banco" type="text" value="${safeVal(v.banco||'')}">`}</div><small>Entidad que financia</small></section>
    <section class="unit-summary-card"><span>Estatus de CPP</span><strong id="fichaCppStatusValue" class="unit-summary-status ${cppTone}">${safeVal(cppStatus || 'Sin definir')}</strong><small id="fichaCppExpiryValue">${v.fechaVencimientoCPP ? `Vence el ${safeVal(dateValue(v.fechaVencimientoCPP).split('-').reverse().join('/'))}` : 'Sin vencimiento registrado'}</small></section>
    <input id="fv-abonoInicial" type="hidden" value="${safeVal(v.abonoInicial || Math.max(price-cpp,0))}">
    <input id="fv-porcentajeFinanciamiento" type="hidden" value="${safeVal(financingPct)}">
  </div><div class="unit-process-layout">
    <aside class="unit-process-left"><details class="unit-side-card" open><summary><strong>Datos de la unidad</strong><span>⌄</span></summary><div class="unit-side-grid">
      ${field('fu-etapa','Etapa',u.etapa)}${field('fu-torre','Torre',u.torre)}${field('fu-nivel','Nivel',u.nivel)}<div class="unit-process-field"><label for="fu-modeloSelect">Modelo de vivienda</label><select id="fu-modeloSelect">${projectModelOptions(u.modelId||u.modelo||'',{includeEmpty:true})}</select><input id="fu-modelo" type="hidden" value="${safeVal(u.modelo||'')}"></div>${number('fu-m2','Área de terreno',u.m2)}${field('fv-numeroFinca','Número de finca',u.numeroFinca)}${field('fv-codigoUbicacion','Código de ubicación',u.codigoUbicacion)}${field('fv-calle','Calle',u.calle)}${number('fv-areaAbierta','Área abierta',u.areaAbierta)}${number('fv-areaCerrada','Área cerrada',u.areaCerrada)}${number('fv-areaTotalConstruccion','Área total de construcción',Number(u.areaTotalConstruccion||0)||Number(u.areaAbierta||0)+Number(u.areaCerrada||0),'readonly aria-readonly="true"')}${number('fv-recamaras','Recámaras',u.recamaras)}${number('fv-banos','Baños',u.banos)}<input id="fu-costo" type="hidden" value="${safeVal(u.costoUnidad||0)}">
    </div></details><details class="unit-side-card construction-card" open><summary><strong>Construcción de la vivienda</strong><span class="parallel-chip">En paralelo</span><span>⌄</span></summary><div class="unit-side-grid">
      ${number('fv-avanceConstruccionPct','Avance de obra (%)',v.avanceConstruccionPct||0)}${select('fv-estatusConstruccion','Fase de obra',[{v:'',l:'Pendiente de construir'},{v:'Obra gris',l:'Obra gris'},{v:'Acabados',l:'Acabados'},{v:'Terminada',l:'Terminada'}],v.estatusConstruccion)}${check('fv-permisoConstruccionMunicipal','Permiso de construcción',v.permisoConstruccionMunicipal)}${field('fv-permisoConstruccionNum','Resolución construcción',v.permisoConstruccionNum)}${date('fv-permisoConstruccionVencimiento','Vencimiento construcción',v.permisoConstruccionVencimiento)}${check('fv-permisoOcupacion','Permiso de ocupación',v.permisoOcupacion)}${field('fv-permisoOcupacionNum','Resolución ocupación',v.permisoOcupacionNum)}${date('fv-fechaEmisionPermisoOcupacion','Fecha permiso ocupación',v.fechaEmisionPermisoOcupacion)}${field('fv-constructora','Constructora / contratista',v.constructora)}
    </div></details></aside>
    <main class="unit-process-main"><section class="unit-process-heading"><div><h2>Proceso de venta</h2><span>${complete} de 6 etapas completas</span></div>${reservationAge ? `<strong class="unit-reservation-age">${safeVal(reservationAge.label)}</strong>` : ''}<div class="unit-process-progress"><i style="width:${Math.round(complete/6*100)}%"></i></div></section><div class="unit-stages">${stages}</div><section class="unit-comments"><h3>Comentarios</h3><textarea id="fv-comentario" rows="3" placeholder="Añade información útil para el seguimiento">${safeVal(v.comentario)}</textarea></section></main>
    <aside class="unit-process-right">${client(false)}${client(true)}<details class="unit-side-card" open><summary><strong>Referencias personales</strong><span>⌄</span></summary><div class="unit-side-grid">${field('fv-referencia1Nombre','Referencia 1',v.referencia1Nombre)}${field('fv-referencia1Relacion','Relación',v.referencia1Relacion)}${field('fv-referencia1Telefono','Teléfono',v.referencia1Telefono)}${field('fv-referencia2Nombre','Referencia 2',v.referencia2Nombre)}${field('fv-referencia2Relacion','Relación',v.referencia2Relacion)}${field('fv-referencia2Telefono','Teléfono',v.referencia2Telefono)}${select('fv-canalCaptacion','Captación del cliente',[{v:'',l:'—'},{v:'Atención en oficina',l:'Atención en oficina'},{v:'Mail / internet',l:'Mail / internet'},{v:'En proyecto',l:'En proyecto'},{v:'Mercadeo / prospecto',l:'Mercadeo / prospecto'}],captureChannel)}</div></details></aside>
  </div></div>`;
}

function renderTechnicalUnitFicha(u = {}, v = {}, unitId = '') {
  const options = (items, value = '') => {
    const current = String(value || '');
    const known = items.some(item => item.v === current);
    return `${!known && current ? `<option value="${safeVal(current)}" selected>${safeVal(current)}</option>` : ''}${items.map(item =>
      `<option value="${item.v}" ${current === item.v ? 'selected' : ''}>${item.l}</option>`
    ).join('')}`;
  };
  const field = (id, label, value = '', type = 'text', extra = '') => `
    <div class="unit-process-field"><label for="${id}">${label}</label>
    <input id="${id}" type="${type}" value="${safeVal(value)}" ${extra}></div>`;
  const number = (id, label, value = 0, extra = '') => field(id, label, formatInputNumber(id, value), 'text', `inputmode="decimal" data-number-input ${extra}`);
  const dateValue = value => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
  };
  const date = (id, label, value) => field(id, label, dateValue(value), 'date');
  const check = (id, label, value) => `<div class="unit-process-field"><label class="unit-process-check" for="${id}"><input id="${id}" type="checkbox" ${value ? 'checked' : ''}><span>${label}</span></label></div>`;
  const select = (id, label, items, value = '') => `<div class="unit-process-field"><label for="${id}">${label}</label><select id="${id}">${options(items, value)}</select></div>`;
  const informed = values => values.filter(value => value !== null && value !== undefined && String(value).trim() !== '' && Number(value) !== 0).length;
  const unitValues = [u.etapa,u.torre,u.nivel,u.modelId||u.modelo,u.m2,u.numeroFinca,u.codigoUbicacion,u.calle,u.areaAbierta,u.areaCerrada,u.recamaras,u.banos];
  const constructionValues = [v.avanceConstruccionPct,v.estatusConstruccion,v.permisoConstruccionMunicipal,v.permisoConstruccionNum,v.permisoConstruccionVencimiento,v.permisoOcupacion,v.permisoOcupacionNum,v.fechaEmisionPermisoOcupacion,v.constructora];
  const policies = effectivePoliciesForUnit(u);
  const statusKey = normalizeUnitEstadoFrontend(u.estado);
  const phase = v.estatusConstruccion || 'Pendiente de construir';
  const progress = Math.min(100, Math.max(0, Number(v.avanceConstruccionPct || 0)));

  return `<div class="unit-process-shell technical-process-shell unit-status-${statusKey}">
    <div class="technical-process-summary">
      <section class="unit-summary-card"><span>Modelo</span><strong>${safeVal(u.modelo || 'Sin modelo')}</strong><small>Dato único de la unidad</small></section>
      <section class="unit-summary-card"><span>Fase de obra</span><strong>${safeVal(phase)}</strong><small>${progress}% de avance</small></section>
      <section class="unit-summary-card"><span>Pólizas aplicables</span><strong>${policies.length}</strong><small>CAR / incendio</small></section>
    </div>
    <div class="technical-process-layout">
      <div class="technical-process-primary">
        <details class="unit-side-card technical-data-card">
          <summary><strong>Datos de la unidad</strong><span class="technical-completion-chip">${informed(unitValues)} de ${unitValues.length} informados</span><span>⌄</span></summary>
          <div class="unit-side-grid technical-unit-fields">
            ${field('fu-etapa','Etapa',u.etapa)}${field('fu-torre','Torre',u.torre)}${field('fu-nivel','Nivel',u.nivel)}
            <div class="unit-process-field"><label for="fu-modeloSelect">Modelo de vivienda</label><select id="fu-modeloSelect">${projectModelOptions(u.modelId||u.modelo||'',{includeEmpty:true})}</select><input id="fu-modelo" type="hidden" value="${safeVal(u.modelo||'')}"></div>
            ${number('fu-m2','Área de terreno',u.m2)}${field('fv-numeroFinca','Número de finca',u.numeroFinca)}${field('fv-codigoUbicacion','Código de ubicación',u.codigoUbicacion)}${field('fv-calle','Calle',u.calle)}
            ${number('fv-areaAbierta','Área abierta',u.areaAbierta)}${number('fv-areaCerrada','Área cerrada',u.areaCerrada)}${number('fv-areaTotalConstruccion','Área total de construcción',Number(u.areaTotalConstruccion||0)||Number(u.areaAbierta||0)+Number(u.areaCerrada||0),'readonly aria-readonly="true"')}${number('fv-recamaras','Recámaras',u.recamaras)}${number('fv-banos','Baños',u.banos)}
          </div>
        </details>
        <details class="unit-side-card construction-card" open>
          <summary><strong>Construcción de la vivienda</strong><span class="parallel-chip">Dato compartido</span><span class="technical-completion-chip">${informed(constructionValues)} de ${constructionValues.length}</span><span>⌄</span></summary>
          <div class="unit-side-grid technical-construction-fields">
            ${number('fv-avanceConstruccionPct','Avance de obra (%)',progress,'min="0" max="100"')}
            ${select('fv-estatusConstruccion','Fase de obra',[{v:'',l:'Pendiente de construir'},{v:'Obra gris',l:'Obra gris'},{v:'Acabados',l:'Acabados'},{v:'Terminada',l:'Terminada'}],v.estatusConstruccion)}
            ${check('fv-permisoConstruccionMunicipal','Permiso de construcción',v.permisoConstruccionMunicipal)}${field('fv-permisoConstruccionNum','Resolución construcción',v.permisoConstruccionNum)}
            ${date('fv-permisoConstruccionVencimiento','Vencimiento construcción',v.permisoConstruccionVencimiento)}${check('fv-permisoOcupacion','Permiso de ocupación',v.permisoOcupacion)}
            ${field('fv-permisoOcupacionNum','Resolución ocupación',v.permisoOcupacionNum)}${date('fv-fechaEmisionPermisoOcupacion','Fecha permiso ocupación',v.fechaEmisionPermisoOcupacion)}${field('fv-constructora','Constructora / contratista',v.constructora)}
          </div>
        </details>
      </div>
      <aside class="technical-process-secondary">
        <details class="unit-side-card technical-policy-card">
          <summary><strong>Póliza CAR / incendio aplicable</strong><span class="technical-completion-chip">${policies.length || 'Sin póliza'}</span><span>⌄</span></summary>
          <div class="technical-policy-body">
            <div class="insurance-unit-current">${insurancePolicyCardsHtml(policies, { showCoverage:true, editable:true })}</div>
            <details class="technical-policy-manager" data-unit-policy-manager><summary><strong>Crear y asignar una póliza</strong></summary>
              <p class="small muted">Selecciona todas las unidades cubiertas por esta misma póliza. Una unidad no puede tener dos pólizas del mismo tipo.</p>
              <div data-unit-policy-editor>${insurancePolicyEditorRow({}, { defaultUnitId:unitId })}</div>
              <div class="insurance-policy-editor-actions"><button type="button" class="btn btn-ghost" data-save-unit-policy>Guardar póliza</button><button type="button" class="btn btn-ghost" data-cancel-unit-policy>Cancelar</button></div>
            </details>
          </div>
        </details>
      </aside>
    </div>
  </div>`;
}

const COMMERCIAL_STAGE_FIELD_IDS = [
  ['fv-fechaReserva','fv-fechaProforma','fv-fechaProbableEntrega','fv-cesionAFavorDe','fv-estatusCPP'],
  ['fv-numCPP','fv-fechaValorCPP','fv-fechaVencimientoCPP','fv-aperturaCtaBanco','fv-polizaVidaEntregada','fv-tipoPolizaVida','fv-polizaIncendioEntregada','fv-tipoPolizaIncendio','fv-fechaContratoCliente','fv-montoContrato','fv-valorMejoras','fv-valorTerreno','fv-mLiberacion','fv-mSegregacion'],
  ['fv-solicitudAvaluo','fv-fechaAvaluo','fv-empresaAvaluadora'],
  ['fv-mPrestamo','fv-fechaFirma','fv-protocoloFirmaCliente','fv-protocoloFirmaPromotora','fv-protocoloFirmaRLBancoInter','fv-firmaProtocoloBancoCliente'],
  ['fv-fechaPagoImpuesto','fv-fechaIngresoRP','fv-fechaInscripcion'],
  ['fv-fechaDesembolso','fv-fechaRecibidoCheque','fv-fechaEntregaVivienda']
];

function refreshPolicyDeliverySummary() {
  const life = document.getElementById('fv-polizaVidaEntregada');
  const fire = document.getElementById('fv-polizaIncendioEntregada');
  const summary = document.getElementById('fv-polizas');
  if (!life || !fire || !summary) return;
  summary.checked = life.checked && fire.checked;
  summary.indeterminate = life.checked !== fire.checked;
}

function refreshCommercialProcessProgress() {
  const cards = [...document.querySelectorAll('#fichaUnidadModal .unit-process-stage[data-stage-index]')];
  if (!cards.length) return;
  const values = COMMERCIAL_STAGE_FIELD_IDS.map(ids => ids.map(id => {
    const control = document.getElementById(id);
    return control?.type === 'checkbox' ? !!control.checked : String(control?.value || '').trim();
  }));
  const states = commercialStageStates(values);
  cards.forEach((card, index) => {
    const state = states[index];
    card.classList.remove('is-complete', 'is-current', 'is-pending');
    card.classList.add(state.cls);
    const number = card.querySelector('.unit-stage-number');
    const counter = card.querySelector('.unit-stage-copy small');
    const status = card.querySelector('.unit-stage-status');
    if (number) number.textContent = state.complete ? '✓' : String(index + 1);
    if (counter) counter.textContent = `${state.filled} de ${values[index].length} campos`;
    if (status) status.textContent = state.label;
  });
  const complete = states.filter(state => state.complete).length;
  const headingCount = document.querySelector('#fichaUnidadModal .unit-process-heading > div > span');
  const progress = document.querySelector('#fichaUnidadModal .unit-process-progress i');
  if (headingCount) headingCount.textContent = `${complete} de 6 etapas completas`;
  if (progress) progress.style.width = `${Math.round(complete / 6 * 100)}%`;
}

function openFichaCommercialState() {
  const value = id => String(document.getElementById(id)?.value || '').trim();
  if (value('fv-fechaInscripcion')) return { estado:'escriturado_traspasado', motivo:'Inscripción en Registro Público registrada' };
  if (value('fv-solicitudAvaluo')) return { estado:'tramite_legal_activado', motivo:'Solicitud de avalúo registrada' };
  if (value('fv-fechaValorCPP') || /cpp\s*recibid/i.test(value('fv-estatusCPP'))) {
    return { estado:'con_cpp', motivo:'CPP recibida o fecha de CPP registrada' };
  }
  if (value('fv-fechaReserva')) return { estado:'reservado', motivo:'Fecha de reserva registrada' };
  if (parsePanamaNumber(value('fv-avanceConstruccionPct')) > 0) return { estado:'inventario', motivo:'Construcción iniciada' };
  return { estado:'disponible', motivo:'Sin construcción ni hitos comerciales; permanece como lote libre' };
}

function refreshOpenFichaCommercialStatePreview() {
  if (fichaMode !== 'commercial') return;
  const suggestion = openFichaCommercialState();
  const stateSelect = document.getElementById('fu-estado');
  const ranks = ['disponible','inventario','reservado','con_cpp','tramite_legal_activado','escriturado_traspasado'];
  const currentRank = ranks.indexOf(normalizeUnitEstadoFrontend(stateSelect?.value));
  const suggestionRank = ranks.indexOf(suggestion.estado);
  const canAdvanceManual = fichaEstadoModo !== 'automatico' && suggestionRank > currentRank;
  if (fichaEstadoModo === 'automatico' || canAdvanceManual) {
    const nextState = fichaEstadoModo === 'automatico' &&
      !['disponible','inventario'].includes(suggestion.estado) &&
      currentRank > suggestionRank
      ? normalizeUnitEstadoFrontend(stateSelect?.value)
      : suggestion.estado;
    fichaEstadoModo = 'automatico';
    if (stateSelect) stateSelect.value = nextState;
    applyOpenFichaStateVisual({
      estado:nextState,
      estadoModo:'automatico',
      estadoAutomaticoSugerido:suggestion.estado,
      estadoAutomaticoMotivo:suggestion.motivo
    });
  }
}

function refreshCommercialSummaryKpis({ normalizeCpp = false } = {}) {
  const cppDate = String(document.getElementById('fv-fechaValorCPP')?.value || '').trim();
  const cppSelect = document.getElementById('fv-estatusCPP');
  if (normalizeCpp && cppDate && cppSelect && cppSelect.value !== 'CPP recibida') {
    cppSelect.value = 'CPP recibida';
  }
  const cppStatus = String(cppSelect?.value || '').trim();
  const statusValue = document.getElementById('fichaCppStatusValue');
  if (statusValue) {
    statusValue.textContent = cppStatus || 'Sin definir';
    statusValue.classList.remove('is-positive','is-neutral','is-danger');
    statusValue.classList.add(/cpp\s*recibid/i.test(cppStatus)
      ? 'is-positive'
      : /venc|rechaz/i.test(cppStatus) ? 'is-danger' : 'is-neutral');
  }
  const expiry = String(document.getElementById('fv-fechaVencimientoCPP')?.value || '').trim();
  const expiryValue = document.getElementById('fichaCppExpiryValue');
  if (expiryValue) expiryValue.textContent = expiry
    ? `Vence el ${expiry.split('-').reverse().join('/')}`
    : 'Sin vencimiento registrado';
  const price = parsePanamaNumber(document.getElementById('fv-precioVenta')?.value || 0);
  const cpp = parsePanamaNumber(document.getElementById('fv-montoFinanciamientoCPP')?.value || 0);
  const pctValue = document.getElementById('fichaFinancingPctValue');
  if (pctValue) pctValue.textContent = `${price > 0 ? ((cpp / price) * 100).toFixed(1) : '0.0'} % de financiación`;
}

function refreshStructuredClientName(second = false) {
  const prefix = second ? 'fv-cliente2' : 'fv-';
  const ids = second
    ? ['PrimerNombre','SegundoNombre','PrimerApellido','SegundoApellido'].map(part => `${prefix}${part}`)
    : ['primerNombre','segundoNombre','primerApellido','segundoApellido'].map(part => `${prefix}${part}`);
  const name = ids.map(id => String(document.getElementById(id)?.value || '').trim()).filter(Boolean).join(' ');
  const summary = document.getElementById(second ? 'fv-cliente2NombreCompleto' : 'fv-clienteNombre');
  if (summary && name) summary.value = name;
}

function refreshReservationAgeNotice() {
  const heading = document.querySelector('#fichaUnidadModal .unit-process-heading');
  if (!heading) return;
  const info = reservationAgeInfo(
    { estado: document.getElementById('fu-estado')?.value },
    { fechaReserva: document.getElementById('fv-fechaReserva')?.value }
  );
  let badge = heading.querySelector('.unit-reservation-age');
  if (!info) {
    badge?.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement('strong');
    badge.className = 'unit-reservation-age';
    heading.querySelector('.unit-process-progress')?.before(badge);
  }
  badge.textContent = info.label;
}

if (!window.__PROJECT_NUMBER_INPUT_FORMAT_BOUND__) {
  window.__PROJECT_NUMBER_INPUT_FORMAT_BOUND__ = true;
  document.addEventListener('focusout', (ev) => {
    const input = ev.target.closest?.('[data-number-input]');
    if (!input || input.readOnly || input.disabled) return;
    input.value = formatInputNumber(input.id, input.value);
  });
}

function calcDiffDays(startValue, endValue) {
  if (!startValue || !endValue) return 0;

  const start = new Date(startValue);
  const end = new Date(endValue);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;

  const msPerDay = 1000 * 60 * 60 * 24;
  const diff = Math.round((end.getTime() - start.getTime()) / msPerDay);

  return diff >= 0 ? diff : 0;
}

function refreshTiempoAprobacionDias() {
  const entregaEl = document.getElementById('fv-entregaExpedienteBanco');
  const recibidoEl = document.getElementById('fv-recibidoCPP');
  const tiempoEl = document.getElementById('fv-tiempoAprobacionDias');

  if (!entregaEl || !recibidoEl || !tiempoEl) return;

  const dias = calcDiffDays(entregaEl.value, recibidoEl.value);
  tiempoEl.value = dias;
}

function refreshFinanciamientoAuto(changedField = '') {
  const precioEl = document.getElementById('fv-precioVenta');
  const montoEl = document.getElementById('fv-montoFinanciamientoCPP');
  const pctEl = document.getElementById('fv-porcentajeFinanciamiento');
  const abonoEl = document.getElementById('fv-abonoInicial');

  if (!precioEl || !montoEl || !pctEl) return;

  const precio = parsePanamaNumber(precioEl.value);
  let monto = parsePanamaNumber(montoEl.value);
  let pct = parsePanamaNumber(pctEl.value);
  let abono = abonoEl ? parsePanamaNumber(abonoEl.value) : Math.max(precio - monto, 0);

  if (precio <= 0) {
    montoEl.value = formatPanamaNumber(0);
    pctEl.value = formatPanamaNumber(0);
    if (abonoEl) abonoEl.value = formatPanamaNumber(0);
    refreshCommercialSummaryKpis();
    return;
  }

  if (changedField === 'init') {
    if (abono > 0) {
      monto = Math.max(precio - abono, 0);
      pct = (monto / precio) * 100;
    } else if (monto > 0) {
      abono = Math.max(precio - monto, 0);
      pct = (monto / precio) * 100;
    } else if (pct > 0) {
      monto = precio * (pct / 100);
      abono = Math.max(precio - monto, 0);
    } else {
      monto = 0;
      pct = 0;
      abono = precio;
    }
  } else if (changedField === 'pct') {
    monto = precio * (pct / 100);
    abono = Math.max(precio - monto, 0);
  } else if (changedField === 'monto') {
    abono = Math.max(precio - monto, 0);
    pct = (monto / precio) * 100;
  } else {
    monto = Math.max(precio - abono, 0);
    pct = (monto / precio) * 100;
  }

  monto = Number.isFinite(monto) ? monto : 0;
  pct = Number.isFinite(pct) ? pct : 0;
  abono = Number.isFinite(abono) ? abono : 0;

  montoEl.value = formatPanamaNumber(monto);
  pctEl.value = formatPanamaNumber(pct);
  if (abonoEl) abonoEl.value = formatPanamaNumber(abono);
  refreshCommercialSummaryKpis();
}

function refreshAreaTotalConstruccion() {
  const abiertaEl = document.getElementById('fv-areaAbierta');
  const cerradaEl = document.getElementById('fv-areaCerrada');
  const totalEl = document.getElementById('fv-areaTotalConstruccion');
  if (!abiertaEl || !cerradaEl || !totalEl) return;

  const total =
    parseInputNumber('fv-areaAbierta', abiertaEl.value) +
    parseInputNumber('fv-areaCerrada', cerradaEl.value);
  totalEl.value = formatInputNumber('fv-areaTotalConstruccion', total);
}

// ==============================
// Status en Banco (select + OTRO)
// ==============================
const STATUS_BANCO = [
  { v: 'PROFORMA',              l: 'PROFORMA (Proforma entregada)' },
  { v: 'EXPEDIENTE_ENTREGADO',  l: 'EXPEDIENTE ENTREGADO' },
  { v: 'EN_REVISION',           l: 'EN REVISIÓN' },
  { v: 'SUBSANAR',              l: 'SUBSANAR / DEVUELTO' },
  { v: 'APROBADO_CPP',          l: 'APROBADO CPP' },
  { v: 'RECHAZADO',             l: 'RECHAZADO' },
  { v: 'DESEMBOLSO',            l: 'DESEMBOLSO' },
  { v: 'ESCRITURADO',           l: 'ESCRITURADO' },
  { v: 'OTRO',                  l: 'OTRO' },
];

function normalizeStatusBanco(raw) {
  const s = String(raw || '').trim();
  if (!s) return { code: '', other: '' };

  const u = s.toUpperCase().replace(/\s+/g, '_');

  if (u.includes('PROFORMA')) return { code: 'PROFORMA', other: '' };
  if (u.includes('EXPEDIENTE')) return { code: 'EXPEDIENTE_ENTREGADO', other: '' };
  if (u.includes('REVISION')) return { code: 'EN_REVISION', other: '' };
  if (u.includes('SUBSAN') || u.includes('DEVUEL')) return { code: 'SUBSANAR', other: '' };
  if (u.includes('APROB')) return { code: 'APROBADO_CPP', other: '' }; // APROBADA CCP / APROBADA CPP / etc.
  if (u.includes('RECHAZ')) return { code: 'RECHAZADO', other: '' };
  if (u.includes('DESEMBOL')) return { code: 'DESEMBOLSO', other: '' };
  if (u.includes('ESCRIT')) return { code: 'ESCRITURADO', other: '' };

  // Si no encaja, lo conservamos como OTRO
  return { code: 'OTRO', other: s };
}

function fillStatusBancoSelect(selectEl, { includeEmpty = false } = {}) {
  if (!selectEl) return;
  selectEl.innerHTML = '';

  if (includeEmpty) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(no cambiar)';
    selectEl.appendChild(opt);
  }

  for (const o of STATUS_BANCO) {
    const opt = document.createElement('option');
    opt.value = o.v;
    opt.textContent = o.l;
    selectEl.appendChild(opt);
  }
}

function initStatusBancoUI(selId, otherLblId, otherId, currentValue, { includeEmpty = false } = {}) {
  const sel   = document.getElementById(selId);
  const lbl   = document.getElementById(otherLblId);
  const other = document.getElementById(otherId);

  if (!sel) return; // si no existe, no hacemos nada

  fillStatusBancoSelect(sel, { includeEmpty });

  const norm = normalizeStatusBanco(currentValue);
  sel.value = norm.code || (includeEmpty ? '' : 'OTRO');

  const refresh = () => {
    const isOther = (sel.value === 'OTRO');
    if (lbl)   lbl.style.display = isOther ? 'block' : 'none';
    if (other) {
      other.style.display = isOther ? 'block' : 'none';
      other.value = isOther ? (norm.other || (other.value || '')) : '';
    }
  };

  sel.onchange = () => {
    if (sel.value !== 'OTRO' && other) other.value = '';
    refresh();
  };

  refresh();
}


function getStatusBancoValue(selId, otherId) {
  const sel = document.getElementById(selId);
  const other = document.getElementById(otherId);
  const v = (sel?.value || '').trim();
  if (!v) return '';               // para batch "(no cambiar)" o vacío
  if (v !== 'OTRO') return v;
  return (other?.value || '').trim();
}

// Acordeón simple
function installSectionToggles() {
  document.querySelectorAll('#fichaContenido .section h4 .toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const sec = btn.closest('.section');
      const collapsed = sec.classList.toggle('collapsed');
      btn.textContent = collapsed ? '▸' : '▾';
    });
  });
}

// === Catálogo de pasos RBS (resume y completa según tu DOC) ===
const RBS_STEPS = [
  // Ventas
  { code:'V-01', title:'Recopilación de documentación de cliente', help:'Recepción, requisitos, APC, copias, Ficha FV-01, etc.' },
  { code:'V-02', title:'Separación y reserva de lote', help:'Declaración FV-02, pago de reserva, depósitos, control de depósitos.' },
  { code:'V-03', title:'Creación de expediente de cliente', help:'Armar expediente físico y digital según checklist.' },
  { code:'V-04', title:'Elaboración y entrega de proforma', help:'Solicitud FV-03, DV-01, envío y control.' },
  { code:'V-05', title:'Seguimiento aprobación de hipoteca', help:'Comunicación con oficial, comités, reporte semanal.' },
  { code:'V-06', title:'Firma carta de términos en banco', help:'Asegurar firma correcta y copia.' },
  { code:'V-07', title:'Emisión Carta Promesa de Pago', help:'Seguimiento, retiro, archivo y control.' },
  { code:'V-08', title:'Firma contrato promesa de compraventa', help:'Elaboración, firma promotora y cliente, constancias.' },

  // Escrituración
  { code:'E-01', title:'Cesión CPP por banco cliente', help:'Solicitar, retirar, enviar a banco interino, archivar.' },
  { code:'E-02', title:'Minuta de cancelación banco interino', help:'Solicitar M1, seguimiento, retiro, escaneo.' },
  { code:'E-03', title:'Minuta de compraventa (promotora)', help:'Solicitar/elaborar M2, planos, etc.' },
  { code:'E-04', title:'Minuta de préstamo (banco cliente)', help:'Solicitar M3, seguimiento, retiro.' },
  { code:'E-05', title:'Protocolo de escritura', help:'Solicitar, elaborar DE-04, imprimir para firmas.' },
  { code:'E-06', title:'Paz y salvo de clientes', help:'Solicitudes y verificaciones.' },
  { code:'E-07', title:'Firma protocolo por promotora', help:'Firma RL.' },
  { code:'E-08', title:'Firma protocolo por banco interino', help:'Envío, seguimiento, retiro.' },
  { code:'E-09', title:'Firma protocolo por el cliente', help:'Cita, asistencia, envío.' },
  { code:'E-10', title:'Firma protocolo por banco cliente', help:'Envío, seguimiento, retiro.' },
  { code:'E-11', title:'Cierre en notaría', help:'Revisión, envío, cierre, Escritura Pública.' },
  { code:'E-12', title:'Inscripción en Registro Público', help:'Ingreso, seguimiento, retiro, exoneración.' },
  { code:'E-13', title:'Desembolso CPP', help:'Solicitud DE-07, seguimiento, cheque, depósito.' },

  // Bono/MIVI (si aplica)
  { code:'M-01', title:'Expediente MIVI', help:'Armar y enviar a MIVIOT.' },
  { code:'M-02', title:'Inspección de vivienda por cliente', help:'Coordinar con técnico, carta de aceptación.' },
  { code:'M-03', title:'Aprobación bono solidario', help:'Ingreso y resolución.' },
  { code:'M-04', title:'Emisión/desembolso CPP Banco Nacional', help:'Seguimiento a emisión y desembolso.' }
];

// Valores de estado
const STEP_STATES = ['pendiente','en_proceso','completado','bloqueado'];

function renderChecklistView(venta = {}) {
  const byCode = new Map((venta.checklist || []).map(s => [s.code, s]));

  const itemsHtml = RBS_STEPS.map(s => {
    const cur = byCode.get(s.code) || {};
    const due = cur.dueAt ? String(cur.dueAt).slice(0,10) : '';
    const done = cur.doneAt ? String(cur.doneAt).slice(0,10) : '';
    const st = cur.state || 'pendiente';
    const note = cur.note || '';

    return `
      <div class="chk-item" data-code="${s.code}">
        <div class="head">
          <strong>${s.code} — ${s.title}</strong>
          <button class="help" type="button" data-code="${s.code}">ℹ️</button>
        </div>
        <div class="form-grid-4">
          <div class="label">Estado</div>
          <select id="chk-state-${s.code}">
            ${STEP_STATES.map(x => `<option value="${x}" ${st===x?'selected':''}>${x.replace(/_/g,' ')}</option>`).join('')}
          </select>

          <div class="label">Fecha límite</div>
          <input id="chk-due-${s.code}" type="date" value="${due}">

          <div class="label">Fecha realización</div>
          <input id="chk-done-${s.code}" type="date" value="${done}">

          <div class="label">Notas</div>
          <input id="chk-note-${s.code}" type="text" value="${note}">
        </div>
        <div class="help-box" id="help-${s.code}" hidden>${s.help || ''}</div>
      </div>
    `;
  }).join('');

  return seccion('Checklist RBS', `<div id="chkList">${itemsHtml}</div>`, ''); // sin grid wrapper
}

function wireChecklistHelpToggles() {
  document.querySelectorAll('#chkList .help').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.code;
      const box = document.getElementById(`help-${code}`);
      if (box) box.hidden = !box.hidden;
    });
  });
}

// Recolecta payload de checklist para guardar
function collectChecklistPayload() {
  // Leemos por el patrón de ids que pinta renderChecklistView
  return RBS_STEPS.map(s => {
    const code = s.code;
    const stEl  = document.getElementById(`chk-state-${code}`);
    const dueEl = document.getElementById(`chk-due-${code}`);
    const dnEl  = document.getElementById(`chk-done-${code}`);
    const ntEl  = document.getElementById(`chk-note-${code}`);

    const state = (stEl?.value || 'pendiente').trim();
    const due   = (dueEl?.value || '').trim();
    const done  = (dnEl?.value  || '').trim();
    const note  = (ntEl?.value  || '').trim();

    return {
      code,
      state,
      dueAt:  due  ? due  : null,
      doneAt: done ? done : null,
      note
    };
  });
}

// Estados comerciales de unidad
const UNIT_ESTADOS = [
  { v: 'disponible', l: 'Lote libre' },
  { v: 'inventario', l: 'Inventario' },
  { v: 'reservado', l: 'Reservado' },
  { v: 'con_cpp', l: 'Con CPP' },
  { v: 'tramite_legal_activado', l: 'Trámite legal' },
  { v: 'escriturado_traspasado', l: 'Traspasado' },
];

function estadoLabel(v) {
  const estado = normalizeUnitEstadoFrontend(v);
  return (UNIT_ESTADOS.find(e => e.v === estado)?.l) || estado.replace(/_/g, ' ');
}

function applyOpenFichaStateVisual(unitState = {}) {
  if (unitState.estadoModo) {
    fichaEstadoModo = unitState.estadoModo === 'automatico' ? 'automatico' : 'manual';
  }
  const stateValue = normalizeUnitEstadoFrontend(unitState.estado || document.getElementById('fu-estado')?.value);
  const nextClass = `unit-status-${stateValue}`;
  const stateSelect = document.getElementById('fu-estado');
  if (stateSelect && stateValue) stateSelect.value = stateValue;
  [document.querySelector('#fichaUnidadModal .unit-process-shell'), document.querySelector('#fichaUnidadModal .unit-title-status')]
    .filter(Boolean)
    .forEach(element => {
      [...element.classList].filter(name => name.startsWith('unit-status-')).forEach(name => element.classList.remove(name));
      element.classList.add(nextClass);
    });
  const badge = document.getElementById('fichaEstadoModeBadge');
  if (badge) {
    badge.textContent = fichaEstadoModo === 'automatico' ? 'Automático' : 'Manual';
    badge.title = unitState.estadoAutomaticoMotivo || badge.title;
    badge.classList.toggle('is-auto', fichaEstadoModo === 'automatico');
    badge.classList.toggle('is-manual', fichaEstadoModo !== 'automatico');
  }
  const resetButton = document.getElementById('btnFichaEstadoAutomatico');
  if (resetButton) {
    resetButton.hidden = fichaEstadoModo === 'automatico';
    const suggestion = unitState.estadoAutomaticoSugerido;
    if (suggestion) resetButton.title = `Aplicar ahora el estado recomendado: ${estadoLabel(suggestion)}`;
  }
  refreshReservationAgeNotice();
}

  // Estado
  let unitsCache = [];
  let ventasMap = new Map(); // unitId -> venta
  let selected = new Set();
  let fichaUnitId = null;
  let fichaMode = 'commercial';
  let fichaAutosaveTimer = null;
  let fichaAutosaveReady = false;
  let fichaDirty = false;
  let fichaSaving = false;
  let fichaChangeVersion = 0;
  let fichaCloseRequested = false;
  let fichaEstadoControl = '';
  let fichaEstadoModo = 'manual';
  let foldersCache = [];
  let unitDocDepartment = 'commercial';
  let unitDocFolderId = '';
  let unitDocFoldersCache = [];
  let unitDocInsideDepartment = false;
  let latestFinanceExpiryAlerts = [];

  function pill(txt){ return `<span class="tag">${txt||'-'}</span>`; }

  function projectHousingModels() {
    return Array.isArray(state?.project?.housingModels) ? state.project.housingModels : [];
  }

  function findProjectHousingModel(value) {
    const key = String(value || '').trim();
    if (!key) return null;
    return projectHousingModels().find(model =>
      String(model._id || '') === key ||
      String(model.name || '').trim().toLowerCase() === key.toLowerCase()
    ) || null;
  }

  function projectModelOptions(current = '', { includeEmpty = true } = {}) {
    const models = projectHousingModels();
    const empty = includeEmpty ? `<option value="">Sin modelo / manual</option>` : '';
    return empty + models.map(model => {
      const value = String(model._id || model.name || '');
      const selected = String(current || '') === value || String(current || '').trim().toLowerCase() === String(model.name || '').trim().toLowerCase();
      return `<option value="${safeVal(value)}" ${selected ? 'selected' : ''}>${safeVal(model.name || 'Modelo')}</option>`;
    }).join('');
  }

  function commercialModelsHtml() {
    const models = projectHousingModels();
    const attr = value => escapeHtml(value ?? '');
    return `
      <details class="commercial-models-manager" open>
        <summary>
          <span>Modelos guardados</span>
          <small>${models.length} guardados</small>
        </summary>
        <div class="commercial-models-content">
          <div class="commercial-models-head" aria-hidden="true">
            <span>Modelo</span>
            <span>Rec.</span>
            <span>Banos</span>
            <span>Abierta</span>
            <span>Cerrada</span>
            <span class="technical-commercial-sensitive">Precio</span>
            <span>Coste</span>
            <span></span>
          </div>
          ${models.map((model, idx) => `
            <div class="commercial-model-row" data-commercial-model-row="${idx}">
              <input data-commercial-model="name" placeholder="Modelo" value="${attr(model.name || '')}">
              <input data-commercial-model="bedrooms" type="number" min="0" step="1" placeholder="Rec." value="${attr(model.bedrooms ?? '')}">
              <input data-commercial-model="bathrooms" type="number" min="0" step="any" placeholder="Baños" value="${attr(model.bathrooms ?? '')}">
              <input data-commercial-model="openAreaM2" type="number" min="0" step="any" placeholder="Área abierta" value="${attr(model.openAreaM2 ?? '')}">
              <input data-commercial-model="closedAreaM2" type="number" min="0" step="any" placeholder="Área cerrada" value="${attr(model.closedAreaM2 ?? '')}">
              <input class="technical-commercial-sensitive" data-commercial-model="price" type="number" min="0" step="any" placeholder="Precio" value="${attr(model.price ?? '')}">
              <input data-commercial-model="cost" type="number" min="0" step="any" placeholder="Coste" value="${attr(model.cost ?? '')}">
              <button type="button" class="btn mini" data-delete-commercial-model="${idx}">Eliminar</button>
            </div>
          `).join('') || '<div class="small muted">Aún no hay modelos guardados.</div>'}
          <div class="commercial-model-row commercial-model-row-new">
            <input id="cm-name" placeholder="Nuevo modelo">
            <input id="cm-bedrooms" type="number" min="0" step="1" placeholder="Rec.">
            <input id="cm-bathrooms" type="number" min="0" step="any" placeholder="Baños">
            <input id="cm-openAreaM2" type="number" min="0" step="any" placeholder="Área abierta">
            <input id="cm-closedAreaM2" type="number" min="0" step="any" placeholder="Área cerrada">
            <input class="technical-commercial-sensitive" id="cm-price" type="number" min="0" step="any" placeholder="Precio">
            <input id="cm-cost" type="number" min="0" step="any" placeholder="Coste">
            <button type="button" class="btn mini primary" id="btnAddCommercialModel">Añadir</button>
          </div>
          <div class="commercial-model-actions">
            <button type="button" class="btn mini" id="btnSaveCommercialModels">Guardar modelos</button>
            <span class="small muted" id="commercialModelsMsg"></span>
          </div>
        </div>
      </details>
    `;
  }

  function readCommercialModelRow(row, base = {}) {
    const val = key => row.querySelector(`[data-commercial-model="${key}"]`)?.value?.trim() || '';
    const num = key => {
      const value = val(key);
      return value === '' ? 0 : Number(value || 0);
    };
    return {
      ...base,
      name: val('name'),
      bedrooms: num('bedrooms'),
      bathrooms: num('bathrooms'),
      openAreaM2: num('openAreaM2'),
      closedAreaM2: num('closedAreaM2'),
      price: num('price'),
      cost: num('cost')
    };
  }

  function currentCommercialModelsFromUi() {
    return Array.from(document.querySelectorAll('[data-commercial-model-row]')).map(row => {
      const idx = Number(row.dataset.commercialModelRow);
      return readCommercialModelRow(row, projectHousingModels()[idx] || {});
    }).filter(model => String(model.name || '').trim());
  }

  async function saveProjectHousingModels(models) {
    const result = await API.put(`/api/projects/${id}/housing-models`, { housingModels: models });
    state.project.housingModels = result?.housingModels || models;
    const modelSelect = document.getElementById('cl-modeloSelect');
    if (modelSelect) modelSelect.innerHTML = projectModelOptions(modelSelect.value, { includeEmpty: true });
    await window.refreshTechnicalWorkspace?.({ force:true, preserveSelection:true });
  }

  function setCommercialModelsMsg(text, color = '') {
    const msg = document.getElementById('commercialModelsMsg');
    if (!msg) return;
    msg.textContent = text;
    msg.style.color = color;
  }

  function renderCommercialModelsManager() {
    const wrap = document.getElementById('commercialModelsManager');
    if (!wrap) return;
    wrap.innerHTML = commercialModelsHtml();
    bindCommercialModelsManager();
  }

  function renderCreateBatchModalLayout() {
    const body = modalCrear?.querySelector('.modal-body');
    if (!body || body.dataset.commercialCreateLayout === 'split') return;
    body.dataset.commercialCreateLayout = 'split';
    body.innerHTML = `
      <section class="commercial-modal-section commercial-lots-section">
        <div class="commercial-modal-section-head">
          <h3>CREAR LOTES</h3>
        </div>
        <div class="commercial-lots-grid">
          <label>
            <span>Manzana</span>
            <input id="cl-manzana" placeholder="A" />
          </label>
          <label>
            <span>Cantidad</span>
            <input id="cl-cantidad" type="number" min="1" value="10" />
          </label>
          <label class="commercial-field-wide">
            <span>Modelo definido</span>
            <select id="cl-modeloSelect">
              <option value="">Sin modelo / manual</option>
            </select>
          </label>
          <label>
            <span>Modelo</span>
            <input id="cl-modelo" placeholder="Modelo" />
          </label>
          <label>
            <span>m2</span>
            <input id="cl-m2" type="number" min="0" value="60" />
          </label>
          <label>
            <span>Area abierta m2</span>
            <input id="cl-areaAbierta" type="number" min="0" value="0" />
          </label>
          <label>
            <span>Area cerrada m2</span>
            <input id="cl-areaCerrada" type="number" min="0" value="0" />
          </label>
          <label>
            <span>Recamaras</span>
            <input id="cl-recamaras" type="number" min="0" value="0" />
          </label>
          <label>
            <span>Banos</span>
            <input id="cl-banos" type="number" min="0" value="0" />
          </label>
          <label class="technical-commercial-sensitive">
            <span>Precio de venta</span>
            <input id="cl-precio" type="text" inputmode="decimal" value="100,000.00" />
          </label>
          <label>
            <span>Coste por unidad</span>
            <input id="cl-costo" type="text" inputmode="decimal" value="0.00" />
          </label>
          <label class="commercial-field-wide">
            <span>Ubicacion</span>
            <input id="cl-ubicacion" type="text" />
          </label>
          <label class="commercial-field-wide">
            <span>Estado inicial</span>
            <select id="cl-estado">
              <option value="disponible">Lote libre</option>
              <option value="inventario">Inventario</option>
              <option value="reservado">Reservado</option>
              <option value="con_cpp">Con CPP</option>
              <option value="tramite_legal_activado">Trámite legal</option>
              <option value="escriturado_traspasado">Traspasado</option>
            </select>
          </label>
        </div>
      </section>

    `;
    document.getElementById('cl-modeloSelect')?.addEventListener('change', (event) => applyProjectModelToOpenUnitForm(event.target.value));
  }

  async function bindCommercialModelsManager() {
    const msg = document.getElementById('commercialModelsMsg');
    const setMsg = (text, color = '') => {
      if (!msg) return;
      msg.textContent = text;
      msg.style.color = color;
    };
    document.getElementById('btnAddCommercialModel')?.addEventListener('click', async () => {
      const name = document.getElementById('cm-name')?.value?.trim() || '';
      if (!name) return setMsg('Indica el nombre del modelo.', '#b91c1c');
      const models = currentCommercialModelsFromUi();
      if (models.some(model => String(model.name || '').trim().toLowerCase() === name.toLowerCase())) {
        return setMsg('Ya existe un modelo con ese nombre.', '#b91c1c');
      }
      models.push({
        name,
        bedrooms: Number(document.getElementById('cm-bedrooms')?.value || 0),
        bathrooms: Number(document.getElementById('cm-bathrooms')?.value || 0),
        openAreaM2: Number(document.getElementById('cm-openAreaM2')?.value || 0),
        closedAreaM2: Number(document.getElementById('cm-closedAreaM2')?.value || 0),
        price: Number(document.getElementById('cm-price')?.value || 0),
        cost: Number(document.getElementById('cm-cost')?.value || 0),
        observations: 'Creado desde Comercial'
      });
      try {
        await saveProjectHousingModels(models);
        renderCommercialModelsManager();
        setCommercialModelsMsg('Modelo anadido.', '#166534');
        await loadUnits();
      } catch (e) {
        setMsg(e.message || 'No se pudo añadir el modelo.', '#b91c1c');
      }
    });
    document.getElementById('btnSaveCommercialModels')?.addEventListener('click', async () => {
      try {
        await saveProjectHousingModels(currentCommercialModelsFromUi());
        setMsg('Modelos guardados.', '#166534');
      } catch (e) {
        setMsg(e.message || 'No se pudieron guardar los modelos.', '#b91c1c');
      }
    });
    document.querySelectorAll('[data-delete-commercial-model]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.dataset.deleteCommercialModel);
        if (!confirm('¿Eliminar este modelo?')) return;
        try {
          const models = currentCommercialModelsFromUi().filter((_, i) => i !== idx);
          await saveProjectHousingModels(models);
          renderCommercialModelsManager();
          setCommercialModelsMsg('Modelo eliminado.', '#166534');
          await loadUnits();
        } catch (e) {
          setMsg(e.message || 'No se pudo eliminar el modelo.', '#b91c1c');
        }
      });
    });
  }

  function modelToUnitDefaults(model) {
    if (!model) return {};
    const decimal = value => parseDecimalMeasureNumber(value);
    return {
      modelId: model._id || '',
      modelo: model.name || '',
      m2: decimal(model.openAreaM2) + decimal(model.closedAreaM2),
      precioVenta: parsePanamaNumber(model.price),
      costoUnidad: parsePanamaNumber(model.cost),
      areaAbierta: decimal(model.openAreaM2),
      areaCerrada: decimal(model.closedAreaM2),
      recamaras: decimal(model.bedrooms),
      banos: decimal(model.bathrooms)
    };
  }

  function applyProjectModelToOpenUnitForm(modelValue) {
    const model = findProjectHousingModel(modelValue);
    if (!model) return;
    const defaults = modelToUnitDefaults(model);
    const setValue = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value ?? '';
    };
    setValue('cl-modelo', defaults.modelo);
    setValue('cl-m2', formatInputNumber('cl-m2', defaults.m2));
    setValue('cl-precio', formatInputNumber('cl-precio', defaults.precioVenta));
    setValue('cl-costo', formatInputNumber('cl-costo', defaults.costoUnidad));
    setValue('cl-areaAbierta', formatInputNumber('cl-areaAbierta', defaults.areaAbierta));
    setValue('cl-areaCerrada', formatInputNumber('cl-areaCerrada', defaults.areaCerrada));
    setValue('cl-recamaras', formatInputNumber('cl-recamaras', defaults.recamaras));
    setValue('cl-banos', formatInputNumber('cl-banos', defaults.banos));
    const loc = document.getElementById('cl-ubicacion');
    if (loc && !loc.value) loc.value = state?.project?.location || state?.project?.address || '';
  }

  function applyProjectModelToFicha(modelValue, { onlyMissing = false } = {}) {
    const model = findProjectHousingModel(modelValue);
    if (!model) return;
    const defaults = modelToUnitDefaults(model);
    const setValue = (id, value, { force = false } = {}) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (onlyMissing && !force && parseInputNumber(id, el.value) > 0) return;
      el.value = value ?? '';
    };
    setValue('fu-modelo', defaults.modelo, { force:true });
    setValue('fu-precio', formatInputNumber('fu-precio', defaults.precioVenta));
    setValue('fu-costo', formatInputNumber('fu-costo', defaults.costoUnidad));
    const costInput = document.getElementById('fu-costo');
    if (costInput) costInput.dataset.manual = 'false';
    setValue('fv-areaAbierta', formatInputNumber('fv-areaAbierta', defaults.areaAbierta));
    setValue('fv-areaCerrada', formatInputNumber('fv-areaCerrada', defaults.areaCerrada));
    setValue('fv-recamaras', formatInputNumber('fv-recamaras', defaults.recamaras));
    setValue('fv-banos', formatInputNumber('fv-banos', defaults.banos));
    refreshAreaTotalConstruccion();
  }

  // Carga ventas del proyecto y crea mapa por unidad
  async function loadVentasMap() {
    const ventas = await apiGet(`/api/ventas?projectId=${id}`);
    ventasMap = new Map((ventas||[]).map(v => [String(v.unitId), v]));
  }

  function updateSelectAllLabel() {
  if (!btnSelectAll) return;
  const total = (unitsCache || []).length;
  btnSelectAll.textContent = (selected.size >= total && total > 0) ? 'Deseleccionar todo' : 'Seleccionar todo';
}

let unassignedSettings = {
  name: 'Sin carpeta',
  color: '#0f172a'
};

async function loadCommercialFolders() {
  const data = await apiGet(`/api/commercial-folders?projectId=${id}`).catch(() => ({
    folders: [],
    unassigned: {
      name: 'Sin carpeta',
      color: '#0f172a'
    }
  }));

  foldersCache = Array.isArray(data) ? data : (data.folders || []);
  unassignedSettings = data.unassigned || {
    name: 'Sin carpeta',
    color: '#0f172a'
  };
}

function isCommercialFolderCollapsed(folderId) {
  return localStorage.getItem(`bank73_com_folder_closed_${id}_${folderId || 'unassigned'}`) === '1';
}

function setCommercialFolderCollapsed(folderId, closed) {
  localStorage.setItem(`bank73_com_folder_closed_${id}_${folderId || 'unassigned'}`, closed ? '1' : '0');
}

function getUnassignedFolderName() {
  return unassignedSettings?.name || 'Sin carpeta';
}

function getUnassignedFolderColor() {
  return unassignedSettings?.color || '#0f172a';
}

function selectAllVisible() {
  // Selecciona todas las unidades visibles en el grid (unitsCache ya está filtrado por estado/búsqueda)
  unitsCache.forEach(u => selected.add(String(u._id)));

  // Marca checks + clase selected en UI
  grid.querySelectorAll('.unit-card').forEach(card => {
    card.classList.add('selected');
    const cb = card.querySelector('.sel');
    if (cb) cb.checked = true;
  });

  updateSelectAllLabel();
}

function deselectAllVisible() {
  // Quita del set las visibles
  unitsCache.forEach(u => selected.delete(String(u._id)));

  grid.querySelectorAll('.unit-card').forEach(card => {
    card.classList.remove('selected');
    const cb = card.querySelector('.sel');
    if (cb) cb.checked = false;
  });

  updateSelectAllLabel();
}


  async function loadUnits() {
    const estado = filtroEstado ? filtroEstado.value : '';
    const q = buscarInput ? buscarInput.value : '';
    const qEnc = encodeURIComponent(q||'');

    // Una sola fuente canónica: nunca sustituir datos comerciales por la
    // proyección legacy de /api/inventory si falla la carga principal.
    const units = await apiGet(`/api/units?projectId=${id}&estado=${estado}&q=${qEnc}`);
    unitsCache = units;
    INSURANCE_UNITS_CACHE = units;

    // Ventas (dato único)
    try { await loadVentasMap(); } catch(e){ console.warn('ventas map err', e); }
try { await loadCommercialFolders(); } catch(e){ console.warn('folders err', e); }

    // KPIs
    const resumen = {
  disponible: 0,
  inventario: 0,
  reservado: 0,
  con_cpp: 0,
  tramite_legal_activado: 0,
  escriturado_traspasado: 0,
  vivienda_entregada: 0,
  valor: 0
};

units.forEach(u => {
  const estado = normalizeUnitEstadoFrontend(u.estado);
resumen[estado] = (resumen[estado] || 0) + 1;
  resumen.valor += Number(ventasMap.get(String(u._id))?.precioVenta || 0);
});

kpisDiv.innerHTML = [
  { key: 'disponible', label: 'Lotes libres', value: resumen.disponible || 0, sub: 'Listos para venta' },
  { key: 'inventario', label: 'Inventario', value: resumen.inventario || 0, sub: 'En cartera' },
  { key: 'reservado', label: 'Reservados', value: resumen.reservado || 0, sub: 'Separadas' },
  { key: 'cpp', label: 'Con CPP', value: resumen.con_cpp || 0, sub: 'Contrato activo' },
  { key: 'legal', label: 'Trámite legal', value: resumen.tramite_legal_activado || 0, sub: 'En proceso' },
  { key: 'escriturado', label: 'Traspasados', value: resumen.escriturado_traspasado || 0, sub: 'Cerradas' },
  { key: 'entregada', label: 'Vivienda entregada', value: resumen.vivienda_entregada || 0, sub: 'Entregas' },
  { key: 'valor', label: 'Valor total', value: formatProjectMoney(resumen.valor || 0), sub: 'Precio de venta acumulado' }
].map(item => `
  <div class="commercial-kpi-card commercial-kpi-${item.key}">
    <span class="commercial-kpi-label">${item.label}</span>
    <strong class="commercial-kpi-value">${item.value}</strong>
    <span class="commercial-kpi-sub">${item.sub}</span>
  </div>
`).join('');
// ===== ALERTA CPP: 60 días antes de vencimiento =====
function daysUntil(dateValue) {
  if (!dateValue) return null;

  const today = new Date();
  const target = new Date(dateValue);
  if (isNaN(target.getTime())) return null;

  const dateOnly = String(dateValue).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const targetDay = dateOnly
    ? Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());

  return Math.round((targetDay - todayDay) / (1000 * 60 * 60 * 24));
}

function unitLabel(u) {
  const manzanaLote = `${u?.manzana || '-'}-${u?.lote || ''}`.trim();
  return manzanaLote !== '-' ? manzanaLote : (u?.nombre || u?.codigo || u?._id || 'Unidad');
}

function expiryAlertKey(kind, sourceId, due) {
  return `${kind}:${String(sourceId || '')}:${String(due || '')}`;
}

function getCppExpiryAlert(u, venta, { includeOverdue = false } = {}) {
  const days = daysUntil(venta?.fechaVencimientoCPP);

  // Alerta desde 60 días antes; el popup también conserva las ya vencidas.
  if (days === null || (!includeOverdue && days < 0) || days > 60) return null;

  const due = String(venta.fechaVencimientoCPP).slice(0, 10);
  const sourceId = String(venta?._id || u?._id || '');
  return {
    kind: 'cpp',
    sourceId,
    alertKey: expiryAlertKey('cpp', sourceId, due),
    unit: unitLabel(u),
    days,
    due,
    banco: venta?.banco || '',
    cpp: venta?.numCPP || ''
  };
}

async function getCreditLineExpiryAlerts() {
  try {
    const res = await getProjectFinanceSnapshot();
    const lines = res?.financeControl?.loanLines || [];
    return lines.flatMap(line => {
      const entries = Array.isArray(line.entries) && line.entries.length ? line.entries : [line];
      const lineBalance = numOr0(line.balanceAfterSales ?? line.balance ?? line.disbursementAmount);
      if (lineBalance <= 0) return [];
      return entries.map(entry => {
        const days = daysUntil(entry?.maturityDate);
        if (days === null || days > 120) return null;
        const due = String(entry.maturityDate).slice(0, 10);
        const sourceId = String(entry?._id || line?._id || '');
        return {
          kind: 'credit_line',
          sourceId,
          alertKey: expiryAlertKey('credit_line', sourceId, due),
          line: line.name || 'Linea de credito',
          loanNumber: entry?.loanNumber || '',
          days,
          due,
          balance: lineBalance,
        };
      }).filter(Boolean);
    });
  } catch (e) {
    console.warn('[Finance] no se pudieron cargar alertas de vencimiento de lineas', e);
    return [];
  }
}

function updateProjectAlertsButton(alerts = []) {
  if (!projectAlertsBtn) return;
  const count = alerts.length;
  projectAlertsBtn.classList.toggle('has-alerts', count > 0);
  projectAlertsBtn.dataset.alertCount = count > 99 ? '99+' : String(count);
  projectAlertsBtn.title = count ? `Ver ${count} alertas` : 'Ver alertas';
  projectAlertsBtn.setAttribute('aria-label', count ? `Ver ${count} alertas` : 'Ver alertas');
}

function openNoFinanceAlertsPopup() {
  openModal(
    'Alertas',
    `
      <div style="
        border:1px solid rgba(148,163,184,.35);
        border-radius:20px;
        padding:24px;
        background:linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
        color:#0f172a;
        box-shadow:0 18px 45px rgba(15,23,42,.10);
      ">
        <div style="font-size:24px;font-weight:900;margin-bottom:8px;">No hay alertas actualmente</div>
        <div style="color:#64748b;font-size:14px;">No se encontraron vencimientos financieros próximos para este proyecto.</div>
      </div>
    `,
    'Cerrar',
    () => { modalBackdrop.style.display = 'none'; }
  );
}

function showCppExpiryPopup(alerts = [], { force = false } = {}) {
  latestFinanceExpiryAlerts = Array.isArray(alerts) ? alerts : [];
  const canResolveExpiryAlerts = ['admin', 'promoter', 'gerencia', 'socios', 'financiero', 'contable', 'commercial'].includes(myRole);
  updateProjectAlertsButton(latestFinanceExpiryAlerts);
  if (!latestFinanceExpiryAlerts.length) {
    if (force) openNoFinanceAlertsPopup();
    return;
  }
  alerts = latestFinanceExpiryAlerts;
  if (!alerts.length) return;

  const storageKey = `finance-expiry-alerts-shown-${id}-${new Date().toISOString().slice(0,10)}`;
  if (!force) {
    if (sessionStorage.getItem(storageKey) === '1') return;
    sessionStorage.setItem(storageKey, '1');
  }

  const rows = alerts.map(a => `
    <div class="finance-expiry-alert-row" style="
      border:1px solid #fecaca;
      background:#fff1f2;
      border-radius:14px;
      padding:12px 14px;
      margin-bottom:10px;
    ">
      <div style="font-weight:800;color:#991b1b;">
        Faltan ${a.days} días para que venza la CPP de la unidad ${a.unit}
      </div>
      <div class="small" style="margin-top:4px;color:#7f1d1d;">
        Vencimiento: <b>${a.due}</b>
        ${a.banco ? ` · Banco: <b>${a.banco}</b>` : ''}
        ${a.cpp ? ` · CPP: <b>${a.cpp}</b>` : ''}
      </div>
    </div>
  `).join('');

  openModal(
  'Vencimientos financieros próximos',
  `
    <div class="finance-expiry-alert-shell" style="
      border:1px solid rgba(220,38,38,.28);
      border-left:7px solid #dc2626;
      border-radius:22px;
      padding:22px;
      background:
        linear-gradient(135deg, #fff7f7 0%, #ffffff 55%, #f8fafc 100%);
      box-shadow:0 18px 45px rgba(15,23,42,.12);
    ">
      <div class="finance-expiry-alert-heading" style="
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:18px;
        margin-bottom:18px;
      ">
        <div class="finance-expiry-alert-copy">
          <div class="finance-expiry-alert-eyebrow" style="
            font-size:13px;
            font-weight:800;
            letter-spacing:.08em;
            text-transform:uppercase;
            color:#991b1b;
            margin-bottom:6px;
          ">
            Control de riesgo financiero
          </div>

          <div class="finance-expiry-alert-title" style="
            font-size:24px;
            line-height:1.15;
            font-weight:900;
            color:#0f172a;
          ">
            Vencimientos próximos
          </div>

          <div class="finance-expiry-alert-subtitle" style="
            margin-top:7px;
            color:#64748b;
            font-size:14px;
          ">
            Revisa CPP, líneas de crédito, pólizas, fianzas y seguimientos periódicos.
          </div>
        </div>

        <div class="finance-expiry-alert-icon" style="
          min-width:58px;
          height:58px;
          border-radius:18px;
          background:#fee2e2;
          border:1px solid #fecaca;
          display:flex;
          align-items:center;
          justify-content:center;
          font-size:28px;
        ">
          ⚠️
        </div>
      </div>

      <div style="display:grid;gap:12px;">
        ${alerts.map(a => `
          <div class="finance-expiry-alert-item" style="
            border:1px solid #fecaca;
            background:rgba(255,241,242,.82);
            border-radius:18px;
            padding:16px 18px;
            display:flex;
            justify-content:space-between;
            gap:16px;
            align-items:center;
          ">
            <div>
              <div class="finance-expiry-alert-item-title" style="
                font-size:17px;
                font-weight:900;
                color:#991b1b;
              ">
                ${a.kind === 'credit_line'
                  ? `${a.line}${a.loanNumber ? ` · ${a.loanNumber}` : ''}`
                  : a.kind === 'insurance_policy'
                    ? `Póliza ${a.policyType}${a.policyNumber ? ` · ${a.policyNumber}` : ''}`
                    : a.kind === 'performance_bond'
                      ? `Fianza de cumplimiento · ${escapeHtml(a.phaseName || 'Fase')}${a.bondNumber ? ` · ${escapeHtml(a.bondNumber)}` : ''}`
                      : a.kind === 'payment_bond'
                        ? `Fianza de pago · ${escapeHtml(a.phaseName || 'Fase')}${a.bondNumber ? ` · ${escapeHtml(a.bondNumber)}` : ''}`
                        : a.kind === 'engineering_inspection_follow_up'
                          ? `Informe de Inspección de Ingeniería · ${escapeHtml(a.phaseName || 'Fase')}`
                          : a.kind === 'account_advance_follow_up'
                            ? `Cuenta Avance · ${escapeHtml(a.phaseName || 'Fase')}`
                    : `Unidad ${a.unit}`}
              </div>

              <div class="finance-expiry-alert-item-meta" style="
                margin-top:6px;
                color:#7f1d1d;
                font-size:14px;
              ">
                Vencimiento: <b>${a.due}</b>
                ${a.banco ? ` · Banco: <b>${a.banco}</b>` : ''}
                ${a.cpp ? ` · CPP: <b>${a.cpp}</b>` : ''}
                ${a.insurer ? ` · Aseguradora: <b>${escapeHtml(a.insurer)}</b>` : ''}
                ${a.issuer ? ` · Entidad emisora: <b>${escapeHtml(a.issuer)}</b>` : ''}
                ${a.periodicityMonths ? ` · Periodicidad: <b>${escapeHtml(a.periodicityMonths)} meses</b>` : ''}
                ${a.balance ? ` · Saldo: <b>${financeMoney(a.balance)}</b>` : ''}
              </div>
              ${canResolveExpiryAlerts && a.alertKey && a.sourceId ? `
                <button type="button" class="btn btn-xs js-resolve-expiry-alert" data-alert-key="${escapeHtml(a.alertKey)}" style="margin-top:10px;">
                  Marcar como resuelto
                </button>
              ` : ''}
            </div>

            <div class="finance-expiry-alert-days" style="
              min-width:112px;
              text-align:center;
              background:#111827;
              color:#fff;
              border-radius:16px;
              padding:10px 12px;
              box-shadow:0 10px 25px rgba(15,23,42,.18);
            ">
              <div style="font-size:25px;font-weight:950;line-height:1;">
                ${a.days < 0 ? 'Vencido · ' : ''}${a.days} ${Math.abs(a.days) === 1 ? 'día' : 'días'}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `,
  'Entendido',
  () => { modalBackdrop.style.display = 'none'; }
);

  modalBody?.querySelectorAll('.js-resolve-expiry-alert').forEach(button => {
    button.addEventListener('click', async () => {
      const alertItem = alerts.find(item => item.alertKey === button.dataset.alertKey);
      if (!alertItem || button.disabled) return;

      button.disabled = true;
      button.textContent = 'Guardando…';
      try {
        const result = await apiPost(`/api/projects/${id}/expiry-alerts/resolve`, {
          key: alertItem.alertKey,
          kind: alertItem.kind,
          sourceId: alertItem.sourceId,
          due: alertItem.due
        });
        state.project.expiryAlertResolutions = [
          ...(state.project.expiryAlertResolutions || []).filter(item => item.key !== alertItem.alertKey),
          result.resolution
        ];
        latestFinanceExpiryAlerts = latestFinanceExpiryAlerts.filter(item => item.alertKey !== alertItem.alertKey);
        updateProjectAlertsButton(latestFinanceExpiryAlerts);

        if (latestFinanceExpiryAlerts.length) {
          showCppExpiryPopup(latestFinanceExpiryAlerts, { force: true });
        } else {
          modalBackdrop.style.display = 'none';
        }
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Marcar como resuelto';
        alert(error.message || 'No se pudo resolver la alerta');
      }
    });
  });
}

function getInsurancePolicyExpiryAlerts() {
  return projectInsurancePolicies().map(policy => {
    const days = daysUntil(policy.expiryDate);
    if (days === null || days > 30) return null;
    const due = String(policy.expiryDate).slice(0, 10);
    const sourceId = String(policy._id || policy.policyNumber || 'policy');
    return { kind:'insurance_policy', sourceId, alertKey:expiryAlertKey('insurance_policy', sourceId, due), days, due, policyType:policy.type || 'CAR', policyNumber:policy.policyNumber || '', insurer:policy.insurer || '', banco:policy.bank || '' };
  }).filter(Boolean);
}

async function getRequirementBondExpiryAlerts() {
  try {
    const res = await getProjectFinanceSnapshot();
    return (res?.finance?.phases || []).flatMap(phase => (phase.requirements || []).map(requirement => {
      const number = Number(requirement.number);
      if (![25, 26].includes(number)) return null;
      const data = requirement.structuredData || {};
      const days = daysUntil(data.expiryDate);
      const advanceDays = Math.max(0, Number(data.alertDaysBefore ?? 30));
      if (days === null || days > advanceDays) return null;
      const due = String(data.expiryDate).slice(0, 10);
      const sourceId = `${phase._id || 'phase'}:${requirement._id || number}`;
      return {
        kind: number === 25 ? 'performance_bond' : 'payment_bond',
        sourceId,
        alertKey: expiryAlertKey(number === 25 ? 'performance_bond' : 'payment_bond', sourceId, due),
        days,
        due,
        phaseName: phase.name || 'Fase',
        bondNumber: data.bondNumber || '',
        issuer: data.issuer || '',
        advanceDays
      };
    }).filter(Boolean));
  } catch (error) {
    console.warn('[Finance] no se pudieron cargar alertas de vencimiento de fianzas', error);
    return [];
  }
}

async function getPeriodicRequirementAlerts() {
  try {
    const res = await getProjectFinanceSnapshot();
    return (res?.finance?.phases || []).flatMap(phase => (phase.requirements || []).map(requirement => {
      const number = Number(requirement.number);
      if (![27, 29].includes(number)) return null;
      const data = requirement.structuredData || {};
      const days = daysUntil(data.nextReviewDate);
      if (days === null || days > 0) return null;
      const due = String(data.nextReviewDate).slice(0, 10);
      const sourceId = `${phase._id || 'phase'}:${requirement._id || number}`;
      return {
        kind: number === 27 ? 'engineering_inspection_follow_up' : 'account_advance_follow_up',
        sourceId,
        alertKey: expiryAlertKey(number === 27 ? 'engineering_inspection_follow_up' : 'account_advance_follow_up', sourceId, due),
        days,
        due,
        phaseName: phase.name || 'Fase',
        periodicityMonths: data.periodicityMonths || (number === 27 ? 4 : 1)
      };
    }).filter(Boolean));
  } catch (error) {
    console.warn('[Finance] no se pudieron cargar alertas de seguimientos periódicos', error);
    return [];
  }
}

async function getResolvedExpiryAlertKeys() {
  let resolutions = Array.isArray(state.project?.expiryAlertResolutions)
    ? state.project.expiryAlertResolutions
    : [];

  try {
    const response = await API.get(`/api/projects/${id}/expiry-alerts/resolutions?ts=${Date.now()}`);
    resolutions = Array.isArray(response?.resolutions) ? response.resolutions : [];
    if (!state.project) state.project = {};
    state.project.expiryAlertResolutions = resolutions;
  } catch (error) {
    console.warn('[Finance] no se pudieron cargar las alertas resueltas; se usa el estado local', error);
  }

  return new Set(
    resolutions.map(item => String(item?.key || '')).filter(Boolean)
  );
}

async function refreshProjectExpiryAlerts() {
  const cppAlerts = unitsCache
    .map(unit => getCppExpiryAlert(unit, ventasMap.get(String(unit._id)), { includeOverdue: true }))
    .filter(Boolean);
  const creditLineAlerts = await getCreditLineExpiryAlerts();
  const insurancePolicyAlerts = getInsurancePolicyExpiryAlerts();
  const requirementBondAlerts = await getRequirementBondExpiryAlerts();
  const periodicRequirementAlerts = await getPeriodicRequirementAlerts();
  const resolvedExpiryAlertKeys = await getResolvedExpiryAlertKeys();
  showCppExpiryPopup(
    [...cppAlerts, ...creditLineAlerts, ...insurancePolicyAlerts, ...requirementBondAlerts, ...periodicRequirementAlerts]
      .filter(alertItem => !resolvedExpiryAlertKeys.has(alertItem.alertKey))
      .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999))
  );
}
window.refreshProjectExpiryAlerts = refreshProjectExpiryAlerts;

if (projectAlertsBtn) {
  projectAlertsBtn.addEventListener('click', () => {
    showCppExpiryPopup(latestFinanceExpiryAlerts, { force: true });
  });
}
    // Grid
    // ----- Render grid mejorado -----
function getDisplayClienteName(venta, unit) {
  const summaryName = String(venta?.clienteNombre || '').trim();
  if (summaryName) return summaryName;

  const fullName = [
    venta?.primerNombre,
    venta?.segundoNombre,
    venta?.primerApellido,
    venta?.segundoApellido
  ].map(x => String(x || '').trim()).filter(Boolean).join(' ');

  return fullName || venta?.cliente?.nombre || unit?.clienteId?.nombre || '';
}

function renderUnitCard(u) {
  const venta = ventasMap.get(String(u._id));
  const banco = venta?.banco || '';
  const cppAmount = parsePanamaNumber(venta?.montoFinanciamientoCPP ?? venta?.valor ?? 0);
  const cliente = getDisplayClienteName(venta, u);
  const idu = String(u._id);
  const estadoTxt = estadoLabel(u.estado || 'disponible');
  const impago = /mora|impago|rechaz|atras|vencid|moros/i.test(venta?.statusBanco || '');
  const cppAlert = getCppExpiryAlert(u, venta);
  const reservationAlert = reservationAgeInfo(u, venta);
  const applicablePolicies = effectivePoliciesForUnit(u);
  const carAlert = applicablePolicies
    .filter(policy => String(policy.type || 'CAR').toUpperCase() === 'CAR')
    .map(policy => ({ policy, days: daysUntil(policy.expiryDate) }))
    .filter(item => item.days !== null && item.days >= 0 && item.days <= 30)
    .sort((a, b) => a.days - b.days)[0] || null;

  return `
    <div class="unit-card estado-${normalizeUnitEstadoFrontend(u.estado)} ${selected.has(idu) ? 'selected' : ''}"
         data-id="${idu}"
         draggable="true">
      ${impago ? `<span class="alert-ribbon">Impago</span>` : ``}
      ${(cppAlert || carAlert || reservationAlert) ? `<div class="unit-card-expiry-alerts">
        ${reservationAlert ? `<span class="alert-ribbon reservation-alert">${safeVal(reservationAlert.label)}</span>` : ''}
        ${cppAlert ? `<span class="alert-ribbon">CPP vence en ${cppAlert.days} días</span>` : ''}
        ${carAlert ? `<span class="alert-ribbon insurance-alert">CAR vence en ${carAlert.days} días</span>` : ''}
      </div>` : ''}

      <div class="head">
        <div class="title">
          <b>${u.manzana || '-'}-${u.lote || ''}</b>
          <span class="status">${estadoTxt}</span>
        </div>

        <label class="sel-wrap" title="Seleccionar">
          <input type="checkbox" class="sel" ${selected.has(idu) ? 'checked' : ''} />
          <span class="sel-box"></span>
        </label>
      </div>

      <div class="meta">${u.modelo || '—'} — ${u.m2 || 0} m²</div>
      <div class="price">${formatProjectMoney(venta?.precioVenta || 0)}</div>

      <div class="badges">
        ${cliente ? `<span class="chip">${cliente}</span>` : `<span class="chip ghost">Sin cliente</span>`}
        ${banco ? `<span class="chip">Banco: ${banco}</span>` : ``}
        ${cppAmount > 0 ? `<span class="chip">CPP: ${escapeHtml(formatProjectMoney(cppAmount))}</span>` : ``}
        ${applicablePolicies.map(policy => `<span class="chip">${escapeHtml(policy.type)}: ${escapeHtml(policy.policyNumber || 'sin número')}${policy.endorsedToBank ? ' · Endosada' : ' · No endosada'}</span>`).join('')}
      </div>
    </div>`;
}

const byFolder = new Map();

foldersCache.forEach(f => {
  byFolder.set(String(f._id), []);
});

const unassigned = [];

units.forEach(u => {
  const fid = u.folderId ? String(u.folderId) : '';
  if (fid && byFolder.has(fid)) byFolder.get(fid).push(u);
  else unassigned.push(u);
});

grid.innerHTML = `
  <div class="commercial-folders-toolbar">
    <button type="button" class="btn primary" id="btnCrearCarpetaComercial">
      + Crear carpeta
    </button>
  </div>

  <div
  class="commercial-folder unassigned ${isCommercialFolderCollapsed('unassigned') ? 'collapsed' : ''}"
  data-folder-id=""
  style="--folder-color:${getUnassignedFolderColor()};"
  >
    <div class="commercial-folder-head">
      <h3>${getUnassignedFolderName()}</h3>

<div class="folder-actions">
  <span>${unassigned.length} unidades</span>

  <button type="button" class="btn mini folder-toggle" data-id="unassigned">
  ${isCommercialFolderCollapsed('unassigned') ? 'Mostrar' : 'Ocultar'}
  </button>

  <input
    type="color"
    class="folder-color-unassigned"
    value="${getUnassignedFolderColor()}"
    title="Color del sector"
  >

  <button type="button" class="btn mini folder-rename-unassigned">
    Renombrar
  </button>
</div>
    </div>

    <div class="commercial-folder-body">
      ${unassigned.map(renderUnitCard).join('') || `<div class="empty">Arrastra unidades aquí.</div>`}
    </div>
  </div>

  ${foldersCache.map(folder => {
    const folderUnits = byFolder.get(String(folder._id)) || [];
    const color = folder.color || '#0f172a';

    return `
      <div class="commercial-folder ${isCommercialFolderCollapsed(folder._id) ? 'collapsed' : ''}"
     data-folder-id="${folder._id}"
     style="--folder-color:${color};">
        <div class="commercial-folder-head">
          <h3 class="folder-title">${folder.name}</h3>

          <div class="folder-actions">
            <span>${folderUnits.length} unidades</span>

            <button type="button" class="btn mini folder-toggle" data-id="">
            ${isCommercialFolderCollapsed('unassigned') ? 'Mostrar' : 'Ocultar'}
            </button>

            <input
              type="color"
              class="folder-color"
              data-id="${folder._id}"
              value="${color}"
              title="Color de carpeta"
            >

            <button type="button" class="btn mini folder-rename" data-id="${folder._id}">
              Renombrar
            </button>

            <button type="button" class="btn mini danger folder-delete" data-id="${folder._id}">
              Eliminar
            </button>
          </div>
        </div>

        <div class="commercial-folder-body">
          ${folderUnits.map(renderUnitCard).join('') || `<div class="empty">Arrastra unidades aquí.</div>`}
        </div>
      </div>
    `;
  }).join('')}
`;

await refreshProjectExpiryAlerts();

wireUnitCards();
wireCommercialFolders();

// ----- Eventos de tarjeta / checkbox -----
  }
  window.loadUnits = loadUnits;

  function renderUnidadDocsSkeleton(unit) {
  const tag = `${unit?.manzana || '-'}-${unit?.lote || ''}`;

  return `
    <div id="unitDocs" class="unit-docs-wrap">
      <div class="subtle">Documentos de la unidad <b>${tag}</b></div>

      <div id="unitDocDepartments" class="unit-doc-departments"></div>

      <div id="unitDocFolderBar" class="unit-doc-folder-bar"></div>

      <form id="unitUploadForm" class="upload-box">
        <input id="unitFiles" type="file" multiple />
        <input id="unitDocName" type="text" placeholder="Nombre (opcional)" />
        <input id="unitDocExpiry" type="date" placeholder="Fecha de expiración (opcional)" />
        <button type="submit" class="btn">Subir</button>
      </form>

      <div id="unitDocsList" class="docs-list small-gap"></div>
    </div>
  `;
}

function getVisibleDocDepartmentsFrontend() {
  const role = String(myRole || '').toLowerCase().trim();

  if ([
    'admin',
    'bank',
    'promoter',
    'gerencia',
    'socios',
    'financiero',
    'contable',
    'legal'
  ].includes(role)) {
    return [
      { id: 'commercial', label: 'Comercial' },
      { id: 'tecnico', label: 'Técnico' },
      { id: 'legal', label: 'Legal' }
    ];
  }

  if (role === 'commercial') {
    return [{ id: 'commercial', label: 'Comercial' }];
  }

  if (role === 'tecnico') {
    return [{ id: 'tecnico', label: 'Técnico' }];
  }

  return [];
}

async function loadUnitDocFolders(projectId, unitId) {
  const qs = new URLSearchParams({
    projectId,
    unitId
  });

  unitDocFoldersCache = await apiGet(`/api/unit-doc-folders?${qs.toString()}`).catch(() => []);
}

async function refreshUnitDocsUI(projectId, unitId) {
  await loadUnitDocFolders(projectId, unitId);

  if (!unitDocInsideDepartment) {
    renderUnitDocDepartmentCards(projectId, unitId);
    return;
  }

  renderUnitDocInsideDepartment(projectId, unitId);
  renderUnitDocFolderBar(projectId, unitId);

  await loadUnidadDocs(projectId, unitId);
}

function renderUnitDocDepartments(projectId, unitId) {
  const box = document.getElementById('unitDocDepartments');
  if (!box) return;

  const deps = getVisibleDocDepartmentsFrontend();

  if (!deps.length) {
    box.innerHTML = `<div class="small muted">No tienes acceso a carpetas documentales.</div>`;
    return;
  }

  if (!deps.some(d => d.id === unitDocDepartment)) {
    unitDocDepartment = deps[0].id;
  }

  box.innerHTML = deps.map(d => `
    <button
      type="button"
      class="modal-tab ${unitDocDepartment === d.id ? 'active' : ''}"
      data-doc-department="${d.id}">
      ${d.label}
    </button>
  `).join('');

  box.querySelectorAll('[data-doc-department]').forEach(btn => {
    btn.addEventListener('click', async () => {
      unitDocDepartment = btn.dataset.docDepartment;
      unitDocFolderId = '';
      await refreshUnitDocsUI(projectId, unitId);
    });
  });
}

function renderUnitDocDepartmentCards(projectId, unitId) {
  const deps = getVisibleDocDepartmentsFrontend();
  const box = document.getElementById('unitDocs');

  if (!box) return;

  if (!deps.length) {
    box.innerHTML = `<div class="small muted">No tienes acceso a documentos.</div>`;
    return;
  }

  box.innerHTML = `
    <div class="unit-docs-home">
      <div class="unit-docs-home-title">
        Selecciona una carpeta documental
      </div>

      <div class="unit-doc-main-folders">
        ${deps.map(d => `
          <button type="button" class="unit-doc-main-folder" data-doc-department="${d.id}">
            <div class="unit-doc-main-folder-icon">📁</div>
            <div>
              <strong>${d.label}</strong>
              <span>Ver documentos y subcarpetas</span>
            </div>
          </button>
        `).join('')}
      </div>
    </div>
  `;

  box.querySelectorAll('[data-doc-department]').forEach(btn => {
    btn.addEventListener('click', async () => {
      unitDocDepartment = btn.dataset.docDepartment;
      unitDocFolderId = '';
      unitDocInsideDepartment = true;
      await refreshUnitDocsUI(projectId, unitId);
    });
  });
}

function renderUnitDocInsideDepartment(projectId, unitId) {
  const departmentLabel = {
    commercial: 'Comercial',
    tecnico: 'Técnico',
    legal: 'Legal'
  };

  const box = document.getElementById('unitDocs');
  if (!box) return;

  box.innerHTML = `
    <div class="unit-docs-header-clean">
      <button type="button" class="btn mini" id="btnBackUnitDocDepartments">
        ← Carpetas
      </button>

      <div>
        <h3>📁 ${departmentLabel[unitDocDepartment] || 'Documentos'}</h3>
        <p>Sube y organiza documentos de esta área.</p>
      </div>
    </div>

    <div id="unitDocFolderBar" class="unit-doc-folder-bar"></div>

    <form id="unitUploadForm" class="upload-box">
      <input id="unitFiles" type="file" multiple />
      <input id="unitDocName" type="text" placeholder="Nombre (opcional)" />
      <input id="unitDocExpiry" type="date" placeholder="Fecha de expiración (opcional)" />
      <button type="submit" class="btn">Subir</button>
    </form>

    <div id="unitDocsList" class="docs-list small-gap"></div>
  `;

  document.getElementById('btnBackUnitDocDepartments')?.addEventListener('click', async () => {
    unitDocInsideDepartment = false;
    unitDocFolderId = '';
    await refreshUnitDocsUI(projectId, unitId);
  });

  wireUnidadUpload(projectId, unitId);
}

function renderUnitDocFolderBar(projectId, unitId) {
  const bar = document.getElementById('unitDocFolderBar');
  if (!bar) return;

  const folders = (unitDocFoldersCache || [])
    .filter(f => String(f.department) === String(unitDocDepartment));

  bar.innerHTML = `
    <div class="unit-doc-folder-actions">
      <button
        type="button"
        class="btn mini ${!unitDocFolderId ? 'primary' : ''}"
        id="btnUnitDocsRoot">
        📂 Principal
      </button>

      ${folders.map(f => `
        <button
          type="button"
          class="btn mini ${String(unitDocFolderId) === String(f._id) ? 'primary' : ''}"
          data-unit-doc-folder="${f._id}">
          📁 ${f.name}
        </button>
      `).join('')}

      <button type="button" class="btn mini" id="btnCreateUnitDocFolder">
        + Crear subcarpeta
      </button>

      ${unitDocFolderId ? `
        <button type="button" class="btn mini" id="btnRenameUnitDocFolder">
          Renombrar
        </button>

        <button type="button" class="btn mini danger" id="btnDeleteUnitDocFolder">
          Eliminar carpeta
        </button>
      ` : ''}
    </div>
  `;

  document.getElementById('btnUnitDocsRoot')?.addEventListener('click', async () => {
    unitDocFolderId = '';
    await refreshUnitDocsUI(projectId, unitId);
  });

  bar.querySelectorAll('[data-unit-doc-folder]').forEach(btn => {
    btn.addEventListener('click', async () => {
      unitDocFolderId = btn.dataset.unitDocFolder;
      await refreshUnitDocsUI(projectId, unitId);
    });
  });

  document.getElementById('btnCreateUnitDocFolder')?.addEventListener('click', async () => {
    const name = prompt('Nombre de la subcarpeta:');
    if (!name || !name.trim()) return;

    try {
      await apiPost('/api/unit-doc-folders', {
        projectId,
        unitId,
        department: unitDocDepartment,
        name: name.trim()
      });

      await refreshUnitDocsUI(projectId, unitId);
    } catch (e) {
      console.error(e);
      alert('Error creando subcarpeta.');
    }
  });

  document.getElementById('btnRenameUnitDocFolder')?.addEventListener('click', async () => {
    const folder = unitDocFoldersCache.find(f => String(f._id) === String(unitDocFolderId));
    const name = prompt('Nuevo nombre:', folder?.name || '');

    if (!name || !name.trim()) return;

    try {
      await apiPatch(`/api/unit-doc-folders/${unitDocFolderId}`, {
        projectId,
        unitId,
        name: name.trim()
      });

      await refreshUnitDocsUI(projectId, unitId);
    } catch (e) {
      console.error(e);
      alert('Error renombrando subcarpeta.');
    }
  });

  document.getElementById('btnDeleteUnitDocFolder')?.addEventListener('click', async () => {
    const pin = prompt('Introduce el PIN para eliminar esta carpeta:');
    if (!pin) return;

    try {
      await apiDelete(`/api/unit-doc-folders/${unitDocFolderId}`, {
        projectId,
        unitId,
        pin
      });

      unitDocFolderId = '';
      await refreshUnitDocsUI(projectId, unitId);
    } catch (e) {
      console.error(e);
      alert('Error eliminando subcarpeta.');
    }
  });
}

function wireUnitCards() {
  Array.from(grid.querySelectorAll('.unit-card')).forEach(el => {
    const unitId = el.dataset.id;

    el.addEventListener('dragstart', ev => {
      let dragIds = [];

      if (selected.has(unitId)) {
        dragIds = Array.from(selected);
      } else {
        dragIds = [unitId];
      }

      ev.dataTransfer.setData('application/json', JSON.stringify(dragIds));
      ev.dataTransfer.setData('text/plain', unitId);
      ev.dataTransfer.effectAllowed = 'move';

      grid.querySelectorAll('.unit-card').forEach(card => {
        if (dragIds.includes(card.dataset.id)) {
          card.classList.add('dragging');
        }
      });
    });

    el.addEventListener('dragend', () => {
      grid.querySelectorAll('.unit-card.dragging').forEach(card => {
        card.classList.remove('dragging');
      });
    });

    el.addEventListener('click', ev => {
      if (ev.target && (
        ev.target.classList?.contains('sel') ||
        ev.target.classList?.contains('sel-box') ||
        ev.target.closest?.('.sel-wrap')
      )) return;

      abrirFichaUnidad(unitId);
    });

    const cb = el.querySelector('.sel');

    if (cb) {
      cb.addEventListener('change', () => {
        if (cb.checked) {
          selected.add(unitId);
          el.classList.add('selected');
        } else {
          selected.delete(unitId);
          el.classList.remove('selected');
        }

        updateSelectAllLabel();
      });
    }
  });
}

function wireCommercialFolders() {
  document.getElementById('btnCrearCarpetaComercial')?.addEventListener('click', crearCarpetaComercial);

  grid.querySelectorAll('.commercial-folder').forEach(folderEl => {
    folderEl.addEventListener('dragover', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      folderEl.classList.add('is-drag-over');
    });

    folderEl.addEventListener('dragleave', ev => {
      if (!folderEl.contains(ev.relatedTarget)) {
        folderEl.classList.remove('is-drag-over');
      }
    });

    folderEl.addEventListener('drop', async ev => {
  ev.preventDefault();
  ev.stopPropagation();

  folderEl.classList.remove('is-drag-over');
  folderEl.classList.add('is-loading-folder');

  const draggedId = ev.dataTransfer.getData('text/plain');

  let unitIds = [];

  if (selected.has(draggedId)) {
    unitIds = Array.from(selected);
  } else {
    unitIds = [draggedId];
  }

  const folderId = folderEl.dataset.folderId;

  try {

    if (folderId) {

      await apiPatch(`/api/commercial-folders/${folderId}/units`, {
        unitIds
      });

    } else {

      await apiPatch('/api/commercial-folders/unassigned/units', {
        unitIds,
        projectId: id
      });

    }

    await loadUnits();

  } catch (e) {

    console.error(e);
    alert('Error moviendo unidades.');

  } finally {

    folderEl.classList.remove('is-loading-folder');

  }
});
  });

  grid.querySelectorAll('.folder-color').forEach(input => {
    input.addEventListener('change', async ev => {
      ev.stopPropagation();

      const folderId = input.dataset.id;
      const color = input.value || '#0f172a';

      await apiPatch(`/api/commercial-folders/${folderId}`, {
        color
      });

      await loadUnits();
    });
  });

  grid.querySelectorAll('.folder-rename').forEach(btn => {
    btn.addEventListener('click', async ev => {
      ev.stopPropagation();

      const folderId = btn.dataset.id;
      const folder = foldersCache.find(f => String(f._id) === String(folderId));
      const name = prompt('Nuevo nombre de la carpeta:', folder?.name || '');

      if (!name || !name.trim()) return;

      await apiPatch(`/api/commercial-folders/${folderId}`, {
        name: name.trim()
      });

      await loadUnits();
    });
  });

  grid.querySelectorAll('.folder-delete').forEach(btn => {
    btn.addEventListener('click', async ev => {
      ev.stopPropagation();

      const folderId = btn.dataset.id;
      const folder = foldersCache.find(f => String(f._id) === String(folderId));

      const ok = confirm(
        `¿Eliminar la carpeta "${folder?.name || ''}"?\n\nLas unidades NO se eliminarán, volverán a "Sin carpeta".`
      );

      if (!ok) return;

      await apiDelete(`/api/commercial-folders/${folderId}`);

      await loadUnits();
    });
  });

  grid.querySelector('.folder-rename-unassigned')?.addEventListener('click', async ev => {
  ev.preventDefault();
  ev.stopPropagation();

  const current = getUnassignedFolderName();
  const name = prompt('Nuevo nombre:', current);

  if (!name || !name.trim()) return;

  await apiPatch('/api/commercial-folders/unassigned/settings', {
    projectId: id,
    name: name.trim()
  });

  await loadUnits();
});

grid.querySelector('.folder-color-unassigned')?.addEventListener('change', async ev => {
  ev.preventDefault();
  ev.stopPropagation();

  await apiPatch('/api/commercial-folders/unassigned/settings', {
    projectId: id,
    color: ev.target.value || '#0f172a'
  });

  await loadUnits();
});

grid.querySelectorAll('.folder-toggle').forEach(btn => {
  const toggleFolder = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    const folderId = btn.dataset.id || 'unassigned';
    const folderEl = btn.closest('.commercial-folder');
    if (!folderEl) return;

    const closed = !folderEl.classList.contains('collapsed');

    setCommercialFolderCollapsed(folderId, closed);
    folderEl.classList.toggle('collapsed', closed);
    btn.textContent = closed ? 'Mostrar' : 'Ocultar';
  };

  btn.addEventListener('pointerdown', toggleFolder, { passive: false });
  btn.addEventListener('click', ev => {
    ev.preventDefault();
    ev.stopPropagation();
  });
});
}

async function crearCarpetaComercial() {
  if (myRole === 'commercial' && window.__COMMERCIAL_LOCKED) {
    alert('Este proyecto aún no está aprobado. Creación de carpetas bloqueada.');
    return;
  }

  const name = prompt('Nombre de la carpeta:', 'Torre 1');

  if (!name || !name.trim()) return;

  await apiPost('/api/commercial-folders', {
    projectId: id,
    name: name.trim(),
    color: '#0f172a'
  });

  await loadUnits();
}

async function loadUnidadDocs(projectId, unitId) {
  const qs = new URLSearchParams({
    projectId,
    unitId,
    department: unitDocDepartment,
    folderId: unitDocFolderId || ''
  });

  const list = await apiGet(`/api/documents?${qs.toString()}`).catch(() => []);

  const listDiv = document.getElementById('unitDocsList');
  if (!listDiv) return;

  const departmentLabel = {
    commercial: 'Comercial',
    tecnico: 'Técnico',
    legal: 'Legal'
  };

  listDiv.innerHTML = (list || []).map(d => `
    <div class="doc">
      <div>
        <span class="doc-item-title">${escapeHtml(d.originalname || d.name || d.title || 'Documento')}</span>

        <div class="doc-meta">
          ${escapeHtml(d.mimetype || '')} — ${(d.size || 0).toLocaleString()} bytes
        </div>

        <div class="doc-meta">
          Carpeta: ${escapeHtml(departmentLabel[d.department || 'commercial'] || d.department || 'Comercial')}
        </div>

        <div class="doc-expiry ${d.expiryDate && new Date(d.expiryDate) < new Date(Date.now()+30*24*60*60*1000) ? 'warn' : ''}">
          Expira: ${d.expiryDate ? String(d.expiryDate).slice(0,10) : '—'}
        </div>

        ${d.checklistId ? `<div class="doc-meta">Checklist: ${escapeHtml(d.checklistTitle || '')}</div>` : ''}
      </div>

      <div class="doc-actions">
        <a class="btn js-secure-file" href="#" data-url="${secureDocUrl(d._id)}" data-filename="${escapeHtml(d.originalname || d.name || d.title || 'documento')}" data-action="view">Ver</a>
        <button class="btn danger doc-del" data-id="${escapeHtml(d._id)}">Eliminar</button>
      </div>
    </div>
  `).join('') || '<div class="small muted">No hay documentos en esta carpeta.</div>';

  wireUnidadDocDelete(projectId, unitId);
}

function wireUnidadDocDelete(projectId, unitId) {
  const listDiv = document.getElementById('unitDocsList');
  if (!listDiv || listDiv.__wiredDelete) return; // evita doble binding
  listDiv.__wiredDelete = true;

  listDiv.addEventListener('click', async (e) => {
    const btn = e.target.closest('.doc-del');
    if (!btn) return;

    const docId = btn.dataset.id;
    const pin = prompt('Introduce el PIN para eliminar este documento:');
    if (!pin) return;

    try {
      await apiDelete(`/api/documents/${docId}`, { pin }); // el backend valida el PIN
      await loadUnidadDocs(projectId, unitId);             // refresca lista de la unidad
      if (typeof loadDocs === 'function') loadDocs();      // refresca pestaña "Docs" general
    } catch (err) {
      alert('Error eliminando documento: ' + (err?.message || ''));
    }
  });
}

function wireUnidadUpload(projectId, unitId) {
  const form = document.getElementById('unitUploadForm');
  if (!form || form.__wiredUpload) return;

  form.__wiredUpload = true;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const files = document.getElementById('unitFiles')?.files;

    if (!files || !files.length) {
      alert('Selecciona al menos un archivo.');
      return;
    }

    const fd = new FormData();

    fd.append('projectId', projectId);
    fd.append('unitId', unitId);

    // ✅ NUEVO: área documental y subcarpeta
    fd.append('department', unitDocDepartment);
    fd.append('folderId', unitDocFolderId || '');

    const name = document.getElementById('unitDocName')?.value?.trim();
    const exp = document.getElementById('unitDocExpiry')?.value?.trim();

    if (name) fd.append('name', name);
    if (exp) fd.append('expiryDate', exp);

    Array.from(files).forEach(f => fd.append('files', f));

    try {
      await apiUpload('/api/documents/upload', fd);

      form.reset();

      await refreshUnitDocsUI(projectId, unitId);

      if (typeof loadDocs === 'function') loadDocs();
    } catch (err) {
      console.error(err);
      alert('Error subiendo archivos: ' + (err.message || ''));
    }
  });
}

function importLabelForField(field) {
  const labels = {
    clienteNombre: 'Cliente resumen',
    primerNombre: 'Primer nombre',
    segundoNombre: 'Segundo nombre',
    primerApellido: 'Apellido paterno',
    segundoApellido: 'Apellido materno',
    apellidoCasada: 'Apellido de casada',
    cedula: 'Cédula',
    sexo: 'Sexo',
    profesion: 'Profesión',
    estadoCivil: 'Estado civil',
    direccion: 'Dirección',
    telefonoResidencial: 'Teléfono residencial',
    telefonoOficina: 'Teléfono oficina',
    celular: 'Celular',
    correo: 'Correo',
    empresa: 'Empresa',
    lugarTrabajo: 'Lugar de trabajo',
    ingresoMensual: 'Ingreso mensual',
    cargo: 'Cargo',
    antiguedadLaboral: 'Antigüedad laboral',

    cliente2PrimerNombre: 'Cliente 2 - Primer nombre',
    cliente2SegundoNombre: 'Cliente 2 - Segundo nombre',
    cliente2PrimerApellido: 'Cliente 2 - Apellido paterno',
    cliente2SegundoApellido: 'Cliente 2 - Apellido materno',
    cliente2ApellidoCasada: 'Cliente 2 - Apellido de casada',
    cliente2Cedula: 'Cliente 2 - Cédula',
    cliente2Sexo: 'Cliente 2 - Sexo',
    cliente2Profesion: 'Cliente 2 - Profesión',
    cliente2Direccion: 'Cliente 2 - Dirección',
    cliente2LugarTrabajo: 'Cliente 2 - Lugar trabajo',

    pariente1Nombre: 'Pariente 1 - Nombre',
    pariente1Parentesco: 'Pariente 1 - Parentesco',
    pariente1Telefono: 'Pariente 1 - Teléfono',
    pariente1TelefonoTrabajo: 'Pariente 1 - Tel. trabajo',

    pariente2Nombre: 'Pariente 2 - Nombre',
    pariente2Parentesco: 'Pariente 2 - Parentesco',
    pariente2Telefono: 'Pariente 2 - Teléfono',
    pariente2TelefonoTrabajo: 'Pariente 2 - Tel. trabajo',

    referencia1Nombre: 'Referencia 1 - Nombre',
    referencia1Relacion: 'Referencia 1 - Relación',
    referencia1Telefono: 'Referencia 1 - Teléfono',
    referencia1TelefonoTrabajo: 'Referencia 1 - Tel. trabajo',

    referencia2Nombre: 'Referencia 2 - Nombre',
    referencia2Relacion: 'Referencia 2 - Relación',
    referencia2Telefono: 'Referencia 2 - Teléfono',
    referencia2TelefonoTrabajo: 'Referencia 2 - Tel. trabajo',

    lote: 'Lote',
    numeroFinca: 'Número de finca',
    codigoUbicacion: 'Código ubicación',
    ubicacion: 'Ubicación',
    calle: 'Calle',
    modelo: 'Modelo',
    recamaras: 'Recámaras',
    banos: 'Baños',
    metrajeLote: 'Metraje lote',
    areaAbierta: 'Área abierta',
    areaCerrada: 'Área cerrada',
    areaTotalConstruccion: 'Área total construcción',
    valorMejoras: 'Valor mejoras',
    valorTerreno: 'Valor terreno',
    fechaProbableEntrega: 'Fecha probable entrega',

    banco: 'Banco',
    oficialBanco: 'Oficial banco',
    precioVenta: 'Precio venta',
    montoFinanciamientoCPP: 'Monto financiamiento CPP',
    abonoCliente: 'Abono cliente',
    abonoInicial: 'Abono inicial',
    porcentajeFinanciamiento: '% financiamiento',
    cesionAFavorDe: 'Cesión a favor de',
    polizaVida: 'Póliza vida',
    abonoAlte: 'Abono ALTE',

    proformaSolicitadaPor: 'Proforma solicitada por',
    referidoPor: 'Referido por',
    observacionCliente: 'Observación',
  };

  return labels[field] || field;
}

function renderImportWordPreview(unitId, detected, type) {
  const box = document.getElementById('importWordPreview');
  if (!box) return;

  const entries = Object.entries(detected || {});

  if (!entries.length) {
    box.innerHTML = `
      <div class="small muted" style="color:#fff;">
        No se detectaron campos válidos en el Word.
      </div>
    `;
    return;
  }

  box.innerHTML = `
    <div style="
      background:#0f172a;
      border:1px solid rgba(255,255,255,.12);
      border-radius:16px;
      padding:18px;
      color:white;
    ">
      <h4 style="margin-top:0;">
        Vista previa importación: ${type === 'proforma' ? 'Proforma' : 'Ficha cliente'}
      </h4>

      <div class="form-grid-4">
        ${entries.map(([field, value]) => `
          <div class="label">${importLabelForField(field)}</div>
          <input data-import-field="${field}" value="${safeVal(value)}">
        `).join('')}
      </div>

      <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap;">
        <button type="button" class="export-doc-btn primary" id="btnApplyImportWord">
          Aplicar datos a la ficha
        </button>

        <button type="button" class="export-doc-btn" id="btnCancelImportWord">
          Cancelar
        </button>
      </div>
    </div>
  `;

  document.getElementById('btnApplyImportWord')?.addEventListener('click', async () => {
    await aplicarImportWord(unitId);
  });

  document.getElementById('btnCancelImportWord')?.addEventListener('click', () => {
    box.innerHTML = '';
  });
}

async function previewImportWord(unitId) {
  const input = document.getElementById('importWordInput');
  const file = input?.files?.[0];

  if (!file) {
    alert('Selecciona un archivo Word.');
    return;
  }

  const fd = new FormData();
  fd.append('file', file);

  const result = await apiUpload(`/api/import-word/preview/${unitId}`, fd);

  if (!result?.ok) {
    alert(result?.error || 'No se pudo leer el Word');
    return;
  }

  renderImportWordPreview(unitId, result.detected || {}, result.type);
}

async function aplicarImportWord(unitId) {
  const inputs = document.querySelectorAll('[data-import-field]');
  const data = {};

  inputs.forEach(input => {
    const key = input.dataset.importField;
    data[key] = input.value;
  });

  let result;

  try {
    result = await apiPost(`/api/import-word/apply/${unitId}`, { data });
  } catch (e) {
    console.error('[IMPORT WORD] apply error:', e);
    alert('Error aplicando importación. Mira la consola del backend.');
    return;
  }

  if (!result?.ok) {
    alert(result?.error || 'Error aplicando importación');
    return;
  }

  alert('Datos importados correctamente.');

  await loadVentasMap();

  await abrirFichaUnidad(unitId, { mode:fichaMode });

  await loadUnits();
}

function setFichaSaveStatus(text, state = '') {
  const status = document.getElementById('fichaSaveStatus');
  if (!status) return;
  status.textContent = text;
  status.classList.remove('is-pending', 'is-saving', 'is-saved', 'is-error');
  if (state) status.classList.add(`is-${state}`);
}

function scheduleFichaAutosave(delay = 1400) {
  if (!fichaAutosaveReady || fichaMode !== 'commercial' || !fichaUnitId) return;
  fichaDirty = true;
  fichaChangeVersion += 1;
  setFichaSaveStatus('Cambios pendientes · se guardarán automáticamente', 'pending');
  clearTimeout(fichaAutosaveTimer);
  fichaAutosaveTimer = setTimeout(() => {
    guardarFicha({ close: false, silent: true });
  }, delay);
}

  async function abrirFichaUnidad(unitId, options = {}) {
  // La ficha es global: fuera de pantalla completa vive en <body>; dentro del
  // visor fullscreen debe ser hija del elemento fullscreen para poder mostrarse.
  const viewerPanel = document.getElementById('project3dPanel');
  const modalHost = document.fullscreenElement === viewerPanel ? viewerPanel : document.body;
  if (modalFicha && modalFicha.parentElement !== modalHost) modalHost.appendChild(modalFicha);
  clearTimeout(fichaAutosaveTimer);
  fichaAutosaveReady = false;
  fichaDirty = false;
  fichaSaving = false;
  fichaChangeVersion = 0;
  fichaCloseRequested = false;
  fichaEstadoControl = '';
  fichaUnitId = unitId;
  fichaMode = options.mode === 'technical' ? 'technical' : 'commercial';
  modalFicha?.classList.toggle('is-technical', fichaMode === 'technical');

  const u = unitsCache.find(x => String(x._id) === String(unitId)) || await apiGet(`/api/units/${unitId}`);
  const rawV = ventasMap.get(String(unitId)) || {};
  const v = Object.assign(Object.create(null), rawV);

  const info = (txt) => `
  <span class="info-wrap">
    <button type="button" class="info-btn" title="${safeVal(txt)}">i</button>
    <span class="info-tooltip">${safeVal(txt)}</span>
  </span>
`;

  const selectOptions = (opts, current = '') =>
    opts.map(o => `<option value="${o.v}" ${String(current || '') === o.v ? 'selected' : ''}>${o.l}</option>`).join('');

  const selectCustom = (id, label, opts, current = '') => `
    <div class="label">${label}</div>
    <select id="${id}">
      ${selectOptions(opts, current)}
    </select>
  `;

  const bankSelectCustom = (id, label, current = '') => `
    <div class="label">${label}</div>
    <div class="bank-select-field">
      ${window.BankSelect?.bankSelectHtml?.(id, current) || `<input id="${id}" type="text" value="${safeVal(current)}">`}
    </div>
  `;

  const tituloUnidad = document.getElementById('fichaTitulo');
  const unitName = [u.manzana, u.lote].map(value => String(value || '').trim()).filter(Boolean).join('-') || 'Sin nombre';
  const clientName =
    String(v.clienteNombre || '').trim() ||
    [v.primerNombre, v.segundoNombre, v.primerApellido, v.segundoApellido]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .join(' ') ||
    String(v.cliente?.nombre || u.clienteId?.nombre || '').trim() ||
    'Sin cliente';
  const unitStatus = normalizeUnitEstadoFrontend(u.estado);
  fichaEstadoModo = u.estadoModo === 'automatico' ? 'automatico' : 'manual';
  const automaticStatus = normalizeUnitEstadoFrontend(u.estadoAutomaticoSugerido || u.estado);
  const automaticReason = String(u.estadoAutomaticoMotivo || 'Se calculará con los datos del proceso comercial.').trim();
  const fichaProjectName = String(
    state?.project?.name || state?.project?.nombre || state?.project?.title || pname?.textContent || 'Proyecto'
  ).trim();

tituloUnidad.innerHTML = `
  <span class="unit-title-identity">
    <span class="unit-title-kicker">Unidad</span>
    <input id="fu-nombreUnidad" class="unit-title-input" value="${safeVal(unitName)}" data-original-manzana="${safeVal(u.manzana||'')}" data-original-lote="${safeVal(u.lote||'')}" title="Haz click para editar el nombre de la unidad">
    <small>${safeVal(u.modelo || 'Sin modelo')} <i>·</i> ${safeVal(clientName)}</small>
  </span>
  <span class="unit-title-project-name" title="${safeVal(fichaProjectName)}">${safeVal(fichaProjectName)}</span>
  <div class="unit-title-status unit-status-${unitStatus}">
    <span>Estado de la unidad</span>
    <select id="fu-estado">${UNIT_ESTADOS.map(s => `<option value="${s.v}" ${unitStatus === s.v ? 'selected' : ''}>${s.l}</option>`).join('')}</select>
    <span id="fichaEstadoModeBadge" class="unit-state-mode ${fichaEstadoModo === 'automatico' ? 'is-auto' : 'is-manual'}" title="${safeVal(automaticReason)}">${fichaEstadoModo === 'automatico' ? 'Automático' : 'Manual'}</span>
    <button type="button" id="btnFichaEstadoAutomatico" class="unit-state-auto-button" ${fichaEstadoModo === 'automatico' ? 'hidden' : ''} title="Aplicar ahora el estado recomendado: ${safeVal(estadoLabel(automaticStatus))}">Volver a automático</button>
    <span class="unit-status-info">
      <button type="button" class="unit-status-info-button" aria-label="Información sobre los estados comerciales" aria-expanded="false" aria-controls="unitStatusInfoPopover">i</button>
      <span class="unit-status-info-popover" id="unitStatusInfoPopover" role="tooltip">
        <strong>Estados comerciales</strong>
        <span><b>Lote libre:</b> Sin avance de construcción y sin hitos comerciales registrados.</span>
        <span><b>Inventario:</b> El avance de construcción es mayor que 0% y todavía no hay un hito comercial posterior.</span>
        <span><b>Reservado:</b> Se ha registrado la fecha de reserva.</span>
        <span><b>Con CPP:</b> El estatus indica CPP recibida o se ha registrado la fecha de CPP. La fecha cambia automáticamente el selector a CPP recibida.</span>
        <span><b>Trámite legal:</b> Se ha registrado la solicitud de avalúo; no exige completar el resto de ese apartado.</span>
        <span><b>Traspasado:</b> Se ha registrado la fecha de inscripción en Registro Público.</span>
      </span>
    </span>
  </div>
`;

  const statusInfo = tituloUnidad.querySelector('.unit-status-info');
  const statusInfoButton = tituloUnidad.querySelector('.unit-status-info-button');
  const closeStatusInfo = () => {
    statusInfo?.classList.remove('is-open');
    statusInfoButton?.setAttribute('aria-expanded', 'false');
  };
  statusInfoButton?.addEventListener('click', event => {
    event.stopPropagation();
    const willOpen = !statusInfo.classList.contains('is-open');
    statusInfo.classList.toggle('is-open', willOpen);
    statusInfoButton.setAttribute('aria-expanded', String(willOpen));
  });
  statusInfo?.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeStatusInfo();
      statusInfoButton?.focus();
    }
  });
  if (window.__unitStatusInfoOutsideHandler) {
    document.removeEventListener('click', window.__unitStatusInfoOutsideHandler);
  }
  window.__unitStatusInfoOutsideHandler = event => {
    if (!statusInfo?.contains(event.target)) closeStatusInfo();
  };
  document.addEventListener('click', window.__unitStatusInfoOutsideHandler);

  const cont = document.getElementById('fichaContenido');
  cont.innerHTML = `
    <div class="modal-tabs" id="fichaTabs">
  <button class="modal-tab active" data-tab="ficha">Ficha</button>
  <button class="modal-tab" data-tab="docs">Documentos</button>
  ${fichaMode === 'technical' ? '' : '<button class="modal-tab" data-tab="exports">Exportar PDF</button>'}
</div>
    <div id="fichaViews"></div>
  `;

  const htmlUnidad = seccion('Datos de la unidad', `
    <div class="label label-with-info">
  <span>Estado</span>
  ${info('Estado comercial actual de la unidad.')}
</div>
    <select id="fu-estado">
      ${UNIT_ESTADOS
        .map(s => `<option value="${s.v}" ${normalizeUnitEstadoFrontend(u.estado) === s.v ? 'selected' : ''}>${s.l}</option>`)
        .join('')}
    </select>

   <div class="label">Modelo definido ${info('Selecciona una plantilla del proyecto para completar datos base. Puedes dejarlo manual.')}</div>
   <select id="fu-modeloSelect">${projectModelOptions(u.modelId || u.modelo || '')}</select>
   ${input('fu-modelo', `Modelo ${info('Modelo de vivienda asignado. Según el modelo seleccionado deberían completarse automáticamente áreas, recámaras y baños definidos por administración.')}`, u.modelo || '')}
${inputNum('fu-m2', `m² unidad ${info('Área general de la unidad. Puede servir como referencia rápida, aunque el modelo Bank73 separa metraje de lote, área abierta, área cerrada y área total de construcción.')}`, u.m2 || 0)}
${inputNum('fu-costo', `Coste de la unidad ${info('Coste base heredado del modelo. Puedes modificarlo solo para esta unidad sin cambiar las demÃ¡s.')}`, u.costoUnidad || 0)}

${input('fv-numeroFinca', `Número de finca ${info('Identificador registral del inmueble. Según el modelo, este dato debería ser gestionado principalmente por administración.')}`, u.numeroFinca || '')}
${input('fv-codigoUbicacion', `Código de ubicación ${info('Código de ubicación registral o catastral del inmueble. Dato administrativo/legal del bien.')}`, u.codigoUbicacion || '')}
${input('fv-calle', `Calle ${info('Calle o vial interno donde se encuentra la unidad dentro del proyecto.')}`, u.calle || '')}

${selectCustom('fv-loteEsquina', `Lote esquina ${info('Indica si el lote es esquinero. Puede afectar precio, metraje adicional o condiciones comerciales.')}`, [
  { v: '', l: '—' },
  { v: 'SI', l: 'Sí' },
  { v: 'NO', l: 'No' }
], u.loteEsquina || '')}
${inputNum('fv-metrosExtra', `M² extra ${info('Metros adicionales asociados al lote o a condiciones especiales del inmueble.')}`, u.metrosExtra || 0)}
${inputNum('fv-precioLoteEsquina', `Precio lote esquinero ${info('Importe adicional aplicable si la unidad corresponde a lote de esquina.')}`, u.precioLoteEsquina || 0)}
${inputNum('fv-precioM2Extra', `Precio m² extra ${info('Precio aplicado por cada metro cuadrado adicional.')}`, u.precioM2Extra || 0)}

${inputNum('fv-areaAbierta', `Área abierta vivienda (m²) ${info('Área abierta de la vivienda. Según el modelo, debería completarse automáticamente al seleccionar el modelo definido por administración.')}`, u.areaAbierta || 0)}
${inputNum('fv-areaCerrada', `Área cerrada vivienda (m²) ${info('Área cerrada de la vivienda. Según el modelo, debería venir asociada al modelo de vivienda seleccionado.')}`, u.areaCerrada || 0)}
${inputNum('fv-areaTotalConstruccion', `Área total construcción (m²) ${info('Se calcula automáticamente como área abierta + área cerrada.')}`, (parseDecimalMeasureNumber(u.areaAbierta || 0) + parseDecimalMeasureNumber(u.areaCerrada || 0)), { readonly: true })}
${inputNum('fv-recamaras', `Recámaras ${info('Cantidad de recámaras. Según el modelo, debería completarse automáticamente según la tipología de vivienda.')}`, u.recamaras || 0)}
${inputNum('fv-banos', `Baños ${info('Cantidad de baños. Según el modelo, debería completarse automáticamente según la tipología de vivienda.')}`, u.banos || 0)}

${inputNum('fv-valorMejoras', `Valor mejoras ${info('Valor de las mejoras/construcción. En el modelo se calcula como precio de venta menos valor del terreno.')}`, u.valorMejoras || 0)}
${inputNum('fv-valorTerreno', `Valor terreno ${info('Valor asignado al terreno dentro del precio total de la unidad.')}`, u.valorTerreno || 0)}
`);

  const htmlInsurance = seccion('Póliza CAR / incendio aplicable', `
    <div class="insurance-unit-current">${insurancePolicyCardsHtml(effectivePoliciesForUnit(u), { showCoverage:true, editable:true })}</div>
    <details data-unit-policy-manager style="grid-column:1/-1;margin-top:10px;"><summary><strong>Crear y asignar una póliza</strong></summary>
      <p class="small muted">Selecciona todas las unidades cubiertas por esta misma póliza. Una unidad no puede tener dos pólizas del mismo tipo.</p>
      <div data-unit-policy-editor>${insurancePolicyEditorRow({}, { defaultUnitId:unitId })}</div>
      <div class="insurance-policy-editor-actions"><button type="button" class="btn btn-ghost" data-save-unit-policy>Guardar póliza</button><button type="button" class="btn btn-ghost" data-cancel-unit-policy>Cancelar</button></div>
    </details>
  `);

  const htmlUnidadTechnical = seccion('Datos de la unidad', `
    <div class="label label-with-info"><span>Estado</span>${info('Mismo estado de la unidad utilizado en Comercial.')}</div>
    <select id="fu-estado">
      ${UNIT_ESTADOS.map(s => `<option value="${s.v}" ${normalizeUnitEstadoFrontend(u.estado) === s.v ? 'selected' : ''}>${s.l}</option>`).join('')}
    </select>
    <div class="label">Modelo definido ${info('Modelo o tipología compartida con Comercial.')}</div>
    <select id="fu-modeloSelect">${projectModelOptions(u.modelId || u.modelo || '')}</select>
    ${input('fu-modelo', `Modelo ${info('Nombre del modelo o tipología de vivienda.')}`, u.modelo || '')}
    ${inputNum('fu-m2', `m² unidad ${info('Área general registrada para la unidad.')}`, u.m2 || 0)}
    ${inputNum('fu-costo', `Coste de la unidad ${info('Coste base compartido con la ficha canónica de la unidad.')}`, u.costoUnidad || 0)}
    ${input('fv-numeroFinca', `Número de finca ${info('Identificador registral del inmueble.')}`, u.numeroFinca || '')}
    ${input('fv-codigoUbicacion', `Código de ubicación ${info('Código registral o catastral.')}`, u.codigoUbicacion || '')}
    ${input('fv-calle', `Calle ${info('Calle o vial interno de la unidad.')}`, u.calle || '')}
    ${inputNum('fv-metrosExtra', `M² extra ${info('Metros adicionales asociados al inmueble.')}`, u.metrosExtra || 0)}
    ${inputNum('fv-precioM2Extra', `Precio m² extra ${info('Valor registrado para cada metro adicional.')}`, u.precioM2Extra || 0)}
    ${inputNum('fv-areaAbierta', `Área abierta vivienda (m²) ${info('Área abierta definida para esta unidad.')}`, u.areaAbierta || 0)}
    ${inputNum('fv-areaCerrada', `Área cerrada vivienda (m²) ${info('Área cerrada definida para esta unidad.')}`, u.areaCerrada || 0)}
    ${inputNum('fv-areaTotalConstruccion', `Área total construcción (m²) ${info('Se calcula como área abierta más área cerrada.')}`, (parseDecimalMeasureNumber(u.areaAbierta || 0) + parseDecimalMeasureNumber(u.areaCerrada || 0)), { readonly:true })}
    ${inputNum('fv-recamaras', `Recámaras ${info('Cantidad definida en la tipología.')}`, u.recamaras || 0)}
    ${inputNum('fv-banos', `Baños ${info('Cantidad definida en la tipología.')}`, u.banos || 0)}
    ${inputNum('fv-valorMejoras', `Valor mejoras ${info('Valor compartido con la ficha de la unidad.')}`, u.valorMejoras || 0)}
    ${inputNum('fv-valorTerreno', `Valor terreno ${info('Valor compartido con la ficha de la unidad.')}`, u.valorTerreno || 0)}
  `);

const htmlCliente1 = seccion('Cliente 1 / Solicitante principal', `
${input('fv-clienteNombre', `Nickname ${info('Nombre resumen del cliente para búsquedas, tarjetas y reportes comerciales.')}`, v.clienteNombre || '')}
${input('fv-primerNombre', `Primer nombre ${info('Primer nombre del solicitante principal.')}`, v.primerNombre || '')}
${input('fv-segundoNombre', `Segundo nombre ${info('Segundo nombre del solicitante principal, si aplica.')}`, v.segundoNombre || '')}
${input('fv-primerApellido', `Apellido paterno ${info('Primer apellido del solicitante principal.')}`, v.primerApellido || '')}
${input('fv-segundoApellido', `Apellido materno ${info('Segundo apellido del solicitante principal.')}`, v.segundoApellido || '')}
${input('fv-apellidoCasada', `Apellido de casada ${info('Apellido de casada del solicitante, si aplica.')}`, v.apellidoCasada || '')}

${input('fv-cedula', `Cédula ${info('Documento de identidad del cliente. Forma parte de la documentación base para aprobación bancaria.')}`, v.cedula || '')}
${selectCustom('fv-sexo', `Sexo ${info('Dato de identificación del cliente.')}`, [
  { v: '', l: '—' },
  { v: 'M', l: 'Masculino' },
  { v: 'F', l: 'Femenino' }
], v.sexo || '')}
${input('fv-profesion', `Profesión ${info('Profesión u ocupación del cliente. Ayuda a clasificar el perfil financiero.')}`, v.profesion || '')}
${selectCustom('fv-estadoCivil', `Estado civil ${info('Estado civil del cliente. El modelo contempla principalmente Soltero o Casado.')}`, [
  { v: '', l: '—' },
  { v: 'Soltero', l: 'Soltero' },
  { v: 'Casado', l: 'Casado' }
], v.estadoCivil || '')}

${input('fv-direccion', `Dirección / domicilio ${info('Dirección actual donde reside el cliente.')}`, v.direccion || '')}
${input('fv-telefonoResidencial', `Teléfono residencial ${info('Teléfono fijo o residencial del cliente, si aplica.')}`, v.telefonoResidencial || '')}
${input('fv-telefonoOficina', `Teléfono oficina ${info('Teléfono laboral o de oficina del cliente, si aplica.')}`, v.telefonoOficina || '')}
${input('fv-celular', `Celular ${info('Teléfono móvil principal del cliente.')}`, v.celular || '')}
${input('fv-correo', `Correo electrónico ${info('Correo electrónico del cliente para contacto y seguimiento documental.')}`, v.correo || '')}

${selectCustom('fv-perfilCliente', `Perfil ${info('Perfil laboral del cliente. Define qué documentación debe solicitarse para aprobación: asalariado o independiente.')}`, [
  { v: '', l: '—' },
  { v: 'Independiente', l: 'Independiente' },
  { v: 'Asalariado', l: 'Asalariado' }
], v.perfilCliente || '')}
${selectCustom('fv-tipoEmpresa', `Tipo de empresa ${info('Tipo de empleador del cliente asalariado: empresa privada o gubernamental.')}`, [
  { v: '', l: '—' },
  { v: 'Privada', l: 'Privada' },
  { v: 'Gubernamental', l: 'Gubernamental' }
], v.tipoEmpresa || '')}
${selectCustom('fv-sectorEmpresa', `Sector empresarial ${info('Sector o actividad del cliente. El modelo contempla agrícola, profesional idóneo u otros.')}`, [
  { v: '', l: '—' },
  { v: 'Agrícola', l: 'Agrícola' },
  { v: 'Profesional idóneo', l: 'Profesional idóneo' },
  { v: 'Otros', l: 'Otros' }
], v.sectorEmpresa || '')}

${inputNum('fv-ingresoMensual', `Ingreso mensual ${info('Ingreso mensual declarado del cliente para análisis de capacidad de pago.')}`, v.ingresoMensual || 0)}
${input('fv-cargo', `Cargo que desempeña ${info('Cargo, puesto o función del cliente dentro de la empresa.')}`, v.cargo || '')}
${input('fv-antiguedadLaboral', `Antigüedad laboral ${info('Tiempo que lleva el cliente en su empleo o actividad actual.')}`, v.antiguedadLaboral || '')}
`);

const htmlCliente2 = seccion('Cliente 2 / Co-solicitante', `
${input('fv-cliente2PrimerNombre', `Primer nombre ${info('Primer nombre del co-solicitante, si existe.')}`, v.cliente2PrimerNombre || '')}
${input('fv-cliente2SegundoNombre', `Segundo nombre ${info('Segundo nombre del co-solicitante, si aplica.')}`, v.cliente2SegundoNombre || '')}
${input('fv-cliente2PrimerApellido', `Apellido paterno ${info('Primer apellido del co-solicitante.')}`, v.cliente2PrimerApellido || '')}
${input('fv-cliente2SegundoApellido', `Apellido materno ${info('Segundo apellido del co-solicitante.')}`, v.cliente2SegundoApellido || '')}
${input('fv-cliente2ApellidoCasada', `Apellido de casada ${info('Apellido de casada del co-solicitante, si aplica.')}`, v.cliente2ApellidoCasada || '')}
${input('fv-cliente2Cedula', `Cédula ${info('Documento de identidad del co-solicitante.')}`, v.cliente2Cedula || '')}

${selectCustom('fv-cliente2Sexo', `Sexo ${info('Dato de identificación del co-solicitante.')}`, [
  { v: '', l: '—' },
  { v: 'M', l: 'Masculino' },
  { v: 'F', l: 'Femenino' }
], v.cliente2Sexo || '')}
${input('fv-cliente2Profesion', `Profesión ${info('Profesión u ocupación del co-solicitante.')}`, v.cliente2Profesion || '')}
${selectCustom('fv-cliente2EstadoCivil', `Estado civil ${info('Estado civil del co-solicitante.')}`, [
  { v: '', l: '—' },
  { v: 'Soltero', l: 'Soltero' },
  { v: 'Casado', l: 'Casado' }
], v.cliente2EstadoCivil || '')}
${input('fv-cliente2Direccion', `Dirección / domicilio ${info('Dirección actual donde reside el co-solicitante.')}`, v.cliente2Direccion || '')}

${input('fv-cliente2TelefonoResidencial', `Teléfono residencial ${info('Teléfono residencial del co-solicitante, si aplica.')}`, v.cliente2TelefonoResidencial || '')}
${input('fv-cliente2TelefonoOficina', `Teléfono oficina ${info('Teléfono laboral o de oficina del co-solicitante.')}`, v.cliente2TelefonoOficina || '')}
${input('fv-cliente2Celular', `Celular ${info('Teléfono móvil principal del co-solicitante.')}`, v.cliente2Celular || '')}
${input('fv-cliente2Correo', `Correo ${info('Correo electrónico del co-solicitante.')}`, v.cliente2Correo || '')}

${inputNum('fv-cliente2IngresoMensual', `Ingreso mensual ${info('Ingreso mensual declarado del co-solicitante.')}`, v.cliente2IngresoMensual || 0)}
${input('fv-cliente2Cargo', `Cargo ${info('Cargo o función laboral del co-solicitante.')}`, v.cliente2Cargo || '')}
${input('fv-cliente2AntiguedadLaboral', `Antigüedad laboral ${info('Tiempo que lleva el co-solicitante en su empleo o actividad actual.')}`, v.cliente2AntiguedadLaboral || '')}
`);

const htmlReferencias = seccion('Referencias personales', `
${input('fv-referencia1Nombre', `Referencia 1 - Nombre ${info('Nombre de la primera referencia personal.')}`, v.referencia1Nombre || '')}
${input('fv-referencia1Relacion', `Referencia 1 - Relación ${info('Relación de la referencia con el cliente.')}`, v.referencia1Relacion || '')}
${input('fv-referencia1Telefono', `Referencia 1 - Teléfono ${info('Teléfono principal de la referencia.')}`, v.referencia1Telefono || '')}
${input('fv-referencia1TelefonoTrabajo', `Referencia 1 - Tel. trabajo ${info('Teléfono laboral de la referencia, si aplica.')}`, v.referencia1TelefonoTrabajo || '')}

${input('fv-referencia2Nombre', `Referencia 2 - Nombre ${info('Nombre de la segunda referencia personal.')}`, v.referencia2Nombre || '')}
${input('fv-referencia2Relacion', `Referencia 2 - Relación ${info('Relación de la segunda referencia con el cliente.')}`, v.referencia2Relacion || '')}
${input('fv-referencia2Telefono', `Referencia 2 - Teléfono ${info('Teléfono principal de la segunda referencia.')}`, v.referencia2Telefono || '')}
${input('fv-referencia2TelefonoTrabajo', `Referencia 2 - Tel. trabajo ${info('Teléfono laboral de la segunda referencia, si aplica.')}`, v.referencia2TelefonoTrabajo || '')}
`, 'form-grid-2');

const htmlFinanciamiento = seccion('Financiamiento / Proforma', `
${inputNum('fv-precioVenta', `Precio de venta ${info('Precio comercial único de la unidad.')}`, v.precioVenta || 0)}
${inputDate('fv-fechaProbableEntrega', `Fecha probable de entrega ${info('Fecha estimada de entrega de la vivienda. Se mueve a financiamiento por seguimiento de crédito/desembolsos.')}`, v.fechaProbableEntrega)}
${inputNum('fv-montoFinanciamientoCPP', `Monto financiamiento CPP / hipoteca ${info('Monto financiado mediante Carta Promesa de Pago o hipoteca aprobada.')}`, v.montoFinanciamientoCPP || v.valor || 0)}
${inputNum('fv-abonoInicial', `Abono inicial ${info('Se usa para calcular automáticamente el monto de financiamiento como precio de venta menos abono inicial.')}`, v.abonoInicial || 0)}
${inputNum('fv-porcentajeFinanciamiento', `% financiamiento ${info('Porcentaje del precio de venta cubierto por financiamiento bancario.')}`, v.porcentajeFinanciamiento || 0)}
${input('fv-cesionAFavorDe', `Cesión a favor de ${info('Entidad o banco a favor de quien se realiza la cesión de la CPP, si aplica.')}`, v.cesionAFavorDe || '')}

${bankSelectCustom('fv-banco', `Banco del cliente ${info('Banco que tramita o aprueba el financiamiento del cliente.')}`, v.banco || '')}
${input('fv-oficialBanco', `Oficial de trámite / crédito ${info('Oficial bancario encargado del expediente de crédito del cliente.')}`, v.oficialBanco || '')}
${inputDate('fv-fechaProforma', `Fecha proforma ${info('Fecha de emisión de la proforma comercial.')}`, v.fechaProforma)}

${selectRow('fv-statusBancoSel', `Status en Banco ${info('Estado actual del expediente en el banco: proforma, revisión, aprobado, desembolso, escriturado u otro.')}`, '')}
<div class="label" id="fv-statusBancoOtherLbl" style="display:none;">Especificar (OTRO)</div>
<input id="fv-statusBancoOther" style="display:none;" placeholder="Especificar (OTRO)...">

${selectCustom('fv-estatusCPP', `Estatus de CPP ${info('Estado de avance de la Carta Promesa de Pago: documentación entregada, en comité, aprobado o CPP recibida.')}`, [
  { v: '', l: '—' },
  { v: 'Documentación entregada', l: 'Documentación entregada' },
  { v: 'En comité', l: 'En comité' },
  { v: 'Aprobado', l: 'Aprobado' },
  { v: 'CPP recibida', l: 'CPP recibida' }
], v.estatusCPP || '')}
${input('fv-numCPP', `N° CPP ${info('Número o referencia de la Carta Promesa de Pago emitida por el banco.')}`, v.numCPP || '')}
${inputNum('fv-plazoAprobacionDias', `Plazo aprobación (días) ${info('Plazo estimado o pactado para aprobación del financiamiento.')}`, v.plazoAprobacionDias)}
${inputDate('fv-fechaValorCPP', `Fecha valor CPP ${info('Fecha de emisión o valor de la CPP.')}`, v.fechaValorCPP)}
${inputDate('fv-fechaVencimientoCPP', `Vencimiento CPP ${info('Fecha de vencimiento de la CPP. El modelo sugiere generar alerta aproximadamente dos meses antes del vencimiento.')}`, v.fechaVencimientoCPP)}

${inputChk('fv-aperturaCtaBanco', `Apertura cuenta banco ${info('Checklist para confirmar si el cliente abrió la cuenta bancaria requerida.')}`, !!v.aperturaCtaBanco)}
${inputChk('fv-pagoMinuta', `Pago minuta ${info('Control de pago relacionado con minuta o trámite legal, si aplica.')}`, !!v.pagoMinuta)}
${inputChk('fv-polizas', `Pólizas ${info('Checklist para confirmar gestión de pólizas requeridas por el financiamiento.')}`, !!v.polizas)}
${selectCustom('fv-tipoPoliza', `Tipo de póliza ${info('Tipo de póliza asociada al financiamiento: endosada o colectiva.')}`, [
  { v: '', l: '—' },
  { v: 'Endosada', l: 'Endosada' },
  { v: 'Colectiva', l: 'Colectiva' }
], v.tipoPoliza || '')}
`);

const htmlContrato = seccion('Contrato / Protocolo / Notaría / Registro Público', `
${inputDate('fv-fechaContratoCliente', `Fecha contrato firmado por cliente ${info('Fecha en que el cliente firma el contrato promesa de compraventa.')}`, v.fechaContratoCliente)}
${inputNum('fv-montoContrato', `Monto del contrato ${info('Monto reflejado en el contrato promesa de compraventa.')}`, v.montoContrato || 0)}
${input('fv-pagare', `Pagaré ${info('Referencia o estado del pagaré, si el flujo legal/financiero lo requiere.')}`, v.pagare || '')}
${inputChk('fv-contratoFirmado', `Contrato firmado ${info('Checklist para confirmar que el contrato promesa de compraventa fue firmado.')}`, !!v.contratoFirmado)}

${inputDate('fv-fechaActivacionTramite', `Fecha activación trámite legal ${info('Fecha en la que se activa formalmente el trámite legal de la unidad.')}`, v.fechaActivacionTramite)}

${inputChk('fv-protocoloFirmaCliente', `Protocolo firma cliente ${info('Checklist para confirmar firma de protocolo por parte del cliente.')}`, !!v.protocoloFirmaCliente)}
${inputDate('fv-fechaEntregaBanco', `Fecha entrega a banco ${info('Fecha de entrega del protocolo o documentación legal al banco correspondiente.')}`, v.fechaEntregaBanco)}
${inputChk('fv-protocoloFirmaRLBancoInter', `Protocolo firma RL / Banco Inter ${info('Checklist para confirmar firma del representante legal o banco interino.')}`, !!v.protocoloFirmaRLBancoInter)}
${inputDate('fv-fechaRegresoBanco', `Fecha regreso banco ${info('Fecha en que el documento/protocolo regresa desde el banco.')}`, v.fechaRegresoBanco)}
${inputNum('fv-diasTranscurridosBanco', `Días transcurridos banco ${info('Días transcurridos entre entrega al banco y regreso del documento.')}`, v.diasTranscurridosBanco)}

${inputDate('fv-fechaEntregaProtocoloBancoCli', `Entrega protocolo banco cliente ${info('Fecha de entrega del protocolo al banco del cliente.')}`, v.fechaEntregaProtocoloBancoCli)}
${inputChk('fv-firmaProtocoloBancoCliente', `Firma protocolo banco cliente ${info('Checklist para confirmar firma del protocolo por parte del banco del cliente.')}`, !!v.firmaProtocoloBancoCliente)}
${inputDate('fv-fechaRegresoProtocoloBancoCli', `Regreso protocolo banco cliente ${info('Fecha en la que regresa el protocolo firmado por el banco del cliente.')}`, v.fechaRegresoProtocoloBancoCli)}
${inputNum('fv-diasTranscurridosProtocolo', `Días transcurridos protocolo ${info('Días transcurridos en el ciclo de protocolo con el banco del cliente.')}`, v.diasTranscurridosProtocolo)}

${inputChk('fv-pagoImpuestos', `Pago de impuestos ${info('Checklist para confirmar pago de impuestos antes del cierre o inscripción.')}`, !!v.pagoImpuestos)}
${inputDate('fv-fechaPagoImpuesto', `Fecha pago impuestos ${info('Fecha en la que se realizó el pago de impuestos correspondiente.')}`, v.fechaPagoImpuesto)}
${inputChk('fv-cierreNotaria', `Cierre de notaría ${info('Checklist para confirmar que el expediente fue cerrado en notaría.')}`, !!v.cierreNotaria)}
${inputChk('fv-ingresoRP', `Ingreso al RP ${info('Checklist para confirmar ingreso del trámite al Registro Público.')}`, !!v.ingresoRP)}
${inputDate('fv-fechaIngresoRP', `Fecha ingreso RP ${info('Fecha de ingreso del documento al Registro Público.')}`, v.fechaIngresoRP)}
${inputDate('fv-fechaInscripcion', `Fecha inscripción ${info('Fecha de inscripción definitiva en Registro Público.')}`, v.fechaInscripcion)}
${inputChk('fv-solicitudDesembolso', `Solicitud desembolso ${info('Checklist para confirmar que se solicitó el desembolso correspondiente.')}`, !!v.solicitudDesembolso)}
${inputDate('fv-fechaDesembolso', `Fecha desembolso ${info('Fecha efectiva del desembolso del financiamiento.')}`, v.fechaDesembolso)}
${inputDate('fv-fechaRecibidoCheque', `Fecha recibido cheque ${info('Fecha en la que se recibe cheque o pago asociado al desembolso.')}`, v.fechaRecibidoCheque)}
`);

const htmlTecnico = seccion('Técnico / Permisos / Construcción', `
${inputChk('fv-enConstruccion', `En construcción ${info('Indica si la unidad se encuentra actualmente en proceso constructivo.')}`, !!v.enConstruccion)}
${selectCustom('fv-estatusConstruccion', `Estatus construcción ${info('Estado técnico de avance de la vivienda: pendiente, obra gris, acabados o culminada.')}`, [
  { v: '', l: '—' },
  { v: 'Pendiente', l: 'Pendiente' },
  { v: 'Obra gris', l: 'Obra gris' },
  { v: 'Acabados', l: 'Acabados' },
  { v: 'Culminada', l: 'Culminada' }
], v.estatusConstruccion || '')}
${inputChk('fv-permisoConstruccionMunicipal', `Permiso construcción municipal ${info('Checklist para confirmar existencia del permiso de construcción municipal.')}`, !!v.permisoConstruccionMunicipal)}
${input('fv-permisoConstruccionNum', `Resolución permiso construcción ${info('Número de resolución del permiso de construcción municipal.')}`, v.permisoConstruccionNum || '')}
${inputChk('fv-permisoOcupacion', `Permiso ocupación municipal ${info('Checklist para confirmar existencia del permiso de ocupación municipal.')}`, !!v.permisoOcupacion)}
${input('fv-permisoOcupacionNum', `Resolución permiso ocupación ${info('Número de resolución del permiso de ocupación municipal.')}`, v.permisoOcupacionNum || '')}
${inputDate('fv-fechaEmisionPermisoOcupacion', `Fecha emisión permiso ocupación ${info('Fecha en la que fue emitido el permiso de ocupación municipal.')}`, v.fechaEmisionPermisoOcupacion)}
${input('fv-constructora', `Constructor / constructora ${info('Empresa o responsable de la construcción de la vivienda.')}`, v.constructora || '')}
`);

const htmlLegal = seccion('Legal / Avalúo / Minutas / Paz y salvo', `
${input('fv-solicitudAvaluo', `Solicitud de avalúo ${info('Estado o referencia de la solicitud de avalúo de la unidad.')}`, v.solicitudAvaluo || '')}
${input('fv-avaluoRealizado', `Avalúo realizado ${info('Indica si el avalúo fue realizado o su estado actual.')}`, v.avaluoRealizado || '')}
${inputDate('fv-fechaAvaluo', `Fecha avalúo ${info('Fecha en la que se realizó el avalúo.')}`, v.fechaAvaluo)}
${input('fv-empresaAvaluadora', `Empresa avaluadora ${info('Empresa responsable del avalúo de la unidad.')}`, v.empresaAvaluadora || '')}

${selectCustom('fv-mLiberacion', `Minuta liberación / desafectación ${info('Estado de la minuta de liberación o desafectación: solicitada, lista o no aplica.')}`, [
  { v: '', l: '—' },
  { v: 'Solicitada', l: 'Solicitada' },
  { v: 'Lista', l: 'Lista' },
  { v: 'No aplica', l: 'No aplica' }
], v.mLiberacion || '')}
${selectCustom('fv-mSegregacion', `Minuta segregación / venta ${info('Estado de la minuta de segregación o venta: solicitada, lista o no aplica.')}`, [
  { v: '', l: '—' },
  { v: 'Solicitada', l: 'Solicitada' },
  { v: 'Lista', l: 'Lista' },
  { v: 'No aplica', l: 'No aplica' }
], v.mSegregacion || '')}
${selectCustom('fv-mPrestamo', `Minuta préstamo ${info('Estado de la minuta de préstamo del banco cliente: solicitada, lista o no aplica.')}`, [
  { v: '', l: '—' },
  { v: 'Solicitada', l: 'Solicitada' },
  { v: 'Lista', l: 'Lista' },
  { v: 'No aplica', l: 'No aplica' }
], v.mPrestamo || '')}

${inputChk('fv-pazSalvoGesproban', `Paz y salvo Gesproban ${info('Checklist interno para confirmar paz y salvo de Gesproban, si aplica al proceso.')}`, !!v.pazSalvoGesproban)}
${inputChk('fv-pazSalvoPromotora', `Paz y salvo Promotora ${info('Checklist para confirmar paz y salvo de la promotora antes de cierre o entrega.')}`, !!v.pazSalvoPromotora)}
`);

// Bono MIVI retirado: se mantiene comentado para conservar la referencia histórica.
// const htmlMivi = seccion('MIVI', `
// ${input('fv-expedienteMIVI', `Expediente MIVI ${info('Número o referencia del expediente MIVI, si aplica.')}`, v.expedienteMIVI || '')}
// ${inputDate('fv-entregaExpMIVI', `Fecha entrega exp. MIVI ${info('Fecha de entrega del expediente al MIVI.')}`, v.entregaExpMIVI)}
// ${input('fv-resolucionMIVI', `N° Resolución MIVI ${info('Número de resolución emitida por MIVI, si aplica.')}`, v.resolucionMIVI || '')}
// ${inputDate('fv-fechaResolucionMIVI', `Fecha resolución ${info('Fecha de resolución MIVI.')}`, v.fechaResolucionMIVI)}
// ${inputDate('fv-solicitudMiviDesembolso', `Solicitud MIVI desembolso ${info('Fecha de solicitud de desembolso MIVI, si aplica.')}`, v.solicitudMiviDesembolso)}
// ${input('fv-desembolsoMivi', `Desembolso MIVI ${info('Estado o referencia del desembolso MIVI.')}`, v.desembolsoMivi || '')}
// ${inputDate('fv-fechaPagoMivi', `Fecha pago MIVI ${info('Fecha de pago o desembolso MIVI.')}`, v.fechaPagoMivi)}
// `);
const htmlMivi = '';

const htmlEntregaOtros = seccion('Entrega / Captación / Observaciones', `
${input('fv-entregaCasa', `Entrega de casa ${info('Estado o confirmación de entrega de la vivienda al cliente.')}`, v.entregaCasa || '')}
${input('fv-entregaANATI', `Entrega ANATI ${info('Estado o referencia de entrega ANATI, si aplica.')}`, v.entregaANATI || '')}
${inputDate('fv-fechaEntregaVivienda', `Fecha entrega vivienda ${info('Fecha efectiva de entrega de la vivienda al cliente.')}`, v.fechaEntregaVivienda)}

${inputChk('fv-captadoAtencionOficina', `Captado atención oficina ${info('Indica si el cliente fue captado mediante atención en oficina.')}`, !!v.captadoAtencionOficina)}
${inputChk('fv-captadoMailInternet', `Captado mail / internet ${info('Indica si el cliente fue captado por correo, web o canal digital.')}`, !!v.captadoMailInternet)}
${inputChk('fv-captadoEnProyecto', `Captado en proyecto ${info('Indica si el cliente fue captado directamente en el proyecto.')}`, !!v.captadoEnProyecto)}
${inputChk('fv-captadoMercadeoProspecto', `Captado mercadeo / prospecteo ${info('Indica si el cliente proviene de campañas de mercadeo o prospección comercial.')}`, !!v.captadoMercadeoProspecto)}

${input('fv-proformaSolicitadaPor', `Proforma solicitada por ${info('Persona o canal que solicitó la proforma.')}`, v.proformaSolicitadaPor || '')}
${input('fv-referidoPor', `Referido por ${info('Persona, canal o entidad que refirió al cliente.')}`, v.referidoPor || '')}
${input('fv-observacionCliente', `Observación cliente ${info('Observaciones relevantes sobre el cliente o su expediente.')}`, v.observacionCliente || '')}
${input('fv-comentario', `Comentario interno ${info('Comentario interno para seguimiento operativo, comercial, legal o bancario.')}`, v.comentario || '')}
`);

  const fichaHTML = fichaMode === 'technical'
    ? renderTechnicalUnitFicha(u, v, unitId)
    : renderCommercialProcessFicha(u, v);

  const docsHTML = (typeof renderUnidadDocsSkeleton === 'function')
    ? renderUnidadDocsSkeleton(u)
    : `<div class="small muted">Subida de documentos por unidad aún no disponible.</div>`;

  const exportsHTML = `
  <div class="export-docs-card">
    <h3 style="color:white;">Exportar documentos</h3>

    <p class="muted" style="color:rgba(255,255,255,0.75);">
      Genera automáticamente los PDFs con los datos guardados de esta unidad.
    </p>

    <div class="export-docs-actions">
      <button type="button" class="export-doc-btn primary" id="btnPdfFichaCliente">
        Descargar ficha de cliente
      </button>

      <button type="button" class="export-doc-btn primary" id="btnPdfProforma">
        Descargar proforma
      </button>
    </div>

    <hr style="margin:22px 0;border-color:rgba(255,255,255,.15);">

    <h3 style="color:white;">Importar Word</h3>

    <p class="muted" style="color:rgba(255,255,255,0.75);">
      Sube una ficha de cliente o proforma en Word. Bank73 detectará los campos y podrás revisarlos antes de aplicarlos.
    </p>

    <input id="importWordInput" type="file" accept=".docx" style="display:none;">

    <div class="export-docs-actions">
      <button type="button" class="export-doc-btn primary" id="btnImportWord">
        Importar ficha/proforma Word
      </button>
    </div>

    <div id="importWordPreview" style="margin-top:18px;"></div>
  </div>
`;
  const views = document.getElementById('fichaViews');
  const viewFicha = document.createElement('div');
const viewDocs = document.createElement('div');
const viewExports = document.createElement('div');

  viewFicha.id = 'view-ficha';
  viewDocs.id = 'view-docs';
  viewExports.id = 'view-exports';

  viewFicha.innerHTML = fichaHTML;
  viewDocs.innerHTML = docsHTML;
  viewExports.innerHTML = exportsHTML;

  views.innerHTML = '';
  views.appendChild(viewFicha);
  views.appendChild(viewDocs);
  views.appendChild(viewExports);

  initStatusBancoUI(
    'fv-statusBancoSel',
    'fv-statusBancoOtherLbl',
    'fv-statusBancoOther',
    v.statusBanco || '',
    { includeEmpty: false }
  );
  window.BankSelect?.bindBankSelect?.('fv-banco');
  bindInsurancePolicyEditor(viewFicha);
  const policyManager = viewFicha.querySelector('[data-unit-policy-manager]');
  const policyEditor = viewFicha.querySelector('[data-unit-policy-editor]');
  const policySaveButton = viewFicha.querySelector('[data-save-unit-policy]');
  const resetUnitPolicyEditor = () => {
    if (!policyEditor || !policyManager) return;
    policyEditor.innerHTML = insurancePolicyEditorRow({}, { defaultUnitId:unitId });
    policyManager.querySelector('summary strong').textContent = 'Crear y asignar una póliza';
    if (policySaveButton) policySaveButton.textContent = 'Guardar póliza';
    bindInsurancePolicyEditor(policyEditor);
    policyManager.open = false;
  };

  viewFicha.querySelectorAll('[data-edit-unit-policy]').forEach(button => {
    button.addEventListener('click', () => {
      const policy = projectInsurancePolicies().find(item => String(item._id) === button.dataset.editUnitPolicy);
      if (!policy || !policyEditor || !policyManager) return;
      policyEditor.innerHTML = insurancePolicyEditorRow(policy);
      policyManager.querySelector('summary strong').textContent = `Editar póliza ${policy.policyNumber || policy.type || 'CAR'}`;
      if (policySaveButton) policySaveButton.textContent = 'Guardar cambios';
      bindInsurancePolicyEditor(policyEditor);
      policyManager.open = true;
      policyManager.scrollIntoView({ behavior:'smooth', block:'nearest' });
    });
  });

  viewFicha.querySelectorAll('[data-delete-unit-policy]').forEach(button => {
    button.addEventListener('click', async () => {
      const policy = projectInsurancePolicies().find(item => String(item._id) === button.dataset.deleteUnitPolicy);
      if (!policy) return;
      if (!confirm(`¿Quitar la póliza ${policy.policyNumber || policy.type || 'CAR'} únicamente de esta unidad?`)) return;
      button.disabled = true;
      try {
        const currentUnitId = String(unitId);
        const currentUnitRef = insuranceUnitReference(u);
        const otherUnits = INSURANCE_UNITS_CACHE.filter(unit => String(unit._id) !== currentUnitId);
        const updatedPolicy = policy.appliesToAllUnits !== false
          ? {
              ...policy,
              appliesToAllUnits: false,
              unitIds: otherUnits.map(unit => String(unit._id)).filter(Boolean),
              unitRefs: otherUnits.map(insuranceUnitReference).filter(Boolean)
            }
          : {
              ...policy,
              unitIds: (policy.unitIds || []).map(String).filter(value => value !== currentUnitId),
              unitRefs: (policy.unitRefs || []).map(String).filter(value => value !== currentUnitRef)
            };
        const stillHasUnits = updatedPolicy.unitIds.length > 0 || updatedPolicy.unitRefs.length > 0;
        const remaining = projectInsurancePolicies().flatMap(item => {
          if (String(item._id) !== String(policy._id)) return [item];
          return stillHasUnits ? [updatedPolicy] : [];
        });
        const result = await API.put(`/api/projects/${id}/insurance-policies`, { insurancePolicies: remaining });
        state.project.technicalData ||= {};
        state.project.technicalData.insurancePolicies = result.insurancePolicies || remaining;
        await loadProject();
        await loadUnits();
        await window.refreshTechnicalWorkspace?.({ force:true, preserveSelection:true });
        await abrirFichaUnidad(unitId, { mode:fichaMode });
      } catch (error) {
        button.disabled = false;
        alert(error.message || 'No se pudo quitar la póliza de esta unidad.');
      }
    });
  });

  viewFicha.querySelector('[data-cancel-unit-policy]')?.addEventListener('click', resetUnitPolicyEditor);
  viewFicha.querySelector('[data-save-unit-policy]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const editingId = viewFicha.querySelector('[data-unit-policy-editor] [data-insurance-policy-row]')?.dataset.policyId;
    const editingPolicy = editingId ? projectInsurancePolicies().find(item => String(item._id) === String(editingId)) : null;
    const affectedUnits = editingPolicy?.appliesToAllUnits !== false
      ? INSURANCE_UNITS_CACHE.length
      : Math.max((editingPolicy?.unitIds || []).length, (editingPolicy?.unitRefs || []).length);
    if (editingPolicy && affectedUnits > 1 && !confirm(`Esta póliza está compartida por ${affectedUnits} unidades. Los cambios se reflejarán en todas ellas. ¿Continuar?`)) return;
    button.disabled = true;
    try {
      await saveInsurancePoliciesFrom(viewFicha.querySelector('[data-unit-policy-editor]'), { preserveUnrendered:true });
      await loadProject();
      await loadUnits();
      await window.refreshTechnicalWorkspace?.({ force:true, preserveSelection:true });
      await abrirFichaUnidad(unitId, { mode:fichaMode });
    } catch (error) {
      console.error(error);
      alert(error.message || 'No se pudo guardar la póliza.');
    } finally { button.disabled = false; }
  });

  const elCons = document.getElementById('fv-constructora');
  if (elCons) elCons.value = safeVal(v.constructora);

  viewFicha.style.display = '';
  viewDocs.style.display = 'none';
  viewExports.style.display = 'none';

  cont.querySelectorAll('.modal-tab').forEach(btn => {
    btn.addEventListener('click', async () => {
      cont.querySelectorAll('.modal-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const tab = btn.dataset.tab;

      viewFicha.style.display = (tab === 'ficha') ? '' : 'none';
      viewDocs.style.display = (tab === 'docs') ? '' : 'none';
      viewExports.style.display = (tab === 'exports') ? '' : 'none';

      if (tab === 'docs') {
  unitDocInsideDepartment = false;
  unitDocFolderId = '';
  await refreshUnitDocsUI(id, unitId);
}
    });
  });

  const entregaEl = document.getElementById('fv-entregaExpedienteBanco');
  const recibidoEl = document.getElementById('fv-recibidoCPP');

  if (entregaEl) entregaEl.addEventListener('change', refreshTiempoAprobacionDias);
  if (recibidoEl) recibidoEl.addEventListener('change', refreshTiempoAprobacionDias);

  refreshTiempoAprobacionDias();

  document.getElementById('fv-precioVenta')?.addEventListener('input', () => refreshFinanciamientoAuto('precio'));
document.getElementById('fv-montoFinanciamientoCPP')?.addEventListener('input', () => refreshFinanciamientoAuto('monto'));
document.getElementById('fv-abonoInicial')?.addEventListener('input', () => refreshFinanciamientoAuto('abono'));
document.getElementById('fv-porcentajeFinanciamiento')?.addEventListener('input', () => refreshFinanciamientoAuto('pct'));
document.getElementById('fv-areaAbierta')?.addEventListener('input', refreshAreaTotalConstruccion);
document.getElementById('fv-areaCerrada')?.addEventListener('input', refreshAreaTotalConstruccion);
document.getElementById('fu-estado')?.addEventListener('change', event => {
  fichaEstadoControl = 'manual';
  fichaEstadoModo = 'manual';
  applyOpenFichaStateVisual({ estado: event.target.value, estadoModo: 'manual' });
});
document.getElementById('btnFichaEstadoAutomatico')?.addEventListener('click', () => {
  fichaEstadoControl = 'automatico';
  fichaEstadoModo = 'automatico';
  const stateSelect = document.getElementById('fu-estado');
  if (stateSelect) stateSelect.value = automaticStatus;
  applyOpenFichaStateVisual({
    estado: stateSelect?.value || automaticStatus,
    estadoModo: 'automatico',
    estadoAutomaticoSugerido: automaticStatus,
    estadoAutomaticoMotivo: automaticReason
  });
  scheduleFichaAutosave(150);
});
const commercialProcessView = document.getElementById('view-ficha');
if (commercialProcessView && fichaMode === 'commercial') {
  const refreshCommercialLiveUi = event => {
    if (['fv-polizaVidaEntregada','fv-polizaIncendioEntregada'].includes(event.target.id)) {
      refreshPolicyDeliverySummary();
    }
    if (event.target.closest?.('.unit-process-stage')) refreshCommercialProcessProgress();
    if (event.target.id === 'fv-fechaReserva') refreshReservationAgeNotice();
    if (['fv-estatusCPP','fv-fechaValorCPP','fv-fechaVencimientoCPP','fv-precioVenta','fv-montoFinanciamientoCPP'].includes(event.target.id)) {
      refreshCommercialSummaryKpis({ normalizeCpp:event.target.id === 'fv-fechaValorCPP' });
    }
    if (['fv-fechaReserva','fv-estatusCPP','fv-fechaValorCPP','fv-solicitudAvaluo','fv-fechaInscripcion','fv-avanceConstruccionPct'].includes(event.target.id)) {
      refreshOpenFichaCommercialStatePreview();
    }
    if (['fv-primerNombre','fv-segundoNombre','fv-primerApellido','fv-segundoApellido'].includes(event.target.id)) {
      refreshStructuredClientName(false);
    }
    if (['fv-cliente2PrimerNombre','fv-cliente2SegundoNombre','fv-cliente2PrimerApellido','fv-cliente2SegundoApellido'].includes(event.target.id)) {
      refreshStructuredClientName(true);
    }
  };
  commercialProcessView.addEventListener('input', refreshCommercialLiveUi);
  commercialProcessView.addEventListener('change', refreshCommercialLiveUi);
  refreshPolicyDeliverySummary();
  refreshCommercialProcessProgress();
  refreshReservationAgeNotice();
  refreshCommercialSummaryKpis({ normalizeCpp:true });
  refreshStructuredClientName(false);
  refreshStructuredClientName(true);
}
const fichaModelSelect = document.getElementById('fu-modeloSelect');
fichaModelSelect?.addEventListener('change', event => applyProjectModelToFicha(event.target.value));
if (fichaModelSelect?.value) {
  applyProjectModelToFicha(fichaModelSelect.value, { onlyMissing:true });
}
const unitCostInput = document.getElementById('fu-costo');
if (unitCostInput) {
  unitCostInput.dataset.manual = u.costoUnidadManual ? 'true' : 'false';
  unitCostInput.addEventListener('input', () => { unitCostInput.dataset.manual = 'true'; });
}

refreshFinanciamientoAuto('init');
refreshAreaTotalConstruccion();
  installSectionToggles();

  const btnPdfFichaCliente = document.getElementById('btnPdfFichaCliente');
const btnPdfProforma = document.getElementById('btnPdfProforma');
const btnImportWord = document.getElementById('btnImportWord');
const importWordInput = document.getElementById('importWordInput');

if (btnPdfFichaCliente) {
  btnPdfFichaCliente.addEventListener('click', async () => {

    await downloadFileWithLoading(
      btnPdfFichaCliente,
      `/api/export-pdf/ficha-cliente/${unitId}`,
      `ficha_cliente_${u.manzana || ''}_${u.lote || ''}.pdf`
    );

  });
}

if (btnPdfProforma) {
  btnPdfProforma.addEventListener('click', async () => {

    await downloadFileWithLoading(
      btnPdfProforma,
      `/api/export-pdf/proforma/${unitId}`,
      `proforma_${u.manzana || ''}_${u.lote || ''}.pdf`
    );

  });
}
if (btnImportWord && importWordInput) {

  btnImportWord.addEventListener('click', () => {
    importWordInput.value = '';
    importWordInput.click();
  });

  importWordInput.addEventListener('change', async () => {

    try {

      btnImportWord.disabled = true;
      btnImportWord.textContent = 'Leyendo Word...';

      await previewImportWord(unitId);

    } catch (e) {

      console.error(e);
      alert('Error importando Word: ' + (e.message || ''));

    } finally {

      btnImportWord.disabled = false;
      btnImportWord.textContent = 'Importar ficha/proforma Word';

    }

  });

}

  modalFicha.classList.remove('is-fullscreen');
  if (fichaExpandir) {
    fichaExpandir.textContent = '⛶';
    fichaExpandir.title = 'Pantalla completa';
    fichaExpandir.setAttribute('aria-label', 'Pantalla completa');
  }
  fichaAutosaveReady = fichaMode === 'commercial';
  setFichaSaveStatus(fichaAutosaveReady ? 'Autoguardado activo' : 'Guarda los cambios antes de cerrar');
  modalFicha.style.display = 'flex';
}


  window.abrirFichaUnidad = abrirFichaUnidad;

  async function guardarFicha(options = {}) {
  const closeAfterSave = options.close !== false;
  const silent = options.silent === true;
  if (fichaSaving) {
    if (closeAfterSave) fichaCloseRequested = true;
    return false;
  }
  // ROLE-SEP: bloqueo para commercial si proyecto no aprobado
  if (myRole === 'commercial' && window.__COMMERCIAL_LOCKED) {
    alert('Este proyecto aún no está aprobado. Edición comercial bloqueada.');
    return false;
  }

  if (!fichaUnitId) return false;

  clearTimeout(fichaAutosaveTimer);
  fichaSaving = true;
  const saveVersion = fichaChangeVersion;
  let saveSucceeded = false;
  fichaGuardar.disabled = true;

  const oldText = fichaGuardar.textContent;
  fichaGuardar.textContent = 'Guardando...';
  fichaGuardar.classList.add('is-loading');
  setFichaSaveStatus(silent ? 'Guardando automáticamente…' : 'Guardando cambios…', 'saving');

  try {
    if (fichaMode === 'technical') {
      const { manzana, lote } = unitNamePartsFromInput();

      await apiPatch(`/api/units/${fichaUnitId}`, {
        etapa: vVal('fu-etapa'),
        torre: vVal('fu-torre'),
        nivel: vVal('fu-nivel'),
        manzana,
        lote,
        ...(fichaEstadoControl === 'manual'
          ? { estado: vVal('fu-estado'), estadoControl: 'manual' }
          : fichaEstadoControl === 'automatico'
            ? { estadoControl: 'automatico' }
            : {}),
        modelId: vVal('fu-modeloSelect') || undefined,
        modelo: vVal('fu-modelo'),
        m2: vNum('fu-m2'),
        numeroFinca: vVal('fv-numeroFinca'),
        codigoUbicacion: vVal('fv-codigoUbicacion'),
        calle: vVal('fv-calle'),
        areaAbierta: vNum('fv-areaAbierta'),
        areaCerrada: vNum('fv-areaCerrada'),
        areaTotalConstruccion: vNum('fv-areaTotalConstruccion'),
        recamaras: vNum('fv-recamaras'),
        banos: vNum('fv-banos')
      });

      await apiPost('/api/ventas/upsert-by-unit', {
        projectId: id,
        unitId: fichaUnitId,
        resetAutomaticState: fichaEstadoControl === 'automatico',
        numeroFinca: vVal('fv-numeroFinca'),
        codigoUbicacion: vVal('fv-codigoUbicacion'),
        calle: vVal('fv-calle'),
        metrajeLote: vNum('fu-m2'),
        areaAbierta: vNum('fv-areaAbierta'),
        areaCerrada: vNum('fv-areaCerrada'),
        areaTotalConstruccion: vNum('fv-areaAbierta') + vNum('fv-areaCerrada'),
        recamaras: vNum('fv-recamaras'),
        banos: vNum('fv-banos'),
        enConstruccion: vNum('fv-avanceConstruccionPct') > 0 && vNum('fv-avanceConstruccionPct') < 100,
        estatusConstruccion: vVal('fv-estatusConstruccion'),
        faseConstruccion: vVal('fv-estatusConstruccion'),
        avanceConstruccionPct: vNum('fv-avanceConstruccionPct'),
        permisoConstruccionMunicipal: vChk('fv-permisoConstruccionMunicipal'),
        permisoConstruccionNum: vVal('fv-permisoConstruccionNum'),
        permisoConstruccionVencimiento: vDate('fv-permisoConstruccionVencimiento'),
        permisoOcupacion: vChk('fv-permisoOcupacion'),
        permisoOcupacionNum: vVal('fv-permisoOcupacionNum'),
        fechaEmisionPermisoOcupacion: vDate('fv-fechaEmisionPermisoOcupacion'),
        constructora: vVal('fv-constructora')
      });

      fichaEstadoControl = '';
      saveSucceeded = true;
      fichaDirty = fichaChangeVersion !== saveVersion;
      setFichaSaveStatus('Guardado', 'saved');
      if (closeAfterSave && !fichaDirty) modalFicha.style.display = 'none';
      await loadUnits();
      applyOpenFichaStateVisual(unitsCache.find(unit => String(unit._id) === String(fichaUnitId)) || {});
      await window.refreshTechnicalWorkspace?.({ preserveSelection:true });
      await markProjectDataChanged();
      return true;
    }

    // 1) Actualizar la unidad
    const { manzana, lote } = unitNamePartsFromInput();

const uBody = {
  etapa: vVal('fu-etapa'),
  torre: vVal('fu-torre'),
  nivel: vVal('fu-nivel'),
  manzana,
  lote,
  ...(fichaEstadoControl === 'manual'
    ? { estado: vVal('fu-estado'), estadoControl: 'manual' }
    : fichaEstadoControl === 'automatico'
      ? { estadoControl: 'automatico' }
      : {}),
  modelId: vVal('fu-modeloSelect') || undefined,
  modelo: vVal('fu-modelo'),
  m2: vNum('fu-m2'),
  costoUnidad: vNum('fu-costo'),
  costoUnidadManual: document.getElementById('fu-costo')?.dataset.manual === 'true',
  numeroFinca: vVal('fv-numeroFinca'),
  codigoUbicacion: vVal('fv-codigoUbicacion'),
  calle: vVal('fv-calle'),
  loteEsquina: vVal('fv-loteEsquina'),
  metrosExtra: vNum('fv-metrosExtra'),
  precioLoteEsquina: vNum('fv-precioLoteEsquina'),
  precioM2Extra: vNum('fv-precioM2Extra'),
  areaAbierta: vNum('fv-areaAbierta'),
  areaCerrada: vNum('fv-areaCerrada'),
  areaTotalConstruccion: vNum('fv-areaTotalConstruccion'),
  recamaras: vNum('fv-recamaras'),
  banos: vNum('fv-banos'),
  valorMejoras: vNum('fv-valorMejoras'),
  valorTerreno: vNum('fv-valorTerreno')
};

    await apiPatch(`/api/units/${fichaUnitId}`, uBody);

    // 2) Upsert de la venta
    refreshFinanciamientoAuto('init');
    const precioVentaFin = parsePanamaNumber(vVal('fv-precioVenta'));
    const abonoInicialFin = parsePanamaNumber(vVal('fv-abonoInicial'));
    const montoFinanciamientoFin = Math.max(precioVentaFin - abonoInicialFin, 0);
    const porcentajeFinanciamientoFin = precioVentaFin > 0
      ? (montoFinanciamientoFin / precioVentaFin) * 100
      : 0;

    const vBody = {
      projectId: id,
      unitId: fichaUnitId,
      resetAutomaticState: fichaEstadoControl === 'automatico',

      // =====================================================
      // Cliente 1 / solicitante principal
      // =====================================================
      clienteNombre: vVal('fv-clienteNombre'),
      cedula: vVal('fv-cedula'),
      empresa: vVal('fv-empresa'),

      primerNombre: vVal('fv-primerNombre'),
      segundoNombre: vVal('fv-segundoNombre'),
      primerApellido: vVal('fv-primerApellido'),
      segundoApellido: vVal('fv-segundoApellido'),
      apellidoCasada: vVal('fv-apellidoCasada'),

      sexo: vVal('fv-sexo'),
      profesion: vVal('fv-profesion'),
      estadoCivil: vVal('fv-estadoCivil'),
      direccion: vVal('fv-direccion'),

      telefonoResidencial: vVal('fv-telefonoResidencial'),
      telefonoOficina: vVal('fv-telefonoOficina'),
      celular: vVal('fv-celular'),
      correo: vVal('fv-correo'),

      perfilCliente: vVal('fv-perfilCliente'),
      tipoEmpresa: vVal('fv-tipoEmpresa'),
      sectorEmpresa: vVal('fv-sectorEmpresa'),

      lugarTrabajo: vVal('fv-lugarTrabajo'),
      ingresoMensual: vNum('fv-ingresoMensual'),
      cargo: vVal('fv-cargo'),
      antiguedadLaboral: vVal('fv-antiguedadLaboral'),

      // =====================================================
      // Cliente 2 / co-solicitante
      // =====================================================
      cliente2PrimerNombre: vVal('fv-cliente2PrimerNombre'),
      cliente2SegundoNombre: vVal('fv-cliente2SegundoNombre'),
      cliente2PrimerApellido: vVal('fv-cliente2PrimerApellido'),
      cliente2SegundoApellido: vVal('fv-cliente2SegundoApellido'),
      cliente2ApellidoCasada: vVal('fv-cliente2ApellidoCasada'),
      cliente2Cedula: vVal('fv-cliente2Cedula'),

      cliente2Sexo: vVal('fv-cliente2Sexo'),
      cliente2Profesion: vVal('fv-cliente2Profesion'),
      cliente2EstadoCivil: vVal('fv-cliente2EstadoCivil'),
      cliente2Direccion: vVal('fv-cliente2Direccion'),

      cliente2TelefonoResidencial: vVal('fv-cliente2TelefonoResidencial'),
      cliente2TelefonoOficina: vVal('fv-cliente2TelefonoOficina'),
      cliente2Celular: vVal('fv-cliente2Celular'),
      cliente2Correo: vVal('fv-cliente2Correo'),

      cliente2LugarTrabajo: vVal('fv-cliente2LugarTrabajo'),
      cliente2IngresoMensual: vNum('fv-cliente2IngresoMensual'),
      cliente2Cargo: vVal('fv-cliente2Cargo'),
      cliente2AntiguedadLaboral: vVal('fv-cliente2AntiguedadLaboral'),
      cliente2PerfilCliente: vVal('fv-cliente2PerfilCliente'),
      cliente2TipoEmpresa: vVal('fv-cliente2TipoEmpresa'),

      // =====================================================
      // Parientes / referencias
      // =====================================================

      referencia1Nombre: vVal('fv-referencia1Nombre'),
      referencia1Relacion: vVal('fv-referencia1Relacion'),
      referencia1Telefono: vVal('fv-referencia1Telefono'),
      referencia1TelefonoTrabajo: vVal('fv-referencia1TelefonoTrabajo'),

      referencia2Nombre: vVal('fv-referencia2Nombre'),
      referencia2Relacion: vVal('fv-referencia2Relacion'),
      referencia2Telefono: vVal('fv-referencia2Telefono'),
      referencia2TelefonoTrabajo: vVal('fv-referencia2TelefonoTrabajo'),

      // =====================================================
      // Datos del inmueble / lote / vivienda
      // =====================================================
      numeroFinca: vVal('fv-numeroFinca'),
      codigoUbicacion: vVal('fv-codigoUbicacion'),
      ubicacion: vVal('fv-ubicacion'),
      calle: vVal('fv-calle'),

      metrajeLote: vNum('fv-metrajeLote'),
      loteEsquina: vVal('fv-loteEsquina'),
      metrosExtra: vNum('fv-metrosExtra'),
      precioLoteEsquina: vNum('fv-precioLoteEsquina'),
      precioM2Extra: vNum('fv-precioM2Extra'),

      areaAbierta: vNum('fv-areaAbierta'),
      areaCerrada: vNum('fv-areaCerrada'),
      areaTotalConstruccion: parseInputNumber('fv-areaAbierta', vVal('fv-areaAbierta')) + parseInputNumber('fv-areaCerrada', vVal('fv-areaCerrada')),
      recamaras: vNum('fv-recamaras'),
      banos: vNum('fv-banos'),

      valorMejoras: vNum('fv-valorMejoras'),
      valorTerreno: vNum('fv-valorTerreno'),
      fechaProbableEntrega: vDate('fv-fechaProbableEntrega'),
      fechaReserva: vDate('fv-fechaReserva'),

      // =====================================================
      // Banco / CPP / financiamiento
      // =====================================================
      banco: window.BankSelect?.getBankValue?.('fv-banco') || vVal('fv-banco'),
      oficialBanco: vVal('fv-oficialBanco'),
      statusBanco: getStatusBancoValue('fv-statusBancoSel', 'fv-statusBancoOther'),
      estatusCPP: vVal('fv-estatusCPP'),
      numCPP: vVal('fv-numCPP'),

      precioVenta: precioVentaFin,
      montoFinanciamientoCPP: montoFinanciamientoFin,

      // legacy
      valor: montoFinanciamientoFin,

      abonoCliente: vNum('fv-abonoCliente'),
      abonoInicial: abonoInicialFin,
      porcentajeFinanciamiento: porcentajeFinanciamientoFin,
      cesionAFavorDe: vVal('fv-cesionAFavorDe'),

      entregaExpedienteBanco: vDate('fv-entregaExpedienteBanco'),
      recibidoCPP: vDate('fv-recibidoCPP'),
      plazoAprobacionDias: vNum('fv-plazoAprobacionDias'),
      fechaValorCPP: vDate('fv-fechaValorCPP'),
      fechaVencimientoCPP: vDate('fv-fechaVencimientoCPP'),
      vencimientoCPPBnMivi: vDate('fv-vencimientoCPPBnMivi'),

      fechaEntregaProformaBanco: vDate('fv-fechaEntregaProformaBanco'),
      fechaProforma: vDate('fv-fechaProforma'),

      aperturaCtaBanco: vChk('fv-aperturaCtaBanco'),
      primeraMensual: vChk('fv-primeraMensual'),
      pagoMinuta: vChk('fv-pagoMinuta'),

      tiempoAprobacionDias: calcDiffDays(
        vVal('fv-entregaExpedienteBanco'),
        vVal('fv-recibidoCPP')
      ),

      polizaVidaEntregada: vChk('fv-polizaVidaEntregada'),
      tipoPolizaVida: vVal('fv-tipoPolizaVida'),
      polizaIncendioEntregada: vChk('fv-polizaIncendioEntregada'),
      tipoPolizaIncendio: vVal('fv-tipoPolizaIncendio'),
      polizas: vChk('fv-polizaVidaEntregada') && vChk('fv-polizaIncendioEntregada'),
      tipoPoliza: [vVal('fv-tipoPolizaVida'), vVal('fv-tipoPolizaIncendio')].filter(Boolean).join(' / '),
      polizaVida: vVal('fv-tipoPolizaVida'),
      abonoAlte: vNum('fv-abonoAlte'),

      // =====================================================
      // Contrato / protocolo / notaría / RP
      // =====================================================
      fechaContratoCliente: vDate('fv-fechaContratoCliente'),
      estatusContrato: vVal('fv-estatusContrato'),
      montoContrato: vNum('fv-montoContrato'),
      pagare: vVal('fv-pagare'),
      fechaFirma: vDate('fv-fechaFirma'),
      contratoFirmado: vChk('fv-contratoFirmado'),

      fechaActivacionTramite: vDate('fv-fechaActivacionTramite'),

      protocoloFirmaCliente: vChk('fv-protocoloFirmaCliente'),
      protocoloFirmaPromotora: vChk('fv-protocoloFirmaPromotora'),
      fechaEntregaBanco: vDate('fv-fechaEntregaBanco'),
      protocoloFirmaRLBancoInter: vChk('fv-protocoloFirmaRLBancoInter'),
      fechaRegresoBanco: vDate('fv-fechaRegresoBanco'),
      diasTranscurridosBanco: vNum('fv-diasTranscurridosBanco'),

      fechaEntregaProtocoloBancoCli: vDate('fv-fechaEntregaProtocoloBancoCli'),
      firmaProtocoloBancoCliente: vChk('fv-firmaProtocoloBancoCliente'),
      fechaRegresoProtocoloBancoCli: vDate('fv-fechaRegresoProtocoloBancoCli'),
      diasTranscurridosProtocolo: vNum('fv-diasTranscurridosProtocolo'),

      cierreNotaria: vChk('fv-cierreNotaria'),
      pagoImpuestos: vChk('fv-pagoImpuestos'),
      fechaPagoImpuesto: vDate('fv-fechaPagoImpuesto'),
      ingresoRP: vChk('fv-ingresoRP'),
      fechaIngresoRP: vDate('fv-fechaIngresoRP'),
      fechaInscripcion: vDate('fv-fechaInscripcion'),

      solicitudDesembolso: vChk('fv-solicitudDesembolso'),
      fechaDesembolso: vDate('fv-fechaDesembolso'),
      fechaRecibidoCheque: vDate('fv-fechaRecibidoCheque'),

      // =====================================================
      // MIVI (retirado)
      // =====================================================
      // expedienteMIVI: vVal('fv-expedienteMIVI'),
      // entregaExpMIVI: vDate('fv-entregaExpMIVI'),
      // resolucionMIVI: vVal('fv-resolucionMIVI'),
      // fechaResolucionMIVI: vDate('fv-fechaResolucionMIVI'),
      // solicitudMiviDesembolso: vDate('fv-solicitudMiviDesembolso'),
      // desembolsoMivi: vVal('fv-desembolsoMivi'),
      // fechaPagoMivi: vDate('fv-fechaPagoMivi'),

      // =====================================================
      // Técnico / obra / permisos
      // =====================================================
      enConstruccion: vChk('fv-enConstruccion'),
      estatusConstruccion: vVal('fv-estatusConstruccion'),
      faseConstruccion: vVal('fv-estatusConstruccion'),
      avanceConstruccionPct: vNum('fv-avanceConstruccionPct'),
      permisoConstruccionMunicipal: vChk('fv-permisoConstruccionMunicipal'),
      permisoConstruccionNum: vVal('fv-permisoConstruccionNum'),
      permisoConstruccionVencimiento: vDate('fv-permisoConstruccionVencimiento'),

      permisoOcupacion: vChk('fv-permisoOcupacion'),
      permisoOcupacionNum: vVal('fv-permisoOcupacionNum'),
      fechaEmisionPermisoOcupacion: vDate('fv-fechaEmisionPermisoOcupacion'),

      constructora: vVal('fv-constructora'),

      // =====================================================
      // Legal / minutas / avalúo / paz y salvo
      // =====================================================
      solicitudAvaluo: vVal('fv-solicitudAvaluo'),
      avaluoRealizado: vVal('fv-avaluoRealizado'),
      fechaAvaluo: vDate('fv-fechaAvaluo'),
      empresaAvaluadora: vVal('fv-empresaAvaluadora'),

      mLiberacion: vVal('fv-mLiberacion'),
      mSegregacion: vVal('fv-mSegregacion'),
      mPrestamo: vVal('fv-mPrestamo'),

      pazSalvoGesproban: vChk('fv-pazSalvoGesproban'),
      pazSalvoPromotora: vChk('fv-pazSalvoPromotora'),

      // =====================================================
      // Entrega / otros
      // =====================================================
      entregaCasa: vVal('fv-entregaCasa'),
      entregaANATI: vVal('fv-entregaANATI'),
      fechaEntregaVivienda: vDate('fv-fechaEntregaVivienda'),

      comentario: vVal('fv-comentario'),

      // =====================================================
      // Captación / proforma comercial
      // =====================================================
      captadoAtencionOficina: vChk('fv-captadoAtencionOficina'),
      captadoMailInternet: vChk('fv-captadoMailInternet'),
      captadoEnProyecto: vChk('fv-captadoEnProyecto'),
      captadoMercadeoProspecto: vChk('fv-captadoMercadeoProspecto'),

      proformaSolicitadaPor: vVal('fv-proformaSolicitadaPor'),
      referidoPor: vVal('fv-referidoPor'),
      observacionCliente: vVal('fv-observacionCliente'),
    };

    // Los nombres completos son resúmenes de solo lectura. Se conservan los
    // componentes del Dato Único para no perder granularidad al exportar.
    const clientNameEl = document.getElementById('fv-clienteNombre');
    const structuredClientName = [vBody.primerNombre,vBody.segundoNombre,vBody.primerApellido,vBody.segundoApellido]
      .map(value => String(value || '').trim()).filter(Boolean).join(' ');
    vBody.clienteNombre = structuredClientName || String(clientNameEl?.value || '').trim() || undefined;

    // Captación reutiliza los cuatro indicadores existentes: no persiste un
    // segundo campo de canal que pueda contradecirlos.
    const captureChannel = vVal('fv-canalCaptacion');
    if (captureChannel !== undefined) {
      vBody.captadoAtencionOficina = captureChannel === 'Atención en oficina';
      vBody.captadoMailInternet = captureChannel === 'Mail / internet';
      vBody.captadoEnProyecto = captureChannel === 'En proyecto';
      vBody.captadoMercadeoProspecto = captureChannel === 'Mercadeo / prospecto';
    }
    if (vBody.fechaContratoCliente !== undefined) vBody.contratoFirmado = !!vBody.fechaContratoCliente;
    if (vBody.fechaPagoImpuesto !== undefined) vBody.pagoImpuestos = !!vBody.fechaPagoImpuesto;
    if (vBody.fechaIngresoRP !== undefined) vBody.ingresoRP = !!vBody.fechaIngresoRP;
    if (vBody.fechaRecibidoCheque !== undefined) vBody.solicitudDesembolso = !!vBody.fechaRecibidoCheque;
    if (vBody.fechaEntregaVivienda !== undefined) vBody.entregaCasa = vBody.fechaEntregaVivienda ? 'Sí' : '';
    if (vBody.avanceConstruccionPct !== undefined) vBody.enConstruccion = vBody.avanceConstruccionPct > 0 && vBody.avanceConstruccionPct < 100;

    await apiPost('/api/ventas/upsert-by-unit', vBody);

    fichaEstadoControl = '';
    saveSucceeded = true;
    fichaDirty = fichaChangeVersion !== saveVersion;
    setFichaSaveStatus('Guardado hace un momento', 'saved');
    if (closeAfterSave && !fichaDirty) modalFicha.style.display = 'none';
    if (closeAfterSave && fichaDirty) fichaCloseRequested = true;

    await loadUnits();
    applyOpenFichaStateVisual(unitsCache.find(unit => String(unit._id) === String(fichaUnitId)) || {});
    await markProjectDataChanged();
    return true;

  } catch (e) {
    console.error(e);
    fichaDirty = true;
    setFichaSaveStatus('No se pudo guardar · pulsa Guardar cambios', 'error');
    if (!silent) alert('Error guardando la ficha');
    return false;
  } finally {
    fichaSaving = false;
    fichaGuardar.disabled = false;
    fichaGuardar.textContent = oldText;
    fichaGuardar.classList.remove('is-loading');
    if (saveSucceeded && fichaDirty) {
      clearTimeout(fichaAutosaveTimer);
      fichaAutosaveTimer = setTimeout(() => {
        guardarFicha({ close: fichaCloseRequested, silent: true });
      }, 500);
    } else if (saveSucceeded && fichaCloseRequested) {
      modalFicha.style.display = 'none';
      fichaCloseRequested = false;
    } else if (saveSucceeded) {
      fichaCloseRequested = false;
    }
  }
}

  // === Batch ===
  function openBatch() {
  if (!selected.size) return alert('Selecciona al menos una unidad.');
  const bankBatch = document.getElementById('b-banco');
  if (bankBatch && window.BankSelect && !bankBatch.children.length) {
    bankBatch.innerHTML = window.BankSelect.bankOptionsHtml('');
  }
  window.BankSelect?.bindBankSelect?.('b-banco');
  modalBatch.querySelectorAll('input, select').forEach(el => {
    el.value = '';
  });
  document.getElementById('b-banco')?.dispatchEvent(new Event('change'));
  modalBatch.style.display='flex';

  // ✅ llenar select y permitir "(no cambiar)"
  initStatusBancoUI(
    'b-statusBancoSel',
    'b-statusBancoOtherWrap',
    'b-statusBancoOther',
    '',
    { includeEmpty: true }
  );
}
  function closeBatch(){ modalBatch.style.display='none'; }

  function addBatchField(update, field, type = 'text') {
    const el = document.getElementById(`b-${field}`);
    if (!el) return;

    const raw = field === 'banco' && window.BankSelect
      ? String(window.BankSelect.getBankValue('b-banco') || '').trim()
      : String(el.value || '').trim();
    if (!raw) return;

    if (type === 'number') {
      const num = parseInputNumber(`b-${field}`, raw);
      if (Number.isFinite(num)) update[field] = num;
      return;
    }

    if (type === 'date') {
      const dt = new Date(raw);
      if (!Number.isNaN(dt.getTime())) update[field] = dt.toISOString();
      return;
    }

    if (type === 'boolean') {
      update[field] = raw === 'true';
      return;
    }

    update[field] = raw;
  }

  function collectBatchVentaUpdate() {
    const update = {};

    [
      'banco',
      'oficialBanco',
      'numCPP',
      'estatusCPP',
      'cesionAFavorDe',
      'numeroFinca',
      'codigoUbicacion',
      'calle',
      'loteEsquina',
      'estatusConstruccion',
      'permisoConstruccionNum',
      'permisoOcupacionNum',
      'constructora',
      'solicitudAvaluo',
      'avaluoRealizado',
      'empresaAvaluadora',
      'mLiberacion',
      'mSegregacion',
      'mPrestamo',
      'entregaCasa',
      'proformaSolicitadaPor',
      'referidoPor',
      'observacionCliente',
      'comentario'
    ].forEach(field => addBatchField(update, field));

    [
      'clienteNombre',
      'cedula',
      'empresa',
      'primerNombre',
      'segundoNombre',
      'primerApellido',
      'segundoApellido',
      'apellidoCasada',
      'sexo',
      'profesion',
      'estadoCivil',
      'direccion',
      'telefonoResidencial',
      'telefonoOficina',
      'celular',
      'correo',
      'perfilCliente',
      'tipoEmpresa',
      'sectorEmpresa',
      'lugarTrabajo',
      'cargo',
      'antiguedadLaboral',
      'cliente2PrimerNombre',
      'cliente2SegundoNombre',
      'cliente2PrimerApellido',
      'cliente2SegundoApellido',
      'cliente2ApellidoCasada',
      'cliente2Cedula',
      'cliente2Sexo',
      'cliente2Profesion',
      'cliente2EstadoCivil',
      'cliente2Direccion',
      'cliente2TelefonoResidencial',
      'cliente2TelefonoOficina',
      'cliente2Celular',
      'cliente2Correo',
      'cliente2LugarTrabajo',
      'cliente2Cargo',
      'cliente2AntiguedadLaboral'
    ].forEach(field => addBatchField(update, field));

    [
      'valor',
      'precioVenta',
      'montoFinanciamientoCPP',
      'porcentajeFinanciamiento',
      'metrosExtra',
      'precioLoteEsquina',
      'precioM2Extra',
      'areaAbierta',
      'areaCerrada',
      'recamaras',
      'banos',
      'valorMejoras',
      'valorTerreno',
      'montoContrato',
      'ingresoMensual',
      'cliente2IngresoMensual'
    ].forEach(field => addBatchField(update, field, 'number'));

    [
      'fechaProbableEntrega',
      'fechaProforma',
      'fechaVencimientoCPP',
      'fechaContratoCliente',
      'fechaActivacionTramite',
      'fechaEntregaBanco',
      'fechaInscripcion',
      'fechaDesembolso',
      'fechaEmisionPermisoOcupacion',
      'fechaAvaluo',
      'fechaEntregaVivienda'
    ].forEach(field => addBatchField(update, field, 'date'));

    [
      'contratoFirmado',
      'protocoloFirmaCliente',
      'pagoImpuestos',
      'ingresoRP',
      'solicitudDesembolso',
      'enConstruccion',
      'permisoConstruccionMunicipal',
      'permisoOcupacion',
      'pazSalvoGesproban',
      'pazSalvoPromotora',
      'captadoAtencionOficina',
      'captadoMailInternet',
      'captadoEnProyecto',
      'captadoMercadeoProspecto'
    ].forEach(field => addBatchField(update, field, 'boolean'));

    const sb = getStatusBancoValue('b-statusBancoSel','b-statusBancoOther');
    if (sb) update.statusBanco = sb;

    if (update.valor != null && update.montoFinanciamientoCPP == null) update.montoFinanciamientoCPP = update.valor;
    if (update.montoFinanciamientoCPP != null && update.valor == null) update.valor = update.montoFinanciamientoCPP;
    if (update.areaAbierta != null && update.areaCerrada != null) {
      update.areaTotalConstruccion = Number(update.areaAbierta || 0) + Number(update.areaCerrada || 0);
    }
    if (update.precioVenta != null && update.montoFinanciamientoCPP != null) {
      update.abonoInicial = Math.max(Number(update.precioVenta || 0) - Number(update.montoFinanciamientoCPP || 0), 0);
    }

    return update;
  }

  async function aplicarBatch() {
        // ROLE-SEP: bloquear edición si commercial y no aprobado
    if (myRole === 'commercial' && window.__COMMERCIAL_LOCKED) {
      alert('Este proyecto aún no está aprobado. Edición comercial bloqueada.');
      return;
    }
    if (!selected.size) return;
    const ids = Array.from(selected);
    // Unit updates
    const updUnit = {};
    const e = document.getElementById('b-estado').value; if (e) updUnit.estado = e;
    const mo = document.getElementById('b-modelo').value; if (mo) updUnit.modelo = mo;
    const m2 = document.getElementById('b-m2').value; if (m2) updUnit.m2 = parseInputNumber('b-m2', m2);
    if (Object.keys(updUnit).length) await apiPatch('/api/units/batch', { ids, update: updUnit, projectId: id });

    // Venta updates
    const updVenta = collectBatchVentaUpdate();
    const pr = document.getElementById('b-precio').value; if (pr) updVenta.precioVenta = parsePanamaNumber(pr);
    if (Object.keys(updVenta).length) await apiPatch('/api/ventas/batch', { unitIds: ids, update: updVenta, upsert: true, projectId: id });

    closeBatch();
    await loadUnits();
    await markProjectDataChanged();
  }

  function openDel() { if (!selected.size) return alert('Selecciona al menos una unidad.'); modalDel.style.display='flex'; }
  function closeDel(){ modalDel.style.display='none'; }

  async function aplicarDel() {
        // ROLE-SEP: bloquear borrado si commercial y no aprobado
    if (myRole === 'commercial' && window.__COMMERCIAL_LOCKED) {
      alert('Este proyecto aún no está aprobado. Eliminación bloqueada.');
      return;
    }
    const pin = document.getElementById('del-pin').value;
    if (!pin) return alert('PIN requerido');
    const ids = Array.from(selected);
    await apiDelete('/api/units/batch', { ids, pin, projectId: id });
    selected.clear();
    closeDel();
    await loadUnits();
    await markProjectDataChanged();
  }

  // === Eventos ===
  async function cerrarFichaUnidadModal() {
    clearTimeout(fichaAutosaveTimer);
    if (fichaMode === 'commercial' && (fichaDirty || fichaSaving)) {
      fichaCloseRequested = true;
      setFichaSaveStatus('Guardando antes de cerrar…', 'saving');
      if (!fichaSaving) await guardarFicha({ close: true, silent: true });
      return;
    }
    modalFicha.classList.remove('is-fullscreen');
    modalFicha.style.display = 'none';
  }

  function toggleFichaFullscreen() {
    modalFicha.classList.toggle('is-fullscreen');
    const full = modalFicha.classList.contains('is-fullscreen');
    if (fichaExpandir) {
      fichaExpandir.textContent = full ? '□' : '⛶';
      fichaExpandir.title = full ? 'Restaurar tamaño' : 'Pantalla completa';
      fichaExpandir.setAttribute('aria-label', full ? 'Restaurar tamaño' : 'Pantalla completa');
    }
  }

  if (fichaGuardar) fichaGuardar.addEventListener('click', () => {
    clearTimeout(fichaAutosaveTimer);
    guardarFicha({ close: true, silent: false });
  });
  if (fichaCerrarX) fichaCerrarX.addEventListener('click', cerrarFichaUnidadModal);
  if (fichaExpandir) fichaExpandir.addEventListener('click', toggleFichaFullscreen);
  if (modalFicha) {
    const handleFichaEdit = event => {
      const control = event.target;
      if (!fichaAutosaveReady || !control?.matches?.('input, select, textarea')) return;
      if (control.disabled || control.readOnly || ['hidden', 'file'].includes(control.type)) return;
      if (!control.closest('#view-ficha') && !control.closest('#fichaTitulo')) return;
      scheduleFichaAutosave();
    };
    modalFicha.addEventListener('input', handleFichaEdit);
    modalFicha.addEventListener('change', handleFichaEdit);
  }
  window.addEventListener('beforeunload', event => {
    if (!fichaDirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  if (filtroEstado) filtroEstado.addEventListener('change', loadUnits);
  if (buscarInput) buscarInput.addEventListener('input', () => { clearTimeout(window.__deb); window.__deb = setTimeout(loadUnits, 250); });

  if (btnExportarCsv) {
  btnExportarCsv.addEventListener('click', async () => {
    try {
      const url = `/api/export/comercial.csv?projectId=${encodeURIComponent(id)}`;
      await downloadFile(url, `comercial_${id}.csv`);
    } catch (e) {
      console.error(e);
      alert(e.message || 'Error exportando CSV');
    }
  });
}

if (btnExportarExcel) {
  btnExportarExcel.addEventListener('click', async () => {
    try {
      const url = `/api/export/comercial.xlsx?projectId=${encodeURIComponent(id)}`;
      await downloadFile(url, `comercial_${id}.xlsx`);
    } catch (e) {
      console.error(e);
      alert(e.message || 'Error exportando Excel');
    }
  });
}

  function openSharedCreateUnits(context = 'commercial') {
    renderCreateBatchModalLayout();
    modalCrear.dataset.launchContext = context;
    const modelSelect = document.getElementById('cl-modeloSelect');
    if (modelSelect) modelSelect.innerHTML = projectModelOptions('', { includeEmpty: true });
    const loc = document.getElementById('cl-ubicacion');
    if (loc) loc.value = state?.project?.location || state?.project?.address || '';
    modalCrear.style.display='flex';
  }
  function openSharedModelsManager(context = 'commercial') {
    modalCrearModelo.dataset.launchContext = context;
    renderCommercialModelsManager();
    modalCrearModelo.style.display = 'flex';
  }
  window.openSharedCreateUnits = openSharedCreateUnits;
  window.openSharedModelsManager = openSharedModelsManager;
  if (btnCrear) btnCrear.addEventListener('click', () => openSharedCreateUnits('commercial'));
  if (btnCrearModelo) btnCrearModelo.addEventListener('click', () => openSharedModelsManager('commercial'));
  if (modalCrearCerrar) modalCrearCerrar.addEventListener('click', () => modalCrear.style.display='none');
  if (modalModeloCerrar) modalModeloCerrar.addEventListener('click', () => modalCrearModelo.style.display='none');
  if (btnBatch) btnBatch.addEventListener('click', openBatch);
  if (batchCerrar) batchCerrar.addEventListener('click', () => modalBatch.style.display='none');
  if (batchAplicar) batchAplicar.addEventListener('click', aplicarBatch);
  if (btnDel) btnDel.addEventListener('click', openDel);
  if (delCerrar) delCerrar.addEventListener('click', closeDel);
  if (delAplicar) delAplicar.addEventListener('click', aplicarDel);
  document.getElementById('cl-modeloSelect')?.addEventListener('change', (event) => applyProjectModelToOpenUnitForm(event.target.value));

  if (btnCrearSubmit) {
    btnCrearSubmit.addEventListener('click', async () => {
            // ROLE-SEP: bloquear creación si commercial y no aprobado
      if (myRole === 'commercial' && window.__COMMERCIAL_LOCKED) {
        alert('Este proyecto aún no está aprobado. Creación de unidades bloqueada.');
        return;
      }
      const body = {
        projectId: id,
        manzana: document.getElementById('cl-manzana').value || 'A',
        modo: 'A',
        cantidad: Number(document.getElementById('cl-cantidad').value || 0),
        modelId: document.getElementById('cl-modeloSelect')?.value || undefined,
        modelo: document.getElementById('cl-modelo').value || '',
        ubicacion: document.getElementById('cl-ubicacion')?.value || state?.project?.location || state?.project?.address || '',
        m2: parseInputNumber('cl-m2', document.getElementById('cl-m2').value || 0),
        areaAbierta: parseInputNumber('cl-areaAbierta', document.getElementById('cl-areaAbierta')?.value || 0),
        areaCerrada: parseInputNumber('cl-areaCerrada', document.getElementById('cl-areaCerrada')?.value || 0),
        recamaras: parseInputNumber('cl-recamaras', document.getElementById('cl-recamaras')?.value || 0),
        banos: parseInputNumber('cl-banos', document.getElementById('cl-banos')?.value || 0),
        precioVenta: parsePanamaNumber(document.getElementById('cl-precio').value || 0),
        costoUnidad: parsePanamaNumber(document.getElementById('cl-costo')?.value || 0),
        costoUnidadManual: false,
        estado: document.getElementById('cl-estado').value || 'disponible'
      };
      try {
        await apiPost('/api/units/batch', body);
        modalCrear.style.display = 'none';
        await loadUnits();
        await window.refreshTechnicalWorkspace?.({ force:true });
        await markProjectDataChanged();
      } catch (e) { alert('Error creando unidades: ' + e.message); }
    });
  }

  if (btnSelectAll) {
  btnSelectAll.addEventListener('click', () => {
    const total = (unitsCache || []).length;
    if (!total) return;

    if (selected.size >= total) deselectAllVisible();
    else selectAllVisible();
  });
  }

  // La carga inicial la orquesta el init principal para evitar llamadas duplicadas.
})();


// ======================
// ====== TÉCNICO
// ======================
const technicalWorkspace = {
  loaded: false,
  loading: null,
  units: [],
  ventas: new Map(),
  folders: [],
  unassigned: { name:'Sin carpeta', color:'#0f172a' },
  permits: null,
  templates: [],
  plans: [],
  selected: new Set(),
  permitFilter: 'all'
};
window.__technicalWorkspace = technicalWorkspace;

const TECHNICAL_PERMIT_META = {
  pending:     { label:'Pendiente', color:'#d97706' },
  in_progress: { label:'En curso', color:'#2563eb' },
  submitted:   { label:'Presentado', color:'#0891b2' },
  approved:    { label:'Aprobado', color:'#16a34a' },
  rejected:    { label:'Rechazado', color:'#dc2626' },
  waived:      { label:'Exonerado', color:'#64748b' }
};
const TECHNICAL_UNIT_STATES = [
  { v:'disponible', l:'Lote libre' }, { v:'inventario', l:'Inventario' },
  { v:'reservado', l:'Reservado' }, { v:'con_cpp', l:'Con CPP' },
  { v:'tramite_legal_activado', l:'Trámite legal' },
  { v:'escriturado_traspasado', l:'Traspasado' }
];

function technicalUnitState(value) {
  const stateValue = String(value || 'disponible').toLowerCase().trim();
  const aliases = { reservado_separado:'reservado', cpp_recibida:'con_cpp', venta_contado:'con_cpp', en_escrituracion:'tramite_legal_activado', escriturado:'escriturado_traspasado', entregado:'escriturado_traspasado', vivienda_entregada:'escriturado_traspasado' };
  return aliases[stateValue] || stateValue || 'disponible';
}

function technicalUnitStateLabel(value) {
  const normalized = technicalUnitState(value);
  return TECHNICAL_UNIT_STATES.find(item => item.v === normalized)?.l || normalized;
}

function technicalUnitReference(unit = {}) {
  return String(unit.code || `${unit.manzana || unit.modelo || ''}-${unit.lote || ''}`).trim();
}

function technicalPolicyApplies(policy = {}, unit = {}) {
  if (policy.appliesToAllUnits !== false) return true;
  const idValue = String(unit._id || '');
  const ref = technicalUnitReference(unit);
  return (policy.unitIds || []).some(value => String(value) === idValue)
    || (policy.unitRefs || []).some(value => String(value) === ref);
}

function technicalPoliciesForUnit(unit = {}) {
  const policies = projectInsurancePolicies().filter(policy => technicalPolicyApplies(policy, unit));
  return ['CAR','INCENDIO'].flatMap(type => {
    const typed = policies.filter(policy => String(policy.type || '').toUpperCase() === type);
    const specific = typed.filter(policy => policy.appliesToAllUnits === false);
    return specific.length ? specific : typed.filter(policy => policy.appliesToAllUnits !== false);
  });
}

function technicalDaysUntil(value) {
  if (!value) return null;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  return Math.ceil((target.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
}

function technicalKpi(label, value, detail, tone = '') {
  return `<article class="technical-kpi ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong><small>${escapeHtml(detail)}</small></article>`;
}

function renderTechnicalKpis() {
  const host = document.getElementById('technicalKpis');
  if (!host) return;
  const ventas = technicalWorkspace.ventas;
  const permits = technicalWorkspace.permits?.items || [];
  const activePermits = permits.filter(item => technicalPermitEffectiveStatus(item) !== 'waived');
  const approved = activePermits.filter(item => technicalPermitEffectiveStatus(item) === 'approved').length;
  const progress = activePermits.length ? Math.round(approved / activePermits.length * 100) : 0;
  const inConstruction = technicalWorkspace.units.filter(unit => ventas.get(String(unit._id))?.enConstruccion).length;
  const completed = technicalWorkspace.units.filter(unit => technicalConstructionPhase(ventas.get(String(unit._id))?.estatusConstruccion) === 'Terminada').length;
  const missingOccupation = technicalWorkspace.units.filter(unit => !ventas.get(String(unit._id))?.permisoOcupacion).length;
  const expiringPolicies = projectInsurancePolicies().filter(policy => {
    const days = technicalDaysUntil(policy.expiryDate);
    return days !== null && days <= 60;
  }).length;
  host.innerHTML = [
    technicalKpi('Permisos aprobados', `${progress}%`, `${approved} de ${activePermits.length || 0}`, progress === 100 ? 'is-success' : 'is-cyan'),
    technicalKpi('Unidades en obra', inConstruction, 'Construcción activa', 'is-cyan'),
    technicalKpi('Unidades terminadas', completed, 'Estado técnico', 'is-success'),
    technicalKpi('Sin permiso de ocupación', missingOccupation, 'Requieren seguimiento', missingOccupation ? 'is-warning' : 'is-success'),
    technicalKpi('Pólizas con alerta', expiringPolicies, 'Vencidas o a 60 días', expiringPolicies ? 'is-danger' : 'is-success')
  ].join('');
}

function technicalAggregatedPermitSummary(kind) {
  const rows = technicalWorkspace.units.map(unit => {
    const venta = technicalWorkspace.ventas.get(String(unit._id)) || {};
    const construction = kind === 'construction';
    const number = construction ? venta.permisoConstruccionNum : venta.permisoOcupacionNum;
    const approved = construction
      ? !!(venta.permisoConstruccionMunicipal || String(number || '').trim())
      : !!(venta.permisoOcupacion || String(number || '').trim());
    return { unit: commercialUnitName(unit), number: number || '—', approved };
  });
  const approved = rows.filter(row => row.approved).length;
  return {
    rows,
    approved,
    total: rows.length,
    status: rows.length > 0 && approved === rows.length ? 'approved' : 'pending'
  };
}

function technicalPermitAggregate(item) {
  if (isConstructionPermit(item)) return technicalAggregatedPermitSummary('construction');
  if (isOccupationPermit(item)) return technicalAggregatedPermitSummary('occupation');
  return null;
}

function technicalPermitEffectiveStatus(item) {
  return technicalPermitAggregate(item)?.status || item?.status || 'pending';
}

function technicalPermitDependencies(item, index) {
  return (item?.dependencies || []).map(code => {
    const dependency = index[code];
    return {
      code,
      title: dependency?.title || code,
      approved: technicalPermitEffectiveStatus(dependency) === 'approved'
    };
  });
}

function technicalPermitCanAdvance(status, dependencies) {
  return !['in_progress', 'submitted', 'approved'].includes(status)
    || dependencies.every(dependency => dependency.approved);
}

async function technicalUpdatePermitStatus(code, status, select) {
  const item = (technicalWorkspace.permits?.items || []).find(current => current.code === code);
  if (!item) return;
  const dependencies = technicalPermitDependencies(item, buildIndexByCode(technicalWorkspace.permits.items));
  if (!technicalPermitCanAdvance(status, dependencies)) {
    const pending = dependencies.filter(dependency => !dependency.approved).map(dependency => dependency.title);
    alert(`Antes de avanzar este trámite debes aprobar:\n• ${pending.join('\n• ')}`);
    select.value = technicalPermitEffectiveStatus(item);
    return;
  }
  const previous = item.status;
  select.disabled = true;
  select.closest('.technical-permit-card')?.classList.add('is-saving');
  try {
    const fresh = await apiPermitsPatchItem(code, { status });
    technicalWorkspace.permits = fresh;
    __permits = fresh;
    renderTechnicalPermits();
    renderTechnicalKpis();
    updatePermitsByInstitutionChart();
    await markProjectDataChanged({ refreshSummary:true });
  } catch (error) {
    item.status = previous;
    select.value = previous;
    select.disabled = false;
    select.closest('.technical-permit-card')?.classList.remove('is-saving');
    console.error('[Técnico] status permiso', error);
    alert('No se pudo actualizar el estado del permiso.');
  }
}

async function technicalPermitDocuments(code, host) {
  if (!host) return;
  host.innerHTML = '<div class="technical-detail-empty">Cargando documentos…</div>';
  try {
    let response = await fetch(`/api/documents?projectId=${id}&category=permits&permitCode=${encodeURIComponent(code)}&ts=${Date.now()}`, { headers:{ ...authHeaders(), ...tenantHeaders() } });
    let documents = response.ok ? await response.json() : [];
    if (!response.ok) {
      response = await fetch(`/api/documents?projectId=${id}&category=permits&ts=${Date.now()}`, { headers:{ ...authHeaders(), ...tenantHeaders() } });
      documents = response.ok ? await response.json() : [];
      const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matcher = new RegExp(escapedCode, 'i');
      documents = (documents || []).filter(document => matcher.test(document.title || '') || matcher.test(document.originalname || ''));
    }
    host.innerHTML = documents.length ? documents.map(document => `
      <div class="technical-detail-document">
        <div><strong>${escapeHtml(document.originalname || document.filename || 'Documento')}</strong><span>${document.createdAt ? new Date(document.createdAt).toLocaleDateString() : 'Sin fecha'}${document.expiryDate ? ` · Caduca ${new Date(document.expiryDate).toLocaleDateString()}` : ''}</span></div>
        <a class="btn btn-ghost btn-xs js-secure-file" href="#" data-url="${secureDocUrl(document._id)}" data-filename="${escapeHtml(document.originalname || document.filename || 'documento')}" data-action="view">Ver</a>
      </div>`).join('') : '<div class="technical-detail-empty">Todavía no hay documentos en este trámite.</div>';
  } catch (error) {
    console.error('[Técnico] documentos permiso', error);
    host.innerHTML = '<div class="technical-detail-empty is-error">No se pudieron cargar los documentos.</div>';
  }
}

function technicalUploadPermitDocuments(code) {
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.multiple = true;
  picker.onchange = async () => {
    const files = [...(picker.files || [])];
    if (!files.length) return;
    const expiryDate = String(prompt('Fecha de caducidad (AAAA-MM-DD, opcional):', '') || '').trim();
    if (expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) return alert('La fecha debe tener formato AAAA-MM-DD.');
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    formData.append('projectId', id);
    formData.append('category', 'permits');
    formData.append('permitCode', code);
    if (expiryDate) formData.append('expiryDate', expiryDate);
    try {
      const response = await fetch('/api/documents/upload', { method:'POST', body:formData, headers:{ ...authHeaders(), ...tenantHeaders() }, credentials:'include' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`);
      await technicalPermitDocuments(code, document.getElementById('technicalPermitDetailDocuments'));
      await loadTechnicalWorkspace({ force:true, preserveSelection:true });
      invalidateProjectDocsCache?.();
      await markProjectDataChanged();
    } catch (error) {
      alert(error.message || 'No se pudieron adjuntar los documentos.');
    }
  };
  picker.click();
}

function openTechnicalPermitDetail(code) {
  const item = (technicalWorkspace.permits?.items || []).find(current => current.code === code);
  if (!item) return;
  const index = buildIndexByCode(technicalWorkspace.permits.items);
  const dependencies = technicalPermitDependencies(item, index);
  const aggregate = technicalPermitAggregate(item);
  const status = technicalPermitEffectiveStatus(item);
  const meta = TECHNICAL_PERMIT_META[status] || TECHNICAL_PERMIT_META.pending;
  const list = (values, empty) => values?.length ? `<ul>${values.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>` : `<div class="technical-detail-empty">${empty}</div>`;
  const dependencyHtml = dependencies.length ? dependencies.map(dependency => `<div class="technical-dependency-row ${dependency.approved ? 'is-approved' : 'is-pending'}"><span>${dependency.approved ? '✓' : '!'}</span><div><strong>${escapeHtml(dependency.title)}</strong><small>${dependency.approved ? 'Aprobado' : 'Pendiente de aprobación'}</small></div></div>`).join('') : '<div class="technical-detail-empty">Este trámite no necesita una aprobación previa.</div>';
  const unitHtml = aggregate ? `<section class="technical-detail-section"><h4>Estado por unidad comercial</h4><div class="technical-detail-units">${aggregate.rows.length ? aggregate.rows.map(row => `<div><span>${escapeHtml(row.unit)}</span><strong>${escapeHtml(row.number)}</strong><em class="${row.approved ? 'is-approved' : 'is-pending'}">${row.approved ? 'Aprobado' : 'Pendiente'}</em></div>`).join('') : '<div class="technical-detail-empty">No hay unidades comerciales.</div>'}</div></section>` : '';
  openModal(item.title || item.code, `
    <div class="technical-permit-detail" style="--permit-color:${meta.color}">
      <header><div><span>${escapeHtml(item.institution || 'Institución no informada')}</span><strong>${escapeHtml(meta.label)}</strong></div><div class="technical-detail-facts"><span style="color: white;"><b>${item.slaDays || '—'}</b> días hábiles</span><span style="color: white;"><b>${dependencies.length}</b> dependencias</span></div></header>
      <section class="technical-detail-section"><h4>Aprobaciones previas</h4><div class="technical-dependency-list">${dependencyHtml}</div></section>
      <section class="technical-detail-section"><h4>Requisitos</h4>${list(item.requirements, 'No hay requisitos descritos.')}</section>
      <section class="technical-detail-section"><h4>Observaciones</h4>${list(item.observations, 'No hay observaciones.')}</section>
      ${unitHtml}
      <section class="technical-detail-section"><div class="technical-detail-section-head"><h4>Documentos</h4><button id="technicalPermitDetailUpload" class="btn btn-ghost btn-xs" type="button">Adjuntar documentos</button></div><div id="technicalPermitDetailDocuments"></div></section>
    </div>`, 'Cerrar', () => { modalBackdrop.style.display = 'none'; });
  document.getElementById('technicalPermitDetailUpload')?.addEventListener('click', () => technicalUploadPermitDocuments(code));
  technicalPermitDocuments(code, document.getElementById('technicalPermitDetailDocuments'));
}

function technicalRecommendedTemplate(template) {
  const haystack = `${template?.name || ''} ${(template?.items || []).map(item => `${item.type || ''} ${item.title || ''}`).join(' ')}`.toLowerCase();
  const projectType = String(state.project?.projectType || state.project?.tipoProyecto || '').toLowerCase();
  if ((template?.projectTypes || []).some(value => String(value || '').toLowerCase() === projectType)) return 100;
  const tokens = projectType.split(/[^a-záéíóúñ]+/i).filter(token => token.length > 4);
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function renderTechnicalTemplatePicker() {
  const select = document.getElementById('technicalPermitTemplate');
  if (!select) return;
  const ranked = [...technicalWorkspace.templates].sort((a,b) => technicalRecommendedTemplate(b) - technicalRecommendedTemplate(a));
  const topScore = ranked.length ? technicalRecommendedTemplate(ranked[0]) : 0;
  select.innerHTML = ranked.length
    ? ranked.map((template, index) => `<option value="${escapeHtml(template._id)}">${index === 0 && topScore > 0 ? '★ Recomendada · ' : ''}${escapeHtml(template.name)} · v${escapeHtml(template.version || 1)}</option>`).join('')
    : '<option value="">No hay plantillas disponibles</option>';
}

function technicalPermitPhaseStorageKey(phase) {
  return `bank73_technical_permit_phase_${id}_${String(phase || 'sin-etapa')}`;
}

function technicalPermitPhaseExpanded(phase) {
  return localStorage.getItem(technicalPermitPhaseStorageKey(phase)) === '1';
}

function renderTechnicalPermits() {
  const board = document.getElementById('technicalPermitsBoard');
  const progressHost = document.getElementById('technicalPermitProgress');
  if (!board || !progressHost) return;
  const items = technicalWorkspace.permits?.items || [];
  const relevant = items.filter(item => technicalPermitEffectiveStatus(item) !== 'waived');
  const approved = relevant.filter(item => technicalPermitEffectiveStatus(item) === 'approved').length;
  const progress = relevant.length ? Math.round(approved / relevant.length * 100) : 0;
  progressHost.innerHTML = `<div class="technical-progress-ring" style="--progress:${progress}"><strong>${progress}%</strong></div><div class="technical-progress-copy"><strong>${approved} de ${relevant.length} aprobados</strong><span>${items.length ? `Plantilla v${technicalWorkspace.permits?.templateVersion || 1}` : 'Selecciona una plantilla para comenzar'}</span></div>`;

  const filtered = items.filter(item => {
    if (technicalWorkspace.permitFilter === 'all') return true;
    const status = technicalPermitEffectiveStatus(item);
    if (technicalWorkspace.permitFilter === 'attention') return ['pending','rejected'].includes(status) || (technicalDaysUntil(item.dueDate) ?? 999) < 0;
    return status === technicalWorkspace.permitFilter;
  });
  const index = buildIndexByCode(items);
  const grouped = groupByPhase(filtered);
  const allPhasesExpanded = grouped.order.length > 0 && grouped.order.every(technicalPermitPhaseExpanded);
  const phaseToggle = document.getElementById('technicalTogglePermitPhases');
  if (phaseToggle) {
    phaseToggle.textContent = allPhasesExpanded ? 'Contraer etapas' : 'Desplegar etapas';
    phaseToggle.dataset.expanded = allPhasesExpanded ? 'true' : 'false';
  }
  board.innerHTML = filtered.length ? grouped.order.map(phase => {
    const phaseItems = grouped.groups[phase] || [];
    const phaseApproved = phaseItems.filter(item => technicalPermitEffectiveStatus(item) === 'approved').length;
    const phaseAttention = phaseItems.filter(item => {
      const status = technicalPermitEffectiveStatus(item);
      return ['pending','rejected'].includes(status) || (technicalDaysUntil(item.dueDate) ?? 999) < 0;
    }).length;
    const phaseInProgress = phaseItems.filter(item => ['in_progress','submitted'].includes(technicalPermitEffectiveStatus(item))).length;
    const phaseProgress = phaseItems.length ? Math.round(phaseApproved / phaseItems.length * 100) : 0;
    const expanded = technicalPermitPhaseExpanded(phase);
    return `<section class="technical-permit-phase ${expanded ? 'is-expanded' : 'is-collapsed'}" data-technical-permit-phase="${escapeHtml(phase)}">
      <header><button class="technical-permit-phase-toggle" type="button" aria-expanded="${expanded ? 'true' : 'false'}">
        <span class="technical-permit-phase-index">Etapa</span>
        <span class="technical-permit-phase-title"><strong>${escapeHtml(phase)}</strong><small>${phaseItems.length} ${phaseItems.length === 1 ? 'trámite' : 'trámites'}</small></span>
        <span class="technical-permit-phase-summary">
          ${phaseAttention ? `<em class="is-attention">${phaseAttention} requieren atención</em>` : ''}
          ${phaseInProgress ? `<em class="is-progress">${phaseInProgress} en curso</em>` : ''}
          ${phaseApproved === phaseItems.length && phaseItems.length ? '<em class="is-complete">Etapa completa</em>' : ''}
          <b>${phaseApproved}/${phaseItems.length} aprobados</b>
        </span>
        <span class="technical-permit-phase-meter" aria-label="${phaseProgress}% aprobado"><i style="width:${phaseProgress}%"></i></span>
        <span class="technical-permit-phase-chevron" aria-hidden="true">⌄</span>
      </button></header>
      <div class="technical-permit-phase-grid">${phaseItems.map((item, itemIndex) => {
        const status = technicalPermitEffectiveStatus(item);
        const meta = TECHNICAL_PERMIT_META[status] || TECHNICAL_PERMIT_META.pending;
        const dependencies = technicalPermitDependencies(item, index);
        const pending = dependencies.filter(dependency => !dependency.approved);
        const aggregate = technicalPermitAggregate(item);
        const days = technicalDaysUntil(item.dueDate);
        const dueText = days === null ? 'Sin fecha límite' : days < 0 ? `Vencido hace ${Math.abs(days)} días` : days === 0 ? 'Vence hoy' : `${days} días restantes`;
        const prerequisite = dependencies.length
          ? pending.length ? `Faltan ${pending.length} aprobaciones previas` : 'Prerequisitos aprobados'
          : 'Sin prerequisitos';
        return `<article class="technical-permit-card ${pending.length ? 'is-blocked' : 'is-ready'} ${aggregate ? 'is-automatic' : ''}" data-code="${escapeHtml(item.code)}" style="--permit-color:${meta.color}">
          <div class="technical-permit-card-sequence"><span>${String(itemIndex + 1).padStart(2,'0')}</span><i></i></div>
          <div class="technical-permit-card-head"><span class="technical-section-kicker">${escapeHtml(item.institution || 'General')}</span><span class="technical-permit-status">${meta.label}</span></div>
          <h5>${escapeHtml(item.title || item.code)}</h5>
          <div class="technical-permit-prerequisite ${pending.length ? 'is-pending' : 'is-approved'}"><span>${pending.length ? '!' : '✓'}</span><strong>${escapeHtml(prerequisite)}</strong></div>
          ${dependencies.length ? `<div class="technical-permit-dependencies">${dependencies.slice(0,2).map(dependency => `<span class="${dependency.approved ? 'is-approved' : ''}" title="${escapeHtml(dependency.title)}">${dependency.approved ? '✓' : '•'} ${escapeHtml(dependency.title)}</span>`).join('')}${dependencies.length > 2 ? `<span>+${dependencies.length - 2} más</span>` : ''}</div>` : ''}
          <div class="technical-permit-facts"><span><small>Plazo</small><strong>${item.slaDays ? `${item.slaDays} días hábiles` : 'No informado'}</strong></span><span><small>Vencimiento</small><strong>${escapeHtml(dueText)}</strong></span></div>
          ${aggregate ? `<div class="technical-permit-auto-note">Se actualiza desde las unidades: ${aggregate.approved}/${aggregate.total} aprobadas</div>` : ''}
          <div class="technical-permit-card-actions">
            <label class="technical-permit-state-label"><span>Estado</span>
              <select class="technical-permit-state" data-code="${escapeHtml(item.code)}" ${aggregate ? 'disabled' : ''} aria-label="Estado de ${escapeHtml(item.title || item.code)}">${PERMIT_STATES.map(value => `<option value="${value}" ${status === value ? 'selected' : ''}>${PERMIT_LABEL[value]}</option>`).join('')}</select>
            </label>
            <button class="technical-permit-detail-button js-technical-permit-detail" type="button" data-code="${escapeHtml(item.code)}">Ficha</button>
          </div>
        </article>`;
      }).join('')}</div>
    </section>`;
  }).join('') : `<div class="technical-empty">${items.length ? 'No hay permisos en este filtro.' : 'Todavía no hay una ruta de permisos. Escoge arriba la plantilla apropiada para la tipología.'}</div>`;
}

function technicalUnitMatchesFilters(unit, venta) {
  const construction = document.getElementById('technicalConstructionFilter')?.value || '';
  const permitFilter = document.getElementById('technicalPermitFilter')?.value || '';
  const query = String(document.getElementById('technicalUnitSearch')?.value || '').trim().toLowerCase();
  if (construction && technicalConstructionPhase(venta?.estatusConstruccion) !== construction) return false;
  if (permitFilter === 'missing-construction' && venta?.permisoConstruccionMunicipal) return false;
  if (permitFilter === 'missing-occupation' && venta?.permisoOcupacion) return false;
  if (permitFilter === 'complete' && !(venta?.permisoConstruccionMunicipal && venta?.permisoOcupacion)) return false;
  if (query) {
    const text = [unit.manzana, unit.lote, unit.modelo, venta?.estatusConstruccion, venta?.constructora, venta?.permisoConstruccionNum, venta?.permisoOcupacionNum].join(' ').toLowerCase();
    if (!text.includes(query)) return false;
  }
  return true;
}

function technicalConstructionPhase(value = '') {
  const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  if (normalized === 'culminada' || normalized === 'terminada') return 'Terminada';
  if (normalized === 'obra gris') return 'Obra gris';
  if (normalized === 'acabados') return 'Acabados';
  return 'Pendiente';
}

function technicalConstructionTone(value, active = false) {
  const normalized = String(value || (active ? 'En construcción' : 'Pendiente'))
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  if (normalized === 'culminada' || normalized === 'terminada') return 'completed';
  if (normalized === 'acabados') return 'finishes';
  if (normalized === 'obra gris') return 'gray-work';
  if (normalized.includes('construccion') || active) return 'in-progress';
  return 'pending';
}

function technicalUnitCard(unit) {
  const venta = technicalWorkspace.ventas.get(String(unit._id)) || {};
  const policies = technicalPoliciesForUnit(unit);
  const idValue = String(unit._id);
  const construction = venta.enConstruccion && !venta.estatusConstruccion ? 'En construcción' : technicalConstructionPhase(venta.estatusConstruccion);
  const constructionTone = technicalConstructionTone(construction, venta.enConstruccion);
  return `<article class="unit-card construction-${escapeHtml(constructionTone)} ${technicalWorkspace.selected.has(idValue) ? 'selected' : ''}" data-technical-unit="${escapeHtml(idValue)}" draggable="true">
    <div class="head"><div class="title"><b>${escapeHtml(unit.manzana || '-')}-${escapeHtml(unit.lote || '')}</b><span class="status">${escapeHtml(technicalUnitStateLabel(unit.estado || 'disponible'))}</span></div><label class="sel-wrap" title="Seleccionar"><input class="sel" type="checkbox" ${technicalWorkspace.selected.has(idValue) ? 'checked' : ''}><span class="sel-box"></span></label></div>
    <div class="meta">${escapeHtml(unit.modelo || 'Sin modelo')} · ${escapeHtml(unit.m2 || 0)} m²</div>
    <div class="technical-construction-state"><span>Estado de obra</span><strong>${escapeHtml(construction)}</strong></div>
    <div class="badges">
      <span class="chip technical-signal ${venta.permisoConstruccionMunicipal ? 'is-ok' : 'is-warning'}"><i>${venta.permisoConstruccionMunicipal ? '✓' : '!'}</i><span><small>Permiso</small>Construcción</span></span>
      <span class="chip technical-signal ${venta.permisoOcupacion ? 'is-ok' : 'is-warning'}"><i>${venta.permisoOcupacion ? '✓' : '!'}</i><span><small>Permiso</small>Ocupación</span></span>
      ${policies.length ? policies.map(policy => `<span class="chip technical-signal ${technicalDaysUntil(policy.expiryDate) < 0 ? 'is-danger' : 'is-ok'}"><i>${technicalDaysUntil(policy.expiryDate) < 0 ? '!' : '✓'}</i><span><small>Póliza</small>${escapeHtml(policy.type || 'Cobertura')} · ${escapeHtml(policy.policyNumber || 'sin número')}</span></span>`).join('') : '<span class="chip technical-signal is-warning"><i>!</i><span><small>Póliza</small>Sin cobertura</span></span>'}
    </div>
  </article>`;
}

function technicalFolderCollapsed(folderId) {
  return localStorage.getItem(`bank73_com_folder_closed_${id}_${folderId || 'unassigned'}`) === '1';
}

function renderTechnicalUnits() {
  const gridHost = document.getElementById('technicalUnitsGrid');
  const kpiHost = document.getElementById('technicalUnitKpis');
  if (!gridHost || !kpiHost) return;
  const all = technicalWorkspace.units;
  const filtered = all.filter(unit => technicalUnitMatchesFilters(unit, technicalWorkspace.ventas.get(String(unit._id)) || {}));
  const ventas = technicalWorkspace.ventas;
  const inWork = all.filter(unit => ventas.get(String(unit._id))?.enConstruccion).length;
  const completed = all.filter(unit => technicalConstructionPhase(ventas.get(String(unit._id))?.estatusConstruccion) === 'Terminada').length;
  const missingConstruction = all.filter(unit => !ventas.get(String(unit._id))?.permisoConstruccionMunicipal).length;
  const missingOccupation = all.filter(unit => !ventas.get(String(unit._id))?.permisoOcupacion).length;
  kpiHost.innerHTML = [
    technicalKpi('En construcción', inWork, `${all.length} unidades totales`, 'is-cyan'),
    technicalKpi('Terminadas', completed, 'Obra finalizada', 'is-success'),
    technicalKpi('Sin permiso construcción', missingConstruction, 'Pendientes', missingConstruction ? 'is-warning' : 'is-success'),
    technicalKpi('Sin permiso ocupación', missingOccupation, 'Pendientes', missingOccupation ? 'is-warning' : 'is-success')
  ].join('');

  const grouped = new Map(technicalWorkspace.folders.map(folder => [String(folder._id), []]));
  const unassigned = [];
  filtered.forEach(unit => {
    const folderId = unit.folderId ? String(unit.folderId) : '';
    if (folderId && grouped.has(folderId)) grouped.get(folderId).push(unit); else unassigned.push(unit);
  });
  const folderHtml = (folder, units, isUnassigned = false) => {
    const folderId = isUnassigned ? '' : String(folder._id);
    const collapseKey = isUnassigned ? 'unassigned' : folderId;
    const collapsed = technicalFolderCollapsed(collapseKey);
    return `<section class="commercial-folder ${isUnassigned ? 'unassigned' : ''} ${collapsed ? 'collapsed' : ''}" data-technical-folder="${escapeHtml(folderId)}" style="--folder-color:${escapeHtml(folder.color || '#0f172a')}">
      <div class="commercial-folder-head"><h3>${escapeHtml(folder.name || 'Sin carpeta')}</h3><div class="folder-actions"><span>${units.length} unidades</span><button type="button" class="btn mini" data-technical-folder-toggle="${escapeHtml(collapseKey)}">${collapsed ? 'Mostrar' : 'Ocultar'}</button></div></div>
      <div class="commercial-folder-body">${units.map(technicalUnitCard).join('') || '<div class="empty">No hay unidades en esta vista.</div>'}</div>
    </section>`;
  };
  gridHost.innerHTML = folderHtml(technicalWorkspace.unassigned, unassigned, true) + technicalWorkspace.folders.map(folder => folderHtml(folder, grouped.get(String(folder._id)) || [])).join('');
  bindTechnicalUnitCards();
  updateTechnicalSelection();
}

function updateTechnicalSelection() {
  const count = technicalWorkspace.selected.size;
  const label = document.getElementById('technicalSelectionCount');
  const selectAll = document.getElementById('technicalSelectAll');
  const batch = document.getElementById('technicalBatchEdit');
  const remove = document.getElementById('technicalDeleteUnits');
  if (label) label.textContent = `${count} ${count === 1 ? 'seleccionada' : 'seleccionadas'}`;
  if (batch) batch.disabled = count === 0;
  if (remove) remove.disabled = count === 0;
  if (selectAll) {
    const visible = document.querySelectorAll('#technicalUnitsGrid [data-technical-unit]').length;
    const selectedVisible = [...document.querySelectorAll('#technicalUnitsGrid [data-technical-unit]')].filter(card => technicalWorkspace.selected.has(card.dataset.technicalUnit)).length;
    selectAll.textContent = visible > 0 && selectedVisible === visible ? 'Deseleccionar todo' : 'Seleccionar todo';
  }
}

function bindTechnicalUnitCards() {
  const gridHost = document.getElementById('technicalUnitsGrid');
  if (!gridHost) return;
  gridHost.querySelectorAll('[data-technical-unit]').forEach(card => {
    const unitId = card.dataset.technicalUnit;
    card.addEventListener('click', event => {
      if (event.target.closest('.sel-wrap')) return;
      window.abrirFichaUnidad?.(unitId, { mode:'technical' });
    });
    card.querySelector('.sel')?.addEventListener('change', event => {
      if (event.target.checked) technicalWorkspace.selected.add(unitId); else technicalWorkspace.selected.delete(unitId);
      card.classList.toggle('selected', event.target.checked);
      updateTechnicalSelection();
    });
    card.addEventListener('dragstart', event => {
      const ids = technicalWorkspace.selected.has(unitId) ? [...technicalWorkspace.selected] : [unitId];
      event.dataTransfer.setData('application/json', JSON.stringify(ids));
      event.dataTransfer.setData('text/plain', unitId);
    });
  });
  gridHost.querySelectorAll('[data-technical-folder]').forEach(folder => {
    folder.addEventListener('dragover', event => { event.preventDefault(); folder.classList.add('is-drag-over'); });
    folder.addEventListener('dragleave', event => { if (!folder.contains(event.relatedTarget)) folder.classList.remove('is-drag-over'); });
    folder.addEventListener('drop', async event => {
      event.preventDefault(); folder.classList.remove('is-drag-over');
      let ids = [];
      try { ids = JSON.parse(event.dataTransfer.getData('application/json') || '[]'); } catch (_) {}
      if (!ids.length) ids = [event.dataTransfer.getData('text/plain')].filter(Boolean);
      if (!ids.length) return;
      try {
        if (folder.dataset.technicalFolder) await API.patch(`/api/commercial-folders/${folder.dataset.technicalFolder}/units`, { unitIds:ids });
        else await API.patch('/api/commercial-folders/unassigned/units', { unitIds:ids, projectId:id });
        await loadTechnicalWorkspace({ force:true, preserveSelection:true });
        await window.loadUnits?.();
      } catch (error) { alert(error.message || 'No se pudieron mover las unidades.'); }
    });
  });
  gridHost.querySelectorAll('[data-technical-folder-toggle]').forEach(button => button.addEventListener('click', event => {
    event.preventDefault(); event.stopPropagation();
    const key = button.dataset.technicalFolderToggle;
    const folder = button.closest('.commercial-folder');
    const collapsed = !folder.classList.contains('collapsed');
    localStorage.setItem(`bank73_com_folder_closed_${id}_${key}`, collapsed ? '1' : '0');
    folder.classList.toggle('collapsed', collapsed);
    button.textContent = collapsed ? 'Mostrar' : 'Ocultar';
  }));
}

function renderTechnicalDocuments() {
  const plansHost = document.getElementById('technicalPlansList');
  const policiesHost = document.getElementById('technicalPoliciesList');
  if (!plansHost || !policiesHost) return;
  document.getElementById('technicalPlansCount').textContent = technicalWorkspace.plans.length;
  document.getElementById('technicalPoliciesCount').textContent = projectInsurancePolicies().length;
  plansHost.innerHTML = technicalWorkspace.plans.length ? technicalWorkspace.plans.map(doc => `<div class="technical-library-row"><div><strong>${escapeHtml(doc.originalname || doc.name || doc.title || 'Plano arquitectónico')}</strong><span>${escapeHtml(doc.subfolder || doc.folder || 'Planos')} · ${escapeHtml(String(doc.createdAt || '').slice(0,10) || 'Sin fecha')}</span></div><a class="btn btn-ghost btn-xs js-secure-file" href="#" data-url="${secureDocUrl(doc._id)}" data-filename="${escapeHtml(doc.originalname || 'plano')}" data-action="view">Ver</a></div>`).join('') : '<div class="technical-empty">No hay planos arquitectónicos adjuntos.</div>';
  const unitsById = new Map(technicalWorkspace.units.map(unit => [String(unit._id), unit]));
  policiesHost.innerHTML = projectInsurancePolicies().length ? projectInsurancePolicies().map(policy => {
    const coverage = policy.appliesToAllUnits !== false ? 'Todas las unidades' : (policy.unitIds || []).map(value => technicalUnitReference(unitsById.get(String(value)) || {}) || value).join(', ') || (policy.unitRefs || []).join(', ') || 'Sin unidades';
    const days = technicalDaysUntil(policy.expiryDate);
    const due = days === null ? 'Sin vencimiento' : days < 0 ? `Vencida hace ${Math.abs(days)} días` : `${days} días restantes`;
    return `<div class="technical-library-row"><div><strong>${escapeHtml(policy.type || 'Póliza')} · ${escapeHtml(policy.policyNumber || 'Sin número')}</strong><span>${escapeHtml(policy.insurer || 'Aseguradora no informada')} · ${escapeHtml(due)}</span><span>${escapeHtml(coverage)}</span></div>${policy.documentId ? `<a class="btn btn-ghost btn-xs js-secure-file" href="#" data-url="${secureDocUrl(policy.documentId)}" data-filename="${escapeHtml(policy.documentName || 'poliza')}" data-action="view">Ver</a>` : ''}</div>`;
  }).join('') : '<div class="technical-empty">No hay pólizas CAR o incendio registradas.</div>';
}

async function loadTechnicalWorkspace({ force = false, preserveSelection = false } = {}) {
  if (!document.getElementById('tab-tecnico')) return;
  if (technicalWorkspace.loading) {
    await technicalWorkspace.loading;
    if (!force) return;
  }
  const previousSelection = preserveSelection ? new Set(technicalWorkspace.selected) : new Set();
  technicalWorkspace.loading = (async () => {
    const [units, ventas, folderData, permits, templates, plans] = await Promise.all([
      API.get(`/api/units?projectId=${encodeURIComponent(id)}&estado=&q=`),
      API.get(`/api/ventas?projectId=${encodeURIComponent(id)}`).catch(() => []),
      API.get(`/api/commercial-folders?projectId=${encodeURIComponent(id)}`).catch(() => ({ folders:[], unassigned:{ name:'Sin carpeta', color:'#0f172a' } })),
      apiPermitsGetProject(true).catch(() => null),
      apiPermitsGetTemplates().catch(() => []),
      API.get(`/api/documents?projectId=${encodeURIComponent(id)}&category=architecturalPlans&ts=${Date.now()}`).catch(() => [])
    ]);
    technicalWorkspace.units = units || [];
    technicalWorkspace.ventas = new Map((ventas || []).map(venta => [String(venta.unitId), venta]));
    technicalWorkspace.folders = Array.isArray(folderData) ? folderData : (folderData.folders || []);
    technicalWorkspace.unassigned = folderData.unassigned || { name:'Sin carpeta', color:'#0f172a' };
    technicalWorkspace.permits = permits;
    technicalWorkspace.templates = templates || [];
    technicalWorkspace.plans = plans || [];
    technicalWorkspace.selected = new Set([...previousSelection].filter(unitId => technicalWorkspace.units.some(unit => String(unit._id) === unitId)));
    INSURANCE_UNITS_CACHE = technicalWorkspace.units;
    renderTechnicalTemplatePicker();
    renderTechnicalKpis();
    renderTechnicalPermits();
    renderTechnicalUnits();
    renderTechnicalDocuments();
    if (permits) __permits = permits;
    technicalWorkspace.loaded = true;
    updatePermitsByInstitutionChart();
  })();
  try { await technicalWorkspace.loading; } finally { technicalWorkspace.loading = null; }
}
window.refreshTechnicalWorkspace = loadTechnicalWorkspace;

function openTechnicalBatchEditor() {
  if (!technicalWorkspace.selected.size) return alert('Selecciona al menos una unidad.');
  const policies = projectInsurancePolicies();
  openModal('Editar selección técnica', `<div class="technical-batch-form">
    <label>Estado comercial<select id="technicalBatchState"><option value="">(no cambiar)</option>${TECHNICAL_UNIT_STATES.map(item => `<option value="${item.v}">${item.l}</option>`).join('')}</select></label>
    <label>Avance de obra (%)<input id="technicalBatchConstructionProgress" type="number" min="0" max="100" placeholder="(no cambiar)"></label>
    <label>Fase de obra<select id="technicalBatchConstructionStatus"><option value="">(no cambiar)</option><option value="Obra gris">Obra gris</option><option value="Acabados">Acabados</option><option value="Terminada">Terminada</option></select></label>
    <label>Constructora<input id="technicalBatchBuilder" placeholder="(no cambiar)"></label>
    <label>Permiso de construcción<select id="technicalBatchConstructionPermit"><option value="">(no cambiar)</option><option value="true">Sí</option><option value="false">No</option></select></label>
    <label>Resolución construcción<input id="technicalBatchConstructionNumber" placeholder="(no cambiar)"></label>
    <label>Vencimiento construcción<input id="technicalBatchConstructionExpiry" type="date"></label>
    <label>Permiso de ocupación<select id="technicalBatchOccupationPermit"><option value="">(no cambiar)</option><option value="true">Sí</option><option value="false">No</option></select></label>
    <label>Resolución ocupación<input id="technicalBatchOccupationNumber" placeholder="(no cambiar)"></label>
    <label>Fecha emisión ocupación<input id="technicalBatchOccupationDate" type="date"></label>
    <label class="technical-batch-wide">Póliza<select id="technicalBatchPolicy"><option value="">(no cambiar)</option>${policies.map(policy => `<option value="${escapeHtml(policy._id)}">${escapeHtml(policy.type || 'Póliza')} · ${escapeHtml(policy.policyNumber || 'Sin número')}</option>`).join('')}</select></label>
    <label class="technical-batch-wide">Acción sobre la póliza<select id="technicalBatchPolicyAction"><option value="add">Asignar a las unidades seleccionadas</option><option value="remove">Desasignar de las unidades seleccionadas</option></select></label>
    <div class="technical-batch-wide small muted">Solo se modificarán los campos completados. Las pólizas siguen siendo únicas y compartidas.</div>
    <div class="technical-batch-wide row" style="justify-content:flex-end"><button id="technicalBatchSave" class="btn" type="button">Aplicar a ${technicalWorkspace.selected.size} unidades</button></div>
  </div>`, 'Cancelar', () => { modalBackdrop.style.display = 'none'; });

  document.getElementById('technicalBatchSave')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const ids = [...technicalWorkspace.selected];
    const read = elementId => String(document.getElementById(elementId)?.value || '').trim();
    const unitUpdate = {};
    const ventaUpdate = {};
    if (read('technicalBatchState')) unitUpdate.estado = read('technicalBatchState');
    if (read('technicalBatchConstructionProgress')) {
      ventaUpdate.avanceConstruccionPct = Math.min(100, Math.max(0, Number(read('technicalBatchConstructionProgress'))));
      ventaUpdate.enConstruccion = ventaUpdate.avanceConstruccionPct > 0 && ventaUpdate.avanceConstruccionPct < 100;
    }
    if (read('technicalBatchConstructionStatus')) {
      ventaUpdate.estatusConstruccion = read('technicalBatchConstructionStatus');
      ventaUpdate.faseConstruccion = read('technicalBatchConstructionStatus');
    }
    if (read('technicalBatchBuilder')) ventaUpdate.constructora = read('technicalBatchBuilder');
    if (read('technicalBatchConstructionPermit')) ventaUpdate.permisoConstruccionMunicipal = read('technicalBatchConstructionPermit') === 'true';
    if (read('technicalBatchConstructionNumber')) ventaUpdate.permisoConstruccionNum = read('technicalBatchConstructionNumber');
    if (read('technicalBatchConstructionExpiry')) ventaUpdate.permisoConstruccionVencimiento = read('technicalBatchConstructionExpiry');
    if (read('technicalBatchOccupationPermit')) ventaUpdate.permisoOcupacion = read('technicalBatchOccupationPermit') === 'true';
    if (read('technicalBatchOccupationNumber')) ventaUpdate.permisoOcupacionNum = read('technicalBatchOccupationNumber');
    if (read('technicalBatchOccupationDate')) ventaUpdate.fechaEmisionPermisoOcupacion = read('technicalBatchOccupationDate');
    button.disabled = true; button.textContent = 'Guardando…';
    try {
      if (Object.keys(unitUpdate).length) await API.patch('/api/units/batch', { ids, update:unitUpdate, projectId:id });
      if (Object.keys(ventaUpdate).length) await API.patch('/api/ventas/batch', { unitIds:ids, update:ventaUpdate, upsert:true, projectId:id });
      const policyId = read('technicalBatchPolicy');
      if (policyId) {
        const action = read('technicalBatchPolicyAction');
        const selectedSet = new Set(ids);
        const allUnits = technicalWorkspace.units;
        const changedPolicies = policies.map(policy => {
          if (String(policy._id) !== policyId) return policy;
          const coverageIds = policy.appliesToAllUnits !== false ? allUnits.map(unit => String(unit._id)) : (policy.unitIds || []).map(String);
          const nextIds = action === 'add' ? new Set([...coverageIds, ...ids]) : new Set(coverageIds.filter(value => !selectedSet.has(value)));
          const selectedUnits = allUnits.filter(unit => nextIds.has(String(unit._id)));
          return { ...policy, appliesToAllUnits:false, unitIds:selectedUnits.map(unit => unit._id), unitRefs:selectedUnits.map(technicalUnitReference) };
        }).filter(policy => policy.appliesToAllUnits !== false || (policy.unitIds || []).length);
        const result = await API.put(`/api/projects/${id}/insurance-policies`, { insurancePolicies:changedPolicies });
        state.project.technicalData ||= {};
        state.project.technicalData.insurancePolicies = result.insurancePolicies || changedPolicies;
      }
      modalBackdrop.style.display = 'none';
      technicalWorkspace.selected.clear();
      await window.loadUnits?.();
      await loadTechnicalWorkspace({ force:true });
      await markProjectDataChanged();
    } catch (error) {
      alert(error.message || 'No se pudo actualizar la selección.');
      button.disabled = false; button.textContent = 'Aplicar cambios';
    }
  });
}

function openTechnicalDeleteUnits() {
  const count = technicalWorkspace.selected.size;
  if (!count) return alert('Selecciona al menos una unidad.');
  openModal('Eliminar unidades seleccionadas', `<div class="technical-delete-confirm">
    <p>Se eliminarán <strong>${count}</strong> ${count === 1 ? 'unidad' : 'unidades'} de Técnico y Comercial. Esta acción requiere la contraseña de seguridad.</p>
    <label>Contraseña<input id="technicalDeletePin" type="password" inputmode="numeric" autocomplete="off" placeholder="Introduce la contraseña"></label>
    <span class="small muted">El borrado es lógico y queda protegido también en el servidor.</span>
  </div>`, 'Eliminar unidades', async () => {
    const pin = String(document.getElementById('technicalDeletePin')?.value || '').trim();
    if (!pin) return alert('La contraseña es obligatoria.');
    const ids = [...technicalWorkspace.selected];
    modalPrimary.disabled = true;
    modalPrimary.textContent = 'Eliminando…';
    try {
      const response = await fetch('/api/units/batch', {
        method:'DELETE',
        headers:{ 'Content-Type':'application/json', ...authHeadersFromApp() },
        credentials:'include',
        body:JSON.stringify({ ids, pin, projectId:id })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'No se pudieron eliminar las unidades.');
      technicalWorkspace.selected.clear();
      modalBackdrop.style.display = 'none';
      await window.loadUnits?.();
      await loadTechnicalWorkspace({ force:true });
      await markProjectDataChanged();
    } catch (error) {
      alert(error.message || 'No se pudieron eliminar las unidades.');
    } finally {
      modalPrimary.disabled = false;
      modalPrimary.textContent = 'Eliminar unidades';
    }
  });
}

document.querySelectorAll('[data-technical-jump]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.technicalJump)?.scrollIntoView({ behavior:'smooth', block:'start' })));
document.querySelectorAll('[data-technical-permit-filter]').forEach(button => button.addEventListener('click', () => {
  technicalWorkspace.permitFilter = button.dataset.technicalPermitFilter;
  document.querySelectorAll('[data-technical-permit-filter]').forEach(item => item.classList.toggle('is-active', item === button));
  renderTechnicalPermits();
}));
document.getElementById('technicalPermitsBoard')?.addEventListener('change', event => {
  const select = event.target.closest('.technical-permit-state');
  if (select) technicalUpdatePermitStatus(select.dataset.code, select.value, select);
});
document.getElementById('technicalPermitsBoard')?.addEventListener('click', event => {
  const phaseToggle = event.target.closest('.technical-permit-phase-toggle');
  if (phaseToggle) {
    const phase = phaseToggle.closest('[data-technical-permit-phase]')?.dataset.technicalPermitPhase;
    if (phase) {
      const expanded = !technicalPermitPhaseExpanded(phase);
      localStorage.setItem(technicalPermitPhaseStorageKey(phase), expanded ? '1' : '0');
      renderTechnicalPermits();
    }
    return;
  }
  const button = event.target.closest('.js-technical-permit-detail');
  if (button) openTechnicalPermitDetail(button.dataset.code);
});
document.getElementById('technicalApplyPermitTemplate')?.addEventListener('click', async event => {
  const templateId = document.getElementById('technicalPermitTemplate')?.value;
  if (!templateId) return alert('Selecciona una plantilla.');
  const hasExisting = (technicalWorkspace.permits?.items || []).length > 0;
  if (hasExisting && !confirm('La plantilla se fusionará con la ruta actual. Se conservarán estados, fechas y documentos existentes. ¿Continuar?')) return;
  const button = event.currentTarget; button.disabled = true; button.textContent = 'Aplicando…';
  try {
    const result = await apiPermitsInit(templateId);
    technicalWorkspace.permits = result;
    __permits = result;
    renderTechnicalPermits(); renderTechnicalKpis();
    const info = result?._mergeInfo;
    if (info) alert(`Plantilla aplicada: ${info.added || 0} permisos nuevos y ${info.updated || 0} actualizados.`);
  } catch (error) { alert(error.message || 'No se pudo aplicar la plantilla.'); }
  finally { button.disabled = false; button.textContent = 'Aplicar plantilla'; }
});
document.getElementById('technicalTogglePermitPhases')?.addEventListener('click', event => {
  const items = technicalWorkspace.permits?.items || [];
  const filtered = items.filter(item => {
    if (technicalWorkspace.permitFilter === 'all') return true;
    const status = technicalPermitEffectiveStatus(item);
    if (technicalWorkspace.permitFilter === 'attention') return ['pending','rejected'].includes(status) || (technicalDaysUntil(item.dueDate) ?? 999) < 0;
    return status === technicalWorkspace.permitFilter;
  });
  const phases = groupByPhase(filtered).order;
  const expand = event.currentTarget.dataset.expanded !== 'true';
  phases.forEach(phase => localStorage.setItem(technicalPermitPhaseStorageKey(phase), expand ? '1' : '0'));
  renderTechnicalPermits();
});
['technicalConstructionFilter','technicalPermitFilter'].forEach(elementId => document.getElementById(elementId)?.addEventListener('change', renderTechnicalUnits));
document.getElementById('technicalUnitSearch')?.addEventListener('input', () => { clearTimeout(window.__technicalSearchTimer); window.__technicalSearchTimer = setTimeout(renderTechnicalUnits, 180); });
document.getElementById('technicalSelectAll')?.addEventListener('click', () => {
  const cards = [...document.querySelectorAll('#technicalUnitsGrid [data-technical-unit]')];
  const allSelected = cards.length && cards.every(card => technicalWorkspace.selected.has(card.dataset.technicalUnit));
  cards.forEach(card => { if (allSelected) technicalWorkspace.selected.delete(card.dataset.technicalUnit); else technicalWorkspace.selected.add(card.dataset.technicalUnit); });
  renderTechnicalUnits();
});
document.getElementById('technicalBatchEdit')?.addEventListener('click', openTechnicalBatchEditor);
document.getElementById('technicalCreateUnits')?.addEventListener('click', () => window.openSharedCreateUnits?.('technical'));
document.getElementById('technicalCreateModel')?.addEventListener('click', () => window.openSharedModelsManager?.('technical'));
document.getElementById('technicalDeleteUnits')?.addEventListener('click', openTechnicalDeleteUnits);
document.getElementById('technicalRefreshDocuments')?.addEventListener('click', () => loadTechnicalWorkspace({ force:true, preserveSelection:true }));
document.getElementById('technicalUploadPlans')?.addEventListener('click', () => document.getElementById('technicalPlansInput')?.click());
document.getElementById('technicalPlansInput')?.addEventListener('change', async event => {
  const files = [...(event.target.files || [])];
  if (!files.length) return;
  const button = document.getElementById('technicalUploadPlans');
  button.disabled = true; button.textContent = `Subiendo ${files.length}…`;
  try {
    for (const file of files) {
      const formData = new FormData();
      formData.append('files', file);
      formData.append('projectId', id);
      formData.append('category', 'architecturalPlans');
      formData.append('folder', 'tecnico');
      await API.upload('/api/documents/upload?category=architecturalPlans', formData);
    }
    event.target.value = '';
    await loadTechnicalWorkspace({ force:true, preserveSelection:true });
    invalidateProjectDocsCache?.();
    await markProjectDataChanged();
  } catch (error) { alert(error.message || 'No se pudieron subir los planos.'); }
  finally { button.disabled = false; button.textContent = 'Añadir planos'; }
});


  // ======================
// ====== DOCS (Bank73)
// ======================

let _allDocs = []; // cache
window.__docsModuleReady = true;

function invalidateProjectDocsCache() {
  _allDocs = [];
  _docsFolderMeta = null;
  _commercialDossierDocs = [];
}

function normStatus(s){ return String(s||'ACTIVE').toUpperCase(); }
function isActiveDoc(d){ return normStatus(d.status) === 'ACTIVE'; }

const PROJECT_DOC_FOLDERS = [
  { id: 'tecnico', label: 'Técnico', color: '#38bdf8', icon: 'T' },
  { id: 'comercial', label: 'Comercial', color: '#22c55e', icon: 'C' },
  { id: 'financiero', label: 'Financiero', color: '#f59e0b', icon: '$' },
  { id: 'legal', label: 'Legal', color: '#a78bfa', icon: 'L' },
  { id: 'gerencia', label: 'Gerencia', color: '#60a5fa', icon: 'G' }
];

let _docsFolderMeta = null;
let _activeDocsFolder = '';
let _activeDocsSubfolder = '';
let _docsManagersOpen = false;
let _movingDocId = '';
let _commercialDossierDocs = [];

function projectDocFolderLabel(folder) {
  const id = String(folder || '').toLowerCase();
  return PROJECT_DOC_FOLDERS.find(f => f.id === id)?.label || 'Gerencia';
}

function projectDocFolderConfig(folder) {
  const id = String(folder || '').toLowerCase();
  return PROJECT_DOC_FOLDERS.find(f => f.id === id) || PROJECT_DOC_FOLDERS[PROJECT_DOC_FOLDERS.length - 1];
}

function effectiveDocFolder(d) {
  const folder = String(d.folder || '').toLowerCase();
  return PROJECT_DOC_FOLDERS.some(f => f.id === folder) ? folder : 'gerencia';
}

function projectDocSubfolder(d) {
  return String(d.subfolder || '').trim();
}

function isCommercialDossierDoc(d) {
  return String(d?.category || '').trim() === 'commercialDossier';
}

function commercialDossierName(d) {
  return d?.originalname || d?.title || d?.name || 'Dossier comercial';
}

function commercialDossierSize(d) {
  const size = Number(d?.size || 0);
  if (!size) return '';
  const MB = 1024 * 1024;
  return size >= MB ? `${(size / MB).toFixed(2)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

async function loadCommercialDossierDocs(force = false) {
  if (_commercialDossierDocs.length && !force) return _commercialDossierDocs;

  const qs = new URLSearchParams({
    projectId: id,
    category: 'commercialDossier',
    folder: 'comercial',
    ts: String(Date.now())
  });

  _commercialDossierDocs = await API.get(`/api/documents?${qs.toString()}`)
    .catch(err => {
      console.warn('[Commercial dossier] No se pudo cargar', err);
      return [];
    });

  _commercialDossierDocs = Array.isArray(_commercialDossierDocs) ? _commercialDossierDocs : [];
  return _commercialDossierDocs;
}

function renderCommercialDossierButton(docs) {
  const btn = document.getElementById('commercialDossierBtn');
  const meta = document.getElementById('commercialDossierMeta');
  if (!btn || !meta) return;

  const count = Array.isArray(docs) ? docs.length : 0;
  btn.classList.toggle('has-file', count > 0);
  meta.textContent = count ? `${count} archivo${count === 1 ? '' : 's'}` : 'Sin archivo';
  btn.title = count
    ? `Dossier comercial: ${commercialDossierName(docs[0])}`
    : 'Subir dossier comercial del proyecto';
}

async function refreshCommercialDossier(force = false) {
  const docs = await loadCommercialDossierDocs(force);
  renderCommercialDossierButton(docs);
  return docs;
}

function renderCommercialDossierModal(docs) {
  const list = Array.isArray(docs) && docs.length ? docs.map(d => {
    const created = d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '';
    const size = commercialDossierSize(d);
    return `
      <div class="commercial-dossier-row">
        <div>
          <b>${escapeHtml(commercialDossierName(d))}</b>
          <div class="small muted">${escapeHtml([size, created ? `Subido: ${created}` : ''].filter(Boolean).join(' · '))}</div>
        </div>
        <div class="commercial-dossier-actions">
          <a class="btn btn-ghost btn-xs js-secure-file" href="#" data-url="${secureDocUrl(d._id)}" data-filename="${escapeHtml(commercialDossierName(d))}" data-action="view">Ver</a>
          <a class="btn btn-xs js-secure-file" href="#" data-url="${secureDocUrl(d._id)}" data-filename="${escapeHtml(commercialDossierName(d))}" data-action="download">Descargar</a>
          ${renderDeleteBtn(d)}
        </div>
      </div>
    `;
  }).join('') : '<div class="small muted">Todavia no hay dossier comercial guardado.</div>';

  return `
    <div class="commercial-dossier-upload">
      <input id="commercialDossierFile" type="file" accept=".pdf,.ppt,.pptx,.key,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" />
      <button id="commercialDossierUploadBtn" class="btn" type="button">Subir dossier</button>
    </div>
    <div class="small muted">Se guardara en Docs > Comercial y quedara disponible para descarga ejecutiva.</div>
    <div class="commercial-dossier-modal-list" style="margin-top:12px;">
      ${list}
    </div>
  `;
}

async function openCommercialDossierModal() {
  const docs = await refreshCommercialDossier(true);
  openModal('Dossier comercial', renderCommercialDossierModal(docs), 'Cerrar', () => {
    modalBackdrop.style.display = 'none';
  });

  const fileEl = document.getElementById('commercialDossierFile');
  const uploadBtn = document.getElementById('commercialDossierUploadBtn');
  if (!fileEl || !uploadBtn) return;

  uploadBtn.addEventListener('click', async () => {
    const f = fileEl.files && fileEl.files[0];
    if (!f) return alert('Selecciona un archivo primero');

    const fd = new FormData();
    fd.append('projectId', id);
    fd.append('file', f);
    fd.append('folder', 'comercial');
    fd.append('category', 'commercialDossier');

    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Subiendo...';

    try {
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: { ...tenantHeaders(), ...authHeaders() },
        body: fd,
        credentials: 'include'
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message || j?.error || `HTTP ${res.status}`);
      }

      fileEl.value = '';
      _allDocs = [];
      _commercialDossierDocs = [];
      if (document.getElementById('tab-docs')?.classList.contains('active')) {
        await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
      }
      await openCommercialDossierModal();
    } catch (err) {
      console.error('[Commercial dossier upload]', err);
      alert('No se pudo subir el dossier: ' + (err.message || 'Error desconocido'));
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Subir dossier';
    }
  });
}

document.getElementById('commercialDossierBtn')?.addEventListener('click', () => {
  openCommercialDossierModal().catch(err => {
    console.error('[Commercial dossier modal]', err);
    alert('No se pudo abrir el dossier comercial.');
  });
});

async function loadDocsFolderMeta(force = false) {
  if (_docsFolderMeta && !force) return _docsFolderMeta;
  _docsFolderMeta = await API.get(`/api/documents/folder-permissions?projectId=${encodeURIComponent(id)}&ts=${Date.now()}`).catch(() => ({
    folders: [],
    projectUsers: [],
    canManage: false
  }));
  _docsFolderMeta.folders = Array.isArray(_docsFolderMeta.folders) ? _docsFolderMeta.folders : [];
  _docsFolderMeta.projectUsers = Array.isArray(_docsFolderMeta.projectUsers) ? _docsFolderMeta.projectUsers : [];
  if (!_activeDocsFolder || !_docsFolderMeta.folders.some(f => f.folder === _activeDocsFolder)) {
    _activeDocsFolder = _docsFolderMeta.folders[0]?.folder || '';
    _activeDocsSubfolder = '';
  }
  return _docsFolderMeta;
}

function canViewGeneralDocs() {
  return !!id;
}

function docExpiryMeta(d){
  const expTs = d.expiryDate ? new Date(d.expiryDate).getTime() : null;
  const now   = Date.now();
  const soon  = now + 30*24*60*60*1000;

  if (!expTs) return { expTs:null, label:'—', cls:'', state:'NO_EXPIRY' };

  const expText = new Date(d.expiryDate).toISOString().slice(0,10);
  if (expTs < now)  return { expTs, label:expText, cls:'danger', state:'EXPIRED' };
  if (expTs < soon) return { expTs, label:expText, cls:'warn',   state:'SOON' };
  return { expTs, label:expText, cls:'', state:'OK' };
}

function findChecklistTitle(idCL) {
  if (!idCL) return '—';
  const x = String(idCL);
  const hit = (state.checklists || []).find(c => String(c._id) === x);
  return hit?.title || '—';
}

function docDepartmentLabel(d) {
  const dep = String(d.department || '').toLowerCase();
  if (dep === 'commercial') return 'Comercial';
  if (dep === 'tecnico') return 'Técnico';
  if (dep === 'legal') return 'Legal';
  return '';
}

function docChips(d){
  const chips = [];

  const dep = docDepartmentLabel(d);
  if (dep) chips.push(`<span class="chip">Área: ${escapeHtml(dep)}</span>`);

  if (d.checklistId) chips.push(`<span class="chip">Checklist: ${escapeHtml(findChecklistTitle(d.checklistId))}</span>`);
  if (d.unitTag)     chips.push(`<span class="chip">Unidad: ${escapeHtml(d.unitTag)}</span>`);
  if (d.baTag)       chips.push(`<span class="chip ${d.baTag === 'BEFORE' ? 'chip-gray' : 'chip-green'}">${escapeHtml(d.baTag)}</span>`);
  if (d.permitCode)  chips.push(`<span class="chip">Permiso: ${escapeHtml(d.permitCode)}</span>`);

  return chips.join(' ');
}

function canDeleteDoc() {
  return canViewGeneralDocs();
}

function renderDeleteBtn(d){
  if (!canDeleteDoc()) return '';
  return `<button class="btn btn-danger" data-del="${d._id}">Eliminar</button>`;
}

function renderMoveBtn(d, canManageDocs) {
  if (!canManageDocs) return '';
  return `<button class="btn btn-ghost" data-move-doc="${d._id}">Mover</button>`;
}

function canCompleteDoc(){
  return canViewGeneralDocs();
}

function renderCompleteBtn(d){
  const st = normStatus(d.status);
  if (!canCompleteDoc()) return '';
  if (st !== 'ACTIVE') return '';
  if (!d.expiryDate) return '';
  return `<button class="btn" data-complete="${d._id}">Cumplir</button>`;
}

function canReplaceDoc(){
  return canViewGeneralDocs();
}

function renderReplaceBtn(d){
  const st = normStatus(d.status);
  if (!canReplaceDoc()) return '';
  if (st !== 'ACTIVE') return '';
  if (!d.expiryDate) return '';
  return `<button class="btn" data-replace="${d._id}">Reemplazar</button>`;
}

function renderStatusPill(d){
  const st = normStatus(d.status);
  if (st === 'COMPLETED') return `<span class="pill pill-gray">CUMPLIDO</span>`;
  if (st === 'REPLACED')  return `<span class="pill pill-gray">REEMPLAZADO</span>`;
  if (!d.expiryDate) return '';
  return `<span class="pill pill-blue">ACTIVO</span>`;
}

function matchesDocQuery(d, q){
  if (!q) return true;

  q = q.toLowerCase();

  const fields = [
    d.originalname,
    d.title,
    d.filename,
    d.mimetype,
    d.unitTag,
    d.permitCode,
    d.permitTitle,
    projectDocFolderLabel(effectiveDocFolder(d)),
    projectDocSubfolder(d),
    docDepartmentLabel(d),
    findChecklistTitle(d.checklistId)
  ];

  return fields.some(v => String(v || '').toLowerCase().includes(q));
}

async function loadDocs({ q } = {}) {
  const docsDiv    = document.getElementById('docs');
  const uploadForm = document.getElementById('uploadForm');
  const countEl    = document.getElementById('docsCount');
  const folderSel  = document.getElementById('docsFolder');
  const subSel     = document.getElementById('docsSubfolder');

  if (!docsDiv) return;

  if (!canViewGeneralDocs()) {
    docsDiv.innerHTML = '<div class="small muted">No tienes acceso a la vista general de documentos.</div>';
    if (uploadForm) uploadForm.style.display = 'none';
    if (countEl) countEl.textContent = '';
    return;
  }

  if (uploadForm) uploadForm.style.display = '';
  const meta = await loadDocsFolderMeta();
  const visibleFolders = meta.folders || [];

  if (!visibleFolders.length) {
    docsDiv.innerHTML = '<div class="small muted">No tienes carpetas documentales asignadas en este proyecto.</div>';
    if (uploadForm) uploadForm.style.display = 'none';
    if (countEl) countEl.textContent = '';
    return;
  }

  if (!_activeDocsFolder) _activeDocsFolder = visibleFolders[0].folder;
  const activeFolderMeta = visibleFolders.find(f => f.folder === _activeDocsFolder) || visibleFolders[0];
  _activeDocsFolder = activeFolderMeta.folder;
  const subfolders = Array.isArray(activeFolderMeta.subfolders) ? activeFolderMeta.subfolders : [];

  if (folderSel) {
    folderSel.innerHTML = visibleFolders
      .map(f => `<option value="${escapeHtml(f.folder)}" ${f.folder === _activeDocsFolder ? 'selected' : ''}>${escapeHtml(projectDocFolderLabel(f.folder))}</option>`)
      .join('');
  }

  if (subSel) {
    subSel.innerHTML = `<option value="">Principal</option>` + subfolders
      .map(sf => {
        const name = sf.name || '';
        return `<option value="${escapeHtml(name)}" ${name === _activeDocsSubfolder ? 'selected' : ''}>${escapeHtml(name)}</option>`;
      })
      .join('');
  }

  // Carga una sola vez y cachea
  if (!_allDocs.length) {
    _allDocs = await API.get('/api/documents?projectId=' + id).catch(()=>[]);
  }

  const folderCounts = {};
  for (const f of visibleFolders) folderCounts[f.folder] = 0;
  (_allDocs || []).forEach(d => {
    const f = effectiveDocFolder(d);
    if (f in folderCounts) folderCounts[f] += 1;
  });

  const searchText = String(q || '').trim();
  const isGlobalDocsSearch = !!searchText && !!meta.canSearchAll;

  let filtered = isGlobalDocsSearch
    ? _allDocs.slice()
    : _allDocs
        .filter(d => effectiveDocFolder(d) === _activeDocsFolder)
        .filter(d => projectDocSubfolder(d) === _activeDocsSubfolder);

  if (searchText) filtered = filtered.filter(d => matchesDocQuery(d, searchText));

  const MB = 1024*1024;
  const activeCfg = projectDocFolderConfig(_activeDocsFolder);
  const folderMetaById = new Map(visibleFolders.map(f => [f.folder, f]));
  const subfolderCounts = { '': 0 };
  subfolders.forEach(sf => { subfolderCounts[sf.name || ''] = 0; });
  (_allDocs || [])
    .filter(d => effectiveDocFolder(d) === _activeDocsFolder)
    .forEach(d => {
      const key = projectDocSubfolder(d);
      subfolderCounts[key] = (subfolderCounts[key] || 0) + 1;
    });
  const assignedSet = new Set((activeFolderMeta.assignedUsers || []).map(String));
  const managerPanel = meta.canManage && _docsManagersOpen ? `
    <div class="docs-folder-users" id="docsManagersPanel">
      <b>Responsables</b>
      ${(meta.projectUsers || []).map(u => `
        <label>
          <input type="checkbox" class="docs-folder-user" value="${escapeHtml(String(u._id))}" ${assignedSet.has(String(u._id)) ? 'checked' : ''}>
          <span>${escapeHtml(u.name || u.email || 'Usuario')} <span class="small muted">${escapeHtml(u.role || '')}</span></span>
        </label>
      `).join('') || '<span class="small muted">No hay usuarios asignados al proyecto.</span>'}
      <button type="button" class="btn btn-ghost btn-xs" id="docsSaveFolderUsers">Guardar</button>
    </div>
  ` : '';

  const listHtml = filtered.length ? filtered.map(d => {
    const docFolder = effectiveDocFolder(d);
    const docFolderMeta = folderMetaById.get(docFolder) || activeFolderMeta;
    const docSubfolders = Array.isArray(docFolderMeta.subfolders) ? docFolderMeta.subfolders : [];
    const movePanel = meta.canMove && _movingDocId === String(d._id) ? `
      <div class="docs-move-panel">
        <select class="docs-move-folder" data-doc="${escapeHtml(String(d._id))}">
          ${visibleFolders.map(f => `<option value="${escapeHtml(f.folder)}" ${f.folder === docFolder ? 'selected' : ''}>${escapeHtml(projectDocFolderLabel(f.folder))}</option>`).join('')}
        </select>
        <select class="docs-move-subfolder" data-doc="${escapeHtml(String(d._id))}">
          <option value="">Principal</option>
          ${docSubfolders.map(sf => {
            const name = sf.name || '';
            return `<option value="${escapeHtml(name)}" ${name === projectDocSubfolder(d) ? 'selected' : ''}>${escapeHtml(name)}</option>`;
          }).join('')}
        </select>
        <button type="button" class="btn btn-xs primary docs-apply-move" data-doc="${escapeHtml(String(d._id))}">Mover aquí</button>
      </div>
    ` : '';
    const sizeStr = (d.size >= MB)
      ? (d.size/MB).toFixed(2)+' MB'
      : Math.round((d.size||0)/1024)+' KB';

    const exp = docExpiryMeta(d);

    const expLine = d.expiryDate
      ? `<div class="small ${exp.cls}">Expira: ${exp.label}</div>`
      : `<div class="small muted">Expira: —</div>`;

    const st = normStatus(d.status);

    const extra = (st === 'COMPLETED' && d.completedAt)
      ? `<div class="small muted">Cumplido: ${new Date(d.completedAt).toISOString().slice(0,10)} ${d.completionNote ? '— ' + escapeHtml(d.completionNote) : ''}</div>`
      : '';

    return `
      <div class="doc">
        <div class="doc-info">
          <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
            <b>${escapeHtml(d.originalname || d.title || d.name || 'Documento')}</b>
            ${renderStatusPill(d)}
          </div>

          <div class="small muted">${escapeHtml(d.mimetype || '')} — ${sizeStr}</div>
          ${expLine}
          ${extra}

          <div class="chips">
            <span class="chip">Carpeta: ${escapeHtml(projectDocFolderLabel(effectiveDocFolder(d)))}</span>
            ${projectDocSubfolder(d) ? `<span class="chip">Subcarpeta: ${escapeHtml(projectDocSubfolder(d))}</span>` : ''}
            ${docChips(d)}
          </div>
        </div>

        <div class="doc-actions">
          <a class="btn js-secure-file" href="#" data-url="${secureDocUrl(d._id)}" data-filename="${escapeHtml(d.originalname || d.title || d.name || 'documento')}" data-action="view">Ver</a>
          <a class="btn js-secure-file" href="#" data-url="${secureDocUrl(d._id)}" data-filename="${escapeHtml(d.originalname || d.title || d.name || 'documento')}" data-action="download">Descargar</a>
          ${renderCompleteBtn(d)}
          ${renderReplaceBtn(d)}
          ${renderMoveBtn(d, meta.canMove)}
          ${renderDeleteBtn(d)}
        </div>
        ${movePanel}
      </div>
    `;
  }).join('') : '<div class="small muted">No hay documentos en esta carpeta.</div>';

  docsDiv.innerHTML = `
    <div class="docs-repo-layout">
      <div class="docs-folder-nav">
        ${visibleFolders.map(f => `
          <button type="button" class="docs-folder-btn ${f.folder === _activeDocsFolder ? 'active' : ''}" data-doc-folder="${escapeHtml(f.folder)}" style="--folder-color:${projectDocFolderConfig(f.folder).color};">
            <span class="docs-folder-icon">${escapeHtml(projectDocFolderConfig(f.folder).icon)}</span>
            <span class="docs-folder-name">${escapeHtml(projectDocFolderLabel(f.folder))}</span>
            <span class="docs-folder-count">${folderCounts[f.folder] || 0} documentos</span>
          </button>
        `).join('')}
      </div>

      <div class="docs-folder-panel" style="--folder-color:${activeCfg.color};">
        <div class="docs-folder-head">
          <div>
            <h3 style="margin:0;">${escapeHtml(projectDocFolderLabel(_activeDocsFolder))}</h3>
            <div class="small muted">${escapeHtml(isGlobalDocsSearch ? 'Resultados en todas las carpetas' : (_activeDocsSubfolder ? `Subcarpeta: ${_activeDocsSubfolder}` : 'Carpeta principal'))}</div>
          </div>
          <div class="docs-folder-tools">
            ${meta.canManage ? `<button type="button" class="docs-icon-btn" id="docsToggleManagers" title="Responsables" aria-label="Responsables">👤</button>` : ''}
            <button type="button" class="btn btn-ghost btn-xs" id="docsNewSubfolderBtn">Nueva subcarpeta</button>
          </div>
        </div>

        <div class="docs-subfolder-grid">
          <button type="button" class="docs-subfolder-card ${!_activeDocsSubfolder ? 'active' : ''}" data-doc-subfolder="" style="--folder-color:${activeCfg.color};">
            <strong>Principal</strong>
            <span class="small muted">${subfolderCounts[''] || 0} documentos</span>
          </button>
          ${subfolders.map(sf => {
            const name = sf.name || '';
            return `
              <div class="docs-subfolder-card ${name === _activeDocsSubfolder ? 'active' : ''}" data-doc-subfolder="${escapeHtml(name)}" style="--folder-color:${activeCfg.color};" role="button" tabindex="0">
                <div>
                  <strong>${escapeHtml(name)}</strong>
                  <span class="small muted">${subfolderCounts[name] || 0} documentos</span>
                </div>
                ${meta.canMove ? `<button type="button" class="docs-subfolder-delete" data-delete-subfolder="${escapeHtml(name)}" title="Eliminar subcarpeta" aria-label="Eliminar subcarpeta ${escapeHtml(name)}">Eliminar</button>` : ''}
              </div>
            `;
          }).join('')}
        </div>

        ${managerPanel}
        ${listHtml}
      </div>
    </div>
  `;

  if (countEl) countEl.textContent = `${filtered.length} / ${_allDocs.length}`;

  docsDiv.querySelectorAll('[data-doc-folder]').forEach(btn => {
    btn.addEventListener('click', async () => {
      _activeDocsFolder = btn.dataset.docFolder || '';
      _activeDocsSubfolder = '';
      await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
    });
  });

  docsDiv.querySelectorAll('[data-doc-subfolder]').forEach(btn => {
    btn.addEventListener('click', async () => {
      _activeDocsSubfolder = btn.dataset.docSubfolder || '';
      await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
    });
    btn.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      _activeDocsSubfolder = btn.dataset.docSubfolder || '';
      await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
    });
  });

  docsDiv.querySelectorAll('[data-delete-subfolder]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const name = btn.dataset.deleteSubfolder || '';
      if (!name) return;
      const count = subfolderCounts[name] || 0;
      const msg = count
        ? `Eliminar la subcarpeta "${name}"? Sus ${count} documento(s) pasarán a Principal.`
        : `Eliminar la subcarpeta "${name}"?`;
      if (!confirm(msg)) return;

      try {
        const res = await fetch(`/api/documents/folder-permissions/${encodeURIComponent(_activeDocsFolder)}/subfolders`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', ...tenantHeaders(), ...authHeaders() },
          credentials: 'include',
          body: JSON.stringify({ projectId: id, name })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.message || payload?.error || `HTTP ${res.status}`);

        if (_activeDocsSubfolder === name) _activeDocsSubfolder = '';
        _docsFolderMeta = null;
        _allDocs = [];
        await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
      } catch (err) {
        alert('No se pudo eliminar la subcarpeta: ' + (err.message || 'Error desconocido'));
      }
    });
  });

  document.getElementById('docsNewSubfolderBtn')?.addEventListener('click', async () => {
    const name = prompt('Nombre de la subcarpeta:');
    if (!name || !name.trim()) return;
    try {
      await API.post(`/api/documents/folder-permissions/${encodeURIComponent(_activeDocsFolder)}/subfolders`, {
        projectId: id,
        name: name.trim()
      });
      _activeDocsSubfolder = name.trim();
      _docsFolderMeta = null;
      await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
    } catch (e) {
      alert('No se pudo crear la subcarpeta.');
    }
  });

  document.getElementById('docsSaveFolderUsers')?.addEventListener('click', async () => {
    const assignedUsers = Array.from(docsDiv.querySelectorAll('.docs-folder-user:checked')).map(input => input.value);
    try {
      await API.patch(`/api/documents/folder-permissions/${encodeURIComponent(_activeDocsFolder)}`, {
        projectId: id,
        assignedUsers
      });
      _docsFolderMeta = null;
      _allDocs = [];
      _commercialDossierDocs = [];
      await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
      await refreshCommercialDossier(true);
    } catch (e) {
      alert('No se pudieron guardar los responsables.');
    }
  });

  document.getElementById('docsToggleManagers')?.addEventListener('click', async () => {
    _docsManagersOpen = !_docsManagersOpen;
    await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
  });

  docsDiv.querySelectorAll('[data-move-doc]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const docId = btn.dataset.moveDoc || '';
      _movingDocId = _movingDocId === docId ? '' : docId;
      await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
    });
  });

  docsDiv.querySelectorAll('.docs-move-folder').forEach(sel => {
    sel.addEventListener('change', () => {
      const docId = sel.dataset.doc || '';
      const subSel = docsDiv.querySelector(`.docs-move-subfolder[data-doc="${CSS.escape(docId)}"]`);
      const folderMeta = folderMetaById.get(sel.value);
      const nextSubfolders = Array.isArray(folderMeta?.subfolders) ? folderMeta.subfolders : [];
      if (subSel) {
        subSel.innerHTML = '<option value="">Principal</option>' + nextSubfolders
          .map(sf => `<option value="${escapeHtml(sf.name || '')}">${escapeHtml(sf.name || '')}</option>`)
          .join('');
      }
    });
  });

  docsDiv.querySelectorAll('.docs-apply-move').forEach(btn => {
    btn.addEventListener('click', async () => {
      const docId = btn.dataset.doc || '';
      const folder = docsDiv.querySelector(`.docs-move-folder[data-doc="${CSS.escape(docId)}"]`)?.value || _activeDocsFolder;
      const subfolder = docsDiv.querySelector(`.docs-move-subfolder[data-doc="${CSS.escape(docId)}"]`)?.value || '';

      try {
        const res = await fetch(`/api/documents/${encodeURIComponent(docId)}/location`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...tenantHeaders(), ...authHeaders() },
          credentials: 'include',
          body: JSON.stringify({ projectId: id, folder, subfolder })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.message || payload?.error || `HTTP ${res.status}`);

        _movingDocId = '';
        _activeDocsFolder = folder;
        _activeDocsSubfolder = subfolder;
        _allDocs = [];
        await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
      } catch (e) {
        alert('No se pudo mover el documento: ' + (e.message || 'Error desconocido'));
      }
    });
  });
}

// wire buscador (debounce)
(function(){
  const inp = document.getElementById('docsSearch');
  if (!inp) return;

  let t;

  inp.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => loadDocs({ q: inp.value }), 150);
  });
})();

// ===== Upload normal general =====
function wireDocsUpload() {
  const form = document.getElementById('uploadForm');
  const btn  = document.getElementById('docsUploadBtn');
  const fileEl = document.getElementById('file');
  const expEl  = document.getElementById('expiry');
  const folderEl = document.getElementById('docsFolder');
  const subfolderEl = document.getElementById('docsSubfolder');
  const fileNameEl = document.getElementById('docsFileName');

  if (!form || !btn || !fileEl) return;

  fileEl.addEventListener('change', () => {
    const f = fileEl.files && fileEl.files[0];
    if (fileNameEl) fileNameEl.textContent = f ? f.name : 'Ningún archivo seleccionado';
  });

  folderEl?.addEventListener('change', async () => {
    _activeDocsFolder = folderEl.value || _activeDocsFolder;
    _activeDocsSubfolder = '';
    await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
  });

  subfolderEl?.addEventListener('change', async () => {
    _activeDocsSubfolder = subfolderEl.value || '';
    await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!canViewGeneralDocs()) {
      alert('No tienes permisos para subir documentos generales.');
      return;
    }

    const f = fileEl.files && fileEl.files[0];
    if (!f) return alert('Selecciona un archivo primero');

    const fd = new FormData();
    fd.append('projectId', id);
    fd.append('file', f);
    fd.append('folder', folderEl?.value || _activeDocsFolder || 'gerencia');
    fd.append('subfolder', subfolderEl?.value || _activeDocsSubfolder || '');

    if (expEl && expEl.value) fd.append('expiryDate', expEl.value);

    btn.disabled = true;
    btn.textContent = 'Subiendo...';

    try {
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: { ...tenantHeaders(), ...authHeaders() },
        body: fd
      });

      if (!res.ok) {
        const j = await res.json().catch(()=> ({}));
        throw new Error(j?.message || j?.error || `HTTP ${res.status}`);
      }

      fileEl.value = '';
      if (fileNameEl) fileNameEl.textContent = 'Ningún archivo seleccionado';
      if (expEl) expEl.value = '';

      _allDocs = [];
      _commercialDossierDocs = [];
      await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
      await refreshCommercialDossier(true);

      alert('Documento subido');
    } catch (err) {
      console.error('[Docs Upload] error', err);
      alert('No se pudo subir: ' + (err.message || ''));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Subir';
    }
  });
}

// ===== Delegación: Eliminar / Cumplir / Reemplazar =====
document.addEventListener('click', async (ev) => {
  if (!canViewGeneralDocs()) return;

  // ---- eliminar ----
  const delBtn = ev.target.closest('button[data-del]');

  if (delBtn) {
    const docId = delBtn.getAttribute('data-del');
    if (!docId) return;
    const fromCommercialDossierModal = !!delBtn.closest('.commercial-dossier-row');

    const pin = prompt('Introduce el PIN para eliminar (configurable en .env como DELETE_DOCS_PIN):', '');
    if (pin === null) return;

    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(docId)}?pin=${encodeURIComponent(pin)}`, {
        method: 'DELETE',
        headers: { ...tenantHeaders(), ...authHeaders() }
      });

      if (!res.ok) {
        const j = await res.json().catch(()=> ({}));
        if (j?.error === 'pin_invalid') throw new Error('PIN inválido');
        throw new Error(j?.error || `HTTP ${res.status}`);
      }

      _allDocs = [];
      _commercialDossierDocs = [];
      await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
      await refreshCommercialDossier(true);
      if (fromCommercialDossierModal) await openCommercialDossierModal();

    } catch (e) {
      alert('No se pudo eliminar: ' + (e.message || ''));
    }

    return;
  }

  // ---- cumplir ----
  const compBtn = ev.target.closest('button[data-complete]');

  if (compBtn) {
    const docId = compBtn.getAttribute('data-complete');
    if (!docId) return;

    const note = prompt('Nota (opcional): ¿qué se cumplió / cómo se resolvió?', '');
    if (note === null) return;

    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(docId)}/complete`, {
        method: 'PATCH',
        headers: { 'Content-Type':'application/json', ...tenantHeaders(), ...authHeaders() },
        body: JSON.stringify({ note })
      });

      if (!res.ok) {
        const j = await res.json().catch(()=> ({}));
        throw new Error(j?.error || j?.message || `HTTP ${res.status}`);
      }

      _allDocs = [];
      await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });

    } catch (e) {
      alert('No se pudo marcar como cumplido: ' + (e.message || ''));
    }

    return;
  }

  // ---- reemplazar ----
  const repBtn = ev.target.closest('button[data-replace]');

  if (repBtn) {
    const docId = repBtn.getAttribute('data-replace');
    if (!docId) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '*/*';

    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;

      const expiry = prompt('Fecha de vencimiento del NUEVO documento (YYYY-MM-DD) o vacío:', '') || '';

      const fd = new FormData();
      fd.append('projectId', id);
      fd.append('file', f);

      if (expiry.trim()) fd.append('expiryDate', expiry.trim());

      fd.append('replaces', docId);

      try {
        const res = await fetch('/api/documents/upload', {
          method: 'POST',
          headers: { ...tenantHeaders(), ...authHeaders() },
          body: fd
        });

        if (!res.ok) {
          const j = await res.json().catch(()=> ({}));
          throw new Error(j?.message || j?.error || `HTTP ${res.status}`);
        }

        _allDocs = [];
        await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });

        alert('Reemplazo subido. El documento anterior queda archivado.');

      } catch (e) {
        alert('No se pudo reemplazar: ' + (e.message || ''));
      }
    };

    input.click();
    return;
  }
});

// Llamadas iniciales
wireDocsUpload();
// tu loadProject o init debe llamar a loadDocs

// ====== Chat (pestaña Chat) ======
let chatBeforeCursor = null; // para paginación "cargar más"
const chatListEl   = document.getElementById('chatList');
const chatForm     = document.getElementById('chatForm');
const chatInput    = document.getElementById('chatInput');
const chatLoadMore = document.getElementById('chatLoadMore');

async function loadChatMessages({ append=false } = {}) {
  if (!chatListEl) return;
  if (!append) chatBeforeCursor = null;            // reset

  let url = `/api/chat/projects/${id}?limit=30`;
  if (chatBeforeCursor) url += `&before=${encodeURIComponent(chatBeforeCursor)}`;
  url += `&ts=${Date.now()}`;

  const res = await API.get(url).catch(()=>({ messages:[] }));
  const msgs = res.messages || [];

  if (!append) chatListEl.innerHTML = '';

  if (msgs.length) {
    // ahora el backend devuelve [nuevo -> viejo]
    chatBeforeCursor = msgs[msgs.length - 1].createdAt;  // el MÁS VIEJO recibid
    const html = msgs.map(renderChatMessage).join('');

    if (append) {
      // “anteriores” = más viejos → se agregan AL FINAL
      chatListEl.insertAdjacentHTML('beforeend', html);
    } else {
      // carga inicial: nuevos arriba
      chatListEl.innerHTML = html;
    }
    chatLoadMore.style.display = 'block';
  } else if (!append) {
    chatListEl.innerHTML = '<div class="small muted">No hay mensajes aún</div>';
    chatLoadMore.style.display = 'none';
  }
}

function renderChatMessage(m) {
  const initials = (m.userEmail || m.userName || '?').slice(0,1).toUpperCase();
  const date = m.createdAt ? new Date(m.createdAt).toLocaleString() : '';
  return `
    <div class="chat-item" data-id="${m._id}">
      <div class="chat-avatar">${initials}</div>
      <div class="chat-body">
        <div class="chat-meta">
          <b>${escapeHtml(m.userEmail || m.userName || '—')}</b>
          <span>${escapeHtml(date)}</span>
        </div>
        <div class="chat-text">${escapeHtml(m.text)}</div>
        <div class="chat-actions">
          <button class="chat-del" data-id="${m._id}">Borrar</button>
        </div>
      </div>
    </div>`;
}

function escapeHtml(str){
  return String(str||'').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function sendChatMessage(txt){
  const res = await API.post(`/api/chat/projects/${id}`, { text: txt });
  return res.message;
}

async function deleteChatMessage(mid){
  const res = await fetch(`/api/chat/${mid}`, {
    method: 'DELETE',
    headers: {
      ...tenantHeaders(),   // ya las tienes definidas arriba
      ...authHeadersNoContentType(),
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

if (chatForm) {
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const txt = chatInput.value.trim();
    if (!txt) return;
    try {
      const msg = await sendChatMessage(txt);
      chatInput.value = '';

      // 👇 Añadir el nuevo mensaje ARRIBA sin recargar todo
      chatListEl.insertAdjacentHTML('afterbegin', renderChatMessage(msg));
      chatListEl.scrollTop = 0; // opcional: subir del todo
    } catch (err) {
      alert('Error enviando mensaje: ' + (err?.message || ''));
    }
  });
}


if (chatListEl) {
  chatListEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.chat-del');
    if (!btn) return;
    const id = btn.dataset.id;
    if (!id) return;
    if (!confirm('¿Borrar este mensaje?')) return;
    try {
      await deleteChatMessage(id);
      const item = chatListEl.querySelector(`.chat-item[data-id="${id}"]`);
      if (item) item.remove();
    } catch (err) { alert('Error al borrar: ' + err.message); }
  });
}

if (chatLoadMore) {
  chatLoadMore.addEventListener('click', () => loadChatMessages({ append:true }));
}


// ====== Init ======
try {
applyRoleVisibility();
await syncProvidersModuleVisibility();
if (!['tecnico','legal'].includes(myRole)) await loadCommercialTemplateStatus();

if (myRole === 'tecnico') {
  await loadProject();
  await loadUnits();
  await loadTechnicalWorkspace({ force:true });
  await loadProyectoData();
  renderProyecto();
  await loadDocs();
  await refreshCommercialDossier(true);
  await loadChatMessages();
} else if (myRole === 'legal') {
  // Legal conserva su vista de checklists y documentos.
  await loadProyectoData();   // /api/projects/:id/checklists  ✅ permitido
  renderProyecto();
  await loadDocs();           // /api/documents?projectId=...  ✅ permitido
  await refreshCommercialDossier(true);
  await loadChatMessages();
  
} else if (myRole === 'commercial') {
  // Comercial: unidades + (ahora) checklists propios + docs
  await loadUnits();          // ✅
  await loadProyectoData();   // ✅ /api/projects/:id/checklists (ya permitido por el cambio de arriba)
  renderProyecto();           // pinta la pestaña Proyecto con solo COMERCIAL
  await loadDocs();           // ✅
  await refreshCommercialDossier(true);
  await loadChatMessages();
} else {
  // Roles full (admin, bank, promoter, gerencia, socios, financiero, contable)
  await loadProject();        // ✅
  await loadSummary();        // ✅
  await Promise.all([
    loadFinance({ force: false }), // ✅ reutiliza snapshot de resumen si ya existe
    loadUnits()               // ✅
  ]);
  await loadProyectoData();   // ✅
  renderProyecto();
  await loadDocs();           // ✅
  await refreshCommercialDossier(true);
  await loadChatMessages();
}
} finally {
  finishInitialProjectLoad();
}

  // logout
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', () => { API.logout(); location.href = '/login'; });
})();
