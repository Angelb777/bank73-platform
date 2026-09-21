const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const PDFDocument = require('pdfkit');

const Project = require('../models/Project');
const ProjectChecklist = require('../models/ProjectChecklist');
const { renderInspectionReport } = require('../services/inspectionReport');
const Unit = require('../models/Unit');
const CommercialFolder = require('../models/CommercialFolder');
const ProjectAvaluatorAssignment = require('../models/ProjectAvaluatorAssignment');
const Inspection = require('../models/Inspection');
const InspectionUnit = require('../models/InspectionUnit');
const InspectionEvidence = require('../models/InspectionEvidence');
const AvaluationTemplate = require('../models/AvaluationTemplate');
const { requireRole } = require('../middleware/rbac');
const { fileFilterFor, handleMulterUpload } = require('../utils/uploadSecurity');

const router = express.Router();
const evidenceUploadDir = path.join(__dirname, '..', 'uploads', 'inspections');
const evidenceUpload = handleMulterUpload(multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: fileFilterFor(new Set(['.jpg', '.jpeg', '.png']))
}).single('photo'));

const PROJECT_LIST_FIELDS = [
  'name',
  'location',
  'address',
  'city',
  'province',
  'coordinates',
  'projectType',
  'coverImage',
  'status'
].join(' ');

const PROJECT_DETAIL_FIELDS = `${PROJECT_LIST_FIELDS} description`;
const UNIT_FIELDS = [
  'code',
  'manzana',
  'lote',
  'modelo',
  'ubicacion',
  'm2',
  'areaAbierta',
  'areaCerrada',
  'areaTotalConstruccion',
  'estado',
  'folderId'
].join(' ');
const DEFAULT_COMMON_AREAS = [
  { key: 'urbanizacion', name: 'Urbanización y viales', weight: 20, progressPercent: 0, observations: '' },
  { key: 'infraestructura', name: 'Infraestructura y redes', weight: 25, progressPercent: 0, observations: '' },
  { key: 'zonas_comunes', name: 'Zonas comunes y amenidades', weight: 25, progressPercent: 0, observations: '' },
  { key: 'exteriores', name: 'Exteriores y paisajismo', weight: 15, progressPercent: 0, observations: '' },
  { key: 'seguridad', name: 'Seguridad y accesibilidad', weight: 15, progressPercent: 0, observations: '' }
];

function commonAreasForInspection(inspection) {
  const areas = Array.isArray(inspection?.commonAreas) ? inspection.commonAreas : [];
  return areas.length ? areas : DEFAULT_COMMON_AREAS;
}

function activeAvaluatorContext(req) {
  const userId = req.user?.userId || req.user?._id;
  const sourceTenants = Array.isArray(req.user?.avaluatorBankTenantKeys)
    ? req.user.avaluatorBankTenantKeys
    : (Array.isArray(req.user?.tenantKeys) ? req.user.tenantKeys : []);
  const bankTenantKeys = sourceTenants
    .map(value => String(value || '').trim())
    .filter(Boolean);

  if (!userId || !bankTenantKeys.length) return null;
  return { userId, bankTenantKeys: Array.from(new Set(bankTenantKeys)) };
}

function coverImageDto(coverImage) {
  const source = String(coverImage?.path || '').trim();
  if (!source) return null;
  return {
    source,
    mimetype: String(coverImage?.mimetype || '').trim()
  };
}

function locationDto(project) {
  const coordinate = value => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  return {
    label: String(project?.location || '').trim(),
    address: String(project?.address || '').trim(),
    city: String(project?.city || '').trim(),
    province: String(project?.province || '').trim(),
    coordinates: {
      lat: coordinate(project?.coordinates?.lat),
      lng: coordinate(project?.coordinates?.lng)
    }
  };
}

function projectListDto(project) {
  return {
    id: String(project._id),
    name: String(project.name || '').trim(),
    coverImage: coverImageDto(project.coverImage),
    location: locationDto(project),
    projectType: String(project.projectType || '').trim(),
    status: String(project.status || '').trim()
  };
}

function promoterProgress(checklists) {
  if (!checklists.length) return 0;
  return Math.round(checklists.reduce((sum, item) => {
    const subtasks = item.subtasks || [];
    return sum + (subtasks.length
      ? Math.round(subtasks.filter(sub => !!sub.completed).length / subtasks.length * 100)
      : item.status === 'COMPLETADO' ? 100 : item.status === 'EN_PROCESO' ? 50 : 0);
  }, 0) / checklists.length);
}

function projectDetailDto(project) {
  return {
    ...projectListDto(project),
    description: String(project.description || '').trim()
  };
}

function unitDto(unit) {
  return {
    id: String(unit._id),
    code: String(unit.code || [unit.manzana, unit.lote].filter(Boolean).join('-')).trim(),
    manzana: String(unit.manzana || '').trim(),
    lote: String(unit.lote || '').trim(),
    modelo: String(unit.modelo || '').trim(),
    ubicacion: String(unit.ubicacion || '').trim(),
    surfaces: {
      m2: Number(unit.m2 || 0),
      openM2: Number(unit.areaAbierta || 0),
      closedM2: Number(unit.areaCerrada || 0),
      totalConstructionM2: Number(unit.areaTotalConstruccion || 0)
    },
    status: String(unit.estado || '').trim(),
    folderId: unit.folderId ? String(unit.folderId) : null
  };
}

