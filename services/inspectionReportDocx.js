'use strict';

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const PHOTO_ROOT = path.resolve(__dirname, '..', 'uploads', 'inspections');
const CERTIFICATION_TEXT = 'Certificamos que este informe es el producto de la inspección de la obra en la fecha indicada, y su elaboración ha sido de manera objetiva de acuerdo al avance de la obra y a la documentación suministrada por el Promotor y verificada por nosotros. Asimismo, certificamos que nuestra escogencia como inspectores y la aceptación de nuestros honorarios no han influido de ninguna manera en la elaboración de este informe, y por lo tanto todos los datos suministrados son correctos y veraces según nuestro más leal saber y entender.';
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const dash = value => value === null || value === undefined || value === '' ? '—' : String(value);
const pct = value => value === null || value === undefined ? '—' : `${num(value).toFixed(1)} %`;
const fmtDate = value => value ? new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Panama' }).format(new Date(value)) : '—';
const fmtMoney = (value, currency) => new Intl.NumberFormat('es-PA', { style: 'currency', currency: currency || 'PAB', maximumFractionDigits: 2 }).format(num(value));
const yesNoUnknown = value => value === true ? 'Sí' : value === false ? 'No' : 'No verificable';
const labels = {
  CUMPLIDO: 'Cumplido', PENDIENTE: 'Pendiente', approved: 'Aprobado', pending: 'Pendiente', active: 'Activo', expired: 'Vencido',
  conforming: 'Conforme', observations_required: 'Con observaciones', non_conforming: 'No conforme', not_assessed: 'No verificable',
  open: 'Abierta', monitoring: 'En seguimiento', resolved: 'Resuelta', low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica',
  change: 'Cambio', delay: 'Retraso', defect: 'Defecto', quality: 'Calidad', environment: 'Medioambiente', risk: 'Riesgo', other: 'Otra',
  yes: 'Sí', no: 'No', not_verifiable: 'No verificable'
};
const label = value => labels[value] || dash(value);
const xml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function paragraph(text = '', { style, bold = false, italic = false, color, align, before = 0, after = 120, pageBreak = false } = {}) {
  const pPr = [style ? `<w:pStyle w:val="${style}"/>` : '', align ? `<w:jc w:val="${align}"/>` : '', `<w:spacing w:before="${before}" w:after="${after}" w:line="264" w:lineRule="auto"/>`].join('');
  const runProps = [bold ? '<w:b/>' : '', italic ? '<w:i/>' : '', color ? `<w:color w:val="${color}"/>` : ''].join('');
  return `<w:p><w:pPr>${pPr}</w:pPr>${pageBreak ? '<w:r><w:br w:type="page"/></w:r>' : ''}<w:r><w:rPr>${runProps}</w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
}

function heading(text, level = 1) {
  return paragraph(text, { style: `Heading${Math.min(3, level)}`, before: level === 1 ? 320 : 220, after: level === 1 ? 160 : 120 });
}

function table(headers, rows, ratios = []) {
  if (!rows.length) return '';
  const total = ratios.length ? ratios.reduce((sum, value) => sum + value, 0) : headers.length;
  const widths = headers.map((_, index) => Math.round(9360 * (ratios[index] || 1) / total));
  const row = (cells, header = false) => `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.map((cell, index) => `<w:tc><w:tcPr><w:tcW w:w="${widths[index]}" w:type="dxa"/><w:shd w:fill="${header ? 'E8EEF5' : 'FFFFFF'}"/><w:vAlign w:val="center"/></w:tcPr>${paragraph(dash(cell), { bold: header, after: 40 })}</w:tc>`).join('')}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D7DEE8"/><w:left w:val="single" w:sz="4" w:color="D7DEE8"/><w:bottom w:val="single" w:sz="4" w:color="D7DEE8"/><w:right w:val="single" w:sz="4" w:color="D7DEE8"/><w:insideH w:val="single" w:sz="4" w:color="D7DEE8"/><w:insideV w:val="single" w:sz="4" w:color="D7DEE8"/></w:tblBorders><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:start w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:end w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(width => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${row(headers, true)}${rows.map(cells => row(cells)).join('')}</w:tbl>${paragraph('', { after: 100 })}`;
}

function keyValues(rows) {
  const present = rows.filter(([, value]) => value !== null && value !== undefined && value !== '');
  return present.length ? table(['Dato', 'Información'], present, [1.8, 4.7]) : '';
}

