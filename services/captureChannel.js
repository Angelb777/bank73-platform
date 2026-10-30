'use strict';

const CAPTURE_CHANNELS = Object.freeze([
  'Ferias',
  'Referido',
  'Valla publicitaria',
  'Broker',
  'Redes sociales',
  'Portales inmobiliarios',
  'En proyecto',
  'Oficina',
  'Mercadeo / volanteo'
]);

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function normalizeCaptureChannel(value) {
  const key = normalizeKey(value);
  if (!key) return '';

  if (/\bFERIA(S)?\b/.test(key)) return 'Ferias';
  if (/\bREFERID[OA]S?\b/.test(key)) return 'Referido';
  if (key.includes('VALLA')) return 'Valla publicitaria';
  if (key.includes('BROKER') || key.includes('CORREDOR')) return 'Broker';
  if (key.includes('RED') && key.includes('SOCIAL')) return 'Redes sociales';
  if (key.includes('PORTAL') && key.includes('INMOBILI')) return 'Portales inmobiliarios';
  if (key.includes('PROYECTO')) return 'En proyecto';
  if (key.includes('OFICINA')) return 'Oficina';
  if (key.includes('MERCADEO') || key.includes('VOLANT') || key.includes('PROSPECT')) {
    return 'Mercadeo / volanteo';
  }

  return '';
}

function legacyCaptureChannel(venta = {}) {
  if (venta.captadoAtencionOficina) return 'Oficina';
  if (venta.captadoMailInternet) return 'Mail / Internet';
  if (venta.captadoEnProyecto) return 'En proyecto';
  if (venta.captadoMercadeoProspecto) return 'Mercadeo / volanteo';
  return '';
}

function captureChannelForVenta(venta = {}) {
  return normalizeCaptureChannel(venta.canalCaptacion) || legacyCaptureChannel(venta);
}

module.exports = {
  CAPTURE_CHANNELS,
  normalizeCaptureChannel,
  captureChannelForVenta
};
