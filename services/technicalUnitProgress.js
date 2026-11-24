'use strict';

const HORIZONTAL_ACTIVITIES = [
  'Movimiento de tierra y cimentación',
  'Estructura',
  'Mampostería y divisiones',
  'Cubierta e impermeabilización',
  'Repellos y paredes',
  'Fontanería e instalaciones sanitarias',
  'Instalaciones eléctricas',
  'Pisos y revestimientos',
  'Carpintería',
  'Aluminio y vidrios',
  'Cielos y gypsum',
  'Pintura',
  'Puertas y ventanas',
  'Cocina y mobiliario fijo',
  'Aparatos sanitarios',
  'Obras exteriores y conexiones',
  'Terminaciones y limpieza'
];

const VERTICAL_ACTIVITIES = [
  'Mampostería y divisiones',
  'Instalaciones sanitarias',
  'Instalaciones eléctricas',
  'Climatización y ventilación',
  'Sistema contra incendios',
  'Repellos y paredes',
  'Cielos y gypsum',
  'Pisos y revestimientos',
  'Carpintería',
  'Aluminio y vidrios',
  'Puertas',
  'Cocina y armarios',
  'Aparatos sanitarios',
  'Pintura',
  'Terminaciones y limpieza'
];

function clampPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 0;
}

function templateForProjectType(projectType = '') {
  const normalized = String(projectType || '').toLowerCase();
  const vertical = normalized.includes('vertical') || normalized.includes('torre') || normalized.includes('apartamento');
  return { kind: vertical ? 'vertical' : 'horizontal', names: vertical ? VERTICAL_ACTIVITIES : HORIZONTAL_ACTIVITIES };
}

function activityAverage(activities = []) {
  const applicable = activities.filter(activity => activity.applicable !== false);
  if (!applicable.length) return 0;
  return Math.round((applicable.reduce((sum, activity) => sum + clampPercent(activity.progressPercent), 0) / applicable.length) * 100) / 100;
}

function normalizeUnitTechnicalProgress({ projectType = '', stored = null, submitted = null, initialProgress = 0 } = {}) {
  const template = templateForProjectType(projectType);
  const source = Array.isArray(submitted) ? submitted : (Array.isArray(stored?.activities) ? stored.activities : []);
  const byKey = new Map(source.map(activity => [String(activity?.key || ''), activity]));
  const seed = clampPercent(initialProgress);
  const activities = template.names.map((name, order) => {
    const key = `activity_${order + 1}`;
    const saved = byKey.get(key);
    return {
      key,
      name,
      order,
      progressPercent: saved ? clampPercent(saved.progressPercent) : seed,
      applicable: saved?.applicable !== false
    };
  });
  return {
    templateKind: template.kind,
    activities,
    progressPercent: activityAverage(activities),
    observations: String(stored?.observations || '').trim().slice(0, 3000)
  };
}

module.exports = {
  HORIZONTAL_ACTIVITIES,
  VERTICAL_ACTIVITIES,
  templateForProjectType,
  activityAverage,
  normalizeUnitTechnicalProgress
};
