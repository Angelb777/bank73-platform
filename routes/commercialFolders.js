const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const CommercialFolder = require('../models/CommercialFolder');
const Unit = require('../models/Unit');
const Project = require('../models/Project');
const ProjectFinance = require('../models/ProjectFinance');
const Document = require('../models/Document');
const FundingInterest = require('../models/FundingInterest');
const { requireProjectAccess } = require('../middleware/rbac');
const audit = require('../utils/audit');
const requirePin = require('../utils/requirePin');
const {
  emptyPhaseForStage,
  removeStageFinancialData,
  reconcileProjectStages,
  syncStageName
} = require('../services/projectStages');

const uploadRoot = path.resolve(__dirname, '..', 'uploads');

function resolveStageDocumentPath(storedPath = '') {
  const candidate = path.resolve(__dirname, '..', String(storedPath || ''));
  const relative = path.relative(uploadRoot, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return candidate;
}

const COMMERCIAL_FOLDER_COLORS = new Set([
  '#111827', '#1e3a8a', '#172554', '#134e4a',
  '#14532d', '#581c87', '#881337', '#7c2d12'
]);

function normalizeCommercialFolderColor(value) {
  const color = String(value || '').trim().toLowerCase();
  return COMMERCIAL_FOLDER_COLORS.has(color) ? color : '#111827';
}

async function attachProjectFromRequest(req, res, next) {
  try {
    const projectId = req.body?.projectId || req.query?.projectId;
    if (!projectId) return res.status(400).json({ error: 'projectId requerido' });

    const project = await Project.findOne({ _id: projectId, tenantKey: req.tenantKey }).lean();
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    req.project = project;
    next();
  } catch {
    res.status(400).json({ error: 'projectId invalido' });
  }
}

async function attachProjectFromFolder(req, res, next) {
  try {
    const folder = await CommercialFolder.findOne({ _id: req.params.id, tenantKey: req.tenantKey }).lean();
    if (!folder) return res.status(404).json({ error: 'Carpeta no encontrada' });

    const project = await Project.findOne({ _id: folder.projectId, tenantKey: req.tenantKey }).lean();
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    req.project = project;
    req.folder = folder;
    next();
  } catch {
    res.status(400).json({ error: 'folderId invalido' });
  }
}

router.get('/', requireProjectAccess(), attachProjectFromRequest, async (req, res) => {
  const { projectId } = req.query;

  // Migracion compatible y perezosa: desde este punto carpeta y fase comparten
  // una unica identidad de etapa.
  await reconcileProjectStages({ projectId, tenantKey: req.tenantKey });

  const filter = { projectId };
  if (req.tenantKey) filter.tenantKey = req.tenantKey;

  const folders = await CommercialFolder.find(filter)
    .sort({ order: 1, createdAt: 1 })
    .lean();

  const projectFilter = { _id: projectId };
  if (req.tenantKey) projectFilter.tenantKey = req.tenantKey;

  const project = await Project.findOne(projectFilter)
    .select('commercialUnassignedName commercialUnassignedColor')
    .lean();

  res.json({
    folders: folders.map(folder => ({ ...folder, color: normalizeCommercialFolderColor(folder.color) })),
    unassigned: {
      name: project?.commercialUnassignedName || 'Sin carpeta',
      color: normalizeCommercialFolderColor(project?.commercialUnassignedColor)
    }
  });
});

router.post('/', attachProjectFromRequest, requireProjectAccess({ promoterCanEditAssigned: true }), async (req, res) => {
  const { projectId, name, color } = req.body;

  if (!projectId || !name) {
    return res.status(400).json({ error: 'projectId y name requeridos' });
  }

  const project = await Project.findOne({ _id: projectId, tenantKey: req.tenantKey }).select('_id').lean();
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

  const count = await CommercialFolder.countDocuments({ tenantKey: req.tenantKey, projectId });

  const folder = await CommercialFolder.create({
    tenantKey: req.tenantKey,
    projectId,
    name: name.trim(),
    color: normalizeCommercialFolderColor(color),
    order: count
  });

  let finance = await ProjectFinance.findOne({ project: projectId, tenantKey: req.tenantKey });
  if (!finance) finance = new ProjectFinance({ project: projectId, tenantKey: req.tenantKey, phases: [] });
  finance.phases.push(emptyPhaseForStage(folder, folder.createdAt || new Date()));
  await finance.save();

  res.json(folder);
});

router.patch('/unassigned/settings', attachProjectFromRequest, requireProjectAccess({ promoterCanEditAssigned: true }), async (req, res) => {
  const { projectId, name, color } = req.body;

  if (!projectId) {
    return res.status(400).json({ error: 'projectId requerido' });
  }

  const update = {};

  if (name != null) {
    update.commercialUnassignedName = String(name || '').trim() || 'Sin carpeta';
  }

  if (color != null) {
    update.commercialUnassignedColor = normalizeCommercialFolderColor(color);
  }

  const filter = { _id: projectId };
  if (req.tenantKey) filter.tenantKey = req.tenantKey;

  const project = await Project.findOneAndUpdate(
    filter,
    { $set: update },
    { new: true }
  ).lean();

  if (!project) {
    return res.status(404).json({ error: 'Proyecto no encontrado' });
  }

  res.json({
    ok: true,
    name: project.commercialUnassignedName || 'Sin carpeta',
    color: normalizeCommercialFolderColor(project.commercialUnassignedColor)
  });
});

router.patch('/:id', attachProjectFromFolder, requireProjectAccess({ promoterCanEditAssigned: true }), async (req, res) => {
  const update = {};

  if (req.body.name != null) {
    update.name = String(req.body.name || '').trim();
  }

  if (req.body.color != null) {
    update.color = normalizeCommercialFolderColor(req.body.color);
  }

  const folder = await CommercialFolder.findOneAndUpdate(
    { _id: req.params.id, tenantKey: req.tenantKey },
    update,
    { new: true }
  );

  if (!folder) return res.status(404).json({ error: 'Carpeta no encontrada' });

  if (update.name) {
    await syncStageName({ stageId: folder._id, tenantKey: req.tenantKey, name: update.name });
  }

  res.json(folder);
});

router.delete('/:id', attachProjectFromFolder, requireProjectAccess({ promoterCanEditAssigned: true }), async (req, res) => {
  const invalidPin = requirePin(req, res);
  if (invalidPin) return;

  const folderId = req.params.id;

  const folder = req.folder || await CommercialFolder.findOne({ _id: folderId, tenantKey: req.tenantKey }).lean();
  if (!folder) return res.status(404).json({ error: 'Carpeta no encontrada' });

  const finance = await ProjectFinance.findOne({ project: folder.projectId, tenantKey: req.tenantKey });
  const cascade = finance
    ? removeStageFinancialData(finance, folderId)
    : {
        removedPhaseIds: [], removedPhaseNames: [], removedRequirementIds: [],
        removedRequestDocumentIds: [], removedPhases: 0, removedLoanLines: 0,
        removedLoanEntries: 0, removedAllocations: 0
      };

  if (finance && cascade.removedPhases) {
    await finance.save();
  }

  if (cascade.removedPhaseIds.length) {
    const interests = await FundingInterest.find({
      project: folder.projectId,
      projectTenantKey: req.tenantKey,
      phaseIds: { $in: cascade.removedPhaseIds }
    });
    for (const interest of interests) {
      const ids = Array.from(interest.phaseIds || []);
      const names = Array.from(interest.phaseNames || []);
      const keepIndexes = ids.map((phaseId, index) => ({ phaseId, index }))
        .filter(item => !cascade.removedPhaseIds.includes(String(item.phaseId)));
      interest.phaseIds = keepIndexes.map(item => item.phaseId);
      interest.phaseNames = keepIndexes.map(item => names[item.index] || '');
      await interest.save();
    }
  }

  const documentFilters = [];
  if (cascade.removedPhaseIds.length) documentFilters.push({ financePhaseId: { $in: cascade.removedPhaseIds } });
  if (cascade.removedRequirementIds.length) documentFilters.push({ requirementId: { $in: cascade.removedRequirementIds } });
  if (cascade.removedRequestDocumentIds.length) documentFilters.push({ _id: { $in: cascade.removedRequestDocumentIds } });
  let removedDocuments = 0;
  if (documentFilters.length) {
    const documents = await Document.find({
      projectId: folder.projectId,
      tenantKey: req.tenantKey,
      $or: documentFilters
    }).lean();
    if (documents.length) {
      await Document.deleteMany({ _id: { $in: documents.map(doc => doc._id) }, tenantKey: req.tenantKey });
      removedDocuments = documents.length;
      for (const doc of documents) {
        const storedFile = resolveStageDocumentPath(doc.path);
        if (storedFile && fs.existsSync(storedFile)) {
          try { fs.unlinkSync(storedFile); } catch {}
        }
      }
    }
  }

  const unitsResult = await Unit.updateMany(
    { tenantKey: req.tenantKey, folderId },
    { $set: { folderId: null, folderOrder: 0 } }
  );

  await CommercialFolder.deleteOne({ _id: folderId, tenantKey: req.tenantKey });

  const summary = {
    phases: cascade.removedPhases,
    loanLines: cascade.removedLoanLines,
    loanEntries: cascade.removedLoanEntries,
    allocations: cascade.removedAllocations,
    documents: removedDocuments,
    unitsUnassigned: unitsResult.modifiedCount ?? unitsResult.nModified ?? 0
  };
  await audit(req, 'project.stage_deleted', {
    targetType: 'commercial_folder',
    targetId: folder._id,
    projectId: folder.projectId,
    message: `Etapa eliminada: ${folder.name}`,
    metadata: summary
  });

  res.json({ ok: true, deletedStage: { id: folderId, name: folder.name }, summary });
});

router.patch('/unassigned/units', attachProjectFromRequest, requireProjectAccess({ promoterCanEditAssigned: true }), async (req, res) => {
  const { unitIds, projectId } = req.body;

  if (!Array.isArray(unitIds) || !unitIds.length) {
    return res.status(400).json({ error: 'unitIds requerido' });
  }

  const filter = {
    _id: { $in: unitIds }
  };

  if (projectId) {
    filter.projectId = projectId;
  }

  if (req.tenantKey) {
    filter.tenantKey = req.tenantKey;
  }

  await Unit.updateMany(
    filter,
    {
      $set: {
        folderId: null,
        folderOrder: 0
      }
    }
  );

  res.json({ ok: true });
});

router.patch('/:id/units', attachProjectFromFolder, requireProjectAccess({ promoterCanEditAssigned: true }), async (req, res) => {
  const { unitIds } = req.body;
  const folderId = req.params.id;

  if (!Array.isArray(unitIds)) {
    return res.status(400).json({ error: 'unitIds debe ser array' });
  }

  const folder = req.folder || await CommercialFolder.findOne({ _id: folderId, tenantKey: req.tenantKey }).lean();
  if (!folder) return res.status(404).json({ error: 'Carpeta no encontrada' });

  await Promise.all(unitIds.map((unitId, index) =>
    Unit.findOneAndUpdate(
      { _id: unitId, tenantKey: req.tenantKey, projectId: folder.projectId },
      { folderId, folderOrder: index }
    )
  ));

  res.json({ ok: true });
});

module.exports = router;
