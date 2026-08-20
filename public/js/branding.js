(function () {
  'use strict';

  const STORAGE_KEY = 'bank73:active-brand';
  const DEFAULT_BRAND = 'bank73';
  const CAJA_BRAND = 'cajadeahorros';
  const CAJA_PREFIX = '/cajadeahorros';
  const brands = Object.freeze({
    bank73: Object.freeze({
      id: DEFAULT_BRAND, name: 'Bank73',
      favicon: '/assets/TrustForBanksSimbol.png',
      logoLight: '/assets/TrustForBanksLogo.png',
      logoDark: '/assets/Bank73logoblanco.png',
      themeColor: '#0f1422'
    }),
    cajadeahorros: Object.freeze({
      id: CAJA_BRAND, name: 'Caja de Ahorros',
      favicon: '/assets/brands/Caja%20de%20Ahorros/logos/favicon.svg',
      logoLight: '/assets/brands/Caja%20de%20Ahorros/logos/logo-primary.svg',
      logoDark: '/assets/brands/Caja%20de%20Ahorros/logos/logo-white.svg',
      themeColor: '#005199'
    })
  });

  function requestedBrand() {
    const requested = String(new URLSearchParams(location.search).get('brand') || '').toLowerCase();
    if (requested in brands) return requested;
    if (location.pathname === CAJA_PREFIX || location.pathname.startsWith(CAJA_PREFIX + '/')) return CAJA_BRAND;
    return null;
  }

  function storedBrand() {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      return stored in brands ? stored : DEFAULT_BRAND;
    } catch (_) { return DEFAULT_BRAND; }
  }

  const explicitBrand = requestedBrand();
  const activeBrand = explicitBrand || storedBrand();
  const config = brands[activeBrand] || brands[DEFAULT_BRAND];
  if (explicitBrand) {
    try { sessionStorage.setItem(STORAGE_KEY, activeBrand); } catch (_) {}
  }

  document.documentElement.dataset.brand = activeBrand;

  function replaceBank73(value) {
    return activeBrand === CAJA_BRAND && typeof value === 'string'
      ? value.replace(/Bank73/g, config.name)
      : value;
  }

  function updateCopy(root) {
    if (activeBrand !== CAJA_BRAND || !root) return;
    const blocked = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA']);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      if (blocked.has(node.parentElement?.tagName)) return;
      const next = replaceBank73(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    });

    const attributes = ['alt', 'title', 'aria-label', 'placeholder', 'content'];
    const elements = root.querySelectorAll ? [root, ...root.querySelectorAll('*')] : [];
    elements.forEach(element => {
      if (!(element instanceof Element) || blocked.has(element.tagName)) return;
      attributes.forEach(attribute => {
        if (!element.hasAttribute(attribute)) return;
        const current = element.getAttribute(attribute);
        const next = replaceBank73(current);
        if (next !== current) element.setAttribute(attribute, next);
      });
    });
  }

  function applyDocumentBranding() {
    document.title = replaceBank73(document.title);
    document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]').forEach(link => {
      link.href = config.favicon;
      link.type = activeBrand === CAJA_BRAND ? 'image/svg+xml' : (link.type || 'image/png');
    });
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = config.themeColor;
    document.querySelectorAll('[data-brand-logo]').forEach(image => {
      image.src = image.dataset.brandLogo === 'light' ? config.logoLight : config.logoDark;
      image.alt = config.name;
    });

    // Reuse the existing theme mechanism without creating or moving controls.
    const supportsAppTheme = document.querySelector('link[href*="/css/theme.css"]');
    const hasThemeScript = document.querySelector('script[src*="/js/theme-toggle.js"]');
    if (activeBrand === CAJA_BRAND && supportsAppTheme && !document.body.classList.contains('bg-gradient') && !hasThemeScript) {
      const script = document.createElement('script');
      script.src = '/js/theme-toggle.js';
      document.body.appendChild(script);
    }

    updateCopy(document.body);
    if (activeBrand === CAJA_BRAND && document.body) {
      new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) updateCopy(node);
        else if (node.nodeType === Node.TEXT_NODE && node.parentElement) updateCopy(node.parentElement);
      }))).observe(document.body, { childList: true, subtree: true });
    }
    window.dispatchEvent(new CustomEvent('brandready', { detail: { brand: activeBrand, config } }));
  }

  window.Branding = Object.freeze({ brands, activeBrand, config, isCaja: activeBrand === CAJA_BRAND });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyDocumentBranding, { once: true });
  else applyDocumentBranding();
})();
