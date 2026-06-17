// models/Project.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const PUBLISH_STATUSES = ['draft', 'pending', 'approved', 'rejected'];
const PROJECT_CURRENCIES = ['PAB', 'USD', 'EUR'];
const PROJECT_TYPES = [
  'Residencial vertical PH',
  'Residencial horizontal',
  'Comercial',
  'Mixto',
  'Lotes unifamiliares',
  'Lotes, adosados y dúplex PH',
  'Otro'
];

const projectSchema = new Schema({
  tenantKey: { type: String, index: true },

  name: String,
  description: String,
  projectType: { type: String, enum: ['', ...PROJECT_TYPES], default: '' },
  currency: { type: String, enum: PROJECT_CURRENCIES, default: 'PAB' },

  status: { type: String, default: 'EN_CURSO' },

  publishStatus: {
    type: String,
    enum: PUBLISH_STATUSES,
    default: 'pending',
    index: true
  },

  createdBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },

  teamSuggestion: {
    promoter:   [{ type: String, trim: true }],
    commercial: [{ type: String, trim: true }],
    legal:      [{ type: String, trim: true }],
    tecnico:    [{ type: String, trim: true }],
    gerencia:   [{ type: String, trim: true }],
    socios:     [{ type: String, trim: true }],
    financiero: [{ type: String, trim: true }],
    contable:   [{ type: String, trim: true }],
    notes:      { type: String, trim: true, default: '' }
  },

  // Asignaciones (legacy + nuevos roles)
  assignedPromoters:   [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
  assignedCommercials: [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],

  // NUEVOS CAMPOS
  assignedLegal:       [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
  assignedTecnicos:    [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
  assignedGerencia:    [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
  assignedSocios:      [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
  assignedFinanciero:  [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
  assignedContable:    [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],

  // Comercial: configuración del grupo sin sector/carpeta
  commercialUnassignedName: {
    type: String,
    default: 'Sin carpeta'
  },

  commercialUnassignedColor: {
    type: String,
    default: '#0f172a'
  },

  // KPIs
  loanApproved:   { type: Number, default: 0 },
  loanDisbursed:  { type: Number, default: 0 },
  loanBalance:    { type: Number, default: 0 },
  budgetApproved: { type: Number, default: 0 },
  budgetSpent:    { type: Number, default: 0 },
  unitsTotal:     { type: Number, default: 0 },
  unitsSold:      { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Project', projectSchema);
module.exports.PUBLISH_STATUSES = PUBLISH_STATUSES;
module.exports.PROJECT_TYPES = PROJECT_TYPES;
module.exports.PROJECT_CURRENCIES = PROJECT_CURRENCIES;
