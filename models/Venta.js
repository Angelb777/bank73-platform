// models/Venta.js
'use strict';
const mongoose = require('mongoose');

// --- Subdocumento de checklist ---
const ChecklistStepSchema = new mongoose.Schema({
  code:   { type: String, required: true },
  state:  { type: String, enum: ['pendiente','en_proceso','completado','bloqueado'], default: 'pendiente' },
  note:   { type: String, default: '' },
  dueAt:  { type: Date },
  doneAt: { type: Date }
}, { _id: false });

const VentaSchema = new mongoose.Schema({
  // ====== Claves ======
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true, required: true },
  unitId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Unit',    index: true, required: true },
  tenantKey: { type: String, index: true },

  // ====== Identificadores de unidad ======
  manzana: { type: String, default: '' },
  lote:    { type: String, default: '' },

  // =========================================================
  // CLIENTE 1 / SOLICITANTE PRINCIPAL
  // =========================================================
  clienteNombre: { type: String, default: '' }, // legacy/resumen
  cedula:        { type: String, default: '' },
  empresa:       { type: String, default: '' },

  primerNombre:    { type: String, default: '' },
  segundoNombre:   { type: String, default: '' },
  primerApellido:  { type: String, default: '' },
  segundoApellido: { type: String, default: '' },
  apellidoCasada:  { type: String, default: '' },

  sexo:        { type: String, default: '' },
  profesion:   { type: String, default: '' },
  estadoCivil: { type: String, default: '' },
  direccion:   { type: String, default: '' },

  telefonoResidencial: { type: String, default: '' },
  telefonoOficina:     { type: String, default: '' },
  celular:             { type: String, default: '' },
  correo:              { type: String, default: '' },

  perfilCliente: { type: String, default: '' }, // Independiente / Asalariado
  tipoEmpresa:   { type: String, default: '' }, // Privada / Gubernamental
  sectorEmpresa: { type: String, default: '' }, // Agrícola / Profesional / Otros

  lugarTrabajo:      { type: String, default: '' },
  ingresoMensual:    { type: Number, default: 0 },
  cargo:             { type: String, default: '' },
  antiguedadLaboral: { type: String, default: '' },

  // =========================================================
  // CLIENTE 2 / CO-SOLICITANTE
  // =========================================================
  cliente2PrimerNombre:    { type: String, default: '' },
  cliente2SegundoNombre:   { type: String, default: '' },
  cliente2PrimerApellido:  { type: String, default: '' },
  cliente2SegundoApellido: { type: String, default: '' },
  cliente2ApellidoCasada:  { type: String, default: '' },
  cliente2Cedula:          { type: String, default: '' },

  cliente2Sexo:        { type: String, default: '' },
  cliente2Profesion:   { type: String, default: '' },
  cliente2EstadoCivil: { type: String, default: '' },
  cliente2Direccion:   { type: String, default: '' },

  cliente2TelefonoResidencial: { type: String, default: '' },
  cliente2TelefonoOficina:     { type: String, default: '' },
  cliente2Celular:             { type: String, default: '' },
  cliente2Correo:              { type: String, default: '' },

  cliente2LugarTrabajo:      { type: String, default: '' },
  cliente2IngresoMensual:    { type: Number, default: 0 },
  cliente2Cargo:             { type: String, default: '' },
  cliente2AntiguedadLaboral: { type: String, default: '' },

  // =========================================================
  // PARIENTES / REFERENCIAS
  // =========================================================
  pariente1Nombre:          { type: String, default: '' },
  pariente1Parentesco:      { type: String, default: '' },
  pariente1Telefono:        { type: String, default: '' },
  pariente1TelefonoTrabajo: { type: String, default: '' },

  pariente2Nombre:          { type: String, default: '' },
  pariente2Parentesco:      { type: String, default: '' },
  pariente2Telefono:        { type: String, default: '' },
  pariente2TelefonoTrabajo: { type: String, default: '' },

  referencia1Nombre:          { type: String, default: '' },
  referencia1Relacion:        { type: String, default: '' },
  referencia1Telefono:        { type: String, default: '' },
  referencia1TelefonoTrabajo: { type: String, default: '' },

  referencia2Nombre:          { type: String, default: '' },
  referencia2Relacion:        { type: String, default: '' },
  referencia2Telefono:        { type: String, default: '' },
  referencia2TelefonoTrabajo: { type: String, default: '' },

  // =========================================================
  // DATOS DEL BIEN INMUEBLE / LOTE / VIVIENDA
  // =========================================================
  numeroFinca:     { type: String, default: '' },
  codigoUbicacion: { type: String, default: '' },
  ubicacion:       { type: String, default: '' },
  calle:           { type: String, default: '' },

  metrajeLote:       { type: Number, default: 0 },
  loteEsquina:       { type: String, default: '' }, // SI / NO
  metrosExtra:       { type: Number, default: 0 },
  precioLoteEsquina: { type: Number, default: 0 },
  precioM2Extra:     { type: Number, default: 0 },

  areaAbierta:           { type: Number, default: 0 },
  areaCerrada:           { type: Number, default: 0 },
  areaTotalConstruccion: { type: Number, default: 0 },
  recamaras:             { type: Number, default: 0 },
  banos:                 { type: Number, default: 0 },

  valorMejoras: { type: Number, default: 0 },
  valorTerreno: { type: Number, default: 0 },

  fechaProbableEntrega: { type: Date },

  // =========================================================
  // BANCO / CPP / FINANCIAMIENTO
  // =========================================================
  banco:        { type: String, default: '' },
  oficialBanco: { type: String, default: '' },
  statusBanco:  { type: String, default: '' },
  estatusCPP:   { type: String, default: '' },
  numCPP:       { type: String, default: '' },

  montoFinanciamientoCPP: { type: Number, default: 0 },
  precioVenta:             { type: Number, default: 0 },

  // legacy
  valor: { type: Number, default: 0 },

  abonoCliente:              { type: Number, default: 0 },
  abonoInicial:              { type: Number, default: 0 },
  porcentajeFinanciamiento:  { type: Number, default: 0 },
  cesionAFavorDe:            { type: String, default: '' },

  entregaExpedienteBanco: { type: Date },
  recibidoCPP:            { type: Date },
  plazoAprobacionDias:    { type: Number },
  fechaValorCPP:          { type: Date },
  fechaVencimientoCPP:    { type: Date },
  vencimientoCPPBnMivi:   { type: Date },

  fechaEntregaProformaBanco: { type: Date },
  fechaProforma:             { type: Date },

  aperturaCtaBanco:     { type: Boolean, default: false },
  primeraMensual:       { type: Boolean, default: false },
  pagoMinuta:           { type: Boolean, default: false },
  tiempoAprobacionDias: { type: Number },

  polizas:    { type: Boolean, default: false },
  tipoPoliza: { type: String, default: '' },
  polizaVida: { type: String, default: '' },
  abonoAlte:  { type: Number, default: 0 },

  // =========================================================
  // CONTRATO / PROTOCOLO / NOTARÍA / REGISTRO
  // =========================================================
  fechaContratoCliente: { type: Date },
  estatusContrato:      { type: String, default: '' },
  montoContrato:        { type: Number, default: 0 },
  pagare:               { type: String, default: '' },
  fechaFirma:           { type: Date },
  contratoFirmado:      { type: Boolean, default: false },

  fechaActivacionTramite: { type: Date },

  protocoloFirmaCliente:      { type: Boolean, default: false },
  fechaEntregaBanco:          { type: Date },
  protocoloFirmaRLBancoInter: { type: Boolean, default: false },
  fechaRegresoBanco:          { type: Date },
  diasTranscurridosBanco:     { type: Number },

  fechaEntregaProtocoloBancoCli: { type: Date },
  firmaProtocoloBancoCliente:    { type: Boolean, default: false },
  fechaRegresoProtocoloBancoCli: { type: Date },
  diasTranscurridosProtocolo:    { type: Number },

  cierreNotaria:     { type: Boolean, default: false },
  pagoImpuestos:     { type: Boolean, default: false },
  fechaPagoImpuesto: { type: Date },
  ingresoRP:         { type: Boolean, default: false },
  fechaIngresoRP:    { type: Date },
  fechaInscripcion:  { type: Date },

  solicitudDesembolso: { type: Boolean, default: false },
  fechaDesembolso:     { type: Date },
  fechaRecibidoCheque: { type: Date },

  // =========================================================
  // MIVI
  // =========================================================
  expedienteMIVI:          { type: String, default: '' },
  entregaExpMIVI:          { type: Date },
  resolucionMIVI:          { type: String, default: '' },
  fechaResolucionMIVI:     { type: Date },
  solicitudMiviDesembolso: { type: Date },
  desembolsoMivi:          { type: String, default: '' },
  fechaPagoMivi:           { type: Date },

  // =========================================================
  // TÉCNICO / OBRA / PERMISOS
  // =========================================================
  enConstruccion:         { type: Boolean, default: false },
  estatusConstruccion:    { type: String, default: '' },
  faseConstruccion:       { type: String, default: '' },

  permisoConstruccionMunicipal: { type: Boolean, default: false },
  permisoConstruccionNum:       { type: String, default: '' },

  permisoOcupacion:              { type: Boolean, default: false },
  permisoOcupacionNum:           { type: String, default: '' },
  fechaEmisionPermisoOcupacion:  { type: Date },

  constructora: { type: String, default: '' },

  // =========================================================
  // LEGAL / MINUTAS / AVALÚO
  // =========================================================
  solicitudAvaluo: { type: String, default: '' },
  avaluoRealizado: { type: String, default: '' },
  fechaAvaluo:     { type: Date },
  empresaAvaluadora: { type: String, default: '' },

  mLiberacion:  { type: String, default: '' },
  mSegregacion: { type: String, default: '' },
  mPrestamo:    { type: String, default: '' },

  // ====== Paz y salvo ======
  pazSalvoGesproban: { type: Boolean, default: false },
  pazSalvoPromotora: { type: Boolean, default: false },

  // =========================================================
  // ENTREGA / OTROS
  // =========================================================
  entregaCasa:  { type: String, default: '' },
  entregaANATI: { type: String, default: '' },
  fechaEntregaVivienda: { type: Date },

  comentario: { type: String, default: '' },

  // =========================================================
  // CAPTACIÓN / PROFORMA COMERCIAL
  // =========================================================
  captadoAtencionOficina:    { type: Boolean, default: false },
  captadoMailInternet:       { type: Boolean, default: false },
  captadoEnProyecto:         { type: Boolean, default: false },
  captadoMercadeoProspecto:  { type: Boolean, default: false },

  proformaSolicitadaPor: { type: String, default: '' },
  referidoPor:           { type: String, default: '' },
  observacionCliente:    { type: String, default: '' },

  // ====== Soft delete ======
  deletedAt: { type: Date, default: null },

  // ====== Checklist ======
  checklist: { type: [ChecklistStepSchema], default: [] }

}, { timestamps: true });

// Un expediente por unidad y proyecto
VentaSchema.index({ projectId: 1, unitId: 1 }, { unique: true });

module.exports = mongoose.models.Venta || mongoose.model('Venta', VentaSchema);