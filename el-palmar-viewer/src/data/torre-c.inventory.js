const unit = (unitId, model, closedArea, balconyArea, price, commercialStatus = 'transferred') => ({
  unitId,
  externalId: unitId,
  model,
  type: `Modelo ${model}`,
  bedrooms: null,
  closedArea,
  balconyArea,
  totalArea: closedArea + balconyArea,
  frontageWeight: closedArea,
  commercialStatus,
  price,
  currency: 'PAB',
  sourceKind: 'official-single-source',
  sourceConfidence: 'official-commercial-inventory',
  interiorAvailable: false
});

const floor = (level, storey, units) => ({
  level,
  label: `Nivel ${String(level).padStart(3, '0')}`,
  storey,
  splitAfter: 6,
  coreWidth: 2.95,
  units: units.map((item, index) => ({ ...item, slot: index + 1 }))
});

// Inventario no sensible transcrito de BASE DATOS en el Dato Unico oficial.
// El orden sigue la numeracion comercial de cada nivel.
export const towerCInventoryFloors = [
  floor(-400, 1, [
    unit('L-101', 'A', 65.93, 97.72, 220862.25, 'available'),
    unit('L-102', 'B', 59.94, 19.30, 182000, 'transferred'),
    unit('L-103', 'C', 73.09, 19.95, 236000, 'transferred'),
    unit('L-104', 'C', 73.09, 19.95, 212650, 'transferred'),
    unit('L-105', 'C', 73.09, 19.88, 250000, 'available'),
    unit('L-106', 'C', 73.98, 28.43, 250000, 'transferred'),
    unit('L-107', 'C', 73.09, 22.62, 220000, 'transferred'),
    unit('L-108', 'C', 73.09, 22.62, 217000, 'transferred'),
    unit('L-109', 'C', 73.09, 19.97, 221338.98, 'transferred'),
    unit('L-110', 'C', 73.09, 19.97, 204000, 'transferred'),
    unit('L-111', 'B', 59.94, 19.34, 194230.69, 'available')
  ]),
  floor(-300, 2, [
    unit('L-201', 'A', 65.93, 0, 202000, 'transferred'),
    unit('L-202', 'B', 59.94, 0, 137862, 'transferred'),
    unit('L-203', 'C', 73.09, 0, 179900, 'transferred'),
    unit('L-204', 'C', 73.09, 0, 184000, 'transferred'),
    unit('L-205', 'C', 73.09, 0, 194000, 'transferred'),
    unit('L-206', 'C', 73.98, 0, 204000, 'transferred'),
    unit('L-207', 'C', 73.98, 0, 201000, 'available'),
    unit('L-208', 'C', 73.09, 0, 201000, 'transferred'),
    unit('L-209', 'C', 73.09, 0, 130000, 'transferred'),
    unit('L-210', 'C', 73.09, 0, 180000, 'transferred'),
    unit('L-211', 'B', 59.94, 0, 143389.44, 'transferred'),
    unit('L-212', 'A', 65.93, 0, 185000, 'transferred')
  ]),
  floor(-200, 3, [
    unit('L-301', 'A', 65.93, 0, 202000, 'transferred'),
    unit('L-302', 'B', 59.94, 0, 145000, 'transferred'),
    unit('L-303', 'C1', 73.09, 0, 187000, 'transferred'),
    unit('L-304', 'C1', 73.09, 0, 183000, 'transferred'),
    unit('L-305', 'C1', 73.09, 0, 187976.82, 'sold'),
    unit('L-306', 'C1', 73.98, 0, 198850, 'sold'),
    unit('L-307', 'C1', 73.98, 0, 187000, 'transferred'),
    unit('L-308', 'C1', 73.09, 0, 185000, 'transferred'),
    unit('L-309', 'C1', 73.09, 0, 180000, 'transferred'),
    unit('L-310', 'C1', 73.09, 0, 185000, 'transferred'),
    unit('L-311', 'B', 59.94, 0, 150000, 'transferred'),
    unit('L-312', 'A', 65.93, 0, 172500, 'transferred')
  ]),
  floor(-100, 4, [
    unit('L-401', 'A', 65.93, 0, 160000, 'transferred'),
    unit('L-402', 'B', 59.94, 0, 152500, 'transferred'),
    unit('L-403', 'C1', 73.09, 0, 185270, 'transferred'),
    unit('L-404', 'C1', 73.09, 0, 191892.60, 'transferred'),
    unit('L-405', 'C1', 73.09, 0, 180000, 'transferred'),
    unit('L-406', 'C1', 73.98, 0, 205422.30, 'transferred'),
    unit('L-407', 'D', 110.82, 0, 299000, 'transferred'),
    unit('L-408', 'D', 109.27, 0, 250000, 'transferred'),
    unit('L-409', 'C1', 73.09, 0, 205000, 'transferred'),
    unit('L-410', 'B', 59.94, 0, 146853, 'transferred'),
    unit('L-411', 'A', 65.93, 0, 161528.50, 'transferred')
  ]),
  floor('000', 5, [
    unit('L-501', 'A', 65.93, 0, 168121.50, 'transferred'),
    unit('L-502', 'B', 59.94, 0, 170000, 'transferred'),
    unit('L-503', 'C1', 73.09, 0, 205107.09, 'transferred'),
    unit('L-504', 'C1', 73.09, 0, 204500, 'transferred'),
    unit('L-505', 'C1', 73.09, 0, 186379.50, 'transferred'),
    unit('L-506', 'C1', 73.96, 0, 209100, 'transferred'),
    unit('L-507', 'D', 110.82, 0, 270000, 'transferred'),
    unit('L-508', 'D', 109.27, 0, 278683.50, 'transferred'),
    unit('L-509', 'C1', 73.09, 0, 186379.50, 'transferred'),
    unit('L-510', 'B', 59.94, 0, 150000, 'transferred'),
    unit('L-511', 'A', 65.93, 0, 168121.50, 'transferred')
  ])
];
