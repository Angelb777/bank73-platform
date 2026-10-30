'use strict';

const mongoose = require('mongoose');

const chatReadStateSchema = new mongoose.Schema(
  {
    tenantKey: { type: String, required: true, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    lastReadAt: { type: Date, required: true }
  },
  { timestamps: true }
);

chatReadStateSchema.index(
  { tenantKey: 1, projectId: 1, userId: 1 },
  { unique: true }
);

module.exports = mongoose.model('ChatReadState', chatReadStateSchema);
