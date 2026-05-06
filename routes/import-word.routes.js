'use strict';

const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const Venta = require('../models/Venta');
const Unit = require('../models/Unit');
const Project = require('../models/Project');
const { requireProjectAccess } = require('../middleware/rbac');
const { recomputeCommercialKpis } = require('../services/comercial_kpis');

const ALLOWED_FIELDS = new Set([
  // resumen
  'clienteNombre',

  // cliente 1
  'primerNombre',
  'segundoNombre',
  'primerApellido',
  'segundoApellido',
  'apellidoCasada',
  'cedula',
  'sexo',
  'profesion',
  'estadoCivil',
  'direccion',
  'telefonoResidencial',
  'telefonoOficina',
  'celular',
  'correo',
  'lugarTrabajo',
  'ingresoMensual',
  'cargo',
  'antiguedadLaboral',

  // cliente 2
  'cliente2PrimerNombre',
  'cliente2SegundoNombre',
  'cliente2PrimerApellido',
  'cliente2SegundoApellido',
  'cliente2ApellidoCasada',
  'cliente2Cedula',
  'cliente2Sexo',
  'cliente2Profesion',
  'cliente2EstadoCivil',
  'cliente2Direccion',
  'cliente2TelefonoResidencial',
  'cliente2TelefonoOficina',
  'cliente2Celular',
  'cliente2Correo',
  'cliente2LugarTrabajo',
  'cliente2IngresoMensual',
  'cliente2Cargo',
  'cliente2AntiguedadLaboral',

  // parientes
  'pariente1Nombre',
  'pariente1Parentesco',
  'pariente1Telefono',
  'pariente1TelefonoTrabajo',
  'pariente2Nombre',
  'pariente2Parentesco',
  'pariente2Telefono',
  'pariente2TelefonoTrabajo',

  // referencias
  'referencia1Nombre',
  'referencia1Relacion',
  'referencia1Telefono',
  'referencia1TelefonoTrabajo',
  'referencia2Nombre',
  'referencia2Relacion',
  'referencia2Telefono',
  'referencia2TelefonoTrabajo',

  // inmueble / lote / vivienda
  'lote',
  'metrajeLote',
  'loteEsquina',
  'metrosExtra',
  'precioLoteEsquina',
  'precioM2Extra',
  'modelo',
  'recamaras',
  'banos',
  'areaAbierta',
  'areaCerrada',
  'areaTotalConstruccion',
  'calle',
  'ubicacion',
  'numeroFinca',
  'fechaProbableEntrega',
  'valorMejoras',
  'valorTerreno',

  // precio / banco / financiación
  'precioVenta',
  'montoFinanciamientoCPP',
  'abonoCliente',
  'abonoInicial',
  'porcentajeFinanciamiento',
  'cesionAFavorDe',
  'banco',
  'oficialBanco',
  'polizaVida',
  'abonoAlte',

  // captación / observación
  'captadoAtencionOficina',
  'captadoMailInternet',
  'captadoEnProyecto',
  'captadoMercadeoProspecto',
  'proformaSolicitadaPor',
  'referidoPor',
  'observacionCliente'
]);

