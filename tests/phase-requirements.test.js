const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REQUIREMENT_TITLES,
  normalizePhaseRequirements,
  defaultRequirementStructuredData
} = require('../services/phaseRequirements');

test('generic financing template keeps 28 requirements after unifying both duplicated items', () => {
  assert.equal(REQUIREMENT_TITLES.length, 28);
  assert.equal(REQUIREMENT_TITLES.filter(title => title === 'Revisión y validación del presupuesto de construcción por la Gerencia de Ingeniería').length, 1);
  assert.equal(REQUIREMENT_TITLES.filter(title => title === 'Planos de anteproyecto firmados por arquitecto e ingeniero').length, 1);
  assert.equal(REQUIREMENT_TITLES[27], 'Cuenta Avance');
  assert.equal(REQUIREMENT_TITLES[19], 'Preventas netas requeridas de la etapa a financiar y cesión suficiente para cubrir la facilidad aprobada');
  assert.equal(REQUIREMENT_TITLES[24], 'Fianza de cumplimiento requerida sobre el valor de la etapa');
});

test('phase requirements reuse project data and preserve manual information', () => {
  const requirements = normalizePhaseRequirements([
    { number: 5, information: 'Estudio externo de Mercado, S.A.', status: 'CUMPLIDO', observations: 'Validado' }
  ], {
    project: {
      budgetApproved: 1250000,
      legalData: { shareholders: [{ name: 'Accionista A', percentage: 60 }] }
    },
    promoterProfile: { yearsExperience: 12, deliveredProjects: 8 },
    phase: {
      name: 'Fase 1',
      planUses: [{ name: 'Construcción', amount: 1250000 }],
      planSources: [{ name: 'Banco', amount: 875000 }, { name: 'Promotor', amount: 375000 }]
    }
  });

  assert.equal(requirements.length, 28);
  assert.match(requirements[0].information, /1,250,000\.00/);
  assert.match(requirements[1].information, /12 años de experiencia/);
  assert.match(requirements[2].information, /Accionista A: 60%/);
  assert.equal(requirements[4].information, 'Estudio externo de Mercado, S.A.');
  assert.equal(requirements[4].status, 'CUMPLIDO');
  assert.equal(requirements[4].observations, 'Validado');
});

test('shareholder composition belongs to general information and reuses the project company', () => {
  const requirements = normalizePhaseRequirements([{ number: 3, category: 'legal' }], {
    project: {
      legalData: {
        promoterName: 'Promotor Demo',
        promoterLegalName: 'Sociedad Proyecto, S.A.',
        promoterRuc: '155600-1-123456',
        shareholders: [{ name: 'Accionista A', percentage: 65 }, { name: 'Accionista B', percentage: 35 }]
      }
    }
  });

  assert.equal(requirements[2].category, 'general');
  assert.deepEqual(requirements[2].structuredData.company, {
    promoterName: 'Promotor Demo',
    legalName: 'Sociedad Proyecto, S.A.',
    ruc: '155600-1-123456'
  });
  assert.equal(requirements[2].structuredData.shareholders.length, 2);
});

test('an explicitly cleared manual value is not refilled automatically', () => {
  const requirements = normalizePhaseRequirements([
    { number: 1, information: '', sourceKey: 'manual' }
  ], {
    project: { budgetApproved: 500000 },
    phase: { financialConditions: { phaseTotal: 500000 } }
  });

  assert.equal(requirements[0].information, '');
  assert.equal(requirements[0].sourceKey, 'manual');
});

test('project cover and model names do not prefill the architectural images requirement', () => {
  const requirements = normalizePhaseRequirements([], {
    project: {
      coverImage: { path: '/uploads/cover.jpg' },
      housingModels: [{ name: 'Modelo A', unitsCount: 10 }]
    }
  });

  assert.equal(requirements[3].information, '');
  assert.equal(requirements[3].sourceKey, 'manual');
  assert.equal(requirements[3].structuredData, undefined);
});

test('presales prefill summarizes current Commercial unit data', () => {
  const requirements = normalizePhaseRequirements([], {
    commercialUnits: [
      { commercialStatus: 'reservado', salePrice: 120000 },
      { commercialStatus: 'con_cpp', salePrice: 140000, cppAmount: 100000 },
      { commercialStatus: 'disponible', salePrice: 110000 },
      { commercialStatus: 'escriturado_traspasado', salePrice: 150000, cppAmount: 105000 }
    ]
  });

  assert.match(requirements[19].information, /4 unidades totales/);
  assert.match(requirements[19].information, /1 reservadas/);
  assert.match(requirements[19].information, /Preventas\/comercializadas: 3 \(75\.0%\)/);
  assert.match(requirements[19].information, /Monto CPP registrado: B\/. 205,000\.00/);
});

