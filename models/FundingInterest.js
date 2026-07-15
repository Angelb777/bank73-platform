const mongoose = require('mongoose');
const { Schema } = mongoose;
const INTEREST_STATUSES = ['received','in_review','additional_information_requested','contact_authorized','in_negotiation','offer_received','accepted','rejected','closed'];
const schema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  funding: { type: Schema.Types.ObjectId, ref: 'ProjectFunding', required: true, index: true },
  projectTenantKey: { type: String, required: true, index: true },
  bankTenantKey: { type: String, required: true, index: true },
  bankUser: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  bankName: { type: String, trim: true, default: '' },
  amount: { type: Number, min: 0, required: true },
  phaseIds: [{ type: Schema.Types.ObjectId }],
  phaseNames: [{ type: String, trim: true }],
  comment: { type: String, trim: true, default: '' },
  responsiblePerson: { type: String, trim: true, required: true },
  internalContact: { type: String, trim: true, required: true },
  status: { type: String, enum: INTEREST_STATUSES, default: 'received', index: true },
  notificationPending: { type: Boolean, default: true, index: true },
  notificationReviewedAt: { type: Date, default: null },
  notificationReviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  contactAuthorizedAt: { type: Date, default: null },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  history: [{ status: { type: String, enum: INTEREST_STATUSES }, note: String, changedBy: { type: Schema.Types.ObjectId, ref: 'User' }, changedAt: { type: Date, default: Date.now } }]
}, { timestamps: true });
schema.index({ projectTenantKey: 1, status: 1, createdAt: -1 });
schema.index({ bankTenantKey: 1, createdAt: -1 });
module.exports = mongoose.model('FundingInterest', schema);
module.exports.INTEREST_STATUSES = INTEREST_STATUSES;
