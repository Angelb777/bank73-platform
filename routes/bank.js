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
    ...(project.assignedBanks || []),
    ...(project.assignedLegal || []),
    ...(project.assignedTecnicos || []),
    ...(project.assignedGerencia || []),
    ...(project.assignedSocios || []),
    ...(project.assignedFinanciero || []),
    ...(project.assignedContable || [])
  ].filter(Boolean).map(String);
}

function projectAssignedToUsersFilter(userIds = []) {
  return {
    $or: [
      { assignedPromoters: { $in: userIds } },
      { assignedCommercials: { $in: userIds } },
      { assignedBanks: { $in: userIds } },
      { assignedLegal: { $in: userIds } },
      { assignedTecnicos: { $in: userIds } },
      { assignedGerencia: { $in: userIds } },
      { assignedSocios: { $in: userIds } },
      { assignedFinanciero: { $in: userIds } },
      { assignedContable: { $in: userIds } }
    ]
  };
}

router.get('/dashboard', requireRole('bank'), async (req, res) => {
  try {
    const tenantKeys = Array.isArray(req.user?.tenantKeys)
      ? Array.from(new Set(req.user.tenantKeys.map(v => String(v || '').trim()).filter(Boolean)))
      : [];

    if (!tenantKeys.length) {
      return res.status(403).json({ error: 'No tienes tenants asignados.' });
    }

    const tenantFilter = { $in: tenantKeys };
    const tenantUsers = await User.find(
      { $or: [{ tenantKey: tenantFilter }, { tenantKeys: tenantFilter }] },
      { password: 0 }
    ).sort({ role: 1, name: 1, email: 1 }).limit(100).lean();

    const tenantUserIds = tenantUsers.map(user => user._id);
    const projectScope = tenantUserIds.length
      ? {
          $or: [
            { tenantKey: tenantFilter },
            projectAssignedToUsersFilter(tenantUserIds)
          ]
        }
      : { tenantKey: tenantFilter };

    const projects = await Project.find(projectScope)
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    const projectIds = projects.map(project => project._id);
    const projectTenantKeys = Array.from(new Set(projects.map(project => String(project.tenantKey || '').trim()).filter(Boolean)));
    const projectTenantFilter = projectTenantKeys.length ? { $in: projectTenantKeys } : tenantFilter;
    const relatedUserIds = Array.from(new Set(projects.flatMap(idsFromProject)));

    const [relatedUsers, logs, documentsCount, milestones] = await Promise.all([
      relatedUserIds.length
        ? User.find({
            _id: { $in: relatedUserIds },
            $or: [{ tenantKey: projectTenantFilter }, { tenantKeys: projectTenantFilter }]
          }, { password: 0 }).lean()
        : [],
      AuditLog.find({ tenantKey: tenantFilter }).sort({ createdAt: -1 }).limit(50).lean(),
      projectIds.length ? Document.countDocuments({ tenantKey: projectTenantFilter, projectId: { $in: projectIds } }) : 0,
      projectIds.length
        ? Milestone.find({ tenantKey: projectTenantFilter, projectId: { $in: projectIds } }).sort({ createdAt: -1 }).limit(20).lean()
        : []
    ]);

    const projectUsersById = new Map();
    [...tenantUsers, ...relatedUsers].forEach(user => projectUsersById.set(String(user._id), user));

    res.json({
      tenantKey: tenantKeys[0],
      tenantKeys,
      projects,
      users: tenantUsers,
      projectUsers: Array.from(projectUsersById.values()),
      logs,
      alerts: milestones,
      metrics: {
        projects: projects.length,
        users: tenantUsers.length,
        documents: documentsCount,
        alerts: milestones.length
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
