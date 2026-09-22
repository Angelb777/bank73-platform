'use strict';

const fs = require('fs');
const path = require('path');

const C = { blue: '#123B6D', navy: '#172033', muted: '#647089', pale: '#EAF2FB', border: '#D7DEE8', green: '#0F7B4E', amber: '#B86A00', white: '#FFFFFF' };
const MARGIN = 44;
const PHOTO_ROOT = path.resolve(__dirname, '..', 'uploads', 'inspections');
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const pct = value => value === null || value === undefined ? '—' : `${num(value).toFixed(1)} %`;
const fmtDate = value => value ? new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Panama' }).format(new Date(value)) : '—';
const dash = value => value === null || value === undefined || value === '' ? '—' : String(value);
const fmtMoney = (value, currency) => new Intl.NumberFormat('es-PA', { style: 'currency', currency: currency || 'PAB', maximumFractionDigits: 2 }).format(num(value));
const LABELS = {
  approved: 'Aprobado', pending: 'Pendiente', submitted: 'Presentado', in_progress: 'En trámite', rejected: 'Rechazado', waived: 'No requerido', active: 'Activo', ACTIVE: 'Activo', expired: 'Vencido',
  not_visited: 'Pendiente', no_change: 'Sin cambios', paused: 'Detenido', completed: 'Completado', not_applicable: 'No aplica',
  open: 'Abierta', monitoring: 'En seguimiento', resolved: 'Resuelta', low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica',
  change: 'Cambio', delay: 'Retraso', defect: 'Defecto', quality: 'Calidad', environment: 'Medioambiente', risk: 'Riesgo', other: 'Otra',
  on_track: 'En plazo', at_risk: 'En riesgo', delayed: 'Retrasado', not_assessed: 'Sin evaluar',
  conforming: 'Conforme', observations_required: 'Con observaciones', non_conforming: 'No conforme',
  structure: 'Estructura', materials: 'Materiales', workmanship: 'Ejecución', finishes: 'Acabados', waste: 'Residuos', dust: 'Polvo', drainage: 'Drenaje', erosion: 'Erosión',
  progress: 'Avance de obra', incident: 'Incidencia', comparison: 'Comparación', general: 'Evidencia general'
};
const label = value => LABELS[value] || dash(value);
const delta = value => value === null || value === undefined ? '—' : `${num(value) >= 0 ? '+' : ''}${num(value).toFixed(1)} pts`;

function legacyContext({ project = {}, inspection = {}, units = [], evidence = [], folders = [], previousInspection = null }) {
  return {
    project: { ...project, type: project.projectType, legal: project.legalData || {}, technical: project.technicalData || {}, location: { label: project.location, address: project.address, city: project.city, province: project.province } },
    participants: { promoter: { name: project.legalData?.promoterLegalName || '' } },
    finance: { summary: {}, financialConditions: {}, loanLines: [], unitAmortizations: [] },
    planning: { phases: [] }, compliance: { permits: [], requirements: [], policies: [] }, inventory: { folders, models: [] },
    history: { previousInspection, previousPhysicalProgressPercent: num(previousInspection?.projectProgressPercent) },
    inspection: { ...inspection, physicalProgressPercent: inspection.projectProgressPercent }, inspectionUnits: units, photos: evidence,
    workFronts: [], unitProgressComparisons: [], pendingIssues: [],
    metrics: { administrativeProgress: {}, financialProgress: {}, physicalProgress: { previousPercent: num(previousInspection?.projectProgressPercent), currentPercent: num(inspection.projectProgressPercent), periodIncrementPercent: num(inspection.projectProgressPercent) - num(previousInspection?.projectProgressPercent) } },
    visit: { generalObservations: inspection.generalObservations || '', incidents: inspection.incidents || [], qualityObservations: inspection.qualityObservations || '', environmentalObservations: inspection.environmentalObservations || '', scheduleAssessment: inspection.scheduleAssessment, conclusion: inspection.technicalRecommendation?.notes || '', recommendation: inspection.technicalRecommendation },
    signature: inspection.signature
  };
}

