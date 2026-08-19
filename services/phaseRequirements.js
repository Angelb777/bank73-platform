const REQUIREMENT_TITLES = Object.freeze([
  'Presupuesto del proyecto',
  'Experiencia del promotor y contratista en el desarrollo y promoción de proyectos',
  'Composición accionaria',
  'Imágenes del proyecto y planta arquitectónica del modelo de la unidad',
  'Estudio de mercado realizado por un tercero',
  'Avalúo del terreno donde se desarrollará el proyecto',
  'Estados financieros de la sociedad deudora (si aplica)',
  'Estados financieros y/o declaración de renta de los accionistas',
  'Identificación de accionistas y dignatarios',
  'Estudio de Impacto Ambiental (EIA) con resolución aprobada',
  'Cronograma de ejecución de la obra',
  'Flujo de fondos del proyecto',
  'Aviso de operaciones',
  'Formulario para consulta APC de accionistas y sociedad',
  'Paz y Salvo de la Caja de Seguro Social',
  'Planos de anteproyecto firmados por arquitecto e ingeniero',
  'Formulario de Debida Diligencia',
  'Manual de Cumplimiento',
  'Estudio hidrológico del río y validación de niveles de inundación en planos aprobados por el MOP',
  'Preventas netas requeridas de la etapa a financiar y cesión suficiente para cubrir la facilidad aprobada',
  'Certificación inicial del inspector independiente sobre costos, permisos, pólizas y documentos requeridos',
  'Revisión y validación del presupuesto de construcción por la Gerencia de Ingeniería',
  'Contrato de construcción',
  'Póliza CAR por el 100% del valor de construcción, endosada al Banco / Póliza incendio',
  'Fianza de cumplimiento requerida sobre el valor de la etapa',
  'Fianza de pago requerida sobre el valor de la etapa',
  'Informe de Inspección de Ingeniería',
  'Revisión y validación del presupuesto de construcción por la Gerencia de Ingeniería',
  'Cuenta Avance'
]);

const REQUIREMENT_STATUSES = Object.freeze(['PENDIENTE', 'CUMPLIDO']);

function cleanText(value, max = 12000) {
  return String(value || '').trim().slice(0, max);
}