test('legacy platform cover prefill is removed instead of being treated as evidence', () => {
  const requirements = normalizePhaseRequirements([
    { number: 4, information: 'Bank73 dispone de una imagen de portada del proyecto.', sourceKey: 'bank73' }
  ], { project: { coverImage: { path: '/uploads/cover.jpg' } } });

  assert.equal(requirements[3].information, '');
  assert.equal(requirements[3].sourceKey, 'manual');
});

test('an automatic presales value refreshes from current Commercial data', () => {
  const requirements = normalizePhaseRequirements([
    { number: 20, information: 'Texto anterior', sourceKey: 'bank73' }
  ], {
    commercialUnits: [
      { commercialStatus: 'reservado', salePrice: 100000 },
      { commercialStatus: 'disponible', salePrice: 100000 }
    ]
  });

  assert.doesNotMatch(requirements[19].information, /Texto anterior/);
  assert.match(requirements[19].information, /Preventas\/comercializadas: 1 \(50\.0%\)/);
  assert.equal(requirements[19].sourceKey, 'bank73');
});

test('structured data keeps budget line items and manual notes separate', () => {
  const requirements = normalizePhaseRequirements([{ number: 1, manualInformation: 'Validar contingencia.' }], {
    project: { financialConditions: { projectTotal: 900000 } },
    phase: { financialConditions: { phaseTotal: 500000 }, planUses: [{ name: 'Obra', amount: 420000 }] }
  });

  assert.deepEqual(requirements[0].structuredData, {
    kind: 'budget', projectTotal: 900000, phaseTotal: 500000,
    uses: [{ name: 'Obra', amount: 420000 }]
  });
  assert.equal(requirements[0].manualInformation, 'Validar contingencia.');
  assert.equal(requirements[0].sourceKey, 'bank73');
});

test('promoter experience exposes every profile field even when it is empty', () => {
  const requirements = normalizePhaseRequirements([], {
    project: { assignedPromoters: ['promoter-id'] },
    promoterProfile: { yearsExperience: 7, countries: ['Panamá'] }
  });
  const experience = requirements[1].structuredData;

  assert.equal(experience.kind, 'experience');
  assert.equal(experience.promoterId, 'promoter-id');
  assert.equal(experience.promoter.yearsExperience, 7);
  assert.deepEqual(experience.promoter.countries, ['Panamá']);
  assert.equal(experience.promoter.deliveredProjects, null);
  assert.deepEqual(experience.promoter.banksWorkedWith, []);
});

test('structured presales include counts, percentage and associated amounts', () => {
  const requirements = normalizePhaseRequirements([], {
    commercialUnits: [
      { commercialStatus: 'con_cpp', salePrice: 150000, cppAmount: 110000 },
      { commercialStatus: 'reservado', salePrice: 125000 },
      { commercialStatus: 'disponible', salePrice: 100000 }
    ]
  });
  const presales = requirements[19].structuredData;

  assert.equal(presales.total, 3);
  assert.equal(presales.presales, 2);
  assert.equal(presales.presalesPct, 2 / 3 * 100);
  assert.equal(presales.saleValue, 275000);
  assert.equal(presales.cppAmount, 110000);
  assert.equal(presales.requiredPresalesPct, 50);
  assert.equal(requirements[19].status, 'CUMPLIDO');
});

test('requirement 20 reads the editable target from the existing phase presales condition', () => {
  const requirements = normalizePhaseRequirements([], {
    phase: { financialConditions: { requiredPresales: '62.5%' } },
    commercialUnits: [
      { commercialStatus: 'reservado' },
      { commercialStatus: 'reservado' },
      { commercialStatus: 'disponible' }
    ]
  });

  assert.equal(requirements[19].structuredData.requiredPresalesPct, 62.5);
  assert.equal(requirements[19].structuredData.presalesPct, 2 / 3 * 100);
  assert.equal(requirements[19].status, 'CUMPLIDO');
});

test('dynamic presales reopen when the current percentage is below the required target', () => {
  const requirements = normalizePhaseRequirements([], {
    phase: { financialConditions: { requiredPresales: '70%' } },
    commercialUnits: [
      { commercialStatus: 'reservado' },
      { commercialStatus: 'reservado' },
      { commercialStatus: 'disponible' }
    ]
  });

  assert.equal(requirements[19].structuredData.presalesPct, 2 / 3 * 100);
  assert.equal(requirements[19].structuredData.requiredPresalesPct, 70);
  assert.equal(requirements[19].status, 'PENDIENTE');
});

