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

const budgetLineSnapshotSchema = new mongoose.Schema({
  code: { type: String, trim: true, default: '' },
  name: { type: String, trim: true, default: '' },
  category: { type: String, trim: true, default: '' },
  commercialFolderName: { type: String, trim: true, default: '' }
}, { _id: false });

const budgetLineProgressSchema = new mongoose.Schema({
  budgetLineId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProjectBudgetLine',
    required: true
  },
  commercialFolderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CommercialFolder',
    required: true
  },
  lineSnapshot: { type: budgetLineSnapshotSchema, required: true },
  physicalProgressPercent: { type: Number, required: true, min: 0, max: 100 },
  // El monto económico del período lo carga banca/finanzas cuando exista;
  // el avaluador solo captura avance físico. Por eso admite null.
  economicAmountPeriod: { type: Number, default: null },
  economicAmountReported: { type: Boolean, default: false },
  observations: { type: String, trim: true, default: '', maxlength: 2000 },
  updatedAt: { type: Date, default: Date.now }
}, { _id: false });

const budgetLineSummaryEntrySchema = new mongoose.Schema({
  budgetLineId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProjectBudgetLine',
    required: true
  },
  commercialFolderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CommercialFolder',
    required: true
  },
  code: { type: String, trim: true, default: '' },
  name: { type: String, trim: true, default: '' },
  category: { type: String, trim: true, default: '' },
  commercialFolderName: { type: String, trim: true, default: '' },
  physicalProgressPercent: {
    previous: { type: Number, required: true },
    period: { type: Number, required: true },
    accumulated: { type: Number, required: true }
  },
  economicAmountPeriod: { type: Number, default: null },
  economicAmountReported: { type: Boolean, default: false }
}, { _id: false });

// Congelado una sola vez en finalize(): ni el histórico ni el PDF firmado
// deben cambiar si luego se editan partidas o inspecciones nuevas.
const financialSummarySnapshotSchema = new mongoose.Schema({
  previousInspectionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inspection',
    default: null
  },
  previousInspectionDate: { type: Date, default: null },
  generatedAt: { type: Date, required: true },
  budgetLines: { type: [budgetLineSummaryEntrySchema], default: [] }
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
      notes: { type: String, trim: true, default: '', maxlength: 5000 }
    }, { _id: false }),
    default: undefined
  },
  signature: { type: signatureSchema, default: undefined },
  finalizedAt: { type: Date, default: null },
  reportNumber: { type: String, trim: true, default: '' },

  // Última inspección FINALIZADA del mismo proyecto y del mismo banco
  // (nunca solo por proyecto: un proyecto puede tener avaluadores de
  // varios bancos financiadores). Se resuelve al crear el draft y ancla
  // el cálculo de anterior/periodo/acumulado.
  previousInspectionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inspection',
    default: null
  },

  budgetLineProgress: { type: [budgetLineProgressSchema], default: [] },
  financialSummarySnapshot: { type: financialSummarySnapshotSchema, default: undefined }
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
  projectId: 1,
  status: 1,
  inspectionDate: -1
});

module.exports = mongoose.model('Inspection', inspectionSchema);