function normalize(str = '') {
  return String(str || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}

function compactLabel(str = '') {
  return normalize(str)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanMoney(value) {
  const raw = normalize(value);
  if (!raw) return '';

  const cleaned = raw
    .replace(/US\$/gi, '')
    .replace(/B\/\./gi, '')
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .trim();

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : raw;
}

function cleanPercent(value) {
  const raw = normalize(value);
  if (!raw) return '';

  const n = Number(raw.replace('%', '').trim());
  return Number.isFinite(n) ? n : raw;
}

function isTemplatePlaceholder(value) {
  return /^\s*\{\{.+\}\}\s*$/.test(String(value || ''));
}

const NUMBER_FIELDS = new Set([
  'valor',
  'ingresoMensual',
  'cliente2IngresoMensual',
  'metrajeLote',
  'metrosExtra',
  'precioLoteEsquina',
  'precioM2Extra',
  'areaAbierta',
  'areaCerrada',
  'areaTotalConstruccion',
  'recamaras',
  'banos',
  'valorMejoras',
  'valorTerreno',
  'montoFinanciamientoCPP',
  'precioVenta',
  'abonoCliente',
  'abonoInicial',
  'porcentajeFinanciamiento',
  'polizaVida',
  'abonoAlte'
]);

const IMPORT_FIELDS_FICHA_CLIENTE = [
  'primerNombre',
  'segundoNombre',
  'primerApellido',
  'segundoApellido',
  'cedula',
  'estadoCivil',
  'direccion',
  'telefonoResidencial',
  'telefonoOficina',
  'celular',
  'correo',

  'pariente1Nombre',
  'pariente1Parentesco',
  'pariente1Telefono',
  'pariente1TelefonoTrabajo',
  'pariente2Nombre',
  'pariente2Parentesco',
  'pariente2Telefono',
  'pariente2TelefonoTrabajo',

  'referencia1Nombre',
  'referencia1Relacion',
  'referencia1Telefono',
  'referencia1TelefonoTrabajo',
  'referencia2Nombre',
  'referencia2Relacion',
  'referencia2Telefono',
  'referencia2TelefonoTrabajo',

  'lugarTrabajo',
  'ingresoMensual',
  'cargo',
  'antiguedadLaboral',

  'cliente2PrimerNombre',
  'cliente2SegundoNombre',
  'cliente2PrimerApellido',
  'cliente2SegundoApellido',
  'cliente2Cedula',
  'cliente2EstadoCivil',
  'cliente2Direccion',
  'cliente2TelefonoResidencial',
  'cliente2TelefonoOficina',
  'cliente2Celular',
  'cliente2LugarTrabajo',
  'cliente2IngresoMensual',
  'cliente2Cargo',
  'cliente2AntiguedadLaboral',

  'lote',
  'metrajeLote',
  'loteEsquina',
  'metrosExtra',
  'precioLoteEsquina',
  'precioM2Extra',
  'modelo',
  'areaAbierta',
  'areaCerrada',
  'areaTotalConstruccion',

  'precioVenta',
  'montoFinanciamientoCPP',
  'abonoCliente',
  'banco',
  'oficialBanco',
  'polizaVida',
  'abonoAlte',

  'captadoAtencionOficina',
  'captadoMailInternet',
  'captadoEnProyecto',
  'captadoMercadeoProspecto',
  'proformaSolicitadaPor',
  'referidoPor',
  'observacionCliente',
];

const IMPORT_FIELDS_PROFORMA = [
  'banco',
  'oficialBanco',
  'ubicacion',

  'primerApellido',
  'segundoApellido',
  'apellidoCasada',
  'primerNombre',
  'segundoNombre',
  'sexo',
  'profesion',
  'direccion',
  'cedula',
  'lugarTrabajo',

  'cliente2PrimerApellido',
  'cliente2SegundoApellido',
  'cliente2ApellidoCasada',
  'cliente2PrimerNombre',
  'cliente2SegundoNombre',
  'cliente2Sexo',
  'cliente2Profesion',
  'cliente2Direccion',
  'cliente2Cedula',
  'cliente2LugarTrabajo',

  'lote',
  'modelo',
  'recamaras',
  'banos',
  'metrajeLote',
  'calle',
  'areaTotalConstruccion',
  'areaCerrada',
  'areaAbierta',
  'precioVenta',
  'valorMejoras',
  'valorTerreno',
  'numeroFinca',
  'fechaProbableEntrega',

  'montoFinanciamientoCPP',
  'cesionAFavorDe',
  'porcentajeFinanciamiento',
  'abonoInicial',
];

function buildFullImportPreview(type, detectedRaw = {}) {
  const fields =
    type === 'ficha_cliente'
      ? IMPORT_FIELDS_FICHA_CLIENTE
      : type === 'proforma'
        ? IMPORT_FIELDS_PROFORMA
        : [];

  const out = {};

  for (const field of fields) {
    let value = detectedRaw[field];

    if (value === undefined || value === null) value = '';

    // Si el Word trae {{campo}}, lo mostramos vacío
    if (isTemplatePlaceholder(value)) value = '';

    // Si por error mammoth devuelve otro label como valor, lo vaciamos
    if (typeof isLikelyLabel === 'function' && isLikelyLabel(value)) value = '';

    out[field] = value;
  }

  return out;
}

function pickAllowed(obj = {}, opts = {}) {
  const out = {};

  for (const k in obj) {
    if (!ALLOWED_FIELDS.has(k)) continue;

    let value = obj[k];

    if (value === undefined || value === null) continue;
    if (String(value).trim() === '') continue;

    // Evita guardar {{campo}} cuando el Word viene sin rellenar
    if (isTemplatePlaceholder(value) && !opts.keepPlaceholders) continue;

    // Convierte números correctamente
    if (NUMBER_FIELDS.has(k)) {
      value = cleanMoney(value);

      if (value === '' || value === null || value === undefined) continue;
      if (typeof value === 'string' && isTemplatePlaceholder(value)) continue;
    }

    out[k] = value;
  }

  return out;
}

function textLines(text) {
  return String(text || '')
    .split('\n')
    .map(normalize)
    .filter(Boolean);
}

function isLikelyLabel(value) {
  const s = compactLabel(value);

  if (!s) return true;

  const knownLabels = new Set([
    'BANCO',
    'OFICIAL',
    'PROYECTO',
    'PROMOTORA',
    'PROPIETARIO',
    'UBICACION',
    'DATO DEL 1ER SOLICITANTE',
    'DATO DEL 1ER SOLICITAN',
    'DATO DEL 2DO SOLICITANTE',
    'DATO DEL 2DO SOLICITAN',
    'APELLIDO PATERNO',
    'APELLIDO MATERNO',
    'APELL DE CASADA',
    'APELL.DE CASADA',
    'PRIMER NOMBRE',
    'SEGUNDO NOMBRE',
    'SEXO',
    'PROFESION',
    'DIRECCION ACTUAL DONDE RESIDE',
    'CEDULA',
    'LUGAR DE TRABAJO',
    'CARACTERISTICAS DEL LOTE',
    'LOTE N',
    'LOTE N°',
    'MODELO',
    'RECAMARAS',
    'BAÑO',
    'BANO',
    'SUPERFICIE DE TERRENO',
    'CALLE',
    'AREA TOTAL DE CONSTRUCCION',
    'AREA CERRADA',
    'AREA ABIERTA',
    'PRECIO TOTAL DE VENTA US$',
    'VALOR DE MEJORAS',
    'VALOR DE TERRENO',
    'FINCA',
    'FECHA PROBABLE DE ENTREGA',
    'FINANCIAMIENTO',
    'MONTO DEL FINANCIAMIENTO US$',
    'CESION A FAVOR DE',
    'PORCENTAJE DEL FINANCIAMIENTO',
    'ABONO INICIAL US$',

    'FICHA DE CLIENTE',
    'FICHA DE CLIENTES',
    'DATOS DEL CLIENTE 1',
    'DATOS DEL CLIENTE 2',
    'CEDULA Y D.V',
    'ESTADO CIVIL',
    'DOMICILIO',
    'TELEFONO RESIDENCIAL',
    'TELEFONO DE OFICINA',
    'CELULAR',
    'CORREO ELECTRONICO',
    'NOMBRE DEL PARIENTE 1',
    'PARENTESCO',
    'PARENTEZCO',
    'TELEFONO PARIENTE 1',
    'TEL. TRABAJO PARIENTE 1',
    'NOMBRE DEL PARIENTE 2',
    'TELEFONO PARIENTE 2',
    'TEL. TRABAJO PARIENTE 2',
    'NOMBRE REFERENCIA PERSONAL 1',
    'RELACION',
    'TEL. REF. PERSONAL 1',
    'TEL. TRABAJO REF. PERSONAL 1',
    'NOMBRE REFERENCIA PERSONAL 2',
    'TEL. REF. PERSONAL 2',
    'TEL. TRABAJO REF. PERSONAL 2',
    'INGRESO MENSUAL ($)',
    'CARGO QUE DESEMPEÑA',
    'ANTIGUEDAD LABORAL',
    'DESCRIPCION DEL TERRENO',
    'NUMERO DE LOTE:',
    'AREA TOTAL DE LOTE',
    'LOTE ESQUINA (SI/ NO): SI',
    'NO',
    'TOTAL MTS2 EXTRA',
    'PRECIO POR LOTE ESQUINERO',
    'PRECIO POR MTS2 EXTRA',
    'DESCRIPCION DE LA VIVIENDA',
    'M2 DE AREA ABIERTA:',
    'M2 DE AREA CERRADA:',
    'M2 DE AREA TOTAL:',
    'PRECIO DE VIVIENDA (PROMOTORA)',
    'PRECIO DE VENTA:',
    'MONTO HIPOTECA:',
    'PRECIO MTS2 EXTRA',
    'ABONO DEL FINANCIMIENTO:',
    'POLIZA DE VIDA',
    'ABONO ALTE',
    'PRECIO DE VIVIENDA (ENTIDAD BANCARIA)',
    'BANCO:',
    'OFICIAL DE CREIDTO:',
    'OFICIAL DE CREDITO:',
    'ABONO CLIENTE:',
    'CLIENTE CAPTADO',
    'ATENCION OFICINA',
    'POR MAIL/INTERNET',
    'EN EL PROYECTO',
    'MERCADEO/PROSPECTEO',
    'PROFORMA SOLICITADA POR (EJECUTIVO DE VENTAS)',
    'FECHA',
    'REFERIDO POR',
    'FIRMA'
  ]);

  return knownLabels.has(s);
}

function findValueAfterLabel(lines, labels, fromIndex = 0) {
  const wanted = Array.isArray(labels)
    ? labels.map(compactLabel)
    : [compactLabel(labels)];

  for (let i = Math.max(0, fromIndex); i < lines.length; i++) {
    const current = compactLabel(lines[i]);

    if (wanted.includes(current)) {
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const val = normalize(lines[j]);

        if (!val) continue;

        // Si lo siguiente también es un label, entonces el campo está vacío.
        // NO usamos otro label como valor.
        if (isLikelyLabel(val)) return '';

        return val;
      }
    }
  }

  return '';
}

function sectionIndex(lines, label) {
  const wanted = compactLabel(label);
  return lines.findIndex(l => compactLabel(l) === wanted);
}

function detectFichaCliente(lines) {
  const cliente2Start = sectionIndex(lines, 'DATOS DEL CLIENTE 2');
  const terrenoStart = sectionIndex(lines, 'DESCRIPCION DEL TERRENO');

  const cliente1From = 0;
  const cliente2From = cliente2Start > -1 ? cliente2Start : 0;

  return {
    primerNombre: findValueAfterLabel(lines, 'PRIMER NOMBRE', cliente1From),
    segundoNombre: findValueAfterLabel(lines, 'SEGUNDO NOMBRE', cliente1From),
    primerApellido: findValueAfterLabel(lines, 'APELLIDO PATERNO', cliente1From),
    segundoApellido: findValueAfterLabel(lines, 'APELLIDO MATERNO', cliente1From),

    cedula: findValueAfterLabel(lines, ['CEDULA Y D.V', 'CEDULA'], cliente1From),
    estadoCivil: findValueAfterLabel(lines, 'ESTADO CIVIL', cliente1From),
    direccion: findValueAfterLabel(lines, 'DOMICILIO', cliente1From),

    telefonoResidencial: findValueAfterLabel(lines, 'TELEFONO RESIDENCIAL', cliente1From),
    telefonoOficina: findValueAfterLabel(lines, 'TELEFONO DE OFICINA', cliente1From),
    celular: findValueAfterLabel(lines, 'CELULAR', cliente1From),
    correo: findValueAfterLabel(lines, 'CORREO ELECTRONICO', cliente1From),

    pariente1Nombre: findValueAfterLabel(lines, 'NOMBRE DEL PARIENTE 1', cliente1From),
    pariente1Parentesco: findValueAfterLabel(lines, ['PARENTESCO', 'PARENTEZCO'], cliente1From),
    pariente1Telefono: findValueAfterLabel(lines, 'TELEFONO PARIENTE 1', cliente1From),
    pariente1TelefonoTrabajo: findValueAfterLabel(lines, 'TEL. TRABAJO PARIENTE 1', cliente1From),

    pariente2Nombre: findValueAfterLabel(lines, 'NOMBRE DEL PARIENTE 2', cliente1From),
    pariente2Telefono: findValueAfterLabel(lines, 'TELEFONO PARIENTE 2', cliente1From),
    pariente2TelefonoTrabajo: findValueAfterLabel(lines, 'TEL. TRABAJO PARIENTE 2', cliente1From),

    referencia1Nombre: findValueAfterLabel(lines, 'NOMBRE REFERENCIA PERSONAL 1', cliente1From),
    referencia1Relacion: findValueAfterLabel(lines, 'RELACION', cliente1From),
    referencia1Telefono: findValueAfterLabel(lines, 'TEL. REF. PERSONAL 1', cliente1From),
    referencia1TelefonoTrabajo: findValueAfterLabel(lines, 'TEL. TRABAJO REF. PERSONAL 1', cliente1From),

    referencia2Nombre: findValueAfterLabel(lines, 'NOMBRE REFERENCIA PERSONAL 2', cliente1From),
    referencia2Telefono: findValueAfterLabel(lines, 'TEL. REF. PERSONAL 2', cliente1From),
    referencia2TelefonoTrabajo: findValueAfterLabel(lines, 'TEL. TRABAJO REF. PERSONAL 2', cliente1From),

    lugarTrabajo: findValueAfterLabel(lines, 'LUGAR DE TRABAJO', cliente1From),
    ingresoMensual: cleanMoney(findValueAfterLabel(lines, 'INGRESO MENSUAL ($)', cliente1From)),
    cargo: findValueAfterLabel(lines, 'CARGO QUE DESEMPEÑA', cliente1From),
    antiguedadLaboral: findValueAfterLabel(lines, ['ANTIGÜEDAD LABORAL', 'ANTIGUEDAD LABORAL'], cliente1From),

    cliente2PrimerNombre: cliente2Start > -1 ? findValueAfterLabel(lines, 'PRIMER NOMBRE', cliente2From) : '',
    cliente2SegundoNombre: cliente2Start > -1 ? findValueAfterLabel(lines, 'SEGUNDO NOMBRE', cliente2From) : '',
    cliente2PrimerApellido: cliente2Start > -1 ? findValueAfterLabel(lines, 'APELLIDO PATERNO', cliente2From) : '',
    cliente2SegundoApellido: cliente2Start > -1 ? findValueAfterLabel(lines, 'APELLIDO MATERNO', cliente2From) : '',
    cliente2Cedula: cliente2Start > -1 ? findValueAfterLabel(lines, ['CEDULA Y D.V', 'CEDULA'], cliente2From) : '',

    lote: findValueAfterLabel(lines, 'NUMERO DE LOTE:', terrenoStart > -1 ? terrenoStart : 0),
    metrajeLote: cleanMoney(findValueAfterLabel(lines, 'AREA TOTAL DE LOTE', terrenoStart > -1 ? terrenoStart : 0)),
    metrosExtra: cleanMoney(findValueAfterLabel(lines, 'TOTAL MTS2 EXTRA', terrenoStart > -1 ? terrenoStart : 0)),
    precioLoteEsquina: cleanMoney(findValueAfterLabel(lines, 'PRECIO POR LOTE ESQUINERO', terrenoStart > -1 ? terrenoStart : 0)),
    precioM2Extra: cleanMoney(findValueAfterLabel(lines, ['PRECIO POR MTS2 EXTRA', 'PRECIO MTS2 EXTRA'], terrenoStart > -1 ? terrenoStart : 0)),

    areaAbierta: cleanMoney(findValueAfterLabel(lines, 'M2 DE AREA ABIERTA:', terrenoStart > -1 ? terrenoStart : 0)),
    areaCerrada: cleanMoney(findValueAfterLabel(lines, 'M2 DE AREA CERRADA:', terrenoStart > -1 ? terrenoStart : 0)),
    areaTotalConstruccion: cleanMoney(findValueAfterLabel(lines, 'M2 DE AREA TOTAL:', terrenoStart > -1 ? terrenoStart : 0)),

    precioVenta: cleanMoney(findValueAfterLabel(lines, 'PRECIO DE VENTA:', terrenoStart > -1 ? terrenoStart : 0)),
    montoFinanciamientoCPP: cleanMoney(findValueAfterLabel(lines, ['MONTO HIPOTECA:', 'MONTO DEL FINANCIAMIENTO US$'], terrenoStart > -1 ? terrenoStart : 0)),
    abonoCliente: cleanMoney(findValueAfterLabel(lines, ['ABONO CLIENTE:', 'ABONO DEL FINANCIMIENTO:'], terrenoStart > -1 ? terrenoStart : 0)),
    banco: findValueAfterLabel(lines, 'BANCO:', terrenoStart > -1 ? terrenoStart : 0),
    oficialBanco: findValueAfterLabel(lines, ['OFICIAL DE CREIDTO:', 'OFICIAL DE CREDITO:', 'OFICIAL'], terrenoStart > -1 ? terrenoStart : 0),

    polizaVida: cleanMoney(findValueAfterLabel(lines, 'POLIZA DE VIDA', terrenoStart > -1 ? terrenoStart : 0)),
    abonoAlte: cleanMoney(findValueAfterLabel(lines, 'ABONO ALTE', terrenoStart > -1 ? terrenoStart : 0)),

    proformaSolicitadaPor: findValueAfterLabel(lines, 'PROFORMA SOLICITADA POR (EJECUTIVO DE VENTAS)', terrenoStart > -1 ? terrenoStart : 0),
    referidoPor: findValueAfterLabel(lines, 'REFERIDO POR', terrenoStart > -1 ? terrenoStart : 0),
  };
}

function detectProforma(lines) {
  return {
    banco: findValueAfterLabel(lines, 'BANCO'),
    oficialBanco: findValueAfterLabel(lines, 'OFICIAL'),
    ubicacion: findValueAfterLabel(lines, 'UBICACION'),

    primerApellido: findValueAfterLabel(lines, 'APELLIDO PATERNO'),
    segundoApellido: findValueAfterLabel(lines, 'APELLIDO MATERNO'),
    apellidoCasada: findValueAfterLabel(lines, 'APELL.DE CASADA'),
    primerNombre: findValueAfterLabel(lines, 'PRIMER NOMBRE'),
    segundoNombre: findValueAfterLabel(lines, 'SEGUNDO NOMBRE'),
    sexo: findValueAfterLabel(lines, 'SEXO'),
    profesion: findValueAfterLabel(lines, 'PROFESIÓN'),
    direccion: findValueAfterLabel(lines, 'DIRECCIÓN ACTUAL DONDE RESIDE'),
    cedula: findValueAfterLabel(lines, 'CEDULA'),
    lugarTrabajo: findValueAfterLabel(lines, 'LUGAR DE TRABAJO'),

    cliente2PrimerApellido: findValueAfterLabel(lines, 'APELLIDO PATERNO', sectionIndex(lines, 'DATO DEL 2do SOLICITANTE')),
    cliente2SegundoApellido: findValueAfterLabel(lines, 'APELLIDO MATERNO', sectionIndex(lines, 'DATO DEL 2do SOLICITANTE')),
    cliente2ApellidoCasada: findValueAfterLabel(lines, 'APELL.DE CASADA', sectionIndex(lines, 'DATO DEL 2do SOLICITANTE')),
    cliente2PrimerNombre: findValueAfterLabel(lines, 'PRIMER NOMBRE', sectionIndex(lines, 'DATO DEL 2do SOLICITANTE')),
    cliente2SegundoNombre: findValueAfterLabel(lines, 'SEGUNDO NOMBRE', sectionIndex(lines, 'DATO DEL 2do SOLICITANTE')),
    cliente2Sexo: findValueAfterLabel(lines, 'SEXO', sectionIndex(lines, 'DATO DEL 2do SOLICITANTE')),
    cliente2Profesion: findValueAfterLabel(lines, 'PROFESIÓN', sectionIndex(lines, 'DATO DEL 2do SOLICITANTE')),
    cliente2Direccion: findValueAfterLabel(lines, 'DIRECCIÓN ACTUAL DONDE RESIDE', sectionIndex(lines, 'DATO DEL 2do SOLICITANTE')),
    cliente2Cedula: findValueAfterLabel(lines, 'CEDULA', sectionIndex(lines, 'DATO DEL 2do SOLICITANTE')),
    cliente2LugarTrabajo: findValueAfterLabel(lines, 'LUGAR DE TRABAJO', sectionIndex(lines, 'DATO DEL 2do SOLICITANTE')),

    lote: findValueAfterLabel(lines, 'LOTE N°'),
    modelo: findValueAfterLabel(lines, 'MODELO'),
    recamaras: cleanMoney(findValueAfterLabel(lines, 'RECAMARAS')),
    banos: cleanMoney(findValueAfterLabel(lines, 'BAÑO')),
    metrajeLote: cleanMoney(findValueAfterLabel(lines, 'SUPERFICIE DE TERRENO')),
    calle: findValueAfterLabel(lines, 'CALLE'),

    areaTotalConstruccion: cleanMoney(findValueAfterLabel(lines, 'ÁREA TOTAL DE CONSTRUCCIÓN')),
    areaCerrada: cleanMoney(findValueAfterLabel(lines, 'AREA CERRADA')),
    areaAbierta: cleanMoney(findValueAfterLabel(lines, 'AREA ABIERTA')),

    precioVenta: cleanMoney(findValueAfterLabel(lines, 'PRECIO TOTAL DE VENTA US$')),
    valorMejoras: cleanMoney(findValueAfterLabel(lines, 'VALOR DE MEJORAS')),
    valorTerreno: cleanMoney(findValueAfterLabel(lines, 'VALOR DE TERRENO')),
    numeroFinca: findValueAfterLabel(lines, 'FINCA'),
    fechaProbableEntrega: findValueAfterLabel(lines, 'FECHA PROBABLE DE ENTREGA'),

    montoFinanciamientoCPP: cleanMoney(findValueAfterLabel(lines, 'MONTO DEL FINANCIAMIENTO US$')),
    cesionAFavorDe: findValueAfterLabel(lines, 'CESION A FAVOR DE'),
    porcentajeFinanciamiento: cleanPercent(findValueAfterLabel(lines, 'PORCENTAJE DEL FINANCIAMIENTO')),
    abonoInicial: cleanMoney(findValueAfterLabel(lines, 'ABONO INICIAL US$')),
  };
}

function detectDocumentType(lines) {
  const joined = compactLabel(lines.join(' '));

  // Primero ficha cliente, porque dentro de la ficha aparece "PROFORMA SOLICITADA POR"
  if (joined.includes('FICHA DE CLIENTE') || joined.includes('FICHA DE CLIENTES')) {
    return 'ficha_cliente';
  }

  // Proforma real
  if (joined.includes('PRO-FORMA') || joined.includes('PRO FORMA')) {
    return 'proforma';
  }

  return 'desconocido';
}

async function attachProjectByUnitId(req, res, next) {
  try {
    const { unitId } = req.params;

    const unit = await Unit.findById(unitId).lean();
    if (!unit) return res.status(404).json({ error: 'Unidad no existe' });

    const projectId = unit.projectId;

    const project = await Project.findOne({
      _id: projectId,
      tenantKey: req.tenantKey,
    }).lean();

    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    req.unit = unit;
    req.project = project;
    req.projectId = project._id;

    next();
  } catch (e) {
    return res.status(400).json({ error: 'unitId inválido' });
  }
}

async function syncProjectKpisSafe(req, projectId) {
  try {
    await recomputeCommercialKpis({
      tenantKey: req.tenantKey,
      projectId,
    });
  } catch (e) {
    console.warn('[import-word] recomputeCommercialKpis failed:', e?.message || e);
  }
}

/* =========================================================================
   POST /api/import-word/preview/:unitId
   ========================================================================= */
router.post(
  '/preview/:unitId',
  upload.single('file'),
  attachProjectByUnitId,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No se subió ningún archivo Word' });
      }

      const result = await mammoth.extractRawText({
        buffer: req.file.buffer,
      });

      const rawText = result.value || '';
      const lines = textLines(rawText);
      const type = detectDocumentType(lines);

      let detected = {};

      if (type === 'proforma') {
        detected = detectProforma(lines);
      } else if (type === 'ficha_cliente') {
        detected = detectFichaCliente(lines);
      } else {
        detected = {
          observacionCliente: 'No se pudo detectar si el documento es ficha de cliente o proforma.',
        };
      }

      detected = buildFullImportPreview(type, detected);

return res.json({
  ok: true,
  type,
  unitId: req.params.unitId,
  projectId: req.projectId,
  detected,
});
    } catch (e) {
      console.error('[import-word preview]', e);
      return res.status(500).json({
        error: 'Error leyendo Word',
        detail: e.message,
      });
    }
  }
);

