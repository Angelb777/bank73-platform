const ROLES = [
  'admin',
  'bank',
  'promoter',
  'commercial',
  'gerencia',
  'socios',
  'contable',
  'financiero',
  'legal',
  'tecnico',
  'avaluador'
];

const FULL_ACCESS_ROLES = [
  'admin',
  'bank',
  'promoter',
  'gerencia',
  'socios',
  'financiero',
  'contable',
  'legal'
];

const PROJECT_EDITOR_ROLES = [
  'admin',
  'promoter',
  'gerencia',
  'socios',
  'financiero',
  'contable',
  'legal'
];

const PROJECT_MEDIA_EDITOR_ROLES = [...PROJECT_EDITOR_ROLES, 'bank'];

const LIMITED_AREA_ROLES = ['commercial', 'tecnico'];
const DOC_DEPARTMENTS = ['commercial', 'tecnico', 'legal'];

function normRole(value) {
  return String(value || '').toLowerCase().trim();
}

function isFullAccessRole(value) {
  return FULL_ACCESS_ROLES.includes(normRole(value));
}

function isLimitedAreaRole(value) {
  return LIMITED_AREA_ROLES.includes(normRole(value));
}

function visibleDocDepartments(roleRaw) {
  const role = normRole(roleRaw);

  if ([...FULL_ACCESS_ROLES, 'legal', 'avaluador'].includes(role)) {
    return ['commercial', 'tecnico', 'legal'];
  }
  if (role === 'commercial') return ['commercial'];
  if (role === 'tecnico') return ['tecnico'];
  return [];
}

module.exports = {
  ROLES,
  FULL_ACCESS_ROLES,
  PROJECT_EDITOR_ROLES,
  PROJECT_MEDIA_EDITOR_ROLES,
  LIMITED_AREA_ROLES,
  DOC_DEPARTMENTS,
  normRole,
  isFullAccessRole,
  isLimitedAreaRole,
  visibleDocDepartments
};