test('periodic presales preserve their commercial data while adding the review period', () => {
  const requirements = normalizePhaseRequirements([{
    number: 20,
    trackingType: 'recurring',
    structuredData: { kind: 'presales', periodicityValue: 3, periodicityUnit: 'months', lastRecordDate: '2026-01-15' }
  }], {
    commercialUnits: [{ commercialStatus: 'reservado' }, { commercialStatus: 'disponible' }]
  });

  assert.equal(requirements[19].structuredData.kind, 'presales');
  assert.equal(requirements[19].structuredData.presalesPct, 50);
  assert.equal(requirements[19].structuredData.periodicityValue, 3);
  assert.equal(requirements[19].structuredData.nextReviewDate, '2026-04-15');
});

test('requirement 4 remains exclusively documentary and does not duplicate Commercial models', () => {
  const requirements = normalizePhaseRequirements([], {
    project: { housingModels: [{ name: 'Modelo antiguo', unitsCount: 20 }] },
    commercialUnits: [
      { modelName: 'Tipología Comercial A', bedrooms: 2, bathrooms: 1, openAreaM2: 8, closedAreaM2: 72 },
      { modelName: 'Tipología Comercial A', bedrooms: 2, bathrooms: 1, openAreaM2: 8, closedAreaM2: 72 },
      { modelName: 'Tipología Comercial B', bedrooms: 3, bathrooms: 2, openAreaM2: 12, closedAreaM2: 94 }
    ]
  });

  assert.equal(requirements[3].structuredData, undefined);
  assert.equal(requirements[3].status, 'PENDIENTE');
  assert.equal(requirements[3].information, '');
});

test('generated requirement guidance is never persisted as manual information', () => {
  const title = REQUIREMENT_TITLES[5];
  const guidance = `Información solicitada: ${title}. Describe los datos disponibles y adjunta la documentación correspondiente.`;
  const requirements = normalizePhaseRequirements([{ number: 6, sourceKey: 'manual', information: guidance, manualInformation: guidance }]);

  assert.equal(requirements[5].information, '');
  assert.equal(requirements[5].manualInformation, '');
});

test('requirement 24 reads CAR and fire policies from technical project data', () => {
  const structured = defaultRequirementStructuredData(24, {
    project: {
      technicalData: {
        insurancePolicies: [{
          _id: 'policy-1',
          type: 'CAR',
          insurer: 'Aseguradora Demo',
          policyNumber: 'CAR-001',
          insuredAmount: 250000,
          expiryDate: '2027-01-31',
          endorsedToBank: true,
          bank: 'Banco Demo',
          appliesToAllUnits: true,
          documentId: 'doc-1',
          documentName: 'poliza-car.pdf'
        }]
      }
    },
    phase: {}
  });

  assert.equal(structured.kind, 'insurancePolicies');
  assert.equal(structured.policies.length, 1);
  assert.equal(structured.policies[0].policyNumber, 'CAR-001');
  assert.equal(structured.policies[0].endorsedToBank, true);
  assert.equal(structured.policies[0].bank, 'Banco Demo');
  assert.equal(structured.policies[0].documentName, 'poliza-car.pdf');
});

test('requirement 25 calculates the performance bond from the phase value and preserves real data', () => {
  const requirements = normalizePhaseRequirements([{
    number: 25,
    sourceKey: 'bank73',
    structuredData: {
      kind: 'performanceBond',
      requiredPct: 60,
      actualAmount: 310000,
      bondNumber: 'FC-2026-10',
      issuer: 'Aseguradora Demo',
      startDate: '2020-01-01',
      expiryDate: '2099-12-31',
      alertDaysBefore: 45
    }
  }], {
    phase: { financialConditions: { phaseTotal: 500000 } }
  });

  const bond = requirements[24].structuredData;
  assert.equal(bond.kind, 'performanceBond');
  assert.equal(bond.phaseValue, 500000);
  assert.equal(bond.requiredPct, 60);
  assert.equal(bond.requiredAmount, 300000);
  assert.equal(bond.actualAmount, 310000);
  assert.equal(bond.bondNumber, 'FC-2026-10');
  assert.equal(bond.issuer, 'Aseguradora Demo');
  assert.equal(bond.startDate, '2020-01-01');
  assert.equal(bond.expiryDate, '2099-12-31');
  assert.equal(bond.alertDaysBefore, 45);
  assert.equal(bond.validityStatus, 'CURRENT');
  assert.equal(requirements[24].status, 'CUMPLIDO');

  const expired = normalizePhaseRequirements([{
    number: 25,
    status: 'CUMPLIDO',
    structuredData: { kind: 'performanceBond', requiredPct: 50, actualAmount: 500000, startDate: '2000-01-01', expiryDate: '2001-01-01' }
  }], {
    phase: { financialConditions: { phaseTotal: 500000 } }
  });
  assert.equal(expired[24].structuredData.validityStatus, 'EXPIRED');
  assert.equal(expired[24].status, 'PENDIENTE');
});

