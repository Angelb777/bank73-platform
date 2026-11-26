const express = require('express');
const auth = require('../middleware/auth');
const LegalAcceptance = require('../models/LegalAcceptance');
const Tenant = require('../models/Tenant');
const audit = require('../utils/audit');
const { loadLegalBundle, publicBundle } = require('../services/legalDocuments');

const router = express.Router();

function requestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return forwarded ? String(forwarded).split(',')[0].trim() : (req.ip || req.socket?.remoteAddress || '');
}

function bundleHashes(bundle) {
  return {
    terms: bundle.documents.terms.hash,
    privacy: bundle.documents.privacy.hash,
    legalNotice: bundle.documents.legal_notice.hash
  };
}

function hashesMatch(acceptance, hashes) {
  return acceptance?.documentHashes?.terms === hashes.terms &&
    acceptance?.documentHashes?.privacy === hashes.privacy &&
    acceptance?.documentHashes?.legalNotice === hashes.legalNotice;
}

router.get('/documents', (req, res) => res.json(publicBundle({ includeContent: req.query.content === '1' })));

router.get('/documents/:type', (req, res) => {
  const document = loadLegalBundle().documents[String(req.params.type || '')];
  if (!document) return res.status(404).json({ error: 'Documento legal no encontrado' });
  res.type('text/markdown; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.send(document.content);
});

router.get('/status', auth, async (req, res) => {
  try {
    const bundle = loadLegalBundle();
    const hashes = bundleHashes(bundle);
    const acceptance = await LegalAcceptance.findOne({
      userId: req.user.userId,
      version: bundle.version,
      'documentHashes.terms': hashes.terms,
      'documentHashes.privacy': hashes.privacy,
      'documentHashes.legalNotice': hashes.legalNotice
    }).lean();

    return res.json({
      ...publicBundle(),
      accepted: !!acceptance,
      acceptedAt: acceptance?.acceptedAt || null,
      required: bundle.enforced && !acceptance
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/accept', auth, async (req, res) => {
  try {
    const bundle = loadLegalBundle();
    if (!bundle.acceptanceEnabled) {
      return res.status(409).json({ error: 'legal_documents_not_approved' });
    }

    const requestedVersion = String(req.body?.version || '');
    if (requestedVersion !== bundle.version) {
      return res.status(409).json({ error: 'legal_document_version_changed', version: bundle.version });
    }
    if (req.body?.termsAccepted !== true || req.body?.ndaAccepted !== true || req.body?.privacyAcknowledged !== true) {
      return res.status(400).json({ error: 'Debes aceptar los términos y el NDA y confirmar la lectura de la política de privacidad.' });
    }

    const tenantKey = String(req.user.tenantKey || req.tenantKey || '').trim();
    const tenant = tenantKey ? await Tenant.findOne({ tenantKey }).select('name').lean() : null;
    const channel = String(req.body?.channel || '').toLowerCase() === 'mobile' ? 'mobile' : 'web';
    const documentHashes = bundleHashes(bundle);
    const existing = await LegalAcceptance.findOne({ userId: req.user.userId, version: bundle.version }).lean();
    if (existing) {
      if (!hashesMatch(existing, documentHashes)) {
        return res.status(409).json({ error: 'legal_document_content_changed_without_new_version' });
      }
      return res.json({ ok: true, version: existing.version, acceptedAt: existing.acceptedAt });
    }

    const acceptance = await LegalAcceptance.findOneAndUpdate(
      { userId: req.user.userId, version: bundle.version },
      {
        $setOnInsert: {
          termsAccepted: true,
          ndaAccepted: true,
          privacyAcknowledged: true,
          acceptedAt: new Date(),
          tenantKeyAtAcceptance: tenantKey,
          tenantNameAtAcceptance: String(tenant?.name || ''),
          documentHashes,
          ip: requestIp(req),
          userAgent: String(req.headers['user-agent'] || '').slice(0, 1000),
          channel
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    await audit(req, 'legal.acceptance_recorded', {
      targetType: 'user',
      targetId: req.user.userId,
      message: `Aceptación legal ${bundle.version}`,
      metadata: { version: bundle.version, channel, documentHashes }
    });

    return res.status(201).json({ ok: true, version: bundle.version, acceptedAt: acceptance.acceptedAt });
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await LegalAcceptance.findOne({ userId: req.user.userId, version: loadLegalBundle().version }).lean();
      if (!hashesMatch(existing, bundleHashes(loadLegalBundle()))) {
        return res.status(409).json({ error: 'legal_document_content_changed_without_new_version' });
      }
      return res.json({ ok: true, version: existing.version, acceptedAt: existing.acceptedAt });
    }
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
