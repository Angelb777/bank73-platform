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

const UNIT_HEADER_NAMES = ['LOTE', 'UNIDAD', 'UNIDAD APTO', 'APTO', 'APARTAMENTO'];
const GROUP_HEADER_NAMES = ['MANZANA', 'ETAPA', 'TORRE', 'NIVEL'];

function unitIdentityFromRow(row, get) {
  const etapa = clean(get(row, ['ETAPA']));
  const torre = clean(get(row, ['TORRE']));
  const nivel = clean(get(row, ['NIVEL']));
  const legacyGroup = clean(get(row, ['MANZANA']));
  const lote = clean(get(row, UNIT_HEADER_NAMES));
  const manzana = legacyGroup || [etapa, torre, nivel].filter(Boolean).join(' · ');
  return { etapa, torre, nivel, manzana, lote };
}

function findTable(workbook) {
  const preferredNames = ['EXPEDIENTES-BANCO', 'BASE DATOS'];
  const orderedNames = [
    ...preferredNames.flatMap(preferred => (
      workbook.SheetNames.filter(name => normalizeText(name) === preferred)
    )),
    ...workbook.SheetNames.filter(name => !preferredNames.includes(normalizeText(name)))
  ];

  for (const sheetName of orderedNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    const headerIndex = rows.slice(0, 12).findIndex(values => {
      const names = new Set((values || []).map(normalizeHeader).filter(Boolean));
      const hasUnit = UNIT_HEADER_NAMES.some(name => names.has(name));
      const hasContext = GROUP_HEADER_NAMES.some(name => names.has(name)) ||
        names.has('MODELO') || names.has('CLIENTE');
      return hasUnit && hasContext;
    });
    if (headerIndex >= 0) return { sheetName, rows, headerIndex };
  }
  return null;
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
  const table = findTable(workbook);
  if (!table) {
    const error = new Error('No se encontró una hoja con unidades (LOTE o UNIDAD APTO)');
    error.status = 400;
    throw error;
  }

  const { sheetName, rows, headerIndex } = table;
  const header = rows[headerIndex].map(value => clean(value));
  const headerMap = new Map(header.map(value => [normalizeHeader(value), value]));
  const get = (row, names) => {
    for (const name of names) {
      const original = headerMap.get(normalizeHeader(name));
      if (original && row[original] !== undefined && clean(row[original])) return row[original];
    }
    return '';
  };

  const dataRows = rows.slice(headerIndex + 1).map((values, sourceIndex) => {
    const row = {};
    header.forEach((name, index) => { row[name] = values?.[index] ?? ''; });
    return { row, values, sourceRow: sourceIndex + headerIndex + 2 };
  }).filter(({ row, values }) => {
    if (!Array.isArray(values) || !values.some(value => clean(value))) return false;
    const { lote, manzana } = unitIdentityFromRow(row, get);
    const loteNormalized = normalizeText(lote);
    const manzanaNormalized = normalizeText(manzana);
    if (!lote && !manzana) return false;
    if (loteNormalized === 'TOTAL' || manzanaNormalized === 'TOTAL') return false;
    if (loteNormalized.startsWith('ETAPA')) return false;
    if (!lote && manzanaNormalized.startsWith('ETAPA')) return false;
    return true;
  });

  if (!dataRows.length) {
    const error = new Error('No se encontraron unidades válidas en el Excel');
    error.status = 400;
    throw error;
  }

  return { sheetName, header, headerIndex, get, dataRows };
}

function freeStatus(value) {
  const text = normalizeText(value);
  if (!text) return null;
  if (text.includes('CANCEL') || text.includes('ANUL')) return 'cancelado';
  if (text.includes('INVENTARIO')) return 'inventario';
  if (text.includes('NOCPP/NOCLIENTE') || text.includes('NO CLIENTE') || text.includes('SIN CLIENTE') || text.includes('LIBRE') || text.includes('DISPON')) return 'disponible';
  if (text.includes('RESERV')) return 'reservado';
  if (text.includes('VENDID')) return 'reservado';
  if (text.includes('CPP/CLIENTE') || text.includes('CON CPP') || text === 'CPP') return 'con_cpp';
  if ((text.includes('EN') && text.includes('ESCRIT')) || text.includes('ESCRITURACION') || text.includes('TRAMITE LEGAL')) return 'tramite_legal_activado';
  if (text.includes('ESCRITURAD') || text.includes('INSCRIT') || text.includes('TRASPAS')) return 'escriturado_traspasado';
  if (text.includes('ENTREG')) return 'vivienda_entregada';
  return null;
}

