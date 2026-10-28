'use strict';

const { numberValue } = require('./executiveSummaryExcel');

function amount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function movementLabel(entry = {}) {
  if (entry.entryType === 'interest_payment') return 'Interés pagado';
  if (entry.entryType === 'manual_amortization') return 'Amortización manual';
  if (entry.entryType === 'sale_amortization') return 'Amortización por venta';
  if (entry.entryType === 'disbursement') return 'Desembolso';
  return 'Histórico';
}

function fundingLabel(value) {
  if (value === 'promoter') return 'Promotor';
  if (value === 'mixed') return 'Mixto';
  return value ? 'Banco' : '—';
}

function movementStatus(entry = {}) {
  if (entry.entryType === 'interest_payment') return 'Pagado';
  if (entry.entryType === 'sale_amortization' || entry.paymentStatus === 'automatic') return 'Automática';
  if (entry.workflowStatus === 'requested') return 'Solicitado';
  if (entry.workflowStatus === 'returned') return 'Devuelto';
  if (entry.workflowStatus === 'prepared') return 'Preparado';
  if (entry.paymentStatus === 'pending') return 'Pendiente';
  if (entry.entryType === 'manual_amortization') return 'Registrada';
  return 'Desembolsado';
}

function entryDate(entry = {}) {
  return entry.movementDate || entry.disbursementDate || entry.disbursedAt || entry.requestedAt || entry.createdAt || null;
}

function phaseNameForLine(line, phaseById, firstPhaseName) {
  return line.phaseName || phaseById.get(String(line.phaseId || '')) || firstPhaseName || 'Sin fase';
}

function buildExecutiveMovementRows(financeDocument = {}) {
  const phases = Array.isArray(financeDocument?.phases) ? financeDocument.phases : [];
  const phaseById = new Map(phases.map((phase, index) => [String(phase?._id || ''), phase?.name || `Fase ${index + 1}`]));
  const firstPhaseName = phases[0]?.name || 'Fase 1';
  const lines = Array.isArray(financeDocument?.loanLines) ? financeDocument.loanLines : [];
  const lineById = new Map(lines.map(line => [String(line?._id || ''), line]));
  const rows = [];

  lines.forEach((line, lineIndex) => {
    const lineName = line?.name || `Línea ${lineIndex + 1}`;
    const phaseName = phaseNameForLine(line, phaseById, firstPhaseName);
    const sourceEntries = Array.isArray(line?.entries) && line.entries.length
      ? line.entries
      : [line].filter(item => entryDate(item) || amount(item.disbursementAmount) || amount(item.amortizedAmount) || String(item.notes || '').trim());

    sourceEntries.forEach(entry => {
      const isDisbursement = entry.entryType === 'disbursement' || entry.entryType === 'legacy' || !entry.entryType;
      const isPending = isDisbursement && entry.paymentStatus === 'pending';
      const bank = isDisbursement && !isPending && ['bank', 'mixed'].includes(entry.fundingParty || 'bank')
        ? amount(entry.disbursementAmount) : 0;
      const promoter = isDisbursement && !isPending
        ? (entry.fundingParty === 'promoter' ? amount(entry.disbursementAmount) : amount(entry.promoterContributionAmount))
        : 0;
      const pending = isPending ? amount(entry.disbursementAmount) : 0;
      const amortized = amount(entry.amortizedAmount);
      const interest = amount(entry.interestAmount);
      rows.push({
        'Fase': phaseName,
        'Línea': lineName,
        'Importe aprobado': amount(line.approvedAmount),
        'Cuenta avance': entry.advanceAccountNumber || null,
        'Tipo': movementLabel(entry),
        'Aportante': fundingLabel(entry.fundingParty),
        'Fecha': entryDate(entry) ? new Date(entryDate(entry)) : null,
        'Nº préstamo': entry.loanNumber || '',
        'Desembolso banco': bank,
        'Aporte promotor': promoter,
        'Importe pendiente': pending,
        'Amortización': amortized,
        'Interés pagado': interest,
        'Pago al banco': amortized + interest,
        'Vencimiento': entry.maturityDate ? new Date(entry.maturityDate) : null,
        'Estado': movementStatus(entry),
        'Solicitud': entry.requestedAt ? new Date(entry.requestedAt) : null,
        'Confirmado por': entry.disbursedByRole || entry.requirementsConfirmedByRole || '',
        'Referencia': entry.transferReference || '',
        'Informe avalúo': entry.inspectionId ? String(entry.inspectionId) : '',
        'Detalle / unidad': '',
        'Notas': entry.notes || entry.workflowNote || ''
      });
    });
  });

  for (const unit of (financeDocument?.unitAmortizations || [])) {
    for (const allocation of (unit?.allocations || [])) {
      const line = lineById.get(String(allocation?.loanLineId || '')) || {};
      const allocated = amount(allocation?.amount);
      rows.push({
        'Fase': phaseNameForLine(line, phaseById, firstPhaseName),
        'Línea': allocation?.loanLineName || line?.name || 'Línea no indicada',
        'Importe aprobado': amount(line?.approvedAmount),
        'Cuenta avance': null,
        'Tipo': 'Amortización por venta',
        'Aportante': 'Cliente',
        'Fecha': unit?.checkDate ? new Date(unit.checkDate) : null,
        'Nº préstamo': '',
        'Desembolso banco': 0,
        'Aporte promotor': 0,
        'Importe pendiente': 0,
        'Amortización': allocated,
        'Interés pagado': 0,
        'Pago al banco': allocated,
        'Vencimiento': null,
        'Estado': 'Automática',
        'Solicitud': null,
        'Confirmado por': '',
        'Referencia': unit?.checkNumber || '',
        'Informe avalúo': '',
        'Detalle / unidad': [unit?.lot, unit?.clientName].filter(Boolean).join(' · '),
        'Notas': unit?.notes || ''
      });
    }
  }

  return rows.sort((left, right) => {
    const leftTime = left.Fecha instanceof Date ? left.Fecha.getTime() : 0;
    const rightTime = right.Fecha instanceof Date ? right.Fecha.getTime() : 0;
    return leftTime - rightTime;
  });
}

