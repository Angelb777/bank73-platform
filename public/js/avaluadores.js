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
  let users = [];
  let assignments = [];
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
  }

  async function load() {
    setMessage('Cargando…');
    try {
      const [userResponse, assignmentResponse] = await Promise.all([
        API.get('/api/bank/avaluadores'),
        API.get(`/api/bank/projects/${encodeURIComponent(projectId)}/avaluadores`)
      ]);
      users = userResponse.users || [];
      assignments = assignmentResponse.assignments || [];
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
    try {
      if (statusButton) {
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
      setMessage(error.message || 'No se pudo completar la operación.', true);
    }
  });
})();
