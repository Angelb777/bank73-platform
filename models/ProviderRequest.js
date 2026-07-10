const mongoose = require('mongoose');

const providerRequestSchema = new mongoose.Schema({
  provider: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true, index: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  serviceType: { type: String, required: true, trim: true, index: true },
  comments: { type: String, trim: true, maxlength: 1200, default: '' },
  status: { type: String, enum: ['pending', 'reviewed'], default: 'pending', index: true },
  requestedAt: { type: Date, default: Date.now, index: true },
  reviewedAt: { type: Date },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

providerRequestSchema.index({ provider: 1, status: 1, requestedAt: -1 });
providerRequestSchema.index({ project: 1, requestedAt: -1 });

module.exports = mongoose.model('ProviderRequest', providerRequestSchema);
