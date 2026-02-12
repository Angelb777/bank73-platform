// models/ProjectPermit.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const projectPermitItemSchema = new Schema({
  code:        { type: String, required: true },
  title:       { type: String, required: true },
  institution: { type: String },
  type:        { type: String }, // ⬅️ NUEVO
  status: {
    type: String,
    enum: ['pending','in_progress','submitted','approved','rejected','waived'],
    default: 'pending'
  },
  dueDate:     { type: Date },
  submittedAt: { type: Date },
  resolvedAt:  { type: Date },
  assigneeUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  notes:       { type: String },
  docs:        [{ type: Schema.Types.ObjectId, ref: 'Document' }],
  feeActual:   { type: Number },
  requirements:[{ type: String }],
  observations:[{ type: String }],
  slaDays:     { type: Number },
  dependencies:[{ type: String }],
});

const projectPermitSchema = new Schema({
  tenantKey:   { type: String, index: true },
  projectId:   { type: Schema.Types.ObjectId, ref: 'Project', index: true },
  templateId:  { type: Schema.Types.ObjectId, ref: 'PermitTemplate' },
  templateVersion: { type: Number },
  status:      { type: String, default: 'draft' }, // draft, in_progress, complete
  items:       [projectPermitItemSchema],
}, { timestamps: true });

// Virtual para calcular progreso %
projectPermitSchema.virtual('progress').get(function () {
  const total = this.items.filter(i => i.status !== 'waived').length;
  if (!total) return 0;
  const done = this.items.filter(i => i.status === 'approved').length;
  return Math.round((done / total) * 100);
});

module.exports = mongoose.model('ProjectPermit', projectPermitSchema);
