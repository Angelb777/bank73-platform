const mongoose = require('mongoose');

const projectAvaluatorAssignmentSchema = new mongoose.Schema({
  bankTenantKey: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
    index: true
  },
  projectTenantKey: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  avaluadorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['active', 'revoked'],
    default: 'active',
    required: true,
    index: true
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  assignedAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  revokedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  revokedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

projectAvaluatorAssignmentSchema.index(
  { bankTenantKey: 1, projectId: 1, avaluadorId: 1 },
  { unique: true }
);
projectAvaluatorAssignmentSchema.index(
  { bankTenantKey: 1, projectId: 1, status: 1 }
);
projectAvaluatorAssignmentSchema.index(
  { bankTenantKey: 1, avaluadorId: 1, status: 1 }
);

module.exports = mongoose.model('ProjectAvaluatorAssignment', projectAvaluatorAssignmentSchema);
