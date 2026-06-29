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
const PROMOTER_TYPES = ['No definido', 'Promotor constructor', 'Llave en mano', 'Subcontratación', 'Gestión fragmentada'];

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
    promoterType: { type: String, enum: PROMOTER_TYPES, default: 'No definido' },
    yearsExperience: { type: Number, min: 0, default: null },
    deliveredProjects: { type: Number, min: 0, default: null },
    activeProjects: { type: Number, min: 0, default: null },
    developedVolume: { type: Number, min: 0, default: null },
    developedUnits: { type: Number, min: 0, default: null },
    averageProjectTicket: { type: Number, min: 0, default: null },
    bankFinancingExperience: { type: String, trim: true, default: '' },
    banksWorkedWith: [{ type: String, trim: true }],
    onTimeDeliveryHistory: { type: String, trim: true, default: '' },
    incidentHistory: { type: String, trim: true, default: '' },
    documentationLevel: { type: String, trim: true, default: '' },
    internalTeam: {
      technical: { type: Boolean, default: false },
      financial: { type: Boolean, default: false },
      commercial: { type: Boolean, default: false },
      legal: { type: Boolean, default: false }
    },
    countries: [{ type: String, trim: true }],
    notes: { type: String, trim: true, default: '' }
  },
  { _id: false }
);

function promoterProfileCompletion(profile = {}) {
  const checks = [
    !!profile.companyName,
    profile.promoterType && profile.promoterType !== 'No definido',
    profile.yearsExperience !== null && profile.yearsExperience !== undefined,
    profile.deliveredProjects !== null && profile.deliveredProjects !== undefined,
    profile.activeProjects !== null && profile.activeProjects !== undefined,
    profile.developedUnits !== null && profile.developedUnits !== undefined,
    Array.isArray(profile.countries) && profile.countries.length > 0,
    profile.developedVolume !== null && profile.developedVolume !== undefined,
    profile.averageProjectTicket !== null && profile.averageProjectTicket !== undefined,
    !!profile.bankFinancingExperience,
    Array.isArray(profile.banksWorkedWith) && profile.banksWorkedWith.length > 0,
    !!profile.onTimeDeliveryHistory,
    !!profile.incidentHistory,
    !!profile.documentationLevel,
    !!profile.internalTeam && Object.values(profile.internalTeam).some(Boolean)
  ];
  const completed = checks.filter(Boolean).length;
  const total = checks.length;
  return {
    completed,
    total,
    percent: total ? Math.round((completed / total) * 100) : 0,
    sufficient: completed >= 10 && !!profile.companyName
  };
}

function calculatePromoterCategory(profile = {}) {
  const years = Number(profile.yearsExperience || 0);
  const delivered = Number(profile.deliveredProjects || 0);
  const volume = Number(profile.developedVolume || 0);
  const units = Number(profile.developedUnits || 0);
  const completion = promoterProfileCompletion(profile);
  let points = 0;

  if (years >= 15) points += 25;
  else if (years >= 7) points += 18;
  else if (years >= 2) points += 10;
  else if (years > 0) points += 5;

  if (delivered > 20) points += 25;
  else if (delivered > 8) points += 18;
  else if (delivered >= 1) points += 10;

  if (volume >= 50000000 || units >= 500) points += 20;
  else if (volume >= 10000000 || units >= 100) points += 12;
  else if (volume > 0 || units > 0) points += 6;

  if (String(profile.bankFinancingExperience || '').trim()) points += 8;
  if (String(profile.documentationLevel || '').toLowerCase().includes('alta')) points += 8;
  if (Object.values(profile.internalTeam || {}).filter(Boolean).length >= 3) points += 8;
  if (String(profile.onTimeDeliveryHistory || '').toLowerCase().includes('mayor')) points += 6;

  if (!completion.sufficient && points < 35) return 'Emergente';
  if (points >= 75 || years >= 15 || delivered > 20) return 'Institucional';
  if (points >= 50 || years >= 7 || delivered > 8) return 'Consolidado';
  if (points >= 25 || years >= 2 || delivered >= 1) return 'En desarrollo';
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
module.exports.PROMOTER_TYPES = PROMOTER_TYPES;
module.exports.calculatePromoterCategory = calculatePromoterCategory;
module.exports.promoterProfileCompletion = promoterProfileCompletion;
