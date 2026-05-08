// models/UnitDocFolder.js
const mongoose = require('mongoose');

const UNIT_DOC_DEPARTMENTS = ['commercial', 'tecnico', 'legal'];

const unitDocFolderSchema = new mongoose.Schema({
  tenantKey: {
    type: String,
    index: true
  },

  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
    index: true
  },

  unitId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Unit',
    required: true,
    index: true
  },

  department: {
    type: String,
    enum: UNIT_DOC_DEPARTMENTS,
    required: true,
    index: true
  },

  name: {
    type: String,
    required: true,
    trim: true
  },

  parentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UnitDocFolder',
    default: null,
    index: true
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

unitDocFolderSchema.pre('validate', function (next) {
  if (typeof this.department === 'string') {
    this.department = this.department.toLowerCase().trim();
  }

  if (typeof this.name === 'string') {
    this.name = this.name.trim();
  }

  next();
});

unitDocFolderSchema.index({
  tenantKey: 1,
  projectId: 1,
  unitId: 1,
  department: 1,
  parentId: 1,
  name: 1
});

module.exports = mongoose.model('UnitDocFolder', unitDocFolderSchema);
module.exports.UNIT_DOC_DEPARTMENTS = UNIT_DOC_DEPARTMENTS;