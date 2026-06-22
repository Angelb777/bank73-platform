// models/ProjectFinance.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const LineItemSchema = new Schema({
  name:   { type: String, required: true },
  amount: { type: Number, required: true, default: 0 },
}, { _id: true });

const PhaseSchema = new Schema({
  name: { type: String, required: true },                // "Fase 1"
  startDate: { type: Date, required: true },
  endDate:   { type: Date, required: true },
  actualStartDate: { type: Date, default: null },
  actualEndDate: { type: Date, default: null },
  isCompleted: { type: Boolean, default: false },
  completedAt: { type: Date, default: null },

  // =========================
  // REAL (lo que ya funcionaba)
  // =========================
  uses:    { type: [LineItemSchema], default: [] },
  sources: { type: [LineItemSchema], default: [] },

  // =========================
  // PLAN por fase (NUEVO)
  // =========================
  planUses:    { type: [LineItemSchema], default: [] },  // estimación (usos) de ESTA fase
  planSources: { type: [LineItemSchema], default: [] },  // estimación (fuentes) de ESTA fase

  // Desembolso por fase (banco)
disbExpected:  { type: Number, default: 0 },   // desembolso esperado en esta fase
disbActual:    { type: Number, default: 0 },   // desembolso ya realizado (real)
disbActualAt:  { type: Date, default: null },  // fecha en la que se registro un desembolso real
disbRequested: { type: Boolean, default: false }, // se solicitó al banco
disbRequestedAt:{ type: Date, default: null },

  // campos KPI por fase (se muestran y suman a totales)
  interesesDevengados: { type: Number, default: 0 },     // intereses de la fase
  aportesPropios:      { type: Number, default: 0 },     // equity propio en la fase
  preventas:           { type: Number, default: 0 },     // llega desde Comercial (puedes actualizarlo por API)

  // alertas
  alertDaysBefore: { type: Number, default: 15 },        // días antes del fin para alerta
  alerted:         { type: Boolean, default: false },    // flag para no alertar dos veces (si decides persistir)
}, { _id: true, timestamps: true });

const DisbursementSchema = new Schema({
  date:   { type: Date, required: true },
  amount: { type: Number, required: true, default: 0 },
  note:   { type: String, default: '' },
  // para el real: % de avance / avaluó asociado
  appraisalPct: { type: Number, default: null },         // 0..100
}, { _id: true });

const LoanLineItemSchema = new Schema({
  disbursementDate: { type: Date, default: null },
  loanNumber: { type: String, default: '' },
  disbursementAmount: { type: Number, default: 0 },
  maturityDate: { type: Date, default: null },
  amortizedAmount: { type: Number, default: 0 },
  notes: { type: String, default: '' },
}, { _id: true, timestamps: true });

const LoanLineSchema = new Schema({
  phaseId: { type: Schema.Types.ObjectId, default: null, index: true },
  phaseName: { type: String, default: '' },
  name: { type: String, default: 'Linea 1' },
  entries: { type: [LoanLineItemSchema], default: [] },
  // Compatibilidad con la primera versión: si existen datos antiguos aquí,
  // el backend los expone como una partida dentro de entries.
  disbursementDate: { type: Date, default: null },
  loanNumber: { type: String, default: '' },
  disbursementAmount: { type: Number, default: 0 },
  maturityDate: { type: Date, default: null },
  amortizedAmount: { type: Number, default: 0 },
  notes: { type: String, default: '' },
}, { _id: true, timestamps: true });

const UnitAmortizationSchema = new Schema({
  unitId: { type: Schema.Types.ObjectId, ref: 'Unit', default: null, index: true },
  clientName: { type: String, default: '' },
  lot: { type: String, default: '' },
  buyerBank: { type: String, default: '' },
  checkNumber: { type: String, default: '' },
  checkDate: { type: Date, default: null },
  checkAmount: { type: Number, default: 0 },
  checkAmountSource: { type: String, default: 'cpp' },
  amortizationLine1: { type: Number, default: 0 },
  amortizationLine2: { type: Number, default: 0 },
  allocations: {
    type: [{
      loanLineId: { type: Schema.Types.ObjectId, default: null },
      loanLineName: { type: String, default: '' },
      amount: { type: Number, default: 0 },
    }],
    default: []
  },
  promoterAmount: { type: Number, default: 0 },
  notes: { type: String, default: '' },
}, { _id: true, timestamps: true });

