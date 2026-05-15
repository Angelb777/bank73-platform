const crypto = require('crypto');

const ITERATIONS = 120000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';
const PREFIX = 'pbkdf2';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(String(password || ''), salt, ITERATIONS, KEY_LENGTH, DIGEST)
    .toString('hex');

  return `${PREFIX}$${ITERATIONS}$${salt}$${hash}`;
}

function isHashedPassword(value) {
  return typeof value === 'string' && value.startsWith(`${PREFIX}$`);
}

function verifyPassword(password, stored) {
  if (!isHashedPassword(stored)) {
    return String(stored || '') === String(password || '');
  }

  const parts = String(stored).split('$');
  if (parts.length !== 4) return false;

  const iterations = Number(parts[1]);
  const salt = parts[2];
  const hash = parts[3];

  if (!Number.isFinite(iterations) || !salt || !hash) return false;

  const candidate = crypto
    .pbkdf2Sync(String(password || ''), salt, iterations, KEY_LENGTH, DIGEST)
    .toString('hex');

  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(candidate, 'hex');

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  hashPassword,
  isHashedPassword,
  verifyPassword
};
