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
        <div class="legal-gate-instruction">
          <strong>Marca las dos casillas para continuar</strong>
          <span>El botón de aceptación se activará cuando confirmes ambas.</span>
        </div>
        <div class="legal-gate-consents">
          <label class="legal-gate-check">
            <input id="legalTermsCheck" type="checkbox">
            <span class="legal-check-box" aria-hidden="true"></span>
            <span class="legal-check-copy"><strong>Acepto los Términos y el NDA</strong><small>He leído y acepto los Términos y condiciones, incluido el acuerdo de confidencialidad.</small></span>
          </label>
          <label class="legal-gate-check">
            <input id="legalPrivacyCheck" type="checkbox">
            <span class="legal-check-box" aria-hidden="true"></span>
            <span class="legal-check-copy"><strong>Confirmo la Política de privacidad</strong><small>He leído la Política de privacidad y protección de datos.</small></span>
          </label>
        </div>
        <p class="legal-gate-progress" data-legal-progress aria-live="polite">Faltan 2 casillas por marcar.</p>
        <p class="legal-gate-message" aria-live="polite"></p>
        <div class="legal-gate-actions"><button type="button" class="btn ghost" data-legal-logout>Cerrar sesión</button><button type="button" class="btn" data-legal-accept disabled>Aceptar y continuar</button></div>
      </section>`;
    return root;
  }

  function waitForAcceptance(status) {
    const gate = gateMarkup(status);
    document.body.appendChild(gate);
    const terms = gate.querySelector('#legalTermsCheck');
    const privacy = gate.querySelector('#legalPrivacyCheck');
    const accept = gate.querySelector('[data-legal-accept]');
    const message = gate.querySelector('.legal-gate-message');
    const progress = gate.querySelector('[data-legal-progress]');
    const sync = () => {
      const pending = Number(!terms.checked) + Number(!privacy.checked);
      accept.disabled = pending > 0;
      terms.closest('.legal-gate-check')?.classList.toggle('is-checked', terms.checked);
      privacy.closest('.legal-gate-check')?.classList.toggle('is-checked', privacy.checked);
      progress.classList.toggle('is-ready', pending === 0);
      progress.textContent = pending === 0
        ? 'Todo listo. Ya puedes aceptar y continuar.'
        : `Falta${pending === 1 ? '' : 'n'} ${pending} casilla${pending === 1 ? '' : 's'} por marcar.`;
    };
    terms.addEventListener('change', sync);
    privacy.addEventListener('change', sync);
    sync();
    gate.querySelector('[data-legal-logout]').addEventListener('click', () => {
      API.logout(); location.href = '/login';
    });
    return new Promise(resolve => {
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
          resolve(true);
          location.reload();
        } catch (error) {
          message.textContent = error.message || 'No se pudo registrar la aceptación.';
          sync();
        }
      });
    });
  }

  function waitForRecovery(error) {
    const root = document.createElement('div');
    root.className = 'legal-gate';
    root.innerHTML = `
      <section class="legal-gate-dialog" role="dialog" aria-modal="true" aria-labelledby="legalGateErrorTitle">
        <h2 id="legalGateErrorTitle">No se pudo cargar la aceptación legal</h2>
        <p>La plataforma no continuará hasta comprobar los documentos vigentes.</p>
        <p class="legal-gate-message" data-legal-error></p>
        <div class="legal-gate-actions"><button type="button" class="btn ghost" data-legal-logout>Cerrar sesión</button><button type="button" class="btn" data-legal-retry>Reintentar</button></div>
      </section>`;
    document.body.appendChild(root);
    root.querySelector('[data-legal-error]').textContent = String(error?.message || 'Error temporal de conexión.');
    root.querySelector('[data-legal-logout]').addEventListener('click', () => {
      API.logout(); location.href = '/login';
    });
    root.querySelector('[data-legal-retry]').addEventListener('click', () => location.reload());
    return new Promise(() => {});
  }

  async function loadStatus() {
    const status = await API.getSilent('/api/legal/status');
    if (status && status.ok !== false) return status;

    // Recuperación: los metadatos públicos no dependen de la consulta de
    // aceptaciones y permiten presentar el modal incluso si esa consulta falla.
    const bundle = await API.getSilent('/api/legal/documents');
    if (bundle && bundle.ok !== false && bundle.acceptanceEnabled && bundle.enforced) {
      return { ...bundle, required: true };
    }
    throw new Error(status?.error || bundle?.error || 'No se pudo consultar el estado legal.');
  }

  async function checkAcceptance() {
    if (!protectedPage || typeof API === 'undefined' || !API.getToken?.()) return true;
    const status = await loadStatus();
    if (!status.required) return true;
    return waitForAcceptance(status);
  }

  addLinks();
  window.BANK73_LEGAL_READY = checkAcceptance().catch(error => {
    console.warn('[legal] status check failed:', error);
    return waitForRecovery(error);
  });
})();
