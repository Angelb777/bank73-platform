const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REQUIREMENT_TITLES,
  normalizePhaseRequirements,
  defaultRequirementStructuredData
} = require('../services/phaseRequirements');

test('Caja de Ahorros template keeps 29 numbered requirements after unifying the duplicated plans item', () => {
  assert.equal(REQUIREMENT_TITLES.length, 29);
  assert.equal(REQUIREMENT_TITLES[21], REQUIREMENT_TITLES[27]);
  assert.equal(REQUIREMENT_TITLES.filter(title => title === 'Planos de anteproyecto firmados por arquitecto e ingeniero').length, 1);
  assert.equal(REQUIREMENT_TITLES[28], 'Cuenta Avance');
  assert.equal(REQUIREMENT_TITLES[19], 'Preventas netas requeridas de la etapa a financiar y cesión suficiente para cubrir la facilidad aprobada');
  assert.equal(REQUIREMENT_TITLES[24], 'Fianza de cumplimiento requerida sobre el valor de la etapa');
});

test('phase requirements reuse Bank73 data and preserve manual information', () => {
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

  assert.equal(requirements.length, 29);
  assert.match(requirements[0].information, /1,250,000\.00/);
  assert.match(requirements[1].information, /12 años de experiencia/);
  assert.match(requirements[2].information, /Accionista A: 60%/);
  assert.equal(requirements[4].information, 'Estudio externo de Mercado, S.A.');
  assert.equal(requirements[4].status, 'CUMPLIDO');
  assert.equal(requirements[4].observations, 'Validado');
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
  assert.equal(requirements[3].sourceKey, 'bank73');
  assert.equal(requirements[3].structuredData.kind, 'architecturalPlans');
  assert.equal(requirements[3].structuredData.models[0].name, 'Modelo A');
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

test('legacy Bank73 cover prefill is removed instead of being treated as evidence', () => {
  const requirements = normalizePhaseRequirements([
    { number: 4, information: 'Bank73 dispone de una imagen de portada del proyecto.', sourceKey: 'bank73' }
  ], { project: { coverImage: { path: '/uploads/cover.jpg' } } });

  assert.equal(requirements[3].information, '');
  assert.equal(requirements[3].sourceKey, 'bank73');
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
  assert.equal(requirements[19].status, 'PENDIENTE');
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
  assert.equal(requirements[19].status, 'PENDIENTE');
});

test('requirement 4 model context refreshes from Commercial units before project seed models', () => {
  const requirements = normalizePhaseRequirements([], {
    project: { housingModels: [{ name: 'Modelo antiguo', unitsCount: 20 }] },
    commercialUnits: [
      { modelName: 'Tipología Comercial A', bedrooms: 2, bathrooms: 1, openAreaM2: 8, closedAreaM2: 72 },
      { modelName: 'Tipología Comercial A', bedrooms: 2, bathrooms: 1, openAreaM2: 8, closedAreaM2: 72 },
      { modelName: 'Tipología Comercial B', bedrooms: 3, bathrooms: 2, openAreaM2: 12, closedAreaM2: 94 }
    ]
  });

  assert.deepEqual(requirements[3].structuredData.models.map(model => [model.name, model.unitsCount]), [
    ['Tipología Comercial A', 2],
    ['Tipología Comercial B', 1]
  ]);
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
          bank: 'Caja de Ahorros',
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
  assert.equal(structured.policies[0].bank, 'Caja de Ahorros');
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

test('requirements 27 and 29 calculate their next periodic review', () => {
  const requirements = normalizePhaseRequirements([
    { number: 27, structuredData: { kind: 'periodicFollowUp', periodicityMonths: 4, lastRecordDate: '2099-01-31' } },
    { number: 29, structuredData: { kind: 'periodicFollowUp', periodicityMonths: 1, lastRecordDate: '2000-01-31' } }
  ]);

  assert.equal(requirements[26].structuredData.followUpType, 'engineeringInspection');
  assert.equal(requirements[26].structuredData.periodicityMonths, 4);
  assert.equal(requirements[26].structuredData.nextReviewDate, '2099-05-31');
  assert.equal(requirements[26].status, 'CUMPLIDO');

  assert.equal(requirements[28].structuredData.followUpType, 'accountAdvance');
  assert.equal(requirements[28].structuredData.periodicityMonths, 1);
  assert.equal(requirements[28].structuredData.nextReviewDate, '2000-02-29');
  assert.equal(requirements[28].status, 'PENDIENTE');
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

test('legacy requirements 16 and 29 are unified while old account advance 30 becomes 29', () => {
  const requirements = normalizePhaseRequirements([
    { _id: '64b000000000000000000016', number: 16, title: 'Planos de anteproyecto firmados por arquitecto e ingeniero', manualInformation: 'Documento principal' },
    { _id: '64b000000000000000000029', number: 29, title: 'Planos de anteproyecto firmados por arquitecto e ingeniero', observations: 'Documento duplicado' },
    { _id: '64b000000000000000000030', number: 30, title: 'Cuenta Avance', structuredData: { kind: 'periodicFollowUp', periodicityMonths: 2, lastRecordDate: '2099-01-01' } }
  ], { project: { seeksFinancing: true } });

  assert.equal(requirements.length, 29);
  assert.equal(String(requirements[15]._id), '64b000000000000000000016');
  assert.deepEqual(requirements[15].legacyRequirementIds, ['64b000000000000000000029']);
  assert.equal(requirements[15].observations, 'Documento duplicado');
  assert.equal(requirements[28].number, 29);
  assert.equal(String(requirements[28]._id), '64b000000000000000000030');
  assert.equal(requirements[28].structuredData.followUpType, 'accountAdvance');
  assert.equal(requirements[28].structuredData.periodicityMonths, 2);
});
