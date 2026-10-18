'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Project = require('../models/Project');
const Unit = require('../models/Unit');
const Venta = require('../models/Venta');
const ProjectFinance = require('../models/ProjectFinance');
const ProjectChecklist = require('../models/ProjectChecklist');

const PROJECT_ID = process.env.EL_PALMAR_PROJECT_ID || '6ad374d758346b3260b87fb3';
const EXPECTED_TENANT = 'bancodemo';
const DATA_VERSION = 'el-palmar-integrated-demo-v1';
const apply = process.argv.includes('--apply');

const roundMoney = value => Math.round((Number(value) || 0) * 100) / 100;
const sum = values => roundMoney(values.reduce((total, value) => total + Number(value || 0), 0));

function distribute(total, ratios) {
  let remaining = roundMoney(total);
  return ratios.map((ratio, index) => {
    const value = index === ratios.length - 1 ? remaining : roundMoney(total * ratio);
    remaining = roundMoney(remaining - value);
    return value;
  });
}

function unitMetrics(unit) {
  const price = Number(unit.precioLista || unit.price || 0);
  const numericId = Number(String(unit.lote || '').replace(/\D/g, '')) || 0;
  const varianceFactors = [0.97, 0.99, 1, 1.02, 1.04, 1.06];
  const budgetCost = roundMoney(price * 0.58);
  const actualCost = roundMoney(budgetCost * varianceFactors[numericId % varianceFactors.length]);
  const isClosing = unit.estado === 'con_cpp';
  return {
    tower: 'C',
    progressPct: isClosing ? 96 : 100,
    progressStatus: isClosing ? 'inProgress' : 'completed',
    constructionPhase: isClosing ? 'Acabados y entrega' : 'Finalizada',
    budgetCost,
    actualCost,
    dataKind: 'illustrative',
    sourceLabel: 'Dato Único oficial · costes ilustrativos Bank73'
  };
}

function modelSummary(units) {
  const groups = new Map();
  for (const unit of units) {
    const key = unit.modelo || 'Sin modelo';
    const group = groups.get(key) || { name: key, units: [], states: {} };
    group.units.push(unit);
    group.states[unit.estado] = (group.states[unit.estado] || 0) + 1;
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({
    name: group.name,
    bedrooms: Math.round(sum(group.units.map(unit => unit.recamaras)) / group.units.length) || 0,
    bathrooms: Math.round(sum(group.units.map(unit => unit.banos)) / group.units.length) || 0,
    openAreaM2: roundMoney(sum(group.units.map(unit => unit.areaAbierta)) / group.units.length),
    closedAreaM2: roundMoney(sum(group.units.map(unit => unit.areaCerrada || unit.m2)) / group.units.length),
    price: roundMoney(sum(group.units.map(unit => unit.precioLista)) / group.units.length),
    cost: roundMoney(sum(group.units.map(unit => unitMetrics(unit).budgetCost)) / group.units.length),
    unitsCount: group.units.length,
    initialStatuses: {
      disponible: group.states.disponible || 0,
      inventario: group.states.inventario || 0,
      reservado: group.states.reservado || 0,
      con_cpp: group.states.con_cpp || 0,
      tramite_legal_activado: group.states.tramite_legal_activado || 0,
      escriturado_traspasado: group.states.escriturado_traspasado || 0,
      vivienda_entregada: group.states.vivienda_entregada || 0,
      cancelado: group.states.cancelado || 0
    },
    observations: 'Inventario Torre C importado desde el Dato Único oficial.'
  }));
}

