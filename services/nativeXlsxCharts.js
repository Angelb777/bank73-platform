'use strict';

const PizZip = require('pizzip');

function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function quotedSheet(name) {
  return `'${String(name || '').replace(/'/g, "''")}'`;
}

function stringCache(values = []) {
  return `<c:strCache><c:ptCount val="${values.length}"/>${values.map((value, index) => (
    `<c:pt idx="${index}"><c:v>${xmlEscape(value)}</c:v></c:pt>`
  )).join('')}</c:strCache>`;
}

function numberCache(values = []) {
  return `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values.map((value, index) => (
    `<c:pt idx="${index}"><c:v>${Number(value) || 0}</c:v></c:pt>`
  )).join('')}</c:numCache>`;
}

function seriesXml(series, index, categoriesRef, categories) {
  const color = String(series.color || '2F75B5').replace('#', '').toUpperCase();
  return `<c:ser>
    <c:idx val="${index}"/><c:order val="${index}"/>
    <c:tx><c:v>${xmlEscape(series.name || `Serie ${index + 1}`)}</c:v></c:tx>
    <c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></c:spPr>
    <c:cat><c:strRef><c:f>${xmlEscape(categoriesRef)}</c:f>${stringCache(categories)}</c:strRef></c:cat>
    <c:val><c:numRef><c:f>${xmlEscape(series.valuesRef)}</c:f>${numberCache(series.values)}</c:numRef></c:val>
  </c:ser>`;
}

function titleXml(title) {
  return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="es-ES" sz="1200" b="1"/><a:t>${xmlEscape(title)}</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title>`;
}

function chartXml(definition, chartIndex, sheetName) {
  const type = definition.type || 'bar';
  const categoriesRef = `${quotedSheet(sheetName)}!${definition.categoriesRef}`;
  const series = (definition.series || []).map((item, index) => seriesXml({
    ...item,
    valuesRef: `${quotedSheet(sheetName)}!${item.valuesRef}`
  }, index, categoriesRef, definition.categories || [])).join('');
  const axisOne = 100000 + chartIndex * 2;
  const axisTwo = axisOne + 1;
  let plot;

  if (type === 'doughnut') {
    plot = `<c:doughnutChart><c:varyColors val="1"/>${series}<c:holeSize val="58"/><c:firstSliceAng val="270"/></c:doughnutChart>`;
  } else if (type === 'line') {
    plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/><c:axId val="${axisOne}"/><c:axId val="${axisTwo}"/></c:lineChart>`;
  } else {
    const direction = definition.horizontal ? 'bar' : 'col';
    plot = `<c:barChart><c:barDir val="${direction}"/><c:grouping val="clustered"/><c:varyColors val="${(definition.series || []).length === 1 ? 1 : 0}"/>${series}<c:gapWidth val="80"/><c:axId val="${axisOne}"/><c:axId val="${axisTwo}"/></c:barChart>`;
  }

  const axes = type === 'doughnut' ? '' : `
    <c:catAx><c:axId val="${axisOne}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="${axisTwo}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>
    <c:valAx><c:axId val="${axisTwo}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="${xmlEscape(definition.numberFormat || '#,##0')}" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="${axisOne}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
  const legend = (definition.series || []).length > 1 || type === 'doughnut'
    ? '<c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/></c:legend>'
    : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <c:date1904 val="0"/><c:lang val="es-ES"/><c:roundedCorners val="0"/>
    <c:chart>${titleXml(definition.title)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}${axes}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart>
  </c:chartSpace>`;
}

function drawingXml(charts) {
  const anchors = charts.map((chart, index) => {
    const from = chart.from || { col: 0, row: 0 };
    const to = chart.to || { col: from.col + 8, row: from.row + 16 };
    return `<xdr:twoCellAnchor>
      <xdr:from><xdr:col>${from.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${from.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
      <xdr:to><xdr:col>${to.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${to.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
      <xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${index + 2}" name="Chart ${index + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/>
        <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${index + 1}"/></a:graphicData></a:graphic>
      </xdr:graphicFrame><xdr:clientData/>
    </xdr:twoCellAnchor>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`;
}

function ensureRelationshipXml(existing, relationship) {
  if (!existing) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationship}</Relationships>`;
  }
  return existing.replace('</Relationships>', `${relationship}</Relationships>`);
}

function addNativeCharts(buffer, { sheetNumber = 4, sheetName = 'Gráficas', charts = [] } = {}) {
  if (!charts.length) return Buffer.from(buffer);
  const zip = new PizZip(buffer);
  const sheetPath = `xl/worksheets/sheet${sheetNumber}.xml`;
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) throw new Error(`No se encontró ${sheetPath} para insertar las gráficas nativas.`);

  let sheetXml = sheetFile.asText();
  if (!sheetXml.includes('xmlns:r=')) {
    sheetXml = sheetXml.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
  }
  sheetXml = sheetXml.replace('</worksheet>', '<drawing r:id="rIdCharts"/></worksheet>');
  zip.file(sheetPath, sheetXml);

  const sheetRelsPath = `xl/worksheets/_rels/sheet${sheetNumber}.xml.rels`;
  const sheetRels = zip.file(sheetRelsPath)?.asText() || '';
  zip.file(sheetRelsPath, ensureRelationshipXml(sheetRels,
    '<Relationship Id="rIdCharts" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>'
  ));

  zip.file('xl/drawings/drawing1.xml', drawingXml(charts));
  const drawingRels = charts.map((_, index) => (
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${index + 1}.xml"/>`
  )).join('');
  zip.file('xl/drawings/_rels/drawing1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawingRels}</Relationships>`
  );

  charts.forEach((chart, index) => {
    zip.file(`xl/charts/chart${index + 1}.xml`, chartXml(chart, index + 1, sheetName));
  });

  let contentTypes = zip.file('[Content_Types].xml').asText();
  const overrides = [
    '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>',
    ...charts.map((_, index) => `<Override PartName="/xl/charts/chart${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`)
  ].filter(item => !contentTypes.includes(item)).join('');
  contentTypes = contentTypes.replace('</Types>', `${overrides}</Types>`);
  zip.file('[Content_Types].xml', contentTypes);

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { addNativeCharts };
