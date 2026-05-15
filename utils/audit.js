const AuditLog = require('../models/AuditLog');

function pickTenant(req, fallback) {
  return (
    fallback ||
    req?.tenantKey ||
    req?.tenant?.key ||
    req?.tenant?.tenantKey ||
    req?.user?.tenantKey ||
    req?.headers?.['x-tenant-key'] ||
    req?.headers?.['x-tenant']
  );
}

function pickIp(req) {
  const forwarded = req?.headers?.['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req?.ip || req?.socket?.remoteAddress || '';
}

function compactMetadata(metadata = {}) {
  const out = {};

  for (const [key, value] of Object.entries(metadata || {})) {
    if (value === undefined) continue;
    if (value === null) {
      out[key] = null;
      continue;
    }
    if (typeof value === 'string' && value.length > 500) {
      out[key] = `${value.slice(0, 500)}...`;
      continue;
    }
    out[key] = value;
  }

  return out;
}

async function audit(req, action, details = {}) {
  try {
    if (!action) return;

    await AuditLog.create({
      tenantKey: pickTenant(req, details.tenantKey),
      action,
      actorUserId: details.actorUserId || req?.user?.userId || req?.user?._id || req?.user?.id,
      actorEmail: details.actorEmail || req?.user?.email,
      actorRole: details.actorRole || req?.user?.role,
      targetType: details.targetType,
      targetId: details.targetId,
      projectId: details.projectId,
      ip: pickIp(req),
      userAgent: req?.headers?.['user-agent'],
      status: details.status || 'success',
      message: details.message,
      metadata: compactMetadata(details.metadata)
    });
  } catch (err) {
    console.warn('[audit] log failed:', err?.message || err);
  }
}

module.exports = audit;
