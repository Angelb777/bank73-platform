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

  console.log('[KPIS] recompute start =>', {
    tenantKey,
    projectId_in: String(projectId),
    projectId_pid: String(pid)
  });

  console.log('[KPIS] match =>', JSON.stringify(match));

  try {
    const countAll = await Unit.countDocuments({
      projectId: pid,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }]
    });

    const countMatch = await Unit.countDocuments(match);

    const countSold = await Unit.countDocuments({
      ...match,
      estado: { $in: SOLD_STATUSES }
    });

    console.log('[KPIS] countDocuments =>', { countAll, countMatch, countSold });
  } catch (e) {
    console.warn('[KPIS] countDocuments error =>', e?.message || e);
  }

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

  console.log('[KPIS] agg result =>', agg);

  const unitsTotal = agg?.unitsTotal || 0;
  const unitsSold = agg?.unitsSold || 0;

  const r = await Project.updateOne(
    { _id: pid, tenantKey },
    { $set: { unitsTotal, unitsSold } }
  );

  console.log('[KPIS] update result =>', {
    matched: r.matchedCount,
    modified: r.modifiedCount,
    set: { unitsTotal, unitsSold }
  });

  try {
    const proj = await Project.findOne({ _id: pid, tenantKey })
      .select('unitsTotal unitsSold')
      .lean();

    console.log('[KPIS] project after update =>', proj);
  } catch (e) {
    console.warn('[KPIS] project readback error =>', e?.message || e);
  }

  return { unitsTotal, unitsSold };
}

module.exports = { recomputeCommercialKpis };