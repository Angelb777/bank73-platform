function tenantList(primary, list) {
  return Array.from(new Set([
    primary,
    ...(Array.isArray(list) ? list : [])
  ].map(v => String(v || '').trim()).filter(Boolean)));
}

function assignedTenantList(user = {}) {
  const role = String(user.role || '').toLowerCase();
  const assigned = Array.isArray(user.tenantKeys)
    ? Array.from(new Set(user.tenantKeys.map(v => String(v || '').trim()).filter(Boolean)))
    : [];
  if (role === 'bank') {
    if (!assigned.length && String(user.tenantKey || '').trim() === 'bancodemo') {
      return ['bancodemo'];
    }
    return assigned;
  }
  return tenantList(user.tenantKey, assigned);
}

function activeAvaluatorBankTenants(user = {}) {
  if (String(user.role || '').toLowerCase() !== 'avaluador') return [];
  const memberships = Array.isArray(user.avaluatorBankMemberships)
    ? user.avaluatorBankMemberships
    : [];
  if (memberships.length) {
    return Array.from(new Set(memberships
      .filter(item => String(item?.status || '').toLowerCase() === 'active')
      .map(item => String(item?.bankTenantKey || '').trim())
      .filter(Boolean)));
  }
  // Compatibilidad con avaluadores creados antes de existir membresias por banco.
  return String(user.status || '').toLowerCase() === 'active'
    ? assignedTenantList(user)
    : [];
}

function tenantKeyFromBankName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

module.exports = {
  tenantList,
  assignedTenantList,
  activeAvaluatorBankTenants,
  tenantKeyFromBankName
};
