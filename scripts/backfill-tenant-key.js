'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const DEFAULT_TENANT = 'bancodemo';
const BATCH_SIZE = 500;

const missingTenantQuery = {
  $or: [
    { tenantKey: { $exists: false } },
    { tenantKey: null },
    { tenantKey: '' }
  ]
};

const registry = [
  { name: 'Project', model: require('../models/Project') },
  { name: 'User', model: require('../models/User'), preflight: preflightUsers },
  { name: 'ProjectFinance', model: require('../models/ProjectFinance') },
  { name: 'ProjectChecklist', model: require('../models/ProjectChecklist') },
  { name: 'Cliente', model: require('../models/Cliente') },
  { name: 'Unit', model: require('../models/Unit') },
  { name: 'Venta', model: require('../models/Venta') },
  { name: 'Document', model: require('../models/Document') },
  { name: 'ChatMessage', model: require('../models/ChatMessage') },
  { name: 'CommercialFolder', model: require('../models/CommercialFolder') },
  { name: 'UnitDocFolder', model: require('../models/UnitDocFolder') },
  { name: 'ProjectPermit', model: require('../models/ProjectPermit') },
  { name: 'Budget', model: require('../models/Budget') },
  { name: 'Loan', model: require('../models/Loan') },
  { name: 'Milestone', model: require('../models/Milestone') },
  { name: 'AuditLog', model: require('../models/AuditLog') },
  { name: 'PermitTemplate', model: require('../models/PermitTemplate') },
  {
    name: 'ProjectDocFolderPermission',
    model: require('../models/ProjectDocFolderPermission'),
    preflight: preflightProjectDocFolderPermissions
  }
];

function parseArgs(argv) {
  const args = {
    tenant: DEFAULT_TENANT,
    dryRun: true,
    apply: false,
    yes: false,
    rollback: '',
    models: null,
    sample: 5
  };

  for (const raw of argv.slice(2)) {
    if (raw === '--apply') {
      args.apply = true;
      args.dryRun = false;
    } else if (raw === '--dry-run') {
      args.dryRun = true;
      args.apply = false;
    } else if (raw === '--yes') {
      args.yes = true;
    } else if (raw.startsWith('--tenant=')) {
      args.tenant = raw.slice('--tenant='.length).trim();
    } else if (raw.startsWith('--rollback=')) {
      args.rollback = raw.slice('--rollback='.length).trim();
    } else if (raw.startsWith('--models=')) {
      args.models = raw.slice('--models='.length).split(',').map(s => s.trim()).filter(Boolean);
    } else if (raw.startsWith('--sample=')) {
      args.sample = Math.max(Number(raw.slice('--sample='.length)) || 0, 0);
    }
  }

  return args;
}

function getMongoUri() {
  return process.env.MONGO_URI || process.env.MONGO_URL || process.env.MONGODB_URI;
}

