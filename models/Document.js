// models/Document.js
const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  tenantKey:  { type: String, index: true },

  projectId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true },

  // ❖ Comercial
  unitId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', index: true },
  unitTag:    { type: String }, // ej. "A-1"

  // ❖ Proyecto
  checklistId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectChecklist', index: true },

  // ❖ Archivo
  originalname: String,
  filename:     String,
  path:         String,   // p.ej. "uploads/xxxx.jpg"
  mimetype:     String,
  size:         Number,

  // ❖ Metadatos
  title:       { type: String },
  expiryDate:  { type: Date },

  // ❖ Quién sube
  uploadedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploaderRole: { type: String }, // minúsculas

  // ❖ ACL por roles
  visibleToRoles: [{ type: String }],

  // ❖ 🔴 Campos necesarios para “Antes / Después”
  category:  { type: String, index: true },                 // ej. 'beforeAfter'
  baTag:     { type: String, enum: ['BEFORE','AFTER'], index: true },
  tag:       { type: String }                                // compat front (BEFORE/AFTER)
}, { timestamps: true });

documentSchema.pre('validate', function (next) {
  if (typeof this.uploaderRole === 'string') {
    this.uploaderRole = this.uploaderRole.toLowerCase();
  }
  if (Array.isArray(this.visibleToRoles)) {
    this.visibleToRoles = this.visibleToRoles.map(r => String(r).toLowerCase());
  }
  next();
});

// Índices útiles
documentSchema.index({ tenantKey: 1, projectId: 1, createdAt: -1 });
documentSchema.index({ tenantKey: 1, checklistId: 1, createdAt: -1 });
documentSchema.index({ tenantKey: 1, unitId: 1, createdAt: -1 });
documentSchema.index({ tenantKey: 1, visibleToRoles: 1 });
// Para A/D
documentSchema.index({ tenantKey: 1, category: 1, baTag: 1, createdAt: -1 });

module.exports = mongoose.model('Document', documentSchema);
