// routes/chat.js
'use strict';

const express = require('express');
const mongoose = require('mongoose');
const ChatMessage = require('../models/ChatMessage');
const ChatReadState = require('../models/ChatReadState');
const Project = require('../models/Project');
const { requireProjectAccess, _helpers: rbacHelpers } = require('../middleware/rbac');

const router = express.Router();

// Normaliza :id desde :projectId
function normalizeProjectParam(req, _res, next) {
  if (!req.params.id && req.params.projectId) req.params.id = req.params.projectId;
  next();
}

// ✅ Middleware local, simple y sin cuelgues
async function ensureProjectReadable(req, res, next) {
  try {
    const projectId = req.params.projectId || req.params.id;
    if (!mongoose.isValidObjectId(projectId)) {
      return res.status(400).json({ ok:false, error:'bad_project_id' });
    }
    const p = await Project.findById(projectId).select('_id tenantKey').lean();
    if (!p) return res.status(404).json({ ok:false, error:'project_not_found' });

    // Si hay tenant en la request y en el proyecto, valida igualdad
    const reqTenant = req?.user?.tenantKey || req?.tenantKey || req?.tenant?.tenantKey || req.headers['x-tenant-key'] || req.headers['x-tenant'];
    if (reqTenant && p.tenantKey && String(reqTenant) !== String(p.tenantKey)) {
      return res.status(403).json({ ok:false, error:'forbidden' });
    }
    req.project = p;
    next();
  } catch (e) {
    next(e);
  }
}

async function getTenantKey(req) {
  let t =
    req?.user?.tenantKey ||
    req?.tenantKey ||
    req?.tenant?.tenantKey ||
    req?.tenant?.key ||
    req.headers['x-tenant'] ||
    req.headers['x-tenant-key'] ||
    req.query.tenantKey ||
    req.body?.tenantKey ||
    null;

  if (!t && req.params?.projectId) {
    const p = await Project.findById(req.params.projectId).select('tenantKey').lean();
    if (p?.tenantKey) t = p.tenantKey;
  }
  return t;
}

function sanitizeText(s) {
  if (typeof s !== 'string') return '';
  s = s.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '').trim();
  s = s.replace(/<\/?[^>]+>/g, '');
  return s;
}

function canUseProjectChat(req) {
  const role = String(req.user?.role || '').toLowerCase();
  if (role === 'admin' || role === 'bank') return true;
  if (role === 'legal' || role === 'tecnico') return false;
  return rbacHelpers.isUserAssignedToProject(req.project, rbacHelpers.getUserId(req));
}

function getCurrentUserId(req) {
  return rbacHelpers.getUserId(req);
}

/* ============== ENDPOINTS ============== */

// GET lista (con paginación ?before & ?limit)
router.get(
  '/projects/:projectId',
  normalizeProjectParam,
  requireProjectAccess({ commercialOnlySales: false }),
  ensureProjectReadable,
  async (req, res, next) => {
    try {
      const { projectId } = req.params;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const before = req.query.before ? new Date(req.query.before) : null;

      const tenantKey = await getTenantKey(req);
      const q = { tenantKey, projectId };
      if (before && !isNaN(before.getTime())) q.createdAt = { $lt: before };

      const messages = await ChatMessage
  .find(q)
  .sort({ createdAt: -1 })   // nuevos -> viejos
  .limit(limit)
  .lean();

res.set('Cache-Control', 'no-store'); // evita caches
res.json({ ok: true, messages });

    } catch (err) { next(err); }
  }
);

// GET indica si el usuario tiene mensajes nuevos de otras personas.
router.get(
  '/projects/:projectId/unread',
  normalizeProjectParam,
  requireProjectAccess({ commercialOnlySales: false }),
  ensureProjectReadable,
  async (req, res, next) => {
    try {
      const { projectId } = req.params;
      const tenantKey = await getTenantKey(req);
      const userId = getCurrentUserId(req);
      if (!mongoose.isValidObjectId(userId)) {
        return res.status(401).json({ ok: false, error: 'invalid_user' });
      }

      const readState = await ChatReadState.findOne({ tenantKey, projectId, userId })
        .select('lastReadAt')
        .lean();
      const query = {
        tenantKey,
        projectId,
        notifyUnread: true,
        userId: { $ne: userId }
      };
      if (readState?.lastReadAt) query.createdAt = { $gt: readState.lastReadAt };

      const latestUnread = await ChatMessage.findOne(query)
        .sort({ createdAt: -1 })
        .select('_id createdAt')
        .lean();

      res.set('Cache-Control', 'no-store');
      res.json({
        ok: true,
        hasUnread: !!latestUnread,
        latestUnreadAt: latestUnread?.createdAt || null
      });
    } catch (err) { next(err); }
  }
);

