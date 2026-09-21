'use strict';

const toNum = value => {
  if (value === '' || value === null || value === undefined) return 0;
  const number = Number(String(value).replace(/[, ]/g, ''));
  return Number.isFinite(number) ? number : 0;
};

const sumItems = (items = []) => items.reduce((sum, item) => sum + toNum(item?.amount), 0);

function financeApprovedTotals(doc = {}, project = {}) {
  const conditions = project.financialConditions || {};
  const phases = Array.isArray(doc.phases) && doc.phases.length
    ? doc.phases
    : (Array.isArray(project.financePhases) ? project.financePhases : []);
  const phaseBudget = phases.reduce((sum, phase) => sum + toNum(phase?.financialConditions?.phaseTotal || sumItems(phase?.planUses)), 0);
  const phaseBank = phases.reduce((sum, phase) => {
    const conditionsForPhase = phase?.financialConditions || {};
    const uses = toNum(conditionsForPhase.phaseTotal || sumItems(phase?.planUses));
    const source = (phase?.planSources || []).find(item => item?.name === 'Banco');
    const financingLines = (phase?.financingLines || []).reduce((acc, line) => acc + toNum(line?.approvedAmount), 0);
    const percentageAmount = toNum(conditionsForPhase.bankFinancedPct) > 0
      ? uses * toNum(conditionsForPhase.bankFinancedPct) / 100
      : 0;
    return sum + (toNum(conditionsForPhase.bankFinancedAmount) || toNum(source?.amount) || financingLines || percentageAmount);
  }, 0);
  const phasePromoter = phases.reduce((sum, phase) => {
    const conditionsForPhase = phase?.financialConditions || {};
    const uses = toNum(conditionsForPhase.phaseTotal || sumItems(phase?.planUses));
    const source = (phase?.planSources || []).find(item => item?.name === 'Promotor');
    const percentageAmount = toNum(conditionsForPhase.promoterContributionPct) > 0
      ? uses * toNum(conditionsForPhase.promoterContributionPct) / 100
      : 0;
    return sum + (toNum(conditionsForPhase.promoterContribution) || toNum(source?.amount) || percentageAmount);
  }, 0);

  const budgetApproved = toNum(conditions.projectTotal) || toNum(project.budgetApproved) || phaseBudget;
  const loanApproved = toNum(conditions.bankFinancedAmount) || toNum(project.loanApproved) || phaseBank;
  let promoterContribution = toNum(conditions.promoterContribution);
  if ((!promoterContribution || (phaseBank > 0 && !toNum(conditions.bankFinancedAmount) && promoterContribution === budgetApproved)) && budgetApproved > 0) {
    promoterContribution = phasePromoter || Math.max(0, budgetApproved - loanApproved);
  }
  return { budgetApproved, loanApproved, promoterContribution };
}

function loanEntryStatus(entry, today = new Date()) {
  const balance = Math.max(0, toNum(entry?.disbursementAmount) - toNum(entry?.amortizedAmount));
  if (balance <= 0) return 'Amortizado';
  if (!entry?.maturityDate) return 'Sin vencimiento';
  const maturity = new Date(entry.maturityDate);
  maturity.setHours(0, 0, 0, 0);
  const base = new Date(today);
  base.setHours(0, 0, 0, 0);
  const daysLeft = Math.ceil((maturity.getTime() - base.getTime()) / 86400000);
  if (daysLeft < 0) return 'Vencido';
  if (daysLeft <= 120) return 'Proximo a vencer';
  return 'OK';
}

function normalizeLoanEntry(raw = {}) {
  return {
    _id: raw._id,
    disbursementDate: raw.disbursementDate || null,
    loanNumber: String(raw.loanNumber || '').trim(),
    disbursementAmount: toNum(raw.disbursementAmount),
    maturityDate: raw.maturityDate || null,
    amortizedAmount: toNum(raw.amortizedAmount),
    notes: String(raw.notes || '').trim()
  };
}

