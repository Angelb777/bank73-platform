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

function auth(req, res, next) {
  const authHeader = req.header('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 1) Determina tenant de la petición o del token
    let reqTenantKey = readReqTenantKey(req);

    // Fallback: si no vino tenant en headers/query/body, usa el del token
    if (!reqTenantKey && decoded.tenantKey) {
      reqTenantKey = decoded.tenantKey;
      req.tenantKey = decoded.tenantKey;
      req.tenant = { key: decoded.tenantKey, tenantKey: decoded.tenantKey };
    }

    if (!reqTenantKey) {
      console.warn('[auth] 403 falta tenant', { path: req.originalUrl });
      return res.status(403).json({ error: 'Falta tenant en la petición' });
    }

    // Si vino distinto al del token, normaliza en vez de bloquear
    if (decoded.tenantKey && String(decoded.tenantKey) !== String(reqTenantKey)) {
      console.warn('[auth] tenant mismatch - normalizing to token', {
        tokenTenant: decoded.tenantKey,
        reqTenantKey,
        path: req.originalUrl
      });
      reqTenantKey = decoded.tenantKey;
      req.tenantKey = decoded.tenantKey;
      req.tenant = { key: decoded.tenantKey, tenantKey: decoded.tenantKey };
    }

    req.user = { ...decoded, tenantKey: decoded.tenantKey };
    if (!req.tenantKey) req.tenantKey = reqTenantKey;

    next();
  } catch (_e) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

async function requireActiveUser(req, res, next) {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    const user = await User.findById(req.user.userId).lean();
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

    // 2) Normaliza también aquí: si difiere, ajusta al tenant del usuario
    const reqTenantKey = readReqTenantKey(req) || req.user?.tenantKey;
    if (String(user.tenantKey) !== String(reqTenantKey)) {
      console.warn('[auth] user/tenant mismatch - normalizing', {
        userTenant: user.tenantKey,
        reqTenantKey,
        path: req.originalUrl
      });
      req.tenantKey = user.tenantKey;
      req.tenant = { key: user.tenantKey, tenantKey: user.tenantKey };
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        error: 'Cuenta pendiente de aprobación o bloqueada. Contacta con un administrador.'
      });
    }

    // Enriquecer req.user para RBAC
    req.user = {
      ...req.user,
      role: user.role,
      status: user.status,
      tenantKey: user.tenantKey,
      email: user.email,
      name: user.name
    };

    if (!req.tenantKey) req.tenantKey = user.tenantKey;

    next();
  } catch (err) {
    console.error('[auth] requireActiveUser error:', err);
    return res.status(500).json({ error: 'Error de autenticación' });
  }
}

module.exports = auth;
module.exports.requireActiveUser = requireActiveUser;
