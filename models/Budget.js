const mongoose = require('mongoose');

const budgetSchema = new mongoose.Schema({
  tenantKey: { type: String, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true },
  amountApproved: { type: Number, default: 0 },
  spent: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Budget', budgetSchema);
