const PROJECT_CURRENCIES = {
  PAB: { code: 'PAB', label: 'B/. Balboa', symbol: 'B/.' },
  USD: { code: 'USD', label: '$ Dolar estadounidense', symbol: '$' },
  EUR: { code: 'EUR', label: '€ Euro', symbol: '€' }
};

function normalizeProjectCurrency(value) {
  const code = String(value || '').trim().toUpperCase();
  return PROJECT_CURRENCIES[code] ? code : 'PAB';
}

function currencySymbol(value) {
  return PROJECT_CURRENCIES[normalizeProjectCurrency(value)].symbol;
}

function parsePanamaNumber(value) {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;

  const cleaned = String(value)
    .trim()
    .replace(/B\/\.|\$|€/gi, '')
    .replace(/\s/g, '')
    .replace(/,/g, '');

  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function formatPanamaNumber(value, decimals = 2) {
  const n = Number(value || 0);
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatProjectMoney(value, currency = 'PAB', decimals = 2) {
  return `${currencySymbol(currency)} ${formatPanamaNumber(value, decimals)}`;
}

module.exports = {
  PROJECT_CURRENCIES,
  normalizeProjectCurrency,
  currencySymbol,
  parsePanamaNumber,
  formatPanamaNumber,
  formatProjectMoney
};
