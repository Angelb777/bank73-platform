const mongoose = require('mongoose');

const legalAcceptanceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  version: { type: String, required: true, trim: true, index: true },
  termsAccepted: { type: Boolean, required: true },
  ndaAccepted: { type: Boolean, required: true },
  privacyAcknowledged: { type: Boolean, required: true },
  acceptedAt: { type: Date, required: true, default: Date.now },
  tenantKeyAtAcceptance: { type: String, trim: true, default: '' },
  tenantNameAtAcceptance: { type: String, trim: true, default: '' },
  documentHashes: {
    terms: { type: String, required: true },
    privacy: { type: String, required: true },
    legalNotice: { type: String, required: true }
  },
  ip: { type: String, trim: true, default: '' },
  userAgent: { type: String, trim: true, default: '' },
  channel: { type: String, enum: ['web', 'mobile'], required: true }
}, { timestamps: true });

// La aceptación es global para el usuario y la versión, con independencia del tenant activo.
legalAcceptanceSchema.index({ userId: 1, version: 1 }, { unique: true });

module.exports = mongoose.model('LegalAcceptance', legalAcceptanceSchema);
