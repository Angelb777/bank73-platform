'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LegalAcceptance = require('../models/LegalAcceptance');
const { loadLegalBundle, publicBundle } = require('../services/legalDocuments');

test('legal bundle is approved and enforced by default and exposes stable hashes', () => {
  const bundle = loadLegalBundle();
  assert.equal(bundle.version, '1.0.0');
  assert.equal(bundle.status, 'approved');
  assert.equal(bundle.acceptanceEnabled, true);
  assert.equal(bundle.enforced, true);
  assert.deepEqual(Object.keys(bundle.documents), ['terms', 'privacy', 'legal_notice']);
  Object.values(bundle.documents).forEach(document => {
    assert.match(document.hash, /^[a-f0-9]{64}$/);
    assert.ok(document.content.length > 500);
  });
});

test('public bundle omits legal content unless explicitly requested', () => {
  const metadata = publicBundle();
  assert.ok(metadata.documents.every(document => !Object.hasOwn(document, 'content')));
  const full = publicBundle({ includeContent: true });
  assert.ok(full.documents.every(document => document.content.length > 500));
});

test('terms protect Bank73 know-how and client confidentiality', () => {
  const terms = loadLegalBundle().documents.terms.content;
  assert.match(terms, /solución sustitutiva, equivalente o competitiva/i);
  assert.match(terms, /Compromiso de confidencialidad de DATO ÚNICO, S\.A\./i);
});

test('acceptance uniqueness is user plus version, not tenant', () => {
  const uniqueIndex = LegalAcceptance.schema.indexes().find(([keys, options]) => (
    keys.userId === 1 && keys.version === 1 && options.unique === true
  ));
  assert.ok(uniqueIndex);
  assert.equal(uniqueIndex[0].tenantKeyAtAcceptance, undefined);
});

test('web registration requires the current legal acceptance and links are a natural page footer', () => {
  const registerHtml = fs.readFileSync(path.join(__dirname, '../public/register.html'), 'utf8');
  const registerJs = fs.readFileSync(path.join(__dirname, '../public/js/register.js'), 'utf8');
  const legalJs = fs.readFileSync(path.join(__dirname, '../public/js/legal.js'), 'utf8');
  const legalCss = fs.readFileSync(path.join(__dirname, '../public/css/legal.css'), 'utf8');
  const portfolioJs = fs.readFileSync(path.join(__dirname, '../public/js/portfolio.js'), 'utf8');
  const dashboardJs = fs.readFileSync(path.join(__dirname, '../public/js/dashboard.js'), 'utf8');
  const projectJs = fs.readFileSync(path.join(__dirname, '../public/js/project.js'), 'utf8');

  assert.match(registerHtml, /id="termsAccepted"[^>]*required/);
  assert.match(registerHtml, /id="privacyAcknowledged"[^>]*required/);
  assert.match(registerJs, /legalVersion/);
  assert.match(registerJs, /ndaAccepted:\s*true/);
  assert.match(legalJs, /legal-page-footer/);
  assert.match(legalJs, /window\.BANK73_LEGAL_READY\s*=/);
  assert.match(legalJs, /typeof API === 'undefined'/);
  assert.doesNotMatch(legalJs, /window\.API\?\.getToken/);
  assert.doesNotMatch(legalJs, /legal-fixed-links/);
  assert.doesNotMatch(legalCss, /\.legal-fixed-links/);
  assert.match(portfolioJs, /await window\.BANK73_LEGAL_READY/);
  assert.match(dashboardJs, /await window\.BANK73_LEGAL_READY/);
  assert.match(projectJs, /await window\.BANK73_LEGAL_READY/);
});
