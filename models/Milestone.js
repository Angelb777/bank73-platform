const mongoose = require('mongoose');

const milestoneSchema = new mongoose.Schema({
  tenantKey: { type: String, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true },
  name: String,
  status: { type: String, default: 'EN_PROCESO' },
  progress: { type: Number, default: 0 }, // 0..100
  dueDate: Date
}, { timestamps: true });

module.exports = mongoose.model('Milestone', milestoneSchema);
