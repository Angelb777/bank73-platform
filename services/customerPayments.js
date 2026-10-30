'use strict';

const number = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const money = value => Math.round((number(value) + Number.EPSILON) * 100) / 100;

function saleGap(venta = {}) {
  return money(Math.max(0, number(venta.precioVenta) - number(venta.montoFinanciamientoCPP || venta.valor)));
}

function effectiveCustomerPaymentAccounts(venta = {}) {
  const accounts = Array.isArray(venta.customerPaymentAccounts)
    ? venta.customerPaymentAccounts.map(account => ({ ...account }))
    : [];
  const gap = saleGap(venta);
  if (gap > 0 && !accounts.some(account => account.source === 'sale_gap')) {
    accounts.unshift({
      source: 'sale_gap',
      concept: 'Abono del cliente',
      agreedAmount: 0,
      recipient: 'promoter',
      requiredForClearance: true,
      payments: []
    });
  }
  return accounts;
}

function accountSummary(account = {}, venta = {}) {
  const agreed = account.source === 'sale_gap' ? saleGap(venta) : money(account.agreedAmount);
  const payments = Array.isArray(account.payments) ? account.payments : [];
  const paid = money(payments.reduce((sum, payment) => sum + number(payment.amount), 0));
  const balance = money(Math.max(0, agreed - paid));
  const overpaid = money(Math.max(0, paid - agreed));
  return {
    agreed,
    paid,
    balance,
    overpaid,
    status: agreed <= 0 ? 'not_applicable' : balance <= 0.01 ? 'paid' : paid > 0 ? 'partial' : 'pending'
  };
}

function customerPaymentSummary(venta = {}) {
  const accounts = effectiveCustomerPaymentAccounts(venta).map(account => ({
    ...account,
    summary: accountSummary(account, venta)
  }));
  const required = accounts.filter(account => account.requiredForClearance !== false && account.summary.agreed > 0);
  const totals = accounts.reduce((acc, account) => {
    acc.agreed = money(acc.agreed + account.summary.agreed);
    acc.paid = money(acc.paid + account.summary.paid);
    acc.balance = money(acc.balance + account.summary.balance);
    acc.overpaid = money(acc.overpaid + account.summary.overpaid);
    return acc;
  }, { agreed: 0, paid: 0, balance: 0, overpaid: 0 });
  const requiredPaid = money(required.reduce((sum, account) => sum + account.summary.paid, 0));
  const requiredBalance = money(required.reduce((sum, account) => sum + account.summary.balance, 0));
  const clearanceStatus = !required.length
    ? 'not_applicable'
    : requiredBalance <= 0.01
      ? 'completed'
      : requiredPaid > 0
        ? 'in_progress'
        : 'pending';
  return { accounts, totals, requiredBalance, clearanceStatus };
}

function customerPaymentRecipientTotals(venta = {}) {
  return effectiveCustomerPaymentAccounts(venta).reduce((totals, account) => {
    for (const payment of (account.payments || [])) {
      const recipient = payment.recipient || account.recipient || 'promoter';
      if (Object.hasOwn(totals, recipient)) totals[recipient] = money(totals[recipient] + number(payment.amount));
    }
    return totals;
  }, { bank: 0, promoter: 0, other: 0 });
}

module.exports = {
  accountSummary,
  customerPaymentRecipientTotals,
  customerPaymentSummary,
  effectiveCustomerPaymentAccounts,
  saleGap
};
