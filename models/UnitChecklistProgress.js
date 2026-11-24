const mongoose = require('mongoose');

const UnitChecklistProgressSchema = new mongoose.Schema({
  tenantKey: { type: String, required: true, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  checklistId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectChecklist', required: true, index: true },
  unitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', required: true, index: true },
  states: {
    type: [{
      subtaskId: { type: String, required: true, trim: true },
      completed: { type: Boolean, default: false },
      completedAt: { type: Date, default: null },
      completedBy: { type: String, trim: true, default: '' }
    }],
    default: []
  },
  updatedBy: { type: String, trim: true, default: '' }
}, { timestamps: true });

UnitChecklistProgressSchema.index(
  { tenantKey: 1, projectId: 1, checklistId: 1, unitId: 1 },
  { unique: true }
);

module.exports = mongoose.model('UnitChecklistProgress', UnitChecklistProgressSchema);
