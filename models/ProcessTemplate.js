// models/ProcessTemplate.js
const mongoose = require('mongoose');

const SubtaskTemplateSchema = new mongoose.Schema({
  title: { type: String, required: true },
  role:  { type: String }, // opcional: subtarea con rol distinto al del step
}, { _id: false });

const StepSchema = new mongoose.Schema({
  key:   { type: String, required: true, unique: true }, // ej: F1_N1_PROPONE_PROYECTO
  title: { type: String, required: true },
  phase: { type: String, required: true },               // PREESTUDIOS | PERMISOS | ...
  level: { type: Number, required: true },               // nivel secuencial por fase
  orderInLevel: { type: Number, default: 0 },            // orden dentro del mismo nivel
  role:  { type: String, required: true },               // TECNICO | LEGAL | ...
  type:  { type: String, enum: ['SIMPLE','GROUP'], default: 'SIMPLE' },
  subtasksTemplate: [SubtaskTemplateSchema],             // sólo si type == GROUP
  prerequisites:   [{ type: String }],                   // keys de otros steps
}, { _id: false });

const PhaseSchema = new mongoose.Schema({
  key:   { type: String, required: true },               // PREESTUDIOS
  name:  { type: String, required: true },               // Pre-estudios
  color: { type: String, required: true },               // #hex del lateral
  pale:  { type: String, required: true },               // #hex badge pálido
}, { _id: false });

const ProcessTemplateSchema = new mongoose.Schema({
  version: { type: Number, required: true, unique: true },
  label:   { type: String, default: '' },
  active:  { type: Boolean, default: false },
  phases:  { type: [PhaseSchema], default: [] },
  steps:   { type: [StepSchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('ProcessTemplate', ProcessTemplateSchema);