function financePlan(totalBudget, totalActual, soldValue) {
  const planTotals = distribute(totalBudget, [0.24, 0.46, 0.30]);
  const actualTotals = distribute(totalActual, [0.24, 0.46, 0.30]);
  const bankTotals = distribute(roundMoney(totalBudget * 0.56), [0.24, 0.46, 0.30]);
  const promoterTotals = planTotals.map((amount, index) => roundMoney(amount - bankTotals[index]));
  const presales = distribute(soldValue, [0.22, 0.43, 0.35]);
  const definitions = [
    { name: 'Fase 1 · Preconstrucción y estructura', start: '2023-01-01', end: '2023-12-31', completed: true, items: ['Diseño, estudios y permisos', 'Cimentación y estructura'] },
    { name: 'Fase 2 · Obra gris e instalaciones', start: '2024-01-01', end: '2024-12-31', completed: true, items: ['Obra gris', 'Instalaciones y fachadas'] },
    { name: 'Fase 3 · Acabados y entrega', start: '2025-01-01', end: '2026-12-31', completed: false, items: ['Acabados', 'Permisos, entrega y cierre'] }
  ];
  const phases = definitions.map((definition, index) => {
    const planUses = distribute(planTotals[index], [0.42, 0.58]).map((amount, itemIndex) => ({ name: definition.items[itemIndex], amount }));
    const uses = distribute(actualTotals[index], [0.42, 0.58]).map((amount, itemIndex) => ({ name: definition.items[itemIndex], amount }));
    const planSources = [
      { name: 'Banco', amount: bankTotals[index] },
      { name: 'Promotor', amount: promoterTotals[index] }
    ];
    const actualBank = roundMoney(Math.min(bankTotals[index] * 0.94, actualTotals[index] * 0.56));
    const sources = [
      { name: 'Banco', amount: actualBank },
      { name: 'Promotor', amount: roundMoney(actualTotals[index] - actualBank) }
    ];
    return {
      name: definition.name,
      startDate: new Date(definition.start),
      endDate: new Date(definition.end),
      actualStartDate: new Date(definition.start),
      actualEndDate: definition.completed ? new Date(definition.end) : null,
      isCompleted: definition.completed,
      completedAt: definition.completed ? new Date(definition.end) : null,
      uses,
      sources,
      planUses,
      planSources,
      financialConditions: {
        phaseTotal: planTotals[index],
        bankFinancedAmount: bankTotals[index],
        bankFinancedPct: 56,
        promoterContribution: promoterTotals[index],
        promoterContributionPct: 44,
        generalConditions: 'Escenario financiero ilustrativo para demostración del proyecto.',
        generalObservations: 'Costes estimados; inventario y precios proceden del Dato Único.'
      },
      financingLines: [{
        name: 'Línea bancaria ilustrativa',
        financierType: 'bank',
        concept: definition.name,
        approvedAmount: bankTotals[index],
        disbursedAmount: actualBank,
        amortizedAmount: roundMoney(actualBank * (index === 2 ? 0.35 : 0.78)),
        outstandingBalance: roundMoney(actualBank * (index === 2 ? 0.65 : 0.22)),
        observations: 'Escenario demostrativo Bank73.'
      }],
      disbExpected: bankTotals[index],
      disbActual: actualBank,
      disbActualAt: new Date(index === 2 ? '2026-09-30' : definition.end),
      interesesDevengados: roundMoney(actualBank * 0.035),
      aportesPropios: roundMoney(actualTotals[index] - actualBank),
      preventas: presales[index],
      alertDaysBefore: 30
    };
  });
  return { phases, bankApproved: sum(bankTotals), promoterContribution: sum(promoterTotals) };
}

function checklistState(phase, index) {
  const targets = {
    PREESTUDIOS: { completed: 7, inProgress: 0 },
    PERMISOS: { completed: 11, inProgress: 0 },
    FINANCIACION: { completed: 12, inProgress: 2 },
    CONTRATISTAS: { completed: 10, inProgress: 0 },
    OBRA: { completed: 6, inProgress: 1 },
    ESCRITURACION: { completed: 27, inProgress: 5 }
  };
  const target = targets[phase] || { completed: 0, inProgress: 0 };
  if (index < target.completed) return 'COMPLETADO';
  if (index < target.completed + target.inProgress) return 'EN_PROCESO';
  return 'PENDIENTE';
}

