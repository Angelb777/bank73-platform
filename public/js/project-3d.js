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
  const fullscreenModeButtons = [...document.querySelectorAll('[data-viewer-mode]')];
  const editTowersButton = document.getElementById('project3dEditTowers');
  const towerEditor = document.getElementById('project3dTowerEditor');
  const towerEditorClose = document.getElementById('project3dTowerEditorClose');
  const towerEditorEmpty = document.getElementById('project3dTowerEditorEmpty');
  const towerEditorForm = document.getElementById('project3dTowerEditorForm');
  const towerIdInput = document.getElementById('project3dTowerId');
  const towerNameInput = document.getElementById('project3dTowerName');
  const towerStatusInput = document.getElementById('project3dTowerStatus');
  const towerAppearanceInput = document.getElementById('project3dTowerAppearance');
  const towerVisibleInput = document.getElementById('project3dTowerVisible');
  const towerCancelButton = document.getElementById('project3dTowerCancel');
  const towerSaveButton = document.getElementById('project3dTowerSave');
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
      ['#ab7ee8', 'Acabados'],
      ['#ff6b72', 'Sin empezar']
    ],
    finance: [
      ['#48cde3', 'Margen positivo'],
      ['#ffb84d', 'Sin margen'],
      ['#e86b9a', 'Venta bajo coste']
    ],
    commercial: [
      ['#32d6a0', 'Lote libre'],
      ['#22c7d6', 'Inventario'],
      ['#ffbe55', 'Reservado'],
      ['#ab7ee8', 'Con CPP'],
      ['#eab308', 'Trámite legal'],
      ['#ef4444', 'Traspasado']
    ]
  };

  let enabled = false;
  let projectId = '';
  let activeTab = 'resumen';
  let activeMode = 'commercial';
  let ready = false;
  let towerEditorActive = false;
  let selectedTower = null;

  function setEditableTowerOptions(towers = []) {
    const editable = towers.filter(tower => tower?.editable === true);
    towerIdInput.replaceChildren(...editable.map(tower => {
      const option = document.createElement('option');
      option.value = String(tower.towerId || '');
      option.textContent = String(tower.name || `Torre ${tower.towerId || ''}`);
      return option;
    }));
    editTowersButton.hidden = editable.length === 0;
  }

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

  function setViewerMode(mode) {
    if (!LABEL_BY_MODE[mode]) return;
    activeMode = mode;
    modeBadge.textContent = LABEL_BY_MODE[mode];
    renderLegend(mode);
    fullscreenModeButtons.forEach(button => {
      const active = button.dataset.viewerMode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    post('BANK73_VIEWER_MODE', { mode });
  }

  function fillTowerEditor(tower) {
    selectedTower = tower || null;
    towerEditorEmpty.hidden = Boolean(tower);
    towerEditorForm.hidden = !tower;
    if (!tower) return;
    towerIdInput.value = tower.towerId;
    towerNameInput.value = tower.name || `Torre ${tower.towerId}`;
    towerStatusInput.value = tower.constructionStatus || 'unknown';
    towerAppearanceInput.value = tower.appearance || 'solid';
    towerVisibleInput.checked = tower.visible !== false;
  }

  function setTowerEditor(active) {
    towerEditorActive = Boolean(active) && document.fullscreenElement === panel;
    panel.classList.toggle('is-tower-editing', towerEditorActive);
    towerEditor.hidden = !towerEditorActive;
    editTowersButton.textContent = towerEditorActive ? 'Cerrar editor' : 'Editar torres';
    if (!towerEditorActive) fillTowerEditor(null);
    else setViewerMode('progress');
    post('BANK73_VIEWER_TOWER_EDIT', { active: towerEditorActive });
  }

  function requestTower(towerId) {
    post('BANK73_VIEWER_SELECT_TOWER', { towerId });
  }

  function syncVisibility() {
    const mode = MODE_BY_TAB[activeTab];
    const visible = enabled && Boolean(mode);
    workspace.dataset.viewerTab = activeTab;
    panel.hidden = !visible;
    workspace.classList.toggle('viewer-active', visible);
    if (!visible) return;
    setViewerMode(mode);
    requestAnimationFrame(() => post('BANK73_VIEWER_RESIZE'));
  }

  function configure(project = {}) {
    const config = project.viewer3D || {};
    projectId = String(project._id || project.id || '');
    const configuredPath = String(config.viewerPath || (config.modelKey === 'el-palmar' ? '/el-palmar-viewer/index.html' : '')).trim();
    const viewerPath = /^\/(?!\/)/.test(configuredPath) ? configuredPath : '';
    // La activación pertenece al proyecto; no depende de su nombre ni de un ID.
    enabled = config.enabled === true && Boolean(viewerPath);
    activeTab = document.querySelector('#projectDataPanel > .tabs .tab.active[data-tab]')?.dataset.tab || activeTab;
    note.textContent = config.note || '';
    if (enabled && projectId) {
      prepareSplitLayout();
      const separator = viewerPath.includes('?') ? '&' : '?';
      const src = `${viewerPath}${separator}embed=1&projectId=${encodeURIComponent(projectId)}&v=viewer-editor-v3`;
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
      setEditableTowerOptions(Array.isArray(event.data.towers) ? event.data.towers : []);
      panel.classList.add('is-ready');
      syncVisibility();
      post('BANK73_VIEWER_FULLSCREEN', { active: document.fullscreenElement === panel });
      if (towerEditorActive) {
        post('BANK73_VIEWER_TOWER_EDIT', { active: true });
        requestTower(selectedTower?.towerId || towerIdInput.value);
      }
    }
    if (event.data?.type === 'BANK73_VIEWER_OPEN_UNIT' && event.data?.unitId) {
      const openUnit = window.abrirFichaUnidad;
      if (typeof openUnit === 'function') openUnit(String(event.data.unitId));
    }
    if (event.data?.type === 'BANK73_VIEWER_TOWER_SELECTED') {
      fillTowerEditor(event.data.tower || null);
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
  fullscreenModeButtons.forEach(button => {
    button.addEventListener('click', () => setViewerMode(button.dataset.viewerMode));
  });
  editTowersButton?.addEventListener('click', () => setTowerEditor(!towerEditorActive));
  towerEditorClose?.addEventListener('click', () => setTowerEditor(false));
  towerCancelButton?.addEventListener('click', () => {
    if (selectedTower) fillTowerEditor(selectedTower);
    else setTowerEditor(false);
  });
  towerIdInput?.addEventListener('change', () => requestTower(towerIdInput.value));
  towerEditorForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!selectedTower || !projectId) return;
    const payload = {
      name: towerNameInput.value.trim(),
      constructionStatus: towerStatusInput.value,
      appearance: towerAppearanceInput.value,
      visible: towerVisibleInput.checked
    };
    const previousText = towerSaveButton.textContent;
    towerSaveButton.disabled = true;
    towerSaveButton.textContent = 'Guardando...';
    try {
      const token = localStorage.getItem('tkn') || localStorage.getItem('token');
      const tenant = localStorage.getItem('tenantKey') || 'bancodemo';
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/viewer-3d/towers/${encodeURIComponent(selectedTower.towerId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'x-tenant': tenant
        },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      fillTowerEditor(result);
      post('BANK73_VIEWER_TOWER_UPDATED', { tower: result });
      post('BANK73_VIEWER_MODE', { mode: 'progress' });
    } catch (error) {
      console.error('[Visor 3D] No se pudo guardar la torre', error);
      alert(error.message || 'No se pudo guardar la torre');
    } finally {
      towerSaveButton.disabled = false;
      towerSaveButton.textContent = previousText;
    }
  });
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
    if (!expanded) {
      setTowerEditor(false);
      setViewerMode(MODE_BY_TAB[activeTab] || 'commercial');
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
