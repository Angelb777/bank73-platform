'use strict';

// El visor no guarda negocio. Proyecta la ficha Comercial única:
// Unit contiene el activo; Venta contiene sus procesos comercial y técnico.
const COMMERCIAL_STATUS_BY_UNIT_STATUS = Object.freeze({
  disponible: 'available',
  inventario: 'inventory',
  reservado: 'reserved',
  con_cpp: 'cpp',
  tramite_legal_activado: 'sold',
  escriturado_traspasado: 'transferred',
  vivienda_entregada: 'delivered'
});

function positiveNumber(value) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function commercialStatus(status) {
  return COMMERCIAL_STATUS_BY_UNIT_STATUS[String(status || '').trim()] || 'unknown';
}

function progressStatusFromConstruction(venta = {}) {
  const normalized = String(venta.estatusConstruccion || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (['culmin', 'finaliz', 'complet', 'terminad'].some(value => normalized.includes(value))) return 'completed';
  if (normalized.includes('acabado')) return 'finishing';
  if (['obra gris', 'construccion', 'ejecucion'].some(value => normalized.includes(value))) return 'inProgress';
  if (['pendiente', 'no iniciad', 'proyectad'].some(value => normalized.includes(value))) return 'pending';
  if (venta.enConstruccion) return 'inProgress';
  return 'unknown';
}

function buildViewer3DUnitRecord({ unit = {}, venta = {}, project = {} }) {
  const listPrice = positiveNumber(unit.precioLista);
  const salePrice = positiveNumber(venta.precioVenta);
  const unitCost = positiveNumber(unit.costoUnidad);
  const margin = salePrice != null && unitCost != null ? salePrice - unitCost : null;
  const financeStatus = margin == null
    ? 'unknown'
    : margin > 0 ? 'onTrack' : margin === 0 ? 'attention' : 'deviation';
  const currency = project.currency || 'PAB';

  return {
    id: String(unit._id || ''),
    // Solo enlazan geometría; nunca sustituyen datos de la ficha Comercial.
    geometryKey: unit.viewer3D?.geometryKey || unit.lote || '',
    tower: unit.viewer3D?.tower || project.viewer3D?.primaryTower || '',
    level: unit.manzana || '',
    unitId: unit.lote || '',
    model: unit.modelo || '',
    bedrooms: positiveNumber(unit.recamaras),
    bathrooms: positiveNumber(unit.banos),
    closedArea: positiveNumber(unit.areaCerrada) ?? positiveNumber(unit.m2),
    openArea: positiveNumber(unit.areaAbierta),
    totalArea: positiveNumber(unit.areaTotalConstruccion) ?? positiveNumber(unit.m2),
    progress: {
      status: progressStatusFromConstruction(venta),
      percentage: null,
      phase: String(venta.faseConstruccion || '').trim(),
      label: String(venta.estatusConstruccion || '').trim()
    },
    finance: {
      status: financeStatus,
      budgetCost: unitCost,
      actualCost: null,
      variance: null,
      salePrice,
      collected: positiveNumber(venta.abonoCliente),
      estimatedMargin: margin,
      currency,
      dataKind: 'unit-record'
    },
    commercial: {
      status: commercialStatus(unit.estado),
      sourceStatus: unit.estado || '',
      askingPrice: listPrice,
      listPrice,
      salePrice,
      currency
    },
    sourceLabel: 'Ficha única de la unidad · Bank73'
  };
}

module.exports = {
  COMMERCIAL_STATUS_BY_UNIT_STATUS,
  buildViewer3DUnitRecord,
  commercialStatus,
  progressStatusFromConstruction
};
