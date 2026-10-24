'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const Venta = require('../models/Venta');

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('Falta MONGO_URI o MONGODB_URI');
  await mongoose.connect(uri);

  const units = mongoose.connection.collection('units');
  const cursor = units.find({ $or: [{ precioLista: { $exists: true } }, { price: { $exists: true } }] });
  let migrated = 0;
  let removed = 0;
  let candidates = 0;

  for await (const unit of cursor) {
    candidates++;
    const legacyPrice = Number(unit.precioLista ?? unit.price ?? 0);
    if (legacyPrice > 0) {
      const current = await Venta.findOne({ projectId: unit.projectId, unitId: unit._id, deletedAt: null }).select('precioVenta').lean();
      if (!Number(current?.precioVenta || 0)) {
        migrated++;
        if (!apply) continue;
        await Venta.findOneAndUpdate(
          { projectId: unit.projectId, unitId: unit._id },
          { $set: { tenantKey: unit.tenantKey, projectId: unit.projectId, unitId: unit._id, manzana: unit.manzana || '', lote: unit.lote || '', precioVenta: legacyPrice, deletedAt: null } },
          { upsert: true, new: true, runValidators: true }
        );
      }
    }
    if (!apply) continue;
    const result = await units.updateOne({ _id: unit._id }, { $unset: { precioLista: '', price: '' } });
    removed += result.modifiedCount || 0;
  }

  console.log(JSON.stringify({ ok: true, mode: apply ? 'apply' : 'preview', candidates, pricesToMigrate: migrated, legacyFieldsRemoved: removed }));
  await mongoose.disconnect();
}

main().catch(async error => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
