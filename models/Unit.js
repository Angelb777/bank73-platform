const mongoose = require('mongoose');

const UnitSchema = new mongoose.Schema({
  tenantKey: { type: String, index: true },

  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
    index: true
  },

  // Carpetas comerciales
  folderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CommercialFolder',
    default: null,
    index: true
  },

  folderOrder: {
    type: Number,
    default: 0
  },

  // Comercial
  etapa:   { type: String, default: '' },
  torre:   { type: String, default: '' },
  nivel:   { type: String, default: '' },
  manzana: { type: String, default: '' },
  lote:    { type: String, default: '' },
  modelId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  modelo:  { type: String, default: '' },
  ubicacion: { type: String, default: '' },
  m2:      { type: Number, default: 0 },
  // Coste base heredado del modelo. Puede sobrescribirse en la ficha de la unidad.
  costoUnidad: { type: Number, min: 0, default: 0 },
  costoUnidadManual: { type: Boolean, default: false },
  numeroFinca: { type: String, default: '' },
  codigoUbicacion: { type: String, default: '' },
  calle: { type: String, default: '' },
  loteEsquina: { type: String, default: '' },
  metrosExtra: { type: Number, default: 0 },
  precioLoteEsquina: { type: Number, default: 0 },
  precioM2Extra: { type: Number, default: 0 },
  areaAbierta: { type: Number, default: 0 },
  areaCerrada: { type: Number, default: 0 },
  areaTotalConstruccion: { type: Number, default: 0 },
  recamaras: { type: Number, default: 0 },
  banos: { type: Number, default: 0 },
  valorMejoras: { type: Number, default: 0 },
  valorTerreno: { type: Number, default: 0 },

  // Métricas no comerciales para capas del visor 3D. Precio y estado siguen
  // leyendo los campos canónicos de Unit/Venta; aquí solo se guarda avance y
  // coste imputado para no duplicar la fuente de verdad comercial.
  viewer3D: {
    tower: { type: String, trim: true, default: '' },
    // Identificador estable del elemento geométrico. No contiene información
    // comercial: solo conserva el enlace aunque se renombre la unidad.
    geometryKey: { type: String, trim: true, default: '' },
    progressPct: { type: Number, min: 0, max: 100, default: null },
    progressStatus: {
      type: String,
      enum: ['', 'completed', 'inProgress', 'pending', 'unknown'],
      default: ''
    },
    constructionPhase: { type: String, trim: true, default: '' },
    budgetCost: { type: Number, min: 0, default: null },
    actualCost: { type: Number, min: 0, default: null },
    dataKind: {
      type: String,
      enum: ['', 'actual', 'illustrative'],
      default: ''
    },
    sourceLabel: { type: String, trim: true, default: '' }
  },

  estado: {
    type: String,
    enum: [
      'disponible',
      'inventario',
      'reservado',
      'con_cpp',
      'tramite_legal_activado',
      'escriturado_traspasado',
      'vivienda_entregada',
      'cancelado'
    ],
    default: 'disponible',
    index: true
  },

  // El estado efectivo sigue viviendo en `estado`. Estos campos permiten que
  // el proceso comercial lo avance automáticamente sin sobrescribir una
  // decisión expresa del usuario.
  estadoModo: {
    type: String,
    enum: ['automatico', 'manual'],
    default: 'manual',
    index: true
  },
  estadoAutomaticoSugerido: {
    type: String,
    enum: [
      'disponible',
      'inventario',
      'reservado',
      'con_cpp',
      'tramite_legal_activado',
      'escriturado_traspasado'
    ],
    default: 'disponible'
  },
  estadoAutomaticoBase: {
    type: String,
    enum: ['disponible', 'inventario'],
    default: 'disponible'
  },
  estadoAutomaticoMotivo: { type: String, default: '' },
  estadoAutomaticoActualizadoAt: { type: Date, default: null },
  estadoManualAt: { type: Date, default: null },
  estadoManualBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  clienteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente' },
  deletedAt: { type: Date, default: null },

  // Legacy compat
  code:   { type: String },
  status: { type: String, default: 'DISPONIBLE' },
}, { timestamps: true });

UnitSchema.index({ projectId: 1, manzana: 1, lote: 1 }, { unique: false });
UnitSchema.index({ projectId: 1, folderId: 1, folderOrder: 1 });
UnitSchema.index({ tenantKey: 1, projectId: 1, deletedAt: 1, estado: 1 });
UnitSchema.index({ tenantKey: 1, projectId: 1, deletedAt: 1, manzana: 1, lote: 1 });

UnitSchema.pre('save', function(next) {
  if (this.isModified('manzana') || this.isModified('lote')) {
    const m = this.manzana || '';
    const l = this.lote || '';
    if (m || l) this.code = `${m}-${l}`;
  }

  if (
    (this.isModified('areaAbierta') || this.isModified('areaCerrada')) &&
    (!this.isModified('areaTotalConstruccion') || !Number(this.areaTotalConstruccion || 0))
  ) {
    this.areaTotalConstruccion = Number(this.areaAbierta || 0) + Number(this.areaCerrada || 0);
  }

  if (this.isModified('estado')) {
    this.status = String(this.estado || '').toUpperCase();
  }

  next();
});

module.exports = mongoose.model('Unit', UnitSchema);
