// services/comercial_kpis.js
const mongoose = require('mongoose');
const Unit = require('../models/Unit');
const Project = require('../models/Project');

// Estados que cuentan como no disponibles / vendidos
const SOLD_STATUSES = [
  'reservado',
  'con_cpp',
  'tramite_legal_activado',
  'escriturado_traspasado',
  'vivienda_entregada'
];

function toObjectId(x) {
  try {
    if (!x) return null;
    if (x instanceof mongoose.Types.ObjectId) return x;
    return new mongoose.Types.ObjectId(String(x));
  } catch {
    return null;
  }
}

async function recomputeCommercialKpis({ tenantKey, projectId }) {
  const pid = toObjectId(projectId);
  if (!pid) throw new Error('projectId inválido en recomputeCommercialKpis');

  const match = {
    projectId: pid,
    $and: [
      { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] },
      {
        $or: [
          { tenantKey },
          { tenantKey: { $exists: false } },
          { tenantKey: null }
        ]
      }
    ]
  };

  const [agg] = await Unit.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$projectId',
        unitsTotal: { $sum: 1 },
        unitsSold: {
          $sum: {
            $cond: [{ $in: ['$estado', SOLD_STATUSES] }, 1, 0]
          }
        }
      }
    }
  ]);

  const unitsTotal = agg?.unitsTotal || 0;
  const unitsSold = agg?.unitsSold || 0;

  await Project.updateOne(
    { _id: pid, tenantKey },
    { $set: { unitsTotal, unitsSold } }
  );

  return { unitsTotal, unitsSold };
}

module.exports = { recomputeCommercialKpis };
