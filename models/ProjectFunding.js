const mongoose = require('mongoose');
const { Schema } = mongoose;

const FUNDING_STATUSES = [
  'pending_review', 'in_review', 'requires_information', 'approved',
  'published', 'partially_funded', 'funded', 'rejected'
];

const scoreItemSchema = new Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  category: { type: String, required: true },
  automaticScore: { type: Number, default: 0 },
  maxScore: { type: Number, default: 0 },
  manualScore: { type: Number, default: null },
  reason: { type: String, default: '' }
}, { _id: false });

const projectFundingSchema = new Schema({
  tenantKey: { type: String, required: true, index: true },
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, unique: true, index: true },
  requestedAmount: { type: Number, min: 0, default: null },
  securedRequestAmount: { type: Number, min: 0, default: 0 },
  fundingDeadline: { type: Date, default: null },
  status: { type: String, enum: FUNDING_STATUSES, default: 'pending_review', index: true },
  automaticScore: { type: Number, default: 0 },
  finalScore: { type: Number, default: null },
  scoreVersion: { type: String, default: '1.0' },
  scoreBreakdown: { type: [scoreItemSchema], default: [] },
  marketAssessment: { type: String, trim: true, default: '' },
  internalComments: { type: String, trim: true, default: '' },
  publicConclusions: { type: String, trim: true, default: '' },
  marketAnalysis: {
    targetHouseholdMonthlyIncome: { type: Number, min: 0, default: 0 },
    averageProjectSalePrice: { type: Number, min: 0, default: 0 },
    estimatedMonthlyMortgagePayment: { type: Number, min: 0, default: 0 },
    paymentToIncomeRatio: { type: Number, min: 0, default: 0 },
    comparableProjectsAveragePrice: { type: Number, min: 0, default: 0 },
    estimatedSalesVelocity: { type: String, trim: true, default: '' },
    dataSource: { type: String, trim: true, default: '' },
    referenceDate: { type: Date, default: null },
    marketScore: { type: Number, min: 0, max: 100, default: 0 },
    analystComment: { type: String, trim: true, default: '' }
  },
  isVisibleToBanks: { type: Boolean, default: false, index: true },
  visibilityMode: { type: String, enum: ['all_banks', 'selected_tenants'], default: 'all_banks', index: true },
  visibleToTenantKeys: [{ type: String, trim: true }],
  publicFields: [{ type: String, trim: true }],
  publicDocumentIds: [{ type: Schema.Types.ObjectId, ref: 'Document' }],
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  publishedAt: { type: Date, default: null },
  publishedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

projectFundingSchema.index({ tenantKey: 1, status: 1, updatedAt: -1 });
projectFundingSchema.index({ isVisibleToBanks: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model('ProjectFunding', projectFundingSchema);
module.exports.FUNDING_STATUSES = FUNDING_STATUSES;
