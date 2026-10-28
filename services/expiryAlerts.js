function expiryDateOnly(value) {
  if (!value) return '';
  const raw = value instanceof Date ? value.toISOString() : String(value);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : '';
}

function expiryAlertKey(kind, sourceId, due) {
  const normalizedKind = String(kind || '').trim();
  const normalizedSourceId = String(sourceId || '').trim();
  const normalizedDue = expiryDateOnly(due);
  if (!normalizedKind || !normalizedSourceId || !normalizedDue) return '';
  return `${normalizedKind}:${normalizedSourceId}:${normalizedDue}`;
}

function resolvedExpiryAlertKeys(project = {}) {
  return new Set(
    (project.expiryAlertResolutions || [])
      .map(item => String(item?.key || expiryAlertKey(item?.kind, item?.sourceId, item?.due)).trim())
      .filter(Boolean)
  );
}

function isExpiryAlertResolved(resolvedKeys, kind, sourceId, due) {
  const key = expiryAlertKey(kind, sourceId, due);
  return !!key && resolvedKeys?.has(key);
}

module.exports = {
  expiryDateOnly,
  expiryAlertKey,
  resolvedExpiryAlertKeys,
  isExpiryAlertResolved
};
