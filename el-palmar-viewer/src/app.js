import './styles.css';
import { elPalmarProject } from './data/el-palmar.project.js';
import { loadBank73Project, withoutBank73UnitData } from './data/bank73-project.js';
import { RealEstateViewer } from './viewer/viewer.js';

const LABELS = {
  completed: 'Finalizado', inProgress: 'En ejecución', finishing: 'Acabados', pending: 'Pendiente',
  onTrack: 'Margen positivo', attention: 'Sin margen', deviation: 'Venta bajo coste',
  available: 'Disponible', inventory: 'Inventario', reserved: 'Reservado', sold: 'Trámite legal activado',
  transferred: 'Escriturado / Traspasado', delivered: 'Vivienda entregada', cpp: 'Con CPP o venta al contado', unknown: 'Sin datos'
};
const LEGENDS = {
  progress: [['completed', 'Finalizada'], ['inProgress', 'En ejecución'], ['finishing', 'Acabados'], ['pending', 'Pendiente']],
  finance: [['onTrack', 'Margen positivo'], ['attention', 'Sin margen'], ['deviation', 'Venta bajo coste']],
  commercial: [['available', 'Disponible'], ['inventory', 'Inventario'], ['reserved', 'Reservado'], ['cpp', 'Con CPP o venta al contado'], ['sold', 'Trámite legal activado'], ['transferred', 'Escriturado / Traspasado'], ['delivered', 'Vivienda entregada']]
};
const COLORS = {
  completed: '#39ca78', inProgress: '#f2c94c', finishing: '#ab7ee8', pending: '#ef5b63',
  onTrack: '#46c7a1', attention: '#f0b84b', deviation: '#d95c76',
  available: '#35c58a', inventory: '#22c7d6', reserved: '#f0b74a', sold: '#eab308',
  transferred: '#ef4444', delivered: '#3b82f6', cpp: '#9b74d1', unknown: '#728496'
};

const ui = {
  canvas: document.querySelector('#scene'), tower: document.querySelector('#towerSelect'), floor: document.querySelector('#floorSelect'),
  modes: document.querySelector('#modeSelector'), legend: document.querySelector('#legend'), empty: document.querySelector('#emptyState'),
  card: document.querySelector('#unitCard'), kicker: document.querySelector('#unitKicker'), title: document.querySelector('#unitTitle'),
  status: document.querySelector('#unitStatus'), details: document.querySelector('#unitDetails'),
  viewInterior: document.querySelector('#viewInterior'), exitInterior: document.querySelector('#exitInterior'),
  interiorBadge: document.querySelector('#interiorBadge'), interiorUnitId: document.querySelector('#interiorUnitId'),
  instructions: document.querySelector('.instructions'), provisionalNote: document.querySelector('.provisional-note'),
  dataWarning: document.querySelector('#dataWarning')
};
let activeMode = 'commercial';

const query = new URLSearchParams(window.location.search);
const embedMode = query.get('embed') === '1';
const projectId = query.get('projectId') || '';
document.body.classList.toggle('embed-mode', embedMode);
let project = elPalmarProject;
try {
  project = await loadBank73Project(elPalmarProject, projectId);
} catch (error) {
  console.error('[Visor 3D] No se pudieron cargar los datos integrados', error);
  if (projectId) project = withoutBank73UnitData(elPalmarProject);
}

const viewer = new RealEstateViewer(ui.canvas, project, renderUnit, renderInteriorState, renderTowerSelection);

function renderTowerSelection(tower) {
  if (!embedMode) return;
  window.parent.postMessage({ type: 'BANK73_VIEWER_TOWER_SELECTED', tower }, window.location.origin);
}

