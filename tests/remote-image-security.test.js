'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isPrivateOrReservedAddress,
  validateRemoteImageUrl
} = require('../utils/remoteImage');

function request(host = 'localhost:3000') {
  return {
    headers: { host },
    get(name) {
      return String(name).toLowerCase() === 'host' ? host : undefined;
    }
  };
}

test('remote image validation only permits document URLs on an allowed host', () => {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    const url = validateRemoteImageUrl(
      'http://localhost:3000/api/documents/abc/download',
      request()
    );
    assert.equal(url.hostname, 'localhost');
    assert.throws(
      () => validateRemoteImageUrl('http://localhost:3000/api/admin/users', request()),
      /Ruta de imagen no permitida/
    );
    assert.throws(
      () => validateRemoteImageUrl('https://attacker.example/api/documents/abc/download', request()),
      /Host de imagen no permitido/
    );
    assert.throws(
      () => validateRemoteImageUrl('file:///api/documents/abc/download', request()),
      /Protocolo de imagen no permitido/
    );
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  }
});

test('private and reserved network addresses are rejected', () => {
  for (const address of [
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.2',
    '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1'
  ]) {
    assert.equal(isPrivateOrReservedAddress(address), true, address);
  }
  assert.equal(isPrivateOrReservedAddress('8.8.8.8'), false);
  assert.equal(isPrivateOrReservedAddress('2606:4700:4700::1111'), false);
});

test('production requires HTTPS and an explicitly configured Bank73 host', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousBaseDomain = process.env.BASE_DOMAIN;
  process.env.NODE_ENV = 'production';
  process.env.BASE_DOMAIN = 'bank73.com';
  try {
    assert.equal(
      validateRemoteImageUrl('https://www.bank73.com/api/documents/abc/download', request()).hostname,
      'www.bank73.com'
    );
    assert.throws(
      () => validateRemoteImageUrl('http://www.bank73.com/api/documents/abc/download', request()),
      /Protocolo de imagen no permitido/
    );
    assert.throws(
      () => validateRemoteImageUrl('https://bank73.com:8443/api/documents/abc/download', request()),
      /Puerto de imagen no permitido/
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousBaseDomain === undefined) delete process.env.BASE_DOMAIN;
    else process.env.BASE_DOMAIN = previousBaseDomain;
  }
});
