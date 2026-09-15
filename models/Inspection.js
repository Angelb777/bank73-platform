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

const commonAreaSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  weight: { type: Number, required: true, min: 0, max: 100 },
  progressPercent: { type: Number, required: true, min: 0, max: 100, default: 0 },
  observations: { type: String, trim: true, default: '', maxlength: 5000 }
}, { _id: false });

const signatureSchema = new mongoose.Schema({
  signerName: { type: String, required: true, trim: true, maxlength: 200 },
  imageData: { type: String, required: true },
  signedAt: { type: Date, required: true }
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
    enum: ['draft', 'finalized'],
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
  projectProgressPercent: {
    type: Number,
    min: 0,
    max: 100,
    default: 0,
    required: true
  },
  commonAreas: {
    type: [commonAreaSchema],
    default: () => ([
      { key: 'urbanizacion', name: 'Urbanización y viales', weight: 20 },
      { key: 'infraestructura', name: 'Infraestructura y redes', weight: 25 },
      { key: 'zonas_comunes', name: 'Zonas comunes y amenidades', weight: 25 },
      { key: 'exteriores', name: 'Exteriores y paisajismo', weight: 15 },
      { key: 'seguridad', name: 'Seguridad y accesibilidad', weight: 15 }
    ])
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
  },
  signature: { type: signatureSchema, default: undefined },
  finalizedAt: { type: Date, default: null },
  reportNumber: { type: String, trim: true, default: '' }
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
