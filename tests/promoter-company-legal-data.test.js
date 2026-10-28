const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { sanitizePromoterProfile } = require('../utils/promoterProfile');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

function baseProfile(company) {
  return {
    companies: [company],
    promoterType: 'No definido'
  };
}

test('las sociedades del perfil conservan RUC, referencia estable y junta accionarial', () => {
  const profile = sanitizePromoterProfile(baseProfile({
    companyId: 'company-1',
    name: 'Promotora Uno, S.A.',
    incorporationYear: 2020,
    ruc: '155000-1-2020 DV 10',
    shareholders: [
      { name: 'Ana', cedula: '8-100-200', percentage: 60 },
      { name: 'Luis', cedula: '8-300-400', percentage: 40 }
    ],
    isPrimary: true
  }));

  assert.equal(profile.companies[0].companyId, 'company-1');
  assert.equal(profile.companies[0].ruc, '155000-1-2020 DV 10');
  assert.deepEqual(profile.companies[0].shareholders.map(item => item.percentage), [60, 40]);
});

test('los porcentajes de una sociedad deben sumar 100%', () => {
  assert.throws(() => sanitizePromoterProfile(baseProfile({
    name: 'Promotora Dos, S.A.',
    incorporationYear: 2021,
    ruc: 'RUC-2',
    shareholders: [{ name: 'Ana', cedula: '8-100-200', percentage: 80 }],
    isPrimary: true
  })), /sumar 100%/i);
});

test('la creación de proyecto ofrece modo manual y bloquea los datos de sociedades registradas', () => {
  const html = read('public/portfolio.html');
  const js = read('public/js/portfolio.js');
  const routes = read('routes/projects.js');

  assert.match(js, /Rellenar manualmente/);
  assert.match(html, /id="ld-manualPromoterName"/);
  assert.match(html, /id="ld-promoterRuc"/);
  assert.match(js, /control\.disabled = !manual/);
  assert.match(routes, /registeredCompanyLegalData\(body\.legalData, selectedPromoter, selectedCompany\)/);
  assert.match(routes, /La sociedad seleccionada no tiene RUC/);
});

test('los editores del superadmin incluyen RUC y accionistas de la sociedad', () => {
  const dashboard = read('public/js/dashboard.js');
  assert.match(dashboard, /data-company-ruc/);
  assert.match(dashboard, /data-company-shareholder-row/);
  assert.match(dashboard, /id="ep-ld-promoterRuc"/);
  assert.match(dashboard, /promoterCompanyId/);
});
