const mongoose = require('mongoose');
const CommercialFolder = require('../models/CommercialFolder');
const ProjectFinance = require('../models/ProjectFinance');
const Project = require('../models/Project');
const Unit = require('../models/Unit');

function normalizedStageName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/^(fase|etapa|torre)\s+/i, '')
    .replace(/^n(?:o|ro)?\.?\s*(?=\d)/i, '')
    .replace(/\s+/g, ' ');
}

function isMeaningfulUnassignedName(value) {
  const name = String(value || '').trim();
  if (!name) return false;
  return !['sin carpeta', 'sin asignar', 'no asignado', 'unassigned'].includes(normalizedStageName(name));
}

function phaseHasFinancialData(phase = {}) {
  const arrays = ['uses', 'sources', 'planUses', 'planSources', 'financingLines', 'requirements'];
  if (arrays.some(key => Array.isArray(phase[key]) && phase[key].length)) return true;
  const numeric = ['disbExpected', 'disbActual', 'interesesDevengados', 'aportesPropios', 'preventas'];
  if (numeric.some(key => Number(phase[key] || 0) !== 0)) return true;
  const conditions = phase.financialConditions?.toObject
    ? phase.financialConditions.toObject()
    : (phase.financialConditions || {});
  return Object.values(conditions).some(value => {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'boolean') return value;
    return String(value || '').trim() !== '';
  });
}

/**
 * Elimina de un ProjectFinance toda la rama perteneciente a una etapa.
 * La fase es el dato canónico y las líneas usan su _id interno, por lo que
 * ambas capas deben desaparecer juntas para no dejar información huérfana.
 * Las amortizaciones pertenecen a las unidades: se conservan, retirando
 * únicamente las asignaciones hacia líneas eliminadas.
 */
function removeStageFinancialData(finance, stageId) {
  const targetStageId = String(stageId || '');
  const phases = Array.from(finance?.phases || []);
  const removedPhases = phases.filter(phase => String(phase?.stageId || '') === targetStageId);
  const removedPhaseIds = new Set(removedPhases.map(phase => String(phase?._id || '')).filter(Boolean));
  const removedRequirementIds = removedPhases.flatMap(phase =>
    Array.from(phase?.requirements || []).flatMap(item => [
      String(item?._id || ''),
      ...Array.from(item?.legacyRequirementIds || []).map(id => String(id || ''))
    ]).filter(Boolean)
  );

  const loanLines = Array.from(finance?.loanLines || []);
  const removesLegacyFirstPhase = removedPhaseIds.has(String(phases[0]?._id || ''));
  const removedLoanLines = loanLines.filter(line =>
    removedPhaseIds.has(String(line?.phaseId || '')) || (removesLegacyFirstPhase && !line?.phaseId)
  );
  const removedLoanLineIds = new Set(removedLoanLines.map(line => String(line?._id || '')).filter(Boolean));
  const removedRequestDocumentIds = removedLoanLines.flatMap(line =>
    Array.from(line?.entries || []).map(entry => String(entry?.requestDocumentId || '')).filter(Boolean)
  );

  finance.phases = phases.filter(phase => !removedPhaseIds.has(String(phase?._id || '')));
  finance.loanLines = loanLines.filter(line => !removedLoanLineIds.has(String(line?._id || '')));

  let removedAllocations = 0;
  for (const amortization of Array.from(finance?.unitAmortizations || [])) {
    const allocations = Array.from(amortization?.allocations || []);
    const kept = allocations.filter(allocation => !removedLoanLineIds.has(String(allocation?.loanLineId || '')));
    removedAllocations += allocations.length - kept.length;
    amortization.allocations = kept;
  }

  return {
    removedPhaseIds: Array.from(removedPhaseIds),
    removedPhaseNames: removedPhases.map(phase => String(phase?.name || '')).filter(Boolean),
    removedRequirementIds,
    removedLoanLineIds: Array.from(removedLoanLineIds),
    removedRequestDocumentIds,
    removedPhases: removedPhases.length,
    removedLoanLines: removedLoanLines.length,
    removedLoanEntries: removedLoanLines.reduce((sum, line) => sum + Array.from(line?.entries || []).length, 0),
    removedAllocations
  };
}

function emptyPhaseForStage(folder, fallbackDate = new Date()) {
  const start = new Date(fallbackDate);
  const end = new Date(fallbackDate);
  end.setMonth(end.getMonth() + 1);
  return {
    stageId: folder._id,
    name: folder.name,
    startDate: start,
    endDate: end,
    planUses: [],
    planSources: [],
    uses: [],
    sources: [],
    requirements: [],
    financingLines: []
  };
}

/**
 * Reconciles legacy commercial folders and finance phases into one conceptual
 * stage identity without deleting or overwriting financial information.
 *
 * - Existing explicit stageId links always win.
 * - A unique exact legacy name is linked once.
 * - An unmatched finance phase receives a CommercialFolder identity.
 * - An unmatched folder receives an empty finance shell so every stage can be
 *   opened from the unified workspace.
 */
