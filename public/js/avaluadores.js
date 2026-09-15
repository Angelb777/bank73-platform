(function () {
  'use strict';

  const role = String(localStorage.getItem('role') || '').toLowerCase();
  const projectId = new URLSearchParams(location.search).get('id');
  const tab = document.getElementById('tabBtn-avaluadores');
  const panel = document.getElementById('tab-avaluadores');
  if (role !== 'bank' || !projectId || !tab || !panel) return;

  const message = document.getElementById('avaluadoresMessage');
  const bankList = document.getElementById('avaluadoresBankList');
  const projectList = document.getElementById('avaluadoresProjectList');
  const assignSelect = document.getElementById('avaluadorAssignSelect');
  const reportsList = document.getElementById('avaluadoresReportsList');
  let users = [];
  let assignments = [];
  let reports = [];
  let loaded = false;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));

  function setMessage(text, isError = false) {
    message.textContent = text || '';
    message.style.color = isError ? '#b91c1c' : '';
  }

  function render() {
    const assignedIds = new Set(assignments.map(item => String(item.avaluadorId?._id || item.avaluadorId)));
    const activeAvailable = users.filter(user => user.status === 'active' && !assignedIds.has(String(user._id)));
    assignSelect.innerHTML = activeAvailable.length
      ? activeAvailable.map(user => `<option value="${escapeHtml(user._id)}">${escapeHtml(user.name)} · ${escapeHtml(user.email)}</option>`).join('')
      : '<option value="">No hay avaluadores activos disponibles</option>';

    bankList.innerHTML = users.length ? `
      <div class="table-wrap"><table class="table"><thead><tr><th>Avaluador</th><th>Email</th><th>Estado en este banco</th><th>Acción</th></tr></thead><tbody>
      ${users.map(user => `<tr><td>${escapeHtml(user.name)}</td><td>${escapeHtml(user.email)}</td><td>${escapeHtml(user.status)}</td><td>
        <button class="btn btn-ghost btn-xs" type="button" data-avaluador-status="${escapeHtml(user._id)}" data-next-status="${user.status === 'active' ? 'blocked' : 'active'}">${user.status === 'active' ? 'Bloquear' : 'Activar'}</button>
      </td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">El banco aún no tiene avaluadores.</p>';

    projectList.innerHTML = assignments.length ? `
      <div class="table-wrap"><table class="table"><thead><tr><th>Avaluador</th><th>Email</th><th>Asignado</th><th>Acción</th></tr></thead><tbody>
      ${assignments.map(item => {
        const user = item.avaluadorId || {};
        return `<tr><td>${escapeHtml(user.name || 'Avaluador')}</td><td>${escapeHtml(user.email || '')}</td><td>${item.assignedAt ? new Date(item.assignedAt).toLocaleDateString() : '—'}</td><td><button class="btn btn-danger btn-xs" type="button" data-revoke-avaluador="${escapeHtml(user._id || user)}">Revocar</button></td></tr>`;
      }).join('')}</tbody></table></div>`
      : '<p class="muted">No hay avaluadores asignados a este proyecto.</p>';

    reportsList.innerHTML = reports.length ? `
      <div class="table-wrap"><table class="table"><thead><tr><th>Informe</th><th>Fecha</th><th>Avaluador</th><th>Avance obra</th><th>Unidades</th><th>Acción</th></tr></thead><tbody>
      ${reports.map(item => `<tr>
        <td><strong>${escapeHtml(item.reportNumber || 'Informe')}</strong><br><span class="small muted">Firmado por ${escapeHtml(item.signerName || '—')}</span></td>
        <td>${item.inspectionDate ? new Date(item.inspectionDate).toLocaleDateString() : '—'}</td>
        <td>${escapeHtml(item.avaluador?.name || 'Avaluador')}</td>
        <td>${Number(item.projectProgressPercent || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} %</td>
        <td>${Number(item.unitsInspected || 0)} · media ${Number(item.unitAveragePercent || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} %</td>
        <td><button class="btn btn-ghost btn-xs" type="button" data-inspection-report="${escapeHtml(item.reportPath)}">Ver PDF</button></td>
      </tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">Todavía no hay informes finalizados para este proyecto.</p>';
  }

  async function load() {
    setMessage('Cargando…');
    try {
      const [userResponse, assignmentResponse, reportsResponse] = await Promise.all([
        API.get('/api/bank/avaluadores'),
        API.get(`/api/bank/projects/${encodeURIComponent(projectId)}/avaluadores`),
        API.get(`/api/bank/projects/${encodeURIComponent(projectId)}/inspection-reports`)
      ]);
      users = userResponse.users || [];
      assignments = assignmentResponse.assignments || [];
      reports = reportsResponse.reports || [];
      loaded = true;
      render();
      setMessage('');
    } catch (error) {
      setMessage(error.message || 'No se pudieron cargar los avaluadores.', true);
    }
  }

  tab.addEventListener('click', () => { if (!loaded) load(); });
  document.getElementById('refreshAvaluadoresBtn')?.addEventListener('click', load);

  document.getElementById('createAvaluadorForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    setMessage('Creando avaluador…');
    try {
      await API.post('/api/bank/avaluadores', {
        name: document.getElementById('avaluadorName').value.trim(),
        email: document.getElementById('avaluadorEmail').value.trim(),
        temporaryPassword: document.getElementById('avaluadorPassword').value
      });
      event.currentTarget.reset();
      await load();
      setMessage('Avaluador creado o invitado. Actívalo antes de asignarlo.');
    } catch (error) {
      setMessage(error.message || 'No se pudo crear el avaluador.', true);
    }
  });

  document.getElementById('assignAvaluadorBtn')?.addEventListener('click', async () => {
    const avaluadorId = assignSelect.value;
    if (!avaluadorId) return;
    setMessage('Asignando…');
    try {
      await API.put(`/api/bank/projects/${encodeURIComponent(projectId)}/avaluadores/${encodeURIComponent(avaluadorId)}`, {});
      await load();
      setMessage('Avaluador asignado al proyecto.');
    } catch (error) {
      setMessage(error.message || 'No se pudo asignar el avaluador.', true);
    }
  });

  panel.addEventListener('click', async event => {
    const statusButton = event.target.closest('[data-avaluador-status]');
    const revokeButton = event.target.closest('[data-revoke-avaluador]');
    const reportButton = event.target.closest('[data-inspection-report]');
    try {
      if (reportButton) {
        reportButton.disabled = true;
        const auth = API.getAuth();
        const response = await fetch(reportButton.dataset.inspectionReport, {
          headers: {
            Authorization: `Bearer ${auth.token}`,
            'x-tenant': auth.tenantKey
          }
        });
        if (!response.ok) throw new Error('No se pudo abrir el informe.');
        const url = URL.createObjectURL(await response.blob());
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        reportButton.disabled = false;
      } else if (statusButton) {
        await API.patch(`/api/bank/avaluadores/${encodeURIComponent(statusButton.dataset.avaluadorStatus)}/status`, {
          status: statusButton.dataset.nextStatus
        });
        await load();
      } else if (revokeButton) {
        await API.del(`/api/bank/projects/${encodeURIComponent(projectId)}/avaluadores/${encodeURIComponent(revokeButton.dataset.revokeAvaluador)}`);
        await load();
        setMessage('Asignación revocada.');
      }
    } catch (error) {
      if (reportButton) reportButton.disabled = false;
      setMessage(error.message || 'No se pudo completar la operación.', true);
    }
  });
})();