ui.tower.innerHTML = '<option value="all">Todas las torres</option>' + project.towers.map((tower) => `<option value="${tower.id}">${tower.name}</option>`).join('');
function availableFloors() {
  const towers = ui.tower.value === 'all'
    ? project.towers
    : project.towers.filter((tower) => tower.id === ui.tower.value);
  const floors = new Map();
  towers.forEach((tower) => tower.floors.forEach((floor) => floors.set(String(floor.level), floor.label)));
  return [...floors.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
}

function updateFloorOptions() {
  const previous = ui.floor.value;
  ui.floor.innerHTML = '<option value="all">Todos los niveles</option>' + availableFloors().map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  if ([...ui.floor.options].some((option) => option.value === previous)) ui.floor.value = previous;
}

updateFloorOptions();

function formatMoney(amount, currency = 'PAB') {
  if (amount == null) return 'Sin dato';
  return new Intl.NumberFormat('es-PA', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
}
function formatArea(area) { return area == null ? 'Sin dato' : `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(area)} m²`; }
function row(label, value) {
  if (value == null || value === '') return '';
  return `<div><dt>${label}</dt><dd>${value}</dd></div>`;
}

function renderUnit(data) {
  ui.empty.hidden = Boolean(data);
  ui.card.hidden = !data;
  if (!data) return;
  const modeData = data[activeMode];
  ui.kicker.textContent = `Torre ${data.towerId} · ${data.floorLabel || `Nivel ${data.floor}`}`;
  ui.title.textContent = data.unitId;
  const hasStatus = Boolean(modeData?.status && modeData.status !== 'unknown');
  ui.status.hidden = !hasStatus;
  ui.status.textContent = hasStatus ? (LABELS[modeData.status] || '') : '';
  ui.status.style.setProperty('--status-color', COLORS[modeData.status] || COLORS.unknown);
  const sourceLabel = data.sourceKind === 'bank73-integrated'
    ? (data.sourceLabel || 'Bank73 · Dato Único')
    : data.sourceKind === 'official-single-source' ? 'Dato Único oficial' : 'Planos históricos';
  const base = row('Modelo', data.apartmentModel)
    + row('Identificador comercial', data.externalId)
    + row('Recámaras', data.bedrooms)
    + row('Baños', data.bathrooms)
    + row('Área cerrada', data.closedArea == null ? null : formatArea(data.closedArea))
    + row('Área total', data.totalArea == null ? null : formatArea(data.totalArea))
    + row('Fuente', sourceLabel);
  const modeRows = activeMode === 'progress'
    ? row('Estado de obra', modeData.label || (modeData.status !== 'unknown' ? LABELS[modeData.status] : null))
      + row('Fase', modeData.phase)
    : activeMode === 'finance'
      ? row('Coste de la unidad', modeData.budgetCost == null ? null : formatMoney(modeData.budgetCost, modeData.currency))
        + row('Precio de venta', modeData.salePrice == null ? null : formatMoney(modeData.salePrice, modeData.currency))
        + row('Abonado por cliente', modeData.collected == null ? null : formatMoney(modeData.collected, modeData.currency))
        + row('Margen', modeData.estimatedMargin == null ? null : formatMoney(modeData.estimatedMargin, modeData.currency))
      : row('Estado comercial', hasStatus ? LABELS[modeData.status] : null)
        + row('Precio lista', modeData.listPrice == null ? null : formatMoney(modeData.listPrice, modeData.currency))
        + row('Precio de venta', modeData.salePrice == null ? null : formatMoney(modeData.salePrice, modeData.currency));
  ui.details.innerHTML = base + modeRows;
  ui.viewInterior.hidden = data.interiorAvailable === false;
  ui.dataWarning.textContent = data.sourceKind === 'bank73-integrated'
    ? 'Todos los datos proceden de la ficha única de esta unidad en Bank73. Geometría 3D simplificada.'
    : data.sourceKind === 'official-single-source'
      ? 'Inventario, modelo, superficies, precio y estado proceden del Dato Único oficial. La posición 3D es una reconstrucción simplificada.'
      : 'Volumetría documental sin enlace comercial. No se infiere disponibilidad ni precio.';
}

function renderInteriorState(active, unit, interior) {
  document.body.classList.toggle('interior-mode', active);
  ui.exitInterior.hidden = !active;
  ui.interiorBadge.hidden = !active;
  ui.provisionalNote.hidden = active;
  ui.interiorUnitId.textContent = active ? unit.unitId : '';
  ui.instructions.innerHTML = active
    ? '<strong>Arrastra</strong> para orbitar · <strong>Rueda</strong> para acercar · Vista sin techo'
    : '<strong>Arrastra</strong> para girar · <strong>Rueda</strong> para acercar · <strong>Clic</strong> selecciona · <strong>Doble clic</strong> abre interior';
  if (active && interior?.approximation) ui.interiorBadge.dataset.approximation = 'Tipología aproximada';
  else delete ui.interiorBadge.dataset.approximation;
}

function renderLegend() {
  ui.legend.innerHTML = LEGENDS[activeMode].map(([key, label]) => `<span><i style="--legend-color:${COLORS[key]}"></i>${label}</span>`).join('');
}

function applyFilters() {
  viewer.filter(ui.tower.value, ui.floor.value);
  if (ui.tower.value !== 'all') viewer.focusTower(ui.tower.value);
}

ui.modes.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-mode]');
  if (!button) return;
  activeMode = button.dataset.mode;
  [...ui.modes.children].forEach((item) => item.classList.toggle('active', item === button));
  viewer.setMode(activeMode);
  renderLegend();
  if (viewer.selectedUnit) renderUnit(viewer.selectedUnit.userData);
});
ui.tower.addEventListener('change', () => { updateFloorOptions(); applyFilters(); });
ui.floor.addEventListener('change', applyFilters);
document.querySelector('#clearFilters').addEventListener('click', () => { ui.tower.value = 'all'; ui.floor.value = 'all'; applyFilters(); viewer.resetView(); });
document.querySelector('#resetView').addEventListener('click', () => viewer.resetView());
ui.viewInterior.addEventListener('click', () => viewer.enterInterior());
ui.exitInterior.addEventListener('click', () => viewer.exitInterior());
ui.title.addEventListener('click', () => {
  const unitId = viewer.selectedUnit?.userData?.bank73UnitId;
  if (embedMode && unitId) {
    window.parent.postMessage({ type: 'BANK73_VIEWER_OPEN_UNIT', unitId }, window.location.origin);
  }
});
renderLegend();

