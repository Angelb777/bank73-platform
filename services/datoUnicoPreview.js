const XLSX = require('xlsx');
const { parsePanamaNumber } = require('../utils/currency');

const STATUS_FIELDS = [
  'disponible',
  'inventario',
  'reservado',
  'con_cpp',
  'tramite_legal_activado',
  'escriturado_traspasado',
  'vivienda_entregada',
  'cancelado'
];

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeText(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/[º°]/g, '°');
}

function numeric(value) {
  if (value === '' || value === null || value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const parsed = parsePanamaNumber(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function boolValue(value) {
  const normalized = normalizeText(value);
  if (['SI', 'S', 'YES', 'Y', 'TRUE', '1', 'X', 'OK'].includes(normalized)) return true;
  return false;
}

function dateValue(value) {
  if (!value) return undefined;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function readDatoUnicoTable(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames.find(name => normalizeText(name) === 'EXPEDIENTES-BANCO') || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  if (rows.length < 3) {
    const error = new Error('Excel vacío o formato inesperado');
    error.status = 400;
    throw error;
  }

  const header = rows[1].map(value => clean(value));
  const headerMap = new Map(header.map(value => [normalizeHeader(value), value]));
  const get = (row, names) => {
    for (const name of names) {
      const original = headerMap.get(normalizeHeader(name));
      if (original && row[original] !== undefined) return row[original];
    }
    return '';
  };

  const dataRows = rows.slice(2).map((values, sourceIndex) => {
    const row = {};
    header.forEach((name, index) => { row[name] = values?.[index] ?? ''; });
    return { row, values, sourceRow: sourceIndex + 3 };
  }).filter(({ row, values }) => {
    if (!Array.isArray(values) || !values.some(value => clean(value))) return false;
    const lote = clean(get(row, ['LOTE']));
    const manzana = clean(get(row, ['MANZANA']));
    const loteNormalized = normalizeText(lote);
    const manzanaNormalized = normalizeText(manzana);
    if (!lote && !manzana) return false;
    if (loteNormalized === 'TOTAL' || manzanaNormalized === 'TOTAL') return false;
    if (loteNormalized.startsWith('ETAPA') || manzanaNormalized.startsWith('ETAPA')) return false;
    return true;
  });

  return { sheetName, header, get, dataRows };
}

function freeStatus(value) {
  const text = normalizeText(value);
  if (!text) return null;
  if (text.includes('CANCEL') || text.includes('ANUL')) return 'cancelado';
  if (text.includes('INVENTARIO')) return 'inventario';
  if (text.includes('NOCPP/NOCLIENTE') || text.includes('NO CLIENTE') || text.includes('SIN CLIENTE') || text.includes('LIBRE') || text.includes('DISPON')) return 'disponible';
  if (text.includes('RESERV')) return 'reservado';
  if (text.includes('CPP/CLIENTE') || text.includes('CON CPP') || text === 'CPP') return 'con_cpp';
  if ((text.includes('EN') && text.includes('ESCRIT')) || text.includes('ESCRITURACION') || text.includes('TRAMITE LEGAL')) return 'tramite_legal_activado';
  if (text.includes('ESCRITURAD') || text.includes('TRASPAS')) return 'escriturado_traspasado';
  if (text.includes('ENTREG')) return 'vivienda_entregada';
  return null;
}

function inferStatus(row, get) {
  const client = clean(get(row, ['CLIENTE', 'CLIENTE ', 'NICKNAME', 'RESUMEN CLIENTE', 'CLIENTE RESUMEN']));
  const bank = clean(get(row, ['BANCO']));
  const cpp = clean(get(row, ['N° CPP', 'Nº CPP', 'NUM CPP', 'NUMERO CPP']));
  const bankStatus = normalizeText(get(row, ['STATUS EN BANCO', 'STATUS  EN BANCO', 'ESTATUS BANCO']));
  const lotStatus = normalizeText(get(row, ['ESTATUS LOTE', 'ESTADO LOTE']));
  const contractStatus = normalizeText(get(row, ['ESTATUS CTTO', 'ESTATUS CTTO ', 'ESTATUS CTTO.', 'ESTATUS CONTRATO']));
  const registered = dateValue(get(row, ['FECHA DE INSCRIPCION', 'FECHA INSCRIPCION']));
  const registryEntry = boolValue(get(row, ['INGRESO AL RP', 'INGRESO RP']));
  const delivered = boolValue(get(row, ['ENTREGA DE CASA', 'ENTREGA CASA'])) || boolValue(get(row, ['ENTREGA ANATI']));

  if (delivered) return 'vivienda_entregada';
  if (registered || lotStatus === 'TRASPASADO') return 'escriturado_traspasado';
  if (registryEntry) return 'tramite_legal_activado';
  const explicit = freeStatus(lotStatus) || freeStatus(contractStatus);
  if (explicit) return explicit;
  if (cpp || bank || /CPP|APROB|CON CPP|INC/.test(bankStatus)) return 'con_cpp';
  return client ? 'reservado' : 'disponible';
}

function suggestedValue(values) {
  const present = values.filter(value => Number.isFinite(value));
  const unique = [...new Set(present.map(value => Number(value.toFixed(6))))];
  return {
    value: unique.length === 1 ? unique[0] : null,
    conflict: unique.length > 1,
    values: unique.slice(0, 8)
  };
}

function summarizeDatoUnico(buffer) {
  const table = readDatoUnicoTable(buffer);
  const { get, dataRows } = table;
  const models = new Map();
  const seenUnits = new Map();
  const duplicates = [];
  let unnamedUnits = 0;

  for (const { row, sourceRow } of dataRows) {
    const manzana = clean(get(row, ['MANZANA']));
    const lote = clean(get(row, ['LOTE']));
    const unitKey = `${normalizeText(manzana)}|${normalizeText(lote)}`;
    if (seenUnits.has(unitKey)) {
      duplicates.push({ manzana, lote, rows: [seenUnits.get(unitKey), sourceRow] });
    } else {
      seenUnits.set(unitKey, sourceRow);
    }

    const name = clean(get(row, ['MODELO', 'MODELO ']));
    if (!name) {
      unnamedUnits += 1;
      continue;
    }
    const key = normalizeText(name);
    if (!models.has(key)) {
      models.set(key, {
        name,
        unitsCount: 0,
        initialStatuses: Object.fromEntries(STATUS_FIELDS.map(status => [status, 0])),
        raw: { bedrooms: [], bathrooms: [], openAreaM2: [], closedAreaM2: [], price: [] }
      });
    }
    const model = models.get(key);
    model.unitsCount += 1;
    const status = inferStatus(row, get);
    model.initialStatuses[status] = (model.initialStatuses[status] || 0) + 1;
    model.raw.bedrooms.push(numeric(get(row, ['RECAMARAS', 'RECÁMARAS', 'HABITACIONES'])));
    model.raw.bathrooms.push(numeric(get(row, ['BANOS', 'BAÑOS'])));
    model.raw.openAreaM2.push(numeric(get(row, ['AREA ABIERTA', 'ÁREA ABIERTA', 'AREA ABIERTA VIVIENDA', 'AREA ABIERTA VIVIENDA M2'])));
    model.raw.closedAreaM2.push(numeric(get(row, ['AREA CERRADA', 'ÁREA CERRADA', 'AREA CERRADA VIVIENDA', 'AREA CERRADA VIVIENDA M2'])));
    model.raw.price.push(numeric(get(row, ['PRECIO DE VENTA', 'PRECIO VENTA', 'PRECIO LISTA', 'PRECIO', 'VALOR'])));
  }

  const modelSummaries = [...models.values()].map(model => {
    const suggestions = Object.fromEntries(Object.entries(model.raw).map(([field, values]) => [field, suggestedValue(values)]));
    const conflicts = Object.entries(suggestions).filter(([, suggestion]) => suggestion.conflict).map(([field]) => field);
    return {
      name: model.name,
      unitsCount: model.unitsCount,
      initialStatuses: model.initialStatuses,
      bedrooms: suggestions.bedrooms.value,
      bathrooms: suggestions.bathrooms.value,
      openAreaM2: suggestions.openAreaM2.value,
      closedAreaM2: suggestions.closedAreaM2.value,
      price: suggestions.price.value,
      conflicts,
      conflictValues: Object.fromEntries(conflicts.map(field => [field, suggestions[field].values]))
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));

  return {
    sheet: table.sheetName,
    rows: dataRows.length,
    unitsTotal: dataRows.length,
    models: modelSummaries,
    unnamedUnits,
    duplicates,
    valid: dataRows.length > 0 && duplicates.length === 0,
    error: dataRows.length === 0
      ? 'No se encontraron unidades válidas en el Excel'
      : (duplicates.length ? 'El Excel contiene unidades duplicadas' : '')
  };
}

module.exports = {
  STATUS_FIELDS,
  normalizeText,
  readDatoUnicoTable,
  summarizeDatoUnico
};