const ProjectFinanceSchema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project', index: true, unique: true, required: true },

  // ==========================================================
  // Plan global (legacy). Lo dejamos para compatibilidad/export.
  // La pestaña nueva debe ignorarlo y usar plan por fases.
  // ==========================================================
  plan: {
    uses:    { type: [LineItemSchema], default: [] },
    sources: { type: [LineItemSchema], default: [] },
  },

  phases: { type: [PhaseSchema], default: [] },

  disbursements: {
    planned: { type: [DisbursementSchema], default: [] },
    actual:  { type: [DisbursementSchema], default: [] },
  },

  loanLines: { type: [LoanLineSchema], default: [] },
  unitAmortizations: { type: [UnitAmortizationSchema], default: [] },

}, { timestamps: true });

// -------------------- helpers --------------------
ProjectFinanceSchema.methods.sumItems = function(items = []) {
  return (items || []).reduce((acc, it) => acc + (Number(it?.amount) || 0), 0);
};

// Plan global (legacy)
ProjectFinanceSchema.methods.planTotals = function() {
  return {
    uses:    this.sumItems(this.plan?.uses),
    sources: this.sumItems(this.plan?.sources),
  };
};

// NUEVO: plan por fase (acumulado)
ProjectFinanceSchema.methods.phasePlanTotals = function(phase) {
  return {
    uses:    this.sumItems(phase?.planUses),
    sources: this.sumItems(phase?.planSources),
  };
};

ProjectFinanceSchema.methods.phasesPlanAccumTotals = function() {
  const totals = { uses: 0, sources: 0 };
  for (const ph of (this.phases || [])) {
    totals.uses    += this.sumItems(ph?.planUses);
    totals.sources += this.sumItems(ph?.planSources);
  }
  return totals;
};

// Real acumulado (sum de fases) - ya lo tenías
ProjectFinanceSchema.methods.phasesAccumTotals = function() {
  const totals = {
    uses: 0, sources: 0,
    intereses: 0, aportes: 0, preventas: 0,
  };
  for (const ph of (this.phases || [])) {
    totals.uses      += this.sumItems(ph.uses);
    totals.sources   += this.sumItems(ph.sources);
    totals.intereses += (Number(ph.interesesDevengados) || 0);
    totals.aportes   += (Number(ph.aportesPropios) || 0);
    totals.preventas += (Number(ph.preventas) || 0);
  }
  return totals;
};

// -------------------- KPIs --------------------
ProjectFinanceSchema.methods.kpis = function() {
  const planLegacy = this.planTotals();            // plan global (si existe)
  const planByPhases = this.phasesPlanAccumTotals(); // plan acumulado por fases (nuevo)
  const real = this.phasesAccumTotals();

  // Regla: si hay plan por fases, úsalo para % ejecución; si no, cae al legacy.
  const planUsesForPct = (planByPhases.uses > 0) ? planByPhases.uses : planLegacy.uses;

  const ejecVsPlan = planUsesForPct > 0 ? (real.uses / planUsesForPct) : 0;

  return {
    // legacy (por compatibilidad; UI nueva debería ignorar esto)
    plan: planLegacy,

    // nuevo (lo que debe usar la UI banca-friendly)
    planByPhases,

    // real (acumulado real de fases)
    real,

    percentExecution: Math.min(1, ejecVsPlan), // 0..1
    totalIntereses: real.intereses,
    totalPreventas: real.preventas,

    disbursement: {
      plannedTotal: this.sumItems(this.disbursements?.planned),
      actualTotal:  this.sumItems(this.disbursements?.actual),
    }
  };
};

module.exports = mongoose.model('ProjectFinance', ProjectFinanceSchema);
