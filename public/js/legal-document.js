(() => {
  const pathType = {
    '/legal/terms': 'terms',
    '/legal/privacy': 'privacy',
    '/legal/legal-notice': 'legal_notice'
  };
  const type = pathType[location.pathname] || 'terms';
  const root = document.getElementById('legalDocument');
  const banner = document.getElementById('legalDraftBanner');

  function renderMarkdown(markdown) {
    const fragment = document.createDocumentFragment();
    let list = null;
    const appendText = (tag, text) => {
      const element = document.createElement(tag);
      element.textContent = text.replace(/\*\*/g, '').replace(/  $/, '');
      fragment.appendChild(element);
    };
    String(markdown || '').split(/\r?\n/).forEach(line => {
      if (/^- /.test(line)) {
        if (!list) { list = document.createElement('ul'); fragment.appendChild(list); }
        const item = document.createElement('li');
        item.textContent = line.slice(2).replace(/\*\*/g, '');
        list.appendChild(item);
        return;
      }
      list = null;
      if (line.startsWith('### ')) appendText('h3', line.slice(4));
      else if (line.startsWith('## ')) appendText('h2', line.slice(3));
      else if (line.startsWith('# ')) appendText('h1', line.slice(2));
      else if (line.trim()) appendText('p', line);
    });
    root.replaceChildren(fragment);
  }

  Promise.all([
    fetch(`/api/legal/documents/${type}`).then(response => {
      if (!response.ok) throw new Error('No se pudo cargar el documento.');
      return response.text();
    }),
    fetch('/api/legal/documents').then(response => response.json())
  ]).then(([content, bundle]) => {
    renderMarkdown(content);
    banner.hidden = bundle.status !== 'draft';
    const selected = bundle.documents?.find(document => document.type === type);
    document.title = `${selected?.title || 'Documento legal'} — BANK73`;
  }).catch(error => { root.textContent = error.message; });
})();