function inferStatus(row, get) {
  const client = clean(get(row, ['CLIENTE', 'CLIENTE ', 'NICKNAME', 'RESUMEN CLIENTE', 'CLIENTE RESUMEN']));
  const bank = clean(get(row, ['BANCO', 'BANCO DEL CLIENTE']));
  const cpp = clean(get(row, ['N° CPP', 'Nº CPP', 'NUM CPP', 'NUMERO CPP']));
  const bankStatus = normalizeText(get(row, ['STATUS EN BANCO', 'STATUS  EN BANCO', 'ESTATUS BANCO']));
  const lotStatus = normalizeText(get(row, [
    'ESTATUS LOTE', 'ESTADO LOTE', 'RESERVADAS, VENDIDAS', 'RESERVAS, VENDIDAS',
    'ESTATUS', 'ESTATUS2', 'ESTATUS6'
  ]));
  const contractStatus = normalizeText(get(row, [
    'ESTATUS CTTO', 'ESTATUS CTTO ', 'ESTATUS CTTO.', 'ESTATUS CONTRATO',
    'RESERVAS, VENDIDAS'
  ]));
  const registered = dateValue(get(row, [
    'FECHA DE INSCRIPCION', 'FECHA INSCRIPCION', 'INSCRIPCIÓN REGISTRO'
  ]));
  const registryEntry = boolValue(get(row, ['INGRESO AL RP', 'INGRESO RP', 'INGRESO REGISTRO']));
  const delivered = boolValue(get(row, ['ENTREGA DE CASA', 'ENTREGA CASA'])) || boolValue(get(row, ['ENTREGA ANATI']));

  if (delivered) return 'vivienda_entregada';
  if (registered || lotStatus === 'TRASPASADO') return 'escriturado_traspasado';
  if (registryEntry) return 'tramite_legal_activado';
  const explicit = freeStatus(lotStatus) || freeStatus(contractStatus);
  if (explicit) return explicit;
  if (cpp || bank || /CPP|APROB|CON CPP|INC/.test(bankStatus)) return 'con_cpp';
  return client ? 'reservado' : 'inventario';
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
  const units = [];
  const duplicates = [];
  let unnamedUnits = 0;

  for (const { row, sourceRow } of dataRows) {
    const { etapa, torre, nivel, manzana, lote } = unitIdentityFromRow(row, get);
    const unitKey = `${normalizeText(manzana)}|${normalizeText(lote)}`;
    if (seenUnits.has(unitKey)) {
      duplicates.push({ manzana, lote, rows: [seenUnits.get(unitKey), sourceRow] });
    } else {
      seenUnits.set(unitKey, sourceRow);
    }

    const name = clean(get(row, ['MODELO', 'MODELO ', 'MODELO VIVIENDA']));
    units.push({
      etapa,
      torre,
      nivel,
      manzana,
      lote,
      modelo: name,
      reference: `${manzana || name || ''}-${lote || ''}`.trim()
    });
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
    model.raw.openAreaM2.push(numeric(get(row, ['AREA ABIERTA', 'ÁREA ABIERTA', 'AREA ABIERTA VIVIENDA', 'AREA ABIERTA VIVIENDA M2', 'AREA BALCON'])));
    model.raw.closedAreaM2.push(numeric(get(row, ['AREA CERRADA', 'ÁREA CERRADA', 'AREA CERRADA VIVIENDA', 'AREA CERRADA VIVIENDA M2'])));
    model.raw.price.push(numeric(get(row, ['PRECIO DE VENTA', 'PRECIO VENTA', 'PRECIO LISTA', 'PRECIO', 'VALOR TOTAL', 'PRECIO DE CONTRATO DE COMPRA Y VENTA', 'VALOR'])));
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

  const duplicateError = duplicates.length
    ? `El Excel contiene unidades duplicadas: ${duplicates.slice(0, 3).map(item => {
      const identity = [item.manzana && `nivel/manzana ${item.manzana}`, item.lote && `unidad ${item.lote}`]
        .filter(Boolean)
        .join(', ');
      return `${identity} (filas ${item.rows.join(' y ')})`;
    }).join('; ')}`
    : '';

  return {
    sheet: table.sheetName,
    rows: dataRows.length,
    unitsTotal: dataRows.length,
    units,
    models: modelSummaries,
    unnamedUnits,
    duplicates,
    valid: dataRows.length > 0 && duplicates.length === 0,
    error: dataRows.length === 0
      ? 'No se encontraron unidades válidas en el Excel'
      : duplicateError
  };
}

module.exports = {
  STATUS_FIELDS,
  UNIT_HEADER_NAMES,
  GROUP_HEADER_NAMES,
  normalizeText,
  unitIdentityFromRow,
  readDatoUnicoTable,
  summarizeDatoUnico
};
