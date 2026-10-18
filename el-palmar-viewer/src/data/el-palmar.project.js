// Source hierarchy:
// 1. Approved, stamped architectural set (2011): dimensions, levels, counts.
// 2. 2023 Torre C studies: visual reference only; explicitly not approved.
// 3. Apartment renders A-D: visual reference; mapping to approved types unverified.

const highRiseTypicalFloors = Array.from({ length: 22 }, (_, index) => ({
  level: (index + 1) * 100,
  label: `Nivel ${(index + 1) * 100}`,
  storey: index + 1,
  units: [
    { slot: 1, bedrooms: 2, type: '2 recámaras' },
    { slot: 2, bedrooms: 1, type: '1 recámara' },
    { slot: 3, bedrooms: 1, type: '1 recámara' },
    { slot: 4, bedrooms: 2, type: '2 recámaras' }
  ]
}));

const highRiseUpperFloors = [2300, 2400, 2500].map((level, index) => ({
  level,
  label: `Nivel ${level}`,
  storey: 23 + index,
  units: [
    { slot: 1, bedrooms: 3, type: '3 recámaras' },
    { slot: 2, bedrooms: 3, type: '3 recámaras' }
  ]
}));

const highRisePenthouse = {
  level: 2600,
  label: 'Nivel 2600 · PH',
  storey: 26,
  storeySpan: 3,
  units: [
    { slot: 1, bedrooms: null, type: 'PH' },
    { slot: 2, bedrooms: null, type: 'PH' }
  ]
};

function highRiseTower(id, x) {
  return {
    id,
    name: `Torre ${id}`,
    kind: 'highrise',
    position: [x, 11, -10],
    rotationY: 0,
    footprint: { width: 27.15, depth: 19.5, confidence: 'approved' },
    floorHeight: 2.75,
    roofLevel: 2900,
    floors: [...highRiseTypicalFloors, ...highRiseUpperFloors, highRisePenthouse],
    facade: 'approved-massing'
  };
}

export const elPalmarProject = {
  id: 'el-palmar',
  name: 'Residencial El Palmar',
  sourceStatus: 'current-tower-c-inventory-with-documentary-massing',
  sourceNote: 'Torre C actualizada con el Dato Único oficial de 57 unidades; geometría y acabados simplificados.',
  coordinateSystem: 'Dimensiones arquitectónicas en metros; emplazamiento relativo aproximado.',
  documentation: {
    approvedSet: 'PLANOS ARQUITECTURA EL PALMAR  TORRE A-B -C APROBADOS.pdf',
    approvedDate: '2011-03-02',
    legacyApprovedTotalUnits: 231,
    representedUnits: 249,
    towerCCommercialUnits: 57,
    caveats: [
      'Los identificadores comerciales de Torre C proceden del Dato Único oficial.',
      'Las torres A y B conservan la volumetría documental de 2011 y no tienen enlace comercial.',
      'La posición relativa fina de A/B respecto a C se aproxima desde plantas generales y renders.',
      'Las propuestas de fachada, balcones y azotea de 2023 no se tratan como aprobadas.'
    ]
  },
  towers: [
    highRiseTower('A', -17.2),
    highRiseTower('B', 17.2),
    {
      id: 'C',
      name: 'Torre C',
      kind: 'terracedBar',
      position: [0, 0, 9],
      rotationY: 0,
      footprint: { width: 65.9, depth: 11, confidence: 'approved-width-depth-approximate' },
      floorHeight: 2.75,
      floors: towerCInventoryFloors,
      sourceKind: 'official-single-source',
      sourceConfidence: 'official-commercial-inventory',
      facade: 'approved-massing'
    }
  ]
};
import { towerCInventoryFloors } from './torre-c.inventory.js';