// Datos minimos de la carpeta comercial (Torre/Etapa) para agrupar la lista
// de unidades en la app. No es una entidad nueva: reutiliza CommercialFolder
// tal cual la usa el modulo comercial.
function folderDto(folder) {
  return {
    id: String(folder._id),
    name: String(folder.name || '').trim(),
    color: String(folder.color || '#0f172a').trim(),
    order: Number(folder.order || 0)
  };
}

function inspectionDto(inspection) {
  return {
    id: String(inspection._id),
    projectId: String(inspection.projectId),
    status: String(inspection.status || ''),
    inspectionDate: inspection.inspectionDate,
    startedAt: inspection.startedAt,
    generalObservations: String(inspection.generalObservations || ''),
    projectProgressPercent: Number(inspection.projectProgressPercent || 0),
    commonAreas: commonAreasForInspection(inspection).map(area => ({
      key: String(area.key || ''),
      name: String(area.name || ''),
      weight: Number(area.weight || 0),
      progressPercent: Number(area.progressPercent || 0),
      observations: String(area.observations || '')
    })),
    methodology: inspection.methodology ? {
      id: String(inspection.methodology.templateId),
      name: String(inspection.methodology.name || ''),
      version: Number(inspection.methodology.version),
      sections: (inspection.methodology.sections || [])
        .map(section => ({
          key: String(section.key || ''),
          name: String(section.name || ''),
          weight: Number(section.weight),
          order: Number(section.order)
        }))
        .sort((a, b) => a.order - b.order)
    } : null,
    version: Number(inspection.version || 0),
    signature: inspection.signature ? {
      signerName: String(inspection.signature.signerName || ''),
      signedAt: inspection.signature.signedAt
    } : null,
    finalizedAt: inspection.finalizedAt || null,
    reportNumber: String(inspection.reportNumber || ''),
    technicalRecommendation: inspection.technicalRecommendation || null,
    createdAt: inspection.createdAt,
    updatedAt: inspection.updatedAt
  };
}

function evidenceDto(item) {
  return {
    id: String(item._id),
    inspectionId: String(item.inspectionId),
    projectId: String(item.projectId),
    unitId: item.unitId ? String(item.unitId) : null,
    commonAreaKey: String(item.commonAreaKey || ''),
    caption: String(item.caption || ''),
    mimetype: String(item.mimetype || ''),
    size: Number(item.size || 0),
    createdAt: item.createdAt,
    filePath: `/api/mobile/v1/inspections/${item.inspectionId}/evidence/${item._id}/file`
  };
}

