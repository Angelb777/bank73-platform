// scripts/seed-process-template.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const fs = require('fs');

// ===== Esquemas mínimos locales (evitamos dependencias externas) =====
const ProcessTemplate = mongoose.model(
  'ProcessTemplate',
  new mongoose.Schema({}, { collection: 'processTemplates', strict: false })
);

const ChecklistSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, index:true }, // algunos backends usan este
    project:   { type: mongoose.Schema.Types.ObjectId, index:true }, // otros usan este
    key: { type:String, index:true },
    title: String,

    // fase/rol (y alias habituales)
    phase: String,
    phaseKey: String,       // alias típico en APIs viejas
    role: String,
    ownerRole: String,      // alias típico

    // orden/secuencia
    level: Number,
    orderInLevel: Number,
    order: Number,

    // tipo y subtareas
    type: { type:String, default:'ITEM' }, // ITEM | GROUP
    subtasksTemplate: [{ title:String }],

    // estado
    status: { type:String, default:'PENDING' }, // PENDING|EN_PROCESO|COMPLETADO
    validated: { type:Boolean, default:false },
    dueDate: Date,

    // flags de visibilidad típicos
    archived: { type:Boolean, default:false },
    deleted:  { type:Boolean, default:false },
    hidden:   { type:Boolean, default:false },

    // varios
    lockedBySequence: { type:Boolean, default:true },
    meta: Object,
    createdAt: { type:Date, default:Date.now },
    updatedAt: { type:Date, default:Date.now }
  },
  { collection:'checklists' }
);

// Unicidad lógica
ChecklistSchema.index({ projectId:1, key:1 }, { unique:false });
ChecklistSchema.index({ project:1,   key:1 }, { unique:false });

const ProjectSchema = new mongoose.Schema({}, { collection:'projects' });


const Checklist       = mongoose.model('Checklist', ChecklistSchema);
const Project         = mongoose.model('Project', ProjectSchema);

// ===== CLI helpers =====
function getFlag(name) {
  const pref = `--${name}=`;
  const arg = process.argv.find(a => a.startsWith(pref));
  return arg ? arg.slice(pref.length) : null;
}

async function seedTemplate(jsonPath) {
  if (!fs.existsSync(jsonPath)) throw new Error('No se encontró data/process_template.v1.json');
  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  // ✅ fuerza que quede activa siempre
  json.active = true;

  // elimina misma versión y crea
  await ProcessTemplate.deleteMany({ version: json.version });
  const tpl = await ProcessTemplate.create(json);

  // ✅ deja SOLO esta activa
  await ProcessTemplate.updateMany(
    { _id: { $ne: tpl._id } },
    { $set: { active: false } }
  );

  return tpl;
}

function buildChecklistDoc(projectId, step) {
  return {
    projectId,
    project: projectId,                 // <- cubre ambos campos
    key: step.key,
    title: step.title,

    phase: step.phase,
    phaseKey: step.phase,               // alias por compatibilidad
    role: step.role,
    ownerRole: step.role,               // alias por compatibilidad

    level: step.level || 0,
    orderInLevel: step.orderInLevel || step.order || 0,
    order: step.order || step.orderInLevel || step.level || 0,

    type: step.type || 'ITEM',
    subtasksTemplate: step.subtasksTemplate || [],

    status: 'PENDING',
    validated: false,
    dueDate: null,

    archived: false,
    deleted:  false,
    hidden:   false,

    lockedBySequence: true,
    meta: {}
  };
}

async function applyTemplateToProject(projectId, template) {
  let created = 0, updated = 0, skipped = 0;

  // Compatibilidad: usa steps o items o checklists, según exista
  const steps = template.steps || template.items || template.checklists || [];
  if (!steps.length) {
    console.warn('⚠️ La plantilla no contiene steps/items/checklists. Nada que aplicar.');
    return;
  }

  for (const step of steps) {
    const doc = buildChecklistDoc(projectId, step);

    // upsert en dos claves posibles (por compatibilidad)
    const res = await Checklist.updateOne(
      { $or: [ { projectId: projectId, key: step.key }, { project: projectId, key: step.key } ] },
      { $setOnInsert: doc },
      { upsert: true } 
    ).catch(e => {
      if (e.code === 11000) return { upsertedCount:0, matchedCount:1, modifiedCount:0 };
      throw e;
    });

    if (res.upsertedCount === 1 || (res.matchedCount === 0 && res.modifiedCount === 0)) {
      created++;
    } else {
      // si quieres refrescar títulos/roles/fase en existentes, activa este $set:
      // await Checklist.updateOne({ $or:[{projectId:projectId,key:step.key},{project:projectId,key:step.key}] }, { $set: doc });
      skipped++;
    }
  }

  console.log(`→ Proyecto ${projectId}: creados ${created}, existentes ${skipped}, actualizados ${updated}`);
}

(async () => {
  try {
    const MONGO_URI = process.env.MONGO_URI || process.env.MONGO_URL || process.env.MONGODB_URI;
    if (!MONGO_URI) throw new Error('No se encontró MONGO_URI (ni MONGO_URL/MONGODB_URI) en .env');

    await mongoose.connect(MONGO_URI, {});
    console.log('[Mongo] Conectado');

    const jsonPath = path.resolve(__dirname, '../data/process_template.v1.json');
    console.log('[DEBUG] Leyendo plantilla desde:', jsonPath);

    const tpl = await seedTemplate(jsonPath);
    console.log(`✔ Plantilla v${tpl.version} cargada${tpl.active ? ' y activa' : ''}.`);

    const applyTo = getFlag('apply'); // all | <ObjectId>
    if (applyTo) {
      const activeTpl = await ProcessTemplate.findOne({ active:true }).lean();
      if (!activeTpl) throw new Error('No hay plantilla activa');

      if (applyTo === 'all') {
        const projects = await Project.find({}, { _id:1 }).lean();
        for (const p of projects) {
          await applyTemplateToProject(p._id, activeTpl);
        }
      } else {
        if (!mongoose.Types.ObjectId.isValid(applyTo)) throw new Error(`--apply debe ser "all" u ObjectId válido (recibido: ${applyTo})`);
        await applyTemplateToProject(new mongoose.Types.ObjectId(applyTo), activeTpl);
      }
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (e) {
    console.error('✖ Error:', e.message);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
})();
