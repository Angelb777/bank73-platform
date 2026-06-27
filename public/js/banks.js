(function () {
  const BANKS_PANAMA = [
    'Allbank Corp',
    'BAC International Bank, Inc.',
    'Balboa Bank & Trust Corp',
    'Banco Aliado S.A.',
    'Banco Azteca (Panamá), S.A.',
    'Banco BAC de Panamá, S.A.',
    'Banco Bolivariano (Panamá), S.A.',
    'Banco Citibank (Panamá), S.A.',
    'Banco Davivienda (Panamá) S.A.',
    'Banco de Bogotá, S.A.',
    'Banco del Pacífico (Panamá), S.A.',
    'Banco Delta, S.A.',
    'Banco Ficohsa (Panamá), S.A.',
    'Banco G&T Continental (Panamá) S.A. (BMF)',
    'Banco HIPOTECARIO NACIONAL',
    'Banco General, S.A.',
    'Banco Internacional de Costa Rica, S.A. (BICSA)',
    'Banco La Hipotecaria, S.A.',
    'Banco Lafise Panamá S.A.',
    'Banco Latinoamericano de Comercio Exterior, S.A. (BLADEX)',
    'Banco Nacional de Panamá',
    'Banco Panamá, S.A.',
    'Banco Panameño de la Vivienda, S.A. (BANVIVIENDA)',
    'Banco Pichincha Panamá, S.A.',
    'Banco Prival, S.A. (Español) o Prival Bank, S.A. (en inglés)',
    'Banco Universal, S.A.',
    'Bancolombia S.A.',
    'Banesco S.A.',
    'BANISI, S.A.',
    'Banistmo S.A.',
    'Bank Leumi-Le Israel B.M.',
    'Bank of China Limited',
    'BBP Bank S.A.',
    'BCT Bank International S.A.',
    'Caja de Ahorros',
    'Capital Bank Inc.',
    'Citibank, N.A. Sucursal Panamá',
    'Credicorp Bank S.A.',
    'FPB Bank Inc.',
    'Global Bank Corporation',
    'Korea Exchange Bank, Ltd.',
    'Mega International Commercial Bank Co. Ltd.',
    'Mercantil Bank (Panamá), S.A.',
    'Metrobank, S.A.',
    'MiBanco, S.A. BMF',
    'MMG Bank Corporation',
    'Multibank Inc.',
    'Produbank (Panamá) S.A.',
    'St. Georges Bank & Company, Inc.',
    'The Bank of Nova Scotia (Panamá), S.A.',
    'The Bank of Nova Scotia (SCOTIABANK)',
    'Towerbank International Inc.',
    'Unibank, S.A.'
  ];

  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  function bankOptionsHtml(current = '') {
    const value = String(current || '').trim();
    const hasKnown = BANKS_PANAMA.some(bank => normalize(bank) === normalize(value));
    const selectedOther = value && !hasKnown;
    return [
      `<option value=""></option>`,
      ...BANKS_PANAMA.map(bank => `<option value="${escapeHtml(bank)}"${normalize(bank) === normalize(value) ? ' selected' : ''}>${escapeHtml(bank)}</option>`),
      `<option value="__OTHER__"${selectedOther ? ' selected' : ''}>Otro</option>`
    ].join('');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  function bankSelectHtml(id, current = '', attrs = '') {
    const value = String(current || '').trim();
    const hasKnown = BANKS_PANAMA.some(bank => normalize(bank) === normalize(value));
    return `
      <select id="${id}" ${attrs}>${bankOptionsHtml(value)}</select>
      <input id="${id}Other" class="bank-other-input" value="${hasKnown ? '' : escapeHtml(value)}" placeholder="Especificar banco" style="display:${value && !hasKnown ? '' : 'none'};margin-top:6px;">
    `;
  }

  function getBankValue(id) {
    const sel = document.getElementById(id);
    if (!sel) return '';
    if (sel.value === '__OTHER__') return document.getElementById(`${id}Other`)?.value?.trim() || '';
    return sel.value || '';
  }

  function bindBankSelect(id) {
    const sel = document.getElementById(id);
    const other = document.getElementById(`${id}Other`);
    if (!sel || !other || sel.dataset.bankBound) return;
    sel.dataset.bankBound = '1';
    const sync = () => {
      other.style.display = sel.value === '__OTHER__' ? '' : 'none';
      if (sel.value !== '__OTHER__') other.value = '';
    };
    sel.addEventListener('change', sync);
    sync();
  }

  window.BANKS_PANAMA = BANKS_PANAMA;
  window.BankSelect = { bankOptionsHtml, bankSelectHtml, getBankValue, bindBankSelect };
})();
