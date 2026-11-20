'use strict';
const express = require('express');
const router = express.Router();

const Venta = require('../models/Venta');
const FallenSale = require('../models/FallenSale');
const Project = require('../models/Project'); // ROLE-SEP
const Unit = require('../models/Unit'); // ROLE-SEP
const Document = require('../models/Document');
const { requireProjectAccess } = require('../middleware/rbac'); // ROLE-SEP
const { recomputeCommercialKpis } = require('../services/comercial_kpis');
const { customerPaymentSummary } = require('../services/customerPayments');
const audit = require('../utils/audit');
const { recordAutomaticFallenSale, primaryClientName, secondaryClientName } = require('../services/fallenSales');
const {
  syncUnitCommercialState,
  syncManyUnitCommercialStates
} = require('../services/unitCommercialState');

// --- Whitelist de campos permitidos (coincide con tu schema Venta) ---
const ALLOWED_FIELDS = new Set([
  // básicos / legacy
  'clienteNombre', 'cedula', 'empresa',
  'manzana', 'lote',
  'valor',
  'checklist',

  // cliente 1
  'primerNombre', 'segundoNombre', 'primerApellido', 'segundoApellido', 'apellidoCasada',
  'sexo', 'profesion', 'estadoCivil', 'direccion',
  'telefonoResidencial', 'telefonoOficina', 'celular', 'correo',
  'perfilCliente', 'tipoEmpresa', 'sectorEmpresa',
  'lugarTrabajo', 'ingresoMensual', 'cargo', 'antiguedadLaboral',

  // cliente 2
  'cliente2PrimerNombre', 'cliente2SegundoNombre', 'cliente2PrimerApellido',
  'cliente2SegundoApellido', 'cliente2ApellidoCasada', 'cliente2Cedula',
  'cliente2Sexo', 'cliente2Profesion', 'cliente2EstadoCivil', 'cliente2Direccion',
  'cliente2TelefonoResidencial', 'cliente2TelefonoOficina', 'cliente2Celular', 'cliente2Correo',
  'cliente2LugarTrabajo', 'cliente2IngresoMensual', 'cliente2Cargo', 'cliente2AntiguedadLaboral',
  'cliente2PerfilCliente', 'cliente2TipoEmpresa',

  // parientes / referencias
  'pariente1Nombre', 'pariente1Parentesco', 'pariente1Telefono', 'pariente1TelefonoTrabajo',
  'pariente2Nombre', 'pariente2Parentesco', 'pariente2Telefono', 'pariente2TelefonoTrabajo',
  'referencia1Nombre', 'referencia1Relacion', 'referencia1Telefono', 'referencia1TelefonoTrabajo',
  'referencia2Nombre', 'referencia2Relacion', 'referencia2Telefono', 'referencia2TelefonoTrabajo',

  // inmueble
  'numeroFinca', 'codigoUbicacion', 'ubicacion', 'calle',
  'metrajeLote', 'loteEsquina', 'metrosExtra', 'precioLoteEsquina', 'precioM2Extra',
  'areaAbierta', 'areaCerrada', 'areaTotalConstruccion', 'recamaras', 'banos',
  'valorMejoras', 'valorTerreno', 'fechaProbableEntrega', 'fechaReserva',

  // banco / cpp / financiación
  'modalidadFinanciamiento',
  'banco', 'oficialBanco', 'statusBanco', 'estatusCPP', 'numCPP',
  'montoFinanciamientoCPP', 'precioVenta',
  'porcentajeFinanciamiento', 'cesionAFavorDe',
  'entregaExpedienteBanco', 'recibidoCPP', 'plazoAprobacionDias',
  'fechaValorCPP', 'fechaVencimientoCPP', 'vencimientoCPPBnMivi',
  'fechaEntregaProformaBanco', 'fechaProforma',
  'aperturaCtaBanco', 'primeraMensual', 'pagoMinuta', 'tiempoAprobacionDias',
  'polizas', 'tipoPoliza', 'polizaVida',
  'polizaVidaEntregada', 'tipoPolizaVida',
  'polizaIncendioEntregada', 'tipoPolizaIncendio', 'abonoAlte',

  // contrato / protocolo / notaría / RP
  'fechaContratoCliente', 'estatusContrato', 'montoContrato', 'pagare', 'pagares',
  'fechaFirma', 'contratoFirmado', 'fechaActivacionTramite',
  'protocoloFirmaCliente', 'protocoloFirmaPromotora', 'fechaEntregaBanco',
  'fechaProtocoloFirmaCliente', 'fechaProtocoloFirmaPromotora',
  'protocoloFirmaRLBancoInter', 'fechaRegresoBanco', 'diasTranscurridosBanco',
  'fechaProtocoloFirmaBancoInterino',
  'fechaEntregaProtocoloBancoCli', 'firmaProtocoloBancoCliente',
  'fechaProtocoloFirmaBancoCliente',
  'fechaRegresoProtocoloBancoCli', 'diasTranscurridosProtocolo',
  'cierreNotaria', 'fechaCierreEscritura', 'pagoImpuestos', 'fechaPagoImpuesto',
  'ingresoRP', 'fechaIngresoRP', 'fechaInscripcion',
  'solicitudDesembolso', 'fechaDesembolso', 'fechaRecibidoCheque',

  // MIVI
  'expedienteMIVI', 'entregaExpMIVI', 'resolucionMIVI',
  'fechaResolucionMIVI', 'solicitudMiviDesembolso',
  'desembolsoMivi', 'fechaPagoMivi',

  // técnico / obra / permisos
  'enConstruccion', 'estatusConstruccion', 'faseConstruccion', 'avanceConstruccionPct',
  'permisoConstruccionMunicipal', 'permisoConstruccionNum',
  'fechaPermisoConstruccion', 'permisoConstruccionVencimiento',
  'permisoOcupacion', 'permisoOcupacionNum', 'fechaEmisionPermisoOcupacion',
  'constructora',

  // legal / avalúo / minutas / paz y salvo
  'solicitudAvaluo', 'avaluoRealizado', 'fechaAvaluo', 'empresaAvaluadora',
  'mLiberacion', 'mSegregacion', 'mPrestamo',

  // entrega / otros
  'entregaCasa', 'entregaANATI', 'fechaEntregaVivienda',
  'comentario',

  // captación / proforma
  'canalCaptacion',
  'captadoAtencionOficina', 'captadoMailInternet',
  'captadoEnProyecto', 'captadoMercadeoProspecto',
  'proformaSolicitadaPor', 'referidoPor', 'observacionCliente'
]);
const TECHNICAL_FIELDS = new Set([
  'manzana', 'lote', 'numeroFinca', 'codigoUbicacion', 'ubicacion', 'calle',
  'metrajeLote', 'metrosExtra', 'precioM2Extra', 'areaAbierta', 'areaCerrada',
  'areaTotalConstruccion', 'recamaras', 'banos', 'valorMejoras', 'valorTerreno',
  'enConstruccion', 'estatusConstruccion', 'faseConstruccion', 'avanceConstruccionPct',
  'permisoConstruccionMunicipal', 'permisoConstruccionNum',
  'fechaPermisoConstruccion', 'permisoConstruccionVencimiento',
  'permisoOcupacion', 'permisoOcupacionNum', 'fechaEmisionPermisoOcupacion',
  'constructora'
]);

