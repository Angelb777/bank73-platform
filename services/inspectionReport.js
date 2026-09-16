const fs = require('fs');
const path = require('path');

const BLUE = '#123B6D';
const DARK = '#172033';
const MUTED = '#647089';
const percent = value => `${Number(value || 0).toFixed(1)} %`;
const unitLabel = unit => {
  const ref = unit.unitReferenceSnapshot || {};
  return ref.code || [ref.manzana, ref.lote].filter(Boolean).join('-') || 'Unidad';
};

async function renderInspectionReport(doc, { project, inspection, units, evidence }) {
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
    doc.font('Helvetica-Bold').fontSize(17).fillColor(DARK).text('Informe de inspecci\u00f3n', margin, 45, { width });
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
  const text = (value, muted = false) => {
    doc.font('Helvetica').fontSize(10).fillColor(muted ? MUTED : DARK).text(String(value), margin, doc.y, { width, paragraphGap: 5 });
  };
  const progress = (label, value) => {
    ensure(48);
    text(`${label}: ${percent(value)}`);
    const y = doc.y + 3;
    doc.save().roundedRect(margin, y, width, 6, 3).fill('#E2E8F0');
    const filled = width * Math.min(100, Math.max(0, Number(value || 0))) / 100;
    if (filled > 0) doc.rect(margin, y, filled, 6).fill(BLUE);
    doc.restore();
    doc.y = y + 18;
  };
  const photos = async (items, label) => {
    for (const item of items) {
      const absolute = path.resolve(__dirname, '..', item.path || '');
      const relative = path.relative(photoRoot, absolute);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
      const caption = item.caption || 'Evidencia de inspecci\u00f3n';
      doc.font('Helvetica').fontSize(9);
      const captionHeight = doc.heightOfString(caption, { width });
      if (doc.y + 230 + captionHeight + 25 > doc.page.height - 65) {
        doc.addPage();
        section(`${label} | Fotograf\u00edas`);
      }
      const y = doc.y;
      try {
        await fs.promises.access(absolute, fs.constants.R_OK);
        doc.image(absolute, margin, y, { fit: [width, 230], align: 'center', valign: 'center' });
        doc.y = y + 238;
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(caption, margin, doc.y, { width, align: 'center' });
        doc.y += 16;
      } catch (_) {
        text(`Fotograf\u00eda no disponible: ${caption}`, true);
      }
    }
  };

  const average = units.length ? units.reduce((sum, unit) => sum + Number(unit.progressPercent || 0), 0) / units.length : 0;
  const metrics = [
    ['Avance general de la obra', percent(inspection.projectProgressPercent)],
    ['Promedio de unidades revisadas', percent(average)],
    ['Unidades inspeccionadas', String(units.length)],
    ['Evidencias fotogr\u00e1ficas', String(evidence.length)]
  ];
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
  section('Datos generales de la visita');
  text(`Fecha de inspecci\u00f3n: ${date(inspection.inspectionDate)}`);
  text(`Avaluador: ${inspection.signature?.signerName || '-'}`);
  text(`Informe finalizado: ${date(inspection.finalizedAt)}`);
  if (project.description) text(project.description, true);
  if (inspection.generalObservations) {
    section('Observaciones generales');
    text(inspection.generalObservations);
  }
  section('Avance general y zonas comunes');
  progress('Avance de la obra seg\u00fan avaluador', inspection.projectProgressPercent);
  const used = new Set();
  for (const area of inspection.commonAreas || []) {
    const items = evidence.filter(item => !item.unitId && item.commonAreaKey === area.key);
    if (items.length) ensure(400);
    section(area.name);
    progress(`Avance (peso ${percent(area.weight)})`, area.progressPercent);
    if (area.observations) text(area.observations);
    items.forEach(item => used.add(item));
    await photos(items, area.name);
  }
  doc.addPage();
  section('Unidades de la visita');
  if (!units.length) text('No se registraron unidades en esta visita.', true);
  const ordered = [...units].sort((a, b) => unitLabel(a).localeCompare(unitLabel(b), 'es', { numeric: true }));
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
  const remaining = evidence.filter(item => !used.has(item));
  if (remaining.length) { section('Otras evidencias de la visita'); await photos(remaining, 'Otras evidencias'); }
  section('Recomendaci\u00f3n t\u00e9cnica del avaluador');
  const recommendation = inspection.technicalRecommendation;
  const verdictLabels = {
    favorable: 'Favorable al desembolso',
    conditional: 'Favorable con condiciones',
    unfavorable: 'Desfavorable al desembolso',
    not_assessed: 'Sin pronunciamiento'
  };
  text(verdictLabels[recommendation?.verdict] || verdictLabels.not_assessed);
  if (recommendation?.notes) text(recommendation.notes);
  text('Esta recomendaci\u00f3n es t\u00e9cnica. La decisi\u00f3n y autorizaci\u00f3n del desembolso corresponden al banco.', true);
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
