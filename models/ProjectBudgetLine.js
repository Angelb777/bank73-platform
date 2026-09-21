// models/ProjectBudgetLine.js
// Catálogo de partidas de obra por Torre/Etapa (CommercialFolder). Dato maestro
// mantenido por banca/promotor; el avaluador solo reporta avance contra estas líneas.
const mongoose = require('mongoose');
const { Schema } = mongoose;

const CATEGORIES = ['infraestructura', 'vivienda'];

const projectBudgetLineSchema = new Schema({
  tenantKey: { type: String, index: true },

  projectId: {
    type: Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
    index: true
  },

  commercialFolderId: {
    type: Schema.Types.ObjectId,
    ref: 'CommercialFolder',
    required: true,
    index: true
  },

  category: { type: String, enum: CATEGORIES, default: 'infraestructura' },
  code: { type: String, trim: true, default: '' },
  name: { type: String, required: true, trim: true },
  order: { type: Number, default: 0 },

  isActive: { type: Boolean, default: true, index: true }
}, { timestamps: true });

projectBudgetLineSchema.index({ tenantKey: 1, projectId: 1, commercialFolderId: 1, order: 1 });

module.exports = mongoose.model('ProjectBudgetLine', projectBudgetLineSchema);
module.exports.CATEGORIES = CATEGORIES;
