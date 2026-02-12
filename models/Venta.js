// models/Venta.js
'use strict';
const mongoose = require('mongoose');

// --- Subdocumento de checklist ---
const ChecklistStepSchema = new mongoose.Schema({
  code:   { type: String, required: true }, // p.ej. "V-01"
  state:  { type: String, enum: ['pendiente','en_proceso','completado','bloqueado'], default: 'pendiente' },
  note:   { type: String, default: '' },
  dueAt:  { type: Date },
  doneAt: { type: Date }
}, { _id: false });

const VentaSchema = new mongoose.Schema({
  // ====== Claves ======
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true, required: true },
  unitId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Unit',    index: true, required: true },
  tenantKey: { type: String, index: true }, // opcional multi-tenant

  // ====== Identificadores de unidad (espejo de Unit) ======
  manzana:   { type: String, default: '' },
  lote:      { type: String, default: '' },

  // ====== Cliente / Empresa ======
  clienteNombre: { type: String, default: '' },
  cedula:        { type: String, default: '' },
  empresa:       { type: String, default: '' },

  // ====== Banco / CPP ======
  banco:          { type: String, default: '' },
  oficialBanco:   { type: String, default: '' },
  statusBanco:    { type: String, default: '' },
  numCPP:         { type: String, default: '' },
  valor:          { type: Number, default: 0 },

  entregaExpedienteBanco: { type: Date },   // ENTREGA DE EXPEDIENTE A BANCO
  recibidoCPP:            { type: Date },   // RECIBIDO DE CPP
  plazoAprobacionDias:    { type: Number }, // PLAZO APROBACION (días)
  fechaValorCPP:          { type: Date },   // FECHA VALOR DE CPP
  fechaVencimientoCPP:    { type: Date },   // FECHA DE VENCIMIENTO CCP
  vencimientoCPPBnMivi:   { type: Date },   // VENCIMIENTO CPP BN-MIVI

  // ====== Contrato / Protocolo ======
  fechaContratoCliente:   { type: Date },                 // FECHA CONTRATO FIRMADO POR CLIENTE
  estatusContrato:        { type: String, default: '' },  // ESTATUS CTTO
  pagare:                 { type: String, default: '' },  // Si prefieres, cambia a Boolean
  fechaFirma:             { type: Date },                 // FECHA FIRMA

  protocoloFirmaCliente:        { type: Boolean, default: false },
  fechaEntregaBanco:            { type: Date },
  protocoloFirmaRLBancoInter:   { type: Boolean, default: false },
  fechaRegresoBanco:            { type: Date },
  diasTranscurridosBanco:       { type: Number },

  fechaEntregaProtocoloBancoCli: { type: Date },
  firmaProtocoloBancoCliente:     { type: Boolean, default: false },
  fechaRegresoProtocoloBancoCli:  { type: Date },
  diasTranscurridosProtocolo:     { type: Number },

  cierreNotaria:       { type: Date }, // CIERRE DE NOTARIA
  fechaPagoImpuesto:   { type: Date }, // FECHA DE PAGO DE IMPUESTO
  ingresoRP:           { type: Date }, // INGRESO AL RP
  fechaInscripcion:    { type: Date }, // FECHA DE INSCRIPCION

  solicitudDesembolso: { type: Date }, // SOLICITUD DE DESEMBOLSO (banco)
  fechaRecibidoCheque: { type: Date }, // FECHA DE RECIBIDO DE CK

  // ====== MIVI ======
  expedienteMIVI:          { type: String, default: '' },
  entregaExpMIVI:          { type: Date },
  resolucionMIVI:          { type: String, default: '' }, // N° DE RESOLUCION MIVI
  fechaResolucionMIVI:     { type: Date },
  solicitudMiviDesembolso: { type: Date },
  desembolsoMivi:          { type: Number },
  fechaPagoMivi:           { type: Date },

  // ====== Obra / Permisos ======
  enConstruccion:         { type: Boolean, default: false },
  faseConstruccion:       { type: String, default: '' },
  permisoConstruccionNum: { type: String, default: '' }, // N° RESOLUCION
  permisoOcupacion:       { type: Boolean, default: false },
  permisoOcupacionNum:    { type: String, default: '' },
  constructora:           { type: String, default: '' },  

  // ====== Paz y salvo ======
  pazSalvoGesproban: { type: Boolean, default: false },
  pazSalvoPromotora: { type: Boolean, default: false },

  // ====== Otros ======
  mLiberacion:       { type: String, default: '' }, // M. DE LIBERACION
  mSegregacion:      { type: String, default: '' }, // M. SEGREGACION
  mPrestamo:         { type: String, default: '' }, // M. PRESTAMO
  solicitudAvaluo:   { type: Date },
  avaluoRealizado:   { type: Date },
  entregaCasa:       { type: Date },  // ENTREGA DE CASA
  entregaANATI:      { type: Date },  // ENTREGA ANATI

  comentario:        { type: String, default: '' },

  // ====== Checklist (✅ NUEVO) ======
  checklist: { type: [ChecklistStepSchema], default: [] }

}, { timestamps: true });

// Un expediente por unidad y proyecto
VentaSchema.index({ projectId: 1, unitId: 1 }, { unique: true });

module.exports = mongoose.models.Venta || mongoose.model('Venta', VentaSchema);
