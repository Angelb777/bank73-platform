const express = require('express');
const path = require('path');

const router = express.Router();

const Venta = require('../models/Venta');
const Unit = require('../models/Unit');

const {
  generatePdfFromTemplate,
} = require('../services/pdf_templates');

router.get('/ficha-cliente/:unitId', async (req, res) => {
  try {
    const unit = await Unit.findById(req.params.unitId);

    if (!unit) {
      return res.status(404).json({ error: 'Unidad no encontrada' });
    }

    const venta = await Venta.findOne({
      unitId: unit._id,
    }).lean();

    if (!venta) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }

    const template = path.join(
      __dirname,
      '../templates/ficha_cliente.docx'
    );

    const pdfPath = await generatePdfFromTemplate(
      template,
      {
        ...venta,
        lote: `${unit.manzana}-${unit.lote}`,
        modelo: unit.modelo,
        precioVenta: venta.precioVenta || unit.precioLista || 0,
      },
      `ficha_${unit._id}`
    );

    return res.download(pdfPath);

  } catch (e) {
    console.error('[EXPORT PDF ERROR ficha-cliente]', e);

    return res.status(500).json({
      error: 'Error generando PDF',
      detail: e.message,
    });
  }
});

router.get('/proforma/:unitId', async (req, res) => {
  try {
    const unit = await Unit.findById(req.params.unitId);

    if (!unit) {
      return res.status(404).json({ error: 'Unidad no encontrada' });
    }

    const venta = await Venta.findOne({
      unitId: unit._id,
    }).lean();

    if (!venta) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }

    const template = path.join(
      __dirname,
      '../templates/proforma.docx'
    );

    const pdfPath = await generatePdfFromTemplate(
      template,
      {
        ...venta,
        lote: `${unit.manzana}-${unit.lote}`,
        modelo: unit.modelo,
        precioVenta: venta.precioVenta || unit.precioLista || 0,
      },
      `proforma_${unit._id}`
    );

    return res.download(pdfPath);

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error generando PDF' });
  }
});

module.exports = router;