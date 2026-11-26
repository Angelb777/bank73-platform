'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { requireDeletePin, isDestructiveRequest } = require('../utils/deletePin');

function run(req) {
  let nextCalled = false;
  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return value; }
  };
  requireDeletePin({ headers: {}, body: {}, query: {}, ...req }, res, () => { nextCalled = true; });
  return { nextCalled, statusCode, payload };
}

test('todas las peticiones DELETE exigen el PIN compartido', () => {
  const previous = process.env.DELETE_PIN;
  process.env.DELETE_PIN = '2468';
  try {
    assert.equal(run({ method: 'DELETE', path: '/projects/1' }).statusCode, 403);
    assert.equal(run({ method: 'DELETE', path: '/projects/1', headers: { 'x-delete-pin': '0000' } }).statusCode, 403);
    const accepted = run({ method: 'DELETE', path: '/projects/1', headers: { 'x-delete-pin': '2468' } });
    assert.equal(accepted.nextCalled, true);
  } finally {
    if (previous === undefined) delete process.env.DELETE_PIN;
    else process.env.DELETE_PIN = previous;
  }
});

test('el endpoint POST de compatibilidad para borrar también exige PIN', () => {
  assert.equal(isDestructiveRequest({ method: 'POST', path: '/documents/1/delete' }), true);
  assert.equal(isDestructiveRequest({ method: 'POST', path: '/documents/1' }), false);
  assert.equal(run({ method: 'GET', path: '/projects/1' }).nextCalled, true);
});

test('el cliente solicita el PIN automáticamente en borrados sin credencial', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/api.js'), 'utf8');
  assert.match(source, /method === 'DELETE'/);
  assert.match(source, /Introduce el PIN de eliminación/);
  assert.match(source, /headers\.set\('x-delete-pin'/);
});