function chartStyle(title) {
  const key = normalize(title);
  if (/mensual|temporal|evolucion|avance/.test(key)) return { type: 'line', horizontal: false };
  if (/tipo de empresa|perfil laboral|sexo|modalidad|composicion/.test(key)) return { type: 'doughnut', horizontal: false };
  return { type: 'bar', horizontal: /banco|modelo|estatus|permiso|captacion|linea/.test(key) };
}

function tableValue(title, value) {
  const key = normalize(title);
  const text = String(value || '');
  if (key === 'hipotecas por banco' || key === 'firma de protocolo por banco') {
    const leading = /^\s*([\d.,]+)/.exec(text);
    return leading ? amount(leading[1].replace(/,/g, '')) : 0;
  }
  return numberValue(value);
}

function chartGroupFromTable(section, title, table) {
  if (!table?.rows?.length) return null;
  const style = chartStyle(title);
  const values = table.rows.map(row => tableValue(title, row.value));
  const money = table.rows.some(row => /B\/\./.test(String(row.value || '')));
  return {
    section,
    title,
    ...style,
    numberFormat: money ? '#,##0.00' : '#,##0',
    categories: table.rows.map(row => String(row.label || 'N/D')),
    series: [{ name: money ? 'Monto' : 'Cantidad', values, numberFormat: money ? '#,##0.00' : '#,##0' }]
  };
}

function sumItems(items) {
  return (items || []).reduce((total, item) => total + amount(item?.amount), 0);
}

function groupMovement(rows, field) {
  return [...new Set(rows.map(row => String(row[field] || 'Sin dato')).filter(Boolean))];
}

