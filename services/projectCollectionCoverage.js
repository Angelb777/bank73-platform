'use strict';

const { customerPaymentSummary } = require('./customerPayments');

const number = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const money = value => Math.round((number(value) + Number.EPSILON) * 100) / 100;

function hasDate(value) {
  if (!value) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function salePaymentPaid(venta = {}) {
  const account = customerPaymentSummary(venta).accounts
    .find(item => item.source === 'sale_gap');
  return money(account?.summary?.paid);
}

function bankDisbursementReceived(venta = {}) {
  if (!hasDate(venta.fechaDesembolso) && !hasDate(venta.fechaRecibidoCheque)) return 0;
  return money(venta.montoFinanciamientoCPP || venta.valor);
}

function unitCollectionBalance(venta = {}) {
  const salePrice = money(venta.precioVenta);
  const customerPaid = Math.min(salePrice, salePaymentPaid(venta));
  const bankReceived = Math.min(
    Math.max(0, salePrice - customerPaid),
    bankDisbursementReceived(venta)
  );
  const collected = money(customerPaid + bankReceived);
  return {
    salePrice,
    customerPaid,
    bankReceived,
    collected,
    balance: money(Math.max(0, salePrice - collected))
  };
}

function coverageBucket(status = '') {
  const key = String(status || '').toLowerCase();
  if (['disponible', 'inventario'].includes(key)) return 'available';
  if (key === 'reservado') return 'reserved';
  if (['con_cpp', 'tramite_legal_activado', 'escriturado_traspasado', 'vivienda_entregada'].includes(key)) {
    return 'pipeline';
  }
  return key === 'cancelado' ? 'excluded' : 'other';
}

function buildProjectCollectionCoverage({ units = [], salesByUnit = new Map(), totalDebt = 0, getStatus }) {
  const buckets = {
    available: { label: 'Lotes libres / inventario', amount: 0, units: 0 },
    reserved: { label: 'Reservadas', amount: 0, units: 0 },
    pipeline: { label: 'CPP / trámite / traspaso pendiente', amount: 0, units: 0 },
    other: { label: 'Otras unidades pendientes', amount: 0, units: 0 }
  };
  let missingPriceUnits = 0;
  let fullyCollectedUnits = 0;

  for (const unit of units || []) {
    const venta = salesByUnit.get(String(unit?._id || unit?.unitId || '')) || {};
    const status = typeof getStatus === 'function' ? getStatus(unit, venta) : unit?.estado;
    const bucketKey = coverageBucket(status);
    if (bucketKey === 'excluded') continue;

    const balance = unitCollectionBalance(venta);
    if (balance.salePrice <= 0) {
      missingPriceUnits++;
      continue;
    }
    if (balance.balance <= 0.01) {
      fullyCollectedUnits++;
      continue;
    }

    buckets[bucketKey].amount = money(buckets[bucketKey].amount + balance.balance);
    buckets[bucketKey].units++;
  }

  const debt = money(Math.max(0, totalDebt));
  const totalReceivable = money(Object.values(buckets).reduce((sum, bucket) => sum + bucket.amount, 0));
  const difference = money(totalReceivable - debt);
  const coveragePct = debt > 0 ? Math.round((totalReceivable / debt) * 10000) / 100 : 0;

  return {
    totalDebt: debt,
    totalReceivable,
    difference,
    coveragePct,
    canCoverDebt: debt <= 0 || totalReceivable >= debt,
    outstandingUnits: Object.values(buckets).reduce((sum, bucket) => sum + bucket.units, 0),
    fullyCollectedUnits,
    missingPriceUnits,
    buckets
  };
}

module.exports = {
  bankDisbursementReceived,
  buildProjectCollectionCoverage,
  salePaymentPaid,
  unitCollectionBalance
};
