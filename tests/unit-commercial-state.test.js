'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Unit = require('../models/Unit');
const Venta = require('../models/Venta');
const {
  deriveCommercialState,
  furthestState,
  syncUnitCommercialState
} = require('../services/unitCommercialState');

test('el estado automático avanza según los hitos comerciales fiables', () => {
  assert.equal(deriveCommercialState({}).estado, 'disponible');
  assert.equal(deriveCommercialState({ avanceConstruccionPct: 1 }).estado, 'inventario');
  assert.equal(deriveCommercialState({ fechaReserva: '2026-10-24' }).estado, 'reservado');
  assert.equal(deriveCommercialState({ clienteNombre: 'Ana', precioVenta: 180000 }).estado, 'disponible');
  assert.equal(deriveCommercialState({ numCPP: 'CPP-20' }).estado, 'disponible');
  assert.equal(deriveCommercialState({ estatusCPP: 'Aprobado' }).estado, 'disponible');
  assert.equal(deriveCommercialState({ estatusCPP: 'CPP recibida' }).estado, 'con_cpp');
  assert.equal(deriveCommercialState({ fechaValorCPP: '2026-11-03' }).estado, 'con_cpp');
  assert.equal(deriveCommercialState({ solicitudAvaluo: '2026-11-15' }).estado, 'tramite_legal_activado');
  assert.equal(deriveCommercialState({ fechaContratoCliente: '2026-11-03' }).estado, 'disponible');
  assert.equal(deriveCommercialState({ fechaInscripcion: '2027-01-10' }).estado, 'escriturado_traspasado');
  assert.equal(deriveCommercialState({ fechaEntregaVivienda: '2027-02-01' }).estado, 'disponible');
  assert.equal(deriveCommercialState({ avanceConstruccionPct: 25, fechaReserva: '2026-10-24', fechaValorCPP: '2026-11-03', solicitudAvaluo: '2026-11-15' }).estado, 'tramite_legal_activado');
});

test('un avance automático ordinario nunca hace retroceder el estado', () => {
  assert.equal(furthestState('con_cpp', 'reservado'), 'con_cpp');
  assert.equal(furthestState('reservado', 'con_cpp'), 'con_cpp');
  assert.equal(furthestState('tramite_legal_activado', 'disponible'), 'tramite_legal_activado');
});

test('un hito comercial fiable hace avanzar también una unidad manual', async () => {
  const originals = { findOne: Unit.findOne, findOneAndUpdate: Unit.findOneAndUpdate, ventaUpdateOne: Venta.updateOne };
  let writtenSet;
  try {
    Unit.findOne = () => ({
      lean: async () => ({
        _id: 'unit-1', estado: 'inventario', estadoModo: 'manual'
      })
    });
    Unit.findOneAndUpdate = async (_filter, update) => {
      writtenSet = update.$set;
      return { ...update.$set };
    };
    Venta.updateOne = async () => ({ modifiedCount: 1 });

    await syncUnitCommercialState({
      tenantKey: 'demo', projectId: 'project-1', unitId: 'unit-1',
      venta: { estatusCPP: 'CPP recibida' }
    });

    assert.equal(writtenSet.estadoAutomaticoSugerido, 'con_cpp');
    assert.equal(writtenSet.estado, 'con_cpp');
    assert.equal(writtenSet.estadoModo, 'automatico');
  } finally {
    Unit.findOne = originals.findOne;
    Unit.findOneAndUpdate = originals.findOneAndUpdate;
    Venta.updateOne = originals.ventaUpdateOne;
  }
});

