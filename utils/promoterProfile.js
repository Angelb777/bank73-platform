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

  const countriesRaw = Array.isArray(input.countries)
    ? input.countries
    : String(input.countries || input.paisesOperacion || '').split(/\r?\n|,/);

  return {
    companyName: String(input.companyName ?? input.sociedad ?? input.nombreSociedad ?? '').trim().slice(0, 180),
    promoterType: normalizePromoterType(input.promoterType ?? input.tipoPromotor ?? input.modeloPromotor),
    yearsExperience: toNum(input.yearsExperience ?? input.aniosExperiencia),
    deliveredProjects: toNum(input.deliveredProjects ?? input.proyectosEntregados),
    activeProjects: toNum(input.activeProjects ?? input.proyectosActivos),
    developedVolume: toNum(input.developedVolume ?? input.volumenDesarrollado ?? input.volumenTotalDesarrollado),
    developedUnits: toNum(input.developedUnits ?? input.unidadesDesarrolladas),
    averageProjectTicket: toNum(input.averageProjectTicket ?? input.ticketMedioProyecto),
    bankFinancingExperience: String(input.bankFinancingExperience ?? input.experienciaFinanciacionBancaria ?? '').trim().slice(0, 240),
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
    countries: Array.from(new Set(countriesRaw.map(x => String(x || '').trim()).filter(Boolean))).slice(0, 20),
    notes: String(input.notes ?? input.notas ?? '').trim().slice(0, 1000)
  };
}

module.exports = { sanitizePromoterProfile };
