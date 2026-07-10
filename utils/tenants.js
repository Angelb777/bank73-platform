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
  if (role === 'bank') return assigned;
  return tenantList(user.tenantKey, assigned);
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
  tenantKeyFromBankName
};
