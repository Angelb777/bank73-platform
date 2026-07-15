const num = value => Number(value) || 0;
const ratio = (value, target, points) => target > 0 ? Math.max(0, Math.min(points, value / target * points)) : 0;
const { financingMetrics } = require('./fundingMetrics');

function calculateFundingScore({ project = {}, promoter = {}, permits = [], units = [], sales = [], finance = {}, requestedAmount }) {
  const profile = promoter.promoterProfile || {};
  const metrics = financingMetrics(project, finance);
  const legal = project.legalData?.assessment || {};
  const technical = project.technicalData?.assessment || {};
  const permitItems = permits.flatMap(p => p.items || []);
  const approvedPermits = permitItems.filter(p => p.status === 'approved').length;
  const legalChecks = ['landOwned','purchaseOptionOrPromise','titleVerified','zoningApproved','licensesRequested','licensesApproved','legalOpinionAttached'].filter(key => legal[key]).length + (legal.relevantEncumbrances ? 0 : 1);
  const total = metrics.totalCost;
  const requested = num(requestedAmount) || metrics.requestedAmount;
  const own = metrics.promoterContribution;
  const already = metrics.alreadyFinanced;
  const revenue = units.reduce((sum, unit) => sum + num(unit.precioLista || unit.price), 0);
  const items = [];
  const add = (key, label, category, score, maxScore, reason) => items.push({ key, label, category, automaticScore: Math.round(score * 100) / 100, maxScore, manualScore: null, reason });
  add('experience', 'Experiencia del promotor', 'promoter', ratio(num(profile.yearsExperience), 15, 10), 10, `${num(profile.yearsExperience)} años`);
  add('track_record', 'Proyectos y volumen desarrollados', 'promoter', Math.min(10, ratio(num(profile.deliveredProjects), 15, 6) + ratio(num(profile.developedVolume), 50000000, 4)), 10, `${num(profile.deliveredProjects)} proyectos entregados`);
  add('project', 'Definición y ubicación', 'project', (project.location ? 4 : 0) + (project.projectType ? 4 : 0), 8, project.location || 'Ubicación no informada');
  add('legal', 'Situación jurídica', 'legal', legalChecks / 8 * 14, 14, `${legalChecks}/8 comprobaciones favorables`);
  add('permits', 'Permisos y planeamiento', 'legal', permitItems.length ? approvedPermits / permitItems.length * 10 : (legal.licensesApproved ? 10 : 0), 10, `${approvedPermits}/${permitItems.length} permisos aprobados`);
  add('technical', 'Madurez técnica', 'technical', Object.values(technical).filter(Boolean).length / 7 * 13, 13, `${Object.values(technical).filter(Boolean).length}/7 comprobaciones`);
  add('equity', 'Aporte propio', 'financial', total ? ratio(own / total, .3, 12) : 0, 12, total ? `${Math.round(own / total * 100)}% del coste` : 'Coste no informado');
  add('funding', 'Cobertura financiera actual', 'financial', total ? ratio(already / total, .5, 8) : 0, 8, total ? `${Math.round(already / total * 100)}% financiado` : 'Coste no informado');
  add('sales', 'Ingresos y avance comercial', 'commercial', revenue > 0 ? Math.min(10, 4 + ratio(sales.length, Math.max(units.length, 1), 6)) : 0, 10, `${sales.length}/${units.length} operaciones`);
  add('request_fit', 'Coherencia de la solicitud', 'financial', total > 0 && requested > 0 && requested <= total ? 5 : 0, 5, `Solicitud ${requested} sobre coste ${total}`);
  return { automaticScore: Math.round(items.reduce((sum, item) => sum + item.automaticScore, 0) * 100) / 100, scoreVersion: '1.0', scoreBreakdown: items };
}
module.exports = { calculateFundingScore };