async function reconcileProjectStages({ projectId, tenantKey }) {
  if (!mongoose.isValidObjectId(projectId) || !tenantKey) return { folders: [], finance: null, changed: false };

  const [folders, finance, project, unassignedCount] = await Promise.all([
    CommercialFolder.find({ projectId, tenantKey }).sort({ order: 1, createdAt: 1 }),
    ProjectFinance.findOne({ project: projectId, tenantKey }),
    Project.findOne({ _id: projectId, tenantKey }).select('commercialUnassignedName commercialUnassignedColor').lean(),
    Unit.countDocuments({ projectId, tenantKey, folderId: null })
  ]);

  const financeDoc = finance || new ProjectFinance({ project: projectId, tenantKey, phases: [] });
  const folderById = new Map(folders.map(folder => [String(folder._id), folder]));
  const usedFolderIds = new Set();
  let changed = !finance;

  // Las versiones anteriores representaban la primera etapa mediante la
  // pseudo-carpeta "sin asignar". Solo la promovemos cuando la identidad es
  // inequívoca; así Etapa 1, Fase 1 y Torre 1 pasan a ser el mismo dato sin
  // adivinar a qué etapa pertenecen unidades ambiguas.
  const legacyUnassignedName = String(project?.commercialUnassignedName || '').trim();
  if (unassignedCount > 0 && isMeaningfulUnassignedName(legacyUnassignedName)) {
    const legacyKey = normalizedStageName(legacyUnassignedName);
    const matchingFolders = folders.filter(folder => normalizedStageName(folder.name) === legacyKey);
    const matchingPhases = (financeDoc.phases || []).filter(phase => normalizedStageName(phase.name) === legacyKey);
    const linkedFolders = matchingPhases
      .map(phase => folderById.get(String(phase.stageId || '')))
      .filter(Boolean);
    let targetFolder = linkedFolders.length === 1
      ? linkedFolders[0]
      : (matchingFolders.length === 1 ? matchingFolders[0] : null);

    if (!targetFolder && matchingFolders.length === 0 && matchingPhases.length <= 1) {
      const nextOrder = folders.length
        ? Math.max(...folders.map(item => Number(item.order || 0))) + 1
        : 0;
      targetFolder = await CommercialFolder.create({
        tenantKey,
        projectId,
        name: legacyUnassignedName,
        color: project?.commercialUnassignedColor || '#111827',
        order: nextOrder
      });
      folders.push(targetFolder);
      folderById.set(String(targetFolder._id), targetFolder);
    }

    if (targetFolder) {
      await Unit.updateMany(
        { projectId, tenantKey, folderId: null },
        { $set: { folderId: targetFolder._id } }
      );
      await Project.updateOne(
        { _id: projectId, tenantKey },
        { $set: { commercialUnassignedName: 'Sin carpeta' } }
      );
      if (matchingPhases.length === 1) {
        matchingPhases[0].stageId = targetFolder._id;
        matchingPhases[0].name = targetFolder.name;
        changed = true;
      }
    }
  }

  for (const phase of financeDoc.phases || []) {
    const linkedId = String(phase.stageId || '');
    if (linkedId && folderById.has(linkedId)) {
      usedFolderIds.add(linkedId);
      const canonicalName = folderById.get(linkedId).name;
      if (phase.name !== canonicalName) {
        phase.name = canonicalName;
        changed = true;
      }
      continue;
    }

    const key = normalizedStageName(phase.name);
    const candidates = folders.filter(folder =>
      !usedFolderIds.has(String(folder._id)) && normalizedStageName(folder.name) === key
    );
    let folder = candidates.length === 1 ? candidates[0] : null;

    if (!folder) {
      const nextOrder = folders.length
        ? Math.max(...folders.map(item => Number(item.order || 0))) + 1
        : 0;
      folder = await CommercialFolder.create({
        tenantKey,
        projectId,
        name: String(phase.name || '').trim() || `Etapa ${folders.length + 1}`,
        color: '#111827',
        order: nextOrder
      });
      folders.push(folder);
      folderById.set(String(folder._id), folder);
    }

    phase.stageId = folder._id;
    phase.name = folder.name;
    usedFolderIds.add(String(folder._id));
    changed = true;
  }

  for (const folder of folders) {
    const folderId = String(folder._id);
    if (usedFolderIds.has(folderId)) continue;
    financeDoc.phases.push(emptyPhaseForStage(folder, folder.createdAt || new Date()));
    usedFolderIds.add(folderId);
    changed = true;
  }

  if (!folders.length) {
    const firstStage = await CommercialFolder.create({
      tenantKey,
      projectId,
      name: 'Etapa 1',
      color: project?.commercialUnassignedColor || '#111827',
      order: 0
    });
    folders.push(firstStage);
    folderById.set(String(firstStage._id), firstStage);
    financeDoc.phases.push(emptyPhaseForStage(firstStage, firstStage.createdAt || new Date()));
    changed = true;
  }

  // La pantalla unificada ya no mantiene una pseudo-etapa paralela. Cualquier
  // unidad heredada sin folderId pasa a la primera etapa canónica del proyecto.
  // Si el proyecto todavía no tenía estructura, se crea una única Etapa 1.
  if (unassignedCount > 0) {
    let firstStage = [...folders].sort((a, b) => Number(a.order || 0) - Number(b.order || 0))[0];
    await Unit.updateMany(
      { projectId, tenantKey, folderId: null },
      { $set: { folderId: firstStage._id } }
    );
  }

  if (changed) await financeDoc.save();
  return { folders, finance: financeDoc, changed };
}

async function syncStageName({ stageId, tenantKey, name }) {
  if (!mongoose.isValidObjectId(stageId) || !tenantKey) return;
  const cleanName = String(name || '').trim();
  if (!cleanName) return;
  await ProjectFinance.updateMany(
    { tenantKey, 'phases.stageId': stageId },
    { $set: { 'phases.$[phase].name': cleanName } },
    { arrayFilters: [{ 'phase.stageId': stageId }] }
  );
}

module.exports = {
  normalizedStageName,
  isMeaningfulUnassignedName,
  phaseHasFinancialData,
  removeStageFinancialData,
  emptyPhaseForStage,
  reconcileProjectStages,
  syncStageName
};