window.addEventListener('message', event => {
  if (event.origin !== window.location.origin) return;
  const { type, mode } = event.data || {};
  if (type === 'BANK73_VIEWER_MODE' && ['progress', 'finance', 'commercial'].includes(mode)) {
    activeMode = mode;
    [...ui.modes.children].forEach(item => item.classList.toggle('active', item.dataset.mode === mode));
    viewer.setMode(mode);
    renderLegend();
    if (viewer.selectedUnit) renderUnit(viewer.selectedUnit.userData);
  }
  if (type === 'BANK73_VIEWER_RESET') viewer.resetView();
  if (type === 'BANK73_VIEWER_RESIZE') viewer.resize();
  if (type === 'BANK73_VIEWER_FULLSCREEN') {
    document.body.classList.toggle('host-fullscreen', Boolean(event.data?.active));
    viewer.resize();
  }
  if (type === 'BANK73_VIEWER_TOWER_EDIT') viewer.setTowerEditMode(Boolean(event.data?.active));
  if (type === 'BANK73_VIEWER_SELECT_TOWER') viewer.selectTowerById(event.data?.towerId);
  if (type === 'BANK73_VIEWER_TOWER_UPDATED' && event.data?.tower) {
    viewer.updateTower(event.data.tower);
    const option = [...ui.tower.options].find(item => item.value === event.data.tower.towerId);
    if (option) option.textContent = event.data.tower.name || `Torre ${event.data.tower.towerId}`;
  }
  if (type === 'BANK73_VIEWER_REFRESH') window.location.reload();
});
if (embedMode) {
  window.parent.postMessage({
    type: 'BANK73_VIEWER_READY',
    towers: project.towers.map(tower => ({
      towerId: tower.id,
      name: tower.name,
      editable: tower.editable === true
    }))
  }, window.location.origin);
}

// Deep link opcional, útil para futuras integraciones con identificadores externos.
const initialInteriorUnit = new URLSearchParams(window.location.search).get('interior');
if (initialInteriorUnit && viewer.units.has(initialInteriorUnit)) {
  viewer.selectUnit(viewer.units.get(initialInteriorUnit));
  viewer.enterInterior();
}
