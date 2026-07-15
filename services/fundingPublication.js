function opportunityFilterFor({ role, tenantKey } = {}) {
  const published = {
    isVisibleToBanks: true,
    $or: [
      { status: { $in: ['published', 'partially_funded'] } },
      { status: 'approved', publishedAt: { $ne: null } }
    ]
  };
  if (String(role || '').toLowerCase() === 'admin') return published;
  return {
    $and: [published, { $or: [
      { visibilityMode: 'all_banks' },
      { visibilityMode: 'selected_tenants', visibleToTenantKeys: tenantKey },
      { visibilityMode: { $exists: false }, $or: [{ visibleToTenantKeys: { $size: 0 } }, { visibleToTenantKeys: tenantKey }] }
    ] }]
  };
}

function applyPublicationAction(funding, action, { userId, now = new Date() } = {}) {
  if (!action) return funding;
  if (action === 'publish') {
    if (funding.finalScore === null || funding.finalScore === undefined) {
      const error = new Error('Define el scoring final antes de publicar para bancos');
      error.status = 400;
      throw error;
    }
    if (!funding.fundingDeadline) {
      const error = new Error('Define la fecha límite de financiación antes de publicar');
      error.status = 400;
      throw error;
    }
    funding.status = 'published';
    funding.isVisibleToBanks = true;
    funding.publishedAt = now;
    funding.publishedBy = userId;
    return funding;
  }
  if (action === 'withdraw') {
    funding.isVisibleToBanks = false;
    if (funding.status === 'published') funding.status = 'approved';
    return funding;
  }
  const error = new Error('Acción de publicación inválida');
  error.status = 400;
  throw error;
}

module.exports = { opportunityFilterFor, applyPublicationAction };
