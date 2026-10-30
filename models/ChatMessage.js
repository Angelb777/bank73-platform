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

    // Solo los mensajes creados desde la activacion de las notificaciones
    // generan avisos. Los documentos historicos, sin este campo, se ignoran.
    notifyUnread: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

// índice para listar rápido por proyecto y fecha
chatMessageSchema.index({ projectId: 1, createdAt: -1 });
chatMessageSchema.index({ tenantKey: 1, projectId: 1, notifyUnread: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
