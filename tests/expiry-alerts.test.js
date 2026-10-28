const test = require('node:test');
const assert = require('node:assert/strict');
const {
  expiryAlertKey,
  resolvedExpiryAlertKeys,
  isExpiryAlertResolved
} = require('../services/expiryAlerts');

test('expiry alert keys normalize dates and match persisted resolutions', () => {
  const key = expiryAlertKey('cpp', 'venta-1', new Date('2027-01-21T18:30:00.000Z'));
  assert.equal(key, 'cpp:venta-1:2027-01-21');

  const resolved = resolvedExpiryAlertKeys({
    expiryAlertResolutions: [{ key, kind: 'cpp', sourceId: 'venta-1', due: '2027-01-21' }]
  });
  assert.equal(isExpiryAlertResolved(resolved, 'cpp', 'venta-1', '2027-01-21T00:00:00.000Z'), true);
  assert.equal(isExpiryAlertResolved(resolved, 'cpp', 'venta-1', '2027-02-21'), false);
});

test('resolution keys can be rebuilt from legacy resolution fields', () => {
  const resolved = resolvedExpiryAlertKeys({
    expiryAlertResolutions: [{ kind: 'insurance_policy', sourceId: 'policy-1', due: '2026-12-01' }]
  });
  assert.equal(isExpiryAlertResolved(resolved, 'insurance_policy', 'policy-1', '2026-12-01'), true);
});
