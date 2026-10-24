'use strict';

const Unit = require('../models/Unit');
const Venta = require('../models/Venta');

const AUTOMATIC_STATES = [
  'disponible',
  'inventario',
  'reservado',
  'con_cpp',
  'tramite_legal_activado',
  'escriturado_traspasado'
];

const STATE_RANK = new Map(AUTOMATIC_STATES.map((state, index) => [state, index]));

function hasText(value) {
  return String(value ?? '').trim().length > 0;
}

function hasDate(value) {
  if (!value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function isPositive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function isAffirmative(value) {
  if (value === true) return true;
  return /^(si|sí|s|yes|true|1|entregad[oa]|completad[oa])$/i.test(String(value || '').trim());
}

function deriveCommercialState(venta = {}, baseState = 'disponible') {
  const base = baseState === 'inventario' ? 'inventario' : 'disponible';

  if (
    hasDate(venta.fechaEntregaVivienda) ||
    isAffirmative(venta.entregaCasa) ||
    hasDate(venta.fechaInscripcion)
  ) {
    return {
      estado: 'escriturado_traspasado',
      motivo: hasDate(venta.fechaEntregaVivienda) || isAffirmative(venta.entregaCasa)
        ? 'Entrega de vivienda registrada'
        : 'Inscripción en Registro Público registrada'
    };
  }

  if (
    hasDate(venta.fechaActivacionTramite) ||
    hasDate(venta.fechaContratoCliente) ||
    venta.contratoFirmado === true ||
    hasText(venta.mPrestamo) ||
    hasDate(venta.fechaFirma) ||
    venta.protocoloFirmaCliente === true ||
    venta.protocoloFirmaPromotora === true ||
    venta.protocoloFirmaRLBancoInter === true ||
    venta.firmaProtocoloBancoCliente === true ||
    hasDate(venta.fechaIngresoRP) ||
    venta.ingresoRP === true ||
    hasDate(venta.fechaPagoImpuesto)
  ) {
    return { estado: 'tramite_legal_activado', motivo: 'Trámite contractual o legal iniciado' };
  }

  const cppStatus = String(venta.estatusCPP || '').trim();
  if (
    hasText(venta.numCPP) ||
    hasDate(venta.fechaValorCPP) ||
    hasDate(venta.recibidoCPP) ||
    /aprob|recibid|emitid/i.test(cppStatus)
  ) {
    return { estado: 'con_cpp', motivo: 'Carta Promesa de Pago registrada' };
  }

  const hasClient = [
    venta.clienteNombre,
    venta.primerNombre,
    venta.primerApellido,
    venta.cedula
  ].some(hasText);
  const hasReservationContext =
    hasDate(venta.fechaReserva) ||
    hasDate(venta.fechaProforma) ||
    isPositive(venta.precioVenta) ||
    isPositive(venta.montoContrato) ||
    hasText(cppStatus);

  if (hasDate(venta.fechaReserva) || (hasClient && hasReservationContext)) {
    return { estado: 'reservado', motivo: 'Datos de reserva y cliente registrados' };
  }

  return {
    estado: base,
    motivo: base === 'inventario'
      ? 'Sin avance comercial; permanece en inventario'
      : 'Sin avance comercial; permanece disponible'
  };
}

function furthestState(currentState, suggestedState) {
  const currentRank = STATE_RANK.get(currentState);
  const suggestedRank = STATE_RANK.get(suggestedState);
  if (currentRank == null) return suggestedState;
  if (suggestedRank == null) return currentState;
  return suggestedRank > currentRank ? suggestedState : currentState;
}

async function syncUnitCommercialState({
  tenantKey,
  projectId,
  unitId,
  venta,
  resetAutomatic = false,
  activateAutomaticAtBase = false
}) {
  const unit = await Unit.findOne({
    _id: unitId,
    tenantKey,
    projectId,
    deletedAt: null
  }).lean();
  if (!unit) return null;

  const commercialData = venta || await Venta.findOne({
    tenantKey,
    projectId,
    unitId,
    deletedAt: null
  }).lean() || {};

  const baseState = unit.estadoAutomaticoBase === 'inventario' ||
    (!unit.estadoAutomaticoBase && unit.estado === 'inventario')
    ? 'inventario'
    : 'disponible';
  const suggestion = deriveCommercialState(commercialData, baseState);
  const automaticResetFromManual = activateAutomaticAtBase &&
    ['disponible', 'inventario'].includes(unit.estado) &&
    ['disponible', 'inventario'].includes(suggestion.estado);
  const set = {
    estadoAutomaticoBase: baseState,
    estadoAutomaticoSugerido: suggestion.estado,
    estadoAutomaticoMotivo: suggestion.motivo,
    estadoAutomaticoActualizadoAt: new Date()
  };

  // Las unidades antiguas que no tienen modo guardado se consideran manuales.
  // Así una actualización de ficha nunca pisa silenciosamente su histórico.
  if (automaticResetFromManual) {
    set.estadoModo = 'automatico';
    set.estadoManualAt = null;
    set.estadoManualBy = null;
    set.estado = suggestion.estado;
    set.status = suggestion.estado.toUpperCase();
  } else if (unit.estadoModo === 'automatico') {
    const nextState = resetAutomatic
      ? suggestion.estado
      : ['disponible', 'inventario'].includes(suggestion.estado)
        ? suggestion.estado
        : furthestState(unit.estado, suggestion.estado);
    set.estado = nextState;
    set.status = nextState.toUpperCase();
  }

  const isAutomatic = automaticResetFromManual || unit.estadoModo === 'automatico';
  const returnedToBase =
    isAutomatic &&
    STATE_RANK.get(unit.estado) >= STATE_RANK.get('reservado') &&
    ['disponible', 'inventario'].includes(suggestion.estado);
  if (returnedToBase && commercialData.estadoVenta !== 'caida') {
    await Venta.updateOne(
      { tenantKey, projectId, unitId, deletedAt: null },
      {
        $set: {
          estadoVenta: 'caida',
          fechaCaida: new Date(),
          motivoCaida: 'Expediente comercial eliminado; unidad liberada'
        }
      }
    );
  } else if (
    isAutomatic &&
    STATE_RANK.get(suggestion.estado) >= STATE_RANK.get('reservado') &&
    commercialData.estadoVenta === 'caida'
  ) {
    await Venta.updateOne(
      { tenantKey, projectId, unitId, deletedAt: null, estadoVenta: 'caida' },
      { $set: { estadoVenta: 'activa', fechaCaida: null, motivoCaida: '' } }
    );
  }

  return Unit.findOneAndUpdate(
    { _id: unitId, tenantKey, projectId, deletedAt: null },
    { $set: set },
    { new: true }
  );
}

async function syncManyUnitCommercialStates({ tenantKey, projectId, unitIds }) {
  const ids = [...new Set((unitIds || []).map(String).filter(Boolean))];
  return Promise.all(ids.map(unitId => syncUnitCommercialState({ tenantKey, projectId, unitId })));
}

module.exports = {
  AUTOMATIC_STATES,
  deriveCommercialState,
  furthestState,
  syncUnitCommercialState,
  syncManyUnitCommercialStates
};
