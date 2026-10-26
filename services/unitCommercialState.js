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

function deriveCommercialState(venta = {}, baseState = 'disponible') {
  if (hasDate(venta.fechaInscripcion)) {
    return {
      estado: 'escriturado_traspasado',
      motivo: 'Inscripción en Registro Público registrada'
    };
  }

  if (hasText(venta.solicitudAvaluo)) {
    return { estado: 'tramite_legal_activado', motivo: 'Solicitud de avalúo registrada' };
  }

  const cppStatus = String(venta.estatusCPP || '').trim();
  if (
    hasDate(venta.fechaValorCPP) ||
    hasDate(venta.recibidoCPP) ||
    /cpp\s*recibid|recibid[ao]?\s*(?:de\s*)?cpp/i.test(cppStatus)
  ) {
    return { estado: 'con_cpp', motivo: 'CPP recibida o fecha de CPP registrada' };
  }

  if (hasDate(venta.fechaReserva)) {
    return { estado: 'reservado', motivo: 'Fecha de reserva registrada' };
  }

  if (isPositive(venta.avanceConstruccionPct)) {
    return { estado: 'inventario', motivo: 'Construcción iniciada' };
  }

  return {
    estado: 'disponible',
    motivo: 'Sin construcción ni hitos comerciales; permanece como lote libre'
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

  let commercialData = venta || await Venta.findOne({
    tenantKey,
    projectId,
    unitId,
    deletedAt: null
  }).lean() || {};

  // Una fecha de CPP acredita que la carta ya fue recibida. Se normaliza el
  // selector para que la ficha, la exportación y el estado no se contradigan.
  if (hasDate(commercialData.fechaValorCPP) && !/cpp\s*recibid/i.test(String(commercialData.estatusCPP || ''))) {
    await Venta.updateOne(
      { tenantKey, projectId, unitId, deletedAt: null },
      { $set: { estatusCPP: 'CPP recibida' } }
    );
    commercialData = { ...commercialData, estatusCPP: 'CPP recibida' };
  }

  const baseState = isPositive(commercialData.avanceConstruccionPct) ? 'inventario' : 'disponible';
  const suggestion = deriveCommercialState(commercialData, baseState);
  const automaticResetFromManual = activateAutomaticAtBase &&
    ['disponible', 'inventario'].includes(unit.estado) &&
    ['disponible', 'inventario'].includes(suggestion.estado);
  const automaticAdvanceFromManual = unit.estadoModo !== 'automatico' &&
    (STATE_RANK.get(suggestion.estado) ?? -1) > (STATE_RANK.get(unit.estado) ?? -1);
  const set = {
    estadoAutomaticoBase: baseState,
    estadoAutomaticoSugerido: suggestion.estado,
    estadoAutomaticoMotivo: suggestion.motivo,
    estadoAutomaticoActualizadoAt: new Date()
  };

  // Un hito fiable puede hacer avanzar una unidad que estaba en modo manual;
  // nunca la hace retroceder. El modo automático sigue recalculando la base.
  if (automaticResetFromManual || automaticAdvanceFromManual) {
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

  const isAutomatic = automaticResetFromManual || automaticAdvanceFromManual || unit.estadoModo === 'automatico';
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
