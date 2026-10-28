const Project = require('../models/Project');

function plainShareholders(items = []) {
  return (Array.isArray(items) ? items : []).map(item => ({
    name: String(item?.name || '').trim(),
    cedula: String(item?.cedula || '').trim(),
    percentage: Number(item?.percentage) || 0
  }));
}

async function syncPromoterCompaniesToProjects(user) {
  const companies = Array.isArray(user?.promoterProfile?.companies)
    ? user.promoterProfile.companies
    : [];
  const tenantKey = String(user?.tenantKey || '').trim();
  if (!user?._id || !tenantKey || !companies.length) return;

  const operations = companies.map(company => {
    const companyId = String(company?.companyId || company?._id || '').trim();
    if (!companyId) return null;
    return {
      updateMany: {
        filter: {
          tenantKey,
          assignedPromoters: user._id,
          'legalData.promoterEntryMode': 'registered',
          'legalData.promoterCompanyId': companyId
        },
        update: {
          $set: {
            'legalData.promoterName': user.name || user.email || '',
            'legalData.promoterLegalName': company.name || '',
            'legalData.promoterRuc': company.ruc || '',
            'legalData.shareholders': plainShareholders(company.shareholders)
          }
        }
      }
    };
  }).filter(Boolean);

  if (operations.length) await Project.bulkWrite(operations, { ordered: false });
}

async function assertReferencedCompaniesPreserved(user, nextProfile = {}) {
  const previous = Array.isArray(user?.promoterProfile?.companies) ? user.promoterProfile.companies : [];
  const nextIds = new Set((Array.isArray(nextProfile?.companies) ? nextProfile.companies : [])
    .map(company => String(company?.companyId || company?._id || '').trim()).filter(Boolean));
  const removedIds = previous.map(company => String(company?.companyId || company?._id || '').trim())
    .filter(companyId => companyId && !nextIds.has(companyId));
  if (!removedIds.length) return;
  const linkedProject = await Project.findOne({
    tenantKey: user.tenantKey,
    assignedPromoters: user._id,
    'legalData.promoterEntryMode': 'registered',
    'legalData.promoterCompanyId': { $in: removedIds }
  }).select('name').lean();
  if (linkedProject) {
    const err = new Error(`No puedes eliminar una sociedad vinculada al proyecto "${linkedProject.name}".`);
    err.status = 409;
    throw err;
  }
}

module.exports = { syncPromoterCompaniesToProjects, assertReferencedCompaniesPreserved };
