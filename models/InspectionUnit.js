const mongoose = require('mongoose');

const unitReferenceSnapshotSchema = new mongoose.Schema({
  code: { type: String, trim: true, default: '' },
  manzana: { type: String, trim: true, default: '' },
  lote: { type: String, trim: true, default: '' },
  modelo: { type: String, trim: true, default: '' }
}, { _id: false });

const progressSectionSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  weight: { type: Number, required: true, min: 0, max: 100 },
  order: { type: Number, required: true, min: 0 },
  progressPercent: { type: Number, required: true, min: 0, max: 100 }
}, { _id: false });

const inspectionUnitSchema = new mongoose.Schema({
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
  inspectionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inspection',
    required: true,
    index: true
  },
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
    index: true
  },
  unitId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Unit',
    required: true,
    index: true
  },
  unitReferenceSnapshot: {
    type: unitReferenceSnapshotSchema,
    required: true
  },
  progressPercent: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  },
  progressSections: {
    type: [progressSectionSchema],
    default: undefined
  },
  observations: {
    type: String,
    trim: true,
    default: '',
    maxlength: 10000
  },
  inspectedAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  version: {
    type: Number,
    min: 0,
    default: 0,
    required: true
  }
}, { timestamps: true, versionKey: false });

inspectionUnitSchema.index(
  { inspectionId: 1, unitId: 1 },
  { unique: true }
);
inspectionUnitSchema.index({
  bankTenantKey: 1,
  inspectionId: 1,
  createdAt: 1
});

module.exports = mongoose.model('InspectionUnit', inspectionUnitSchema);
