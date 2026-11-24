'use strict';

const TECHNICAL_COMMON_AREA_TEMPLATES = [
  {
    key: 'urbanizacion',
    name: 'Urbanización y viales',
    activities: [
      ['movimiento_tierra', 'Movimiento de tierra'],
      ['viales', 'Viales y pavimentos'],
      ['aceras_bordillos', 'Aceras y bordillos'],
      ['drenaje_vial', 'Drenaje vial'],
      ['senalizacion', 'Señalización y demarcación']
    ]
  },
  {
    key: 'infraestructura',
    name: 'Infraestructura y redes',
    activities: [
      ['agua_potable', 'Red de agua potable'],
      ['alcantarillado', 'Alcantarillado sanitario'],
      ['drenaje_pluvial', 'Drenaje pluvial'],
      ['red_electrica', 'Red eléctrica'],
      ['telecomunicaciones', 'Telecomunicaciones'],
      ['alumbrado', 'Alumbrado exterior']
    ]
  },
  {
    key: 'zonas_comunes',
    name: 'Zonas comunes y amenidades',
    activities: [
      ['casa_club', 'Casa club o salón social'],
      ['piscina', 'Piscina'],
      ['areas_deportivas', 'Áreas deportivas'],
      ['areas_infantiles', 'Áreas infantiles'],
      ['banos_servicios', 'Baños y servicios comunes'],
      ['mobiliario', 'Mobiliario y equipamiento']
    ]
  },
  {
    key: 'exteriores',
    name: 'Exteriores y paisajismo',
    activities: [
      ['paisajismo', 'Paisajismo'],
      ['riego', 'Sistema de riego'],
      ['cerramientos', 'Cerramientos y muros'],
      ['mobiliario_urbano', 'Mobiliario urbano'],
      ['limpieza_exterior', 'Terminaciones y limpieza exterior']
    ]
  },
  {
    key: 'seguridad',
    name: 'Seguridad y accesibilidad',
    activities: [
      ['garita_acceso', 'Garita y control de acceso'],
      ['videovigilancia', 'Videovigilancia'],
      ['accesibilidad', 'Rampas y accesibilidad'],
      ['senalizacion_emergencia', 'Señalización de emergencia'],
      ['proteccion_incendios', 'Protección contra incendios']
    ]
  }
];

function clampPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 0;
}

function activityAverage(activities = []) {
  const applicable = activities.filter(activity => activity.applicable !== false);
  if (!applicable.length) return 0;
  return Math.round((applicable.reduce((sum, activity) => sum + clampPercent(activity.progressPercent), 0) / applicable.length) * 100) / 100;
}

function normalizeTechnicalCommonAreas(stored = []) {
  const storedAreas = new Map((Array.isArray(stored) ? stored : []).map(area => [String(area?.key || ''), area]));
  return TECHNICAL_COMMON_AREA_TEMPLATES.map(template => {
    const savedArea = storedAreas.get(template.key) || {};
    const savedActivities = new Map((Array.isArray(savedArea.activities) ? savedArea.activities : []).map(activity => [String(activity?.key || ''), activity]));
    const activities = template.activities.map(([key, name], order) => {
      const saved = savedActivities.get(key) || {};
      return {
        key,
        name,
        order,
        progressPercent: clampPercent(saved.progressPercent),
        applicable: saved.applicable !== false
      };
    });
    return {
      key: template.key,
      name: template.name,
      progressPercent: activityAverage(activities),
      observations: String(savedArea.observations || '').trim().slice(0, 3000),
      activities
    };
  });
}

function overallCommonAreaProgress(areas = []) {
  const applicable = areas.filter(area => area.activities?.some(activity => activity.applicable !== false));
  if (!applicable.length) return 0;
  return Math.round((applicable.reduce((sum, area) => sum + clampPercent(area.progressPercent), 0) / applicable.length) * 100) / 100;
}

module.exports = {
  TECHNICAL_COMMON_AREA_TEMPLATES,
  normalizeTechnicalCommonAreas,
  overallCommonAreaProgress
};
