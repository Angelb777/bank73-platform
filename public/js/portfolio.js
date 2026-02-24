(async function () {
  if (!API.getToken()) location.href = '/';

  const container = document.getElementById('cards');
  const banner = document.getElementById('noProjectsBanner');

  // Auth / rol
  const auth = API.getAuth ? API.getAuth() : {
    role: (localStorage.getItem('role') || '').toLowerCase(),
    userId: localStorage.getItem('userId')
  };
  const role = (auth.role || '').toLowerCase();

  // ✅ Solo admin o bank pueden crear
  const CAN_CREATE = role === 'admin' || role === 'bank';

  // Roles
  const ALL_ROLES = [
    'admin',
    'bank',
    'promoter',
    'commercial',
    'gerencia',
    'socios',
    'contable',
    'financiero',
    'legal',
    'tecnico'
  ];
  const ASSIGNABLE_ROLES = ALL_ROLES.filter(r => !['admin', 'bank'].includes(r));

  // ===== Helpers =====
  const norm = (s) => (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  const escapeHtml = (s) => (s || '').toString().replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));

  const debounce = (fn, ms = 120) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  // ===== UI Cards =====
  function statusBadge(status) {
    const s = status || 'EN_CURSO';
    return `<span class="badge">${escapeHtml(s)}</span>`;
  }

  function statusClass(status) {
    const s = (status || 'EN_CURSO').toUpperCase();
    return `status-${escapeHtml(s)}`;
  }

  function card(p) {
    const soldPct = p.unitsTotal ? Math.round((p.unitsSold / p.unitsTotal) * 100) : 0;
    return `
      <div class="card ${statusClass(p.status)}">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin-right:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(p.name)}</h3>
          ${statusBadge(p.status)}
        </div>
        <p class="muted">${p.description ? escapeHtml(p.description) : ''}</p>
        <div class="progress"><div style="width:${soldPct}%"></div></div>
        <p class="small muted">${p.unitsSold || 0}/${p.unitsTotal || 0} unidades vendidas (${soldPct}%)</p>
        <div class="row">
          <a class="btn" href="/project?id=${encodeURIComponent(p._id)}&ref=portfolio">Abrir</a>
        </div>
      </div>
    `;
  }

  // ===== Portfolio list + search =====
  let FULL_LIST = [];

  function renderList(list) {
    if (!Array.isArray(list) || list.length === 0) {
      container.innerHTML = '';
      if (banner) banner.style.display = 'block';
      return;
    }
    if (banner) banner.style.display = 'none';
    container.innerHTML = list.map(card).join('');
  }

  function applyPortfolioFilter(q) {
    const query = norm(q);
    if (!query) return renderList(FULL_LIST);

    const filtered = FULL_LIST.filter(p => {
      const hay = norm(`${p.name || ''} ${p.description || ''} ${p.status || ''}`);
      return hay.includes(query);
    });

    renderList(filtered);
  }

  async function loadList() {
    try {
      const list = await API.get('/api/projects/portfolio');
      FULL_LIST = Array.isArray(list) ? list : [];
      renderList(FULL_LIST);

      // Reaplicar filtro si ya había texto
      const s = document.getElementById('portfolioSearch');
      if (s && s.value) applyPortfolioFilter(s.value);
    } catch (e) {
      container.innerHTML = `<div class="card">Error: ${escapeHtml(e.message || e)}</div>`;
      if (banner) banner.style.display = 'none';
    }
  }

  // Hook buscador (NO se inyecta nada, existe en tu HTML)
  const searchInput = document.getElementById('portfolioSearch');
  if (searchInput) {
    searchInput.addEventListener('input', debounce((e) => applyPortfolioFilter(e.target.value), 120));
  }

  // ===== Modal crear proyecto =====
  const modal = document.getElementById('modalBackdrop');
  const fab = document.getElementById('fabPlus');
  const btnCancel = document.getElementById('cancelCreate');
  const btnCreate = document.getElementById('createProject');

  // Nuevo contenedor de roles (tu HTML final lo trae)
  const assigneesContainer = document.getElementById('assigneesContainer');

  // (Legacy ocultos por si existen; no los usamos si hay contenedor nuevo)
  const selPromotersLegacy = document.getElementById('pPromoters');
  const selCommercialsLegacy = document.getElementById('pCommercials');

  // Cache por rol para no pegarle al server 10 veces si abres/cierra modal
  const assigneesCache = new Map(); // role -> users[]
  const selectsByRole = new Map();  // role -> selectEl

  async function fetchAssignees(roleName) {
    if (assigneesCache.has(roleName)) return assigneesCache.get(roleName);
    const data = await API.get(`/api/projects/assignees?role=${encodeURIComponent(roleName)}`);
    const list = (data && data.users) || [];
    assigneesCache.set(roleName, list);
    return list;
  }

  function buildRoleBlock(roleName, users) {
    // Estructura compatible con tu CSS (role-block / role-search / role-select)
    const block = document.createElement('div');
    block.className = 'role-block';

    const title = document.createElement('div');
    title.className = 'role-title';
    title.textContent = roleName.toUpperCase() + (roleName === 'promoter' ? ' (OBLIGATORIO)' : '');

    const search = document.createElement('input');
    search.className = 'role-search';
    search.type = 'search';
    search.placeholder = `Buscar ${roleName}...`;
    search.autocomplete = 'off';

    const select = document.createElement('select');
    select.className = 'role-select';
    select.multiple = true;
    select.size = 6;

    select.innerHTML = '';
    if (!users || !users.length) {
      const opt = document.createElement('option');
      opt.disabled = true;
      opt.textContent = `No hay ${roleName}s activos`;
      select.appendChild(opt);
    } else {
      users.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u._id;
        opt.textContent = `${u.name || '(sin nombre)'} — ${u.email || ''}`.trim();
        select.appendChild(opt);
      });
    }

    // Filtro por buscador
    const doFilter = () => {
      const q = norm(search.value);
      Array.from(select.options).forEach(o => {
        if (o.disabled) return;
        if (!q) { o.hidden = false; return; }
        o.hidden = !norm(o.textContent).includes(q);
      });
    };
    search.addEventListener('input', debounce(doFilter, 100));

    block.appendChild(title);
    block.appendChild(search);
    block.appendChild(select);

    selectsByRole.set(roleName, select);
    return block;
  }

  async function loadAllRoleAssignees() {
    if (!assigneesContainer) return;

    assigneesContainer.innerHTML = '';
    selectsByRole.clear();

    for (const r of ASSIGNABLE_ROLES) {
      // bloque "cargando"
      const loading = document.createElement('div');
      loading.className = 'role-block';
      loading.innerHTML = `<div class="role-title">${r.toUpperCase()}</div><div class="muted">Cargando...</div>`;
      assigneesContainer.appendChild(loading);

      try {
        const users = await fetchAssignees(r);
        const block = buildRoleBlock(r, users);
        assigneesContainer.replaceChild(block, loading);
      } catch (e) {
        loading.innerHTML = `<div class="role-title">${r.toUpperCase()}</div><div class="muted">Error al cargar</div>`;
      }
    }
  }

  function getSelectedValues(selectEl) {
    return Array.from(selectEl?.selectedOptions || []).map(o => o.value);
  }

  const openModal = async () => {
    if (!modal) return;
    modal.classList.add('show');

    // Modo nuevo (todos los roles)
    if (assigneesContainer) {
      await loadAllRoleAssignees();
      return;
    }

    // Fallback legacy (por si falta el contenedor por cualquier razón)
    if (selPromotersLegacy) {
      selPromotersLegacy.innerHTML = `<option>Cargando...</option>`;
      try {
        const data = await API.get(`/api/projects/assignees?role=promoter`);
        const list = (data && data.users) || [];
        selPromotersLegacy.innerHTML = '';
        if (!list.length) {
          selPromotersLegacy.innerHTML = `<option disabled>No hay promoters activos</option>`;
        } else {
          list.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u._id;
            opt.textContent = `${u.name || '(sin nombre)'} — ${u.email}`;
            selPromotersLegacy.appendChild(opt);
          });
        }
      } catch (e) {
        selPromotersLegacy.innerHTML = `<option disabled>Error al cargar promoters</option>`;
      }
    }

    if (selCommercialsLegacy) {
      selCommercialsLegacy.innerHTML = `<option>Cargando...</option>`;
      try {
        const data = await API.get(`/api/projects/assignees?role=commercial`);
        const list = (data && data.users) || [];
        selCommercialsLegacy.innerHTML = '';
        if (!list.length) {
          selCommercialsLegacy.innerHTML = `<option disabled>No hay commercials activos</option>`;
        } else {
          list.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u._id;
            opt.textContent = `${u.name || '(sin nombre)'} — ${u.email}`;
            selCommercialsLegacy.appendChild(opt);
          });
        }
      } catch (e) {
        selCommercialsLegacy.innerHTML = `<option disabled>Error al cargar commercials</option>`;
      }
    }
  };

  const closeModal = () => {
    if (!modal) return;
    modal.classList.remove('show');
  };

  if (CAN_CREATE) {
    if (fab) fab.style.display = '';
    if (fab) fab.addEventListener('click', openModal);
    if (btnCancel) btnCancel.addEventListener('click', closeModal);

    if (btnCreate) {
      btnCreate.addEventListener('click', async () => {
        try {
          const name = document.getElementById('pName')?.value?.trim() || '';
          const description = document.getElementById('pDesc')?.value?.trim() || '';
          const status = document.getElementById('pStatus')?.value || 'EN_CURSO';

          // (Estos inputs no están en tu HTML actual, pero lo mantengo sin romper)
          const kLoan = document.getElementById('kLoanApproved');
          const kBudg = document.getElementById('kBudgetApproved');
          const loanApproved = kLoan ? Number(kLoan.value || 0) : 0;
          const budgetApproved = kBudg ? Number(kBudg.value || 0) : 0;

          if (!name) return alert('El nombre es obligatorio.');

          // Recoger asignaciones
          const assignedByRole = {};
          ASSIGNABLE_ROLES.forEach(r => assignedByRole[r] = []);

          if (assigneesContainer) {
            for (const r of ASSIGNABLE_ROLES) {
              const sel = selectsByRole.get(r);
              assignedByRole[r] = getSelectedValues(sel);
            }
          } else {
            // Legacy fallback
            assignedByRole.promoter = getSelectedValues(selPromotersLegacy);
            assignedByRole.commercial = getSelectedValues(selCommercialsLegacy);
          }

          // Promoter obligatorio
          if (!assignedByRole.promoter || !assignedByRole.promoter.length) {
            return alert('Debes seleccionar al menos un promotor.');
          }

          // Compatibilidad backend actual
          const assignedPromoters = assignedByRole.promoter || [];
          const assignedCommercials = assignedByRole.commercial || [];

          const payload = {
            name,
            description,
            status,
            loanApproved,
            budgetApproved,
            assignedPromoters,
            assignedCommercials,
            assignedByRole
          };

          await API.post('/api/projects', payload);

          closeModal();

          // reset campos
          ['pName', 'pDesc', 'kLoanApproved', 'kBudgetApproved'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
          });

          const st = document.getElementById('pStatus');
          if (st) st.value = 'EN_CURSO';

          // reset selects
          if (assigneesContainer) {
            for (const r of ASSIGNABLE_ROLES) {
              const sel = selectsByRole.get(r);
              if (sel) sel.selectedIndex = -1;
            }
          } else {
            if (selPromotersLegacy) selPromotersLegacy.selectedIndex = -1;
            if (selCommercialsLegacy) selCommercialsLegacy.selectedIndex = -1;
          }

          alert('Proyecto enviado a revisión del administrador. Aparecerá aquí cuando sea aprobado.');
          await loadList();
        } catch (e) {
          alert('Error al crear proyecto: ' + (e.message || e));
        }
      });
    }
  } else {
    // 🔒 otros roles: quitar FAB y modal
    if (fab && fab.parentNode) fab.parentNode.removeChild(fab);
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
  }

  // Init
  await loadList();

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      API.logout();
      location.href = '/';
    });
  }
})();