const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  tenantKey: { type: String, unique: true, index: true },
  name: String,
  baseDomain: String,
  commercialTemplate: {
    path: { type: String, trim: true, default: '' },
    originalname: { type: String, trim: true, default: '' },
    mimetype: { type: String, trim: true, default: '' },
    size: { type: Number, default: 0 },
    uploadedAt: { type: Date, default: null },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  }
}, { timestamps: true });

module.exports = mongoose.model('Tenant', tenantSchema);
