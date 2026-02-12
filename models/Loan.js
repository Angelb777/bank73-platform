const mongoose = require('mongoose');

const loanSchema = new mongoose.Schema({
  tenantKey: { type: String, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true },
  amountApproved: { type: Number, default: 0 },
  disbursements: [{
    date: Date,
    amount: Number
  }]
}, { timestamps: true });

module.exports = mongoose.model('Loan', loanSchema);