function imageParagraph(relId, caption) {
  return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="160" w:after="80"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="5220000" cy="3429000"/><wp:docPr id="${relId.replace(/\D/g, '') || 1}" name="Fotografía de inspección" descr="${xml(caption || 'Evidencia de inspección')}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="Fotografía"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5220000" cy="3429000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>${paragraph(caption || 'Evidencia de inspección', { italic: true, color: '647089', align: 'center' })}`;
}

function signatureParagraph(relId) {
  return `<w:p><w:pPr><w:jc w:val="left"/><w:spacing w:before="120" w:after="80"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="2743200" cy="971550"/><wp:docPr id="9001" name="Firma del avaluador" descr="Firma certificada del avaluador"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="Firma"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="971550"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="172033"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="160"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="123B6D"/><w:sz w:val="48"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:color w:val="1F4D78"/><w:sz w:val="24"/></w:rPr></w:style></w:styles>`;
}

function buildInspectionReportDocx(context = {}) {
  const project = context.project || {};
  const inspection = context.inspection || {};
  const visit = context.visit || {};
  const details = visit.reportDetails || {};
  const compliance = context.compliance || {};
  const finance = context.finance || {};
  const currency = project.currency || 'PAB';
  const body = [];
  const relationships = [
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>',
    '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'
  ];
  const images = [];
  let photoImageCount = 0;

  body.push(paragraph('INFORME DE INSPECCIÓN DE OBRA', { style: 'Title', align: 'center', before: 900, after: 200 }));
  body.push(paragraph(project.name || '', { bold: true, color: '123B6D', align: 'center', after: 360 }));
  body.push(keyValues([
    ['Informe', inspection.reportNumber || `Inspección ${inspection.sequence || ''}`],
    ['Fecha de visita', fmtDate(inspection.inspectionDate)],
    ['Ubicación', [project.location?.address, project.location?.city, project.location?.province].filter(Boolean).join(', ') || project.location?.label],
    ['Promotor', context.participants?.promoter?.name],
    ['Banco', context.participants?.bank?.name],
    ['Avaluador', context.signature?.signerName || 'Pendiente de firma']
  ]));
  body.push(keyValues([
    ['Condiciones de desembolso', finance.financialConditions?.disbursementConditions],
    ['Condiciones de amortización', finance.financialConditions?.amortizationConditions],
    ['Garantías', finance.financialConditions?.guarantees],
    ['Seguro requerido', finance.financialConditions?.insurance],
    ['Plazo', finance.financialConditions?.term]
  ]));
  body.push(paragraph('', { pageBreak: true }));

  body.push(heading('Resumen ejecutivo'));
  body.push(keyValues([
    ['Avance anterior', pct(context.metrics?.physicalProgress?.previousPercent)],
    ['Avance del periodo', pct(context.metrics?.physicalProgress?.periodIncrementPercent)],
    ['Avance acumulado', pct(context.metrics?.physicalProgress?.currentPercent)],
    ['Avance financiero', pct(context.metrics?.financialProgress?.percent)],
    ['Fotografías', (context.photos || []).length]
  ]));
  if (visit.generalObservations) body.push(paragraph(visit.generalObservations));

  body.push(heading('Datos generales y participantes'));
  body.push(keyValues([
    ['Proyecto', project.name], ['Descripción general de la obra', details.projectDescription ?? project.description], ['Tipo', project.type],
    ['Agrupaciones físicas', (context.inventory?.folders || []).length], ['Unidades del proyecto', (context.inventory?.units || []).length],
    ['Promotor', context.participants?.promoter?.name], ['Banco', context.participants?.bank?.name]
  ]));

  body.push(heading('Modelos de vivienda y unidades'));
  const models = context.inventory?.models || [];
  body.push(models.length ? table(['Modelo', 'Recámaras', 'Baños', 'Área cerrada', 'Área abierta', 'Unidades'], models.map(item => [item.name, item.bedrooms, item.bathrooms, item.closedAreaM2, item.openAreaM2, item.unitsCount]), [2, .8, .7, 1, 1, .8]) : paragraph('No hay modelos estructurados en Bank73.'));

  body.push(heading('Presupuesto, financiación y resumen financiero'));
  const summary = finance.summary || {};
  body.push(keyValues([
    ['Presupuesto', fmtMoney(summary.budgetApproved, currency)], ['Financiamiento', fmtMoney(summary.loanApproved, currency)], ['Aporte promotor', fmtMoney(summary.promoterContribution, currency)],
    ['Desembolsado', fmtMoney(summary.totalDisbursed, currency)], ['Amortizado', fmtMoney(summary.totalAmortized, currency)], ['Saldo', fmtMoney(summary.currentDebtBalance, currency)]
  ]));
  const financingConditions = compliance.financingConditions || [];
  if (financingConditions.length) body.push(table(['Fase', 'Condición de financiamiento', 'Estado', 'Resumen'], financingConditions.map(item => [item.phaseName, item.title, label(item.status), item.information || item.observations]), [1, 2.3, .8, 2.4]));
  body.push(keyValues([['Ajustes de presupuesto desde la última inspección', yesNoUnknown(details.budgetAdjustments?.hasAdjustments)], ['Explicación', details.budgetAdjustments?.explanation]]));

  body.push(heading('Programa de obra y fases'));
  const phases = context.planning?.phases || [];
  if (phases.length) body.push(table(['Fase', 'Inicio previsto', 'Fin previsto', 'Inicio real', 'Fin real', 'Estado'], phases.map(item => [item.name, fmtDate(item.startDate), fmtDate(item.endDate), fmtDate(item.actualStartDate), fmtDate(item.actualEndDate), item.isCompleted ? 'Completada' : item.active ? 'Activa' : 'Programada']), [1.7, 1, 1, 1, 1, .9]));
  body.push(keyValues([['Inicio general del programa', fmtDate(context.planning?.summary?.startDate)], ['Finalización prevista', fmtDate(context.planning?.summary?.endDate)], ['Duración estimada', context.planning?.summary?.durationMonths == null ? null : `${context.planning.summary.durationMonths} meses (${context.planning.summary.durationDays} días)`]]));

  body.push(heading('Estudios, permisos, planos, contratos, pólizas y fianzas'));
  const permits = compliance.permits || [];
  if (permits.length) body.push(table(['Permiso / estudio', 'Institución', 'Estado', 'Emisión', 'Vencimiento'], permits.map(item => [item.title || item.code, item.institution, label(item.status), fmtDate(item.resolvedAt || item.submittedAt), fmtDate(item.dueDate)]), [2.4, 1.3, .8, 1, 1]));
  body.push(heading('Planos', 2));
  body.push(keyValues([['Planos aprobados correspondientes', label(details.plans?.status)], ['Observaciones', details.plans?.observations]]));
  const planRequirements = compliance.planRequirements || [];
  if (planRequirements.length) body.push(table(['Fase', 'Referencia', 'Estado', 'Información'], planRequirements.map(item => [item.phaseName, item.title, label(item.status), item.information || item.observations]), [1, 2.4, .8, 2.3]));
  body.push(heading('Contratos de obra / construcción', 2));
  const contracts = compliance.constructionContracts || [];
  if (contracts.length) body.push(table(['Fase', 'Contrato', 'Estado', 'Información'], contracts.map(item => [item.phaseName, item.title, label(item.status), item.information || item.observations]), [1, 2.2, .8, 2.5]));
  else body.push(paragraph('No hay contratos de obra identificados como requisito de construcción.'));
  body.push(keyValues([['Observaciones sobre contratos', details.contractsObservations]]));
  const policies = compliance.policies || [];
  if (policies.length) {
    body.push(heading('Pólizas y seguros', 2));
    const policyStatus = item => {
      const at = new Date(inspection.inspectionDate || context.generatedAt || Date.now());
      const start = item.startDate ? new Date(item.startDate) : null;
      const end = item.expiryDate ? new Date(item.expiryDate) : null;
      if (end && end < at) return 'Vencida';
      if (start && start > at) return 'No iniciada';
      return start || end ? 'Vigente' : 'No verificable';
    };
    for (const [index, item] of policies.entries()) {
      body.push(heading(`Póliza ${index + 1}: ${item.type || 'sin tipo indicado'}`, 3));
      body.push(keyValues([
        ['Tipo', item.type],
        ['Asegurado', item.insured || item.insuredName],
        ['Acreedor', item.bank],
        ['Aseguradora', item.insurer],
        ['Documento / número', [item.documentName, item.policyNumber].filter(Boolean).join(' / ')],
        ['Monto', fmtMoney(item.insuredAmount, currency)],
        ['Vigencia', `${fmtDate(item.startDate)} - ${fmtDate(item.expiryDate)}`],
        ['Estado', policyStatus(item)]
      ]));
    }
  }
  const bonds = compliance.bonds || [];
  if (bonds.length) {
    body.push(heading('Fianzas', 2));
    body.push(table(['Tipo', 'Fase', 'Emisor', 'Número', 'Monto', 'Vigencia', 'Estado'], bonds.map(item => [item.title, item.phaseName, item.structuredData?.issuer, item.structuredData?.bondNumber, fmtMoney(item.structuredData?.actualAmount || item.structuredData?.requiredAmount, currency), `${fmtDate(item.structuredData?.startDate)} - ${fmtDate(item.structuredData?.expiryDate)}`, item.structuredData?.validityStatus || label(item.status)]), [1.5, .8, 1, .8, 1, 1.2, .8]));
  }
  const documents = compliance.documents || [];
  const constructionDocumentIds = new Set(contracts.flatMap(item => item.documents || []).map(item => String(item.id)));
  const planDocuments = documents.filter(item => /plano|anteproyecto|cronograma|presupuesto/i.test(`${item.title || ''} ${item.category || ''}`));
  const otherRelevant = documents.filter(item => !constructionDocumentIds.has(String(item.id)) && !planDocuments.includes(item) && (item.category || item.folder || item.expiryDate));
  if (otherRelevant.length) {
    body.push(heading('Otra documentación vigente', 2));
    body.push(table(['Documento', 'Categoría / carpeta', 'Estado', 'Vencimiento'], otherRelevant.map(item => [item.title, [item.category, item.folder, item.subfolder].filter(Boolean).join(' / '), label(item.status), fmtDate(item.expiryDate)]), [2.7, 1.6, .8, 1]));
  }

  body.push(heading('Avance anterior, periodo y acumulado'));
  const folders = (context.workFronts || []).filter(item => item.sourceType === 'folder');
  if (folders.length) body.push(table(['Agrupación física', 'Unidades', 'Anterior', 'Periodo', 'Actual'], folders.map(item => [item.name, item.unitCount, pct(item.previousPercent), item.periodIncrementPercent == null ? '—' : `${num(item.periodIncrementPercent).toFixed(1)} pts`, pct(item.currentPercent)]), [2.4, .8, 1, 1, 1]));
  const areas = (context.workFronts || []).filter(item => item.sourceType === 'common_area');
  if (areas.length) body.push(table(['Zona común / infraestructura', 'Anterior', 'Actual', 'Observación'], areas.map(item => [item.name, pct(item.previousPercent), pct(item.currentPercent), item.observation]), [2.5, 1, 1, 2]));

  body.push(heading('Cambios, incidencias y riesgos'));
  const changes = details.workChanges || {};
  body.push(keyValues([['Cambios respecto a planos o alcance', yesNoUnknown(changes.hasChanges)], ['Descripción', changes.description], ['Impacto posible en presupuesto', changes.budgetImpact], ['Impacto posible en plazo', changes.scheduleImpact], ['Observaciones', changes.observations]]));
  const incidents = visit.incidents || [];
  if (incidents.length) body.push(table(['Tipo', 'Severidad', 'Estado', 'Hallazgo', 'Impacto / acción'], incidents.map(item => [label(item.type), label(item.severity), label(item.status), `${item.location || ''}\n${item.title}${item.description ? `\n${item.description}` : ''}`, [item.impactSchedule && 'Plazo', item.impactCost && 'Coste', item.impactQuality && 'Calidad', item.actionRequired].filter(Boolean).join(' · ')]), [.8, .8, .8, 2.3, 1.8]));
  else body.push(paragraph('No se registraron incidencias durante la visita.'));

  body.push(heading('Control de calidad y mitigación de riesgo ambiental'));
  const quality = visit.qualityAssessment || {};
  const environmental = visit.environmentalAssessment || {};
  body.push(heading('Control de calidad', 2));
  body.push(keyValues([['Valoración', quality.status === 'not_assessed' ? 'No verificable' : label(quality.status)], ['Observaciones', quality.observations || visit.qualityObservations]]));
  body.push(heading('Mitigación de riesgo ambiental', 2));
  body.push(keyValues([['Confirmación', environmental.status === 'conforming' ? 'Cumple' : environmental.status === 'non_conforming' ? 'No cumple' : 'No verificable'], ['Observaciones', environmental.observations || visit.environmentalObservations]]));
  const environmentalRequirements = compliance.environmentalRequirements || [];
  if (environmentalRequirements.length) body.push(table(['Fase', 'Requisito ambiental', 'Estado', 'Información'], environmentalRequirements.map(item => [item.phaseName, item.title, label(item.status), item.information || item.observations]), [1, 2.4, .8, 2.3]));

  body.push(heading('Conclusión, recomendación, certificación y firma'));
  body.push(heading('Certificación del inspector', 2));
  body.push(paragraph(CERTIFICATION_TEXT));
  body.push(heading('Conclusión', 2));
  body.push(paragraph(visit.conclusion || 'Sin conclusión adicional.'));
  const signatureData = String(context.signature?.imageData || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/)?.[1];
  if (signatureData) {
    const relId = 'rIdSignature';
    images.push({ filename: 'signature.png', data: Buffer.from(signatureData, 'base64') });
    relationships.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/signature.png"/>`);
    body.push(signatureParagraph(relId));
  }
  body.push(keyValues([['Recomendación', visit.recommendation?.verdict], ['Condiciones', visit.recommendation?.conditions ?? visit.recommendation?.notes], ['Avaluador', context.signature?.signerName], ['Título profesional', context.evaluator?.professional?.title], ['Idoneidad / licencia', context.evaluator?.professional?.licenseNumber], ['Empresa', context.evaluator?.professional?.company], ['Correo', context.evaluator?.email], ['Firmado', fmtDate(context.signature?.signedAt)]]));

  const lines = finance.loanLines || [];
  const amortizations = finance.unitAmortizations || [];
  const phaseEconomics = finance.phases || [];
  if (lines.length || amortizations.length || phaseEconomics.length) {
    body.push(paragraph('', { pageBreak: true }));
    body.push(heading('Anexo económico'));
    if (lines.length) body.push(table(['Línea', 'Desembolsado', 'Amortizado', 'Recuperado', 'Saldo', 'Estado'], lines.map(item => [item.name, fmtMoney(item.disbursementAmount, currency), fmtMoney(item.amortizedAmount, currency), fmtMoney(item.totalRecovered, currency), fmtMoney(item.balanceAfterSales ?? item.balance, currency), label(item.status)]), [1.5, 1, 1, 1, 1, .8]));
    if (phaseEconomics.length) body.push(table(['Fase', 'Desembolso previsto', 'Desembolso real', 'Usos previstos', 'Usos reales'], phaseEconomics.map(item => [item.name, fmtMoney(item.expectedDisbursement, currency), fmtMoney(item.actualDisbursement, currency), fmtMoney((item.plannedUses || []).reduce((sum, use) => sum + num(use.amount), 0), currency), fmtMoney((item.actualUses || []).reduce((sum, use) => sum + num(use.amount), 0), currency)]), [1.5, 1, 1, 1, 1]));
    if (amortizations.length) body.push(table(['Unidad / cliente', 'Cheque', 'Distribuido', 'Promotor', 'Diferencia'], amortizations.map(item => [item.lot || item.clientName, fmtMoney(item.checkAmount, currency), fmtMoney(item.allocationsTotal || num(item.amortizationLine1) + num(item.amortizationLine2), currency), fmtMoney(item.promoterAmount, currency), fmtMoney(item.difference, currency)]), [2, 1, 1, 1, 1]));
  }

  body.push(paragraph('', { pageBreak: true }));
  body.push(heading('Anexo fotográfico'));
  for (const [index, photo] of (context.photos || []).entries()) {
    const absolute = path.resolve(__dirname, '..', String(photo.path || ''));
    const relative = path.relative(PHOTO_ROOT, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(absolute)) continue;
    const extension = path.extname(absolute).toLowerCase() === '.png' ? 'png' : 'jpeg';
    const relId = `rIdImage${index + 1}`;
    const filename = `photo-${index + 1}.${extension === 'png' ? 'png' : 'jpg'}`;
    images.push({ filename, data: fs.readFileSync(absolute) });
    photoImageCount += 1;
    relationships.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${filename}"/>`);
    body.push(imageParagraph(relId, photo.caption || photo.originalname || `Fotografía ${index + 1}`));
  }
  if (!photoImageCount) body.push(paragraph('No hay fotografías disponibles.'));

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join('')}<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708"/><w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr></w:body></w:document>`;
  const zip = new PizZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const word = zip.folder('word');
  word.file('document.xml', documentXml);
  word.file('styles.xml', stylesXml());
  word.file('header1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="D7DEE8"/></w:pBdr></w:pPr><w:r><w:rPr><w:color w:val="647089"/><w:sz w:val="16"/></w:rPr><w:t>${xml(project.name)} | Bank73</w:t></w:r></w:p></w:hdr>`);
  word.file('footer1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="647089"/><w:sz w:val="16"/></w:rPr><w:t>${xml(inspection.reportNumber || 'Borrador')} | Informe confidencial</w:t></w:r></w:p></w:ftr>`);
  word.folder('_rels').file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join('')}</Relationships>`);
  const media = word.folder('media');
  for (const image of images) media.file(image.filename, image.data);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { buildInspectionReportDocx };
