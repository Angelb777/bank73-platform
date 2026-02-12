// models/User.js
const mongoose = require('mongoose');

/**
 * ROLES
 * Mantener en minúsculas para compatibilidad con lo existente.
 * (Ya mapearemos a mayúsculas o labels en el front si hace falta)
 */
const ROLES = [
  'admin',
  'bank',
  'promoter',
  'commercial',
  'gerencia',
  'socios',
  'contable',
  'financiero',
  'legal',
  'tecnico'
];

// Roles que ven TODO dentro de Proyectos y Docs (según requisito)
const FULL_ACCESS_ROLES = [
  'admin',
  'bank',
  'promoter',
  'gerencia',
  'socios',
  'financiero',
  'contable'
];

const STATUSES = ['pending', 'active', 'blocked'];

/**
 * Subdocumento opcional para rol por proyecto (granularidad).
 * Si no lo usas, no afecta a nada.
 */
const ProjectRoleSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    role: { type: String, enum: ROLES, required: true }
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    tenantKey: { type: String, index: true },

    name: String,
    email: { type: String, index: true, unique: false },
    password: String, // TODO: usar hash en producción

    // Rol principal asignado
    role: { type: String, enum: ROLES, default: 'bank' },

    // Estado de la cuenta
    status: { type: String, enum: STATUSES, default: 'pending' },

    // Rol solicitado al registrarse (admin lo puede cambiar al aprobar)
    // Incluimos los nuevos roles; excluimos 'admin' para alta pública.
    roleRequested: {
      type: String,
      enum: ROLES.filter(r => r !== 'admin'),
      default: 'bank'
    },

    // (Opcional) Roles por proyecto para ACL fino
    projectRoles: [ProjectRoleSchema]
  },
  { timestamps: true }
);

// Normaliza a minúsculas por seguridad
userSchema.pre('validate', function (next) {
  if (this.role) this.role = String(this.role).toLowerCase();
  if (this.roleRequested) this.roleRequested = String(this.roleRequested).toLowerCase();
  next();
});

// Helper: usuario activo
userSchema.methods.isActive = function () {
  return this.status === 'active';
};

// Helper: ¿tiene uno de estos roles?
userSchema.methods.hasAnyRole = function (roles = []) {
  const r = (this.role || '').toLowerCase();
  return roles.map(String).map(s => s.toLowerCase()).includes(r);
};

// Helper: ve todo en Proyectos/Docs (según tu regla)
userSchema.methods.seesAllProjects = function () {
  return this.hasAnyRole(FULL_ACCESS_ROLES);
};

// Índice compuesto para evitar duplicados dentro de un tenant
userSchema.index({ email: 1, tenantKey: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
module.exports.FULL_ACCESS_ROLES = FULL_ACCESS_ROLES;
module.exports.STATUSES = STATUSES;
