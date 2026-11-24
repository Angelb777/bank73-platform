'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  normalizedStageName,
  isMeaningfulUnassignedName,
  phaseHasFinancialData,
  removeStageFinancialData,
  emptyPhaseForStage
} = require('../services/projectStages');

test('normaliza etapa, fase y torre como la misma identidad semantica', () => {
  assert.equal(normalizedStageName('Fase 1'), '1');
  assert.equal(normalizedStageName('Etapa 1'), '1');
  assert.equal(normalizedStageName('Torre 1'), '1');
  assert.equal(normalizedStageName('Etapa Norte'), 'norte');
  assert.equal(isMeaningfulUnassignedName('Sin carpeta'), false);
  assert.equal(isMeaningfulUnassignedName('Etapa 1'), true);
});

test('detecta si una etapa contiene datos financieros que no deben perderse', () => {
  assert.equal(phaseHasFinancialData({ planUses: [], requirements: [] }), false);
  assert.equal(phaseHasFinancialData({ planUses: [{ name: 'Obra', amount: 0 }] }), true);
  assert.equal(phaseHasFinancialData({ financialConditions: { requiredPresales: '50%' } }), true);
  assert.equal(phaseHasFinancialData({ disbActual: 100 }), true);
});

test('crea una fase financiera vacia enlazada a la identidad de la etapa', () => {
  const folder = { _id: new mongoose.Types.ObjectId(), name: 'Etapa 2' };
  const phase = emptyPhaseForStage(folder, new Date('2026-01-01T00:00:00Z'));
  assert.equal(String(phase.stageId), String(folder._id));
  assert.equal(phase.name, 'Etapa 2');
  assert.deepEqual(phase.planUses, []);
  assert.ok(phase.endDate > phase.startDate);
});

test('elimina en cascada los datos financieros de una etapa sin borrar amortizaciones de unidades', () => {
  const stageId = new mongoose.Types.ObjectId();
  const otherStageId = new mongoose.Types.ObjectId();
  const phaseId = new mongoose.Types.ObjectId();
  const otherPhaseId = new mongoose.Types.ObjectId();
  const lineId = new mongoose.Types.ObjectId();
  const otherLineId = new mongoose.Types.ObjectId();
  const requirementId = new mongoose.Types.ObjectId();
  const legacyRequirementId = new mongoose.Types.ObjectId();
  const requestDocumentId = new mongoose.Types.ObjectId();
  const legacyLineId = new mongoose.Types.ObjectId();
  const finance = {
    phases: [
      { _id: phaseId, stageId, name: 'Fase 1', requirements: [{ _id: requirementId, legacyRequirementIds: [legacyRequirementId] }] },
      { _id: otherPhaseId, stageId: otherStageId, name: 'Fase 2', requirements: [] }
    ],
    loanLines: [
      { _id: lineId, phaseId, entries: [{ requestDocumentId }, {}] },
      { _id: legacyLineId, phaseId: null, entries: [] },
      { _id: otherLineId, phaseId: otherPhaseId, entries: [] }
    ],
    unitAmortizations: [{
      unitId: new mongoose.Types.ObjectId(),
      allocations: [
        { loanLineId: lineId, amount: 100 },
        { loanLineId: otherLineId, amount: 200 }
      ]
    }]
  };

  const result = removeStageFinancialData(finance, stageId);

  assert.equal(result.removedPhases, 1);
  assert.equal(result.removedLoanLines, 2);
  assert.equal(result.removedLoanEntries, 2);
  assert.equal(result.removedAllocations, 1);
  assert.deepEqual(result.removedRequirementIds, [String(requirementId), String(legacyRequirementId)]);
  assert.deepEqual(result.removedRequestDocumentIds, [String(requestDocumentId)]);
  assert.deepEqual(finance.phases.map(item => String(item._id)), [String(otherPhaseId)]);
  assert.deepEqual(finance.loanLines.map(item => String(item._id)), [String(otherLineId)]);
  assert.equal(finance.unitAmortizations.length, 1);
  assert.deepEqual(finance.unitAmortizations[0].allocations.map(item => String(item.loanLineId)), [String(otherLineId)]);
});
