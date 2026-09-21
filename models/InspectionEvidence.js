const mongoose = require('mongoose');

const inspectionEvidenceSchema = new mongoose.Schema({
  bankTenantKey: { type: String, required: true, trim: true, index: true },
  projectTenantKey: { type: String, required: true, trim: true, index: true },
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
  unitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', default: null, index: true },
  commonAreaKey: { type: String, trim: true, default: '', index: true },
  workFrontKey: { type: String, trim: true, default: '', index: true },
  incidentId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  category: {
    type: String,
    enum: ['progress', 'incident', 'quality', 'environment', 'comparison', 'general'],
    default: 'general',
    index: true
  },
  caption: { type: String, trim: true, default: '', maxlength: 1000 },
  originalname: { type: String, trim: true, required: true },
  filename: { type: String, trim: true, required: true },
  path: { type: String, trim: true, required: true },
  mimetype: { type: String, trim: true, required: true },
  size: { type: Number, min: 1, required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false });

inspectionEvidenceSchema.index({ inspectionId: 1, unitId: 1, createdAt: 1 });
inspectionEvidenceSchema.index({ inspectionId: 1, commonAreaKey: 1, createdAt: 1 });
inspectionEvidenceSchema.index({ inspectionId: 1, workFrontKey: 1, createdAt: 1 });
inspectionEvidenceSchema.index({ inspectionId: 1, incidentId: 1, createdAt: 1 });

module.exports = mongoose.model('InspectionEvidence', inspectionEvidenceSchema);
