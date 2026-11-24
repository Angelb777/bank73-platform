(function () {
  'use strict';

  const LIFECYCLE = [
    { key: 'PREESTUDIOS', name: 'Pre-estudios', color: '#8b5cf6' },
    { key: 'PERMISOS', name: 'Permisos', color: '#0ea5e9' },
    { key: 'FINANCIACION', name: 'Financiación', color: '#f59e0b' },
    { key: 'CONTRATISTAS', name: 'Contratistas', color: '#14b8a6' },
    { key: 'OBRA', name: 'Obra', color: '#22c55e' },
    { key: 'ESCRITURACION', name: 'Escrituración', color: '#ef4444' }
  ];
  const ICONS = {
    cover: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m5.5 17 4.2-4.2 3.1 3.1 2.2-2.2 3.5 3.3"/></svg>',
    dossier: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/></svg>',
    docs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h6l2 2h8v11H4z"/></svg>',
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    status: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 8v4l3 2"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>'
  };

  const panelHomes = new Map();
  let workspaceApi = null;
  let unifiedRoot = null;
  let overlay = null;
  let stageModal = null;
  let activeStageMount = null;
  let stageTabRequest = 0;
  let stageTabTransition = Promise.resolve();
  let pendingStageTab = '';
  let activeStageTab = '';
  let openingStageId = '';
  let activeUnitsMode = 'commercial';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function fallbackSnapshot() {
    return {
      capabilities: { summary: true, commercial: true, finance: true, technical: true, projectSettings: false, unitsWorkspace: true, documents: true, chat: true, providers: false, avaluators: false },
      overview: {
        commercial: { value: 0, total: 0, label: 'unidades comprometidas' },
        finance: { value: 0, total: 0, label: 'requisitos cumplidos' },
        technical: { value: 0, total: 0, label: 'permisos aprobados' },
        legal: { value: 0, total: 0, label: 'unidades inscritas' }
      },
      globalProgress: 0,
      lifecycle: LIFECYCLE.map(phase => ({ ...phase, progress: 0, tasks: 0, delayed: 0, active: false })),
      stages: []
    };
  }

  function safeSnapshot() {
    try {
      const snapshot = workspaceApi?.snapshot?.();
      return snapshot && snapshot.overview && Array.isArray(snapshot.lifecycle) ? snapshot : fallbackSnapshot();
    } catch (error) {
      console.error('No se pudo actualizar el workspace unificado.', error);
      return fallbackSnapshot();
    }
  }

  function iconButton(id, icon, label) {
    const button = document.createElement('button');
    button.id = id;
    button.type = 'button';
    button.className = 'unified-icon-button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = `${icon}<span class="sr-only">${escapeHtml(label)}</span>`;
    return button;
  }

  function rememberHome(element) {
    if (!element || panelHomes.has(element.id)) return;
    const marker = document.createComment(`home:${element.id}`);
    element.parentNode?.insertBefore(marker, element);
    panelHomes.set(element.id, marker);
  }

  function restorePanel(element) {
    const marker = panelHomes.get(element?.id);
    if (marker?.parentNode && element) marker.parentNode.insertBefore(element, marker.nextSibling);
    if (element) {
      element.classList.remove('unified-panel-active');
      element.style.display = 'none';
    }
  }

  function closeOverlay() {
    if (!overlay) return;
    const body = overlay.querySelector('.unified-overlay-body');
    [...body.children].forEach(restorePanel);
    overlay.hidden = true;
    document.body.classList.remove('unified-modal-open');
  }

  async function openPanel(key, title) {
    const pane = document.getElementById(`tab-${key}`);
    if (!pane) return;
    try { await workspaceApi?.preparePanel?.(key); }
    catch (error) { console.error(`No se pudo preparar ${key}.`, error); }
    rememberHome(pane);
    overlay.querySelector('.unified-overlay-title').textContent = title || key;
    const body = overlay.querySelector('.unified-overlay-body');
    [...body.children].forEach(restorePanel);
    body.appendChild(pane);
    pane.style.display = 'block';
    pane.classList.add('unified-panel-active');
    overlay.hidden = false;
    document.body.classList.add('unified-modal-open');
    body.scrollTop = 0;
  }

  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'unifiedProjectOverlay';
    overlay.className = 'unified-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <button class="unified-overlay-backdrop" type="button" aria-label="Cerrar"></button>
      <section class="unified-overlay-dialog" role="dialog" aria-modal="true">
        <header><div><span>Proyecto</span><h2 class="unified-overlay-title"></h2></div><button type="button" class="unified-overlay-close" aria-label="Cerrar">${ICONS.close}</button></header>
        <div class="unified-overlay-body"></div>
      </section>`;
    overlay.addEventListener('click', event => {
      if (event.target.closest('.unified-overlay-close, .unified-overlay-backdrop')) closeOverlay();
    });
    document.body.appendChild(overlay);
  }

  function buildStageModal() {
    stageModal = document.createElement('div');
    stageModal.id = 'unifiedStageDrawer';
    stageModal.className = 'unified-stage-drawer';
    stageModal.hidden = true;
    stageModal.innerHTML = `
      <button class="unified-stage-backdrop" type="button" aria-label="Cerrar ficha de etapa"></button>
      <aside role="dialog" aria-modal="true" aria-labelledby="unifiedStageTitle">
        <header><div><span>Ficha integral de etapa / fase / torre</span><h2 id="unifiedStageTitle">Etapa</h2></div><div class="unified-stage-window-actions"><button type="button" data-stage-fullscreen aria-label="Ampliar a pantalla completa" title="Pantalla completa">⛶</button><button type="button" data-stage-close aria-label="Cerrar">&times;</button></div></header>
        <nav aria-label="Apartados de la etapa"></nav>
        <div class="unified-stage-busy" role="status" aria-live="polite" hidden><span aria-hidden="true"></span><strong>Cargando apartado…</strong><small>Estamos preparando la información de esta etapa.</small></div>
        <div class="unified-stage-content"></div>
      </aside>`;
    stageModal.addEventListener('click', event => {
      if (event.target.closest('[data-stage-close], .unified-stage-backdrop')) void closeStageModal();
      const fullscreen = event.target.closest('[data-stage-fullscreen]');
      if (fullscreen) toggleStageFullscreen();
      const tab = event.target.closest('[data-stage-tab]');
      if (tab) void selectStageTab(tab.dataset.stageTab);
    });
    stageModal.addEventListener('change', event => {
      const filter = event.target.closest('[data-stage-commercial-filter]');
      if (!filter) return;
      const selected = String(filter.value || '');
      const rows = stageModal.querySelectorAll('[data-commercial-status]');
      let visible = 0;
      rows.forEach(row => {
        const show = !selected || row.dataset.commercialStatus === selected;
        row.hidden = !show;
        if (show) visible += 1;
      });
      const count = stageModal.querySelector('[data-stage-commercial-visible]');
      if (count) count.textContent = String(visible);
    });
    document.body.appendChild(stageModal);
  }

  function toggleStageFullscreen(force) {
    if (!stageModal) return;
    const full = typeof force === 'boolean' ? force : !stageModal.classList.contains('is-fullscreen');
    const pageZoom = Number.parseFloat(window.getComputedStyle(document.body).zoom) || 1;
    if (full) {
      stageModal.style.setProperty('--unified-fullscreen-width', `${100 / pageZoom}dvw`);
      stageModal.style.setProperty('--unified-fullscreen-height', `${100 / pageZoom}dvh`);
    } else {
      stageModal.style.removeProperty('--unified-fullscreen-width');
      stageModal.style.removeProperty('--unified-fullscreen-height');
    }
    stageModal.classList.toggle('is-fullscreen', full);
    const button = stageModal.querySelector('[data-stage-fullscreen]');
    if (button) {
      button.textContent = full ? '▢' : '⛶';
      button.title = full ? 'Restaurar tamaño' : 'Pantalla completa';
      button.setAttribute('aria-label', button.title);
    }
    window.setTimeout(() => window.Chart?.getChart?.(document.getElementById('financeLoanLinesChart'))?.resize(), 30);
  }

  async function cleanupStageMount() {
    if (!activeStageMount) return;
    const mount = activeStageMount;
    activeStageMount = null;
    activeStageTab = '';
    try { await workspaceApi?.unmountStageSection?.(mount); }
    catch (error) { console.error('No se pudo cerrar la sección integrada de etapa.', error); }
  }

  async function closeStageModal() {
    if (!stageModal) return;
    stageTabRequest += 1;
    stageModal.hidden = true;
    const busy = stageModal.querySelector('.unified-stage-busy');
    if (busy) busy.hidden = true;
    pendingStageTab = '';
    activeStageTab = '';
    toggleStageFullscreen(false);
    document.body.classList.remove('unified-modal-open');
    // La ficha integral es la única ventana visible. El desmontaje y cualquier
    // autoguardado de los paneles históricos sucede después de ocultarla.
    await cleanupStageMount();
  }

  function metric(label, value, detail = '') {
    return `<article class="unified-stage-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
  }

  function money(value) {
    return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function stagePanelHtml(stage, tab) {
    if (tab === 'commercial') {
      const commercial = stage.commercial || {};
      const units = Array.isArray(commercial.units) ? commercial.units : [];
      const statuses = Array.from(new Map(units.map(unit => [unit.statusKey, unit.status])).entries())
        .filter(([key]) => key)
        .sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'es'));
      return `<div class="unified-stage-grid is-commercial-summary">
        ${metric('Valor comercial', money(commercial.salesValue), 'Precio de venta acumulado')}
        ${metric('Financiación CPP', money(commercial.cppValue), 'Financiación comercial acumulada')}
      </div>
      <section class="unified-stage-commercial-list" aria-label="Unidades comerciales de la etapa">
        <div class="unified-stage-list-heading"><div><span>Detalle comercial</span><h3>Unidades de ${escapeHtml(stage.name)}</h3></div><div class="unified-stage-commercial-tools"><label>Clasificar por estado<select data-stage-commercial-filter><option value="">Todos los estados</option>${statuses.map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join('')}</select></label><strong><span data-stage-commercial-visible>${units.length}</span> unidades</strong></div></div>
        ${units.length ? `<div class="unified-stage-unit-table">
          <div class="unified-stage-unit-row is-heading"><span>Unidad</span><span>Estado</span><span>Precio de venta</span><span>CPP</span></div>
          ${units.map(unit => `<div class="unified-stage-unit-row" data-commercial-status="${escapeHtml(unit.statusKey || '')}"><strong>${escapeHtml(unit.label || 'Unidad')}</strong><span>${escapeHtml(unit.status || 'Sin estado')}</span><span>${money(unit.salePrice)}</span><span>${money(unit.cppAmount)}</span></div>`).join('')}
        </div>` : '<div class="unified-empty">Esta etapa todavía no tiene unidades.</div>'}
      </section>`;
    }
    if (tab === 'finance') {
      if (!stage.phase) return '<div class="unified-empty">La etapa todavía no tiene planificación financiera.</div>';
      return `<div class="unified-stage-grid">
        ${metric('Usos estimados', money(stage.finance.planUses), 'Plan de la etapa')}
        ${metric('Usos reales', money(stage.finance.realUses), 'Ejecución registrada')}
        ${metric('Fuentes estimadas', money(stage.finance.planSources), 'Plan de financiación')}
        ${metric('Fuentes reales', money(stage.finance.realSources), 'Financión ejecutada')}
        ${metric('Líneas de crédito', stage.finance.loanLines, 'Líneas vinculadas')}
        ${metric('Unidades', stage.units, 'Unidades de esta etapa')}
      </div>`;
    }
    if (tab === 'technical') {
      return `<div class="unified-stage-grid">
        ${metric('Avance medio', `${stage.technical.constructionProgress}%`, 'Unidades con avance informado')}
        ${metric('En construcción', stage.technical.inConstruction, 'Unidades activas')}
        ${metric('Permisos de construcción', `${stage.technical.constructionPermits}/${stage.units}`, 'Cobertura por unidad')}
        ${metric('Permisos de ocupación', `${stage.technical.occupationPermits}/${stage.units}`, 'Cobertura por unidad')}
        ${metric('Pólizas aplicables', stage.technical.policies, 'CAR e incendio')}
        ${metric('Avisos técnicos', stage.technical.alerts, 'Cobertura por verificar')}
      </div>`;
    }
    const requirements = stage.finance?.requirements || [];
    const done = requirements.filter(item => item.status === 'CUMPLIDO').length;
    return `<div class="unified-requirements-summary">${metric('Cumplidos', `${done}/${requirements.length}`, 'Condiciones bancarias de la etapa')}</div>
      <div class="unified-requirements-list">${requirements.length ? requirements.map(item => `<div><span class="${item.status === 'CUMPLIDO' ? 'is-ok' : 'is-pending'}"></span><strong>${escapeHtml(item.title || `Requisito ${item.number || ''}`)}</strong><small>${escapeHtml(item.status || 'PENDIENTE')}</small></div>`).join('') : '<div class="unified-empty">No hay requisitos configurados.</div>'}</div>`;
  }

  function selectStageTab(tab) {
    if (!stageModal || stageModal.hidden) return Promise.resolve();
    if (pendingStageTab === tab || (activeStageTab === tab && activeStageMount)) return stageTabTransition;
    const requestId = ++stageTabRequest;
    const stageId = stageModal?.dataset.stageId;
    const stage = safeSnapshot().stages.find(item => item.id === stageId);
    if (!stage) return Promise.resolve();
    pendingStageTab = tab;
    stageModal.querySelectorAll('[data-stage-tab]').forEach(button => button.classList.toggle('is-active', button.dataset.stageTab === tab));
    const pendingContent = stageModal.querySelector('.unified-stage-content');
    if (!activeStageMount && pendingContent) {
      pendingContent.className = `unified-stage-content is-integrated-${tab}`;
      pendingContent.innerHTML = '<div class="unified-stage-loading">Cargando información de la etapa…</div>';
    }
    const busy = stageModal.querySelector('.unified-stage-busy');
    if (busy) {
      const labels = { finance: 'Cargando Finanzas…', technical: 'Cargando Técnico…', requirements: 'Cargando Requisitos…' };
      busy.querySelector('strong').textContent = labels[tab] || 'Cargando apartado…';
      busy.hidden = false;
    }
    stageTabTransition = stageTabTransition.catch(() => {}).then(async () => {
      if (requestId !== stageTabRequest || stageModal.hidden) return;
      await cleanupStageMount();
      if (requestId !== stageTabRequest || stageModal.hidden) return;
      const content = stageModal.querySelector('.unified-stage-content');
      content.className = `unified-stage-content is-integrated-${tab}`;
      content.innerHTML = '<div class="unified-stage-loading">Cargando información de la etapa…</div>';
      try {
        const mount = await workspaceApi?.mountStageSection?.(tab, stageId, content);
        if (requestId !== stageTabRequest || stageModal.hidden) {
          await workspaceApi?.unmountStageSection?.(mount);
          return;
        }
        activeStageMount = mount;
        activeStageTab = tab;
        if (!activeStageMount) content.innerHTML = stagePanelHtml(stage, tab);
      } catch (error) {
        if (requestId !== stageTabRequest || stageModal.hidden) return;
        console.error(`No se pudo abrir ${tab} para la etapa.`, error);
        content.innerHTML = `<div class="unified-empty">${escapeHtml(error?.message || 'No se pudo cargar este apartado.')}</div>`;
      } finally {
        if (requestId === stageTabRequest) {
          pendingStageTab = '';
          if (busy) busy.hidden = true;
        }
      }
    });
    return stageTabTransition;
  }

  function openStageModal(stageId) {
    const requestedStageId = String(stageId || '');
    if (openingStageId === requestedStageId) return;
    const snapshot = safeSnapshot();
    const stage = snapshot.stages.find(item => item.id === requestedStageId);
    if (!stage) return;
    if (!stageModal.hidden && stageModal.dataset.stageId === stage.id) return;
    openingStageId = requestedStageId;
    stageTabRequest += 1;
    pendingStageTab = '';
    activeStageTab = '';
    stageModal.dataset.stageId = stage.id;
    stageModal.querySelector('#unifiedStageTitle').textContent = stage.name;
    const tabs = [];
    if (snapshot.capabilities.commercial) tabs.push(['commercial', 'Comercial']);
    if (snapshot.capabilities.finance) tabs.push(['finance', 'Finanzas']);
    if (snapshot.capabilities.technical) tabs.push(['technical', 'Técnico']);
    if (snapshot.capabilities.finance) tabs.push(['requirements', 'Requisitos']);
    if (!tabs.length) tabs.push(['technical', 'Resumen técnico']);
    stageModal.querySelector('nav').innerHTML = tabs.map(([key, label], index) => `<button type="button" class="${index === 0 ? 'is-active' : ''}" data-stage-tab="${key}">${label}</button>`).join('');
    stageModal.hidden = false;
    document.body.classList.add('unified-modal-open');
    void selectStageTab(tabs[0][0]).finally(() => {
      if (openingStageId === requestedStageId) openingStageId = '';
    });
  }

  function areaCard(key, title, item, color) {
    const total = Number(item?.total || 0);
    const value = Number(item?.value || 0);
    const pct = total ? Math.max(0, Math.min(100, Math.round(value / total * 100))) : 0;
    const bars = [Math.max(12, pct - 28), Math.max(20, pct - 9), Math.max(16, pct - 18), Math.max(8, pct)];
    return `<button type="button" class="unified-area-card" data-summary-area="${key}" style="--area-color:${color};--area-pct:${pct}%">
      <span class="unified-area-copy"><span>${escapeHtml(title)}</span><small>${escapeHtml(item?.label || '')}</small></span>
      <span class="unified-area-chart" aria-hidden="true"><i class="unified-area-donut"></i><i class="unified-mini-bars">${bars.map(height => `<b style="height:${height}%"></b>`).join('')}</i><em>${pct}%</em></span>
      <strong>${value}<small> / ${total}</small></strong>
    </button>`;
  }

  function lifecycleMarkup(lifecycle) {
    const items = Array.isArray(lifecycle) && lifecycle.length ? lifecycle : fallbackSnapshot().lifecycle;
    return items.map((phase, index) => `
      <button type="button" class="unified-lifecycle-step ${phase.active ? 'is-active' : ''} ${phase.alerts || phase.delayed ? 'has-alert' : ''}" data-lifecycle-phase="${phase.key}" style="--phase-color:${phase.color || LIFECYCLE[index]?.color}">
        <span class="unified-step-index">${index + 1}</span>
        <span class="unified-step-copy"><strong>${escapeHtml(phase.name)}</strong><small>${phase.tasks} ${escapeHtml(phase.countLabel || 'checks')}${phase.checklistDelayed ? ` · ${phase.checklistDelayed} vencidos` : ''}</small></span>
        <span class="unified-step-progress">${phase.progress}%</span>
      </button>`).join('');
  }

  function renderOverview() {
    if (!workspaceApi || !unifiedRoot) return;
    const snapshot = safeSnapshot();
    const totalStages = snapshot.stages.length;
    const delayed = snapshot.lifecycle.reduce((sum, phase) => sum + Number(phase.alerts || phase.delayed || 0), 0);
    const globalProgress = Number(snapshot.globalProgress || 0);
    const totalUnits = Number(snapshot.overview.commercial?.total || 0);
    const committedUnits = Number(snapshot.overview.commercial?.value || 0);
    const headline = unifiedRoot.querySelector('#unifiedHeadlineKpis');
    if (headline) headline.innerHTML = `
      <span><small>Progreso global</small><strong>${globalProgress}%</strong></span>
      <span><small>Etapas</small><strong>${totalStages}</strong></span>
      <span><small>Unidades</small><strong>${totalUnits}</strong></span>
      <span><small>Comprometidas</small><strong>${committedUnits}</strong></span>
      <span class="${delayed ? 'has-alert' : ''}"><small>Avisos activos</small><strong>${delayed}</strong></span>`;
    const host = unifiedRoot.querySelector('#unifiedOverviewCards');
    if (host) host.innerHTML = [
      areaCard('commercial', 'Comercial', snapshot.overview.commercial, '#ef4444'),
      areaCard('legal', 'Legal', snapshot.overview.legal, '#a78bfa'),
      areaCard('technical', 'Técnico', snapshot.overview.technical, '#38bdf8'),
      areaCard('finance', 'Financiero', snapshot.overview.finance, '#f59e0b')
    ].join('');
    const rail = unifiedRoot.querySelector('#unifiedLifecycleRail');
    if (rail) rail.innerHTML = lifecycleMarkup(snapshot.lifecycle);
    decorateStageTitles();
  }

  function decorateStageTitles() {
    document.querySelectorAll('#unitsGrid .commercial-folder[data-folder-id] .folder-title, #technicalUnitsGrid .commercial-folder[data-folder-id] .folder-title').forEach(title => {
      title.tabIndex = 0;
      title.setAttribute('role', 'button');
      title.title = 'Abrir ficha financiera, técnica y de requisitos';
    });
  }

  async function setUnitsMode(mode, { remember = true } = {}) {
    const switcher = unifiedRoot?.querySelector('#unifiedUnitsModeSwitch');
    const available = [...(switcher?.querySelectorAll('[data-units-mode]') || [])].map(button => button.dataset.unitsMode);
    const next = available.includes(mode) ? mode : available[0] || 'commercial';
    activeUnitsMode = next;
    switcher?.querySelectorAll('[data-units-mode]').forEach(button => {
      const active = button.dataset.unitsMode === next;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.body.classList.toggle('units-mode-technical', next === 'technical');
    document.body.classList.toggle('units-mode-finance', next === 'finance');
    const commercialPane = document.getElementById('tab-comercial');
    if (commercialPane) commercialPane.dataset.unifiedMode = next;
    commercialPane?.querySelector('.commercial-control-panel')?.toggleAttribute('hidden', next !== 'commercial');
    document.getElementById('kpisComercial')?.toggleAttribute('hidden', next !== 'commercial');
    document.getElementById('unitsGrid')?.toggleAttribute('hidden', next !== 'commercial');
    const technicalHost = unifiedRoot?.querySelector('#unifiedTechnicalUnitsHost');
    if (technicalHost) technicalHost.hidden = next !== 'technical';
    const financeHost = unifiedRoot?.querySelector('#unifiedFinanceHost');
    if (financeHost) financeHost.hidden = next !== 'finance';
    const description = unifiedRoot?.querySelector('#unifiedUnitsDescription');
    if (description) description.textContent = next === 'technical'
      ? 'Avance de obra, permisos y coberturas sobre las mismas etapas y unidades del proyecto.'
      : 'Una única estructura comercial, legal, técnica y financiera. Pulsa el nombre de una etapa para abrir su ficha integral.';
    if (next === 'technical') await workspaceApi?.prepareUnitsMode?.('technical');
    if (next === 'finance') await workspaceApi?.prepareUnitsMode?.('finance');
    decorateStageTitles();
    if (remember) {
      try { localStorage.setItem('bank73_units_mode', next); } catch (_) {}
    }
  }

  function buildUnitsModeWorkspace(snapshot, commercialPane) {
    const switcher = unifiedRoot.querySelector('#unifiedUnitsModeSwitch');
    const modes = snapshot.role === 'tecnico'
      ? [['technical', 'Técnico']]
      : snapshot.capabilities.technical
        ? [
            ['commercial', 'Comercial'],
            ...(snapshot.capabilities.finance ? [['finance', 'Finanzas']] : []),
            ['technical', 'Técnico']
          ]
        : [['commercial', 'Comercial']];
    switcher.innerHTML = modes.map(([key, label]) => `<button type="button" data-units-mode="${key}" aria-pressed="false">${label}</button>`).join('');
    switcher.hidden = modes.length < 2;
    switcher.addEventListener('click', event => {
      const button = event.target.closest('[data-units-mode]');
      if (button) void setUnitsMode(button.dataset.unitsMode);
    });

    const technicalHost = document.createElement('div');
    technicalHost.id = 'unifiedTechnicalUnitsHost';
    technicalHost.className = 'unified-technical-units-host';
    technicalHost.hidden = true;
    commercialPane.appendChild(technicalHost);
    const technicalUnits = document.getElementById('technicalUnitsSection');
    if (technicalUnits) technicalHost.appendChild(technicalUnits);

    const financeHost = document.createElement('div');
    financeHost.id = 'unifiedFinanceHost';
    financeHost.className = 'unified-finance-host';
    financeHost.hidden = true;
    commercialPane.appendChild(financeHost);
    const financePane = document.getElementById('tab-finanzas');
    if (financePane) {
      financeHost.appendChild(financePane);
      financePane.style.display = 'block';
      financePane.classList.add('active');
    }

    let storedMode = '';
    try { storedMode = localStorage.getItem('bank73_units_mode') || ''; } catch (_) {}
    const initialMode = snapshot.role === 'tecnico' ? 'technical' : (modes.some(([key]) => key === storedMode) ? storedMode : 'commercial');
    void setUnitsMode(initialMode, { remember: false });
  }

  function closeAppbarMenus(except) {
    document.querySelectorAll('.unified-appbar-popover, .unified-more-menu').forEach(menu => {
      if (menu !== except) menu.hidden = true;
    });
  }

  function makeSettingControl(picker, type, canEdit) {
    if (!picker) return null;
    const select = picker.querySelector('select');
    if (!select) return null;
    const wrap = document.createElement('div');
    wrap.className = 'unified-appbar-setting';
    const label = type === 'currency' ? 'Divisa del proyecto' : 'Estado del proyecto';
    const trigger = iconButton(`unified${type === 'currency' ? 'Currency' : 'Status'}Btn`, type === 'currency' ? '<strong class="unified-currency-symbol"></strong>' : ICONS.status, label);
    trigger.classList.add(`is-${type}`);
    const popover = document.createElement('div');
    popover.className = 'unified-appbar-popover';
    popover.hidden = true;
    const heading = document.createElement('strong');
    heading.textContent = label;
    popover.append(heading, picker);
    select.disabled = !canEdit;
    const sync = () => {
      if (type === 'currency') trigger.querySelector('.unified-currency-symbol').textContent = select.selectedOptions[0]?.textContent || select.value;
      else trigger.dataset.status = select.value || 'EN_CURSO';
      trigger.title = `${label}: ${select.selectedOptions[0]?.textContent || select.value}${canEdit ? '' : ' (solo lectura)'}`;
    };
    sync();
    select.addEventListener('change', sync);
    trigger.addEventListener('click', event => {
      event.stopPropagation();
      const willOpen = popover.hidden;
      closeAppbarMenus(popover);
      popover.hidden = !willOpen;
    });
    wrap.append(trigger, popover);
    return wrap;
  }

  function buildProjectBrand() {
    const brand = document.querySelector('.topbar .brand');
    const topbar = brand?.closest('.topbar');
    const name = document.getElementById('pname')?.textContent?.trim() || 'Proyecto';
    const description = document.getElementById('pdesc')?.textContent?.trim() || 'Sin descripción';
    if (!brand || !topbar) return;
    [...brand.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).forEach(node => node.remove());
    const projectName = document.createElement('span');
    projectName.id = 'unifiedAppbarProjectName';
    projectName.className = 'unified-project-name';
    projectName.tabIndex = 0;
    projectName.textContent = name;
    projectName.dataset.description = description;
    projectName.setAttribute('aria-label', `${name}. ${description}`);
    topbar.appendChild(projectName);
  }

  function addExistingButtonIcon(button, icon) {
    if (!button || button.querySelector('.unified-existing-icon')) return;
    const iconHost = document.createElement('span');
    iconHost.className = 'unified-existing-icon';
    iconHost.setAttribute('aria-hidden', 'true');
    iconHost.innerHTML = icon;
    button.prepend(iconHost);
  }

  function buildAppbar(snapshot) {
    const actions = document.querySelector('.topbar-actions');
    if (!actions || document.getElementById('unifiedChatBtn')) return;
    buildProjectBrand();
    actions.classList.add('unified-appbar-actions');
    const primary = document.createElement('div');
    primary.className = 'unified-appbar-primary';

    const cover = document.getElementById('projectCoverBtn');
    if (cover) {
      cover.classList.add('unified-icon-button', 'unified-existing-button');
      cover.title = 'Portada del proyecto';
      cover.setAttribute('aria-label', 'Portada del proyecto');
      addExistingButtonIcon(cover, ICONS.cover);
      primary.appendChild(cover);
    }
    const dossier = document.getElementById('commercialDossierBtn');
    if (dossier) {
      dossier.classList.add('unified-icon-button', 'unified-existing-button');
      dossier.title = 'Dossier comercial';
      dossier.setAttribute('aria-label', 'Dossier comercial');
      addExistingButtonIcon(dossier, ICONS.dossier);
      primary.appendChild(dossier);
    }
    const currency = makeSettingControl(document.querySelector('.currency-picker'), 'currency', snapshot.capabilities.projectSettings);
    if (currency) primary.appendChild(currency);

    const docs = iconButton('unifiedDocsBtn', ICONS.docs, 'Documentos y repositorio');
    docs.addEventListener('click', () => openPanel('docs', 'Documentos y repositorio'));
    docs.hidden = snapshot.capabilities.documents === false;
    primary.appendChild(docs);

    const chat = iconButton('unifiedChatBtn', ICONS.chat, 'Chat del proyecto');
    chat.classList.add('is-chat');
    chat.addEventListener('click', () => openPanel('chat', 'Chat del proyecto'));
    chat.hidden = !snapshot.capabilities.chat;
    primary.appendChild(chat);

    const status = makeSettingControl(document.querySelector('.project-status-picker'), 'status', snapshot.capabilities.projectSettings);
    if (status) primary.appendChild(status);

    actions.insertBefore(primary, actions.firstElementChild);
    document.addEventListener('click', () => closeAppbarMenus());
  }

  async function openSummarySection(sectionId) {
    await openPanel('resumen', 'Resumen global');
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const target = document.getElementById(sectionId);
      const body = overlay?.querySelector('.unified-overlay-body');
      if (!target || !body) return;
      const top = target.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 12;
      body.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }));
  }

  function buildWorkspace() {
    const dataPanel = document.getElementById('projectDataPanel');
    const oldTabs = dataPanel?.querySelector('.tabs');
    const summaryPane = document.getElementById('tab-resumen');
    const timelinePane = document.getElementById('tab-proyecto');
    const commercialPane = document.getElementById('tab-comercial');
    if (!dataPanel || !timelinePane || !commercialPane) return false;
    oldTabs?.classList.add('unified-legacy-tabs');
    [summaryPane, document.getElementById('tab-finanzas'), document.getElementById('tab-tecnico'), document.getElementById('tab-proveedores'), document.getElementById('tab-docs'), document.getElementById('tab-avaluadores'), document.getElementById('tab-chat')].forEach(rememberHome);

    document.querySelector('.proyecto-topbar')?.classList.add('unified-legacy-project-header');
    document.getElementById('pdesc')?.classList.add('unified-legacy-project-header');
    document.getElementById('projectTypeText')?.classList.add('unified-legacy-project-header');
    document.getElementById('kpis')?.classList.add('unified-legacy-project-header');

    unifiedRoot = document.createElement('main');
    unifiedRoot.id = 'unifiedProjectWorkspace';
    unifiedRoot.className = 'unified-workspace';
    unifiedRoot.innerHTML = `
      <section class="unified-summary-shell">
        <button id="unifiedOpenSummary" class="unified-summary-heading" type="button">
          <span class="unified-summary-title"><span>Visión del proyecto</span><strong>Resumen global</strong><small>Abrir informe completo, comparaciones y exportaciones</small></span>
          <span id="unifiedHeadlineKpis" class="unified-headline-kpis"></span>
          <span class="unified-summary-arrow" aria-hidden="true">›</span>
        </button>
        <div id="unifiedOverviewCards" class="unified-overview-grid"></div>
      </section>
      <section class="unified-timeline-shell">
        <div class="unified-section-heading"><div><span>Seguimiento</span><h2>Cronograma del proyecto</h2><p>Selecciona un bloque para ver sus checks, responsables, fechas y documentación.</p></div></div>
        <div id="unifiedLifecycleRail" class="unified-lifecycle-rail">${lifecycleMarkup(fallbackSnapshot().lifecycle)}</div>
        <div id="unifiedTimelineContent"></div>
      </section>
      <section class="unified-commercial-shell">
        <div class="unified-section-heading unified-units-heading"><div><span>Visión integral</span><h2>Proyecto</h2><p id="unifiedUnitsDescription">Una única estructura comercial, financiera y técnica de todas las etapas. Pulsa el nombre de una etapa para abrir su ficha integral.</p></div><div id="unifiedUnitsModeSwitch" class="unified-units-mode" role="group" aria-label="Vista global del proyecto"></div></div>
        <div id="unifiedCommercialContent"></div>
      </section>`;

    dataPanel.insertBefore(unifiedRoot, oldTabs || dataPanel.firstChild);
    unifiedRoot.querySelector('#unifiedTimelineContent').appendChild(timelinePane);
    unifiedRoot.querySelector('#unifiedCommercialContent').appendChild(commercialPane);
    timelinePane.style.display = 'block';
    commercialPane.style.display = 'block';
    timelinePane.classList.add('active');
    commercialPane.classList.add('active');
    buildUnitsModeWorkspace(safeSnapshot(), commercialPane);

    unifiedRoot.querySelector('#unifiedOpenSummary').addEventListener('click', () => openPanel('resumen', 'Resumen global'));
    unifiedRoot.addEventListener('click', event => {
      const step = event.target.closest('[data-lifecycle-phase]');
      if (step) {
        workspaceApi?.selectLifecyclePhase?.(step.dataset.lifecyclePhase);
        window.setTimeout(renderOverview, 0);
      }
      const area = event.target.closest('[data-summary-area]');
      if (area) {
        const sectionByArea = {
          commercial: 'summaryCommercialBlock',
          legal: 'summaryLegalBlock',
          technical: 'summaryTechnicalBlock',
          finance: 'summaryFinancialBlock'
        };
        openSummarySection(sectionByArea[area.dataset.summaryArea]);
      }
    });

    const unitsGrid = document.getElementById('unitsGrid');
    unitsGrid?.addEventListener('click', event => {
      const title = event.target.closest('.folder-title');
      if (!title || event.target.closest('.folder-actions')) return;
      event.preventDefault();
      event.stopPropagation();
      const folder = title.closest('.commercial-folder');
      if (folder?.dataset.folderId) openStageModal(folder.dataset.folderId);
    });
    unitsGrid?.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key)) return;
      const title = event.target.closest('.folder-title');
      const folder = title?.closest('.commercial-folder');
      if (folder?.dataset.folderId) { event.preventDefault(); openStageModal(folder.dataset.folderId); }
    });

    const technicalUnitsGrid = document.getElementById('technicalUnitsGrid');
    technicalUnitsGrid?.addEventListener('click', event => {
      const title = event.target.closest('.folder-title');
      if (!title || event.target.closest('.folder-actions')) return;
      event.preventDefault();
      event.stopPropagation();
      const folder = title.closest('.commercial-folder');
      if (folder?.dataset.folderId) openStageModal(folder.dataset.folderId);
    });
    technicalUnitsGrid?.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key)) return;
      const title = event.target.closest('.folder-title');
      const folder = title?.closest('.commercial-folder');
      if (folder?.dataset.folderId) { event.preventDefault(); openStageModal(folder.dataset.folderId); }
    });

    const observer = new MutationObserver(() => {
      decorateStageTitles();
      window.clearTimeout(observer._refreshTimer);
      observer._refreshTimer = window.setTimeout(renderOverview, 60);
    });
    if (unitsGrid) observer.observe(unitsGrid, { childList: true, subtree: true });
    if (technicalUnitsGrid) observer.observe(technicalUnitsGrid, { childList: true, subtree: true });
    const phasesHost = document.getElementById('phasesHost');
    if (phasesHost) observer.observe(phasesHost, { childList: true });
    return true;
  }

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (stageModal && !stageModal.hidden) closeStageModal();
    else if (overlay && !overlay.hidden) closeOverlay();
  });

  window.__BANK73_UNIFIED_REFRESH = () => renderOverview();
  window.initializeUnifiedProjectWorkspace = async api => {
    if (document.getElementById('unifiedProjectWorkspace')) return;
    workspaceApi = api;
    buildOverlay();
    buildStageModal();
    if (!buildWorkspace()) return;
    document.body.classList.add('project-unified-ready');
    const snapshot = safeSnapshot();
    buildAppbar(snapshot);
    const summaryShell = unifiedRoot.querySelector('.unified-summary-shell');
    if (summaryShell) summaryShell.hidden = !snapshot.capabilities.summary;
    const commercialShell = unifiedRoot.querySelector('.unified-commercial-shell');
    if (commercialShell) commercialShell.hidden = !snapshot.capabilities.unitsWorkspace;
    renderOverview();
  };
})();
