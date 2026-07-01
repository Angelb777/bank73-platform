// middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

function readReqTenantKey(req) {
  return (
    req.tenant?.key ||
    req.tenant?.tenantKey ||
    req.tenantKey ||
    req.headers['x-tenant-key'] ||
    req.headers['x-tenant'] ||
    undefined
  );
}

function tenantList(primary, list) {
  return Array.from(new Set([
    primary,
    ...(Array.isArray(list) ? list : [])
  ].map(v => String(v || '').trim()).filter(Boolean)));
}

function auth(req, res, next) {
  const authHeader = req.header('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let reqTenantKey = readReqTenantKey(req);

    if (!reqTenantKey && decoded.tenantKey) {
      reqTenantKey = decoded.tenantKey;
      req.tenantKey = decoded.tenantKey;
      req.tenant = { key: decoded.tenantKey, tenantKey: decoded.tenantKey };
    }

    if (!reqTenantKey) {
      console.warn('[auth] 403 falta tenant', { path: req.originalUrl });
      return res.status(403).json({ error: 'Falta tenant en la peticion' });
    }

    const allowedTenants = tenantList(decoded.tenantKey, decoded.tenantKeys);
    if (
      decoded.tenantKey &&
      String(decoded.tenantKey) !== String(reqTenantKey) &&
      !allowedTenants.includes(String(reqTenantKey))
    ) {
      console.warn('[auth] tenant mismatch - normalizing to token', {
        tokenTenant: decoded.tenantKey,
        reqTenantKey,
        path: req.originalUrl
      });
      reqTenantKey = decoded.tenantKey;
      req.tenantKey = decoded.tenantKey;
      req.tenant = { key: decoded.tenantKey, tenantKey: decoded.tenantKey };
    }

    req.user = { ...decoded, tenantKey: reqTenantKey, tenantKeys: allowedTenants };
    if (!req.tenantKey) req.tenantKey = reqTenantKey;

    next();
  } catch (_e) {
    return res.status(401).json({ error: 'Token invalido' });
  }
}

async function requireActiveUser(req, res, next) {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    const user = await User.findById(req.user.userId).lean();
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

    const reqTenantKey = readReqTenantKey(req) || req.user?.tenantKey;
    const allowedTenants = tenantList(user.tenantKey, user.tenantKeys);
    const isAllowedTenant = allowedTenants.includes(String(reqTenantKey));
    const activeTenant = isAllowedTenant ? reqTenantKey : user.tenantKey;

    if (!isAllowedTenant) {
      console.warn('[auth] user/tenant mismatch - normalizing', {
        userTenant: user.tenantKey,
        reqTenantKey,
        path: req.originalUrl
      });
    }

    req.tenantKey = activeTenant;
    req.tenant = { key: activeTenant, tenantKey: activeTenant };

    if (user.status !== 'active') {
      return res.status(403).json({
        error: 'Cuenta pendiente de aprobacion o bloqueada. Contacta con un administrador.'
      });
    }

    req.user = {
      ...req.user,
      role: user.role,
      status: user.status,
      tenantKey: activeTenant,
      tenantKeys: allowedTenants,
      email: user.email,
      name: user.name
    };

    next();
  } catch (err) {
    console.error('[auth] requireActiveUser error:', err);
    return res.status(500).json({ error: 'Error de autenticacion' });
  }
}

module.exports = auth;
module.exports.requireActiveUser = requireActiveUser;
