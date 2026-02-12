// models/ProjectChecklist.js
const mongoose = require('mongoose');

/* =========================
   Subschemas
   ========================= */
const NoteSchema = new mongoose.Schema({
  text:      { type: String, required: true },
  author:    { type: String }, // nombre visible o email
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
});

const SubtaskSchema = new mongoose.Schema({
  title:     { type: String, required: true },
  completed: { type: Boolean, default: false },
  dueDate:   { type: Date },
}, { timestamps: true });

/* =========================
   Roles canónicos (minúsculas)
   ========================= */
const CHECKLIST_ROLES = [
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

/* =========================
   Alias aceptados -> canónico
   (sin tildes y en minúsculas)
   ========================= */
const ROLE_ALIASES = {
  // admin
  'administrador': 'admin',
  'administracion': 'admin',

  // bank
  'banco': 'bank',
  'banca': 'bank',
  'banks': 'bank',

  // promoter
  'promotor': 'promoter',
  'promotores': 'promoter',

  // commercial
  'comercial': 'commercial',
  'comerciales': 'commercial',

  // gerencia
  'gerencias': 'gerencia',

  // socios
  'socio': 'socios',

  // contable
  'contables': 'contable',
  'contabilidad': 'contable',

  // financiero
  'finanzas': 'financiero',
  'financieros': 'financiero',

  // legal
  'juridico': 'legal',
  'juridicos': 'legal',
  'juridica': 'legal',
  'juridicas': 'legal',
  'legales': 'legal',

  // tecnico
  'tecnico': 'tecnico',
  'tecnicos': 'tecnico'
};

/** Quita tildes y pasa a minúsculas */
function toKey(v) {
  return String(v || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase();
}

/** Normaliza con alias y devuelve el canónico si existe */
function normalizeRole(v) {
  if (v == null) return v;
  const key = toKey(v);
  return ROLE_ALIASES[key] || key;
}

/* =========================
   Schema principal
   ========================= */
const ProjectChecklistSchema = new mongoose.Schema({
  projectId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true, required: true },
  templateKey:      { type: String }, // de qué casilla del PDF viene (trazabilidad)
  title:            { type: String, required: true },

  phase:            { type: String, required: true }, // PREESTUDIOS | ...
  level:            { type: Number, required: true, default: 1 },
  orderInLevel:     { type: Number, default: 0 },

  // Rol responsable principal de este checklist
    // Rol responsable principal de este checklist
  roleOwner: {
    type: String,
    enum: CHECKLIST_ROLES,
    required: true,
    lowercase: true,
    set: normalizeRole,
    default: 'promoter' // <- default de seguridad para no reventar el server
  },


  // Roles adicionales que pueden verlo (además de admin siempre)
  visibleToRoles: [{
    type: String,
    enum: CHECKLIST_ROLES,
    lowercase: true,
    set: normalizeRole
  }],

  status:           { type: String, enum: ['PENDIENTE','EN_PROCESO','COMPLETADO'], default: 'PENDIENTE' },
  validated:        { type: Boolean, default: false },

  dueDate:          { type: Date },
  outOfOrderCompletion: { type: Boolean, default: false },

  prerequisitesKeys: [{ type: String }], // copia desde la plantilla para evaluación rápida

  subtasks:         { type: [SubtaskSchema], default: [] },

  createdBy:        { type: String }, // nombre
  updatedBy:        { type: String },
  completedBy:      { type: String },
  validatedBy:      { type: String },

  notes:            { type: [NoteSchema], default: [] },

  completedAt:      { type: Date },
  validatedAt:      { type: Date },
}, { timestamps: true });

/* Nota:
   No hace falta pre('validate') para poner en minúsculas:
   cada campo ya tiene lowercase:true + set(normalizeRole).
*/

module.exports = mongoose.model('ProjectChecklist', ProjectChecklistSchema);
module.exports.CHECKLIST_ROLES = CHECKLIST_ROLES;