/* =========================================================================
   POST /api/import-word/apply/:unitId
   ========================================================================= */
router.post(
  '/apply/:unitId',
  attachProjectByUnitId,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    try {
      const { unitId } = req.params;
      const data = pickAllowed(req.body?.data || {});

      if (!Object.keys(data).length) {
        return res.status(400).json({ error: 'No hay datos válidos para importar' });
      }

      const unit = req.unit;

      if (!data.manzana && unit.manzana) data.manzana = unit.manzana;
      if (!data.lote && unit.lote) data.lote = unit.lote;

      if (!data.clienteNombre) {
        data.clienteNombre = [
          data.primerNombre,
          data.segundoNombre,
          data.primerApellido,
          data.segundoApellido,
        ].filter(Boolean).join(' ');
      }

      const venta = await Venta.findOneAndUpdate(
        {
          tenantKey: req.tenantKey,
          projectId: req.projectId,
          unitId,
        },
        {
          $set: {
            ...data,
            tenantKey: req.tenantKey,
            projectId: req.projectId,
            unitId,
            deletedAt: null,
          },
        },
        {
          new: true,
          upsert: true,
          runValidators: true,
        }
      );

      await syncProjectKpisSafe(req, req.projectId);

      const dto = await Venta.findById(venta._id).lean();

      return res.json({
        ok: true,
        venta: dto,
      });
    } catch (e) {
      console.error('[import-word apply]', e);
      return res.status(400).json({
        error: 'Error aplicando datos importados',
        detail: e.message,
      });
    }
  }
);

module.exports = router;