test('requirement 26 calculates the payment bond and derives its status from the real amount', () => {
  const requirements = normalizePhaseRequirements([{
    number: 26,
    structuredData: {
      kind: 'paymentBond',
      requiredPct: 30,
      actualAmount: 155000,
      bondNumber: 'FP-2026-11',
      issuer: 'Entidad Demo',
      startDate: '2020-01-01',
      expiryDate: '2099-12-31'
    }
  }], {
    phase: { financialConditions: { phaseTotal: 500000 } }
  });

  const bond = requirements[25].structuredData;
  assert.equal(bond.kind, 'paymentBond');
  assert.equal(bond.phaseValue, 500000);
  assert.equal(bond.requiredPct, 30);
  assert.equal(bond.requiredAmount, 150000);
  assert.equal(bond.actualAmount, 155000);
  assert.equal(bond.bondNumber, 'FP-2026-11');
  assert.equal(bond.issuer, 'Entidad Demo');
  assert.equal(requirements[25].status, 'CUMPLIDO');

  const pending = normalizePhaseRequirements([{
    number: 26,
    status: 'CUMPLIDO',
    structuredData: { kind: 'paymentBond', requiredPct: 25, actualAmount: 100000, startDate: '2020-01-01', expiryDate: '2099-12-31' }
  }], {
    phase: { financialConditions: { phaseTotal: 500000 } }
  });
  assert.equal(pending[25].structuredData.requiredAmount, 125000);
  assert.equal(pending[25].status, 'PENDIENTE');
});

test('annual financial statements and requirement 27 calculate their next periodic review', () => {
  const requirements = normalizePhaseRequirements([
    { number: 7, structuredData: { kind: 'periodicFollowUp', periodicityMonths: 12, lastRecordDate: '2099-01-31' } },
    { number: 27, structuredData: { kind: 'periodicFollowUp', periodicityMonths: 4, lastRecordDate: '2099-01-31' } },
  ]);

  assert.equal(requirements[6].structuredData.followUpType, 'debtorFinancialStatements');
  assert.equal(requirements[6].structuredData.nextReviewDate, '2100-01-31');

  assert.equal(requirements[26].structuredData.followUpType, 'engineeringInspection');
  assert.equal(requirements[26].structuredData.periodicityMonths, 4);
  assert.equal(requirements[26].structuredData.nextReviewDate, '2099-05-31');
  assert.equal(requirements[26].status, 'CUMPLIDO');

});

test('requirement 16 shows financing plan checks only when the project seeks financing', () => {
  const technicalData = { assessment: { preliminaryDesign: true, approvedPlans: false } };
  const financed = normalizePhaseRequirements([], { project: { seeksFinancing: true, technicalData } });
  const notFinanced = normalizePhaseRequirements([], { project: { seeksFinancing: false, technicalData } });

  assert.equal(financed[15].structuredData.kind, 'plans');
  assert.equal(financed[15].structuredData.preliminaryDesign, true);
  assert.equal(notFinanced[15].structuredData, undefined);
  assert.equal(financed[15].status, 'PENDIENTE');
});

test('legacy duplicates are unified while old account advance 30 becomes 28', () => {
  const requirements = normalizePhaseRequirements([
    { _id: '64b000000000000000000016', number: 16, title: 'Planos de anteproyecto firmados por arquitecto e ingeniero', manualInformation: 'Documento principal' },
    { _id: '64b000000000000000000029', number: 29, title: 'Planos de anteproyecto firmados por arquitecto e ingeniero', observations: 'Documento duplicado' },
    { _id: '64b000000000000000000030', number: 30, title: 'Cuenta Avance', structuredData: { kind: 'periodicFollowUp', periodicityMonths: 2, lastRecordDate: '2099-01-01' } }
  ], { project: { seeksFinancing: true } });

  assert.equal(requirements.length, 28);
  assert.equal(String(requirements[15]._id), '64b000000000000000000016');
  assert.deepEqual(requirements[15].legacyRequirementIds, ['64b000000000000000000029']);
  assert.equal(requirements[15].observations, 'Documento duplicado');
  assert.equal(requirements[27].number, 28);
  assert.equal(String(requirements[27]._id), '64b000000000000000000030');
  assert.equal(requirements[27].structuredData.kind, 'accountAdvance');
});

