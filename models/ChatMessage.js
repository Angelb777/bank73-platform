// models/ChatMessage.js
'use strict';

const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
  {
    tenantKey: { type: String, index: true },              // multi-tenant
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true, required: true },

    // autor (derivado de req.user)
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    userEmail: { type: String, required: true, trim: true, lowercase: true },
    userName:  { type: String, trim: true },               // opcional (por si quieres mostrar nombre)

    // contenido
    text:      { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { timestamps: true }
);

// índice para listar rápido por proyecto y fecha
chatMessageSchema.index({ projectId: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
