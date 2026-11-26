'use strict';

const UNIT_STATUSES = Object.freeze([
  'disponible',
  'inventario',
  'reservado',
  'con_cpp',
  'tramite_legal_activado',
  'escriturado_traspasado',
  'vivienda_entregada',
  'cancelado'
]);

const SOLD_UNIT_STATUSES = Object.freeze([
  'reservado',
  'con_cpp',
  'tramite_legal_activado',
  'escriturado_traspasado',
  'vivienda_entregada'
]);

const UNIT_STATUS_ALIASES = Object.freeze({
  'lote libre': 'disponible',
  'con cpp': 'con_cpp',
  'tramite legal': 'tramite_legal_activado',
  'traspasado': 'escriturado_traspasado'
});

function normalizeUnitStatus(value, fallback = 'disponible') {
  const raw = String(value || '').trim().toLowerCase();
  const plain = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normalized = UNIT_STATUS_ALIASES[plain] || raw;
  return UNIT_STATUSES.includes(normalized) ? normalized : fallback;
}

function isSoldUnitStatus(value) {
  return SOLD_UNIT_STATUSES.includes(normalizeUnitStatus(value, ''));
}

module.exports = {
  UNIT_STATUSES,
  SOLD_UNIT_STATUSES,
  normalizeUnitStatus,
  isSoldUnitStatus
};
