export function createUnitData(technicalId, tower, floor, spec) {
  const commercialStatus = spec.commercialStatus || 'unknown';
  return {
    unitId: spec.unitId || technicalId,
    bank73UnitId: spec.bank73UnitId || '',
    technicalId,
    externalId: spec.externalId || null,
    isDemo: false,
    towerId: tower.id,
    floor: floor.level,
    slot: spec.slot,
    apartmentModel: spec.type || null,
    model: spec.model || null,
    bedrooms: spec.bedrooms ?? null,
    closedArea: spec.closedArea ?? null,
    balconyArea: spec.balconyArea ?? null,
    totalArea: spec.totalArea ?? null,
    sourceKind: spec.sourceKind || tower.sourceKind || 'documentary-reference',
    sourceConfidence: spec.sourceConfidence || tower.sourceConfidence || 'unverified-commercial-link',
    interiorAvailable: spec.interiorAvailable !== false,
    progress: spec.progress || { status: 'unknown', percentage: null },
    finance: spec.finance || { status: 'unknown', budgetCost: null, actualCost: null, currency: spec.currency || 'PAB' },
    commercial: {
      status: commercialStatus,
      askingPrice: spec.price ?? null,
      listPrice: spec.listPrice ?? spec.price ?? null,
      salePrice: spec.salePrice ?? null,
      currency: spec.currency || 'PAB'
    },
    sourceLabel: spec.sourceLabel || ''
  };
}
