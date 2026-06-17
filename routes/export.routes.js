const express = require('express');
const PDFDocument = require('pdfkit');

const router = express.Router();

const Venta = require('../models/Venta');
const Unit = require('../models/Unit');
const Project = require('../models/Project');
const { formatProjectMoney } = require('../utils/currency');

const BRAND = {
  dark: '#0B1020',
  green: '#0B3B2E',
  line: '#CBD5E1',
  soft: '#F8FAFC',
  text: '#111827',
  muted: '#64748B',
};

function val(v) {
  if (v === null || v === undefined || v === '') return '';
  return String(v);
}

function dash(v) {
  const x = val(v);
  return x || '—';
}

function money(v, currency = 'PAB') {
  if (v === null || v === undefined || v === '') return '';
  return formatProjectMoney(v, currency);
}

function dateVal(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function boolText(v) {
  return v ? 'Sí' : 'No';
}

async function getUnitVenta(unitId) {
  const unit = await Unit.findById(unitId).lean();
  if (!unit) return { error: 'Unidad no encontrada' };

  const venta = await Venta.findOne({ unitId: unit._id }).lean();
  if (!venta) return { error: 'Venta no encontrada' };

  const project = unit.projectId ? await Project.findById(unit.projectId).select('currency').lean() : null;

  return { unit, venta, currency: project?.currency || 'PAB' };
}

function pageHeader(doc, title, subtitle = '') {
  const w = doc.page.width;

  doc.save();
  doc.rect(0, 0, w, 78).fill(BRAND.dark);
  doc.fillColor('white').fontSize(18).font('Helvetica-Bold').text(title, 40, 22);
  doc.fillColor('#CBD5E1').fontSize(9).font('Helvetica').text(subtitle, 40, 48);
  doc.restore();

  doc.y = 96;
}

function footer(doc, pageNumber, totalPages) {
  const y = doc.page.height - doc.page.margins.bottom - 12;

  doc.save();

  doc.fontSize(7)
    .fillColor(BRAND.muted)
    .text(
      'Bank73 · Documento generado automáticamente',
      doc.page.margins.left,
      y,
      {
        width: 260,
        lineBreak: false
      }
    );

  doc.text(
    `Página ${pageNumber} de ${totalPages}`,
    doc.page.width - doc.page.margins.right - 160,
    y,
    {
      width: 160,
      align: 'right',
      lineBreak: false
    }
  );

  doc.restore();
}

function ensure(doc, h = 80) {
  if (doc.y + h > doc.page.height - 55) {
    doc.addPage();
    doc.y = 45;
  }
}

function sectionTitle(doc, title) {
  ensure(doc, 32);
  doc.moveDown(0.5);
  const y = doc.y;
  doc.save();
  doc.rect(40, y, doc.page.width - 80, 22).fill(BRAND.green);
  doc.fillColor('white').fontSize(9).font('Helvetica-Bold').text(title.toUpperCase(), 48, y + 6);
  doc.restore();
  doc.y = y + 30;
}

function fieldBox(doc, x, y, w, h, label, value) {
  doc.save();

  doc.rect(x, y, w, h).stroke(BRAND.line);
  doc.fillColor(BRAND.muted).fontSize(6.8).font('Helvetica-Bold')
    .text(String(label || '').toUpperCase(), x + 4, y + 4, { width: w - 8 });

  doc.fillColor(BRAND.text).fontSize(8).font('Helvetica')
    .text(dash(value), x + 4, y + 16, { width: w - 8, height: h - 18 });

  doc.restore();
}

function grid(doc, fields, columns = 4, boxH = 38) {
  const margin = 40;
  const gap = 0;
  const totalW = doc.page.width - margin * 2;
  const colW = totalW / columns;

  for (let i = 0; i < fields.length; i += columns) {
    ensure(doc, boxH + 8);
    const y = doc.y;

    for (let c = 0; c < columns; c++) {
      const item = fields[i + c];
      if (!item) continue;
      fieldBox(doc, margin + c * (colW + gap), y, colW, boxH, item[0], item[1]);
    }

    doc.y = y + boxH;
  }

  doc.moveDown(0.4);
}

function twoColGrid(doc, fields, boxH = 34) {
  return grid(doc, fields, 2, boxH);
}

function noteBox(doc, title, text, h = 52) {
  ensure(doc, h + 12);
  const x = 40;
  const y = doc.y;
  const w = doc.page.width - 80;

  doc.save();
  doc.rect(x, y, w, h).stroke(BRAND.line);
  doc.fillColor(BRAND.muted).fontSize(7).font('Helvetica-Bold')
    .text(title.toUpperCase(), x + 6, y + 5);
  doc.fillColor(BRAND.text).fontSize(8).font('Helvetica')
    .text(dash(text), x + 6, y + 18, { width: w - 12, height: h - 22 });
  doc.restore();

  doc.y = y + h + 8;
}

function checkRow(doc, items) {
  ensure(doc, 36);
  const x = 40;
  const y = doc.y;
  const w = doc.page.width - 80;
  const colW = w / items.length;

  items.forEach((it, i) => {
    const xx = x + i * colW;
    doc.rect(xx, y, colW, 30).stroke(BRAND.line);
    doc.fontSize(7).fillColor(BRAND.muted).font('Helvetica-Bold')
      .text(it[0].toUpperCase(), xx + 4, y + 5, { width: colW - 8 });
    doc.fontSize(8).fillColor(BRAND.text).font('Helvetica')
      .text(boolText(it[1]), xx + 4, y + 17, { width: colW - 8 });
  });

  doc.y = y + 36;
}

function signatureArea(doc) {
  ensure(doc, 90);
  const x = 40;
  const y = doc.y + 18;
  const w = doc.page.width - 80;

  doc.moveTo(x, y + 45).lineTo(x + 180, y + 45).stroke(BRAND.line);
  doc.fontSize(7).fillColor(BRAND.muted).text('FIRMA', x, y + 50, { width: 180, align: 'center' });

  doc.moveTo(x + 250, y + 45).lineTo(x + 430, y + 45).stroke(BRAND.line);
  doc.fontSize(7).fillColor(BRAND.muted).text('CÉDULA', x + 250, y + 50, { width: 180, align: 'center' });

  doc.y = y + 76;
}

/* =========================================================================
   FICHA CLIENTE
   ========================================================================= */
router.get('/ficha-cliente/:unitId', async (req, res) => {
  try {
    const result = await getUnitVenta(req.params.unitId);
    if (result.error) return res.status(404).json({ error: result.error });

    const { unit, venta, currency } = result;
    const projectMoney = (value) => money(value, currency);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ficha_cliente_${unit.manzana || ''}_${unit.lote || ''}.pdf"`);

    const doc = new PDFDocument({
  size: 'A4',
  margin: 40,
  bufferPages: true
});
    doc.pipe(res);

    pageHeader(doc, 'FICHA DE CLIENTE', `Unidad ${unit.manzana || ''}-${unit.lote || ''} · ${unit.modelo || ''}`);

    sectionTitle(doc, 'Datos de la unidad');
    grid(doc, [
      ['Lote', `${unit.manzana || ''}-${unit.lote || ''}`],
      ['Modelo', unit.modelo],
      ['M² unidad', unit.m2],
      ['Precio lista', projectMoney(unit.precioLista)],
      ['Estado', unit.estado],
      ['Número de finca', venta.numeroFinca],
      ['Código ubicación', venta.codigoUbicacion],
      ['Ubicación', venta.ubicacion],
      ['Calle', venta.calle],
      ['Metraje lote', venta.metrajeLote],
      ['Lote esquina', venta.loteEsquina],
      ['M² extra', venta.metrosExtra],
      ['Precio lote esquinero', projectMoney(venta.precioLoteEsquina)],
      ['Precio m² extra', projectMoney(venta.precioM2Extra)],
      ['Área abierta', venta.areaAbierta],
      ['Área cerrada', venta.areaCerrada],
      ['Área total construcción', venta.areaTotalConstruccion],
      ['Recámaras', venta.recamaras],
      ['Baños', venta.banos],
      ['Fecha probable entrega', dateVal(venta.fechaProbableEntrega)],
    ]);

    sectionTitle(doc, 'Datos del cliente 1');
    grid(doc, [
      ['Cliente resumen', venta.clienteNombre],
      ['Primer nombre', venta.primerNombre],
      ['Segundo nombre', venta.segundoNombre],
      ['Apellido paterno', venta.primerApellido],
      ['Apellido materno', venta.segundoApellido],
      ['Apellido de casada', venta.apellidoCasada],
      ['Cédula y D.V', venta.cedula],
      ['Sexo', venta.sexo],
      ['Profesión', venta.profesion],
      ['Estado civil', venta.estadoCivil],
      ['Domicilio', venta.direccion],
      ['Correo electrónico', venta.correo],
      ['Teléfono residencial', venta.telefonoResidencial],
      ['Teléfono oficina', venta.telefonoOficina],
      ['Celular', venta.celular],
      ['Lugar de trabajo', venta.lugarTrabajo],
      ['Ingreso mensual', projectMoney(venta.ingresoMensual)],
      ['Cargo que desempeña', venta.cargo],
      ['Antigüedad laboral', venta.antiguedadLaboral],
      ['Empresa', venta.empresa],
    ]);

    sectionTitle(doc, 'Datos del cliente 2');
    grid(doc, [
      ['Primer nombre', venta.cliente2PrimerNombre],
      ['Segundo nombre', venta.cliente2SegundoNombre],
      ['Apellido paterno', venta.cliente2PrimerApellido],
      ['Apellido materno', venta.cliente2SegundoApellido],
      ['Apellido de casada', venta.cliente2ApellidoCasada],
      ['Cédula y D.V', venta.cliente2Cedula],
      ['Sexo', venta.cliente2Sexo],
      ['Profesión', venta.cliente2Profesion],
      ['Estado civil', venta.cliente2EstadoCivil],
      ['Domicilio', venta.cliente2Direccion],
      ['Correo electrónico', venta.cliente2Correo],
      ['Teléfono residencial', venta.cliente2TelefonoResidencial],
      ['Teléfono oficina', venta.cliente2TelefonoOficina],
      ['Celular', venta.cliente2Celular],
      ['Lugar de trabajo', venta.cliente2LugarTrabajo],
      ['Ingreso mensual', projectMoney(venta.cliente2IngresoMensual)],
      ['Cargo que desempeña', venta.cliente2Cargo],
      ['Antigüedad laboral', venta.cliente2AntiguedadLaboral],
    ]);

    sectionTitle(doc, 'Parientes');
    grid(doc, [
      ['Nombre del pariente 1', venta.pariente1Nombre],
      ['Parentesco', venta.pariente1Parentesco],
      ['Teléfono pariente 1', venta.pariente1Telefono],
      ['Tel. trabajo pariente 1', venta.pariente1TelefonoTrabajo],
      ['Nombre del pariente 2', venta.pariente2Nombre],
      ['Parentesco', venta.pariente2Parentesco],
      ['Teléfono pariente 2', venta.pariente2Telefono],
      ['Tel. trabajo pariente 2', venta.pariente2TelefonoTrabajo],
    ]);

    sectionTitle(doc, 'Referencias personales');
    grid(doc, [
      ['Nombre referencia personal 1', venta.referencia1Nombre],
      ['Relación', venta.referencia1Relacion],
      ['Tel. ref. personal 1', venta.referencia1Telefono],
      ['Tel. trabajo ref. personal 1', venta.referencia1TelefonoTrabajo],
      ['Nombre referencia personal 2', venta.referencia2Nombre],
      ['Relación', venta.referencia2Relacion],
      ['Tel. ref. personal 2', venta.referencia2Telefono],
      ['Tel. trabajo ref. personal 2', venta.referencia2TelefonoTrabajo],
    ]);

    sectionTitle(doc, 'Precio de vivienda / promotora');
    grid(doc, [
      ['Precio de venta', projectMoney(venta.precioVenta || unit.precioLista)],
      ['Monto hipoteca', projectMoney(venta.montoFinanciamientoCPP || venta.valor)],
      ['Precio m² extra', projectMoney(venta.precioM2Extra)],
      ['Abono del financiamiento', projectMoney(venta.abonoCliente)],
      ['Póliza de vida', venta.polizaVida],
      ['Abono ALTE', projectMoney(venta.abonoAlte)],
      ['Valor mejoras', projectMoney(venta.valorMejoras)],
      ['Valor terreno', projectMoney(venta.valorTerreno)],
    ]);

    sectionTitle(doc, 'Precio de vivienda / entidad bancaria');
    grid(doc, [
      ['Precio de venta', projectMoney(venta.precioVenta || unit.precioLista)],
      ['Banco', venta.banco],
      ['Monto hipoteca / CPP', projectMoney(venta.montoFinanciamientoCPP || venta.valor)],
      ['Oficial de crédito', venta.oficialBanco],
      ['Abono cliente', projectMoney(venta.abonoCliente)],
      ['Abono inicial', projectMoney(venta.abonoInicial)],
      ['% financiamiento', venta.porcentajeFinanciamiento],
      ['Cesión a favor de', venta.cesionAFavorDe],
    ]);

    sectionTitle(doc, 'Cliente captado');
    checkRow(doc, [
      ['Atención oficina', venta.captadoAtencionOficina],
      ['Por mail / internet', venta.captadoMailInternet],
      ['En el proyecto', venta.captadoEnProyecto],
      ['Mercadeo / prospecteo', venta.captadoMercadeoProspecto],
    ]);

    grid(doc, [
      ['Proforma solicitada por', venta.proformaSolicitadaPor],
      ['Fecha proforma', dateVal(venta.fechaProforma)],
      ['Referido por', venta.referidoPor],
      ['Fecha entrega proforma banco', dateVal(venta.fechaEntregaProformaBanco)],
    ]);

    noteBox(
      doc,
      'Observación',
      venta.observacionCliente || 'Acepto que he visitado el Proyecto, conocí la casa modelo en su interior y exterior, así como el lote escogido.',
      58
    );

    noteBox(doc, 'Comentario interno', venta.comentario, 46);
    signatureArea(doc);

    const range = doc.bufferedPageRange();

for (let i = 0; i < range.count; i++) {
  doc.switchToPage(i);
  footer(doc, i + 1, range.count);
}
    doc.end();

  } catch (e) {
    console.error('[EXPORT PDF ERROR ficha-cliente]', e);
    return res.status(500).json({ error: 'Error generando PDF', detail: e.message });
  }
});

/* =========================================================================
   PROFORMA
   ========================================================================= */
router.get('/proforma/:unitId', async (req, res) => {
  try {
    const result = await getUnitVenta(req.params.unitId);
    if (result.error) return res.status(404).json({ error: result.error });

    const { unit, venta, currency } = result;
    const projectMoney = (value) => money(value, currency);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="proforma_${unit.manzana || ''}_${unit.lote || ''}.pdf"`);

    const doc = new PDFDocument({
  size: 'A4',
  margin: 40,
  bufferPages: true
});
    doc.pipe(res);

    pageHeader(doc, 'PRO-FORMA', `Panamá · Unidad ${unit.manzana || ''}-${unit.lote || ''}`);

    sectionTitle(doc, 'Banco / Proyecto');
    grid(doc, [
      ['Banco', venta.banco],
      ['Oficial', venta.oficialBanco],
      ['Proyecto', venta.proyecto || ''],
      ['Promotora', venta.promotora || ''],
      ['Propietario', venta.propietario || venta.clienteNombre],
      ['Ubicación', venta.ubicacion],
      ['Unidad / lote', `${unit.manzana || ''}-${unit.lote || ''}`],
      ['Modelo', venta.modelo || unit.modelo],
    ], 2, 36);

    sectionTitle(doc, 'Dato del 1er solicitante');
    grid(doc, [
      ['Apellido paterno', venta.primerApellido],
      ['Apellido materno', venta.segundoApellido],
      ['Apell. de casada', venta.apellidoCasada],
      ['Primer nombre', venta.primerNombre],
      ['Segundo nombre', venta.segundoNombre],
      ['Sexo', venta.sexo],
      ['Profesión', venta.profesion],
      ['Cédula', venta.cedula],
      ['Dirección actual donde reside', venta.direccion],
      ['Lugar de trabajo', venta.lugarTrabajo],
    ], 2, 38);

    sectionTitle(doc, 'Dato del 2do solicitante');
    grid(doc, [
      ['Apellido paterno', venta.cliente2PrimerApellido],
      ['Apellido materno', venta.cliente2SegundoApellido],
      ['Apell. de casada', venta.cliente2ApellidoCasada],
      ['Primer nombre', venta.cliente2PrimerNombre],
      ['Segundo nombre', venta.cliente2SegundoNombre],
      ['Sexo', venta.cliente2Sexo],
      ['Profesión', venta.cliente2Profesion],
      ['Cédula', venta.cliente2Cedula],
      ['Dirección actual donde reside', venta.cliente2Direccion],
      ['Lugar de trabajo', venta.cliente2LugarTrabajo],
    ], 2, 38);

    sectionTitle(doc, 'Características del lote');
    grid(doc, [
      ['Lote N°', `${unit.manzana || ''}-${unit.lote || ''}`],
      ['Modelo', venta.modelo || unit.modelo],
      ['Recámaras', venta.recamaras],
      ['Baño', venta.banos],
      ['Superficie de terreno', venta.metrajeLote],
      ['Calle', venta.calle],
      ['Área total construcción', venta.areaTotalConstruccion],
      ['Área cerrada', venta.areaCerrada],
      ['Área abierta', venta.areaAbierta],
      ['Precio total de venta', projectMoney(venta.precioVenta || unit.precioLista)],
      ['Valor de mejoras', projectMoney(venta.valorMejoras)],
      ['Valor de terreno', projectMoney(venta.valorTerreno)],
      ['Finca', venta.numeroFinca],
      ['Fecha probable de entrega', dateVal(venta.fechaProbableEntrega)],
    ], 2, 36);

    sectionTitle(doc, 'Financiamiento');
    grid(doc, [
      ['Monto del financiamiento', projectMoney(venta.montoFinanciamientoCPP || venta.valor)],
      ['Cesión a favor de', venta.cesionAFavorDe],
      ['Porcentaje del financiamiento', venta.porcentajeFinanciamiento],
      ['Abono inicial', projectMoney(venta.abonoInicial)],
    ], 2, 38);

    ensure(doc, 110);
    doc.moveDown(1.4);
    doc.fontSize(9).fillColor(BRAND.text).text('Aprobado y revisado', 40);
    doc.moveDown(0.8);
    doc.text('Por:', 40);

    const y = doc.y + 30;
    doc.moveTo(40, y).lineTo(230, y).stroke(BRAND.line);
    doc.fontSize(7).fillColor(BRAND.muted).text('PROMOTORA', 40, y + 5, { width: 190, align: 'center' });

    doc.fontSize(8).fillColor(BRAND.muted)
      .text('Correo:', 300, y - 10, { width: 220 })
      .text('Teléfono:', 300, y + 8, { width: 220 });

    const range = doc.bufferedPageRange();

for (let i = 0; i < range.count; i++) {
  doc.switchToPage(i);
  footer(doc, i + 1, range.count);
}  

    doc.end();

  } catch (e) {
    console.error('[EXPORT PDF ERROR proforma]', e);
    return res.status(500).json({ error: 'Error generando PDF', detail: e.message });
  }
});

module.exports = router;