test('requirements receive generic categories and tracking metadata', () => {
  const requirements = normalizePhaseRequirements([]);

  assert.equal(requirements[0].category, 'financial');
  assert.equal(requirements[2].category, 'general');
  assert.equal(requirements[3].category, 'technical');
  assert.equal(requirements[19].category, 'commercial');
  assert.equal(requirements[19].trackingType, 'dynamic');
  assert.equal(requirements[10].trackingType, 'dynamic');
  assert.equal(requirements[6].trackingType, 'recurring');
  assert.equal(requirements[26].trackingType, 'recurring');
  assert.equal(requirements[27].trackingType, 'dynamic');
});

test('custom and archived requirements survive normalization', () => {
  const requirements = normalizePhaseRequirements([
    { number: 1, title: 'Presupuesto adaptado', category: 'general', isArchived: true },
    { number: 30, code: 'CUSTOM-30', title: 'Condición adicional', category: 'legal', trackingType: 'none', isCustom: true, status: 'CUMPLIDO' }
  ]);

  assert.equal(requirements.length, 29);
  assert.equal(requirements.find(item => item.number === 1).title, 'Presupuesto adaptado');
  assert.equal(requirements.find(item => item.number === 1).isArchived, true);
  assert.equal(requirements.find(item => item.number === 30).title, 'Condición adicional');
  assert.equal(requirements.find(item => item.number === 30).category, 'legal');
  assert.equal(requirements.find(item => item.number === 30).status, 'CUMPLIDO');
});

test('the duplicated construction-budget requirement is merged without losing its history', () => {
  const requirements = normalizePhaseRequirements([
    { _id: '64b000000000000000000022', number: 22, title: REQUIREMENT_TITLES[21], status: 'PENDIENTE', manualInformation: 'Primera revisión' },
    { _id: '64b000000000000000000028', number: 28, title: REQUIREMENT_TITLES[21], status: 'CUMPLIDO', observations: 'Validado por Ingeniería' },
    { _id: '64b000000000000000000029', number: 29, title: 'Cuenta Avance', structuredData: { kind: 'accountAdvance' } }
  ]);

  assert.equal(requirements.length, 28);
  assert.equal(requirements[21].status, 'CUMPLIDO');
  assert.equal(requirements[21].manualInformation, 'Primera revisión');
  assert.equal(requirements[21].observations, 'Validado por Ingeniería');
  assert.deepEqual(requirements[21].legacyRequirementIds, ['64b000000000000000000028']);
  assert.equal(String(requirements[27]._id), '64b000000000000000000029');
});

test('changing the canonical phase schedule reopens its completed requirement', () => {
  const requirements = normalizePhaseRequirements([{
    number: 11,
    status: 'CUMPLIDO',
    completedAt: '2026-01-10T00:00:00.000Z',
    structuredData: { kind: 'schedule', phaseName: 'Fase 1', startDate: '2026-01-01', endDate: '2026-12-31' }
  }], {
    phase: { name: 'Fase 1', startDate: '2026-02-01', endDate: '2026-12-31' }
  });

  assert.equal(requirements[10].status, 'PENDIENTE');
  assert.equal(requirements[10].completedAt, undefined);
  assert.equal(requirements[10].structuredData.startDate, '2026-02-01');
});

test('CAR coverage starts at 100 percent and preserves the bank configuration', () => {
  const requirements = normalizePhaseRequirements([{ number: 24, structuredData: { requiredCoveragePct: 80 } }]);
  assert.equal(requirements[23].structuredData.requiredCoveragePct, 80);
});

test('a completed policy requirement reopens when its canonical policy changes', () => {
  const requirements = normalizePhaseRequirements([{
    number: 24,
    status: 'CUMPLIDO',
    structuredData: {
      kind: 'insurancePolicies',
      requiredCoveragePct: 80,
      policies: [{ type: 'CAR', policyNumber: 'CAR-1', insuredAmount: 100000, expiryDate: '2027-01-01' }]
    }
  }], {
    project: {
      technicalData: {
        insurancePolicies: [{ type: 'CAR', policyNumber: 'CAR-1', insuredAmount: 120000, expiryDate: '2027-01-01' }]
      }
    }
  });

  assert.equal(requirements[23].structuredData.requiredCoveragePct, 80);
  assert.equal(requirements[23].status, 'PENDIENTE');
});
