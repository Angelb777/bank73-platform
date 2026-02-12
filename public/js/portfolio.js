(async function() {
  if (!API.getToken()) location.href = '/';

  const container = document.getElementById('cards');
  const banner = document.getElementById('noProjectsBanner');

  // Obtener info del usuario/rol
  const auth = API.getAuth ? API.getAuth() : {
    role: (localStorage.getItem('role') || '').toLowerCase(),
    userId: localStorage.getItem('userId')
  };
  const role = (auth.role || '').toLowerCase();

  // ✅ Solo admin o bank pueden crear
  const CAN_CREATE = role === 'admin' || role === 'bank';

  function statusBadge(status) {
    const s = status || 'EN_CURSO';
    return `<span class="badge">${s}</span>`;
  }

  function statusClass(status) {
    const s = (status || 'EN_CURSO').toUpperCase();
    return `status-${s}`;
  }

  function card(p) {
    const soldPct = p.unitsTotal ? Math.round((p.unitsSold / p.unitsTotal) * 100) : 0;
    return `
      <div class="card ${statusClass(p.status)}">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin-right:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.name}</h3>
          ${statusBadge(p.status)}
        </div>
        <p class="muted">${p.description ? p.description : ''}</p>
        <div class="progress"><div style="width:${soldPct}%"></div></div>
        <p class="small muted">${p.unitsSold||0}/${p.unitsTotal||0} unidades vendidas (${soldPct}%)</p>
        <div class="row">
          <a class="btn" href="/project?id=${p._id}&ref=portfolio">Abrir</a>
        </div>
      </div>
    `;
  }

  async function loadList() {
    try {
      const list = await API.get('/api/projects/portfolio');
      if (!Array.isArray(list) || list.length === 0) {
        container.innerHTML = '';
        banner.style.display = 'block';
        return;
      }
      banner.style.display = 'none';
      container.innerHTML = list.map(card).join('');
    } catch (e) {
      container.innerHTML = `<div class="card">Error: ${e.message}</div>`;
      banner.style.display = 'none';
    }
  }

  /* =========================================================
     CARGA DE PROMOTORES Y COMERCIALES (para el modal)
     ========================================================= */
  const selPromoters = document.getElementById('pPromoters');
  const selCommercials = document.getElementById('pCommercials');

  async function loadAssignees(role, selectEl) {
    if (!selectEl) return;
    selectEl.innerHTML = `<option>Cargando...</option>`;
    try {
      const data = await API.get(`/api/projects/assignees?role=${role}`);
      const list = data.users || [];
      if (!list.length) {
        selectEl.innerHTML = `<option disabled>No hay ${role}s activos</option>`;
        return;
      }
      selectEl.innerHTML = '';
      list.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u._id;
        opt.textContent = `${u.name || '(sin nombre)'} — ${u.email}`;
        selectEl.appendChild(opt);
      });
    } catch (e) {
      selectEl.innerHTML = `<option disabled>Error al cargar ${role}s</option>`;
    }
  }

  /* =========================================================
     MODAL CREAR PROYECTO
     ========================================================= */
  const modal = document.getElementById('modalBackdrop');
  const fab = document.getElementById('fabPlus');
  const btnCancel = document.getElementById('cancelCreate');
  const btnCreate = document.getElementById('createProject');

  const openModal = async () => {
    modal.classList.add('show');
    await loadAssignees('promoter', selPromoters);
    await loadAssignees('commercial', selCommercials);
  };
  const closeModal = () => modal.classList.remove('show');

  if (CAN_CREATE) {
    // 🔓 Banco/Admin: ven y usan FAB + modal
    if (fab) fab.style.display = ''; // por si el HTML lo oculta inicialmente
    if (fab) fab.addEventListener('click', openModal);
    if (btnCancel) btnCancel.addEventListener('click', closeModal);

    if (btnCreate) {
      btnCreate.addEventListener('click', async () => {
        try {
          const name = document.getElementById('pName').value.trim();
          const description = document.getElementById('pDesc').value.trim();
          const status = document.getElementById('pStatus').value;
          const loanApproved = Number(document.getElementById('kLoanApproved').value || 0);
          const budgetApproved = Number(document.getElementById('kBudgetApproved').value || 0);
          const unitsTotal = Number(document.getElementById('kUnitsTotal').value || 0);

          const assignedPromoters = Array.from(selPromoters?.selectedOptions || []).map(o => o.value);
          const assignedCommercials = Array.from(selCommercials?.selectedOptions || []).map(o => o.value);

          if (!name) return alert('El nombre es obligatorio.');
          if (!assignedPromoters.length) return alert('Debes seleccionar al menos un promotor.');

          const payload = {
            name,
            description,
            status,
            loanApproved,
            budgetApproved,
            unitsTotal,
            assignedPromoters,
            assignedCommercials
          };

          await API.post('/api/projects', payload);

          closeModal();
          ['pName','pDesc','kLoanApproved','kBudgetApproved','kUnitsTotal'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
          });
          if (selPromoters) selPromoters.selectedIndex = -1;
          if (selCommercials) selCommercials.selectedIndex = -1;
          document.getElementById('pStatus').value = 'EN_CURSO';

          alert('Proyecto enviado a revisión del administrador. Aparecerá aquí cuando sea aprobado.');
          await loadList();
        } catch (e) {
          alert('Error al crear proyecto: ' + (e.message || e));
        }
      });
    }
  } else {
    // 🔒 Cualquier otro rol: no ven FAB ni modal
    if (fab && fab.parentNode) fab.parentNode.removeChild(fab);
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
  }

  await loadList();

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', () => { API.logout(); location.href = '/'; });
})();
