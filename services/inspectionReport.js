const fs = require('fs');
const path = require('path');

const BLUE = '#123B6D';
const DARK = '#172033';
const MUTED = '#647089';
const GREEN = '#0F7B4E';
const percent = value => `${Number(value || 0).toFixed(1)} %`;
const unitLabel = unit => {
  const ref = unit.unitReferenceSnapshot || {};
  return ref.code || [ref.manzana, ref.lote].filter(Boolean).join('-') || 'Unidad';
};
const UNASSIGNED_FOLDER_KEY = '__sin_torre__';

async function renderInspectionReport(doc, {
  project,
  inspection,
  units,
  evidence,
  folders = [],
  unitFolderById = new Map(),
  previousInspection = null
}) {
  const margin = 48;
  const width = doc.page.width - margin * 2;
  const logo = path.join(__dirname, '..', 'assets', 'Bank73logoblanco.png');
  const photoRoot = path.resolve(__dirname, '..', 'uploads', 'inspections');
  const date = value => value ? new Date(value).toLocaleDateString('es-ES', { timeZone: 'America/Panama' }) : '-';
  const header = () => {
    doc.page.margins.top = 110;
    doc.save().rect(0, 0, doc.page.width, 30).fill(BLUE).restore();
    if (fs.existsSync(logo)) doc.image(logo, doc.page.width - margin - 78, 7, { fit: [78, 18] });
    else doc.font('Helvetica-Bold').fontSize(10).fillColor('white').text('BANK73', margin, 9, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(17).fillColor(DARK).text('Informe de inspección de obra', margin, 45, { width });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`${project.name || 'Proyecto'} | ${inspection.reportNumber}`, margin, 70, { width, height: 14, ellipsis: true });
    doc.save().moveTo(margin, 94).lineTo(margin + width, 94).strokeColor('#D1D5DB').stroke().restore();
    doc.x = margin;
    doc.y = 110;
  };
  doc.on('pageAdded', header);
  header();
  const ensure = height => { if (doc.y + height > doc.page.height - 65) doc.addPage(); };
  const section = title => {
    ensure(55);
    const y = doc.y + 10;
    doc.save().roundedRect(margin, y, width, 30, 6).fill('#EAF2FB').restore();
    doc.font('Helvetica-Bold').fontSize(12).fillColor(BLUE).text(title, margin + 12, y + 9, { width: width - 24 });
    doc.x = margin;
    doc.y = y + 42;
  };
  const subheading = title => {
    ensure(28);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(BLUE).text(title, margin, doc.y, { width });
    doc.y += 4;
  };
  const text = (value, muted = false) => {
    doc.font('Helvetica').fontSize(10).fillColor(muted ? MUTED : DARK).text(String(value), margin, doc.y, { width, paragraphGap: 5 });
  };
  const infoRow = (label, value) => {
    if (!value) return;
    ensure(18);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(MUTED).text(`${label}: `, margin, doc.y, { continued: true, width });
    doc.font('Helvetica').fontSize(9.5).fillColor(DARK).text(String(value));
    doc.y += 3;
  };
  const delta = (previousValue, currentValue) => {
    const diff = Number(currentValue || 0) - Number(previousValue || 0);
    const sign = diff > 0 ? '+' : '';
    return `${sign}${diff.toFixed(1)} pts`;
  };
  // Barra de avance con comparacion anterior -> actual cuando hay una
  // inspeccion finalizada previa del mismo proyecto/banco. Sin inspeccion
  // anterior, se comporta igual que antes (solo el valor actual).
  const progress = (label, value, previousValue) => {
    ensure(48);
    if (previousValue !== undefined && previousValue !== null) {
      text(`${label}: ${percent(previousValue)} (anterior) -> ${percent(value)} (actual) · ${delta(previousValue, value)}`);
    } else {
      text(`${label}: ${percent(value)}`);
    }
    const y = doc.y + 3;
    doc.save().roundedRect(margin, y, width, 6, 3).fill('#E2E8F0');
    const filled = width * Math.min(100, Math.max(0, Number(value || 0))) / 100;
    if (filled > 0) doc.rect(margin, y, filled, 6).fill(BLUE);
    if (previousValue !== undefined && previousValue !== null) {
      const markerX = margin + width * Math.min(100, Math.max(0, Number(previousValue || 0))) / 100;
      doc.rect(Math.max(margin, markerX - 1), y - 2, 2, 10).fill(GREEN);
    }
    doc.restore();
    doc.y = y + 18;
  };
  const photos = async (items, label) => {
    for (const item of items) {
      const absolute = path.resolve(__dirname, '..', item.path || '');
      const relative = path.relative(photoRoot, absolute);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
      const caption = item.caption || 'Evidencia de inspección';
      doc.font('Helvetica').fontSize(9);
      const captionHeight = doc.heightOfString(caption, { width });
      if (doc.y + 230 + captionHeight + 25 > doc.page.height - 65) {
        doc.addPage();
        section(`${label} | Fotografías`);
      }
      const y = doc.y;
      try {
        await fs.promises.access(absolute, fs.constants.R_OK);
        doc.image(absolute, margin, y, { fit: [width, 230], align: 'center', valign: 'center' });
        doc.y = y + 238;
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(caption, margin, doc.y, { width, align: 'center' });
        doc.y += 16;
      } catch (_) {
        text(`Fotografía no disponible: ${caption}`, true);
      }
    }
  };

  // ---------------------------------------------------------------
  // Portada: datos generales del proyecto (todo de solo lectura, ya
  // existente en Bank73 - el avaluador no introduce nada de esto).
  // ---------------------------------------------------------------
  section('Datos generales del proyecto');
  infoRow('Proyecto', project.name);
  const location = [project.address, project.city, project.province].filter(Boolean).join(', ') || project.location;
  infoRow('Ubicación', location);
  infoRow('Tipo de proyecto', project.projectType);
  infoRow('Promotor', project.legalData?.promoterLegalName);
  infoRow('Número de informe', inspection.reportNumber);
  infoRow('Fecha de inspección', date(inspection.inspectionDate));
  if (previousInspection) {
    infoRow('Inspección anterior comparada', `${date(previousInspection.inspectionDate)} (${previousInspection.reportNumber})`);
  }
  doc.y += 6;

  const average = units.length ? units.reduce((sum, unit) => sum + Number(unit.progressPercent || 0), 0) / units.length : 0;
  const metrics = [
    ['Avance general de la obra', percent(inspection.projectProgressPercent)],
    ['Promedio de unidades revisadas', percent(average)],
    ['Unidades inspeccionadas', String(units.length)],
    ['Evidencias fotográficas', String(evidence.length)]
  ];
  ensure(160);
  const startY = doc.y;
  metrics.forEach(([label, value], index) => {
    const cardWidth = (width - 12) / 2;
    const x = margin + index % 2 * (cardWidth + 12);
    const y = startY + Math.floor(index / 2) * 76;
    doc.save().roundedRect(x, y, cardWidth, 64, 8).fill('#F1F5F9').restore();
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(label, x + 12, y + 12, { width: cardWidth - 24 });
    doc.font('Helvetica-Bold').fontSize(20).fillColor(BLUE).text(value, x + 12, y + 31, { width: cardWidth - 24 });
  });
  doc.y = startY + 160;

  if (inspection.generalObservations) {
    section('Observaciones generales');
    text(inspection.generalObservations);
  }

  // ---------------------------------------------------------------
  // Avance general y zonas comunes, comparado con la inspeccion
  // anterior finalizada cuando existe.
  // ---------------------------------------------------------------
  section('Avance general y zonas comunes');
  progress('Avance de la obra según avaluador', inspection.projectProgressPercent, previousInspection?.projectProgressPercent);
  const previousAreaByKey = new Map((previousInspection?.commonAreas || []).map(area => [area.key, area.progressPercent]));
  const used = new Set();
  for (const area of inspection.commonAreas || []) {
    const items = evidence.filter(item => !item.unitId && item.commonAreaKey === area.key);
    if (items.length) ensure(400);
    section(area.name);
    progress(`Avance (peso ${percent(area.weight)})`, area.progressPercent, previousAreaByKey.get(area.key));
    if (area.observations) text(area.observations);
    items.forEach(item => used.add(item));
    await photos(items, area.name);
  }

  // ---------------------------------------------------------------
  // Unidades de la visita, agrupadas por Torre/Etapa (carpeta comercial
  // existente). Reutiliza CommercialFolder tal cual: no es una entidad
  // nueva, solo estructura el informe igual que ya se agrupan en la app.
  // ---------------------------------------------------------------
  doc.addPage();
  section('Unidades de la visita, por Torre/Etapa');
  if (!units.length) text('No se registraron unidades en esta visita.', true);
  const unitsByFolder = new Map();
  for (const unit of units) {
    const folderId = unitFolderById.get(String(unit.unitId)) || null;
    const key = folderId && folders.some(f => String(f._id) === folderId) ? folderId : UNASSIGNED_FOLDER_KEY;
    if (!unitsByFolder.has(key)) unitsByFolder.set(key, []);
    unitsByFolder.get(key).push(unit);
  }
  const orderedFolderKeys = [
    ...folders.map(f => String(f._id)).filter(id => unitsByFolder.has(id)),
    ...(unitsByFolder.has(UNASSIGNED_FOLDER_KEY) ? [UNASSIGNED_FOLDER_KEY] : [])
  ];
  for (const folderKey of orderedFolderKeys) {
    const folderName = folderKey === UNASSIGNED_FOLDER_KEY
      ? 'Sin torre/etapa asignada'
      : folders.find(f => String(f._id) === folderKey)?.name || 'Torre/Etapa';
    ensure(30);
    subheading(folderName);
    const ordered = [...unitsByFolder.get(folderKey)].sort((a, b) => unitLabel(a).localeCompare(unitLabel(b), 'es', { numeric: true }));
    for (const unit of ordered) {
      const items = evidence.filter(item => String(item.unitId || '') === String(unit.unitId));
      if (items.length) ensure(400);
      section(unitLabel(unit));
      const ref = unit.unitReferenceSnapshot || {};
      text([ref.manzana && `Manzana ${ref.manzana}`, ref.lote && `Lote ${ref.lote}`, ref.modelo && `Modelo ${ref.modelo}`].filter(Boolean).join(' | '), true);
      progress('Avance de la unidad', unit.progressPercent);
      for (const entry of unit.progressSections || []) text(`${entry.name}: ${percent(entry.progressPercent)} (peso ${percent(entry.weight)})`, true);
      if (unit.observations) text(unit.observations);
      items.forEach(item => used.add(item));
      await photos(items, unitLabel(unit));
    }
  }
  const remaining = evidence.filter(item => !used.has(item));
  if (remaining.length) { section('Otras evidencias de la visita'); await photos(remaining, 'Otras evidencias'); }
  section('Recomendación técnica del avaluador');
  const recommendation = inspection.technicalRecommendation;
  const verdictLabels = {
    favorable: 'Favorable al desembolso',
    conditional: 'Favorable con condiciones',
    unfavorable: 'Desfavorable al desembolso',
    not_assessed: 'Sin pronunciamiento'
  };
  text(verdictLabels[recommendation?.verdict] || verdictLabels.not_assessed);
  if (recommendation?.notes) text(recommendation.notes);
  text('Esta recomendación es técnica. La decisión y autorización del desembolso corresponden al banco.', true);
  ensure(190);
  section('Firma del avaluador');
  const signature = String(inspection.signature?.imageData || '').split(',')[1];
  if (signature) {
    const y = doc.y;
    doc.image(Buffer.from(signature, 'base64'), margin, y, { fit: [250, 90] });
    doc.y = y + 100;
  }
  text(inspection.signature?.signerName || '');
  text(`Firmado el ${date(inspection.signature?.signedAt)}`, true);

  const pages = doc.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index++) {
    doc.switchToPage(index);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`${inspection.reportNumber} | BANK73`, margin, doc.page.height - 35, { width: width / 2, lineBreak: false });
    doc.text(`${index + 1} / ${pages.count}`, margin + width / 2, doc.page.height - 35, { width: width / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

module.exports = { renderInspectionReport };
