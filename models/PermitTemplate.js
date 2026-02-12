// models/PermitTemplate.js
const mongoose = require('mongoose');

const permitItemSchema = new mongoose.Schema({
  code:        { type: String, required: true },   // ej. "anteproyecto-bomberos"
  title:       { type: String, required: true },   // ej. "Anteproyecto - Bomberos"
  institution: { type: String },                   // ej. "Bomberos"
  type:        { type: String },                   // ej. "Anteproyecto", "Permiso Provisional", "Construcción", "Ocupación", "Urbanización"
  requirements:[{ type: String }],
  observations:[{ type: String }],
  slaDays:     { type: Number },
  dependencies:[{ type: String }],
});

const permitTemplateSchema = new mongoose.Schema({
  tenantKey:   { type: String, index: true },
  name:        { type: String, required: true },
  version:     { type: Number, default: 1 },
  items:       [permitItemSchema],
}, { timestamps: true });

module.exports = mongoose.model('PermitTemplate', permitTemplateSchema);
