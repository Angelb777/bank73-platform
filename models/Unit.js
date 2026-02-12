const mongoose = require('mongoose');

const UnitSchema = new mongoose.Schema({
  tenantKey: { type: String, index: true },

  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },

  // Nuevos (Comercial)
  manzana: { type: String, default: '' },
  lote:    { type: String, default: '' },
  modelo:  { type: String, default: '' },
  m2:      { type: Number, default: 0 },
  precioLista: { type: Number, default: 0 },
  estado: {
    type: String,
    enum: ['disponible','reservado','en_escrituracion','escriturado','entregado'],
    default: 'disponible',
    index: true
  },
  clienteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente' },
  deletedAt: { type: Date, default: null },

  // Legacy (compat)
  code:   { type: String },
  status: { type: String, default: 'DISPONIBLE' },
  price:  { type: Number, default: 0 }
}, { timestamps: true });

UnitSchema.index({ projectId: 1, manzana: 1, lote: 1 }, { unique: false });

UnitSchema.pre('save', function(next) {
  if (this.isModified('manzana') || this.isModified('lote')) {
    const m = this.manzana || '';
    const l = this.lote || '';
    if (m || l) this.code = `${m}-${l}`;
  }
  if (this.isModified('precioLista')) this.price = this.precioLista;
  if (this.isModified('estado')) this.status = String(this.estado || '').toUpperCase();
  next();
});

module.exports = mongoose.model('Unit', UnitSchema);
