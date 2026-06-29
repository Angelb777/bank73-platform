// routes/admin.js
const express = require('express');
const User = require('../models/User');
const Project = require('../models/Project'); // ROLE-SEP
const AuditLog = require('../models/AuditLog');
const { requireRole } = require('../middleware/rbac'); // ROLE-SEP
const audit = require('../utils/audit');
const router = express.Router();

const { ROLES: VALID_ROLES } = require('../models/User'); // usa la misma fuente que el modelo
const { PROMOTER_TYPES = [] } = require('../models/User');
const { promoterProfileCompletion } = require('../models/User');
const VALID_PUBLISH = ['draft','pending','approved','rejected']; // ROLE-SEP

function sanitizePromoterProfile(input = {}) {
  const toNum = (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(String(v).replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0) {
      const err = new Error('Los campos numéricos del perfil del promotor deben ser positivos.');
      err.status = 400;
      throw err;
    }
    return n;
  };
  const countriesRaw = Array.isArray(input.countries)
    ? input.countries
    : String(input.countries || input.paisesOperacion || '').split(/\r?\n|,/);
  const normalizePromoterType = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return 'No definido';
    const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const found = PROMOTER_TYPES.find(type =>
      type.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === normalized
    );
    return found || 'No definido';
  };

  return {
    companyName: String(input.companyName ?? input.sociedad ?? input.nombreSociedad ?? '').trim().slice(0, 180),
    promoterType: normalizePromoterType(input.promoterType ?? input.tipoPromotor ?? input.modeloPromotor),
    yearsExperience: toNum(input.yearsExperience ?? input.aniosExperiencia),
    deliveredProjects: toNum(input.deliveredProjects ?? input.proyectosEntregados),
    activeProjects: toNum(input.activeProjects ?? input.proyectosActivos),
    developedVolume: toNum(input.developedVolume ?? input.volumenDesarrollado ?? input.volumenTotalDesarrollado),
    developedUnits: toNum(input.developedUnits ?? input.unidadesDesarrolladas),
    averageProjectTicket: toNum(input.averageProjectTicket ?? input.ticketMedioProyecto),
    bankFinancingExperience: String(input.bankFinancingExperience ?? input.experienciaFinanciacionBancaria ?? '').trim().slice(0, 240),
    banksWorkedWith: Array.from(new Set((Array.isArray(input.banksWorkedWith)
      ? input.banksWorkedWith
      : String(input.banksWorkedWith || input.bancosTrabajados || '').split(/\r?\n|,/))
      .map(x => String(x || '').trim()).filter(Boolean))).slice(0, 30),
    onTimeDeliveryHistory: String(input.onTimeDeliveryHistory ?? input.historialEntregasTiempo ?? '').trim().slice(0, 240),
    incidentHistory: String(input.incidentHistory ?? input.historialIncidencias ?? '').trim().slice(0, 240),
    documentationLevel: String(input.documentationLevel ?? input.nivelDocumentacion ?? '').trim().slice(0, 120),
    internalTeam: {
      technical: !!(input.internalTeam?.technical ?? input.equipoTecnico),
      financial: !!(input.internalTeam?.financial ?? input.equipoFinanciero),
      commercial: !!(input.internalTeam?.commercial ?? input.equipoComercial),
      legal: !!(input.internalTeam?.legal ?? input.equipoLegal)
    },
    countries: Array.from(new Set(countriesRaw.map(x => String(x || '').trim()).filter(Boolean))).slice(0, 20),
    notes: String(input.notes ?? input.notas ?? '').trim().slice(0, 1000)
  };
}

// ROLE-SEP: Todas estas rutas requieren rol admin (además de auth y tenant previos en server.js)
router.use(requireRole('admin')); // ROLE-SEP

/* =========================================================================
   ACTIVIDAD / AUDITORÍA
   ========================================================================= */

router.get('/audit-logs', async (req, res) => {
  try {
    const q = { tenantKey: req.tenantKey };
    const action = String(req.query.action || '').trim();
    const status = String(req.query.status || '').trim();
    const search = String(req.query.q || '').trim();

    if (action) q.action = action;
    if (status) q.status = status;

    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      q.$or = [
        { action: rx },
        { actorEmail: rx },
        { actorRole: rx },
        { targetType: rx },
        { message: rx },
        { ip: rx }
      ];
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 80, 10), 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      AuditLog.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(q)
    ]);

    res.json({ logs, total, page, limit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

    await audit(req, 'user.approved', {
      targetType: 'user',
      targetId: user._id,
      message: 'Usuario aprobado',
      metadata: { email: user.email, role: user.role, name: user.name }
    });

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

router.patch('/users/:id/promoter-profile', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findOne({ _id: id, tenantKey: req.tenantKey });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    user.promoterProfile = sanitizePromoterProfile(req.body?.promoterProfile || req.body?.perfilPromotor || req.body || {});
    await user.save();

    await audit(req, 'user.promoter_profile_updated', {
      targetType: 'user',
      targetId: user._id,
      message: 'Perfil del promotor actualizado',
      metadata: { email: user.email, role: user.role, promoterCategory: user.promoterCategory }
    });

    res.json({
      ok: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        roleRequested: user.roleRequested,
        status: user.status,
        tenantKey: user.tenantKey,
        promoterProfile: user.promoterProfile || null,
        promoterCategory: user.promoterCategory || 'No definido',
        promoterProfileCompletion: promoterProfileCompletion(user.promoterProfile || {})
      }
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
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

    await audit(req, 'user.blocked', {
      targetType: 'user',
      targetId: user._id,
      status: 'blocked',
      message: 'Usuario bloqueado',
      metadata: { email: user.email, role: user.role, name: user.name }
    });

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

router.post('/users/:id/unblock', async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findOne({ _id: id, tenantKey: req.tenantKey });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    user.status = 'active';
    await user.save();

    await audit(req, 'user.unblocked', {
      targetType: 'user',
      targetId: user._id,
      status: 'info',
      message: 'Usuario desbloqueado',
      metadata: { email: user.email, role: user.role, name: user.name }
    });

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

    await audit(req, 'user.deleted', {
      targetType: 'user',
      targetId: deleted._id,
      message: 'Usuario eliminado',
      metadata: { email: deleted.email, role: deleted.role, name: deleted.name, status: deleted.status }
    });

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
    const projects = await Project.find(q).sort({ createdAt: -1 }).lean();
    res.json({ projects: projects.map(p => ({ ...p, tipoProyecto: p.projectType || '' })) });
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

    await audit(req, 'project.approved', {
      targetType: 'project',
      targetId: proj._id,
      projectId: proj._id,
      message: 'Proyecto aprobado',
      metadata: { name: proj.name, publishStatus: proj.publishStatus }
    });

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

    await audit(req, 'project.rejected', {
      targetType: 'project',
      targetId: proj._id,
      projectId: proj._id,
      status: 'blocked',
      message: 'Proyecto rechazado',
      metadata: { name: proj.name, publishStatus: proj.publishStatus }
    });

    res.json({ ok: true, project: proj });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
