const crypto = require('crypto');
const fs = require('fs');
const { DOCUMENT_VERSION, DOCUMENTS_APPROVED, ACCEPTANCE_ENFORCED, documents } = require('../config/legal');

let cachedBundle;

function documentUrl(type) {
  if (type === 'legal_notice') return '/legal/legal-notice';
  return `/legal/${type}`;
}

function loadLegalBundle() {
  if (cachedBundle) return cachedBundle;

  const loaded = Object.fromEntries(Object.entries(documents).map(([key, definition]) => {
    const content = fs.readFileSync(definition.file, 'utf8');
    const hash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    return [key, Object.freeze({
      type: definition.type,
      title: definition.title,
      version: DOCUMENT_VERSION,
      status: DOCUMENTS_APPROVED ? 'approved' : 'draft',
      url: documentUrl(definition.type),
      content,
      hash
    })];
  }));

  cachedBundle = Object.freeze({
    version: DOCUMENT_VERSION,
    status: DOCUMENTS_APPROVED ? 'approved' : 'draft',
    acceptanceEnabled: DOCUMENTS_APPROVED,
    enforced: ACCEPTANCE_ENFORCED,
    documents: Object.freeze(loaded)
  });
  return cachedBundle;
}

function publicBundle({ includeContent = false } = {}) {
  const bundle = loadLegalBundle();
  return {
    version: bundle.version,
    status: bundle.status,
    acceptanceEnabled: bundle.acceptanceEnabled,
    enforced: bundle.enforced,
    documents: Object.values(bundle.documents).map(document => ({
      type: document.type,
      title: document.title,
      version: document.version,
      status: document.status,
      url: document.url,
      hash: document.hash,
      ...(includeContent ? { content: document.content } : {})
    }))
  };
}

module.exports = { loadLegalBundle, publicBundle };
