function cloneProject(project) {
  return typeof structuredClone === 'function'
    ? structuredClone(project)
    : JSON.parse(JSON.stringify(project));
}

function authHeaders() {
  const token = localStorage.getItem('tkn') || localStorage.getItem('token');
  const tenant = localStorage.getItem('tenantKey') || 'bancodemo';
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'x-tenant': tenant
  };
}

function withoutUnitRecord(spec) {
  return {
    ...spec,
    bank73UnitId: '',
    commercialStatus: 'unknown',
    price: null,
    listPrice: null,
    salePrice: null,
    progress: { status: 'unknown', percentage: null, phase: '', label: '' },
    finance: {
      status: 'unknown', budgetCost: null, actualCost: null,
      salePrice: null, collected: null, estimatedMargin: null, currency: 'PAB'
    },
    sourceKind: 'bank73-unlinked',
    sourceLabel: 'Sin enlace con la ficha única de Bank73'
  };
}

export function withoutBank73UnitData(baseProject) {
  const project = cloneProject(baseProject);
  project.towers = project.towers.map(tower => ({
    ...tower,
    floors: tower.id === 'C'
      ? tower.floors.map(floor => ({ ...floor, units: floor.units.map(withoutUnitRecord) }))
      : tower.floors
  }));
  return project;
}

export async function loadBank73Project(baseProject, projectId) {
  if (!projectId) return baseProject;
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/viewer-3d`, {
    headers: authHeaders()
  });
  if (!response.ok) throw new Error(`No se pudo cargar el proyecto (${response.status})`);
  const payload = await response.json();
  if (!payload?.enabled || !Array.isArray(payload.units)) return baseProject;

  const project = cloneProject(baseProject);
  const remoteByGeometryKey = new Map(payload.units.map(unit => [String(unit.geometryKey || ''), unit]));
  project.id = payload.project?.id || project.id;
  project.name = payload.project?.name || project.name;
  project.sourceNote = payload.project?.note || project.sourceNote;
  project.viewerSummary = payload.summary || null;
  project.viewerDataVersion = payload.project?.dataVersion || '';
  const towerSettings = new Map((payload.project?.towers || []).map(tower => [String(tower.towerId), tower]));
  project.towers = project.towers.map(tower => {
    const remote = towerSettings.get(String(tower.id)) || {};
    return {
      ...tower,
      name: remote.name || tower.name,
      constructionStatus: remote.constructionStatus || tower.constructionStatus || 'unknown',
      visible: remote.visible !== false,
      appearance: remote.appearance || tower.appearance || 'solid',
      editable: remote.editable === true
    };
  });

  const towerC = project.towers.find(tower => tower.id === 'C');
  towerC.floors.forEach(floor => {
    floor.units = floor.units.map(spec => {
      const remote = remoteByGeometryKey.get(String(spec.unitId));
      if (!remote) return withoutUnitRecord(spec);
      return {
        ...spec,
        unitId: remote.unitId || spec.unitId,
        externalId: remote.unitId || spec.externalId || spec.unitId,
        bank73UnitId: remote.id || '',
        model: remote.model || spec.model,
        type: remote.model ? `Modelo ${remote.model}` : spec.type,
        bedrooms: remote.bedrooms,
        bathrooms: remote.bathrooms,
        closedArea: remote.closedArea,
        balconyArea: remote.openArea,
        totalArea: remote.totalArea,
        price: remote.commercial?.askingPrice,
        listPrice: remote.commercial?.listPrice,
        salePrice: remote.commercial?.salePrice,
        currency: remote.commercial?.currency || 'PAB',
        commercialStatus: remote.commercial?.status || 'unknown',
        progress: remote.progress || { status: 'unknown', percentage: null },
        finance: remote.finance || { status: 'unknown' },
        sourceKind: 'bank73-integrated',
        sourceLabel: remote.sourceLabel || payload.project?.inventorySource || ''
      };
    });
  });
  return project;
}
