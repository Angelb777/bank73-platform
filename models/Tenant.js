const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  tenantKey: { type: String, unique: true, index: true },
  name: String,
  baseDomain: String
}, { timestamps: true });

module.exports = mongoose.model('Tenant', tenantSchema);
