const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const libre = require('libreoffice-convert');

function safe(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

async function generatePdfFromTemplate(templatePath, data, outputName) {
  const content = fs.readFileSync(templatePath, 'binary');

  const zip = new PizZip(content);

  const doc = new Docxtemplater(zip, {
  paragraphLoop: true,
  linebreaks: true,
  delimiters: {
    start: '{{',
    end: '}}'
  }
});

  doc.setData({
    ...data,

    captadoAtencionOficina: data.captadoAtencionOficina ? 'X' : '',
    captadoMailInternet: data.captadoMailInternet ? 'X' : '',
    captadoEnProyecto: data.captadoEnProyecto ? 'X' : '',
    captadoMercadeoProspecto: data.captadoMercadeoProspecto ? 'X' : '',
  });

  doc.render();

  const buf = doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });

  const tempDocx = path.join(__dirname, `../temp/${outputName}.docx`);
  const tempPdf = path.join(__dirname, `../temp/${outputName}.pdf`);

  fs.writeFileSync(tempDocx, buf);

  const pdfBuf = await new Promise((resolve, reject) => {
    libre.convert(buf, '.pdf', undefined, (err, done) => {
      if (err) reject(err);
      else resolve(done);
    });
  });

  fs.writeFileSync(tempPdf, pdfBuf);

  return tempPdf;
}

module.exports = {
  generatePdfFromTemplate,
};