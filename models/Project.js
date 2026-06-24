// models/Project.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const PUBLISH_STATUSES = ['draft', 'pending', 'approved', 'rejected'];
const PROJECT_CURRENCIES = ['PAB', 'USD', 'EUR'];
const PROJECT_TYPES = [
  'Residencial vertical PH',
  'Residencial horizontal',
  'Comercial',
  'Mixto',
  'Lotes unifamiliares',
  'Lotes, adosados y dúplex PH',
  'Otro'
];

const projectSchema = new Schema({
  tenantKey: { type: String, index: true },

  name: String,
  description: String,
  location: { type: String, trim: true, default: '' },
  address: { type: String, trim: true, default: '' },
  city: { type: String, trim: true, default: '' },
  province: { type: String, trim: true, default: '' },
  coordinates: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null }
  },
  projectType: { type: String, enum: ['', ...PROJECT_TYPES], default: '' },
  currency: { type: String, enum: PROJECT_CURRENCIES, default: 'PAB' },

  status: { type: String, default: 'EN_CURSO' },

  publishStatus: {
    type: String,
    enum: PUBLISH_STATUSES,
    default: 'pending',
    index: true
  },

  createdBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },

  teamSuggestion: {
    promoter:   [{ type: String, trim: true }],
    commercial: [{ type: String, trim: true }],
    legal:      [{ type: String, trim: true }],
    tecnico:    [{ type: String, trim: true }],
    gerencia:   [{ type: String, trim: true }],
    socios:     [{ type: String, trim: true }],
    financiero: [{ type: String, trim: true }],
    contable:   [{ type: String, trim: true }],
    notes:      { type: String, trim: true, default: '' }
  },

  // Asignaciones (legacy + nuevos roles)
  assignedPromoters:   [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
  assignedCommercials: [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],

  // NUEVOS CAMPOS
  assignedLegal:       [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
  assignedTecnicos:    [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
  assignedGerencia:    [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
  assignedSocios:      [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
  assignedFinanciero:  [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
  assignedContable:    [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],

  // Comercial: configuración del grupo sin sector/carpeta
  commercialUnassignedName: {
    type: String,
    default: 'Sin carpeta'
  },

  commercialUnassignedColor: {
    type: String,
    default: '#0f172a'
  },

  legalData: {
    promoterLegalName: { type: String, trim: true, default: '' },
    boardMembers: {
      type: [{
        name: { type: String, trim: true, default: '' },
        cedula: { type: String, trim: true, default: '' },
        position: { type: String, trim: true, default: '' }
      }],
      default: []
    },
    shareholders: {
      type: [{
        name: { type: String, trim: true, default: '' },
        cedula: { type: String, trim: true, default: '' },
        percentage: { type: Number, default: 0 }
      }],
      default: []
    },
    interimBank: { type: String, trim: true, default: '' },
    trustApplies: { type: Boolean, default: false },
    trustName: { type: String, trim: true, default: '' }
  },

  technicalData: {
    phasesCount: { type: Number, default: 0 },
    totalUnits: { type: Number, default: 0 },
    notes: { type: String, trim: true, default: '' }
  },

  housingModels: {
    type: [{
      name: { type: String, trim: true, default: '' },
      bedrooms: { type: Number, default: 0 },
      bathrooms: { type: Number, default: 0 },
      openAreaM2: { type: Number, default: 0 },
      closedAreaM2: { type: Number, default: 0 },
      price: { type: Number, default: 0 },
      unitsCount: { type: Number, default: 0 },
      initialStatuses: {
        disponible: { type: Number, default: 0 },
        inventario: { type: Number, default: 0 },
        reservado: { type: Number, default: 0 },
        con_cpp: { type: Number, default: 0 },
        tramite_legal_activado: { type: Number, default: 0 },
        escriturado_traspasado: { type: Number, default: 0 },
        vivienda_entregada: { type: Number, default: 0 },
        cancelado: { type: Number, default: 0 }
      },
      observations: { type: String, trim: true, default: '' }
    }],
    default: []
  },

  financePhases: {
    type: [{
      name: { type: String, trim: true, default: '' },
      startDate: { type: Date, default: null },
      endDate: { type: Date, default: null },
      planUses: {
        type: [{ name: { type: String, trim: true, default: '' }, amount: { type: Number, default: 0 } }],
        default: []
      },
      planSources: {
        type: [{ name: { type: String, trim: true, default: '' }, amount: { type: Number, default: 0 } }],
        default: []
      },
      loanLineNames: [{ type: String, trim: true }]
    }],
    default: []
  },

  financialConditions: {
    projectTotal: { type: Number, default: 0 },
    bankFinancedAmount: { type: Number, default: 0 },
    bankFinancedPct: { type: Number, default: 0 },
    promoterContribution: { type: Number, default: 0 },
    promoterContributionPct: { type: Number, default: 0 },
    interestRate: { type: Number, default: 0 },
    term: { type: String, trim: true, default: '' },
    paymentMethod: { type: String, trim: true, default: '' },
    commission: { type: String, trim: true, default: '' },
    disbursementMethod: { type: String, trim: true, default: '' },
    disbursementConditions: { type: String, trim: true, default: '' },
    amortizationConditions: { type: String, trim: true, default: '' },
    requiredPresales: { type: String, trim: true, default: '' },
    guarantees: { type: String, trim: true, default: '' },
    insurance: { type: String, trim: true, default: '' },
    facilities: {
      type: [{
        facilityType: { type: String, trim: true, default: '' },
        loanPurpose: { type: String, trim: true, default: '' },
        bankFinancedPct: { type: Number, default: 0 },
        cppSalesAmortizationPct: { type: Number, default: 0 },
        promoterRequiredContribution: { type: Number, default: 0 }
      }],
      default: []
    },
    precedentConditions: {
      presalesMet: { type: Boolean, default: false },
      constructionPermitsApproved: { type: Boolean, default: false },
      plansApproved: { type: Boolean, default: false },
      insuranceDelivered: { type: Boolean, default: false },
      guaranteesConstituted: { type: Boolean, default: false },
      environmentalStudyApproved: { type: Boolean, default: false },
      trustConstituted: { type: Boolean, default: false },
      otherRequirementsMet: { type: Boolean, default: false },
      otherRequirements: { type: String, trim: true, default: '' }
    },
    operationStructure: {
      trustee: { type: String, trim: true, default: '' },
      trustType: { type: String, trim: true, default: '' },
      technicalInspector: { type: String, trim: true, default: '' },
      financialInspector: { type: String, trim: true, default: '' }
    }
  },

  // KPIs
  loanApproved:   { type: Number, default: 0 },
  loanDisbursed:  { type: Number, default: 0 },
  loanBalance:    { type: Number, default: 0 },
  budgetApproved: { type: Number, default: 0 },
  budgetSpent:    { type: Number, default: 0 },
  unitsTotal:     { type: Number, default: 0 },
  unitsSold:      { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Project', projectSchema);
module.exports.PUBLISH_STATUSES = PUBLISH_STATUSES;
module.exports.PROJECT_TYPES = PROJECT_TYPES;
module.exports.PROJECT_CURRENCIES = PROJECT_CURRENCIES;