async function renderInspectionReport(doc, input = {}) {
  const ctx = input.context || legacyContext(input);
  const project = ctx.project || {};
  const inspection = ctx.inspection || {};
  const visit = ctx.visit || {};
  const finance = ctx.finance || {};
  const compliance = ctx.compliance || {};
  const currency = project.currency || 'PAB';
  const width = doc.page.width - MARGIN * 2;
  const logoWhite = path.join(__dirname, '..', 'assets', 'Bank73logoblanco.png');
  let sectionIndex = 0;

  const pageHeader = () => {
    doc.page.margins.top = 74;
    doc.save().rect(0, 0, doc.page.width, 26).fill(C.blue).restore();
    if (fs.existsSync(logoWhite)) doc.image(logoWhite, doc.page.width - MARGIN - 75, 6, { fit: [75, 15] });
    else doc.font('Helvetica-Bold').fontSize(9).fillColor(C.white).text('BANK73', MARGIN, 8);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted).text(dash(project.name), MARGIN, 39, { width: width * .7, ellipsis: true, lineBreak: false });
    doc.font('Helvetica').text(dash(inspection.reportNumber), MARGIN + width * .7, 39, { width: width * .3, align: 'right', lineBreak: false });
    doc.save().moveTo(MARGIN, 58).lineTo(MARGIN + width, 58).strokeColor(C.border).stroke().restore();
    doc.x = MARGIN; doc.y = 74;
  };
  doc.on('pageAdded', pageHeader);
  const ensure = height => { if (doc.y + height > doc.page.height - 48) doc.addPage(); };
  const paragraph = (value, options = {}) => {
    if (!value) return;
    ensure(24);
    doc.font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(options.size || 9.2).fillColor(options.muted ? C.muted : C.navy)
      .text(String(value), MARGIN, doc.y, { width, lineGap: 2, paragraphGap: 5, align: options.align || 'left' });
  };
  const heading = (title, numbered = true) => {
    ensure(52); if (numbered) sectionIndex += 1;
    const y = doc.y + 7;
    doc.save().roundedRect(MARGIN, y, width, 29, 5).fill(C.pale).restore();
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor(C.blue).text(numbered ? `${sectionIndex}. ${title}` : title, MARGIN + 11, y + 8, { width: width - 22 });
    doc.x = MARGIN; doc.y = y + 41;
  };
  const subheading = title => { ensure(24); doc.font('Helvetica-Bold').fontSize(9.8).fillColor(C.blue).text(title, MARGIN, doc.y, { width }); doc.y += 5; };
  const keyValues = rows => {
    for (const [label, raw] of rows) {
      if (raw === null || raw === undefined || raw === '') continue;
      ensure(19); const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8.6).fillColor(C.muted).text(label, MARGIN, y, { width: width * .3 });
      doc.font('Helvetica').fillColor(C.navy).text(String(raw), MARGIN + width * .31, y, { width: width * .69 });
      doc.y = Math.max(doc.y, y + 14);
    }
    doc.y += 4;
  };
  const table = (headers, rows, ratios) => {
    const total = ratios.reduce((sum, value) => sum + value, 0);
    const columns = ratios.map(value => width * value / total);
    const rowHeight = (cells, header) => {
      const heights = cells.map((cell, index) => doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(header ? 7.6 : 7.8).heightOfString(dash(cell), { width: columns[index] - 9 }));
      return Math.max(20, ...heights) + 9;
    };
    const draw = (cells, header, height = rowHeight(cells, header)) => {
      let x = MARGIN; const y = doc.y;
      cells.forEach((cell, index) => {
        doc.save().rect(x, y, columns[index], height).fill(header ? C.blue : '#F8FAFC').strokeColor(C.border).stroke().restore();
        doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(header ? 7.6 : 7.8).fillColor(header ? C.white : C.navy)
          .text(dash(cell), x + 4.5, y + 6, { width: columns[index] - 9, lineGap: 1 });
        x += columns[index];
      });
      doc.y = y + height;
    };
    ensure(rowHeight(headers, true) + 22);
    draw(headers, true);
    rows.forEach(row => {
      const height = rowHeight(row, false);
      if (doc.y + height > doc.page.height - 48) {
        doc.addPage();
        draw(headers, true);
      }
      draw(row, false, height);
    });
    doc.y += 8;
  };
  const cards = metrics => {
    const gap = 8; const cardWidth = (width - gap * 2) / 3;
    metrics.forEach((metric, index) => {
      if (index % 3 === 0) ensure(62);
      const x = MARGIN + (index % 3) * (cardWidth + gap); const y = doc.y;
      doc.save().roundedRect(x, y, cardWidth, 52, 6).fill('#F1F5F9').restore();
      doc.font('Helvetica').fontSize(7.3).fillColor(C.muted).text(metric[0], x + 9, y + 9, { width: cardWidth - 18, height: 17 });
      doc.font('Helvetica-Bold').fontSize(13.5).fillColor(C.blue).text(metric[1], x + 9, y + 28, { width: cardWidth - 18, height: 17, ellipsis: true });
      if (index % 3 === 2 || index === metrics.length - 1) doc.y = y + 61;
    });
  };
  const progress = (label, previous, current, planned) => {
    ensure(42); const change = previous == null || current == null ? null : num(current) - num(previous);
    paragraph(`${label}: anterior ${pct(previous)} | periodo ${delta(change)} | acumulado ${pct(current)}${planned == null ? '' : ` | previsto ${pct(planned)}`}`, { size: 8.5 });
    const y = doc.y; doc.save().roundedRect(MARGIN, y, width, 6, 3).fill('#E2E8F0');
    const fill = width * Math.min(100, Math.max(0, num(current))) / 100; if (fill) doc.rect(MARGIN, y, fill, 6).fill(C.blue);
    const marker = MARGIN + width * Math.min(100, Math.max(0, num(previous))) / 100; doc.rect(Math.max(MARGIN, marker - 1), y - 2, 2, 10).fill(C.green);
    if (planned != null) { const plan = MARGIN + width * Math.min(100, Math.max(0, num(planned))) / 100; doc.rect(Math.max(MARGIN, plan - 1), y - 2, 2, 10).fill(C.amber); }
    doc.restore(); doc.y = y + 16;
  };
  const addPhoto = async item => {
    const absolute = path.resolve(__dirname, '..', String(item.path || ''));
    const relative = path.relative(PHOTO_ROOT, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return;
    ensure(245);
    try {
      await fs.promises.access(absolute, fs.constants.R_OK);
      const y = doc.y; doc.image(absolute, MARGIN, y, { fit: [width, 205], align: 'center' }); doc.y = y + 211;
      paragraph(item.caption || 'Evidencia de inspección', { muted: true, align: 'center', size: 8 });
    } catch (_) { paragraph(`Fotografía no disponible: ${item.caption || item.originalname || ''}`, { muted: true }); }
  };

  // Portada
  doc.save().rect(0, 0, doc.page.width, doc.page.height).fill('#F7F9FC').restore();
  doc.save().rect(0, 0, doc.page.width, 235).fill(C.blue).restore();
  if (fs.existsSync(logoWhite)) doc.image(logoWhite, MARGIN, 48, { fit: [145, 40] });
  else doc.font('Helvetica-Bold').fontSize(22).fillColor(C.white).text('BANK73', MARGIN, 55);
  doc.font('Helvetica-Bold').fontSize(27).fillColor(C.white).text('INFORME DE INSPECCIÓN\nDE OBRA', MARGIN, 112, { width, lineGap: 4 });
  doc.font('Helvetica').fontSize(11).fillColor('#DCE9F8').text(dash(project.name), MARGIN, 190, { width, ellipsis: true });
  doc.y = 275;
  keyValues([
    ['Informe', inspection.reportNumber || `Inspección ${inspection.sequence || ''}`], ['Fecha de visita', fmtDate(inspection.inspectionDate)],
    ['Fecha del informe', fmtDate(inspection.finalizedAt || ctx.generatedAt)],
    ['Ubicación', [project.location?.address, project.location?.city, project.location?.province].filter(Boolean).join(', ') || project.location?.label],
    ['Promotor', ctx.participants?.promoter?.name || project.legal?.promoterLegalName], ['Banco', ctx.participants?.bank?.name], ['Avaluador', ctx.signature?.signerName || 'Pendiente de firma']
  ]);
  doc.y = 540;
  paragraph('Documento técnico preparado por Bank73 a partir de la información registrada del proyecto y de las observaciones certificadas durante la visita.', { muted: true });

  doc.addPage();
  const physical = ctx.metrics?.physicalProgress || {};
  heading('Resumen ejecutivo', false);
  cards([
    ['Avance anterior', pct(physical.previousPercent)], ['Avance del periodo', `${num(physical.periodIncrementPercent) >= 0 ? '+' : ''}${num(physical.periodIncrementPercent).toFixed(1)} pts`], ['Avance acumulado', pct(physical.currentPercent)],
    ['Gestión Bank73', pct(ctx.metrics?.administrativeProgress?.percent)], ['Avance financiero', pct(ctx.metrics?.financialProgress?.percent)], ['Fotografías', String((ctx.photos || []).length)]
  ]);
  progress('Avance físico certificado', physical.previousPercent, physical.currentPercent, visit.scheduleAssessment?.plannedProgressPercent);
  if (visit.generalObservations) { subheading('Observaciones generales'); paragraph(visit.generalObservations); }
  if ((ctx.pendingIssues || []).length) paragraph(`${ctx.pendingIssues.length} incidencia(s) anteriores requieren seguimiento.`, { bold: true });
  if ((visit.incidents || []).length) paragraph(`${visit.incidents.length} incidencia(s) registradas en esta visita.`, { bold: true });

  heading('Datos generales y participantes');
  keyValues([
    ['Proyecto', project.name], ['Descripción', project.description], ['Tipo', project.type], ['Estado Bank73', project.status],
    ['Ubicación', [project.location?.label, project.location?.address, project.location?.city, project.location?.province].filter(Boolean).join(', ')],
    ['Promotor', ctx.participants?.promoter?.name || project.legal?.promoterLegalName], ['Banco', ctx.participants?.bank?.name], ['Banco interino', project.legal?.interimBank], ['Fideicomiso', project.legal?.trustName],
    ['Número de fases', project.technical?.phasesCount], ['Unidades previstas', project.technical?.totalUnits]
  ]);
  const board = project.legal?.boardMembers || [];
  if (board.length) table(['Profesional / dignatario', 'Cargo', 'Identificación'], board.map(item => [item.name, item.position, item.cedula]), [2, 1.2, 1.2]);
  const technicalTeam = ctx.participants?.technicalTeam || [];
  if (technicalTeam.length) table(['Equipo técnico', 'Título', 'Idoneidad', 'Empresa'], technicalTeam.map(item => [item.name, item.professional?.title, item.professional?.licenseNumber, item.professional?.company]), [1.5, 1.2, 1, 1.5]);
  if (project.description || project.technical?.notes) {
    subheading('Memoria descriptiva disponible en Bank73');
    paragraph([project.description, project.technical?.notes].filter(Boolean).join('\n\n'));
  }

  heading('Modelos de vivienda y unidades');
  let models = ctx.inventory?.models || [];
  if (!models.length) {
    const byModel = new Map();
    for (const unit of ctx.inventory?.units || []) {
      const name = String(unit.model || '').trim();
      if (!name) continue;
      byModel.set(name, { name, bedrooms: null, bathrooms: null, closedAreaM2: null, openAreaM2: null, unitsCount: (byModel.get(name)?.unitsCount || 0) + 1 });
    }
    models = [...byModel.values()];
  }
  if (models.length) table(['Modelo', 'Rec.', 'Baños', 'Área cerrada', 'Área abierta', 'Unidades'], models.map(item => [item.name, item.bedrooms, item.bathrooms, item.closedAreaM2 == null ? null : `${num(item.closedAreaM2)} m²`, item.openAreaM2 == null ? null : `${num(item.openAreaM2)} m²`, item.unitsCount]), [2, .55, .55, 1, 1, .7]);
  else paragraph('No hay modelos de vivienda estructurados en Bank73.', { muted: true });

  heading('Presupuesto, financiación y resumen financiero');
  const summary = finance.summary || {};
  cards([
    ['Presupuesto', fmtMoney(summary.budgetApproved, currency)], ['Financiamiento', fmtMoney(summary.loanApproved, currency)], ['Aporte promotor', fmtMoney(summary.promoterContribution, currency)],
    ['Desembolsado', fmtMoney(summary.totalDisbursed, currency)], ['Amortizado', fmtMoney(summary.totalAmortized, currency)], ['Saldo', fmtMoney(summary.currentDebtBalance, currency)]
  ]);
  keyValues([['Condiciones de desembolso', finance.financialConditions?.disbursementConditions], ['Condiciones de amortización', finance.financialConditions?.amortizationConditions], ['Garantías', finance.financialConditions?.guarantees], ['Seguro requerido', finance.financialConditions?.insurance], ['Plazo', finance.financialConditions?.term]]);

  heading('Programa de obra y fases');
  const phases = ctx.planning?.phases || [];
  if (phases.length) table(['Fase', 'Inicio previsto', 'Fin previsto', 'Inicio real', 'Fin real', 'Estado'], phases.map(item => [item.name, fmtDate(item.startDate), fmtDate(item.endDate), fmtDate(item.actualStartDate), fmtDate(item.actualEndDate), item.isCompleted ? 'Completada' : item.active ? 'Activa' : 'Programada']), [1.8, 1, 1, 1, 1, 1]);
  else paragraph('No existe un programa de fases estructurado.', { muted: true });
  const schedule = ctx.metrics?.scheduleProgress || {};
  if (schedule.plannedPercent != null || schedule.actualPercent != null) {
    table(['Avance previsto', 'Avance real', 'Desviación'], [[pct(schedule.plannedPercent), pct(schedule.actualPercent), delta(schedule.variancePercent)]], [1, 1, 1]);
  }
  keyValues([['Evaluación del plazo', label(visit.scheduleAssessment?.status)], ['Finalización prevista', fmtDate(visit.scheduleAssessment?.forecastCompletionDate)], ['Explicación / plan de recuperación', visit.scheduleAssessment?.notes]]);

  heading('Permisos, planos, contratos, pólizas y fianzas');
  const permits = compliance.permits || [];
  if (permits.length) table(['Permiso / documento', 'N.º', 'Institución', 'Estado', 'Emisión / resolución', 'Vencimiento'], permits.map(item => [item.title || item.code, item.code, item.institution, label(item.status), fmtDate(item.resolvedAt || item.submittedAt), fmtDate(item.dueDate)]), [2.2, .8, 1.3, .8, 1, 1]);
  else paragraph('No hay permisos estructurados asociados al proyecto.', { muted: true });
  const requirements = compliance.requirements || [];
  if (requirements.length) {
    const pending = requirements.filter(item => !['completed', 'approved', 'COMPLETADO'].includes(String(item.status || '')));
    subheading('Requisitos relevantes');
    paragraph(`${requirements.length - pending.length} completados · ${pending.length} pendientes o en curso.`, { muted: true, size: 8 });
    if (pending.length) table(['Fase', 'Requisito pendiente', 'Estado'], pending.map(item => [item.phaseName, item.title, label(item.status)]), [1, 3.3, .9]);
  }
  const policies = compliance.policies || [];
  if (policies.length) { subheading('Pólizas y seguros'); table(['Tipo', 'Aseguradora', 'Póliza', 'Monto', 'Vencimiento', 'Endoso'], policies.map(item => [item.type, item.insurer, item.policyNumber, fmtMoney(item.insuredAmount, currency), fmtDate(item.expiryDate), item.endorsedToBank ? 'Sí' : 'No']), [.7, 1.2, 1, 1.1, 1, .6]); }
  const documents = compliance.documents || [];
  const contracts = documents.filter(item => /contrato|promesa|cesi[oó]n/i.test(`${item.title} ${item.category}`));
  const plans = documents.filter(item => /plano|anteproyecto|cronograma|presupuesto/i.test(`${item.title} ${item.category}`));
  if (contracts.length) { subheading('Contratos y documentos contractuales'); table(['Documento', 'Categoría', 'Estado', 'Fecha'], contracts.map(item => [item.title, [item.category, item.folder].filter(Boolean).join(' / '), label(item.status), fmtDate(item.createdAt)]), [3, 1.3, .8, 1]); }
  if (plans.length) { subheading('Planos, estudios y presupuesto'); table(['Documento', 'Categoría', 'Estado', 'Fecha'], plans.map(item => [item.title, [item.category, item.folder].filter(Boolean).join(' / '), label(item.status), fmtDate(item.createdAt)]), [3, 1.3, .8, 1]); }
  const otherRelevant = documents.filter(item => !contracts.includes(item) && !plans.includes(item) && (item.category || item.folder || item.expiryDate));
  if (otherRelevant.length) { subheading('Otra documentación vigente'); table(['Documento', 'Categoría / carpeta', 'Estado', 'Vencimiento'], otherRelevant.map(item => [item.title, [item.category, item.folder, item.subfolder].filter(Boolean).join(' / '), label(item.status), fmtDate(item.expiryDate)]), [2.7, 1.6, .8, 1]); }

  heading('Avance anterior, periodo y acumulado');
  progress('Avance general', physical.previousPercent, physical.currentPercent, visit.scheduleAssessment?.plannedProgressPercent);
  const fronts = ctx.workFronts || [];
  const hierarchicalReport = Number(ctx.schemaVersion || 1) >= 3;
  const physicalFronts = hierarchicalReport ? fronts.filter(front => front.sourceType === 'folder') : [];
  const principalFronts = fronts.filter(front => front.sourceType !== 'common_area' && (!hierarchicalReport || front.sourceType !== 'folder'));
  const inventoryUnitById = new Map((ctx.inventory?.units || []).map(item => [String(item.id || item._id || ''), item]));
  for (const front of physicalFronts) {
    subheading(front.name);
    progress('Avance de la agrupacion', front.previousPercent, front.currentPercent, front.plannedPercent);
    if (front.observation) paragraph(front.observation);
    const groupedUnits = (ctx.unitProgressComparisons || []).filter(item => {
      const unit = inventoryUnitById.get(String(item.unitId));
      return String(front.sourceId) === 'unassigned' ? !unit?.folderId : String(unit?.folderId || '') === String(front.sourceId);
    });
    if (groupedUnits.length) table(['Unidad', 'Modelo', 'Anterior', 'Periodo', 'Acumulado'], groupedUnits.map(item => [item.reference?.code || [item.reference?.manzana, item.reference?.lote].filter(Boolean).join('-'), item.reference?.modelo, pct(item.previousPercent), delta(item.periodIncrementPercent), pct(item.currentPercent)]), [1.3, 1.3, .9, .9, .9]);
  }
  if (principalFronts.length) table(['Frente', 'Estado', 'Anterior', 'Periodo', 'Actual', 'Previsto', 'Observación'], principalFronts.map(front => [front.name, label(front.status), pct(front.previousPercent), delta(front.periodIncrementPercent), pct(front.currentPercent), pct(front.plannedPercent), front.observation]), [1.5, .8, .7, .7, .7, .7, 2]);
  const areaRows = fronts.filter(front => front.sourceType === 'common_area');
  if (areaRows.length) { subheading('Zonas comunes'); table(['Zona', 'Anterior', 'Periodo', 'Actual', 'Observación'], areaRows.map(area => [area.name, pct(area.previousPercent), delta(area.periodIncrementPercent), pct(area.currentPercent), area.observation]), [1.5, .7, .7, .7, 2.5]); }
  const unitRows = physicalFronts.length ? [] : (ctx.unitProgressComparisons || []);
  if (unitRows.length) { subheading('Unidades inspeccionadas'); table(['Unidad', 'Modelo', 'Anterior', 'Periodo', 'Acumulado'], unitRows.map(item => [item.reference?.code || [item.reference?.manzana, item.reference?.lote].filter(Boolean).join('-'), item.reference?.modelo, pct(item.previousPercent), delta(item.periodIncrementPercent), pct(item.currentPercent)]), [1.3, 1.3, .9, .9, .9]); }

  heading('Cambios, incidencias y riesgos');
  const incidentFolderNames = new Map((ctx.inventory?.folders || []).map(item => [String(item.id || item._id || ''), item.name]));
  const incidentUnitNames = new Map((ctx.inventory?.units || []).map(item => [String(item.id || item._id || ''), item.code || [item.manzana, item.lote].filter(Boolean).join('-')]));
  const incidentAreaNames = new Map((inspection.commonAreas || []).map(item => [String(item.key), item.name]));
  const incidentLocation = item => {
    if (item.scopeType === 'unit') return `Unidad: ${incidentUnitNames.get(String(item.scopeId)) || item.location || item.scopeId}`;
    if (item.scopeType === 'folder') return `Agrupacion: ${incidentFolderNames.get(String(item.scopeId)) || item.location || item.scopeId}`;
    if (item.scopeType === 'common_area') return `Zona comun: ${incidentAreaNames.get(String(item.scopeId)) || item.location || item.scopeId}`;
    if (item.workFrontKey) return `Frente historico: ${item.location || item.workFrontKey}`;
    return item.location || 'Global del proyecto';
  };
  const incidents = (visit.incidents || []).map(item => ({
    ...item,
    title: `${incidentLocation(item)}\n${item.title}`
  }));
  if (incidents.length) table(['Tipo', 'Severidad', 'Estado', 'Hallazgo', 'Impacto / acción'], incidents.map(item => [label(item.type), label(item.severity), label(item.status), `${item.title}${item.description ? `\n${item.description}` : ''}`, [item.impactSchedule && 'Plazo', item.impactCost && 'Coste', item.impactQuality && 'Calidad', item.actionRequired].filter(Boolean).join(' · ')]), [.8, .7, .7, 2.4, 1.6]);
  else paragraph('No se registraron incidencias durante la visita.', { muted: true });
  const activity = ctx.activitySincePreviousInspection || {};
  const activityEvents = activity.events || [];
  if (activityEvents.length) {
    subheading('Actividad Bank73 desde la inspección anterior');
    table(['Fecha', 'Actividad', 'Detalle', 'Importe'], activityEvents.slice(0, 40).map(item => [fmtDate(item.date), item.type, item.detail, item.amount ? fmtMoney(item.amount, currency) : '']), [1, 1.5, 2.4, 1]);
  }

  heading('Control de calidad y aspectos ambientales');
  const qualityAssessment = visit.qualityAssessment || {};
  const environmentalAssessment = visit.environmentalAssessment || {};
  subheading('Calidad');
  keyValues([['Resultado', label(qualityAssessment.status)], ['Elementos revisados', (qualityAssessment.checks || []).map(label).join(', ')]]);
  paragraph(qualityAssessment.observations || visit.qualityObservations || 'No se registraron observaciones específicas de calidad.', { muted: !(qualityAssessment.observations || visit.qualityObservations) });
  subheading('Medioambiente');
  keyValues([['Resultado', label(environmentalAssessment.status)], ['Aspectos revisados', (environmentalAssessment.checks || []).map(label).join(', ')]]);
  paragraph(environmentalAssessment.observations || visit.environmentalObservations || 'No se registraron observaciones ambientales específicas.', { muted: !(environmentalAssessment.observations || visit.environmentalObservations) });

  heading('Conclusión, recomendación y firma');
  paragraph(visit.conclusion || 'Sin conclusión adicional.', { muted: !visit.conclusion });
  const verdicts = { favorable: 'Favorable al desembolso', conditional: 'Favorable con condiciones', unfavorable: 'Desfavorable al desembolso', not_assessed: 'Sin pronunciamiento' };
  keyValues([['Recomendación técnica', verdicts[visit.recommendation?.verdict] || verdicts.not_assessed], ['Condiciones', visit.recommendation?.conditions ?? visit.recommendation?.notes]]);
  paragraph('La recomendación es técnica. La decisión y autorización del desembolso corresponde exclusivamente al banco.', { muted: true, size: 8 });
  const signatureData = String(ctx.signature?.imageData || '').split(',')[1];
  if (signatureData) { try { const y = doc.y; doc.image(Buffer.from(signatureData, 'base64'), MARGIN, y, { fit: [240, 85] }); doc.y = y + 92; } catch (_) {} }
  keyValues([
    ['Avaluador', ctx.signature?.signerName],
    ['Título profesional', ctx.evaluator?.professional?.title],
    ['Idoneidad / licencia', ctx.evaluator?.professional?.licenseNumber],
    ['Empresa', ctx.evaluator?.professional?.company],
    ['Correo', ctx.evaluator?.email],
    ['Firmado', fmtDate(ctx.signature?.signedAt)], ['Informe', inspection.reportNumber], ['Snapshot', `Esquema ${ctx.schemaVersion || 1} · ${fmtDate(ctx.audit?.snapshotCapturedAt)}`]
  ]);

  doc.addPage(); heading('Anexo económico', false);
  const financialComparison = ctx.metrics?.financialComparison || {};
  const comparisonRows = [
    ['Desembolsado', financialComparison.totalDisbursed],
    ['Amortizado', financialComparison.totalAmortized],
    ['Saldo de deuda', financialComparison.currentDebtBalance],
    ['Aporte promotor', financialComparison.promoterContribution]
  ].filter(([, values]) => values && (values.previous != null || values.accumulated != null));
  if (comparisonRows.length) {
    subheading('Resumen anterior, periodo y acumulado');
    table(['Concepto', 'Anterior', 'Periodo', 'Acumulado'], comparisonRows.map(([name, values]) => [name, values.previous == null ? null : fmtMoney(values.previous, currency), values.period == null ? null : fmtMoney(values.period, currency), values.accumulated == null ? null : fmtMoney(values.accumulated, currency)]), [1.8, 1, 1, 1]);
  }
  const lines = finance.loanLines || [];
  if (lines.length) table(['Línea', 'Desembolsado', 'Amortizado', 'Recuperado', 'Saldo', 'Estado'], lines.map(line => [line.name, fmtMoney(line.disbursementAmount, currency), fmtMoney(line.amortizedAmount, currency), fmtMoney(line.totalRecovered, currency), fmtMoney(line.balanceAfterSales ?? line.balance, currency), label(line.status)]), [1.5, 1, 1, 1, 1, .8]);
  const amortizations = finance.unitAmortizations || [];
  if (amortizations.length) table(['Unidad / cliente', 'Cheque', 'Distribuido', 'Promotor', 'Diferencia'], amortizations.map(item => [item.lot || item.clientName, fmtMoney(item.checkAmount, currency), fmtMoney(item.allocationsTotal || num(item.amortizationLine1) + num(item.amortizationLine2), currency), fmtMoney(item.promoterAmount, currency), fmtMoney(item.difference, currency)]), [2, 1, 1, 1, 1]);
  const phaseEconomics = finance.phases || [];
  if (phaseEconomics.length) table(['Fase', 'Desembolso previsto', 'Desembolso real', 'Usos previstos', 'Usos reales'], phaseEconomics.map(item => [item.name, fmtMoney(item.expectedDisbursement, currency), fmtMoney(item.actualDisbursement, currency), fmtMoney((item.plannedUses || []).reduce((sum, use) => sum + num(use.amount), 0), currency), fmtMoney((item.actualUses || []).reduce((sum, use) => sum + num(use.amount), 0), currency)]), [1.5, 1, 1, 1, 1]);
  const phaseUseRows = phaseEconomics.flatMap(phase => {
    const actualByName = new Map((phase.actualUses || []).map(use => [String(use.name || '').trim().toLowerCase(), use]));
    const plannedNames = new Set();
    const rows = (phase.plannedUses || []).map(use => {
      const key = String(use.name || '').trim().toLowerCase(); plannedNames.add(key);
      return [phase.name, use.name, fmtMoney(use.amount, currency), fmtMoney(actualByName.get(key)?.amount, currency)];
    });
    for (const use of phase.actualUses || []) {
      if (!plannedNames.has(String(use.name || '').trim().toLowerCase())) rows.push([phase.name, use.name, null, fmtMoney(use.amount, currency)]);
    }
    return rows;
  });
  if (phaseUseRows.length) { subheading('Partidas y usos por fase'); table(['Fase', 'Partida / uso', 'Previsto', 'Real'], phaseUseRows, [1, 2.4, 1, 1]); }
  if (!lines.length && !amortizations.length) paragraph('No hay desglose adicional de líneas o amortizaciones.', { muted: true });

  doc.addPage(); heading('Anexo fotográfico', false);
  const photos = ctx.photos || [];
  if (!photos.length) paragraph('No se adjuntaron fotografías a la inspección.', { muted: true });
  const frontNames = new Map((ctx.workFronts || []).map(front => [String(front.key), front.name]));
  const incidentNames = new Map((visit.incidents || []).map(item => [String(item._id || item.id || ''), item.title]));
  const areaNames = new Map((inspection.commonAreas || []).map(area => [String(area.key), area.name]));
  const unitNames = new Map((ctx.inspectionUnits || []).map(unit => [String(unit.unitId), unit.unitReferenceSnapshot?.code || [unit.unitReferenceSnapshot?.manzana, unit.unitReferenceSnapshot?.lote].filter(Boolean).join('-')]));
  const photoGroup = item => {
    if (item.incidentId) return `Incidencia · ${incidentNames.get(String(item.incidentId)) || 'Hallazgo'}`;
    if (item.workFrontKey) return `Frente · ${frontNames.get(String(item.workFrontKey)) || item.workFrontKey}`;
    if (item.commonAreaKey) return `Zona · ${areaNames.get(String(item.commonAreaKey)) || item.commonAreaKey}`;
    if (item.unitId) return `Unidad · ${unitNames.get(String(item.unitId)) || item.unitId}`;
    return label(item.category === 'general' ? 'Evidencia general' : item.category);
  };
  const groupedPhotos = new Map();
  for (const item of photos) {
    const group = photoGroup(item);
    if (!groupedPhotos.has(group)) groupedPhotos.set(group, []);
    groupedPhotos.get(group).push(item);
  }
  const gap = 10;
  const photoWidth = (width - gap) / 2;
  const photoHeight = 218;
  for (const [group, items] of groupedPhotos) {
    ensure(42);
    subheading(group);
    let column = 0;
    let rowY = doc.y;
    for (const item of items) {
      if (column === 0 && rowY + photoHeight > doc.page.height - 48) {
        doc.addPage();
        subheading(`${group} · continuación`);
        rowY = doc.y;
      }
      const x = MARGIN + column * (photoWidth + gap);
      doc.save().roundedRect(x, rowY, photoWidth, photoHeight - 6, 4).fill('#F8FAFC').strokeColor(C.border).stroke().restore();
      const absolute = path.resolve(__dirname, '..', String(item.path || ''));
      const relative = path.relative(PHOTO_ROOT, absolute);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        try {
          await fs.promises.access(absolute, fs.constants.R_OK);
          doc.image(absolute, x + 6, rowY + 6, { fit: [photoWidth - 12, 154], align: 'center', valign: 'center' });
        } catch (_) {
          doc.font('Helvetica').fontSize(8).fillColor(C.muted).text('Fotografía no disponible', x + 8, rowY + 70, { width: photoWidth - 16, align: 'center' });
        }
      }
      doc.font('Helvetica').fontSize(7.4).fillColor(C.muted).text(fmtDate(item.createdAt), x + 7, rowY + 164, { width: photoWidth - 14 });
      doc.font('Helvetica').fontSize(8).fillColor(C.navy).text(item.caption || 'Evidencia de inspección', x + 7, rowY + 177, { width: photoWidth - 14, lineGap: 1 });
      column += 1;
      if (column === 2) {
        column = 0;
        rowY += photoHeight;
        doc.y = rowY;
      }
    }
    if (column !== 0) doc.y = rowY + photoHeight;
    doc.y += 8;
  }

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    doc.switchToPage(index); const oldBottom = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(`${inspection.reportNumber || 'Borrador'} | BANK73 | Informe confidencial`, MARGIN, doc.page.height - 28, { width: width * .72, lineBreak: false });
    doc.text(`${index + 1} / ${range.count}`, doc.page.width - MARGIN - 72, doc.page.height - 28, { width: 72, align: 'right', lineBreak: false }); doc.page.margins.bottom = oldBottom;
  }
}

module.exports = { renderInspectionReport };
