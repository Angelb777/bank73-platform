'use strict';

const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  order: { type: Number, min: 0, required: true },
  progressPercent: { type: Number, min: 0, max: 100, default: 0 },
  applicable: { type: Boolean, default: true }
}, { _id: false });

const unitTechnicalProgressSchema = new mongoose.Schema({
  tenantKey: { type: String, required: true, trim: true, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  unitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', required: true, index: true },
  templateKind: { type: String, enum: ['horizontal', 'vertical'], required: true },
  progressPercent: { type: Number, min: 0, max: 100, default: 0 },
  activities: { type: [activitySchema], default: [] },
  observations: { type: String, trim: true, default: '', maxlength: 3000 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedByLabel: { type: String, trim: true, default: '' }
}, { timestamps: true });

unitTechnicalProgressSchema.index({ tenantKey: 1, projectId: 1, unitId: 1 }, { unique: true });

module.exports = mongoose.model('UnitTechnicalProgress', unitTechnicalProgressSchema);
