(() => {
  const protectedPage = document.body?.dataset?.legalProtected === 'true';

  function addLinks() {
    if (document.querySelector('[data-legal-links]')) return;
    const nav = document.createElement('nav');
    nav.className = 'legal-links legal-page-footer';
    nav.dataset.legalLinks = 'true';
    nav.setAttribute('aria-label', 'Información legal');
    nav.innerHTML = '<a href="/legal/terms">Términos y NDA</a><a href="/legal/privacy">Privacidad</a><a href="/legal/legal-notice">Aviso legal</a>';
    document.body.appendChild(nav);
  }

  function gateMarkup(status) {
    const root = document.createElement('div');
    root.className = 'legal-gate';
    root.setAttribute('role', 'presentation');
    root.innerHTML = `
      <section class="legal-gate-dialog" role="dialog" aria-modal="true" aria-labelledby="legalGateTitle">
        <h2 id="legalGateTitle">Revisión y aceptación legal</h2>
        <p>Antes de continuar debes revisar la versión ${String(status.version || '')} de los documentos de BANK73.</p>
        <div class="legal-gate-documents">
          <a href="/legal/terms" target="_blank" rel="noopener">Términos y NDA</a>
          <a href="/legal/privacy" target="_blank" rel="noopener">Política de privacidad</a>
          <a href="/legal/legal-notice" target="_blank" rel="noopener">Aviso legal</a>
        </div>
        <label class="legal-gate-check"><input id="legalTermsCheck" type="checkbox"> <span>He leído y acepto los Términos y condiciones, incluido el acuerdo de confidencialidad.</span></label>
        <label class="legal-gate-check"><input id="legalPrivacyCheck" type="checkbox"> <span>Confirmo que he leído la Política de privacidad y protección de datos.</span></label>
        <p class="legal-gate-message" aria-live="polite"></p>
        <div class="legal-gate-actions"><button type="button" class="btn ghost" data-legal-logout>Cerrar sesión</button><button type="button" class="btn" data-legal-accept disabled>Aceptar y continuar</button></div>
      </section>`;
    return root;
  }

  async function checkAcceptance() {
    if (!protectedPage || !window.API?.getToken?.()) return;
    const status = await API.getSilent('/api/legal/status');
    if (!status || status.ok === false || !status.required) return;

    const gate = gateMarkup(status);
    document.body.appendChild(gate);
    const terms = gate.querySelector('#legalTermsCheck');
    const privacy = gate.querySelector('#legalPrivacyCheck');
    const accept = gate.querySelector('[data-legal-accept]');
    const message = gate.querySelector('.legal-gate-message');
    const sync = () => { accept.disabled = !(terms.checked && privacy.checked); };
    terms.addEventListener('change', sync);
    privacy.addEventListener('change', sync);
    gate.querySelector('[data-legal-logout]').addEventListener('click', () => {
      API.logout(); location.href = '/login';
    });
    accept.addEventListener('click', async () => {
      accept.disabled = true;
      message.textContent = '';
      try {
        await API.post('/api/legal/accept', {
          version: status.version,
          termsAccepted: true,
          ndaAccepted: true,
          privacyAcknowledged: true,
          channel: 'web'
        });
        location.reload();
      } catch (error) {
        message.textContent = error.message || 'No se pudo registrar la aceptación.';
        sync();
      }
    });
    accept.focus();
  }

  addLinks();
  checkAcceptance().catch(error => console.warn('[legal] status check failed:', error));
})();
