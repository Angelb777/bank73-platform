// models/Document.js
const mongoose = require('mongoose');

const DOCUMENT_DEPARTMENTS = ['commercial', 'tecnico', 'legal'];
const PROJECT_DOC_FOLDERS = ['tecnico', 'comercial', 'financiero', 'legal', 'gerencia'];

const documentSchema = new mongoose.Schema({
  tenantKey: { type: String, index: true },

  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true },

  // ❖ Comercial / Unidad
  unitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', index: true },
  unitTag: { type: String }, // ej. "A-1"

  // ✅ NUEVO: carpeta principal documental
  department: {
    type: String,
    enum: DOCUMENT_DEPARTMENTS,
    index: true
  },

  // ✅ NUEVO: subcarpeta dentro de Comercial / Técnico / Legal
  folderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UnitDocFolder',
    default: null,
    index: true
  },

  // ❖ Proyecto
  checklistId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectChecklist', index: true },

  // ❖ Repositorio documental del proyecto
  folder: {
    type: String,
    enum: PROJECT_DOC_FOLDERS,
    default: 'gerencia',
    index: true
  },
  subfolder: { type: String, trim: true, default: '' },

  // ✅ Permisos / Trámites
  permitCode: { type: String, index: true },
  permitTitle: { type: String },

  // ❖ Archivo
  originalname: String,
  filename: String,
  path: String,
  mimetype: String,
  size: Number,

  // ❖ Metadatos
  title: { type: String },
  expiryDate: { type: Date },

  // ❖ Quién sube
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploaderRole: { type: String },

  // ❖ ACL por roles
  visibleToRoles: [{ type: String }],

  // ❖ Antes / Después
  category: { type: String, index: true },
  baTag: { type: String, enum: ['BEFORE', 'AFTER'], index: true },
  tag: { type: String },

  // ✅ Ciclo de vida del vencimiento
  status: {
    type: String,
    enum: ['ACTIVE', 'COMPLETED', 'REPLACED'],
    default: 'ACTIVE',
    index: true
  },

  // ✅ Auditoría de cumplimiento
  completedAt: { type: Date },
  completedBy: { type: mongoose.Schema.Types.ObjectId },
  completionNote: { type: String },

  // ✅ Reemplazos
  replaces: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' },
  replacedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' }

}, { timestamps: true });

documentSchema.pre('validate', function (next) {
  if (typeof this.uploaderRole === 'string') {
    this.uploaderRole = this.uploaderRole.toLowerCase().trim();
  }

  if (typeof this.department === 'string') {
    this.department = this.department.toLowerCase().trim();
  }

  if (typeof this.folder === 'string') {
    this.folder = this.folder.toLowerCase().trim();
    if (this.folder === 'technical') this.folder = 'tecnico';
    if (this.folder === 'commercial') this.folder = 'comercial';
    if (this.folder === 'finance') this.folder = 'financiero';
    if (this.folder === 'management') this.folder = 'gerencia';
  }

  if (!this.folder) {
    this.folder = 'gerencia';
  }

  if (typeof this.subfolder === 'string') {
    this.subfolder = this.subfolder.trim();
  }

  if (Array.isArray(this.visibleToRoles)) {
    this.visibleToRoles = this.visibleToRoles.map(r => String(r).toLowerCase().trim());
  }

  next();
});

// Índices útiles
documentSchema.index({ tenantKey: 1, projectId: 1, createdAt: -1 });
documentSchema.index({ tenantKey: 1, checklistId: 1, createdAt: -1 });
documentSchema.index({ tenantKey: 1, unitId: 1, createdAt: -1 });
documentSchema.index({ tenantKey: 1, visibleToRoles: 1 });
documentSchema.index({ tenantKey: 1, category: 1, baTag: 1, createdAt: -1 });

// ✅ Documentos por unidad + departamento + subcarpeta
documentSchema.index({
  tenantKey: 1,
  projectId: 1,
  unitId: 1,
  department: 1,
  folderId: 1,
  createdAt: -1
});

// ✅ Para Resumen “Vencimientos críticos”
documentSchema.index({ tenantKey: 1, projectId: 1, status: 1, expiryDate: 1 });
documentSchema.index({ tenantKey: 1, projectId: 1, folder: 1, subfolder: 1, createdAt: -1 });

module.exports = mongoose.model('Document', documentSchema);
module.exports.DOCUMENT_DEPARTMENTS = DOCUMENT_DEPARTMENTS;
module.exports.PROJECT_DOC_FOLDERS = PROJECT_DOC_FOLDERS;
