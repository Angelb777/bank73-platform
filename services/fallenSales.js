'use strict';

const FallenSale = require('../models/FallenSale');

function joinName(parts = []) {
  return parts.map(value => String(value || '').trim()).filter(Boolean).join(' ');
}

function primaryClientName(venta = {}) {
  return String(venta.clienteNombre || '').trim() || joinName([
    venta.primerNombre,
    venta.segundoNombre,
    venta.primerApellido,
    venta.segundoApellido,
    venta.apellidoCasada
  ]);
}

function secondaryClientName(venta = {}) {
  return joinName([
    venta.cliente2PrimerNombre,
    venta.cliente2SegundoNombre,
    venta.cliente2PrimerApellido,
    venta.cliente2SegundoApellido,
    venta.cliente2ApellidoCasada
  ]);
}

function unitLabel(unit = {}, venta = {}) {
  const manzana = String(unit.manzana || venta.manzana || '').trim();
  const lote = String(unit.lote || venta.lote || '').trim();
  if (manzana && lote) return `${manzana}-${lote}`;
  return lote || manzana || String(unit.code || '').trim();
}

function snapshotFromSale({ tenantKey, projectId, venta = {}, unit = {}, fechaCaida = new Date(), motivoCaida, createdBy }) {
  return {
    tenantKey,
    projectId,
    unitId: unit._id || venta.unitId || null,
    sourceVentaId: venta._id || null,
    unidadLabel: unitLabel(unit, venta),
    manzana: String(unit.manzana || venta.manzana || '').trim(),
    lote: String(unit.lote || venta.lote || '').trim(),
    modelo: String(unit.modelo || '').trim(),
    clienteNombre: primaryClientName(venta),
    cedula: String(venta.cedula || '').trim(),
    celular: String(venta.celular || '').trim(),
    correo: String(venta.correo || '').trim(),
    cliente2Nombre: secondaryClientName(venta),
    cliente2Cedula: String(venta.cliente2Cedula || '').trim(),
    fechaCaida,
    motivoCaida: String(motivoCaida || venta.motivoCaida || 'Desistimiento del cliente').trim(),
    observaciones: String(venta.observacionCliente || '').trim(),
    precioVenta: Math.max(0, Number(venta.precioVenta || venta.valor || 0)),
    banco: String(venta.banco || '').trim(),
    origen: 'automatico',
    createdBy: createdBy || null
  };
}

async function recordAutomaticFallenSale(input, { reuseExisting = false } = {}) {
  const snapshot = snapshotFromSale(input);
  if (!snapshot.sourceVentaId) return null;
  if (reuseExisting) {
    const existing = await FallenSale.findOne({
      tenantKey: snapshot.tenantKey,
      sourceVentaId: snapshot.sourceVentaId
    }).sort({ fechaCaida: -1 });
    if (existing) return existing;
  }
  return FallenSale.create(snapshot);
}

module.exports = {
  primaryClientName,
  secondaryClientName,
  snapshotFromSale,
  recordAutomaticFallenSale
};
