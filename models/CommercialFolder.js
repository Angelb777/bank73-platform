const mongoose = require('mongoose');

const CommercialFolderSchema = new mongoose.Schema({
  tenantKey: { type: String, index: true },

  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
    index: true
  },

  name: {
    type: String,
    required: true,
    trim: true
  },

  color: {
    type: String,
    default: '#0f172a'
  },

  order: {
    type: Number,
    default: 0
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

CommercialFolderSchema.index({ projectId: 1, order: 1 });

module.exports = mongoose.model('CommercialFolder', CommercialFolderSchema);