const DESIST_PRESERVED_FIELDS = new Set([
  '_id', '__v', 'projectId', 'unitId', 'tenantKey', 'createdAt', 'updatedAt', 'deletedAt',
  'manzana', 'lote', 'numeroFinca', 'codigoUbicacion', 'ubicacion', 'calle',
  'metrajeLote', 'loteEsquina', 'metrosExtra', 'precioLoteEsquina', 'precioM2Extra',
  'areaAbierta', 'areaCerrada', 'areaTotalConstruccion', 'recamaras', 'banos',
  'valorMejoras', 'valorTerreno',
  'enConstruccion', 'estatusConstruccion', 'faseConstruccion', 'avanceConstruccionPct',
  'permisoConstruccionMunicipal', 'permisoConstruccionNum',
  'fechaPermisoConstruccion', 'permisoConstruccionVencimiento',
  'permisoOcupacion', 'permisoOcupacionNum', 'fechaEmisionPermisoOcupacion', 'constructora'
]);

const STEP_STATES = ['pendiente', 'en_proceso', 'completado', 'bloqueado'];

function sanitizeChecklist(input) {
  if (!Array.isArray(input)) return [];
  return input.map(s => ({
    code: String(s.code || '').trim(),
    state: STEP_STATES.includes(s.state) ? s.state : 'pendiente',
    note: String(s.note || ''),
    dueAt: s.dueAt ? new Date(s.dueAt) : undefined,
    doneAt: s.doneAt ? new Date(s.doneAt) : undefined,
  })).filter(x => x.code);
}

function cleanDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function sanitizeCustomerPaymentAccounts(input) {
  if (!Array.isArray(input)) return [];
  let hasSaleGap = false;
  return input.slice(0, 30).map(account => {
    const source = account?.source === 'sale_gap' && !hasSaleGap ? 'sale_gap' : 'manual';
    if (source === 'sale_gap') hasSaleGap = true;
    return {
      ...(String(account?._id || '').match(/^[a-f\d]{24}$/i) ? { _id: account._id } : {}),
      source,
      concept: String(account?.concept || (source === 'sale_gap' ? 'Abono del cliente' : '')).trim().slice(0, 120),
      agreedAmount: source === 'sale_gap' ? 0 : Math.max(0, Number(account?.agreedAmount) || 0),
      recipient: ['bank', 'promoter', 'other'].includes(account?.recipient) ? account.recipient : 'promoter',
      requiredForClearance: account?.requiredForClearance !== false,
      payments: (Array.isArray(account?.payments) ? account.payments : []).slice(0, 500).map(payment => ({
        ...(String(payment?._id || '').match(/^[a-f\d]{24}$/i) ? { _id: payment._id } : {}),
        paymentDate: cleanDate(payment?.paymentDate),
        recipient: ['bank', 'promoter', 'other'].includes(payment?.recipient)
          ? payment.recipient
          : (['bank', 'promoter', 'other'].includes(account?.recipient) ? account.recipient : 'promoter'),
        receiptNumber: String(payment?.receiptNumber || '').trim().slice(0, 80),
        amount: Math.max(0, Number(payment?.amount) || 0)
      })).filter(payment => payment.paymentDate && payment.amount > 0)
    };
  }).filter(account => account.source === 'sale_gap' || account.concept);
}

function sanitizePagares(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 100).map(item => {
    const cobrado = item?.cobrado === true;
    return {
      ...(String(item?._id || '').match(/^[a-f\d]{24}$/i) ? { _id: item._id } : {}),
      numero: String(item?.numero || '').trim().slice(0, 80),
      monto: Math.max(0, Number(item?.monto) || 0),
      fechaVencimiento: cleanDate(item?.fechaVencimiento),
      cobrado,
      cobradoAt: cobrado ? (cleanDate(item?.cobradoAt) || new Date()) : null
    };
  }).filter(item => item.numero || item.monto > 0 || item.fechaVencimiento);
}

function assertCustomerPaymentsFitSale(venta = {}) {
  const summary = customerPaymentSummary(venta);
  if (summary.totals.overpaid > 0.01) {
    const error = new Error('El cambio dejaría pagos por encima del total acordado. Revisa primero el precio, la CPP o los recibos del cliente.');
    error.statusCode = 400;
    throw error;
  }
  return summary;
}

function pickAllowed(obj = {}) {
  const out = {};
  for (const k in obj) {
    if (ALLOWED_FIELDS.has(k)) out[k] = obj[k];
  }
  if (Object.hasOwn(out, 'polizaVidaEntregada') && Object.hasOwn(out, 'polizaIncendioEntregada')) {
    out.polizas = out.polizaVidaEntregada === true && out.polizaIncendioEntregada === true;
  }
  if (Object.hasOwn(out, 'canalCaptacion')) {
    const channel = String(out.canalCaptacion || '').trim();
    out.canalCaptacion = channel;
    out.captadoAtencionOficina = channel === 'Oficina';
    out.captadoMailInternet = false;
    out.captadoEnProyecto = channel === 'En proyecto';
    out.captadoMercadeoProspecto = channel === 'Mercadeo / volanteo';
  }
  if (Object.hasOwn(out, 'pagares')) {
    out.pagares = sanitizePagares(out.pagares);
  }
  return out;
}

function pickAllowedForRole(obj = {}, role = '') {
  const allowed = pickAllowed(obj);
  if (String(role || '').toLowerCase() !== 'tecnico') return allowed;
  return Object.fromEntries(Object.entries(allowed).filter(([key]) => TECHNICAL_FIELDS.has(key)));
}

function ventaForRole(venta = {}, role = '') {
  if (String(role || '').toLowerCase() !== 'tecnico') return venta;
  const technical = Object.fromEntries(Object.entries(venta).filter(([key]) => TECHNICAL_FIELDS.has(key)));
  return {
    _id: venta._id,
    projectId: venta.projectId,
    unitId: venta.unitId,
    createdAt: venta.createdAt,
    updatedAt: venta.updatedAt,
    ...technical
  };
}

