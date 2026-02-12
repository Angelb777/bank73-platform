// models/Project.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const PUBLISH_STATUSES = ['draft', 'pending', 'approved', 'rejected'];

const projectSchema = new Schema({
  tenantKey: { type: String, index: true },

  name: String,
  description: String,

  status: { type: String, default: 'EN_CURSO' },

  publishStatus: {
    type: String,
    enum: PUBLISH_STATUSES,
    default: 'pending',
    index: true
  },

  createdBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },

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
