const money = value => Math.max(0, Number(value) || 0);
const sumAmounts = items => (items || []).reduce((sum, item) => sum + money(item?.amount), 0);
const normalizedSource = value => String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function financingMetrics(project = {}, finance = {}) {
  const conditions = project.financialConditions || {};
  const phases = Array.isArray(finance?.phases) && finance.phases.length ? finance.phases : (project.financePhases || []);
  const phaseTotal = phases.reduce((sum, phase) => sum + money(phase?.financialConditions?.phaseTotal || sumAmounts(phase?.planUses)), 0);
  const totalCost = money(conditions.projectTotal) || phaseTotal;
  const requestedByPhases = phases.reduce((sum, phase) => {
    const phaseConditions = phase?.financialConditions || {};
    const bankSource = (phase?.planSources || []).find(source => normalizedSource(source?.name) === 'banco');
    const approvedLines = (phase?.financingLines || []).reduce((lineSum, line) => lineSum + money(line?.approvedAmount), 0);
    return sum + (money(phaseConditions.bankFinancedAmount) || money(bankSource?.amount) || approvedLines);
  }, 0);
  const requestedAmount = money(conditions.bankFinancedAmount) || requestedByPhases;
  const promoterByPhases = phases.reduce((sum, phase) => {
    const ownSource = (phase?.planSources || []).find(source => normalizedSource(source?.name) === 'promotor');
    return sum + (money(phase?.financialConditions?.promoterContribution) || money(ownSource?.amount));
  }, 0);
  const promoterContribution = money(conditions.promoterContribution) || promoterByPhases;
  const otherSources = phases.reduce((sum, phase) => sum + (phase?.planSources || []).reduce((sourceSum, source) => {
    const key = normalizedSource(source?.name);
    return sourceSum + (key && key !== 'banco' && key !== 'promotor' ? money(source?.amount) : 0);
  }, 0), 0);
  const approvedBankFinancing = phases.reduce((sum, phase) => sum + (phase?.financingLines || []).reduce((lineSum, line) => lineSum + money(line?.approvedAmount), 0), 0);
  const disbursedAmount = (finance?.loanLines || []).reduce((sum, line) => {
    const entries = Array.isArray(line?.entries) && line.entries.length ? line.entries : [line];
    return sum + entries.reduce((entrySum, entry) => entrySum + money(entry?.disbursementAmount), 0);
  }, 0);
  const alreadyFinanced = Math.min(totalCost || Infinity, promoterContribution + otherSources + Math.max(approvedBankFinancing, disbursedAmount));
  const pendingAmount = Math.max(0, totalCost - alreadyFinanced);
  const terms = Array.from(new Set([
    conditions.term,
    ...phases.flatMap(phase => (phase?.financingLines || []).map(line => line?.term))
  ].map(value => String(value || '').trim()).filter(Boolean)));
  return {
    totalCost, requestedAmount, promoterContribution, otherSources, approvedBankFinancing,
    disbursedAmount, alreadyFinanced: Number.isFinite(alreadyFinanced) ? alreadyFinanced : 0,
    pendingAmount, financedPct: totalCost ? Math.round(Math.min(100, alreadyFinanced / totalCost * 100) * 100) / 100 : 0,
    estimatedTerm: terms.join(' / '), phaseNames: phases.map(phase => phase?.name).filter(Boolean),
    purposeDescription: Array.from(new Set(phases.flatMap(phase => (phase?.planUses || []).map(use => use?.name)).filter(Boolean))).join(', ')
  };
}

function averageProjectSalePrice(project = {}, units = []) {
  const unitPrices = (units || []).map(unit => money(unit?.precioLista || unit?.price)).filter(value => value > 0);
  if (unitPrices.length) return unitPrices.reduce((sum, value) => sum + value, 0) / unitPrices.length;
  const weighted = (project.housingModels || []).reduce((acc, model) => {
    const price = money(model?.price);
    const count = Math.max(1, Number(model?.unitsCount) || 1);
    if (!price) return acc;
    return { total: acc.total + price * count, count: acc.count + count };
  }, { total: 0, count: 0 });
  return weighted.count ? weighted.total / weighted.count : 0;
}

module.exports = { financingMetrics, averageProjectSalePrice };
