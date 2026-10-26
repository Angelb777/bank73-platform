'use strict';

const dns = require('node:dns');
const net = require('node:net');
const axios = require('axios');

const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;
const DOCUMENT_PATH_PREFIX = '/api/documents/';

function normalizedHostname(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function allowedHostnames(req) {
  const hosts = new Set();
  const configured = String(process.env.EXPORT_IMAGE_ALLOWED_HOSTS || '')
    .split(',')
    .map(normalizedHostname)
    .filter(Boolean);

  for (const host of configured) hosts.add(host);

  const baseDomain = normalizedHostname(process.env.BASE_DOMAIN);
  if (baseDomain) {
    hosts.add(baseDomain);
    hosts.add(baseDomain.startsWith('www.') ? baseDomain.slice(4) : `www.${baseDomain}`);
  }

  if (process.env.NODE_ENV !== 'production') {
    const requestHost = normalizedHostname(req?.get?.('host') || req?.headers?.host);
    if (requestHost) hosts.add(requestHost);
    hosts.add('localhost');
    hosts.add('127.0.0.1');
    hosts.add('::1');
  }

  return hosts;
}

function validateRemoteImageUrl(value, req) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new Error('URL de imagen no valida');
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const allowedProtocols = isProduction ? new Set(['https:']) : new Set(['https:', 'http:']);
  if (!allowedProtocols.has(url.protocol)) throw new Error('Protocolo de imagen no permitido');
  if (url.username || url.password) throw new Error('Credenciales en URL no permitidas');
  if (isProduction && url.port && url.port !== '443') throw new Error('Puerto de imagen no permitido');
  if (!url.pathname.startsWith(DOCUMENT_PATH_PREFIX)) throw new Error('Ruta de imagen no permitida');

  const hosts = allowedHostnames(req);
  if (!hosts.size || !hosts.has(url.hostname.toLowerCase())) {
    throw new Error('Host de imagen no permitido');
  }

  return url;
}

function isPrivateOrReservedAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const parts = address.split('.').map(Number);
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0) || a >= 224;
  }

  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd') || /^fe[89ab]/.test(lower)) return true;
    if (lower.startsWith('2001:db8:')) return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateOrReservedAddress(mapped[1]) : false;
  }

  return true;
}

function publicOnlyLookup(hostname, options, callback) {
  const lookupOptions = typeof options === 'object' ? options : {};
  dns.lookup(hostname, { ...lookupOptions, all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    const safe = addresses.filter(entry => !isPrivateOrReservedAddress(entry.address));
    if (!safe.length) return callback(new Error('El destino de imagen no tiene una direccion publica permitida'));
    if (lookupOptions.all) return callback(null, safe);
    return callback(null, safe[0].address, safe[0].family);
  });
}

async function fetchRemoteImage(value, req, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const url = validateRemoteImageUrl(value, req);
  const authorization = req?.headers?.authorization;
  const response = await axios.get(url.toString(), {
    responseType: 'arraybuffer',
    timeout: 15000,
    maxRedirects: 0,
    maxContentLength: maxBytes,
    maxBodyLength: maxBytes,
    lookup: publicOnlyLookup,
    headers: authorization ? { Authorization: authorization } : undefined,
    validateStatus: status => status >= 200 && status < 300
  });

  const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('image/')) throw new Error('El recurso remoto no es una imagen');

  const buffer = Buffer.from(response.data);
  if (buffer.length > maxBytes) throw new Error('La imagen remota supera el limite permitido');
  return buffer;
}

module.exports = {
  DEFAULT_MAX_BYTES,
  fetchRemoteImage,
  isPrivateOrReservedAddress,
  validateRemoteImageUrl
};
