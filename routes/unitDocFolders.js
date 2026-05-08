// routes/unitDocFolders.js
const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

const UnitDocFolder = require('../models/UnitDocFolder');
const Document = require('../models/Document');

const {
  requireProjectAccess,
  visibleDocDepartments,
  canAccessDocDepartment,
  getTenantKeyFromReq
} = require('../middleware/rbac');

function isObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ''));
}

function getUserId(req) {
  return req.user?._id || req.user?.userId || req.user?.id;
}

function getDeletePin(req) {
  return process.env.DELETE_PIN || process.env.ADMIN_PIN || '1234';
}

function assertIds(res, { projectId, unitId }) {
  if (!isObjectId(projectId)) {
    res.status(400).json({ error: 'projectId inválido o requerido' });
    return false;
  }

  if (!isObjectId(unitId)) {
    res.status(400).json({ error: 'unitId inválido o requerido' });
    return false;
  }

  return true;
}

// Listar carpetas visibles de una unidad
router.get('/', requireProjectAccess(), async (req, res, next) => {
  try {
    const { projectId, unitId, department } = req.query;

    if (!assertIds(res, { projectId, unitId })) return;

    const allowed = visibleDocDepartments(req.user?.role);

    if (!allowed.length) {
      return res.status(403).json({ error: 'Sin acceso a documentos' });
    }

    const query = {
      projectId,
      unitId
    };

    if (department) {
      if (!allowed.includes(String(department).toLowerCase())) {
        return res.status(403).json({ error: 'No tienes acceso a esta área documental' });
      }

      query.department = String(department).toLowerCase();
    } else {
      query.department = { $in: allowed };
    }

    const tenantKey = getTenantKeyFromReq(req);
    if (tenantKey) query.tenantKey = tenantKey;

    const folders = await UnitDocFolder
      .find(query)
      .sort({ department: 1, name: 1 })
      .lean();

    res.json(folders);
  } catch (err) {
    next(err);
  }
});

// Crear subcarpeta
router.post('/', requireProjectAccess(), async (req, res, next) => {
  try {
    const {
      projectId,
      unitId,
      department,
      name,
      parentId
    } = req.body;

    if (!assertIds(res, { projectId, unitId })) return;

    const dep = String(department || '').toLowerCase().trim();

    if (!canAccessDocDepartment(req, dep)) {
      return res.status(403).json({ error: 'No puedes crear carpetas en esta área' });
    }

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Nombre requerido' });
    }

    if (parentId && !isObjectId(parentId)) {
      return res.status(400).json({ error: 'parentId inválido' });
    }

    if (parentId) {
      const parent = await UnitDocFolder.findOne({
        _id: parentId,
        projectId,
        unitId,
        department: dep,
        tenantKey: getTenantKeyFromReq(req)
      }).lean();

      if (!parent) {
        return res.status(404).json({ error: 'Carpeta padre no encontrada' });
      }
    }

    const folder = await UnitDocFolder.create({
      tenantKey: getTenantKeyFromReq(req),
      projectId,
      unitId,
      department: dep,
      name: String(name).trim(),
      parentId: parentId || null,
      createdBy: getUserId(req)
    });

    res.status(201).json(folder);
  } catch (err) {
    next(err);
  }
});

// Renombrar carpeta
router.patch('/:folderId', requireProjectAccess(), async (req, res, next) => {
  try {
    const { folderId } = req.params;

    if (!isObjectId(folderId)) {
      return res.status(400).json({ error: 'folderId inválido' });
    }

    const tenantKey = getTenantKeyFromReq(req);

    const query = { _id: folderId };
    if (tenantKey) query.tenantKey = tenantKey;

    const folder = await UnitDocFolder.findOne(query);

    if (!folder) {
      return res.status(404).json({ error: 'Carpeta no encontrada' });
    }

    if (!canAccessDocDepartment(req, folder.department)) {
      return res.status(403).json({ error: 'No puedes modificar esta carpeta' });
    }

    if (req.body.name && String(req.body.name).trim()) {
      folder.name = String(req.body.name).trim();
    }

    await folder.save();

    res.json(folder);
  } catch (err) {
    next(err);
  }
});

// Eliminar carpeta con PIN
router.delete('/:folderId', requireProjectAccess(), async (req, res, next) => {
  try {
    const { folderId } = req.params;
    const { pin } = req.body || {};

    if (!isObjectId(folderId)) {
      return res.status(400).json({ error: 'folderId inválido' });
    }

    if (!pin) {
      return res.status(400).json({ error: 'PIN requerido' });
    }

    if (String(pin) !== String(getDeletePin(req))) {
      return res.status(403).json({ error: 'PIN incorrecto' });
    }

    const tenantKey = getTenantKeyFromReq(req);

    const query = { _id: folderId };
    if (tenantKey) query.tenantKey = tenantKey;

    const folder = await UnitDocFolder.findOne(query);

    if (!folder) {
      return res.status(404).json({ error: 'Carpeta no encontrada' });
    }

    if (!canAccessDocDepartment(req, folder.department)) {
      return res.status(403).json({ error: 'No puedes eliminar esta carpeta' });
    }

    // Al borrar la carpeta, los documentos NO se eliminan.
    // Vuelven a la raíz del mismo departamento.
    await Document.updateMany(
      {
        tenantKey: folder.tenantKey,
        projectId: folder.projectId,
        unitId: folder.unitId,
        department: folder.department,
        folderId: folder._id
      },
      {
        $set: { folderId: null }
      }
    );

    // Subcarpetas hijas también vuelven a raíz
    await UnitDocFolder.updateMany(
      {
        tenantKey: folder.tenantKey,
        projectId: folder.projectId,
        unitId: folder.unitId,
        department: folder.department,
        parentId: folder._id
      },
      {
        $set: { parentId: null }
      }
    );

    await UnitDocFolder.deleteOne({ _id: folder._id });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;