function ensureLogDir() {
  const dir = path.join(__dirname, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

function writeJsonLine(stream, payload) {
  stream.write(`${JSON.stringify(payload)}\n`);
}

function hadTenantKey(doc) {
  return Object.prototype.hasOwnProperty.call(doc, 'tenantKey');
}

function previousTenantPayload(doc) {
  if (!hadTenantKey(doc)) return { state: 'missing' };
  return { state: 'present', value: doc.tenantKey };
}

function selectRegistry(args) {
  if (!args.models) return registry;
  const wanted = new Set(args.models);
  const selected = registry.filter(item => wanted.has(item.name));
  const found = new Set(selected.map(item => item.name));
  const missing = args.models.filter(name => !found.has(name));
  if (missing.length) {
    throw new Error(`Modelos no registrados: ${missing.join(', ')}`);
  }
  return selected;
}

async function preflightUsers({ model, tenant }) {
  const duplicateLegacyEmails = await model.aggregate([
    { $match: missingTenantQuery },
    { $project: { emailKey: { $toLower: '$email' } } },
    { $match: { emailKey: { $nin: [null, ''] } } },
    { $group: { _id: '$emailKey', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 10 }
  ]);

  const legacyEmails = await model.distinct('email', missingTenantQuery);
  const normalized = legacyEmails.map(email => String(email || '').toLowerCase()).filter(Boolean);
  const existingTargetEmails = normalized.length
    ? await model.find({ tenantKey: tenant, email: { $in: normalized } }).select('email').limit(10).lean()
    : [];

  const warnings = [];
  if (duplicateLegacyEmails.length) {
    warnings.push({
      type: 'duplicate_legacy_user_emails',
      message: 'Hay usuarios legacy con emails repetidos que colisionarian al asignar el mismo tenant.',
      sample: duplicateLegacyEmails
    });
  }
  if (existingTargetEmails.length) {
    warnings.push({
      type: 'existing_target_user_emails',
      message: 'Hay usuarios en el tenant destino con emails que ya existen en usuarios legacy.',
      sample: existingTargetEmails.map(u => u.email)
    });
  }

  return warnings;
}

async function preflightProjectDocFolderPermissions({ model, tenant }) {
  const legacyDuplicates = await model.aggregate([
    { $match: missingTenantQuery },
    {
      $group: {
        _id: { projectId: '$projectId', folder: '$folder' },
        count: { $sum: 1 }
      }
    },
    { $match: { count: { $gt: 1 } } },
    { $limit: 10 }
  ]);

  const warnings = [];
  if (legacyDuplicates.length) {
    warnings.push({
      type: 'duplicate_legacy_project_folder_permissions',
      message: 'Hay permisos documentales legacy duplicados por projectId/folder; podrian colisionar con el indice unico al aplicar tenant.',
      sample: legacyDuplicates
    });
  }

  const legacyKeys = await model.find(missingTenantQuery).select('projectId folder').limit(1000).lean();
  const existingCollisions = [];
  for (const key of legacyKeys) {
    const exists = await model.findOne({
      tenantKey: tenant,
      projectId: key.projectId,
      folder: key.folder
    }).select('_id projectId folder').lean();
    if (exists) existingCollisions.push(exists);
    if (existingCollisions.length >= 10) break;
  }

  if (existingCollisions.length) {
    warnings.push({
      type: 'existing_target_project_folder_permissions',
      message: 'Ya existen permisos documentales en el tenant destino para algunos projectId/folder legacy.',
      sample: existingCollisions
    });
  }

  return warnings;
}

async function reportModel({ item, tenant, dryRun, sampleSize, logStream }) {
  const { name, model } = item;
  const count = await model.countDocuments(missingTenantQuery);
  const total = await model.estimatedDocumentCount();
  const sample = sampleSize
    ? await model.find(missingTenantQuery).select('_id tenantKey').limit(sampleSize).lean()
    : [];

  const warnings = item.preflight ? await item.preflight({ model, tenant }) : [];

  const summary = {
    model: name,
    collection: model.collection.name,
    total,
    missingTenantKey: count,
    sampleIds: sample.map(doc => String(doc._id)),
    warnings
  };

  console.log(`[${name}] total=${total} missingTenantKey=${count}`);
  if (warnings.length) {
    for (const warning of warnings) {
      console.warn(`  WARN ${warning.type}: ${warning.message}`);
    }
  }

  if (dryRun || count === 0) return { ...summary, modified: 0 };

  let modified = 0;
  let batch = [];

  const cursor = model.find(missingTenantQuery).select('_id tenantKey').lean().cursor();
  for await (const doc of cursor) {
    writeJsonLine(logStream, {
      model: name,
      collection: model.collection.name,
      id: String(doc._id),
      previousTenantKey: previousTenantPayload(doc),
      newTenantKey: tenant,
      changedAt: new Date().toISOString()
    });

    batch.push({
      updateOne: {
        filter: { _id: doc._id, ...missingTenantQuery },
        update: { $set: { tenantKey: tenant } }
      }
    });

    if (batch.length >= BATCH_SIZE) {
      const result = await model.bulkWrite(batch, { ordered: false });
      modified += result.modifiedCount || 0;
      batch = [];
    }
  }

  if (batch.length) {
    const result = await model.bulkWrite(batch, { ordered: false });
    modified += result.modifiedCount || 0;
  }

  return { ...summary, modified };
}

async function rollbackFromManifest(manifestPath) {
  const abs = path.resolve(manifestPath);
  if (!fs.existsSync(abs)) throw new Error(`No existe el manifiesto: ${abs}`);

  const byModel = new Map(registry.map(item => [item.name, item.model]));
  const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/).filter(Boolean);
  const rollbackLog = path.join(ensureLogDir(), `tenant-backfill-rollback-${timestamp()}.jsonl`);
  const stream = fs.createWriteStream(rollbackLog, { flags: 'wx' });

  let restored = 0;
  for (const line of lines.reverse()) {
    const entry = JSON.parse(line);
    const model = byModel.get(entry.model);
    if (!model) {
      writeJsonLine(stream, { ...entry, rollbackStatus: 'skipped_unknown_model' });
      continue;
    }

    const update = entry.previousTenantKey?.state === 'missing'
      ? { $unset: { tenantKey: '' } }
      : { $set: { tenantKey: entry.previousTenantKey?.value } };

    const result = await model.updateOne(
      { _id: entry.id, tenantKey: entry.newTenantKey },
      update
    );

    restored += result.modifiedCount || 0;
    writeJsonLine(stream, {
      ...entry,
      rollbackStatus: result.modifiedCount ? 'restored' : 'not_modified',
      rolledBackAt: new Date().toISOString()
    });
  }

  stream.end();
  console.log(`Rollback terminado. restored=${restored} log=${rollbackLog}`);
}

async function main() {
  const args = parseArgs(process.argv);
  const mongoUri = getMongoUri();
  if (!mongoUri) throw new Error('Falta MONGO_URI, MONGO_URL o MONGODB_URI');
  if (!args.tenant) throw new Error('Falta --tenant');

  await mongoose.connect(mongoUri, {});
  console.log(`[mongo] db=${mongoose.connection.db.databaseName}`);

  if (args.rollback) {
    await rollbackFromManifest(args.rollback);
    return;
  }

  if (args.apply && !args.yes) {
    throw new Error('Para escribir cambios usa --apply --yes. Sin --yes el script no modifica datos.');
  }

  const selected = selectRegistry(args);
  const logDir = ensureLogDir();
  const manifestPath = path.join(logDir, `tenant-backfill-${args.tenant}-${timestamp()}.jsonl`);
  const summaryPath = manifestPath.replace(/\.jsonl$/, '.summary.json');

  const preflightSummaries = [];
  let hasWarnings = false;

  for (const item of selected) {
    const summary = await reportModel({
      item,
      tenant: args.tenant,
      dryRun: true,
      sampleSize: args.sample,
      logStream: null
    });
    if (summary.warnings?.length) hasWarnings = true;
    preflightSummaries.push(summary);
  }

  if (!args.apply || hasWarnings) {
    const result = {
      tenant: args.tenant,
      mode: args.apply ? 'preflight-aborted' : 'dry-run',
      generatedAt: new Date().toISOString(),
      manifestPath: null,
      totals: {
        missingTenantKey: preflightSummaries.reduce((sum, item) => sum + item.missingTenantKey, 0),
        modified: 0
      },
      models: preflightSummaries
    };

    fs.writeFileSync(summaryPath, JSON.stringify(result, null, 2));
    console.log(`[summary] ${summaryPath}`);

    if (hasWarnings) {
      throw new Error('Preflight con warnings. No se aplicaron cambios; revisa el summary antes de continuar.');
    }

    return;
  }

  const logStream = fs.createWriteStream(manifestPath, { flags: 'wx' });
  const summaries = [];

  for (const item of selected) {
    const summary = await reportModel({
      item,
      tenant: args.tenant,
      dryRun: false,
      sampleSize: 0,
      logStream
    });
    summaries.push(summary);
  }

  logStream.end();

  const result = {
    tenant: args.tenant,
    mode: args.apply ? 'apply' : 'dry-run',
    generatedAt: new Date().toISOString(),
    manifestPath: args.apply ? manifestPath : null,
    totals: {
      missingTenantKey: summaries.reduce((sum, item) => sum + item.missingTenantKey, 0),
      modified: summaries.reduce((sum, item) => sum + item.modified, 0)
    },
    models: summaries
  };

  fs.writeFileSync(summaryPath, JSON.stringify(result, null, 2));
  console.log(`[summary] ${summaryPath}`);
  console.log(`[rollback manifest] ${manifestPath}`);
}

main()
  .catch(err => {
    console.error('[backfill-tenant-key] ERROR', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
