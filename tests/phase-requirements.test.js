const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REQUIREMENT_TITLES,
  normalizePhaseRequirements
} = require('../services/phaseRequirements');

test('Caja de Ahorros template keeps the exact 30 numbered requirements and duplicates', () => {
  assert.equal(REQUIREMENT_TITLES.length, 30);
  assert.equal(REQUIREMENT_TITLES[21], REQUIREMENT_TITLES[27]);
  assert.equal(REQUIREMENT_TITLES[15], REQUIREMENT_TITLES[28]);
  assert.equal(REQUIREMENT_TITLES[19].startsWith('Preventas netas equivalentes al 50%'), true);
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

  assert.equal(requirements.length, 30);
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
  assert.equal(requirements[3].sourceKey, 'manual');
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
});