function fallenSaleForRole(item = {}, role = '') {
  if (String(role || '').toLowerCase() !== 'tecnico') return item;
  return {
    _id: item._id,
    projectId: item.projectId,
    unitId: item.unitId,
    unidadLabel: item.unidadLabel,
    manzana: item.manzana,
    lote: item.lote,
    modelo: item.modelo,
    fechaCaida: item.fechaCaida,
    motivoCaida: item.motivoCaida,
    origen: item.origen,
    legacy: item.legacy === true,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

// ROLE-SEP: marcar este router como "ventas" para el guard de comerciales
router.use((req, _res, next) => { req.isSalesRoute = true; next(); }); // ROLE-SEP

// ROLE-SEP: helpers para cargar proyecto en req.project
async function attachProjectByProjectId(req, res, next) {
  try {
    const projectId = req.body?.projectId || req.query?.projectId;
    if (!projectId) return res.status(400).json({ error: 'projectId requerido' });

    const proj = await Project.findOne({ _id: projectId, tenantKey: req.tenantKey }).lean();
    if (!proj) return res.status(404).json({ error: 'Proyecto no encontrado' });

    req.project = proj;
    next();
  } catch (e) {
    return res.status(400).json({ error: 'projectId inválido' });
  }
}

async function attachProjectByVenta(req, res, next) {
  try {
    const v = await Venta.findOne({
      _id: req.params.id,
      tenantKey: req.tenantKey,
      deletedAt: null
    }).lean();

    if (!v) return res.status(404).json({ error: 'No existe' });

    const proj = await Project.findOne({ _id: v.projectId, tenantKey: req.tenantKey }).lean();
    if (!proj) return res.status(404).json({ error: 'Proyecto no encontrado' });

    req.project = proj;
    req._venta = v;
    next();
  } catch (e) {
    return res.status(400).json({ error: 'ID inválido' });
  }
}

async function attachProjectByUnitIdFromVenta(req, res, next) {
  try {
    const { unitId } = req.params;
    let unit = await Unit.findOne({ _id: unitId, tenantKey: req.tenantKey }).lean();
    if (!unit && String(req.user?.role || '').toLowerCase() === 'bank' && ['GET', 'HEAD'].includes(req.method)) {
      unit = await Unit.findById(unitId).lean();
    }
    if (!unit) return res.status(404).json({ error: 'Unidad no existe' });

    const proj = await Project.findById(unit.projectId).lean();
    if (!proj) return res.status(404).json({ error: 'Proyecto no encontrado' });

    req.project = proj;
    req._unit = unit;
    req._venta = await Venta.findOne({
      tenantKey: req.tenantKey,
      unitId: unit._id,
      projectId: proj._id,
      deletedAt: null
    }).lean();

    next();
  } catch (e) {
    return res.status(400).json({ error: 'ID inválido' });
  }
}

async function syncProjectKpisSafe(req, projectId) {
  try {
    await recomputeCommercialKpis({ tenantKey: req.tenantKey, projectId });
  } catch (e) {
    console.warn('[ventas] recomputeCommercialKpis failed:', e?.message || e);
  }
}

async function resolveFallenSaleRecord(req, rawId) {
  const id = String(rawId || '');
  if (!id.startsWith('legacy:')) {
    return FallenSale.findOne({
      _id: id,
      tenantKey: req.tenantKey,
      projectId: req.project._id,
      deletedAt: null
    });
  }

  const ventaId = id.slice('legacy:'.length);
  const venta = await Venta.findOne({
    _id: ventaId,
    tenantKey: req.tenantKey,
    projectId: req.project._id,
    deletedAt: null,
    estadoVenta: 'caida'
  }).lean();
  if (!venta) return null;
  const unit = await Unit.findOne({
    _id: venta.unitId,
    tenantKey: req.tenantKey,
    projectId: req.project._id
  }).lean();
  return recordAutomaticFallenSale({
    tenantKey: req.tenantKey,
    projectId: req.project._id,
    venta,
    unit: unit || {},
    fechaCaida: venta.fechaCaida || venta.updatedAt || venta.createdAt || new Date(),
    motivoCaida: venta.motivoCaida || 'Venta caída registrada anteriormente',
    createdBy: req.user?._id
  }, { reuseExisting: true });
}

/* =========================================================================
   GET /ventas?projectId=...
   ========================================================================= */
router.get(
  '/',
  requireProjectAccess(),
  attachProjectByProjectId,
  async (req, res) => {
    try {
      const { projectId } = req.query;

      const list = await Venta.find({
        tenantKey: req.tenantKey,
        projectId,
        deletedAt: null
      }).sort({ createdAt: -1 }).lean();

      res.json(list.map(item => ventaForRole(item, req.user?.role)));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

/* =========================================================================
   HISTORIAL DE VENTAS CAIDAS
   ========================================================================= */
router.get(
  '/fallen',
  attachProjectByProjectId,
  requireProjectAccess(),
  async (req, res) => {
    try {
      const projectId = req.project._id;
      const [storedAll, legacy] = await Promise.all([
        FallenSale.find({ tenantKey: req.tenantKey, projectId }).sort({ fechaCaida: -1, createdAt: -1 }).lean(),
        Venta.find({ tenantKey: req.tenantKey, projectId, deletedAt: null, estadoVenta: 'caida' }).lean()
      ]);

      const stored = storedAll.filter(item => !item.deletedAt);
      const storedSources = new Set(storedAll.map(item => String(item.sourceVentaId || '')).filter(Boolean));
      const legacyRows = legacy
        .filter(venta => !storedSources.has(String(venta._id)))
        .map(venta => ({
          _id: `legacy:${venta._id}`,
          projectId,
          unitId: venta.unitId,
          sourceVentaId: venta._id,
          unidadLabel: [venta.manzana, venta.lote].filter(Boolean).join('-'),
          manzana: venta.manzana || '',
          lote: venta.lote || '',
          clienteNombre: primaryClientName(venta),
          cedula: venta.cedula || '',
          celular: venta.celular || '',
          correo: venta.correo || '',
          cliente2Nombre: secondaryClientName(venta),
          cliente2Cedula: venta.cliente2Cedula || '',
          fechaCaida: venta.fechaCaida || venta.updatedAt || venta.createdAt,
          motivoCaida: venta.motivoCaida || 'Venta caida registrada anteriormente',
          observaciones: '',
          precioVenta: Number(venta.precioVenta || venta.valor || 0),
          banco: venta.banco || '',
          origen: 'automatico',
          legacy: true,
          createdAt: venta.createdAt,
          updatedAt: venta.updatedAt
        }));

      const rows = [...stored, ...legacyRows]
        .sort((a, b) => new Date(b.fechaCaida || 0) - new Date(a.fechaCaida || 0))
        .map(item => fallenSaleForRole(item, req.user?.role));
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.post(
  '/fallen',
  attachProjectByProjectId,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    try {
      const data = req.body || {};
      const fechaCaida = new Date(data.fechaCaida);
      if (Number.isNaN(fechaCaida.getTime())) return res.status(400).json({ error: 'Fecha de desistimiento invalida' });

      const clienteNombre = String(data.clienteNombre || '').trim();
      if (!clienteNombre) return res.status(400).json({ error: 'El nombre del cliente es obligatorio' });

      let unit = null;
      if (data.unitId) {
        unit = await Unit.findOne({
          _id: data.unitId,
          tenantKey: req.tenantKey,
          projectId: req.project._id,
          deletedAt: null
        }).lean();
        if (!unit) return res.status(400).json({ error: 'La unidad seleccionada no pertenece al proyecto' });
      }

      const cleanText = (value, max = 500) => String(value || '').trim().slice(0, max);
      const item = await FallenSale.create({
        tenantKey: req.tenantKey,
        projectId: req.project._id,
        unitId: unit?._id || null,
        unidadLabel: unit
          ? ([unit.manzana, unit.lote].filter(Boolean).join('-') || unit.code || '')
          : cleanText(data.unidadLabel, 120),
        manzana: cleanText(unit?.manzana || data.manzana, 80),
        lote: cleanText(unit?.lote || data.lote, 80),
        modelo: cleanText(unit?.modelo || data.modelo, 120),
        clienteNombre: cleanText(clienteNombre, 200),
        cedula: cleanText(data.cedula, 80),
        celular: cleanText(data.celular, 80),
        correo: cleanText(data.correo, 200),
        cliente2Nombre: cleanText(data.cliente2Nombre, 200),
        cliente2Cedula: cleanText(data.cliente2Cedula, 80),
        fechaCaida,
        motivoCaida: cleanText(data.motivoCaida || 'Desistimiento del cliente', 300),
        observaciones: cleanText(data.observaciones, 2000),
        precioVenta: Math.max(0, Number(data.precioVenta || 0)),
        banco: cleanText(data.banco, 160),
        origen: 'manual',
        createdBy: req.user?._id || null
      });

      await audit(req, 'sale.fallen_manual_created', {
        targetType: 'fallen_sale', targetId: item._id, projectId: req.project._id,
        status: 'warning', message: 'Venta caida historica registrada manualmente',
        metadata: { unitId: item.unitId, fechaCaida: item.fechaCaida }
      });
      res.status(201).json(item.toObject());
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.patch(
  '/fallen/:id',
  attachProjectByProjectId,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    try {
      const motivoCaida = String(req.body?.motivoCaida || '').trim().slice(0, 300);
      if (!motivoCaida) return res.status(400).json({ error: 'El motivo es obligatorio' });
      const record = await resolveFallenSaleRecord(req, req.params.id);
      if (!record || record.deletedAt) return res.status(404).json({ error: 'Venta caída no encontrada' });
      record.motivoCaida = motivoCaida;
      await record.save();
      await audit(req, 'sale.fallen_reason_updated', {
        targetType: 'fallen_sale', targetId: record._id, projectId: req.project._id,
        message: 'Motivo de venta caída actualizado', metadata: { motivoCaida }
      });
      res.json(record.toObject());
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.delete(
  '/fallen/:id',
  attachProjectByProjectId,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    try {
      const record = await resolveFallenSaleRecord(req, req.params.id);
      if (!record || record.deletedAt) return res.status(404).json({ error: 'Venta caída no encontrada' });
      record.deletedAt = new Date();
      record.deletedBy = req.user?._id || null;
      await record.save();
      await audit(req, 'sale.fallen_deleted', {
        targetType: 'fallen_sale', targetId: record._id, projectId: req.project._id,
        status: 'warning', message: 'Venta caída eliminada del histórico visible',
        metadata: { sourceVentaId: record.sourceVentaId, unitId: record.unitId }
      });
      res.json({ ok: true, id: String(record._id) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.put(
  '/by-unit/:unitId/customer-payments',
  attachProjectByUnitIdFromVenta,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    try {
      const accounts = sanitizeCustomerPaymentAccounts(req.body?.customerPaymentAccounts);
      const expectedVersion = Math.max(0, Number(req.body?.customerPaymentsVersion) || 0);
      assertCustomerPaymentsFitSale({ ...(req._venta || {}), customerPaymentAccounts: accounts });
      const updated = await Venta.findOneAndUpdate(
        {
          tenantKey: req.tenantKey,
          projectId: req.project._id,
          unitId: req.params.unitId,
          deletedAt: null,
          $or: [
            { customerPaymentsVersion: expectedVersion },
            ...(expectedVersion === 0 ? [{ customerPaymentsVersion: { $exists: false } }] : [])
          ]
        },
        { $set: { customerPaymentAccounts: accounts }, $inc: { customerPaymentsVersion: 1 } },
        { new: true, runValidators: true }
      );
      if (!updated) return res.status(409).json({ error: 'Los abonos cambiaron en otra sesión. Cierra y vuelve a abrir el seguimiento antes de guardar.' });
      await syncProjectKpisSafe(req, req.project._id);
      const dto = updated.toObject ? updated.toObject() : updated;
      const summary = customerPaymentSummary(dto);
      await audit(req, 'sale.customer_payments_updated', {
        targetType: 'sale', targetId: updated._id, projectId: req.project._id,
        message: 'Historial de abonos del cliente actualizado',
        metadata: { accounts: accounts.length, paid: summary.totals.paid, balance: summary.totals.balance }
      });
      res.json({ venta: dto, customerPayments: summary });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

router.post(
  '/by-unit/:unitId/desist-client',
  attachProjectByUnitIdFromVenta,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    try {
      const venta = req._venta;
      if (!venta) return res.status(404).json({ error: 'No existe expediente comercial para esta unidad' });

      const now = new Date();
      const motivoCaida = String(req.body?.motivoCaida || 'Cliente desistió desde la ficha comercial').trim().slice(0, 300);
      await recordAutomaticFallenSale({
        tenantKey: req.tenantKey,
        projectId: req.project._id,
        venta,
        unit: req._unit || {},
        fechaCaida: now,
        motivoCaida,
        createdBy: req.user?._id
      });

      const unset = {};
      Object.keys(Venta.schema.paths).forEach(field => {
        if (!field.includes('.') && !DESIST_PRESERVED_FIELDS.has(field)) unset[field] = 1;
      });
      const set = {
        customerPaymentAccounts: [],
        customerPaymentsVersion: 0,
        pagares: [],
        checklist: [],
        estadoVenta: 'caida',
        fechaCaida: now,
        motivoCaida
      };
      Object.keys(set).forEach(field => delete unset[field]);

      const updated = await Venta.findOneAndUpdate(
        { _id: venta._id, tenantKey: req.tenantKey, deletedAt: null },
        { $unset: unset, $set: set },
        { new: true, runValidators: true }
      );
      if (!updated) return res.status(404).json({ error: 'No existe expediente comercial para esta unidad' });

      const baseState = Number(updated.avanceConstruccionPct || 0) > 0 ? 'inventario' : 'disponible';
      const baseReason = baseState === 'inventario'
        ? 'Cliente desistió; la unidad vuelve a inventario con construcción iniciada'
        : 'Cliente desistió; la unidad vuelve a estar disponible';
      const unit = await Unit.findOneAndUpdate(
        { _id: req.params.unitId, tenantKey: req.tenantKey, projectId: req.project._id, deletedAt: null },
        { $set: {
          estado: baseState,
          status: baseState.toUpperCase(),
          estadoModo: 'automatico',
          estadoManualAt: null,
          estadoManualBy: null,
          estadoAutomaticoBase: baseState,
          estadoAutomaticoSugerido: baseState,
          estadoAutomaticoMotivo: baseReason,
          estadoAutomaticoActualizadoAt: now
        } },
        { new: true }
      );

      const archiveCategory = `withdrawnClient:${now.toISOString()}`;
      const archivedDocuments = await Document.updateMany(
        {
          tenantKey: req.tenantKey,
          projectId: req.project._id,
          unitId: req.params.unitId,
          department: 'commercial',
          category: /^commercialSale(?:Field|Stage):/
        },
        { $set: {
          category: archiveCategory,
          status: 'COMPLETED',
          completedAt: now,
          completionNote: 'Archivado automáticamente por desistimiento del cliente'
        } }
      );

      const project = await Project.findOne({ _id: req.project._id, tenantKey: req.tenantKey });
      if (project) {
        const ventaId = String(venta._id);
        project.expiryAlertResolutions = (project.expiryAlertResolutions || []).filter(item => {
          const sourceId = String(item?.sourceId || '');
          return !(sourceId === ventaId || sourceId.startsWith(`${ventaId}:`));
        });
        await project.save();
      }

      await syncProjectKpisSafe(req, req.project._id);
      await audit(req, 'sale.client_withdrawn', {
        targetType: 'sale',
        targetId: venta._id,
        projectId: req.project._id,
        status: 'warning',
        message: 'Cliente desistido y expediente comercial limpiado',
        metadata: {
          unitId: req.params.unitId,
          archivedDocuments: archivedDocuments.modifiedCount || 0,
          preservedState: baseState
        }
      });

      res.json({
        ok: true,
        venta: updated.toObject(),
        unit,
        archivedDocuments: archivedDocuments.modifiedCount || 0
      });
    } catch (error) {
      console.error('[ventas.desist-client] error:', error);
      res.status(500).json({ error: 'No se pudo procesar el desistimiento del cliente' });
    }
  }
);

/* =========================================================================
   GET /ventas/by-unit/:unitId
   ========================================================================= */
router.get(
  '/by-unit/:unitId',
  attachProjectByUnitIdFromVenta,
  requireProjectAccess(),
  async (req, res) => {
    try {
      const v = req._venta || await Venta.findOne({
        tenantKey: req.tenantKey,
        unitId: req.params.unitId,
        deletedAt: null
      }).lean();

      if (!v) return res.status(404).json({ error: 'No existe' });
      res.json(ventaForRole(v, req.user?.role));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

/* =========================================================================
   POST /ventas (crear o reactivar si ya existe por unitId)
   ========================================================================= */
router.post(
  '/',
  attachProjectByProjectId,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    try {
      const { projectId, unitId } = req.body || {};
      const resetAutomaticState = req.body?.resetAutomaticState === true;
      if (!projectId || !unitId) {
        return res.status(400).json({ error: 'projectId y unitId requeridos' });
      }

      const base = pickAllowedForRole(req.body, req.user?.role);
      base.projectId = projectId;
      base.unitId = unitId;
      base.tenantKey = req.tenantKey;
      base.deletedAt = null;

      if ('checklist' in req.body) {
        base.checklist = sanitizeChecklist(req.body.checklist);
      }

      const u = await Unit.findOne({ _id: unitId, tenantKey: req.tenantKey, projectId }).select('manzana lote').lean();
      if (u) {
        base.manzana = base.manzana || u.manzana;
        base.lote = base.lote || u.lote;
      }

      const existing = await Venta.findOne({ tenantKey: req.tenantKey, projectId, unitId, deletedAt: null }).lean();
      assertCustomerPaymentsFitSale({ ...(existing || {}), ...base });

      const saved = await Venta.findOneAndUpdate(
        {
          tenantKey: req.tenantKey,
          projectId,
          unitId
        },
        {
          $set: {
            ...base,
            deletedAt: null
          }
        },
        { new: true, upsert: true, runValidators: true }
      );

      await syncUnitCommercialState({
        tenantKey: req.tenantKey,
        projectId,
        unitId,
        venta: saved.toObject ? saved.toObject() : saved,
        resetAutomatic: resetAutomaticState
      });

      await syncProjectKpisSafe(req, projectId);

      const dto = await Venta.findById(saved._id).lean();
      res.json(dto);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

/* =========================================================================
   POST /ventas/upsert-by-unit (crear/actualizar por unitId)
   ========================================================================= */
router.post(
  '/upsert-by-unit',
  attachProjectByProjectId,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    try {
      const { projectId, unitId, ...data } = req.body || {};
      const resetAutomaticState = data.resetAutomaticState === true;
      if (!projectId || !unitId) {
        return res.status(400).json({ error: 'projectId y unitId requeridos' });
      }

      const set = pickAllowedForRole(data, req.user?.role);
      set.tenantKey = req.tenantKey;

      if ('checklist' in data) {
        set.checklist = sanitizeChecklist(data.checklist);
      }

      if (!set.manzana || !set.lote) {
        const u = await Unit.findOne({ _id: unitId, tenantKey: req.tenantKey, projectId }).select('manzana lote').lean();
        if (u) {
          if (!set.manzana) set.manzana = u.manzana;
          if (!set.lote) set.lote = u.lote;
        }
      }

      const existing = await Venta.findOne({ tenantKey: req.tenantKey, projectId, unitId, deletedAt: null }).lean();
      assertCustomerPaymentsFitSale({ ...(existing || {}), ...set });

      const updated = await Venta.findOneAndUpdate(
        {
          tenantKey: req.tenantKey,
          projectId,
          unitId
        },
        {
          $set: {
            ...set,
            deletedAt: null
          }
        },
        { new: true, upsert: true, runValidators: true }
      );

      await syncUnitCommercialState({
        tenantKey: req.tenantKey,
        projectId,
        unitId,
        venta: updated.toObject ? updated.toObject() : updated,
        resetAutomatic: resetAutomaticState
      });

      await syncProjectKpisSafe(req, projectId);

      const dto = await Venta.findById(updated._id).lean();
      res.json(dto);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

/* =========================================================================
   PATCH /ventas/batch (editar por lote)
   ========================================================================= */
router.patch(
  '/batch',
  attachProjectByProjectId,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    try {
      const { unitIds = [], update = {}, upsert = false, projectId } = req.body || {};
      if (!unitIds.length) return res.status(400).json({ error: 'unitIds requerido' });

      const set = pickAllowedForRole(update, req.user?.role);
      set.tenantKey = req.tenantKey;

      if (Object.hasOwn(set, 'precioVenta') || Object.hasOwn(set, 'montoFinanciamientoCPP') || Object.hasOwn(set, 'valor')) {
        const affected = await Venta.find({ tenantKey: req.tenantKey, projectId, unitId: { $in: unitIds }, deletedAt: null }).lean();
        affected.forEach(venta => assertCustomerPaymentsFitSale({ ...venta, ...set }));
      }

      let modified = 0;
      let created = 0;

      if (upsert) {
        for (const unitId of unitIds) {
          const existed = await Venta.findOne({
            tenantKey: req.tenantKey,
            projectId,
            unitId,
            deletedAt: null
          }).select('_id').lean();

          const r = await Venta.findOneAndUpdate(
            {
              tenantKey: req.tenantKey,
              projectId,
              unitId
            },
            {
              $set: {
                ...set,
                deletedAt: null
              }
            },
            { upsert: true, new: true, runValidators: true }
          );

          if (!existed && r?._id) created++;
          else if (r?._id) modified++;
        }
      } else {
        const r = await Venta.updateMany(
          {
            tenantKey: req.tenantKey,
            projectId,
            unitId: { $in: unitIds },
            deletedAt: null
          },
          {
            $set: set
          },
          { runValidators: true }
        );
        modified = r.modifiedCount || 0;
      }

      await syncManyUnitCommercialStates({
        tenantKey: req.tenantKey,
        projectId,
        unitIds
      });

      await syncProjectKpisSafe(req, projectId);

      res.json({ modified, created });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

/* =========================================================================
   PATCH /ventas/:id
   ========================================================================= */
router.patch(
  '/:id',
  attachProjectByVenta,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    try {
      const set = pickAllowedForRole(req.body, req.user?.role);
      assertCustomerPaymentsFitSale({ ...(req._venta || {}), ...set });

      if ('checklist' in req.body) {
        set.checklist = sanitizeChecklist(req.body.checklist);
      }

      const updated = await Venta.findOneAndUpdate(
        {
          _id: req.params.id,
          tenantKey: req.tenantKey,
          deletedAt: null
        },
        { $set: set },
        { new: true, runValidators: true }
      );

      if (!updated) return res.status(404).json({ error: 'No existe' });

      await syncUnitCommercialState({
        tenantKey: req.tenantKey,
        projectId: updated.projectId,
        unitId: updated.unitId,
        venta: updated.toObject ? updated.toObject() : updated
      });

      await syncProjectKpisSafe(req, updated.projectId);

      const dto = await Venta.findById(updated._id).lean();
      res.json(dto);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

module.exports = router;