function buildExecutiveFinancialChartGroups(financeDocument = {}, movementRows = []) {
  const phases = Array.isArray(financeDocument?.phases) ? financeDocument.phases : [];
  const lines = Array.isArray(financeDocument?.loanLines) ? financeDocument.loanLines : [];
  const groups = [];
  const phaseNames = groupMovement(movementRows, 'Fase');
  const lineNames = groupMovement(movementRows, 'Línea');
  const movementTypes = groupMovement(movementRows, 'Tipo');

  if (movementTypes.length) groups.push({
    section: 'Resumen Financiero', title: 'Movimientos por tipo', type: 'bar', horizontal: true,
    categories: movementTypes,
    series: [{ name: 'Pago al banco', values: movementTypes.map(type => movementRows.filter(row => row.Tipo === type).reduce((s, row) => s + amount(row['Pago al banco']), 0)), numberFormat: '#,##0.00' }],
    numberFormat: '#,##0.00'
  });
  if (phaseNames.length) groups.push({
    section: 'Resumen Financiero', title: 'Flujos bancarios por fase', type: 'bar',
    categories: phaseNames,
    series: [
      { name: 'Desembolsos', values: phaseNames.map(name => movementRows.filter(row => row.Fase === name).reduce((s, row) => s + amount(row['Desembolso banco']), 0)) },
      { name: 'Amortizaciones', values: phaseNames.map(name => movementRows.filter(row => row.Fase === name).reduce((s, row) => s + amount(row['Amortización']), 0)) },
      { name: 'Intereses', values: phaseNames.map(name => movementRows.filter(row => row.Fase === name).reduce((s, row) => s + amount(row['Interés pagado']), 0)) }
    ], numberFormat: '#,##0.00'
  });
  if (lineNames.length) groups.push({
    section: 'Resumen Financiero', title: 'Flujos bancarios por línea', type: 'bar', horizontal: true,
    categories: lineNames,
    series: [
      { name: 'Desembolsos', values: lineNames.map(name => movementRows.filter(row => row.Línea === name).reduce((s, row) => s + amount(row['Desembolso banco']), 0)) },
      { name: 'Amortizaciones', values: lineNames.map(name => movementRows.filter(row => row.Línea === name).reduce((s, row) => s + amount(row['Amortización']), 0)) },
      { name: 'Intereses', values: lineNames.map(name => movementRows.filter(row => row.Línea === name).reduce((s, row) => s + amount(row['Interés pagado']), 0)) }
    ], numberFormat: '#,##0.00'
  });
  if (phases.length) groups.push({
    section: 'Resumen Financiero', title: 'Usos por fase: estimación vs realidad', type: 'bar',
    categories: phases.map((phase, index) => phase?.name || `Fase ${index + 1}`),
    series: [
      { name: 'Estimación', values: phases.map(phase => sumItems(phase?.planUses)) },
      { name: 'Realidad', values: phases.map(phase => sumItems(phase?.uses)) }
    ], numberFormat: '#,##0.00'
  });
  if (lines.length) groups.push({
    section: 'Resumen Financiero', title: 'Líneas de crédito: aprobado vs desembolsado', type: 'bar', horizontal: true,
    categories: lines.map((line, index) => line?.name || `Línea ${index + 1}`),
    series: [
      { name: 'Aprobado', values: lines.map(line => amount(line?.approvedAmount)) },
      { name: 'Desembolsado', values: lines.map(line => (line?.entries || []).reduce((s, entry) => s + (entry?.paymentStatus === 'pending' ? 0 : amount(entry?.disbursementAmount)), 0)) }
    ], numberFormat: '#,##0.00'
  });
  phases.forEach((phase, phaseIndex) => {
    const phaseName = phase?.name || `Fase ${phaseIndex + 1}`;
    [['Estimación', phase?.planUses], ['Realidad', phase?.uses]].forEach(([variant, items]) => {
      const useful = (items || []).filter(item => amount(item?.amount) > 0);
      if (!useful.length) return;
      groups.push({
        section: 'Resumen Financiero', title: `Composición de usos - ${phaseName} - ${variant}`, type: 'doughnut',
        categories: useful.map(item => item?.name || 'Sin nombre'),
        series: [{ name: variant, values: useful.map(item => amount(item?.amount)), numberFormat: '#,##0.00' }],
        numberFormat: '#,##0.00'
      });
    });
  });
  return groups;
}

module.exports = {
  buildExecutiveMovementRows,
  buildExecutiveFinancialChartGroups,
  chartGroupFromTable
};
