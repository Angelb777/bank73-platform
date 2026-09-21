'use strict';

function dateInReportPeriod(value, period) {
  if (!period || !value) return !period;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= period.start.getTime() && time <= period.end.getTime();
}

function anyDateInReportPeriod(item, fields, period) {
  if (!period) return true;
  return fields.some(field => dateInReportPeriod(item?.[field], period));
}

function buildPeriodActivity({ period, ventas = [], documents = [], checklists = [], permits = [], financePhases = [] }) {
  if (!period) return null;

  const events = [];
  const pushEvent = (date, type, detail, amount) => {
    if (!dateInReportPeriod(date, period)) return false;
    events.push({ date, type, detail: detail || '', amount: Number(amount) || 0 });
    return true;
  };
  const periodDateOrFallback = (...dates) =>
    dates.find(date => dateInReportPeriod(date, period)) || dates.find(Boolean);

  ventas.forEach(v => {
    const unit = [v.manzana, v.lote].filter(Boolean).join('-') || 'Unidad';
    const client = v.clienteNombre || [v.primerNombre, v.primerApellido].filter(Boolean).join(' ') || '';
    const detail = client ? `${unit} - ${client}` : unit;
    let explicitEvent = false;
    explicitEvent = pushEvent(periodDateOrFallback(v.fechaContratoCliente, v.fechaFirma), 'Venta formalizada (contrato)', detail, v.precioVenta || v.valor) || explicitEvent;
    explicitEvent = pushEvent(periodDateOrFallback(v.fechaProforma, v.fechaEntregaProformaBanco), 'Proforma entregada', detail) || explicitEvent;
    explicitEvent = pushEvent(v.fechaValorCPP, 'CPP emitido', detail, v.montoFinanciamientoCPP) || explicitEvent;
    explicitEvent = pushEvent(v.fechaActivacionTramite, 'Tramite legal activado', detail) || explicitEvent;
    explicitEvent = pushEvent(v.fechaInscripcion, 'Escritura inscrita', detail) || explicitEvent;
    explicitEvent = pushEvent(periodDateOrFallback(v.fechaDesembolso, v.fechaRecibidoCheque), 'Desembolso recibido', detail, v.montoFinanciamientoCPP) || explicitEvent;
    explicitEvent = pushEvent(v.fechaEntregaVivienda, 'Vivienda entregada', detail) || explicitEvent;
    explicitEvent = pushEvent(v.fechaCaida, 'Venta caida', detail) || explicitEvent;
    if (!explicitEvent) pushEvent(v.updatedAt || v.createdAt, 'Expediente comercial actualizado', detail);
  });

  documents.forEach(doc => {
    if (!dateInReportPeriod(doc.createdAt, period)) return;
    const isPhoto = doc.category === 'beforeAfter' || String(doc.mimetype || '').startsWith('image/');
    pushEvent(doc.createdAt, isPhoto ? 'Foto subida' : 'Documento subido', doc.originalname || doc.title || 'Archivo');
  });

  checklists.forEach(cl => {
    const completed = pushEvent(cl.completedAt, 'Tarea completada', cl.title || 'Checklist');
    const validated = pushEvent(cl.validatedAt, 'Tarea validada', cl.title || 'Checklist');
    if (!completed && !validated) pushEvent(cl.updatedAt || cl.createdAt, 'Checklist actualizado', cl.title || 'Checklist');
  });

  permits.forEach(item => {
    const submitted = pushEvent(item.submittedAt, 'Permiso presentado', item.title || item.code);
    const resolved = pushEvent(item.resolvedAt, item.status === 'approved' ? 'Permiso aprobado' : 'Permiso resuelto', item.title || item.code);
    if (!submitted && !resolved) pushEvent(item.updatedAt || item.createdAt, 'Permiso actualizado', item.title || item.code);
  });

  financePhases.forEach(phase => {
    const requested = pushEvent(phase.disbRequestedAt, 'Desembolso solicitado', phase.name || 'Fase', phase.disbExpected);
    const disbursed = pushEvent(phase.disbActualAt, 'Desembolso financiero registrado', phase.name || 'Fase', phase.disbActual);
    if (!requested && !disbursed) pushEvent(phase.updatedAt || phase.createdAt, 'Fase financiera actualizada', phase.name || 'Fase');
  });

  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  const countMap = new Map();
  events.forEach(event => countMap.set(event.type, (countMap.get(event.type) || 0) + 1));
  const counts = Array.from(countMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  const amountByType = type => events.filter(event => event.type === type).reduce((sum, event) => sum + event.amount, 0);
  const getCount = type => countMap.get(type) || 0;

  return {
    period: { from: period.from, to: period.to, label: period.label },
    counts,
    events,
    totals: {
      events: events.length,
      contracts: getCount('Venta formalizada (contrato)'),
      cpp: getCount('CPP emitido'),
      documents: getCount('Documento subido') + getCount('Foto subida'),
      photos: getCount('Foto subida'),
      milestones: getCount('Tarea completada') + getCount('Tarea validada'),
      tasksCompleted: getCount('Tarea completada'),
      tasksValidated: getCount('Tarea validada'),
      checklistUpdated: getCount('Checklist actualizado'),
      permitsSubmitted: getCount('Permiso presentado'),
      permitsApproved: getCount('Permiso aprobado'),
      permitsResolved: getCount('Permiso resuelto'),
      permitsUpdated: getCount('Permiso actualizado'),
      disbursementsRequested: getCount('Desembolso solicitado'),
      disbursementsReceived: getCount('Desembolso financiero registrado') + getCount('Desembolso recibido'),
      salesAmount: amountByType('Venta formalizada (contrato)'),
      cppAmount: amountByType('CPP emitido'),
      disbursedAmount: amountByType('Desembolso recibido') + amountByType('Desembolso financiero registrado')
    }
  };
}

module.exports = { dateInReportPeriod, anyDateInReportPeriod, buildPeriodActivity };
