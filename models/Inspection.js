const mongoose = require('mongoose');

const methodologySectionSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  weight: { type: Number, required: true, min: 0, max: 100 },
  order: { type: Number, required: true, min: 0 }
}, { _id: false });

const methodologySnapshotSchema = new mongoose.Schema({
  templateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AvaluationTemplate',
    required: true
  },
  name: { type: String, required: true, trim: true },
  version: { type: Number, required: true, min: 1 },
  sections: { type: [methodologySectionSchema], required: true }
}, { _id: false });

const inspectionSchema = new mongoose.Schema({
  bankTenantKey: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  projectTenantKey: {
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
  avaluadorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  assignmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProjectAvaluatorAssignment',
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['draft'],
    default: 'draft',
    required: true,
    index: true
  },
  inspectionDate: {
    type: Date,
    default: Date.now,
    required: true
  },
  startedAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  generalObservations: {
    type: String,
    trim: true,
    default: '',
    maxlength: 10000
  },
  methodology: {
    type: methodologySnapshotSchema,
    default: undefined
  },
  version: {
    type: Number,
    min: 0,
    default: 0,
    required: true
  }
}, { timestamps: true, versionKey: false });

inspectionSchema.index({
  bankTenantKey: 1,
  avaluadorId: 1,
  projectId: 1,
  createdAt: -1
});
inspectionSchema.index({
  bankTenantKey: 1,
  assignmentId: 1,
  status: 1
});

module.exports = mongoose.model('Inspection', inspectionSchema);
