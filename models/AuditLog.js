const mongoose = require('mongoose');

const retentionDays = Math.max(Number(process.env.AUDIT_LOG_RETENTION_DAYS) || 90, 30);

const auditLogSchema = new mongoose.Schema({
  tenantKey: { type: String, index: true },
  action: { type: String, required: true, index: true },

  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  actorEmail: { type: String, index: true },
  actorRole: { type: String },

  targetType: { type: String, index: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true },

  ip: { type: String },
  userAgent: { type: String },
  status: { type: String, enum: ['success', 'failure', 'blocked', 'info'], default: 'success', index: true },
  message: { type: String },
  metadata: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

auditLogSchema.index({ tenantKey: 1, createdAt: -1 });
auditLogSchema.index({ tenantKey: 1, action: 1, createdAt: -1 });
auditLogSchema.index({ tenantKey: 1, status: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: retentionDays * 24 * 60 * 60 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
