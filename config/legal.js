const path = require('path');

const DOCUMENT_VERSION = String(process.env.LEGAL_DOCUMENT_VERSION || 'draft-0.1').trim();
const DOCUMENTS_APPROVED = process.env.LEGAL_DOCUMENTS_APPROVED === '1';
const ACCEPTANCE_ENFORCED = DOCUMENTS_APPROVED && process.env.LEGAL_ACCEPTANCE_ENFORCED === '1';

const documents = Object.freeze({
  terms: {
    type: 'terms',
    title: 'Términos y condiciones de uso y acuerdo de confidencialidad',
    file: path.join(__dirname, '..', 'legal', 'terms.md')
  },
  privacy: {
    type: 'privacy',
    title: 'Política de privacidad y protección de datos',
    file: path.join(__dirname, '..', 'legal', 'privacy.md')
  },
  legal_notice: {
    type: 'legal_notice',
    title: 'Aviso legal',
    file: path.join(__dirname, '..', 'legal', 'legal-notice.md')
  }
});

module.exports = {
  DOCUMENT_VERSION,
  DOCUMENTS_APPROVED,
  ACCEPTANCE_ENFORCED,
  documents
};
