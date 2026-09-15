const express = require('express');
const mongoose = require('mongoose');

const Project = require('../models/Project');
const Unit = require('../models/Unit');
const ProjectAvaluatorAssignment = require('../models/ProjectAvaluatorAssignment');
const Inspection = require('../models/Inspection');
const InspectionUnit = require('../models/InspectionUnit');
const AvaluationTemplate = require('../models/AvaluationTemplate');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();

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
  'estado'
].join(' ');

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
    status: String(unit.estado || '').trim()
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
    createdAt: inspection.createdAt,
    updatedAt: inspection.updatedAt
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
    res.json({ project: projectDetailDto(resolved.project) });
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
      assignmentId: resolved.assignment._id
    }).sort({ inspectionDate: -1, createdAt: -1 }).lean();

    res.json({ inspections: inspections.map(inspectionDto) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

module.exports = router;
module.exports._helpers = {
  activeAvaluatorContext,
  activeAssignmentFor,
  assignedProjectFor,
  projectListDto,
  projectDetailDto,
  unitDto,
  inspectionDto,
  inspectionUnitDto,
  methodologySnapshot,
  structuredProgress,
  authorizedInspectionFor,
  parseExpectedVersion,
  PROJECT_LIST_FIELDS,
  PROJECT_DETAIL_FIELDS,
  UNIT_FIELDS
};
