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

export async function loadBank73Project(baseProject, projectId) {
  if (!projectId) return baseProject;
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/viewer-3d`, {
    headers: authHeaders()
  });
  if (!response.ok) throw new Error(`No se pudo cargar el proyecto (${response.status})`);
  const payload = await response.json();
  if (!payload?.enabled || !Array.isArray(payload.units)) return baseProject;

  const project = cloneProject(baseProject);
  const remoteById = new Map(payload.units.map(unit => [unit.unitId, unit]));
  project.id = payload.project?.id || project.id;
  project.name = payload.project?.name || project.name;
  project.sourceNote = payload.project?.note || project.sourceNote;
  project.viewerSummary = payload.summary || null;
  project.viewerDataVersion = payload.project?.dataVersion || '';

  const towerC = project.towers.find(tower => tower.id === 'C');
  towerC.floors.forEach(floor => {
    floor.units = floor.units.map(spec => {
      const remote = remoteById.get(spec.unitId);
      if (!remote) return spec;
      return {
        ...spec,
        bank73UnitId: remote.id || '',
        model: remote.model || spec.model,
        type: remote.model ? `Modelo ${remote.model}` : spec.type,
        bedrooms: remote.bedrooms,
        bathrooms: remote.bathrooms,
        closedArea: remote.closedArea,
        balconyArea: remote.openArea,
        totalArea: remote.totalArea,
        price: remote.commercial?.askingPrice,
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
