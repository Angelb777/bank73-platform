const express = require('express');
const Project = require('../models/Project');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const Document = require('../models/Document');
const Milestone = require('../models/Milestone');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();

function idsFromProject(project) {
  return [
    project.createdBy,
    ...(project.assignedPromoters || []),
    ...(project.assignedCommercials || []),
    ...(project.assignedLegal || []),
    ...(project.assignedTecnicos || []),
    ...(project.assignedGerencia || []),
    ...(project.assignedSocios || []),
    ...(project.assignedFinanciero || []),
    ...(project.assignedContable || [])
  ].filter(Boolean).map(String);
}

router.get('/dashboard', requireRole('bank'), async (req, res) => {
  try {
    const tenantKey = req.tenantKey;
    const projects = await Project.find({
      tenantKey,
      publishStatus: 'approved'
    }).sort({ updatedAt: -1, createdAt: -1 }).lean();

    const projectIds = projects.map(project => project._id);
    const relatedUserIds = Array.from(new Set(projects.flatMap(idsFromProject)));

    const [tenantUsers, relatedUsers, logs, documentsCount, milestones] = await Promise.all([
      User.find(
        { $or: [{ tenantKey }, { tenantKeys: tenantKey }] },
        { password: 0 }
      ).sort({ role: 1, name: 1, email: 1 }).limit(100).lean(),
      relatedUserIds.length
        ? User.find({
            _id: { $in: relatedUserIds },
            $or: [{ tenantKey }, { tenantKeys: tenantKey }]
          }, { password: 0 }).lean()
        : [],
      AuditLog.find({ tenantKey }).sort({ createdAt: -1 }).limit(50).lean(),
      projectIds.length ? Document.countDocuments({ tenantKey, projectId: { $in: projectIds } }) : 0,
      projectIds.length
        ? Milestone.find({ tenantKey, projectId: { $in: projectIds } }).sort({ createdAt: -1 }).limit(20).lean()
        : []
    ]);

    const usersById = new Map();
    [...tenantUsers, ...relatedUsers].forEach(user => usersById.set(String(user._id), user));

    res.json({
      tenantKey,
      projects,
      users: Array.from(usersById.values()),
      logs,
      alerts: milestones,
      metrics: {
        projects: projects.length,
        users: usersById.size,
        documents: documentsCount,
        alerts: milestones.length
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
