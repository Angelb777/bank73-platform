'use strict';

function permitStatusBucket(status) {
  const normalized = String(status || '').toLowerCase().trim();
  if (normalized === 'pending') return 'pending';
  if (normalized === 'in_progress' || normalized === 'submitted') return 'inProcess';
  if (normalized === 'approved') return 'approved';
  if (normalized === 'rejected') return 'rejected';
  return null;
}

function permitsByInstitution(items = []) {
  const institutions = new Map();
  for (const item of items) {
    const institution = String(item?.institution || '').trim() || 'N/D';
    if (!institutions.has(institution)) {
      institutions.set(institution, {
        institution,
        pending: 0,
        inProcess: 0,
        approved: 0,
        rejected: 0
      });
    }
    const bucket = permitStatusBucket(item?.status);
    if (bucket) institutions.get(institution)[bucket] += 1;
  }
  return [...institutions.values()].sort((a, b) =>
    (b.pending + b.inProcess + b.approved + b.rejected) -
    (a.pending + a.inProcess + a.approved + a.rejected)
  );
}

module.exports = { permitStatusBucket, permitsByInstitution };
