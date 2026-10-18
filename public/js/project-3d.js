(() => {
  'use strict';

  const workspace = document.getElementById('projectExperience');
  const panel = document.getElementById('project3dPanel');
  const frame = document.getElementById('project3dFrame');
  const modeBadge = document.getElementById('project3dMode');
  const legend = document.getElementById('project3dLegend');
  const note = document.getElementById('project3dNote');
  const resetButton = document.getElementById('project3dReset');
  const expandButton = document.getElementById('project3dExpand');
  if (!workspace || !panel || !frame) return;

  const MODE_BY_TAB = {
    resumen: 'commercial',
    proyecto: 'progress',
    finanzas: 'finance',
    comercial: 'commercial'
  };
  const LABEL_BY_MODE = {
    progress: 'Avance técnico',
    finance: 'Coste y venta',
    commercial: 'Estado comercial'
  };
  const LEGENDS = {
    progress: [
      ['#35d49a', 'Finalizada'],
      ['#ffc857', 'En ejecución'],
      ['#ff6b72', 'Pendiente'],
      ['#728496', 'Sin datos']
    ],
    finance: [
      ['#48cde3', 'En presupuesto'],
      ['#ffb84d', 'Desviación ≤ 5%'],
      ['#e86b9a', 'Desviación > 5%'],
      ['#728496', 'Sin datos']
    ],
    commercial: [
      ['#32d6a0', 'Disponible'],
      ['#ffbe55', 'Reservada'],
      ['#ab7ee8', 'Con CPP'],
      ['#eab308', 'Vendida'],
      ['#ef4444', 'Traspasada']
    ]
  };

  let enabled = false;
  let projectId = '';
  let activeTab = 'resumen';
  let ready = false;

  function splitPane(pane, leadNodes, detailNodes) {
    if (!pane || pane.dataset.viewerSplit === 'true') return;
    const lead = document.createElement('div');
    const detail = document.createElement('div');
    lead.className = 'project-tab-lead';
    detail.className = 'project-tab-detail';
    leadNodes.filter(Boolean).forEach(node => lead.appendChild(node));
    detailNodes.filter(Boolean).forEach(node => detail.appendChild(node));
    pane.append(lead, detail);
    pane.dataset.viewerSplit = 'true';
  }

  function prepareSplitLayout() {
    const summary = document.getElementById('tab-resumen');
    if (summary && summary.dataset.viewerSplit !== 'true') {
      const children = [...summary.children];
      const detailStart = children.findIndex(node => node.querySelector?.('.summary-block-title')?.textContent?.trim() === 'Resumen Comercial');
      const lead = detailStart >= 0 ? children.slice(0, detailStart) : children.slice(0, 5);
      const detail = detailStart >= 0 ? children.slice(detailStart) : children.slice(5);
      splitPane(summary, lead, detail);
    }

    const progress = document.getElementById('tab-proyecto');
    if (progress && progress.dataset.viewerSplit !== 'true') {
      const globalProgress = progress.querySelector(':scope > .phase');
      const grid = progress.querySelector(':scope > .proyecto-grid');
      const phases = grid?.querySelector('#phasesHost');
      const roles = grid?.querySelector('.roles-panel');
      splitPane(progress, [globalProgress, roles], [phases]);
      grid?.remove();
    }

    const finance = document.getElementById('tab-finanzas');
    if (finance && finance.dataset.viewerSplit !== 'true') {
      const children = [...finance.children];
      const lead = children.filter((node, index) => index === 0 || node.matches('.finance-conditions-card, .finance-main-kpis'));
      splitPane(finance, lead, children.filter(node => !lead.includes(node)));
    }

    const commercial = document.getElementById('tab-comercial');
    if (commercial && commercial.dataset.viewerSplit !== 'true') {
      const children = [...commercial.children];
      const lead = children.filter(node => node.matches('.commercial-control-panel, #kpisComercial'));
      splitPane(commercial, lead, children.filter(node => !lead.includes(node)));
    }
  }

  function post(type, payload = {}) {
    if (!ready || !frame.contentWindow) return;
    frame.contentWindow.postMessage({ type, ...payload }, location.origin);
  }

  function renderLegend(mode) {
    legend.innerHTML = (LEGENDS[mode] || [])
      .map(([color, label]) => `<span><i style="--viewer-color:${color}"></i>${label}</span>`)
      .join('');
  }

  function syncVisibility() {
    const mode = MODE_BY_TAB[activeTab];
    const visible = enabled && Boolean(mode);
    workspace.dataset.viewerTab = activeTab;
    panel.hidden = !visible;
    workspace.classList.toggle('viewer-active', visible);
    if (!visible) return;
    modeBadge.textContent = LABEL_BY_MODE[mode] || 'Modelo 3D';
    renderLegend(mode);
    post('BANK73_VIEWER_MODE', { mode });
    requestAnimationFrame(() => post('BANK73_VIEWER_RESIZE'));
  }

  function configure(project = {}) {
    const config = project.viewer3D || {};
    projectId = String(project._id || project.id || '');
    // Primera integracion: solo THE PALMS. El resto conserva la interfaz anterior.
    enabled = projectId === '6ad374d758346b3260b87fb3'
      && config.enabled === true
      && config.modelKey === 'el-palmar';
    activeTab = document.querySelector('#projectDataPanel > .tabs .tab.active[data-tab]')?.dataset.tab || activeTab;
    note.textContent = config.note || '';
    if (enabled && projectId) {
      prepareSplitLayout();
      const src = `/el-palmar-viewer/index.html?embed=1&projectId=${encodeURIComponent(projectId)}&v=palms-layout-v4`;
      if (!frame.src || new URL(frame.src, location.origin).pathname + new URL(frame.src, location.origin).search !== src) {
        ready = false;
        panel.classList.remove('is-ready');
        frame.src = src;
      }
    } else {
      frame.removeAttribute('src');
      ready = false;
      panel.classList.remove('is-ready');
    }
    syncVisibility();
  }

  function setModeFromTab(tab) {
    activeTab = tab || 'resumen';
    syncVisibility();
  }

  function refresh() {
    post('BANK73_VIEWER_REFRESH');
  }

  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    if (event.data?.type === 'BANK73_VIEWER_READY') {
      ready = true;
      panel.classList.add('is-ready');
      syncVisibility();
      post('BANK73_VIEWER_FULLSCREEN', { active: document.fullscreenElement === panel });
    }
    if (event.data?.type === 'BANK73_VIEWER_OPEN_UNIT' && event.data?.unitId) {
      const openUnit = window.abrirFichaUnidad;
      if (typeof openUnit === 'function') openUnit(String(event.data.unitId));
    }
  });
  document.addEventListener('click', event => {
    const tab = event.target.closest('#projectDataPanel > .tabs .tab[data-tab]');
    if (tab) setModeFromTab(tab.dataset.tab);
  }, true);
  const tabs = document.querySelector('#projectDataPanel > .tabs');
  if (tabs) {
    new MutationObserver(() => {
      const selected = tabs.querySelector('.tab.active[data-tab]');
      if (selected && selected.dataset.tab !== activeTab) setModeFromTab(selected.dataset.tab);
    }).observe(tabs, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  resetButton?.addEventListener('click', () => post('BANK73_VIEWER_RESET'));
  expandButton?.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement === panel) await document.exitFullscreen();
      else await panel.requestFullscreen();
    } catch (error) {
      console.warn('[Visor 3D] No se pudo cambiar a pantalla completa', error);
    }
  });
  document.addEventListener('fullscreenchange', () => {
    const expanded = document.fullscreenElement === panel;
    panel.classList.toggle('is-fullscreen', expanded);
    if (expandButton) {
      expandButton.textContent = expanded ? 'Salir de pantalla completa' : 'Pantalla completa';
      expandButton.setAttribute('aria-label', expanded ? 'Salir de pantalla completa' : 'Ampliar modelo 3D');
    }
    const unitModal = document.getElementById('fichaUnidadModal');
    if (unitModal && unitModal.style.display !== 'none') {
      const modalHost = expanded ? panel : document.body;
      if (unitModal.parentElement !== modalHost) modalHost.appendChild(unitModal);
    }
    post('BANK73_VIEWER_FULLSCREEN', { active: expanded });
    requestAnimationFrame(() => post('BANK73_VIEWER_RESIZE'));
  });

  window.__PROJECT_3D = { configure, setModeFromTab, refresh };
})();
