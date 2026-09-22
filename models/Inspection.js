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
  previousProgressPercent: { type: Number, min: 0, max: 100, default: null },
  previousProgressKnown: { type: Boolean, default: false },
  observations: { type: String, trim: true, default: '', maxlength: 5000 }
}, { _id: false });

const signatureSchema = new mongoose.Schema({
  signerName: { type: String, required: true, trim: true, maxlength: 200 },
  imageData: { type: String, required: true },
  signedAt: { type: Date, required: true }
}, { _id: false });

const workFrontSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true, maxlength: 200 },
  sourceType: { type: String, enum: ['phase', 'folder', 'common_area', 'unit', 'custom'], default: 'custom' },
  sourceId: { type: String, trim: true, default: '' },
  name: { type: String, required: true, trim: true, maxlength: 250 },
  status: { type: String, enum: ['not_visited', 'no_change', 'in_progress', 'paused', 'completed', 'not_applicable'], default: 'not_visited' },
  previousProgressPercent: { type: Number, min: 0, max: 100, default: null },
  previousProgressKnown: { type: Boolean, default: false },
  plannedProgressPercent: { type: Number, min: 0, max: 100, default: null },
  currentProgressPercent: { type: Number, min: 0, max: 100, default: 0 },
  observations: { type: String, trim: true, default: '', maxlength: 5000 },
  visitedAt: { type: Date, default: null }
}, { _id: false });

const incidentSchema = new mongoose.Schema({
  type: { type: String, enum: ['change', 'delay', 'defect', 'quality', 'environment', 'risk', 'other'], required: true },
  severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  status: { type: String, enum: ['open', 'monitoring', 'resolved'], default: 'open' },
  title: { type: String, required: true, trim: true, maxlength: 250 },
  description: { type: String, trim: true, default: '', maxlength: 5000 },
  location: { type: String, trim: true, default: '', maxlength: 500 },
  scopeType: { type: String, enum: ['project', 'folder', 'unit', 'common_area'], default: 'project' },
  scopeId: { type: String, trim: true, default: '', maxlength: 200 },
  workFrontKey: { type: String, trim: true, default: '' },
  impactSchedule: { type: Boolean, default: false },
  impactCost: { type: Boolean, default: false },
  impactQuality: { type: Boolean, default: false },
  actionRequired: { type: String, trim: true, default: '', maxlength: 3000 },
  carriedFromIncidentId: { type: mongoose.Schema.Types.ObjectId, default: null },
  observedAt: { type: Date, default: Date.now }
}, { timestamps: false });

const quickAssessmentSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['not_assessed', 'conforming', 'observations_required', 'non_conforming'],
    default: 'not_assessed'
  },
  checks: { type: [String], default: [] },
  observations: { type: String, trim: true, default: '', maxlength: 10000 }
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
  sequence: {
    type: Number,
    min: 1,
    default: 1,
    required: true
  },
  previousInspectionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inspection',
    default: null,
    index: true
  },
  deletedAt: { type: Date, default: null, index: true },
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
  workFronts: { type: [workFrontSchema], default: [] },
  incidents: { type: [incidentSchema], default: [] },
  qualityObservations: { type: String, trim: true, default: '', maxlength: 10000 },
  environmentalObservations: { type: String, trim: true, default: '', maxlength: 10000 },
  qualityAssessment: { type: quickAssessmentSchema, default: undefined },
  environmentalAssessment: { type: quickAssessmentSchema, default: undefined },
  scheduleAssessment: {
    status: { type: String, enum: ['on_track', 'at_risk', 'delayed', 'not_assessed'], default: 'not_assessed' },
    plannedProgressPercent: { type: Number, min: 0, max: 100, default: null },
    forecastCompletionDate: { type: Date, default: null },
    notes: { type: String, trim: true, default: '', maxlength: 5000 }
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
  technicalRecommendation: {
    type: new mongoose.Schema({
      verdict: { type: String, enum: ['favorable', 'conditional', 'unfavorable', 'not_assessed'], required: true },
      notes: { type: String, trim: true, default: '', maxlength: 5000 },
      conditions: { type: String, trim: true, default: '', maxlength: 5000 }
    }, { _id: false }),
    default: undefined
  },
  technicalConclusion: { type: String, trim: true, default: '', maxlength: 10000 },
  signature: { type: signatureSchema, default: undefined },
  finalizedAt: { type: Date, default: null },
  reportNumber: { type: String, trim: true, default: '' },
  snapshotSchemaVersion: { type: Number, min: 1, default: 1 },
  startSnapshot: { type: mongoose.Schema.Types.Mixed, default: undefined },
  reportSnapshot: { type: mongoose.Schema.Types.Mixed, default: undefined }
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
inspectionSchema.index({
  bankTenantKey: 1,
  projectTenantKey: 1,
  projectId: 1,
  status: 1,
  finalizedAt: -1
});

module.exports = mongoose.model('Inspection', inspectionSchema);
