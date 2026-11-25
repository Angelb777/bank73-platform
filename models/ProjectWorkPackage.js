'use strict';

const mongoose = require('mongoose');

const checklistStateSchema = new mongoose.Schema({
  checklistId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectChecklist', required: true },
  subtaskId: { type: String, required: true, trim: true },
  completed: { type: Boolean, default: false },
  completedAt: { type: Date, default: null },
  completedBy: { type: String, trim: true, default: '' }
}, { _id: false });

const projectWorkPackageSchema = new mongoose.Schema({
  tenantKey: { type: String, required: true, trim: true, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  contractorName: { type: String, trim: true, default: '', maxlength: 200 },
  unitIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Unit' }], default: [] },
  startDate: { type: Date, default: null },
  endDate: { type: Date, default: null },
  notes: { type: String, trim: true, default: '', maxlength: 3000 },
  order: { type: Number, min: 0, default: 0 },
  checklistStates: { type: [checklistStateSchema], default: [] },
  createdBy: { type: String, trim: true, default: '' },
  updatedBy: { type: String, trim: true, default: '' }
}, { timestamps: true });

projectWorkPackageSchema.index({ tenantKey: 1, projectId: 1, order: 1, createdAt: 1 });
projectWorkPackageSchema.index({ tenantKey: 1, projectId: 1, unitIds: 1 });

module.exports = mongoose.model('ProjectWorkPackage', projectWorkPackageSchema);
