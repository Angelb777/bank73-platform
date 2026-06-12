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
const PROMOTER_CATEGORIES = ['No definido', 'Emergente', 'En desarrollo', 'Consolidado', 'Institucional'];

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

const PromoterProfileSchema = new mongoose.Schema(
  {
    companyName: { type: String, trim: true, default: '' },
    yearsExperience: { type: Number, min: 0, default: null },
    deliveredProjects: { type: Number, min: 0, default: null },
    activeProjects: { type: Number, min: 0, default: null },
    developedVolume: { type: Number, min: 0, default: null },
    countries: [{ type: String, trim: true }],
    notes: { type: String, trim: true, default: '' }
  },
  { _id: false }
);

function calculatePromoterCategory(profile = {}) {
  const years = Number(profile.yearsExperience || 0);
  const delivered = Number(profile.deliveredProjects || 0);

  if (years >= 15 || delivered > 20) return 'Institucional';
  if (years >= 7 || delivered > 8) return 'Consolidado';
  if (years >= 2 || delivered >= 1) return 'En desarrollo';
  return 'Emergente';
}

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
    projectRoles: [ProjectRoleSchema],

    // Perfil opcional para usuarios promotores. No bloquea registro ni uso.
    promoterProfile: { type: PromoterProfileSchema, default: undefined },
    promoterCategory: { type: String, enum: PROMOTER_CATEGORIES, default: 'No definido' }
  },
  { timestamps: true }
);

// Normaliza a minúsculas por seguridad
userSchema.pre('validate', function (next) {
  if (this.role) this.role = String(this.role).toLowerCase();
  if (this.roleRequested) this.roleRequested = String(this.roleRequested).toLowerCase();

  const isPromoter =
    this.role === 'promoter' ||
    this.roleRequested === 'promoter' ||
    !!this.promoterProfile;

  if (isPromoter) {
    this.promoterCategory = calculatePromoterCategory(this.promoterProfile || {});
  } else {
    this.promoterCategory = 'No definido';
  }

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
module.exports.PROMOTER_CATEGORIES = PROMOTER_CATEGORIES;
module.exports.calculatePromoterCategory = calculatePromoterCategory;