function buildFinanceControlSummary(doc = {}, project = {}) {
  const loanLines = (doc.loanLines || []).map((line, index) => {
    const plain = line.toObject ? line.toObject() : line;
    const source = Array.isArray(plain.entries) && plain.entries.length ? plain.entries : [plain];
    const entries = source.map(entry => {
      const item = normalizeLoanEntry(entry);
      return {
        ...item,
        balance: Math.max(0, item.disbursementAmount - item.amortizedAmount),
        status: loanEntryStatus(item)
      };
    });
    const disbursementAmount = entries.reduce((sum, entry) => sum + entry.disbursementAmount, 0);
    const amortizedAmount = entries.reduce((sum, entry) => sum + entry.amortizedAmount, 0);
    let status = entries.some(entry => entry.status === 'Vencido') ? 'Vencido'
      : entries.some(entry => entry.status === 'Proximo a vencer') ? 'Proximo a vencer'
        : entries.some(entry => entry.status === 'Sin vencimiento') ? 'Sin vencimiento'
          : (disbursementAmount - amortizedAmount <= 0 ? 'Amortizado' : 'OK');
    return { ...plain, name: plain.name || `Linea ${index + 1}`, entries, disbursementAmount, amortizedAmount, balance: Math.max(0, disbursementAmount - amortizedAmount), status };
  });

  const unitAmortizations = (doc.unitAmortizations || []).map(item => {
    const plain = item.toObject ? item.toObject() : item;
    const allocations = Array.isArray(plain.allocations) ? plain.allocations : [];
    const allocationsTotal = allocations.reduce((sum, allocation) => sum + toNum(allocation.amount), 0);
    const legacyTotal = toNum(plain.amortizationLine1) + toNum(plain.amortizationLine2);
    const totalDistributed = (allocations.length ? allocationsTotal : legacyTotal) + toNum(plain.promoterAmount);
    return { ...plain, allocations, allocationsTotal, totalDistributed, difference: toNum(plain.checkAmount) - totalDistributed };
  });

  const allocationsByLine = new Map();
  for (const unit of unitAmortizations) {
    let allocations = unit.allocations || [];
    if (!allocations.length && (unit.amortizationLine1 || unit.amortizationLine2)) {
      allocations = [
        loanLines[0] ? { loanLineId: loanLines[0]._id, loanLineName: loanLines[0].name, amount: unit.amortizationLine1 } : null,
        loanLines[1] ? { loanLineId: loanLines[1]._id, loanLineName: loanLines[1].name, amount: unit.amortizationLine2 } : null
      ].filter(Boolean);
    }
    for (const allocation of allocations) {
      const key = String(allocation.loanLineId || allocation.loanLineName || '');
      if (key) allocationsByLine.set(key, toNum(allocationsByLine.get(key)) + toNum(allocation.amount));
    }
  }

  loanLines.forEach((line, index) => {
    const allocatedAmortized = [String(line._id || ''), line.name || `Linea ${index + 1}`]
      .reduce((sum, key) => sum + toNum(allocationsByLine.get(key)), 0);
    line.allocatedAmortized = allocatedAmortized;
    line.totalRecovered = toNum(line.amortizedAmount) + allocatedAmortized;
    line.balanceAfterSales = Math.max(0, toNum(line.disbursementAmount) - line.totalRecovered);
    if (line.balanceAfterSales <= 0) line.status = 'Amortizado';
  });

  const totalDisbursed = loanLines.reduce((sum, line) => sum + toNum(line.disbursementAmount), 0);
  const totalManualAmortized = loanLines.reduce((sum, line) => sum + toNum(line.amortizedAmount), 0);
  const totalAllocatedAmortized = loanLines.reduce((sum, line) => sum + toNum(line.allocatedAmortized), 0);
  const totalAmortized = totalManualAmortized + totalAllocatedAmortized;
  const approved = financeApprovedTotals(doc, project);
  const plan = typeof doc.phasesPlanAccumTotals === 'function' ? doc.phasesPlanAccumTotals() : { uses: sumItems((doc.phases || []).flatMap(phase => phase.planUses || [])) };
  const real = typeof doc.phasesAccumTotals === 'function' ? doc.phasesAccumTotals() : { uses: sumItems((doc.phases || []).flatMap(phase => phase.uses || [])) };

  return {
    loanLines,
    unitAmortizations,
    totals: {
      budgetApproved: approved.budgetApproved,
      loanApproved: approved.loanApproved,
      promoterContribution: approved.promoterContribution,
      totalDisbursed,
      availableToDisburse: approved.loanApproved - totalDisbursed,
      totalAmortized,
      totalManualAmortized,
      totalAllocatedAmortized,
      currentDebtBalance: totalDisbursed - totalAmortized,
      amortizationPct: totalDisbursed > 0 ? totalAmortized / totalDisbursed : 0,
      upcomingMaturities: loanLines.filter(line => line.status === 'Proximo a vencer').length,
      overdueMaturities: loanLines.filter(line => line.status === 'Vencido').length,
      checkAmountTotal: unitAmortizations.reduce((sum, unit) => sum + toNum(unit.checkAmount), 0),
      promoterTotal: unitAmortizations.reduce((sum, unit) => sum + toNum(unit.promoterAmount), 0),
      amortizationLine1Total: unitAmortizations.reduce((sum, unit) => sum + toNum(unit.amortizationLine1), 0),
      amortizationLine2Total: unitAmortizations.reduce((sum, unit) => sum + toNum(unit.amortizationLine2), 0),
      allocationsByLine: Object.fromEntries(allocationsByLine),
      planVsRealDifference: toNum(real.uses) - toNum(plan.uses)
    }
  };
}