test('el modo automático aplica el avance y permite recalcular al reactivarlo', async () => {
  const originals = {
    findOne: Unit.findOne,
    findOneAndUpdate: Unit.findOneAndUpdate,
    ventaUpdateOne: Venta.updateOne
  };
  const writes = [];
  try {
    Unit.findOne = () => ({
      lean: async () => ({
        _id: 'unit-2', estado: 'con_cpp', estadoModo: 'automatico',
        estadoAutomaticoBase: 'inventario'
      })
    });
    Unit.findOneAndUpdate = async (_filter, update) => {
      writes.push(update.$set);
      return { ...update.$set };
    };
    Venta.updateOne = async () => ({ modifiedCount: 1 });

    await syncUnitCommercialState({
      tenantKey: 'demo', projectId: 'project-1', unitId: 'unit-2',
      venta: { fechaReserva: '2026-10-24' }
    });
    await syncUnitCommercialState({
      tenantKey: 'demo', projectId: 'project-1', unitId: 'unit-2',
      venta: { fechaReserva: '2026-10-24' }, resetAutomatic: true
    });
    await syncUnitCommercialState({
      tenantKey: 'demo', projectId: 'project-1', unitId: 'unit-2', venta: {}
    });

    assert.equal(writes[0].estado, 'con_cpp');
    assert.equal(writes[1].estado, 'reservado');
    assert.equal(writes[2].estado, 'disponible');
  } finally {
    Unit.findOne = originals.findOne;
    Unit.findOneAndUpdate = originals.findOneAndUpdate;
    Venta.updateOne = originals.ventaUpdateOne;
  }
});

test('liberar una unidad limpia reactiva el modo automático y la siguiente reserva activa la venta', async () => {
  const originals = {
    findOne: Unit.findOne,
    findOneAndUpdate: Unit.findOneAndUpdate,
    ventaUpdateOne: Venta.updateOne
  };
  let currentUnit = {
    _id: 'unit-3', estado: 'inventario', estadoModo: 'manual',
    estadoAutomaticoBase: 'inventario'
  };
  let reactivatedVenta = false;
  try {
    Unit.findOne = () => ({ lean: async () => ({ ...currentUnit }) });
    Unit.findOneAndUpdate = async (_filter, update) => {
      currentUnit = { ...currentUnit, ...update.$set };
      return currentUnit;
    };
    Venta.updateOne = async () => { reactivatedVenta = true; };

    await syncUnitCommercialState({
      tenantKey: 'demo', projectId: 'project-1', unitId: 'unit-3', venta: { avanceConstruccionPct: 35 },
      activateAutomaticAtBase: true
    });
    assert.equal(currentUnit.estadoModo, 'automatico');
    assert.equal(currentUnit.estado, 'inventario');

    await syncUnitCommercialState({
      tenantKey: 'demo', projectId: 'project-1', unitId: 'unit-3',
      venta: { fechaReserva: '2026-10-24', estadoVenta: 'caida' }
    });
    assert.equal(currentUnit.estado, 'reservado');
    assert.equal(reactivatedVenta, true);
  } finally {
    Unit.findOne = originals.findOne;
    Unit.findOneAndUpdate = originals.findOneAndUpdate;
    Venta.updateOne = originals.ventaUpdateOne;
  }
});

test('una fecha de CPP normaliza el selector a CPP recibida', async () => {
  const originals = {
    findOne: Unit.findOne,
    findOneAndUpdate: Unit.findOneAndUpdate,
    ventaUpdateOne: Venta.updateOne
  };
  let ventaUpdate;
  try {
    Unit.findOne = () => ({ lean: async () => ({ _id:'unit-4', estado:'reservado', estadoModo:'automatico' }) });
    Unit.findOneAndUpdate = async (_filter, update) => update.$set;
    Venta.updateOne = async (_filter, update) => { ventaUpdate = update.$set; return { modifiedCount:1 }; };

    const result = await syncUnitCommercialState({
      tenantKey:'demo', projectId:'project-1', unitId:'unit-4',
      venta:{ fechaValorCPP:'2026-11-05', estatusCPP:'Aprobado' }
    });

    assert.equal(ventaUpdate.estatusCPP, 'CPP recibida');
    assert.equal(result.estado, 'con_cpp');
  } finally {
    Unit.findOne = originals.findOne;
    Unit.findOneAndUpdate = originals.findOneAndUpdate;
    Venta.updateOne = originals.ventaUpdateOne;
  }
});

test('la ficha distingue el cambio manual del autoguardado normal', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'project.js'), 'utf8');

  assert.match(source, /fichaEstadoControl = 'manual'/);
  assert.match(source, /estadoControl: 'automatico'/);
  assert.match(source, /Volver a automático/);
  assert.doesNotMatch(source, /\n\s*estado:\s*vVal\('fu-estado'\),/);
});
