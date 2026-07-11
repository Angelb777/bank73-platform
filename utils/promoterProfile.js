const { PROMOTER_TYPES = [] } = require('../models/User');

function sanitizePromoterProfile(input = {}, options = {}) {
  const { requireAny = false, strictNumbers = false } = options;
  const hasAny = input && typeof input === 'object' && Object.values(input).some(v => {
    if (Array.isArray(v)) return v.length > 0;
    return v !== undefined && v !== null && String(v).trim() !== '';
  });
  if (requireAny && !hasAny) return undefined;

  const toNum = (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(String(v).replace(/,/g, ''));
    if (Number.isFinite(n) && n >= 0) return n;
    if (strictNumbers) {
      const err = new Error('Los campos numéricos del perfil del promotor deben ser positivos.');
      err.status = 400;
      throw err;
    }
    return null;
  };

  const normalizePromoterType = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return 'No definido';
    const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const found = PROMOTER_TYPES.find(type =>
      type.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === normalized
    );
    return found || 'No definido';
  };

  const normalizeYesNo = (value) => {
    const normalized = String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (['si', 'sí', 'yes', 'true'].includes(normalized)) return 'Sí';
    if (['no', 'false'].includes(normalized)) return 'No';
    return '';
  };

  const countriesRaw = Array.isArray(input.countries)
    ? input.countries
    : String(input.countries || input.paisesOperacion || '').split(/\r?\n|,/);

  const currentYear = new Date().getFullYear();
  let companies = (Array.isArray(input.companies) ? input.companies : []).map(company => ({
    name: String(company?.name ?? company?.companyName ?? '').trim().slice(0, 180),
    incorporationYear: toNum(company?.incorporationYear ?? company?.year),
    isPrimary: !!company?.isPrimary
  })).filter(company => company.name || company.incorporationYear !== null);
  const legacyName = String(input.companyName ?? input.sociedad ?? input.nombreSociedad ?? '').trim().slice(0, 180);
  const legacyYear = toNum(input.incorporationYear ?? input.anioConstitucion);
  if (!companies.length && (legacyName || legacyYear !== null)) {
    companies = [{ name: legacyName, incorporationYear: legacyYear, isPrimary: true }];
  }
  if (companies.some(company => !company.name || !Number.isInteger(company.incorporationYear) || company.incorporationYear < 1800 || company.incorporationYear > currentYear)) {
    const err = new Error(`Cada sociedad debe tener nombre y un año de constitución entre 1800 y ${currentYear}.`);
    err.status = 400;
    throw err;
  }
  if (companies.length) {
    const primaryIndex = companies.findIndex(company => company.isPrimary);
    companies = companies.slice(0, 30).map((company, index) => ({ ...company, isPrimary: index === (primaryIndex >= 0 ? primaryIndex : 0) }));
  }
  const primaryCompany = companies.find(company => company.isPrimary) || companies[0];
  const sanitizeTeamContact = (area) => {
    const contact = input.teamContacts?.[area] || {};
    return {
      fullName: String(contact.fullName || '').trim().slice(0, 160),
      title: String(contact.title || '').trim().slice(0, 120),
      relationship: String(contact.relationship || '').trim().slice(0, 40),
      email: String(contact.email || '').trim().toLowerCase().slice(0, 180),
      phone: String(contact.phone || '').trim().slice(0, 50)
    };
  };

  return {
    companyName: primaryCompany?.name || legacyName,
    incorporationYear: primaryCompany?.incorporationYear ?? legacyYear,
    companies,
    promoterType: normalizePromoterType(input.promoterType ?? input.tipoPromotor ?? input.modeloPromotor),
    yearsExperience: toNum(input.yearsExperience ?? input.aniosExperiencia),
    deliveredProjects: toNum(input.deliveredProjects ?? input.proyectosEntregados),
    activeProjects: toNum(input.activeProjects ?? input.proyectosActivos),
    developedVolume: toNum(input.developedVolume ?? input.volumenDesarrollado ?? input.volumenTotalDesarrollado),
    developedUnits: toNum(input.developedUnits ?? input.unidadesDesarrolladas),
    averageProjectTicket: toNum(input.averageProjectTicket ?? input.ticketMedioProyecto),
    bankFinancingExperience: normalizeYesNo(input.bankFinancingExperience ?? input.experienciaFinanciacionBancaria),
    banksWorkedWith: Array.from(new Set((Array.isArray(input.banksWorkedWith)
      ? input.banksWorkedWith
      : String(input.banksWorkedWith || input.bancosTrabajados || '').split(/\r?\n|,/))
      .map(x => String(x || '').trim()).filter(Boolean))).slice(0, 30),
    onTimeDeliveryHistory: String(input.onTimeDeliveryHistory ?? input.historialEntregasTiempo ?? '').trim().slice(0, 240),
    incidentHistory: String(input.incidentHistory ?? input.historialIncidencias ?? '').trim().slice(0, 240),
    documentationLevel: String(input.documentationLevel ?? input.nivelDocumentacion ?? '').trim().slice(0, 120),
    internalTeam: {
      technical: !!(input.internalTeam?.technical ?? input.equipoTecnico),
      financial: !!(input.internalTeam?.financial ?? input.equipoFinanciero),
      commercial: !!(input.internalTeam?.commercial ?? input.equipoComercial),
      legal: !!(input.internalTeam?.legal ?? input.equipoLegal)
    },
    teamContacts: {
      technical: sanitizeTeamContact('technical'),
      financial: sanitizeTeamContact('financial'),
      commercial: sanitizeTeamContact('commercial'),
      legal: sanitizeTeamContact('legal')
    },
    countries: Array.from(new Set(countriesRaw.map(x => String(x || '').trim()).filter(Boolean))).slice(0, 20),
    notes: String(input.notes ?? input.notas ?? '').trim().slice(0, 1000)
  };
}

module.exports = { sanitizePromoterProfile };