async function main() {
  if (!mongoose.Types.ObjectId.isValid(PROJECT_ID)) throw new Error('EL_PALMAR_PROJECT_ID inválido');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const project = await Project.findById(PROJECT_ID).lean();
  if (!project || project.tenantKey !== EXPECTED_TENANT || !/PALM/i.test(project.name || '')) {
    throw new Error('El proyecto no coincide exactamente con THE PALMS de bancodemo');
  }
  const [units, ventas, finance, checklists] = await Promise.all([
    Unit.find({ projectId: project._id, tenantKey: EXPECTED_TENANT, deletedAt: null }).sort({ manzana: 1, lote: 1 }).lean(),
    Venta.find({ projectId: project._id, tenantKey: EXPECTED_TENANT, deletedAt: null }).lean(),
    ProjectFinance.findOne({ project: project._id, tenantKey: EXPECTED_TENANT }).lean(),
    ProjectChecklist.find({ projectId: project._id, tenantKey: EXPECTED_TENANT }).sort({ phase: 1, level: 1, orderInLevel: 1 }).lean()
  ]);
  if (units.length !== 57) throw new Error(`Se esperaban 57 unidades y existen ${units.length}`);
  if (ventas.length !== 57) throw new Error(`Se esperaban 57 expedientes y existen ${ventas.length}`);

  const metrics = new Map(units.map(unit => [String(unit._id), unitMetrics(unit)]));
  const totalBudget = sum([...metrics.values()].map(item => item.budgetCost));
  const totalActual = sum([...metrics.values()].map(item => item.actualCost));
  const soldStates = new Set(['reservado', 'con_cpp', 'tramite_legal_activado', 'escriturado_traspasado', 'vivienda_entregada']);
  const soldUnits = units.filter(unit => soldStates.has(unit.estado));
  const soldValue = sum(soldUnits.map(unit => unit.precioLista));
  const plans = financePlan(totalBudget, totalActual, soldValue);
  const totalDisbursed = sum(plans.phases.map(phase => phase.disbActual));
  const totalAmortized = sum(plans.phases.flatMap(phase => phase.financingLines).map(line => line.amortizedAmount));

  const preview = {
    apply,
    project: { id: PROJECT_ID, name: project.name, tenantKey: project.tenantKey },
    inventory: { units: units.length, sold: soldUnits.length, available: units.length - soldUnits.length, salesValue: sum(units.map(unit => unit.precioLista)) },
    illustrativeFinance: { totalBudget, totalActual, bankApproved: plans.bankApproved, bankDisbursed: totalDisbursed, bankBalance: roundMoney(totalDisbursed - totalAmortized), phases: plans.phases.length },
    technicalFlow: Object.fromEntries([...new Set(checklists.map(item => item.phase))].map(phase => [phase, checklists.filter(item => item.phase === phase).length])),
    dataVersion: DATA_VERSION
  };
  console.log(JSON.stringify(preview, null, 2));
  if (!apply) return;

  const backupDir = path.join(__dirname, '..', 'outputs', 'el-palmar');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `integration-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({
    project: {
      viewer3D: project.viewer3D || null,
      technicalData: project.technicalData || null,
      financialConditions: project.financialConditions || null,
      financePhases: project.financePhases || [],
      housingModels: project.housingModels || [],
      kpis: {
        unitsTotal: project.unitsTotal,
        unitsSold: project.unitsSold,
        budgetApproved: project.budgetApproved,
        budgetSpent: project.budgetSpent,
        loanApproved: project.loanApproved,
        loanDisbursed: project.loanDisbursed,
        loanBalance: project.loanBalance
      }
    },
    finance: finance || null,
    units: units.map(unit => ({ _id: unit._id, viewer3D: unit.viewer3D || null, costoUnidad: unit.costoUnidad || 0, costoUnidadManual: Boolean(unit.costoUnidadManual) })),
    ventas: ventas.map(venta => ({ _id: venta._id, enConstruccion: venta.enConstruccion, estatusConstruccion: venta.estatusConstruccion, faseConstruccion: venta.faseConstruccion })),
    checklists: checklists.map(item => ({ _id: item._id, status: item.status, validated: item.validated, completedAt: item.completedAt, validatedAt: item.validatedAt, subtasks: item.subtasks }))
  }, null, 2));

  const unitOps = units.map(unit => ({
    updateOne: { filter: { _id: unit._id, projectId: project._id, tenantKey: EXPECTED_TENANT }, update: { $set: { viewer3D: metrics.get(String(unit._id)), costoUnidad: metrics.get(String(unit._id)).budgetCost, costoUnidadManual: false } } }
  }));
  await Unit.bulkWrite(unitOps);

  const ventaOps = ventas.map(venta => {
    const unit = units.find(item => String(item._id) === String(venta.unitId));
    const metric = metrics.get(String(venta.unitId));
    return {
      updateOne: {
        filter: { _id: venta._id, projectId: project._id, tenantKey: EXPECTED_TENANT },
        update: { $set: {
          enConstruccion: metric.progressPct < 100,
          estatusConstruccion: metric.progressPct < 100 ? 'Acabados finales' : 'Obra finalizada',
          faseConstruccion: metric.constructionPhase || (unit?.estado === 'con_cpp' ? 'Entrega' : 'Finalizada')
        } }
      }
    };
  });
  await Venta.bulkWrite(ventaOps);

  const grouped = new Map();
  checklists.forEach(item => {
    const list = grouped.get(item.phase) || [];
    list.push(item);
    grouped.set(item.phase, list);
  });
  const checklistOps = [];
  for (const [phase, items] of grouped) {
    items.forEach((item, index) => {
      const status = checklistState(phase, index);
      const subtasks = (item.subtasks || []).map((subtask, subtaskIndex, all) => ({
        ...subtask,
        completed: status === 'COMPLETADO' || (status === 'EN_PROCESO' && subtaskIndex < Math.max(1, Math.floor(all.length / 2)))
      }));
      checklistOps.push({
        updateOne: {
          filter: { _id: item._id, projectId: project._id, tenantKey: EXPECTED_TENANT },
          update: { $set: {
            status,
            validated: status === 'COMPLETADO',
            completedAt: status === 'COMPLETADO' ? new Date('2026-09-30') : null,
            validatedAt: status === 'COMPLETADO' ? new Date('2026-09-30') : null,
            updatedBy: 'Bank73 · integración 3D de ejemplo',
            subtasks
          } }
        }
      });
    });
  }
  if (checklistOps.length) await ProjectChecklist.bulkWrite(checklistOps);

  const financeTarget = await ProjectFinance.findOne({ project: project._id, tenantKey: EXPECTED_TENANT })
    || new ProjectFinance({ project: project._id, tenantKey: EXPECTED_TENANT });
  financeTarget.plan = { uses: [], sources: [] };
  financeTarget.phases = plans.phases;
  financeTarget.disbursements = { planned: [], actual: [] };
  financeTarget.unitAmortizations = [];
  financeTarget.loanLines = financeTarget.phases.map((phase, index) => {
    const line = phase.financingLines[0];
    return {
      phaseId: phase._id,
      phaseName: phase.name,
      sourceUseId: phase.planSources.find(item => item.name === 'Banco')?._id || null,
      approvedAmountMode: 'manual',
      name: `Línea ilustrativa · Fase ${index + 1}`,
      approvedAmount: line.approvedAmount,
      financierType: 'bank',
      concept: phase.name,
      entries: [{
        entryType: 'disbursement',
        paymentStatus: 'paid',
        workflowStatus: 'disbursed',
        advanceAccountNumber: index + 1,
        fundingParty: 'bank',
        movementDate: phase.disbActualAt,
        disbursementDate: phase.disbActualAt,
        disbursedAt: phase.disbActualAt,
        loanNumber: `DEMO-ELPALMAR-${index + 1}`,
        disbursementAmount: line.disbursedAmount,
        maturityDate: new Date('2027-12-31'),
        amortizedAmount: line.amortizedAmount,
        notes: 'Escenario financiero ilustrativo para la integración 3D.'
      }]
    };
  });
  await financeTarget.save();

  const projectFinancePhases = plans.phases.map(phase => ({
    name: phase.name,
    startDate: phase.startDate,
    endDate: phase.endDate,
    planUses: phase.planUses,
    planSources: phase.planSources,
    financialConditions: phase.financialConditions,
    financingLines: phase.financingLines,
    loanLineNames: ['Línea bancaria ilustrativa']
  }));
  await Project.updateOne(
    { _id: project._id, tenantKey: EXPECTED_TENANT },
    { $set: {
      currency: 'PAB',
      projectType: 'Residencial vertical PH',
      'technicalData.phasesCount': 3,
      'technicalData.totalUnits': units.length,
      'technicalData.notes': 'Torre C: 57 unidades según Dato Único oficial. El visor usa geometría simplificada; costes y avance se completan como escenario ilustrativo.',
      'technicalData.assessment.conceptualProject': true,
      'technicalData.assessment.preliminaryDesign': true,
      'technicalData.assessment.approvedPlans': true,
      'technicalData.assessment.executiveProject': true,
      'technicalData.assessment.constructionBudget': true,
      housingModels: modelSummary(units),
      financePhases: projectFinancePhases,
      financialConditions: {
        projectTotal: totalBudget,
        bankFinancedAmount: plans.bankApproved,
        bankFinancedPct: 56,
        promoterContribution: plans.promoterContribution,
        promoterContributionPct: 44,
        term: 'Escenario ilustrativo del proyecto',
        paymentMethod: 'Desembolsos por avance de obra',
        disbursementMethod: 'Contra avance técnico validado',
        disbursementConditions: 'Datos financieros de ejemplo para visualización integrada.',
        amortizationConditions: 'Amortización ilustrativa vinculada al cierre de unidades.',
        requiredPresales: 'Inventario comercial según Dato Único oficial.',
        guarantees: 'Sin información documental cargada; escenario de demostración.',
        insurance: 'Sin información documental cargada.',
        facilities: [],
        precedentConditions: {},
        operationStructure: {}
      },
      loanApproved: plans.bankApproved,
      loanDisbursed: totalDisbursed,
      loanBalance: roundMoney(totalDisbursed - totalAmortized),
      budgetApproved: totalBudget,
      budgetSpent: totalActual,
      unitsTotal: units.length,
      unitsSold: soldUnits.length,
      viewer3D: {
        enabled: true,
        modelKey: 'el-palmar',
        primaryTower: 'C',
        inventorySource: 'Dato Único oficial · Torre C',
        financialDataKind: 'illustrative',
        dataVersion: DATA_VERSION,
        note: 'Torre C enlazada con 57 unidades del Dato Único. Torres A/B son contexto volumétrico. Costes y avance: escenario ilustrativo Bank73.'
      }
    } }
  );

  console.log(JSON.stringify({ ok: true, backupPath, dataVersion: DATA_VERSION }, null, 2));
}

main()
  .catch(error => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