function requiredPresalesPct(value, fallback = 50) {
  const match = String(value ?? '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  const parsed = match ? Number(match[0]) : Number(fallback);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 50;
}

function cleanDate(value) {
  if (!value) return null;
  const raw = value instanceof Date ? value.toISOString() : String(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(timestamp) ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function alertDays(value, fallback = 30) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(3650, Math.round(parsed))) : fallback;
}

function bondValidity(startDate, expiryDate, now = new Date()) {
  const start = cleanDate(startDate);
  const expiry = cleanDate(expiryDate);
  if (!start || !expiry) return { status: 'MISSING_DATES', daysUntilExpiry: null };
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startUtc = Date.parse(`${start}T00:00:00Z`);
  const expiryUtc = Date.parse(`${expiry}T00:00:00Z`);
  const daysUntilExpiry = Math.round((expiryUtc - todayUtc) / 86400000);
  if (expiryUtc < todayUtc) return { status: 'EXPIRED', daysUntilExpiry };
  if (startUtc > todayUtc) return { status: 'NOT_STARTED', daysUntilExpiry };
  return { status: 'CURRENT', daysUntilExpiry };
}

function addMonthsClamped(dateValue, months) {
  const date = cleanDate(dateValue);
  if (!date) return null;
  const [year, month, day] = date.split('-').map(Number);
  const targetMonth = month - 1 + Math.max(1, Math.round(Number(months) || 1));
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${String(normalizedMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

function periodicFollowUpStatus(nextReviewDate, now = new Date()) {
  const due = cleanDate(nextReviewDate);
  if (!due) return 'PENDIENTE';
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Date.parse(`${due}T00:00:00Z`) > todayUtc ? 'CUMPLIDO' : 'PENDIENTE';
}

function money(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
}

function listAmounts(items = []) {
  return (items || [])
    .filter(item => item?.name || Number(item?.amount || 0))
    .map(item => `${item.name || 'Partida'}: B/. ${money(item.amount)}`)
    .join('; ');
}

function promoterExperience(profile = {}) {
  const parts = [];
  if (profile.yearsExperience !== null && profile.yearsExperience !== undefined) parts.push(`${profile.yearsExperience} años de experiencia`);
  if (profile.deliveredProjects !== null && profile.deliveredProjects !== undefined) parts.push(`${profile.deliveredProjects} proyectos entregados`);
  if (profile.activeProjects !== null && profile.activeProjects !== undefined) parts.push(`${profile.activeProjects} proyectos activos`);
  if (profile.developedUnits !== null && profile.developedUnits !== undefined) parts.push(`${profile.developedUnits} unidades desarrolladas`);
  if (profile.developedVolume) parts.push(`volumen desarrollado B/. ${money(profile.developedVolume)}`);
  if (profile.bankFinancingExperience) parts.push(`experiencia bancaria: ${profile.bankFinancingExperience}`);
  if (Array.isArray(profile.banksWorkedWith) && profile.banksWorkedWith.length) parts.push(`bancos: ${profile.banksWorkedWith.join(', ')}`);
  return parts.join('; ');
}

const COMMERCIAL_PRESALE_STATUSES = new Set([
  'reservado',
  'con_cpp',
  'tramite_legal_activado',
  'escriturado_traspasado',
  'vivienda_entregada',
  'en_escrituracion',
  'escriturado',
  'entregado'
]);

function projectModelCommercialSummary(project = {}) {
  const models = Array.isArray(project.housingModels) ? project.housingModels : [];
  if (!models.length) {
    const total = Number(project.unitsTotal || 0);
    const sold = Number(project.unitsSold || 0);
    const pct = total ? (sold / total * 100).toFixed(1) : '0.0';
    return total || sold ? `Comercial: ${total} unidades totales. Preventas/comercializadas: ${sold} (${pct}%).` : '';
  }
  const counts = models.reduce((summary, model) => {
    const states = model.initialStatuses || {};
    summary.total += Number(model.unitsCount || 0);
    summary.reserved += Number(states.reservado || 0);
    summary.cpp += Number(states.con_cpp || 0);
    summary.legal += Number(states.tramite_legal_activado || 0);
    summary.deeded += Number(states.escriturado_traspasado || 0);
    summary.delivered += Number(states.vivienda_entregada || 0);
    return summary;
  }, { total: 0, reserved: 0, cpp: 0, legal: 0, deeded: 0, delivered: 0 });
  const presales = counts.reserved + counts.cpp + counts.legal + counts.deeded + counts.delivered;
  if (!counts.total && !presales) {
    const total = Number(project.unitsTotal || 0);
    const sold = Number(project.unitsSold || 0);
    const pct = total ? (sold / total * 100).toFixed(1) : '0.0';
    return total || sold ? `Comercial: ${total} unidades totales. Preventas/comercializadas: ${sold} (${pct}%).` : '';
  }
  const pct = counts.total ? (presales / counts.total * 100).toFixed(1) : '0.0';
  return `Comercial: ${counts.total} unidades totales; ${counts.reserved} reservadas; ${counts.cpp} con CPP; ${counts.legal} en trámite legal; ${counts.deeded} escrituradas/traspasadas; ${counts.delivered} entregadas. Preventas/comercializadas: ${presales} (${pct}%).`;
}

function commercialPresalesInformation(project = {}, commercialUnits = []) {
  if (!Array.isArray(commercialUnits) || !commercialUnits.length) return projectModelCommercialSummary(project);
  const summary = commercialUnits.reduce((result, unit) => {
    const status = String(unit.commercialStatus || unit.estado || '').toLowerCase();
    result.total += 1;
    if (status === 'reservado') result.reserved += 1;
    if (status === 'con_cpp') result.cpp += 1;
    if (status === 'tramite_legal_activado' || status === 'en_escrituracion') result.legal += 1;
    if (status === 'escriturado_traspasado' || status === 'escriturado') result.deeded += 1;
    if (status === 'vivienda_entregada' || status === 'entregado') result.delivered += 1;
    if (COMMERCIAL_PRESALE_STATUSES.has(status)) {
      result.presales += 1;
      result.saleValue += Number(unit.salePrice || unit.precioLista || 0);
      result.cppAmount += Number(unit.cppAmount || 0);
    }
    return result;
  }, { total: 0, reserved: 0, cpp: 0, legal: 0, deeded: 0, delivered: 0, presales: 0, saleValue: 0, cppAmount: 0 });
  const pct = summary.total ? (summary.presales / summary.total * 100).toFixed(1) : '0.0';
  return [
    `Comercial: ${summary.total} unidades totales; ${summary.reserved} reservadas; ${summary.cpp} con CPP; ${summary.legal} en trámite legal; ${summary.deeded} escrituradas/traspasadas; ${summary.delivered} entregadas.`,
    `Preventas/comercializadas: ${summary.presales} (${pct}%).`,
    summary.saleValue ? `Valor de venta asociado: B/. ${money(summary.saleValue)}.` : '',
    summary.cppAmount ? `Monto CPP registrado: B/. ${money(summary.cppAmount)}.` : ''
  ].filter(Boolean).join(' ');
}

const PROMOTER_EXPERIENCE_FIELDS = Object.freeze([
  'yearsExperience', 'deliveredProjects', 'activeProjects', 'developedUnits', 'countries',
  'developedVolume', 'averageProjectTicket', 'bankFinancingExperience', 'banksWorkedWith',
  'onTimeDeliveryHistory', 'incidentHistory', 'documentationLevel'
]);

function commercialPresalesStructured(project = {}, commercialUnits = []) {
  if (Array.isArray(commercialUnits) && commercialUnits.length) {
    const data = commercialUnits.reduce((out, unit) => {
      const status = String(unit.commercialStatus || '').toLowerCase();
      out.total += 1;
      if (status === 'reservado') out.reserved += 1;
      if (status === 'con_cpp') out.cpp += 1;
      if (status === 'tramite_legal_activado' || status === 'en_escrituracion') out.legal += 1;
      if (status === 'escriturado_traspasado' || status === 'escriturado') out.deeded += 1;
      if (status === 'vivienda_entregada' || status === 'entregado') out.delivered += 1;
      if (COMMERCIAL_PRESALE_STATUSES.has(status)) {
        out.presales += 1;
        out.saleValue += Number(unit.salePrice || 0);
        out.cppAmount += Number(unit.cppAmount || 0);
      }
      return out;
    }, { total: 0, reserved: 0, cpp: 0, legal: 0, deeded: 0, delivered: 0, presales: 0, saleValue: 0, cppAmount: 0 });
    data.presalesPct = data.total ? data.presales / data.total * 100 : 0;
    return data;
  }
  const models = Array.isArray(project.housingModels) ? project.housingModels : [];
  const data = models.reduce((out, model) => {
    const states = model.initialStatuses || {};
    out.total += Number(model.unitsCount || 0);
    out.reserved += Number(states.reservado || 0);
    out.cpp += Number(states.con_cpp || 0);
    out.legal += Number(states.tramite_legal_activado || 0);
    out.deeded += Number(states.escriturado_traspasado || 0);
    out.delivered += Number(states.vivienda_entregada || 0);
    return out;
  }, { total: models.length ? 0 : Number(project.unitsTotal || 0), reserved: 0, cpp: 0, legal: 0, deeded: 0, delivered: 0, saleValue: 0, cppAmount: 0 });
  data.presales = data.reserved + data.cpp + data.legal + data.deeded + data.delivered || Number(project.unitsSold || 0);
  data.presalesPct = data.total ? data.presales / data.total * 100 : 0;
  return data;
}

function architecturalModelsStructured(project = {}, commercialUnits = []) {
  if (Array.isArray(commercialUnits) && commercialUnits.length) {
    const grouped = new Map();
    commercialUnits.forEach(unit => {
      const name = cleanText(unit.modelName || unit.modelo || '', 180);
      if (!name) return;
      const signature = [name, Number(unit.bedrooms || 0), Number(unit.bathrooms || 0), Number(unit.openAreaM2 || 0), Number(unit.closedAreaM2 || 0)].join('|');
      const current = grouped.get(signature) || {
        name,
        bedrooms: Number(unit.bedrooms || 0),
        bathrooms: Number(unit.bathrooms || 0),
        openAreaM2: Number(unit.openAreaM2 || 0),
        closedAreaM2: Number(unit.closedAreaM2 || 0),
        unitsCount: 0
      };
      current.unitsCount += 1;
      grouped.set(signature, current);
    });
    if (grouped.size) return Array.from(grouped.values());
  }
  return (Array.isArray(project.housingModels) ? project.housingModels : []).map(model => ({
    name: cleanText(model?.name, 180),
    bedrooms: Number(model?.bedrooms || 0),
    bathrooms: Number(model?.bathrooms || 0),
    openAreaM2: Number(model?.openAreaM2 || 0),
    closedAreaM2: Number(model?.closedAreaM2 || 0),
    unitsCount: Number(model?.unitsCount || 0)
  })).filter(model => model.name || model.unitsCount);
}

function defaultRequirementStructuredData(number, { project = {}, promoterProfile = {}, phase = {}, commercialUnits = [] } = {}) {
  const legal = project.legalData || {};
  const technical = project.technicalData || {};
  const conditions = phase.financialConditions || {};
  if (number === 1) return { kind: 'budget', projectTotal: Number(project.financialConditions?.projectTotal || project.budgetApproved || conditions.phaseTotal || 0), phaseTotal: Number(conditions.phaseTotal || 0), uses: phase.planUses || [] };
  if (number === 2) return { kind: 'experience', promoterId: String(project.assignedPromoters?.[0] || ''), promoter: Object.fromEntries(PROMOTER_EXPERIENCE_FIELDS.map(key => [key, promoterProfile?.[key] ?? (['countries','banksWorkedWith'].includes(key) ? [] : null)])) };
  if (number === 3) return { kind: 'shareholders', shareholders: legal.shareholders || [] };
  if (number === 4) return { kind: 'architecturalPlans', models: architecturalModelsStructured(project, commercialUnits) };
  if (number === 9) return { kind: 'legalParties', shareholders: legal.shareholders || [], dignitaries: legal.boardMembers || [] };
  if (number === 10) return { kind: 'flag', label: 'EIA aprobado', value: !!project.financialConditions?.precedentConditions?.environmentalStudyApproved };
  if (number === 11) return { kind: 'schedule', phaseName: phase.name || '', startDate: phase.startDate || null, endDate: phase.endDate || null };
  if (number === 12) return { kind: 'cashflow', uses: phase.planUses || [], sources: phase.planSources || [] };
  if (number === 16 && project.seeksFinancing === true) return { kind: 'plans', preliminaryDesign: technical.assessment?.preliminaryDesign ?? null, approvedPlans: technical.assessment?.approvedPlans ?? null };
  if (number === 20) return {
    kind: 'presales',
    ...commercialPresalesStructured(project, commercialUnits),
    requiredPresales: cleanText(conditions.requiredPresales),
    requiredPresalesPct: requiredPresalesPct(conditions.requiredPresales)
  };
  if (number === 21) return { kind: 'inspector', technicalInspector: cleanText(conditions.technicalInspector) };
  if (number === 22 || number === 28) return { kind: 'constructionBudget', exists: technical.assessment?.constructionBudget ?? null };
  if (number === 24) return {
    kind: 'insurancePolicies',
    policies: (Array.isArray(technical.insurancePolicies) ? technical.insurancePolicies : []).map(policy => ({
      _id: policy?._id,
      type: cleanText(policy?.type),
      insurer: cleanText(policy?.insurer),
      policyNumber: cleanText(policy?.policyNumber),
      insuredAmount: Number(policy?.insuredAmount || 0),
      startDate: policy?.startDate || null,
      expiryDate: policy?.expiryDate || null,
      endorsedToBank: policy?.endorsedToBank === true,
      bank: cleanText(policy?.bank),
      appliesToAllUnits: policy?.appliesToAllUnits !== false,
      unitIds: (policy?.unitIds || []).map(String),
      unitRefs: (policy?.unitRefs || []).map(String),
      documentId: policy?.documentId ? String(policy.documentId) : '',
      documentName: cleanText(policy?.documentName)
    }))
  };
  if (number === 25) {
    const phaseValue = Number(conditions.phaseTotal || 0);
    return { kind: 'performanceBond', phaseValue, requiredPct: 50, requiredAmount: phaseValue * 0.5, actualAmount: 0, bondNumber: '', issuer: '', startDate: null, expiryDate: null, alertDaysBefore: 30, validityStatus: 'MISSING_DATES', daysUntilExpiry: null };
  }
  if (number === 26) {
    const phaseValue = Number(conditions.phaseTotal || 0);
    return { kind: 'paymentBond', phaseValue, requiredPct: 25, requiredAmount: phaseValue * 0.25, actualAmount: 0, bondNumber: '', issuer: '', startDate: null, expiryDate: null, alertDaysBefore: 30, validityStatus: 'MISSING_DATES', daysUntilExpiry: null };
  }
  if (number === 27) return { kind: 'periodicFollowUp', followUpType: 'engineeringInspection', periodicityMonths: 4, lastRecordDate: null, nextReviewDate: null };
  if (number === 29) return { kind: 'periodicFollowUp', followUpType: 'accountAdvance', periodicityMonths: 1, lastRecordDate: null, nextReviewDate: null };
  return undefined;
}

function defaultRequirementInformation(number, { project = {}, promoterProfile = {}, phase = {}, commercialUnits = [] } = {}) {
  const legal = project.legalData || {};
  const technical = project.technicalData || {};
  const conditions = phase.financialConditions || {};
  const shareholders = Array.isArray(legal.shareholders) ? legal.shareholders : [];
  const directors = Array.isArray(legal.boardMembers) ? legal.boardMembers : [];
  const projectTotal = Number(project.financialConditions?.projectTotal || project.budgetApproved || conditions.phaseTotal || 0);
  const phaseTotal = Number(conditions.phaseTotal || 0);

  switch (number) {
    case 1:
      return [
        projectTotal ? `Presupuesto total del proyecto: B/. ${money(projectTotal)}` : '',
        phaseTotal ? `Presupuesto de la fase: B/. ${money(phaseTotal)}` : '',
        listAmounts(phase.planUses || [])
      ].filter(Boolean).join('\n');
    case 2:
      return promoterExperience(promoterProfile) ? `Promotor (perfil Bank73): ${promoterExperience(promoterProfile)}` : '';
    case 3:
      return shareholders.map(item => `${item.name || 'Accionista'}: ${Number(item.percentage || 0)}%`).join('; ');
    case 4:
      // La portada y la mera existencia de modelos no acreditan imágenes del proyecto ni una planta arquitectónica.
      return '';
    case 9:
      return [
        ...shareholders.map(item => `Accionista: ${item.name || ''}${item.cedula ? `, identificación ${item.cedula}` : ''}`),
        ...directors.map(item => `Dignatario: ${item.name || ''}${item.position ? `, ${item.position}` : ''}${item.cedula ? `, identificación ${item.cedula}` : ''}`)
      ].join('\n');
    case 10:
      return project.financialConditions?.precedentConditions?.environmentalStudyApproved ? 'Estudio ambiental marcado como aprobado en Bank73.' : '';
    case 11:
      return [
        phase.name || '',
        phase.startDate ? `Inicio previsto: ${String(phase.startDate).slice(0, 10)}` : '',
        phase.endDate ? `Fin previsto: ${String(phase.endDate).slice(0, 10)}` : ''
      ].filter(Boolean).join('; ');
    case 12:
      return [
        listAmounts(phase.planUses || []) ? `Usos: ${listAmounts(phase.planUses || [])}` : '',
        listAmounts(phase.planSources || []) ? `Fuentes: ${listAmounts(phase.planSources || [])}` : ''
      ].filter(Boolean).join('\n');
    case 16:
      if (project.seeksFinancing !== true) return '';
      return technical.assessment?.preliminaryDesign === true || technical.assessment?.approvedPlans === true
        ? `Anteproyecto: ${technical.assessment?.preliminaryDesign === true ? 'informado' : 'no informado'}; planos aprobados: ${technical.assessment?.approvedPlans === true ? 'sí' : 'no informado'}. Bank73 no registra aquí las firmas del arquitecto y el ingeniero.`
        : '';
    case 20:
      return [
        commercialPresalesInformation(project, commercialUnits),
        cleanText(conditions.requiredPresales) ? `Condición financiera registrada: ${cleanText(conditions.requiredPresales)}` : ''
      ].filter(Boolean).join('\n');
    case 21:
      return conditions.technicalInspector ? `Inspector técnico registrado: ${conditions.technicalInspector}. Este dato no acredita por sí solo la certificación inicial.` : '';
    case 22:
    case 28:
      return technical.assessment?.constructionBudget === true
        ? 'Bank73 registra la existencia de un presupuesto de construcción; no consta aquí su validación por la Gerencia de Ingeniería.'
        : '';
    case 24:
      return (technical.insurancePolicies || []).length ? `${technical.insurancePolicies.length} póliza(s) CAR/incendio registrada(s) en Datos técnicos.` : '';
    case 25:
      return phaseTotal ? `Valor de la fase: B/. ${money(phaseTotal)}. Fianza de cumplimiento requerida: 50%.` : '';
    case 26:
      return phaseTotal ? `Valor de la fase: B/. ${money(phaseTotal)}. Fianza de pago requerida: 25%.` : '';
    default:
      return '';
  }
}

function normalizePhaseRequirements(raw = [], context = {}) {
  const original = Array.isArray(raw) ? raw : [];
  const legacyNumbering = original.some(item => Number(item?.number) === 30)
    || original.some(item => Number(item?.number) === 29 && (item?.structuredData?.kind === 'plans' || /Planos de anteproyecto/i.test(String(item?.title || ''))));
  let prepared = original;
  if (legacyNumbering) {
    const old16 = original.find(item => Number(item?.number) === 16);
    const old29 = original.find(item => Number(item?.number) === 29);
    const old30 = original.find(item => Number(item?.number) === 30);
    const mergeText = (...values) => [...new Set(values.map(value => cleanText(value)).filter(Boolean))].join('\n');
    const unifiedPlans = old16 || old29 ? {
      ...(old16 || old29),
      number: 16,
      information: mergeText(old16?.information, old29?.information),
      manualInformation: mergeText(old16?.manualInformation, old29?.manualInformation),
      observations: mergeText(old16?.observations, old29?.observations),
      status: old16?.status === 'CUMPLIDO' || old29?.status === 'CUMPLIDO' ? 'CUMPLIDO' : 'PENDIENTE',
      legacyRequirementIds: [...new Set([
        ...(old16?.legacyRequirementIds || []).map(String),
        ...(old29?.legacyRequirementIds || []).map(String),
        ...(old16?._id && old29?._id && String(old16._id) !== String(old29._id) ? [String(old29._id)] : [])
      ])]
    } : null;
    prepared = original
      .filter(item => ![16, 29, 30].includes(Number(item?.number)))
      .concat(unifiedPlans ? [unifiedPlans] : [])
      .concat(old30 ? [{ ...old30, number: 29 }] : []);
  }
  const byNumber = new Map(prepared.map(item => [Number(item?.number), item]));
  return REQUIREMENT_TITLES.map((title, index) => {
    const number = index + 1;
    const existing = byNumber.get(number) || {};
    let status = REQUIREMENT_STATUSES.includes(String(existing.status || '').toUpperCase())
      ? String(existing.status).toUpperCase()
      : 'PENDIENTE';
    const guidance = `Información solicitada: ${title}. Describe los datos disponibles y adjunta la documentación correspondiente.`;
    const stripGeneratedGuidance = value => {
      const cleaned = cleanText(value);
      return cleaned === guidance ? '' : cleaned;
    };
    const legacyInformation = stripGeneratedGuidance(existing.information);
    let automaticInformation = defaultRequirementInformation(number, context);
    let automaticStructuredData = defaultRequirementStructuredData(number, context);
    if (number === 25 && automaticStructuredData) {
      const stored = existing.structuredData || {};
      const requiredPct = requiredPresalesPct(stored.requiredPct, 50);
      const phaseValue = Number(automaticStructuredData.phaseValue || 0);
      const startDate = cleanDate(stored.startDate);
      const expiryDate = cleanDate(stored.expiryDate);
      const validity = bondValidity(startDate, expiryDate);
      automaticStructuredData = {
        ...automaticStructuredData,
        requiredPct,
        requiredAmount: phaseValue * requiredPct / 100,
        actualAmount: Math.max(0, Number(stored.actualAmount || 0)),
        bondNumber: cleanText(stored.bondNumber, 240),
        issuer: cleanText(stored.issuer, 240),
        startDate,
        expiryDate,
        alertDaysBefore: alertDays(stored.alertDaysBefore, 30),
        validityStatus: validity.status,
        daysUntilExpiry: validity.daysUntilExpiry
      };
      automaticInformation = phaseValue
        ? `Valor de la fase: B/. ${money(phaseValue)}. Fianza de cumplimiento requerida: ${requiredPct}%.`
        : '';
      status = validity.status === 'CURRENT'
        && automaticStructuredData.requiredAmount > 0
        && automaticStructuredData.actualAmount >= automaticStructuredData.requiredAmount
        ? 'CUMPLIDO'
        : 'PENDIENTE';
    }
    if (number === 26 && automaticStructuredData) {
      const stored = existing.structuredData || {};
      const requiredPct = requiredPresalesPct(stored.requiredPct, 25);
      const phaseValue = Number(automaticStructuredData.phaseValue || 0);
      const startDate = cleanDate(stored.startDate);
      const expiryDate = cleanDate(stored.expiryDate);
      const validity = bondValidity(startDate, expiryDate);
      automaticStructuredData = {
        ...automaticStructuredData,
        requiredPct,
        requiredAmount: phaseValue * requiredPct / 100,
        actualAmount: Math.max(0, Number(stored.actualAmount || 0)),
        bondNumber: cleanText(stored.bondNumber, 240),
        issuer: cleanText(stored.issuer, 240),
        startDate,
        expiryDate,
        alertDaysBefore: alertDays(stored.alertDaysBefore, 30),
        validityStatus: validity.status,
        daysUntilExpiry: validity.daysUntilExpiry
      };
      automaticInformation = phaseValue
        ? `Valor de la fase: B/. ${money(phaseValue)}. Fianza de pago requerida: ${requiredPct}%.`
        : '';
      status = validity.status === 'CURRENT'
        && automaticStructuredData.requiredAmount > 0
        && automaticStructuredData.actualAmount >= automaticStructuredData.requiredAmount
        ? 'CUMPLIDO'
        : 'PENDIENTE';
    }
    if ([27, 29].includes(number) && automaticStructuredData) {
      const stored = existing.structuredData || {};
      const defaultMonths = number === 27 ? 4 : 1;
      const periodicityMonths = Math.max(1, Math.min(120, Math.round(Number(stored.periodicityMonths) || defaultMonths)));
      const lastRecordDate = cleanDate(stored.lastRecordDate);
      const nextReviewDate = lastRecordDate ? addMonthsClamped(lastRecordDate, periodicityMonths) : null;
      automaticStructuredData = {
        ...automaticStructuredData,
        periodicityMonths,
        lastRecordDate,
        nextReviewDate
      };
      status = periodicFollowUpStatus(nextReviewDate);
    }
    const hasAutomaticSource = Boolean(automaticInformation || automaticStructuredData);
    const explicitlyManual = String(existing.sourceKey || '').toLowerCase() === 'manual'
      && Object.prototype.hasOwnProperty.call(existing, 'information');
    const refreshFromBank73 = String(existing.sourceKey || '').toLowerCase() === 'bank73';
    const information = refreshFromBank73
      ? automaticInformation
      : (explicitlyManual ? legacyInformation : (legacyInformation || automaticInformation));
    const sourceKey = refreshFromBank73
      ? (hasAutomaticSource ? 'bank73' : 'manual')
      : cleanText(existing.sourceKey || (hasAutomaticSource ? 'bank73' : 'manual'), 80);
    return {
      ...(existing._id ? { _id: existing._id } : {}),
      ...(existing.legacyRequirementIds?.length ? { legacyRequirementIds: existing.legacyRequirementIds } : {}),
      number,
      title,
      information,
      manualInformation: stripGeneratedGuidance(existing.manualInformation ?? (String(existing.sourceKey || '').toLowerCase() === 'manual' ? existing.information : '')),
      ...(automaticStructuredData ? { structuredData: automaticStructuredData } : (existing.structuredData && !(number === 16 && context.project?.seeksFinancing !== true) ? { structuredData: existing.structuredData } : {})),
      sourceKey,
      sourceLabel: sourceKey === 'bank73' ? (number === 4 ? 'Contexto desde Bank73' : 'Precargado desde Bank73') : 'Entrada manual',
      status,
      observations: cleanText(existing.observations)
    };
  });
}

module.exports = {
  REQUIREMENT_TITLES,
  REQUIREMENT_STATUSES,
  normalizePhaseRequirements,
  defaultRequirementInformation,
  defaultRequirementStructuredData,
  architecturalModelsStructured,
  bondValidity,
  addMonthsClamped,
  periodicFollowUpStatus,
  PROMOTER_EXPERIENCE_FIELDS
};
