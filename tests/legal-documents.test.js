'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const LegalAcceptance = require('../models/LegalAcceptance');
const requireLegalAcceptance = require('../middleware/legalAcceptance');
const { loadLegalBundle, publicBundle } = require('../services/legalDocuments');

test('legal bundle is a non-enforced draft by default and exposes stable hashes', () => {
  const bundle = loadLegalBundle();
  assert.equal(bundle.version, 'draft-0.1');
  assert.equal(bundle.status, 'draft');
  assert.equal(bundle.acceptanceEnabled, false);
  assert.equal(bundle.enforced, false);
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

test('disabled legal guard leaves existing authentication flow untouched', async () => {
  let continued = false;
  await requireLegalAcceptance(
    { user: { userId: 'not-used' } },
    { status: () => { throw new Error('guard should not respond while disabled'); } },
    () => { continued = true; }
  );
  assert.equal(continued, true);
});