// POST marca como leidos todos los mensajes visibles hasta messageId.
router.post(
  '/projects/:projectId/read',
  normalizeProjectParam,
  requireProjectAccess({ commercialOnlySales: false }),
  ensureProjectReadable,
  async (req, res, next) => {
    try {
      const { projectId } = req.params;
      const tenantKey = await getTenantKey(req);
      const userId = getCurrentUserId(req);
      const messageId = req.body?.messageId;
      if (!mongoose.isValidObjectId(userId)) {
        return res.status(401).json({ ok: false, error: 'invalid_user' });
      }
      if (!mongoose.isValidObjectId(messageId)) {
        return res.status(400).json({ ok: false, error: 'bad_message_id' });
      }

      const message = await ChatMessage.findOne({ _id: messageId, tenantKey, projectId })
        .select('createdAt')
        .lean();
      if (!message) return res.status(404).json({ ok: false, error: 'message_not_found' });

      const readStateFilter = { tenantKey, projectId, userId };
      const readStateUpdate = {
        $max: { lastReadAt: message.createdAt },
        $setOnInsert: { tenantKey, projectId, userId }
      };
      try {
        await ChatReadState.updateOne(readStateFilter, readStateUpdate, { upsert: true });
      } catch (error) {
        // Dos pestañas pueden intentar crear el primer estado a la vez.
        if (error?.code !== 11000) throw error;
        await ChatReadState.updateOne(readStateFilter, { $max: { lastReadAt: message.createdAt } });
      }

      res.json({ ok: true, lastReadAt: message.createdAt });
    } catch (err) { next(err); }
  }
);

// POST crear mensaje
router.post(
  '/projects/:projectId',
  normalizeProjectParam,
  requireProjectAccess({ commercialOnlySales: false }),
  ensureProjectReadable,
  async (req, res, next) => {
    try {
      const { projectId } = req.params;
      const raw = req.body?.text;
      const text = sanitizeText(raw);

      if (!text) return res.status(400).json({ ok:false, error:'empty_text' });
      if (text.length > 2000) return res.status(400).json({ ok:false, error:'too_long' });

      const tenantKey = await getTenantKey(req);

      const msg = await ChatMessage.create({
        tenantKey,
        projectId,
        userId: getCurrentUserId(req) || null,
        userEmail: (req?.user?.email || 'desconocido@local').toLowerCase(),
        userName: req?.user?.name || req?.user?.fullName || null,
        text,
        notifyUnread: true
      });
      res.status(201).json({ ok: true, message: msg });
    } catch (err) { next(err); }
  }
);

// DELETE borrar mensaje
router.delete(
  '/:messageId',
  async (req, res, next) => {
    try {
      const { messageId } = req.params;
      if (!mongoose.isValidObjectId(messageId)) {
        return res.status(400).json({ ok:false, error:'bad_message_id' });
      }

      const tenantKey = await getTenantKey(req);
      const msg = await ChatMessage.findOne({ _id: messageId, tenantKey });
      if (!msg) return res.status(404).json({ ok:false, error:'not_found' });

      // Reutiliza ensureProjectReadable con el projectId del mensaje
      req.params.projectId = String(msg.projectId);
      await new Promise((resolve, reject) =>
        ensureProjectReadable(req, res, (err) => (err ? reject(err) : resolve()))
      );
      if (!canUseProjectChat(req)) return res.status(403).json({ ok:false, error:'forbidden' });

      await ChatMessage.deleteOne({ _id: messageId, tenantKey });
      res.json({ ok: true, deletedId: messageId });
    } catch (err) { next(err); }
  }
);

module.exports = router;