function inspectionUnitDto(item) {
  return {
    id: String(item._id),
    inspectionId: String(item.inspectionId),
    projectId: String(item.projectId),
    unitId: String(item.unitId),
    unitReferenceSnapshot: {
      code: String(item.unitReferenceSnapshot?.code || ''),
      manzana: String(item.unitReferenceSnapshot?.manzana || ''),
      lote: String(item.unitReferenceSnapshot?.lote || ''),
      modelo: String(item.unitReferenceSnapshot?.modelo || '')
    },
    progressPercent: Number(item.progressPercent),
    progressSections: Array.isArray(item.progressSections)
      ? item.progressSections
          .map(section => ({
            key: String(section.key || ''),
            name: String(section.name || ''),
            weight: Number(section.weight),
            order: Number(section.order),
            progressPercent: Number(section.progressPercent)
          }))
          .sort((a, b) => a.order - b.order)
      : null,
    observations: String(item.observations || ''),
    inspectedAt: item.inspectedAt,
    version: Number(item.version || 0),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

function parseDate(value) {
  if (value === undefined) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseExpectedVersion(value) {
  if (value === undefined || value === null || value === '') return null;
  const version = Number(value);
  return Number.isInteger(version) && version >= 0 ? version : null;
}

function unexpectedFields(body, allowed) {
  const allowedSet = new Set(allowed);
  return Object.keys(body || {}).filter(key => !allowedSet.has(key));
}

function methodologySnapshot(template) {
  if (!template) return undefined;
  return {
    templateId: template._id,
    name: String(template.name || ''),
    version: Number(template.version),
    sections: (template.sections || [])
      .map(section => ({
        key: String(section.key || ''),
        name: String(section.name || ''),
        weight: Number(section.weight),
        order: Number(section.order)
      }))
      .sort((a, b) => a.order - b.order)
  };
}

function structuredProgress(methodology, submitted, previous = []) {
  if (!Array.isArray(submitted) || !submitted.length) {
    return { error: 'progressSections debe contener al menos una seccion.' };
  }
  const templateSections = Array.isArray(methodology?.sections) ? methodology.sections : [];
  const allowedByKey = new Map(templateSections.map(section => [String(section.key), section]));
  const submittedByKey = new Map();

  for (const raw of submitted) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { error: 'progressSections invalido.' };
    }
    if (Object.keys(raw).some(key => !['key', 'progressPercent'].includes(key))) {
      return { error: 'El cliente solo puede enviar key y progressPercent.' };
    }
    const key = String(raw.key || '').trim();
    const progressPercent = raw.progressPercent === null || raw.progressPercent === ''
      ? NaN
      : Number(raw.progressPercent);
    if (!allowedByKey.has(key)) return { error: 'Seccion no permitida.' };
    if (submittedByKey.has(key)) return { error: 'No se permiten secciones duplicadas.' };
    if (!Number.isFinite(progressPercent) || progressPercent < 0 || progressPercent > 100) {
      return { error: 'El avance de cada seccion debe estar entre 0 y 100.' };
    }
    submittedByKey.set(key, progressPercent);
  }

  const previousByKey = new Map((previous || []).map(section => [
    String(section.key),
    Number(section.progressPercent)
  ]));
  const progressSections = templateSections
    .map(section => ({
      key: String(section.key),
      name: String(section.name || ''),
      weight: Number(section.weight),
      order: Number(section.order),
      progressPercent: submittedByKey.has(String(section.key))
        ? submittedByKey.get(String(section.key))
        : (previousByKey.get(String(section.key)) || 0)
    }))
    .sort((a, b) => a.order - b.order);
  const weighted = progressSections.reduce(
    (sum, section) => sum + (section.weight * section.progressPercent),
    0
  ) / 100;
  const progressPercent = Math.min(100, Math.max(0, Math.round(weighted * 10000) / 10000));
  return { progressSections, progressPercent };
}

async function activeAssignmentFor(req, projectId) {
  const context = activeAvaluatorContext(req);
  if (!context || !mongoose.Types.ObjectId.isValid(String(projectId || ''))) return null;

  return ProjectAvaluatorAssignment.findOne({
    bankTenantKey: { $in: context.bankTenantKeys },
    projectId,
    avaluadorId: context.userId,
    status: 'active'
  }).lean();
}

async function assignedProjectFor(req, projectId, fields = PROJECT_DETAIL_FIELDS) {
  const assignment = await activeAssignmentFor(req, projectId);
  if (!assignment) return null;

  const project = await Project.findOne({
    _id: assignment.projectId,
    tenantKey: assignment.projectTenantKey
  }).select(fields).lean();

  return project ? { assignment, project } : null;
}

async function authorizedInspectionFor(req, inspectionId) {
  const context = activeAvaluatorContext(req);
  if (!context || !mongoose.Types.ObjectId.isValid(String(inspectionId || ''))) return null;

  const inspection = await Inspection.findOne({
    _id: inspectionId,
    deletedAt: null,
    bankTenantKey: { $in: context.bankTenantKeys },
    avaluadorId: context.userId
  }).lean();
  if (!inspection) return null;

  const assignment = await ProjectAvaluatorAssignment.findOne({
    _id: inspection.assignmentId,
    bankTenantKey: inspection.bankTenantKey,
    projectTenantKey: inspection.projectTenantKey,
    projectId: inspection.projectId,
    avaluadorId: context.userId,
    status: 'active'
  }).lean();
  if (!assignment) return null;

  const project = await Project.findOne({
    _id: inspection.projectId,
    tenantKey: inspection.projectTenantKey
  }).select('_id').lean();
  if (!project) return null;

  return { context, assignment, inspection, project };
}

router.use(requireRole('avaluador'));

router.get('/projects', async (req, res) => {
  try {
    const context = activeAvaluatorContext(req);
    if (!context) return res.status(404).json({ error: 'Proyectos no encontrados.' });

    const assignments = await ProjectAvaluatorAssignment.find({
      bankTenantKey: { $in: context.bankTenantKeys },
      avaluadorId: context.userId,
      status: 'active'
    }).sort({ assignedAt: -1 }).lean();

    if (!assignments.length) return res.json({ projects: [] });

    const projectScopes = assignments.map(assignment => ({
      _id: assignment.projectId,
      tenantKey: assignment.projectTenantKey
    }));
    const projects = await Project.find({ $or: projectScopes })
      .select(PROJECT_LIST_FIELDS)
      .lean();
    const byId = new Map(projects.map(project => [String(project._id), project]));

    res.json({
      projects: assignments
        .map(assignment => byId.get(String(assignment.projectId)))
        .filter(Boolean)
        .map(projectListDto)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/projects/:projectId', async (req, res) => {
  try {
    const resolved = await assignedProjectFor(req, req.params.projectId);
    if (!resolved) return res.status(404).json({ error: 'Proyecto no encontrado.' });
    const checklists = await ProjectChecklist.find({
      projectId: resolved.assignment.projectId,
      $or: [{ tenantKey: resolved.assignment.projectTenantKey }, { tenantKey: { $exists: false } }]
    }).select('status subtasks.completed').lean();
    res.json({ project: { ...projectDetailDto(resolved.project), promoterProgressPercent: promoterProgress(checklists) } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/projects/:projectId/units', async (req, res) => {
  try {
    const resolved = await assignedProjectFor(req, req.params.projectId, '_id');
    if (!resolved) return res.status(404).json({ error: 'Proyecto no encontrado.' });

    const units = await Unit.find({
      tenantKey: resolved.assignment.projectTenantKey,
      projectId: resolved.assignment.projectId,
      deletedAt: null
    }).select(UNIT_FIELDS).sort({ manzana: 1, lote: 1 }).lean();

    res.json({ units: units.map(unitDto) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Datos minimos para agrupar la lista de unidades por Torre/Etapa en la app.
// Puramente de lectura: no crea ni referencia ninguna entidad nueva.
router.get('/projects/:projectId/commercial-folders', async (req, res) => {
  try {
    const resolved = await assignedProjectFor(req, req.params.projectId, '_id');
    if (!resolved) return res.status(404).json({ error: 'Proyecto no encontrado.' });

    const folders = await CommercialFolder.find({
      tenantKey: resolved.assignment.projectTenantKey,
      projectId: resolved.assignment.projectId
    }).select('name color order').sort({ order: 1, createdAt: 1 }).lean();

    res.json({ folders: folders.map(folderDto) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/projects/:projectId/units/:unitId', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.unitId || ''))) {
      return res.status(404).json({ error: 'Unidad no encontrada.' });
    }

    const resolved = await assignedProjectFor(req, req.params.projectId, '_id');
    if (!resolved) return res.status(404).json({ error: 'Proyecto no encontrado.' });

    const unit = await Unit.findOne({
      _id: req.params.unitId,
      tenantKey: resolved.assignment.projectTenantKey,
      projectId: resolved.assignment.projectId,
      deletedAt: null
    }).select(UNIT_FIELDS).lean();
    if (!unit) return res.status(404).json({ error: 'Unidad no encontrada.' });

    res.json({ unit: unitDto(unit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/projects/:projectId/inspections', async (req, res) => {
  try {
    const extraFields = unexpectedFields(req.body, ['inspectionDate', 'generalObservations']);
    if (extraFields.length) {
      return res.status(400).json({ error: 'Campos no permitidos.', fields: extraFields });
    }

    const resolved = await assignedProjectFor(req, req.params.projectId, '_id');
    if (!resolved) return res.status(404).json({ error: 'Proyecto no encontrado.' });

    const inspectionDate = parseDate(req.body?.inspectionDate);
    if (inspectionDate === null) return res.status(400).json({ error: 'inspectionDate invalida.' });
    const generalObservations = String(req.body?.generalObservations || '').trim();
    if (generalObservations.length > 10000) {
      return res.status(400).json({ error: 'generalObservations demasiado larga.' });
    }

    const template = await AvaluationTemplate.findOne({
      bankTenantKey: resolved.assignment.bankTenantKey,
      status: 'active'
    }).lean();
    const inspection = await Inspection.create({
      bankTenantKey: resolved.assignment.bankTenantKey,
      projectTenantKey: resolved.assignment.projectTenantKey,
      projectId: resolved.assignment.projectId,
      avaluadorId: resolved.assignment.avaluadorId,
      assignmentId: resolved.assignment._id,
      status: 'draft',
      inspectionDate: inspectionDate || new Date(),
      startedAt: new Date(),
      generalObservations,
      methodology: methodologySnapshot(template),
      version: 0
    });

    res.status(201).json({ inspection: inspectionDto(inspection) });
  } catch (e) {
    res.status(e?.name === 'ValidationError' ? 400 : 500).json({ error: e.message });
  }
});

router.get('/projects/:projectId/inspections', async (req, res) => {
  try {
    const resolved = await assignedProjectFor(req, req.params.projectId, '_id');
    if (!resolved) return res.status(404).json({ error: 'Proyecto no encontrado.' });

    const inspections = await Inspection.find({
      bankTenantKey: resolved.assignment.bankTenantKey,
      projectTenantKey: resolved.assignment.projectTenantKey,
      projectId: resolved.assignment.projectId,
      avaluadorId: resolved.assignment.avaluadorId,
      assignmentId: resolved.assignment._id,
      deletedAt: null
    }).sort({ inspectionDate: -1, createdAt: -1 }).lean();

    res.json({ inspections: inspections.map(inspectionDto) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/inspections/:inspectionId', async (req, res) => {
  try {
    const resolved = await authorizedInspectionFor(req, req.params.inspectionId);
    if (!resolved) return res.status(404).json({ error: 'Inspeccion no encontrada.' });
    if (resolved.inspection.status !== 'draft') return res.status(409).json({ error: 'Los informes finalizados no se pueden eliminar.' });
    const version = Number(req.query.version);
    if (!Number.isInteger(version) || version < 0) return res.status(400).json({ error: 'Version de borrador invalida.' });
    const deleted = await Inspection.findOneAndUpdate({
      _id: resolved.inspection._id,
      avaluadorId: resolved.inspection.avaluadorId,
      status: 'draft', deletedAt: null, version
    }, { $set: { deletedAt: new Date() }, $inc: { version: 1 } }, { new: true }).lean();
    if (!deleted) return res.status(409).json({ error: 'version_conflict' });
    res.json({ deleted: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/inspections/:inspectionId', async (req, res) => {
  try {
    const resolved = await authorizedInspectionFor(req, req.params.inspectionId);
    if (!resolved) return res.status(404).json({ error: 'Inspeccion no encontrada.' });
    res.json({ inspection: inspectionDto(resolved.inspection) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/inspections/:inspectionId', async (req, res) => {
  try {
    const extraFields = unexpectedFields(req.body, ['inspectionDate', 'generalObservations', 'version']);
    if (extraFields.length) {
      return res.status(400).json({ error: 'Campos no permitidos.', fields: extraFields });
    }
    const expectedVersion = parseExpectedVersion(req.body?.version);
    if (expectedVersion === null) return res.status(400).json({ error: 'version requerida.' });

    const resolved = await authorizedInspectionFor(req, req.params.inspectionId);
    if (!resolved) return res.status(404).json({ error: 'Inspeccion no encontrada.' });
    if (resolved.inspection.status !== 'draft') {
      return res.status(409).json({ error: 'La inspeccion no es editable.' });
    }

    const set = {};
    if (req.body?.inspectionDate !== undefined) {
      const inspectionDate = parseDate(req.body.inspectionDate);
      if (!inspectionDate) return res.status(400).json({ error: 'inspectionDate invalida.' });
      set.inspectionDate = inspectionDate;
    }
    if (req.body?.generalObservations !== undefined) {
      const value = String(req.body.generalObservations || '').trim();
      if (value.length > 10000) return res.status(400).json({ error: 'generalObservations demasiado larga.' });
      set.generalObservations = value;
    }
    if (!Object.keys(set).length) return res.status(400).json({ error: 'No hay campos editables.' });

    const inspection = await Inspection.findOneAndUpdate(
      {
        _id: resolved.inspection._id,
        bankTenantKey: resolved.inspection.bankTenantKey,
        projectTenantKey: resolved.inspection.projectTenantKey,
        projectId: resolved.inspection.projectId,
        avaluadorId: resolved.context.userId,
        assignmentId: resolved.assignment._id,
        status: 'draft',
        deletedAt: null,
        version: expectedVersion
      },
      { $set: set, $inc: { version: 1 } },
      { new: true, runValidators: true }
    ).lean();
    if (!inspection) return res.status(409).json({ error: 'version_conflict' });

    res.json({ inspection: inspectionDto(inspection) });
  } catch (e) {
    res.status(e?.name === 'ValidationError' ? 400 : 500).json({ error: e.message });
  }
});

router.put('/inspections/:inspectionId/project-progress', async (req, res) => {
  try {
    const extraFields = unexpectedFields(req.body, ['projectProgressPercent', 'commonAreas', 'version']);
    if (extraFields.length) {
      return res.status(400).json({ error: 'Campos no permitidos.', fields: extraFields });
    }
    const expectedVersion = parseExpectedVersion(req.body?.version);
    if (expectedVersion === null) return res.status(400).json({ error: 'version requerida.' });
    const projectProgressPercent = Number(req.body?.projectProgressPercent);
    if (!Number.isFinite(projectProgressPercent) || projectProgressPercent < 0 || projectProgressPercent > 100) {
      return res.status(400).json({ error: 'projectProgressPercent debe estar entre 0 y 100.' });
    }

    const resolved = await authorizedInspectionFor(req, req.params.inspectionId);
    if (!resolved) return res.status(404).json({ error: 'Inspeccion no encontrada.' });
    if (resolved.inspection.status !== 'draft') {
      return res.status(409).json({ error: 'La inspeccion no es editable.' });
    }

    const incoming = Array.isArray(req.body?.commonAreas) ? req.body.commonAreas : [];
    const currentByKey = new Map(commonAreasForInspection(resolved.inspection).map(area => [String(area.key), area]));
    if (incoming.length !== currentByKey.size || incoming.some(area => !currentByKey.has(String(area?.key || '')))) {
      return res.status(400).json({ error: 'commonAreas no coincide con las zonas de la inspeccion.' });
    }
    const commonAreas = incoming.map(area => {
      const current = currentByKey.get(String(area.key));
      const progressPercent = Number(area.progressPercent);
      const observations = String(area.observations || '').trim();
      if (!Number.isFinite(progressPercent) || progressPercent < 0 || progressPercent > 100) {
        throw Object.assign(new Error('El avance de cada zona debe estar entre 0 y 100.'), { status: 400 });
      }
      if (observations.length > 5000) {
        throw Object.assign(new Error('Las observaciones de una zona son demasiado largas.'), { status: 400 });
      }
      return {
        key: String(current.key),
        name: String(current.name),
        weight: Number(current.weight),
        progressPercent,
        observations
      };
    });

    const inspection = await Inspection.findOneAndUpdate(
      {
        _id: resolved.inspection._id,
        bankTenantKey: resolved.inspection.bankTenantKey,
        avaluadorId: resolved.context.userId,
        status: 'draft',
        deletedAt: null,
        version: expectedVersion
      },
      {
        $set: { projectProgressPercent, commonAreas },
        $inc: { version: 1 }
      },
      { new: true, runValidators: true }
    ).lean();
    if (!inspection) return res.status(409).json({ error: 'version_conflict' });
    res.json({ inspection: inspectionDto(inspection) });
  } catch (e) {
    res.status(e?.status || (e?.name === 'ValidationError' ? 400 : 500)).json({ error: e.message });
  }
});

router.put('/inspections/:inspectionId/units/:unitId', async (req, res) => {
  try {
    const extraFields = unexpectedFields(req.body, ['progressPercent', 'progressSections', 'observations', 'version']);
    if (extraFields.length) {
      return res.status(400).json({ error: 'Campos no permitidos.', fields: extraFields });
    }
    const observations = String(req.body?.observations || '').trim();
    if (observations.length > 10000) return res.status(400).json({ error: 'observations demasiado larga.' });
    if (!mongoose.Types.ObjectId.isValid(String(req.params.unitId || ''))) {
      return res.status(404).json({ error: 'Unidad no encontrada.' });
    }

    const resolved = await authorizedInspectionFor(req, req.params.inspectionId);
    if (!resolved) return res.status(404).json({ error: 'Inspeccion no encontrada.' });
    if (resolved.inspection.status !== 'draft') {
      return res.status(409).json({ error: 'La inspeccion no es editable.' });
    }

    const unit = await Unit.findOne({
      _id: req.params.unitId,
      tenantKey: resolved.inspection.projectTenantKey,
      projectId: resolved.inspection.projectId,
      deletedAt: null
    }).select('code manzana lote modelo').lean();
    if (!unit) return res.status(404).json({ error: 'Unidad no encontrada.' });

    const identity = {
      bankTenantKey: resolved.inspection.bankTenantKey,
      projectTenantKey: resolved.inspection.projectTenantKey,
      inspectionId: resolved.inspection._id,
      projectId: resolved.inspection.projectId,
      unitId: unit._id
    };
    const existing = await InspectionUnit.findOne(identity).lean();
    let progressPercent;
    let progressSections;
    if (resolved.inspection.methodology) {
      if (req.body?.progressPercent !== undefined) {
        return res.status(400).json({ error: 'progressPercent se calcula en el servidor.' });
      }
      const calculated = structuredProgress(
        resolved.inspection.methodology,
        req.body?.progressSections,
        existing?.progressSections
      );
      if (calculated.error) return res.status(400).json({ error: calculated.error });
      progressPercent = calculated.progressPercent;
      progressSections = calculated.progressSections;
    } else {
      if (req.body?.progressSections !== undefined) {
        return res.status(400).json({ error: 'La inspeccion no utiliza una metodologia estructurada.' });
      }
      const progressRaw = req.body?.progressPercent;
      progressPercent = progressRaw === undefined || progressRaw === null || progressRaw === ''
        ? NaN
        : Number(progressRaw);
      if (!Number.isFinite(progressPercent) || progressPercent < 0 || progressPercent > 100) {
        return res.status(400).json({ error: 'progressPercent debe estar entre 0 y 100.' });
      }
    }
    const now = new Date();
    let inspectionUnit;

    if (existing) {
      const expectedVersion = parseExpectedVersion(req.body?.version);
      if (expectedVersion === null) return res.status(400).json({ error: 'version requerida.' });
      inspectionUnit = await InspectionUnit.findOneAndUpdate(
        { ...identity, version: expectedVersion },
        {
          $set: {
            progressPercent,
            ...(progressSections ? { progressSections } : {}),
            observations,
            inspectedAt: now,
            updatedBy: resolved.context.userId
          },
          $inc: { version: 1 }
        },
        { new: true, runValidators: true }
      ).lean();
      if (!inspectionUnit) return res.status(409).json({ error: 'version_conflict' });
    } else {
      const initialVersion = req.body?.version === undefined ? 0 : parseExpectedVersion(req.body.version);
      if (initialVersion !== 0) return res.status(409).json({ error: 'version_conflict' });
      inspectionUnit = await InspectionUnit.create({
        ...identity,
        unitReferenceSnapshot: {
          code: String(unit.code || [unit.manzana, unit.lote].filter(Boolean).join('-')).trim(),
          manzana: String(unit.manzana || '').trim(),
          lote: String(unit.lote || '').trim(),
          modelo: String(unit.modelo || '').trim()
        },
        progressPercent,
        progressSections,
        observations,
        inspectedAt: now,
        updatedBy: resolved.context.userId,
        version: 0
      });
    }

    res.status(existing ? 200 : 201).json({ inspectionUnit: inspectionUnitDto(inspectionUnit) });
  } catch (e) {
    if (e?.code === 11000) return res.status(409).json({ error: 'version_conflict' });
    res.status(e?.name === 'ValidationError' ? 400 : 500).json({ error: e.message });
  }
});

router.get('/inspections/:inspectionId/units', async (req, res) => {
  try {
    const resolved = await authorizedInspectionFor(req, req.params.inspectionId);
    if (!resolved) return res.status(404).json({ error: 'Inspeccion no encontrada.' });

    const units = await InspectionUnit.find({
      bankTenantKey: resolved.inspection.bankTenantKey,
      projectTenantKey: resolved.inspection.projectTenantKey,
      inspectionId: resolved.inspection._id,
      projectId: resolved.inspection.projectId
    }).sort({ createdAt: 1 }).lean();
    res.json({ units: units.map(inspectionUnitDto) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/inspections/:inspectionId/units/:unitId', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.unitId || ''))) {
      return res.status(404).json({ error: 'Avance no encontrado.' });
    }
    const resolved = await authorizedInspectionFor(req, req.params.inspectionId);
    if (!resolved) return res.status(404).json({ error: 'Inspeccion no encontrada.' });

    const item = await InspectionUnit.findOne({
      bankTenantKey: resolved.inspection.bankTenantKey,
      projectTenantKey: resolved.inspection.projectTenantKey,
      inspectionId: resolved.inspection._id,
      projectId: resolved.inspection.projectId,
      unitId: req.params.unitId
    }).lean();
    if (!item) return res.status(404).json({ error: 'Avance no encontrado.' });
    res.json({ inspectionUnit: inspectionUnitDto(item) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/inspections/:inspectionId/evidence', async (req, res) => {
  try {
    const resolved = await authorizedInspectionFor(req, req.params.inspectionId);
    if (!resolved) return res.status(404).json({ error: 'Inspeccion no encontrada.' });
    const query = {
      bankTenantKey: resolved.inspection.bankTenantKey,
      projectTenantKey: resolved.inspection.projectTenantKey,
      inspectionId: resolved.inspection._id,
      projectId: resolved.inspection.projectId
    };
    if (req.query.unitId) {
      if (!mongoose.Types.ObjectId.isValid(String(req.query.unitId))) {
        return res.status(400).json({ error: 'unitId invalido.' });
      }
      query.unitId = req.query.unitId;
    }
    if (req.query.commonAreaKey) query.commonAreaKey = String(req.query.commonAreaKey).trim();
    const evidence = await InspectionEvidence.find(query).sort({ createdAt: 1 }).lean();
    res.json({ evidence: evidence.map(evidenceDto) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/inspections/:inspectionId/evidence', evidenceUpload, async (req, res) => {
  let storedPath = null;
  try {
    if (!req.file) return res.status(400).json({ error: 'photo requerida.' });
    const resolved = await authorizedInspectionFor(req, req.params.inspectionId);
    if (!resolved) return res.status(404).json({ error: 'Inspeccion no encontrada.' });
    if (resolved.inspection.status !== 'draft') {
      return res.status(409).json({ error: 'La inspeccion no es editable.' });
    }

    const unitId = String(req.body?.unitId || '').trim();
    const commonAreaKey = String(req.body?.commonAreaKey || '').trim();
    if (unitId && commonAreaKey) {
      return res.status(400).json({ error: 'La evidencia debe pertenecer a una unidad o a una zona, no a ambas.' });
    }
    if (unitId) {
      if (!mongoose.Types.ObjectId.isValid(unitId)) return res.status(400).json({ error: 'unitId invalido.' });
      const unit = await Unit.exists({
        _id: unitId,
        tenantKey: resolved.inspection.projectTenantKey,
        projectId: resolved.inspection.projectId,
        deletedAt: null
      });
      if (!unit) return res.status(404).json({ error: 'Unidad no encontrada.' });
    }
    if (commonAreaKey && !commonAreasForInspection(resolved.inspection).some(area => String(area.key) === commonAreaKey)) {
      return res.status(400).json({ error: 'Zona comun invalida.' });
    }
    const caption = String(req.body?.caption || '').trim();
    if (caption.length > 1000) return res.status(400).json({ error: 'caption demasiado largo.' });

    const extension = path.extname(req.file.originalname).toLowerCase();
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`;
    storedPath = path.join(evidenceUploadDir, filename);
    await fs.promises.mkdir(evidenceUploadDir, { recursive: true });
    await fs.promises.writeFile(storedPath, req.file.buffer, { flag: 'wx' });
    const item = await InspectionEvidence.create({
      bankTenantKey: resolved.inspection.bankTenantKey,
      projectTenantKey: resolved.inspection.projectTenantKey,
      inspectionId: resolved.inspection._id,
      projectId: resolved.inspection.projectId,
      unitId: unitId || null,
      commonAreaKey,
      caption,
      originalname: req.file.originalname,
      filename,
      path: `uploads/inspections/${filename}`,
      mimetype: req.file.mimetype,
      size: req.file.size,
      uploadedBy: resolved.context.userId
    });
    res.status(201).json({ evidence: evidenceDto(item) });
  } catch (e) {
    if (storedPath) await fs.promises.unlink(storedPath).catch(() => {});
    res.status(e?.name === 'ValidationError' ? 400 : 500).json({ error: e.message });
  }
});

router.get('/inspections/:inspectionId/evidence/:evidenceId/file', async (req, res) => {
  try {
    const resolved = await authorizedInspectionFor(req, req.params.inspectionId);
    if (!resolved || !mongoose.Types.ObjectId.isValid(String(req.params.evidenceId || ''))) {
      return res.status(404).json({ error: 'Evidencia no encontrada.' });
    }
    const item = await InspectionEvidence.findOne({
      _id: req.params.evidenceId,
      inspectionId: resolved.inspection._id,
      bankTenantKey: resolved.inspection.bankTenantKey,
      projectTenantKey: resolved.inspection.projectTenantKey
    }).lean();
    if (!item) return res.status(404).json({ error: 'Evidencia no encontrada.' });
    const absolutePath = path.resolve(__dirname, '..', item.path);
    const relative = path.relative(evidenceUploadDir, absolutePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return res.status(404).json({ error: 'Evidencia no encontrada.' });
    }
    await fs.promises.access(absolutePath, fs.constants.R_OK);
    res.type(item.mimetype);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(absolutePath);
  } catch (e) {
    res.status(e?.code === 'ENOENT' ? 404 : 500).json({ error: e?.code === 'ENOENT' ? 'Evidencia no encontrada.' : e.message });
  }
});

router.delete('/inspections/:inspectionId/evidence/:evidenceId', async (req, res) => {
  try {
    const resolved = await authorizedInspectionFor(req, req.params.inspectionId);
    if (!resolved || !mongoose.Types.ObjectId.isValid(String(req.params.evidenceId || ''))) {
      return res.status(404).json({ error: 'Evidencia no encontrada.' });
    }
    if (resolved.inspection.status !== 'draft') {
      return res.status(409).json({ error: 'La inspeccion no es editable.' });
    }
    const item = await InspectionEvidence.findOneAndDelete({
      _id: req.params.evidenceId,
      inspectionId: resolved.inspection._id,
      bankTenantKey: resolved.inspection.bankTenantKey,
      projectTenantKey: resolved.inspection.projectTenantKey
    }).lean();
    if (!item) return res.status(404).json({ error: 'Evidencia no encontrada.' });
    const absolutePath = path.resolve(__dirname, '..', item.path);
    const relative = path.relative(evidenceUploadDir, absolutePath);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      await fs.promises.unlink(absolutePath).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/inspections/:inspectionId/finalize', async (req, res) => {
  try {
    const extraFields = unexpectedFields(req.body, ['version', 'signerName', 'signatureImage', 'technicalRecommendation']);
    if (extraFields.length) return res.status(400).json({ error: 'Campos no permitidos.', fields: extraFields });
    const expectedVersion = parseExpectedVersion(req.body?.version);
    if (expectedVersion === null) return res.status(400).json({ error: 'version requerida.' });
    const signerName = String(req.body?.signerName || '').trim();
    const signatureImage = String(req.body?.signatureImage || '').trim();
    if (!signerName || signerName.length > 200) return res.status(400).json({ error: 'signerName invalido.' });
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signatureImage) || signatureImage.length > 1000000) {
      return res.status(400).json({ error: 'signatureImage invalida.' });
    }

    const rawRecommendation = req.body?.technicalRecommendation;
    if (rawRecommendation !== undefined && (!rawRecommendation || typeof rawRecommendation !== 'object' || Array.isArray(rawRecommendation) || unexpectedFields(rawRecommendation, ['verdict', 'notes']).length)) {
      return res.status(400).json({ error: 'Recomendacion tecnica invalida.' });
    }
    const verdict = rawRecommendation?.verdict ?? 'not_assessed';
    const notes = rawRecommendation?.notes ?? '';
    if (!['favorable', 'conditional', 'unfavorable', 'not_assessed'].includes(verdict) || typeof notes !== 'string' || notes.trim().length > 5000) {
      return res.status(400).json({ error: 'Recomendacion tecnica invalida.' });
    }
    if (verdict !== 'not_assessed' && !notes.trim()) return res.status(400).json({ error: 'Justifica la recomendacion tecnica e indica las condiciones, si las hay.' });
    const technicalRecommendation = { verdict, notes: notes.trim() };

    const resolved = await authorizedInspectionFor(req, req.params.inspectionId);
    if (!resolved) return res.status(404).json({ error: 'Inspeccion no encontrada.' });
    if (resolved.inspection.status !== 'draft') {
      return res.status(409).json({ error: 'La inspeccion ya fue finalizada.' });
    }
    const unitCount = await InspectionUnit.countDocuments({ inspectionId: resolved.inspection._id });
    if (!unitCount && !Number(resolved.inspection.projectProgressPercent)) {
      return res.status(400).json({ error: 'Registra el avance general o al menos una unidad antes de finalizar.' });
    }
    const finalizedAt = new Date();
    const reportNumber = `B73-${finalizedAt.getUTCFullYear()}-${String(resolved.inspection._id).slice(-8).toUpperCase()}`;
    const inspection = await Inspection.findOneAndUpdate(
      {
        _id: resolved.inspection._id,
        bankTenantKey: resolved.inspection.bankTenantKey,
        avaluadorId: resolved.context.userId,
        status: 'draft',
        deletedAt: null,
        version: expectedVersion
      },
      {
        $set: {
          status: 'finalized',
          technicalRecommendation,
          signature: { signerName, imageData: signatureImage, signedAt: finalizedAt },
          finalizedAt,
          reportNumber
        },
        $inc: { version: 1 }
      },
      { new: true, runValidators: true }
    ).lean();
    if (!inspection) return res.status(409).json({ error: 'version_conflict' });
    res.json({ inspection: inspectionDto(inspection) });
  } catch (e) {
    res.status(e?.name === 'ValidationError' ? 400 : 500).json({ error: e.message });
  }
});

router.get('/inspections/:inspectionId/report.pdf', async (req, res) => {
  try {
    const resolved = await authorizedInspectionFor(req, req.params.inspectionId);
    if (!resolved) return res.status(404).json({ error: 'Inspeccion no encontrada.' });
    if (resolved.inspection.status !== 'finalized') {
      return res.status(409).json({ error: 'Finaliza la inspeccion antes de generar el informe.' });
    }
    const [project, units, evidence] = await Promise.all([
      Project.findOne({ _id: resolved.inspection.projectId, tenantKey: resolved.inspection.projectTenantKey }).lean(),
      InspectionUnit.find({ inspectionId: resolved.inspection._id }).sort({ createdAt: 1 }).lean(),
      InspectionEvidence.find({ inspectionId: resolved.inspection._id }).sort({ createdAt: 1 }).lean()
    ]);
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado.' });

    const inspection = resolved.inspection;
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: `Informe ${inspection.reportNumber}` } });
    res.type('application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${inspection.reportNumber || 'informe-bank73'}.pdf"`);
    doc.pipe(res);
    await renderInspectionReport(doc, { project, inspection, units, evidence });
    doc.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
    else res.end();
  }
});

// Cualquier ruta no reconocida dentro de /api/mobile/v1 debe responder 404
// aqui mismo. Sin este catch-all, Express deja caer la request hacia el
// resto de app.use('/api', ...) en server.js -incluido el guard generico
// que bloquea al rol avaluador con un 403 de "backoffice"- en vez de un
// 404 limpio, lo cual confunde a la app movil.
router.use((req, res) => {
  res.status(404).json({ error: 'Recurso no encontrado.' });
});

module.exports = router;
module.exports._helpers = {
  activeAvaluatorContext,
  activeAssignmentFor,
  assignedProjectFor,
  projectListDto,
  projectDetailDto,
  promoterProgress,
  unitDto,
  folderDto,
  inspectionDto,
  inspectionUnitDto,
  evidenceDto,
  methodologySnapshot,
  structuredProgress,
  authorizedInspectionFor,
  parseExpectedVersion,
  PROJECT_LIST_FIELDS,
  PROJECT_DETAIL_FIELDS,
  UNIT_FIELDS
};
