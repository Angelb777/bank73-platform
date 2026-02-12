// routes/admin.js
const express = require('express');
const User = require('../models/User');
const Project = require('../models/Project'); // ROLE-SEP
const { requireRole } = require('../middleware/rbac'); // ROLE-SEP
const router = express.Router();

const { ROLES: VALID_ROLES } = require('../models/User'); // usa la misma fuente que el modelo
const VALID_PUBLISH = ['draft','pending','approved','rejected']; // ROLE-SEP

// ROLE-SEP: Todas estas rutas requieren rol admin (además de auth y tenant previos en server.js)
router.use(requireRole('admin')); // ROLE-SEP

/* =========================================================================
   USUARIOS (Aprobación, bloqueo, listado)
   ========================================================================= */

// ROLE-SEP: GET /api/admin/users?status=pending   -> lista de usuarios del tenant (filtrable por status)
router.get('/users', async (req, res) => {
  try {
    const q = { tenantKey: req.tenantKey };
    if (req.query.status) q.status = req.query.status; // e.g., pending, active, blocked
    const users = await User.find(q, { password: 0 }).sort({ createdAt: -1 });
    res.json({ users });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/users/:id/approve  -> activa y asigna rol (si se envía)
router.post('/users/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const desiredRole = String(req.body?.role || '').trim().toLowerCase();

    const user = await User.findOne({ _id: id, tenantKey: req.tenantKey });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Si no se manda role, usamos el roleRequested; ambos normalizados
    const finalRole = desiredRole || String(user.roleRequested || '').toLowerCase() || 'bank';

    if (!VALID_ROLES.includes(finalRole)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    user.role = finalRole;
    user.status = 'active';
    user.verified = true;          // (opcional si lo usas)
    user.roleRequested = null;     // limpiar para evitar confusiones
    await user.save();

    res.json({
      ok: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        tenantKey: user.tenantKey
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ROLE-SEP: POST /api/admin/users/:id/block -> pone status:'blocked'
router.post('/users/:id/block', async (req, res) => {
  try {
    const { id } = req.params;

    // Evitar que un admin se bloquee a sí mismo
    if (id === req.user.userId) {
      return res.status(400).json({ error: 'No puedes bloquear tu propia cuenta de admin.' });
    }

    const user = await User.findOne({ _id: id, tenantKey: req.tenantKey });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    user.status = 'blocked'; // ROLE-SEP
    await user.save();

    res.json({
      ok: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        tenantKey: user.tenantKey
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// (Mantenida) GET /api/admin/users  -> lista de usuarios del tenant (ya cubierta arriba con filtro opcional)

// (Mantenida) DELETE /api/admin/users/:id -> elimina un usuario del tenant
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Evitar que un admin se elimine a sí mismo
    if (id === req.user.userId) {
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta de admin.' });
    }

    const deleted = await User.findOneAndDelete({ _id: id, tenantKey: req.tenantKey });
    if (!deleted) return res.status(404).json({ error: 'Usuario no encontrado' });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =========================================================================
   PROYECTOS (Aprobación de publicación)
   ========================================================================= */

// ROLE-SEP: GET /api/admin/projects?status=pending
// Lista proyectos del tenant filtrando por publishStatus (draft|pending|approved|rejected).
router.get('/projects', async (req, res) => {
  try {
    const q = { tenantKey: req.tenantKey };
    const status = (req.query.status || '').toLowerCase();
    if (status) {
      if (!VALID_PUBLISH.includes(status)) {
        return res.status(400).json({ error: 'publishStatus inválido' });
      }
      q.publishStatus = status; // ROLE-SEP
    }
    const projects = await Project.find(q).sort({ createdAt: -1 });
    res.json({ projects });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ROLE-SEP: POST /api/admin/projects/:id/approve -> publishStatus:'approved'
router.post('/projects/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const proj = await Project.findOne({ _id: id, tenantKey: req.tenantKey });
    if (!proj) return res.status(404).json({ error: 'Proyecto no encontrado' });

    proj.publishStatus = 'approved'; // ROLE-SEP
    await proj.save();

    res.json({ ok: true, project: proj });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ROLE-SEP: POST /api/admin/projects/:id/reject -> publishStatus:'rejected'
router.post('/projects/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const proj = await Project.findOne({ _id: id, tenantKey: req.tenantKey });
    if (!proj) return res.status(404).json({ error: 'Proyecto no encontrado' });

    proj.publishStatus = 'rejected'; // ROLE-SEP
    await proj.save();

    res.json({ ok: true, project: proj });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
