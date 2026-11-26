const LegalAcceptance = require('../models/LegalAcceptance');
const { loadLegalBundle } = require('../services/legalDocuments');

async function requireLegalAcceptance(req, res, next) {
  try {
    const bundle = loadLegalBundle();
    if (!bundle.enforced) return next();
    if (!req.user?.userId) return res.status(401).json({ error: 'No autenticado' });

    const accepted = await LegalAcceptance.exists({
      userId: req.user.userId,
      version: bundle.version,
      termsAccepted: true,
      ndaAccepted: true,
      privacyAcknowledged: true,
      'documentHashes.terms': bundle.documents.terms.hash,
      'documentHashes.privacy': bundle.documents.privacy.hash,
      'documentHashes.legalNotice': bundle.documents.legal_notice.hash
    });
    if (accepted) return next();

    return res.status(428).json({
      error: 'legal_acceptance_required',
      version: bundle.version,
      documents: Object.values(bundle.documents).map(document => ({
        type: document.type,
        title: document.title,
        url: document.url,
        hash: document.hash
      }))
    });
  } catch (error) {
    console.error('[legal] acceptance guard error:', error);
    return res.status(500).json({ error: 'No se pudo comprobar la aceptación legal' });
  }
}

module.exports = requireLegalAcceptance;