function isSoldLike(status) {
  return ['reservado', 'con_cpp', 'tramite_legal_activado', 'escriturado_traspasado', 'vivienda_entregada']
    .includes(String(status || '').toLowerCase());
}

function buildFinanceControlAlerts(control, commercialUnits = [], now = new Date()) {
  const alerts = [];
  for (const line of control.loanLines || []) {
    for (const entry of line.entries || []) {
      if (!entry.maturityDate && toNum(entry.disbursementAmount) > 0) alerts.push({ type: 'missing_maturity', message: `${line.name}: desembolso sin fecha de vencimiento.` });
      if (entry.status === 'Proximo a vencer') {
        const due = new Date(entry.maturityDate); due.setHours(0, 0, 0, 0);
        const base = new Date(now); base.setHours(0, 0, 0, 0);
        const daysLeft = Math.ceil((due.getTime() - base.getTime()) / 86400000);
        alerts.push({ type: 'upcoming_maturity', message: `${line.name}: desembolso ${entry.loanNumber || ''} vence en ${daysLeft} dias.`, daysLeft, due: entry.maturityDate, lineName: line.name, loanNumber: entry.loanNumber || '' });
      }
      if (entry.status === 'Vencido') alerts.push({ type: 'overdue_maturity', message: `${line.name}: saldo pendiente vencido${entry.loanNumber ? ` (${entry.loanNumber})` : ''}.`, due: entry.maturityDate, lineName: line.name, loanNumber: entry.loanNumber || '' });
    }
  }
  for (const unit of control.unitAmortizations || []) {
    if (Math.abs(toNum(unit.difference)) > 0.01) alerts.push({ type: 'unit_unbalanced', message: `Unidad ${unit.lot || unit.clientName || ''}: descuadre entre cheque y distribucion.` });
  }
  const financeByUnit = new Set((control.unitAmortizations || []).map(unit => String(unit.unitId || '')).filter(Boolean));
  for (const unit of commercialUnits || []) {
    if (String(unit.clientName || '').trim() && isSoldLike(unit.commercialStatus) && !financeByUnit.has(String(unit.unitId))) alerts.push({ type: 'sold_without_finance', message: `Unidad ${unit.unitLabel}: vendida o con CPP sin informacion financiera.` });
  }
  if (toNum(control.totals.totalAmortized) > toNum(control.totals.totalDisbursed)) alerts.push({ type: 'over_amortized', message: 'La amortizacion total supera el monto desembolsado.' });
  if (toNum(control.totals.loanApproved) < toNum(control.totals.totalDisbursed)) alerts.push({ type: 'loan_exceeded', message: 'El loan aprobado es menor que el desembolsado total.' });
  return alerts;
}

module.exports = { toNum, financeApprovedTotals, buildFinanceControlSummary, buildFinanceControlAlerts };
