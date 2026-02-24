// public/js/project.js
(async function () {
  if (!API.getToken()) location.href = '/';

  // ====== Parámetros URL y navegación ======
  const params = new URLSearchParams(location.search);
  const id   = params.get('id');
  const ref  = params.get('ref'); // 'dashboard' | 'portfolio' | null
  if (!id) { location.href = '/portfolio'; return; }

  const backA = document.querySelector('.topbar .brand a.link');
  if (backA) backA.href = (ref === 'dashboard') ? '/dashboard' : '/portfolio';

  // ====== UI base ======
  const pname       = document.getElementById('pname');
  const pdesc       = document.getElementById('pdesc');
  const pdesc2      = document.getElementById('pdesc2');
  const kpisDiv     = document.getElementById('kpis');

  const statusWrap  = document.getElementById('statusControls');
  const statusSel   = document.getElementById('pstatusSel');
  const saveBtn     = document.getElementById('saveStatusBtn');
  const startBtn    = document.getElementById('startBtn');

  const disbRow     = document.getElementById('disbRow');
  const disbBtn     = document.getElementById('disbBtn');

  // ROLE-SEP: banner de revisión + usuario actual
const reviewBanner = document.getElementById('reviewBanner');
const currentUser = {
  role:   (localStorage.getItem('role')   || '').toLowerCase().trim(),
  status: (localStorage.getItem('status') || '').toLowerCase().trim()
};

// Flag global (se setea tras cargar el proyecto)
window.__COMMERCIAL_LOCKED = false; // bloquea edición comercial si proyecto no aprobado


  // ====== Tabs (delegación robusta) ======
  const panes = {
    resumen:   document.getElementById('tab-resumen'),
    proyecto:  document.getElementById('tab-proyecto'),
    finanzas:  document.getElementById('tab-finanzas'),
    comercial: document.getElementById('tab-comercial'),
    docs:      document.getElementById('tab-docs'),
    chat:      document.getElementById('tab-chat'),
  };
  function activateTab(key){
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === key));
    Object.entries(panes).forEach(([k,el]) => el && el.classList.toggle('active', k === key));
  }
  document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.tab[data-tab]');
  if (!btn) return;
  ev.preventDefault();
  const key = btn.dataset.tab;
  activateTab(key);
  if (key === 'chat') loadChatMessages({ append:false }); // 👈
  });
  activateTab(document.querySelector('.tab.active')?.dataset.tab || 'proyecto');

// Delegación global: "Gestionar permisos"
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.js-open-permits');
  if (!btn) return;
  ev.preventDefault();
  console.log('[Permits] open');
  openPermitsModal().catch(err => {
    console.error('[Permits] error', err);
    alert('No se pudo abrir Permisos. Revisa la consola.');
  });
});



const modalBackdrop = document.getElementById('modalBackdrop');
const modalTitle    = document.getElementById('modalTitle');
const modalBody     = document.getElementById('modalBody');
const modalPrimary  = document.getElementById('modalPrimary');
const modalCloseBtn = document.getElementById('modalClose');

if (modalCloseBtn && modalBackdrop) {
  modalCloseBtn.onclick = () => (modalBackdrop.style.display = 'none');
}

function openModal(title, bodyHTML, primaryText = 'Guardar', onPrimary = null) {
  if (!modalBackdrop || !modalTitle || !modalBody || !modalPrimary) {
    console.warn('[modal] Falta el esqueleto del modal en el HTML');
    alert('No se puede abrir el modal: falta el contenedor en la página.');
    return;
  }
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHTML;

  const addBtn = document.getElementById('permAddFromTpl');
if (addBtn) {
  addBtn.onclick = async () => {
    const box = document.getElementById('permAddBox');
    box.textContent = 'Cargando plantillas…';
    try {
      const tpls = await apiPermitsGetTemplates();
      box.innerHTML = `
        <select id="permTplSel2" class="w-100" style="max-width:360px;">
          ${tpls.map(t => `<option value="${t._id}">${t.name} (v${t.version||1})</option>`).join('')}
        </select>
        <button class="btn btn-xs" id="permTplApply2">Agregar</button>
      `;
      document.getElementById('permTplApply2').onclick = async () => {
        const tplId = document.getElementById('permTplSel2').value;
        await apiPermitsInit(tplId);              // 👈 tu endpoint ya hace el merge por code
        __permits = await apiPermitsGetProject(true);
        renderPermitsModal();
        await reloadProyecto(false);
      };
    } catch (e) {
      console.error(e);
      box.textContent = 'No se pudieron cargar las plantillas';
    }
  };
}

  // añade esto UNA VEZ, después de declarar modalBody (p.ej. debajo de openModal)
if (!modalBody.__permitsBound) {
  modalBody.__permitsBound = true;

  // change en cualquier select de estado
  modalBody.addEventListener('change', async (ev) => {
    const sel = ev.target.closest('select.perm-state');
    if (!sel) return;
    const code = sel.dataset.code;
    const status = sel.value;

    try {
  await apiPermitsPatchItem(code, { status });      // 1) guarda en BD

  __permits = await apiPermitsGetProject(true);     // 2) lee fresco (modal)
  renderPermitsModal();                             // 3) repinta modal

  // 4) ✅ refresca RESUMEN (gráficas)
  const payload = await API.get(`/api/projects/${id}/summary?ts=${Date.now()}`);
  window.__LAST_SUMMARY_PAYLOAD__ = payload;
  if (typeof renderSummaryUI === 'function') renderSummaryUI(payload);
  if (typeof renderResumen === 'function')   renderResumen(payload);
  if (typeof renderSummary === 'function')   renderSummary(payload);

} catch (e) {
  console.error(e);
  alert('No se pudo actualizar el estado.');
}
  });

  // clicks delegados (desbloquear / adjuntar), si quieres mantenerlos aquí
  // 🔁 REEMPLAZA tu handler actual de clicks delegados por ESTE:
modalBody.addEventListener('click', (ev) => {
  // 1) desbloqueo manual (igual que antes)
  const unlockBtn = ev.target.closest('.js-unlock');
  if (unlockBtn) {
    const code = unlockBtn.dataset.code;
    if (!confirm('¿Desbloquear este trámite manualmente para trabajar en paralelo?')) return;
    __permitsUnlockOverrides.add(code);
    renderPermitsModal();
    return;
  }

  // 2) Adjuntar documentos por TRÁMITE (sin panel global)
  const docsBtn = ev.target.closest('.js-perm-docs');
  if (docsBtn) {
    ev.preventDefault();
    ev.stopPropagation();

    const code = docsBtn.dataset.code; // por si luego guardamos permitCode en backend
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = true;

    picker.onchange = async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;

      // fecha de caducidad opcional (YYYY-MM-DD)
      let expiry = prompt('Fecha de caducidad (YYYY-MM-DD, opcional):', '');
      expiry = (expiry || '').trim();
      if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
        alert('Formato inválido. Usa YYYY-MM-DD o deja vacío.');
        return;
      }

      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      fd.append('projectId', id);
      fd.append('category', 'permits');
      if (expiry) fd.append('expiryDate', expiry);

      // 👉 Si añades "permitCode" en el backend, entonces:
      fd.append('permitCode', code);

      try {
        const headers = { ...authHeaders(), ...tenantHeaders() }; // ya los tienes definidos en tu archivo
        const resp = await fetch('/api/documents/upload', {
          method: 'POST',
          body: fd,
          headers,
          credentials: 'include'
        });
        const data = await resp.json().catch(()=> ({}));
        if (!resp.ok) {
          if (data?.error === 'Falta projectId') return alert('Falta projectId en la subida.');
          if (data?.error === 'Falta archivo(s)') return alert('No llegaron archivos al servidor.');
          throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
        }
        // feedback sutil
        docsBtn.textContent = '✅ Adjuntado';
        setTimeout(() => { docsBtn.textContent = '📎 Adjuntar'; }, 1500);
      } catch (err) {
        console.error('[permits.item.upload]', err);
        alert('No se pudo subir el/los archivo(s).');
      }
    };

    picker.click(); // abre el selector
  }
});

}

  // --- Layout del modal para un único scroll en el body ---
const card = document.getElementById('modalCard');      // si existe en tu HTML
if (card) {
  card.style.width = 'min(1100px, 94vw)';
  card.style.maxHeight = '90vh';
  card.style.display = 'flex';
  card.style.flexDirection = 'column';
  card.style.overflow = 'hidden';
}
if (modalBody) {
  modalBody.style.flex = '1 1 auto';
  modalBody.style.minHeight = '0';
  modalBody.style.overflowY = 'auto';   // 👈 scroll SOLO aquí
  modalBody.style.maxHeight = 'none';
}

  modalPrimary.textContent = primaryText;
  modalPrimary.onclick = async () => { if (onPrimary) await onPrimary(); };
  modalBackdrop.style.display = 'flex';
}

function authHeaders() {
  // intenta por API wrapper y por localStorage (tkn y token)
  const raw =
    (API.getToken && API.getToken()) ||
    localStorage.getItem('tkn') ||
    localStorage.getItem('token') || '';

  const v = String(raw || '').trim();
  if (!v) return {};
  return { Authorization: v.toLowerCase().startsWith('bearer ') ? v : `Bearer ${v}` };
}

function tenantHeaders() {
  const tenant =
    (API.getTenant && API.getTenant()) ||
    localStorage.getItem('tenant') ||
    localStorage.getItem('tenantKey') ||
    '';
  const h = {};
  if (tenant) { h['X-Tenant'] = tenant; h['X-Tenant-Key'] = tenant; }
  return h;
}


async function openChecklistDocs(clId) {
  const cl = state.checklists.find(x => x._id === clId);
  const docs = state.docsByChecklist[clId] || [];

  const listHTML = docs.length ? docs.map(d => `
    <div class="row" data-doc="${d._id}" style="justify-content:space-between;border:1px solid #eef2f7;border-radius:8px;padding:6px 10px;margin-bottom:6px;">
      <div>
        <b>${d.originalname || d.name}</b>
        <div class="small muted">${d.mimetype || ''} — ${(d.size||0)} bytes</div>
        <div class="small ${d.expiryDate && new Date(d.expiryDate).getTime() < Date.now() ? 'warn' : ''}">
          Expira: ${d.expiryDate ? new Date(d.expiryDate).toISOString().slice(0,10) : '—'}
        </div>
      </div>
      <div class="row" style="gap:6px;">
        <a class="btn btn-ghost btn-xs" href="/${d.path}" target="_blank">Ver</a>
        <button class="btn btn-danger btn-xs js-del-doc" data-doc="${d._id}" data-cl="${clId}">Eliminar</button>
      </div>
    </div>
  `).join('') : '<div class="small muted">Sin documentos</div>';

  const body = `
    <div class="small muted" style="margin-bottom:8px;">Checklist: <b>${cl?.title || '—'}</b></div>
    <div id="docsList-${clId}">
      ${listHTML}
    </div>
    <hr style="margin:12px 0;">
    <div>
      <div class="small muted" style="margin-bottom:6px;">Subir nuevo documento</div>
      <div class="row" style="gap:8px;align-items:center;">
        <input type="file" id="docFile-${clId}" />
        <label>Expira</label><input type="date" id="docExp-${clId}">
        <button class="btn btn-ghost btn-xs" id="docUploadBtn-${clId}">Subir</button>
      </div>
    </div>
  `;

  openModal('Documentos del checklist', body, 'Cerrar', () => {
    modalBackdrop.style.display = 'none';
  });

  await refreshDocsListInModal(clId);

  // Bind subir
  const upBtn = document.getElementById(`docUploadBtn-${clId}`);
  const fileInp = document.getElementById(`docFile-${clId}`);
  const expInp  = document.getElementById(`docExp-${clId}`);
  if (upBtn && fileInp) {
    upBtn.onclick = async () => {
      // Activo por secuencia
      const active = isChecklistActive(cl);
      if (!active) {
        alert('Checklist bloqueado: valida los anteriores o desbloquéalo manualmente tocando la tarjeta.');
        return;
      }
      const f = fileInp.files?.[0];
      if (!f) return alert('Selecciona un archivo');
      const fd = new FormData();
      fd.append('file', f);
      fd.append('projectId', id);
      fd.append('checklistId', clId);
      if (expInp?.value) fd.append('expiryDate', expInp.value);
      await API.upload('/api/documents/upload', fd);
      await reloadProyecto(false);
      await refreshDocsListInModal(clId);
      fileInp.value = '';
      expInp.value = '';
    };
  }

  // Bind eliminar dentro del modal
  bindDeleteButtonsInModal(clId);
}

let __permits = null;

async function apiPermitsGetProject(noCache=false) {
  // ✅ Nueva ruta correcta según backend
  let url = `/api/permits?projectId=${id}`;
  
  if (noCache) url += `&ts=${Date.now()}`;   // rompe ETag

  const res = await fetch(url, { 
    headers: { ...tenantHeaders(), ...authHeaders() },
    cache: 'no-store'                         // no usar caché del navegador
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiPermitsGetTemplates() {
  try {
    return await withTimeout(API.get('/api/permits/templates'), 1000);
  } catch (_) {
    const res = await fetch('/api/permits/templates', {
    headers: { ...tenantHeaders(), ...authHeaders() }
    });
 
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
}

async function apiPermitsInit(templateId) {
  const headers = { 'Content-Type': 'application/json', ...tenantHeaders(), ...authHeaders() };
  console.log('[permits/init] headers=', headers, 'body=', { templateId });

  const res = await fetch(`/api/permits/projects/${id}/init`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ templateId })
  });
  if (!res.ok) {
    const txt = await res.text().catch(()=> '');
    throw new Error(`HTTP ${res.status}: ${txt || 'init_error'}`);
  }
  return res.json();
}


async function apiPermitsPatchItem(code, payload) {
  try {
    return await withTimeout(API.patch(`/api/permits/projects/${id}/items/${encodeURIComponent(code)}`, payload), 1000);
  } catch (_) {
    const res = await fetch(`/api/permits/projects/${id}/items/${encodeURIComponent(code)}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', ...tenantHeaders(), ...authHeaders() },
  body: JSON.stringify(payload)
});

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
}

function withTimeout(promise, ms, onTimeout) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => {
      try { onTimeout && onTimeout(); } catch(_) {}
      reject(new Error('timeout'));
    }, ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(t)), timeout]);
}

// ====== Permisos: UI ======
const PERMIT_STATES = ['pending','in_progress','submitted','approved','rejected','waived'];
const PERMIT_LABEL = {
  pending: 'Pendiente', in_progress: 'En curso', submitted: 'Presentado',
  approved: 'Aprobado', rejected: 'Rechazado', waived: 'No aplica'
};

// ====== Permisos: agregación para gráficas (buckets) ======
function permitBucket(status) {
  const s = String(status || '').toLowerCase().trim();

  if (s === 'pending') return 'pending';

  // ✅ TODO lo "intermedio" cuenta como "En trámite"
  if (s === 'in_progress' || s === 'submitted') return 'inProcess';

  if (s === 'approved') return 'approved';
  if (s === 'rejected') return 'rejected';

  // waived = no aplica (no lo contamos en la gráfica)
  return 'waived';
}

function buildPermitsByInstitution(items = []) {
  const map = {}; // institución -> contadores

  for (const it of items) {
    const inst = (it.institution || '—').trim();
    if (!map[inst]) {
      map[inst] = { institution: inst, pending: 0, inProcess: 0, approved: 0, rejected: 0 };
    }

    const b = permitBucket(it.status);
    if (b === 'pending')   map[inst].pending++;
    if (b === 'inProcess') map[inst].inProcess++;
    if (b === 'approved')  map[inst].approved++;
    if (b === 'rejected')  map[inst].rejected++;
  }

  // orden: los que más tienen primero
  return Object.values(map).sort((a,b) =>
    (b.pending+b.inProcess+b.approved+b.rejected) - (a.pending+a.inProcess+a.approved+a.rejected)
  );
}

function updatePermitsByInstitutionChart() {
  // si no hay chart creado, no hacemos nada
  if (!__sumCharts?.p2) return;

  const inst = buildPermitsByInstitution(__permits?.items || []);

  __sumCharts.p2.data.labels = inst.map(x => x.institution);
  __sumCharts.p2.data.datasets[0].data = inst.map(x => x.pending);
  __sumCharts.p2.data.datasets[1].data = inst.map(x => x.inProcess);
  __sumCharts.p2.data.datasets[2].data = inst.map(x => x.approved);
  __sumCharts.p2.data.datasets[3].data = inst.map(x => x.rejected);

  __sumCharts.p2.update();
}


function permitProgress(pp) {
  if (!pp?.items?.length) return 0;
  const total = pp.items.filter(i => i.status !== 'waived').length || 0;
  const done  = pp.items.filter(i => i.status === 'approved').length;
  return total ? Math.round((done / total) * 100) : 0;
}

async function openPermitsModal() {
  console.log('[Permits] click');

  // abre el modal ya con un “cargando…”
  openModal('Permisos del proyecto', `
    <div class="row" style="align-items:center; gap:8px;">
      <div class="spinner" style="width:16px;height:16px;border:2px solid #cbd5e1;border-top-color:#111827;border-radius:50%;animation:spin 1s linear infinite"></div>
      <span class="small muted">Cargando permisos…</span>
    </div>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
  `, 'Cerrar', () => { modalBackdrop.style.display='none'; });

  try {
  __permits = await apiPermitsGetProject();
} catch (e) {
  console.error('[Permits] GET project error', e);
  modalBody.innerHTML = `
    <div class="error">
      <b>No se pudieron cargar los permisos.</b>
      <div class="small muted">${e?.message || e?.status || 'Error'}</div>
    </div>`;
  return;
}


  if (!__permits) {
    // no inicializado: pide plantilla
    let tpls = [];
    try { tpls = await apiPermitsGetTemplates(); }        // GET /api/permits/templates
    catch (e) {
      console.error('[Permits] GET templates error', e);
      alert('No se pudieron cargar las plantillas de permisos');
      return;
    }
    if (!tpls || !tpls.length) {
      modalBody.innerHTML = '<div class="small muted">No hay plantillas. Pídele a Admin/Gerencia que cargue una.</div>';
      return;
    }
    modalBody.innerHTML = `
      <div class="small muted" style="margin-bottom:8px;">Selecciona plantilla para este proyecto</div>
      <select id="permTplSel" class="w-100">
        ${tpls.map(t => `<option value="${t._id}">${t.name} (v${t.version||1})</option>`).join('')}
      </select>
      <div class="row end" style="margin-top:10px;">
        <button class="btn" id="permTplApply">Instanciar</button>
      </div>
    `;
    // delegación robusta para el botón Instanciar
// ✅ así nos aseguramos de enganchar justo el botón visible
const applyBtn = modalBody.querySelector('#permTplApply');
applyBtn.onclick = async () => {
  const tplSel = document.getElementById('permTplSel');
  const tplId  = tplSel?.value;
  if (!tplId) return alert('Selecciona una plantilla');

  console.log('[Permits] init click -> templateId', tplId);
  try {
    await apiPermitsInit(tplId);                // POST
    __permits = await apiPermitsGetProject();   // GET
    renderPermitsModal();
    updatePermitsByInstitutionChart();
  } catch (e) {
    console.error('[Permits] init error', e);
    alert(`No se pudo instanciar la plantilla de permisos:\n${e.message || e}`);
  }
};

    return;
  }

  // ya había permisos → render
renderPermitsModal();
updatePermitsByInstitutionChart(); // ✅ para que el resumen use __permits ya cargado

}

// ===== Helpers de Permisos (fases, dependencias) =====
const PHASE_ORDER = [
  'Anteproyecto',
  'Informe SINAPROC',
  'Estudio de Impacto',
  'Permiso Provisional',
  'Construcción',
  'Permiso de Construcción',
  'Permiso de Ocupación',
  'Urbanización',
  'Movimientos de tierra',
  'Segregación',
  'Inscripción',
  'Traspaso de calle'
];

function inferType(it) {
  if (it.type) return it.type;
  const t = String(it.title||'').split(' - ')[0].trim();
  return t || 'General';
}

function groupByPhase(items) {
  const g = {};
  for (const it of (items || [])) {
    const phase = inferType(it);
    if (!g[phase]) g[phase] = [];
    g[phase].push(it);
  }
  const phases = Object.keys(g).sort((a,b) => {
    const ia = PHASE_ORDER.indexOf(a); const ib = PHASE_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return { groups: g, order: phases };
}

function buildIndexByCode(items) { const m={}; (items||[]).forEach(i=>m[i.code]=i); return m; }
function depsApproved(it, idx) { return (it.dependencies||[]).every(c => idx[c] && idx[c].status==='approved'); }
function phaseProgress(list) {
  const valid = (list || []).filter(i => i.status !== 'waived');
  const tot   = valid.length;
  const done  = valid.filter(i => i.status === 'approved').length; // o incluye 'submitted' si quieres sumar presentados
  const pct   = tot ? Math.round((done / tot) * 100) : 0;
  return { pct, done, tot };
}

// Overrides de desbloqueo manual (solo sesión)
const __permitsUnlockOverrides = new Set();
function isUnlocked(it, idx) { return __permitsUnlockOverrides.has(it.code) || depsApproved(it, idx); }

function renderPermitsModal() {
  const pct = permitProgress(__permits);
  const idx = buildIndexByCode(__permits.items);
  const { groups, order } = groupByPhase(__permits.items);

  const head = `
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
    <div style="min-width:140px;">Progreso:</div>
    <div class="progress" style="flex:1"><div style="width:${pct}%;"></div></div>
    <div style="min-width:70px;text-align:right;"><b>${pct}%</b></div>
  </div>
  <div class="small muted">Plantilla: v${__permits?.templateVersion || 1}</div>
  <hr style="margin:10px 0;">
  <div class="row" style="gap:8px; align-items:center; margin:4px 0 12px 0;">
    <button class="btn btn-ghost btn-xs" id="permAddFromTpl">+ Agregar trámites de una plantilla…</button>
    <div id="permAddBox" class="small muted"></div>
  </div>
`;

  // ✅ versión para permisos (evita colisión con la global de checklists)
  const permPhaseProgress = (list) => {
    const valid = (list || []).filter(i => i.status !== 'waived');
    const tot   = valid.length;
    const done  = valid.filter(i => i.status === 'approved').length;
    const pct   = tot ? Math.round((done / tot) * 100) : 0;
    return { pct, done, tot };
  };

  const accordions = order.map(phase => {
    const list = groups[phase] || [];
    const phasePctObj = permPhaseProgress(list);   // { pct, done, tot }
    const phasePct = Number(phasePctObj.pct || 0); // ✅ usar .pct

    const rows = list.map(it => {
      const unlocked = isUnlocked(it, idx);
      const lockedBadge = unlocked ? '' :
        `<span class="badge" title="Debes completar: ${(it.dependencies||[]).join(', ')}">🔒 Bloqueado</span>`;

      const sel = `
        <select class="perm-state" data-code="${it.code}" ${unlocked ? '' : 'disabled'}>
          ${PERMIT_STATES.map(s => `<option value="${s}" ${it.status===s?'selected':''}>${PERMIT_LABEL[s]}</option>`).join('')}
        </select>
      `;

      const reqs = (it.requirements||[]).map(r=>`<li>${r}</li>`).join('');
      const obs  = (it.observations||[]).map(r=>`<li>${r}</li>`).join('');
      const depsHtml = (it.dependencies||[]).length ? `
        <div class="small muted">Depende de: ${(it.dependencies||[]).map(c => {
          const dep = idx[c]; return dep ? (dep.title || c) : c;
        }).join(', ')}</div>` : '';

      const unlockBtn = unlocked ? '' : `
        <button class="btn btn-ghost btn-xs js-unlock" data-code="${it.code}">Desbloquear manualmente</button>
      `;

      const docsViewer = `
        <div class="small" id="permDocs-${it.code}">
          <div class="muted">Cargando documentos…</div>
        </div>
      `;

      return `
        <tr data-code="${it.code}">
          <td style="white-space:nowrap">${sel}${lockedBadge}</td>
          <td>
            <b>${it.title||it.code}</b><br/>
            <span class="small muted">${it.institution||''}</span>
            ${depsHtml}
          </td>
          <td class="small">${it.slaDays ? (it.slaDays + ' días hábiles') : '—'}</td>
          <td class="small">
            ${(reqs||obs) ? `
              <details>
                <summary>Ver</summary>
                ${reqs?`<div style="margin-top:6px;"><b>Requisitos</b><ul class="small">${reqs}</ul></div>`:''}
                ${obs ?`<div style="margin-top:6px;"><b>Observaciones</b><ul class="small">${obs}</ul></div>`:''}
                <div style="margin-top:8px;"><b>Documentos adjuntos</b></div>
                ${docsViewer}
              </details>` : `
              <details>
                <summary>Ver</summary>
                <div class="small muted">Sin requisitos / observaciones.</div>
                <div style="margin-top:8px;"><b>Documentos adjuntos</b></div>
                ${docsViewer}
              </details>
            `}
          </td>
          <td class="small">
            <button class="btn btn-ghost btn-xs js-perm-docs" data-code="${it.code}">📎 Adjuntar</button>
            ${unlockBtn}
          </td>
        </tr>
      `;
    }).join('');

    return `
      <section class="phase-card" data-phase="${phase}" style="border:1px solid #0f172a33;border-radius:12px;margin-bottom:14px;overflow:visible;">
        <header class="row" style="align-items:center;gap:12px;background:#0f172a;color:#fff;padding:10px 12px;">
          <div style="font-weight:700;">${phase}</div>
          <div class="progress small" style="flex:1;background:#ffffff22;">
            <div style="width:${phasePct}%; background:#22c55e;"></div>   <!-- ✅ correcto -->
          </div>
          <div><b>${phasePct}%</b></div>                                   <!-- ✅ correcto -->
        </header>
        <div class="table-wrap" style="background:#0b1220;color:#e5e7eb;padding:8px 10px;">
          <table class="table dark">
            <thead>
              <tr><th>Estado</th><th>Trámite</th><th>Tiempo</th><th>Detalles</th><th>Docs</th></tr>
            </thead>
            <tbody>${rows || `<tr><td colspan="5" class="small muted">—</td></tr>`}</tbody>
          </table>
        </div>
      </section>
    `;
  }).join('');

  openModal(
    'Permisos del proyecto',
    head + accordions,
    'Cerrar',
    () => { modalBackdrop.style.display = 'none'; }
  );

  // === helpers locales ===
  const fmt = (n)=> (typeof n==='number' ? (Math.round(n/1024))+' KB' : '—');

  async function fetchDocsFor(code) {
    const host = modalBody.querySelector(`#permDocs-${CSS.escape(code)}`);
    if (!host) return;
    host.innerHTML = '<div class="small muted">Cargando…</div>';
    try {
      let url = `/api/documents?projectId=${id}&category=permits&permitCode=${encodeURIComponent(code)}&ts=${Date.now()}`;
      let res = await fetch(url, { headers: { ...authHeaders(), ...tenantHeaders() }});
      let docs;
      if (res.ok) {
        docs = await res.json();
      } else {
        url = `/api/documents?projectId=${id}&category=permits&ts=${Date.now()}`;
        res = await fetch(url, { headers: { ...authHeaders(), ...tenantHeaders() }});
        docs = res.ok ? await res.json() : [];
        const rx = new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        docs = (docs||[]).filter(d => rx.test(d.title||'') || rx.test(d.originalname||''));
      }

      if (!Array.isArray(docs) || !docs.length) {
        host.innerHTML = '<div class="small muted">Sin documentos para este trámite.</div>';
        return;
      }

      host.innerHTML = `
        <div class="table-wrap">
          <table class="table compact">
            <thead><tr><th>Nombre</th><th>Tipo</th><th>Tamaño</th><th>Subido</th><th>Caduca</th><th></th></tr></thead>
            <tbody>
              ${docs.map(d => `
                <tr data-id="${d._id}">
                  <td class="small">${d.originalname || d.filename || 'Documento'}</td>
                  <td class="small">${d.mimetype || '—'}</td>
                  <td class="small">${fmt(d.size)}</td>
                  <td class="small">${d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '—'}</td>
                  <td class="small">${d.expiryDate ? new Date(d.expiryDate).toLocaleDateString() : '—'}</td>
                  <td class="small" style="white-space:nowrap;">
                    <a class="btn btn-light btn-xs" href="/api/documents/${d._id}/download" target="_blank">Ver</a>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (e) {
      console.error('[permits.docs.fetch]', e);
      host.innerHTML = '<div class="small error">No se pudieron cargar los documentos.</div>';
    }
  }

  // Cargar docs para cada trámite ya renderizado
  ( __permits.items || [] ).forEach(it => fetchDocsFor(it.code));

  // ===== Cambios de estado =====
  modalBody.querySelectorAll('select.perm-state').forEach(sel => {
    sel.onchange = async () => {
      const code = sel.dataset.code;
      const status = sel.value;
      try {
        await apiPermitsPatchItem(code, { status });
        __permits = await apiPermitsGetProject(true);
        renderPermitsModal();
        updatePermitsByInstitutionChart();
      } catch (e) {
        console.error(e);
        alert('No se pudo actualizar el estado.');
      }
    };
  });

  // ===== Desbloqueo manual =====
  modalBody.querySelectorAll('.js-unlock').forEach(btn => {
    btn.onclick = () => {
      const code = btn.dataset.code;
      if (!confirm('¿Desbloquear este trámite manualmente para trabajar en paralelo?')) return;
      __permitsUnlockOverrides.add(code);
      renderPermitsModal();
    };
  });

  // ===== Adjuntar por TRÁMITE =====
  modalBody.querySelectorAll('.js-perm-docs').forEach(btn => {
    btn.onclick = () => {
      const code = btn.dataset.code;

      const picker = document.createElement('input');
      picker.type = 'file';
      picker.multiple = true;

      picker.onchange = async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;

        let expiry = prompt('Fecha de caducidad (YYYY-MM-DD, opcional):', '');
        expiry = (expiry || '').trim();
        if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
          alert('Formato inválido. Usa YYYY-MM-DD o deja vacío.');
          return;
        }

        const fd = new FormData();
        files.forEach(f => fd.append('files', f));
        fd.append('projectId', id);
        fd.append('category', 'permits');
        if (expiry) fd.append('expiryDate', expiry);
        // fd.append('permitCode', code); // si ya lo guardas en backend

        try {
          const headers = { ...authHeaders(), ...tenantHeaders() };
          const resp = await fetch('/api/documents/upload', {
            method: 'POST',
            body: fd,
            headers,
            credentials: 'include'
          });
          const data = await resp.json().catch(()=> ({}));
          if (!resp.ok) {
            if (data?.error === 'Falta projectId') return alert('Falta projectId en la subida.');
            if (data?.error === 'Falta archivo(s)') return alert('No llegaron archivos al servidor.');
            throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
          }

          btn.textContent = '✅ Adjuntado';
          setTimeout(() => { btn.textContent = '📎 Adjuntar'; }, 1200);

          fetchDocsFor(code);

          const docsPane = document.getElementById('tab-docs');
          if (docsPane && docsPane.classList.contains('active') && typeof loadDocs === 'function') {
            loadDocs();
          }
        } catch (err) {
          console.error('[permits.item.upload]', err);
          alert('No se pudo subir el/los archivo(s).');
        }
      };

      picker.click();
    };
  });
}

function bindDeleteButtonsInModal(clId) {
  const container = document.getElementById(`docsList-${clId}`);
  if (!container) return;
  container.querySelectorAll('.js-del-doc').forEach(btn => {
    btn.onclick = async () => {
      // Activo por secuencia
      const cl = state.checklists.find(c => c._id === clId);
      if (!isChecklistActive(cl)) {
        alert('Checklist bloqueado: valida los anteriores o desbloquéalo manualmente tocando la tarjeta.');
        return;
      }
      if (!askPinOrAbort('Para eliminar el documento, introduce el PIN:')) return;
      const docId = btn.dataset.doc;
      try { await API.del(`/api/documents/${docId}`); }
      catch { await API.post(`/api/documents/${docId}/delete`, { pin: PIN }); }
      await reloadProyecto(false);
      await refreshDocsListInModal(clId);
    };
  });
}

async function refreshDocsListInModal(clId) {
  try {
    const docsList = await API.get(`/api/documents?projectId=${id}&checklistId=${clId}`);

    // 🔴 NUEVO: sincroniza el estado global para que el botón muestre el número real
    state.docsByChecklist[clId] = docsList || [];
    setDocsCount(clId, state.docsByChecklist[clId].length);   // <- actualiza el texto del botón

    const container = document.getElementById(`docsList-${clId}`);
    if (!container) return;
    container.innerHTML = (docsList && docsList.length)
      ? docsList.map(d => `
        <div class="row" data-doc="${d._id}" style="justify-content:space-between;border:1px solid #eef2f7;border-radius:8px;padding:6px 10px;margin-bottom:6px;">
          <div>
            <b>${d.originalname || d.name}</b>
            <div class="small muted">${d.mimetype || ''} — ${(d.size||0)} bytes</div>
            <div class="small ${d.expiryDate && new Date(d.expiryDate).getTime() < Date.now() ? 'warn' : ''}">
              Expira: ${d.expiryDate ? new Date(d.expiryDate).toISOString().slice(0,10) : '—'}
            </div>
          </div>
          <div class="row" style="gap:6px;">
            <a class="btn btn-ghost btn-xs" href="/${d.path}" target="_blank">Ver</a>
            <button class="btn btn-danger btn-xs js-del-doc" data-doc="${d._id}" data-cl="${clId}">Eliminar</button>
          </div>
        </div>
      `).join('')
      : '<div class="small muted">Sin documentos</div>';

    bindDeleteButtonsInModal(clId);
  } catch (e) {
    console.error('refreshDocsListInModal error', e);
  }
}


/* ================== DOCS de PERMISOS (helpers) ================== */
// Lista docs de category=permits
async function loadPermitsDocsList(targetEl) {
  if (!targetEl) return;
  targetEl.innerHTML = '<div class="small muted">Cargando…</div>';
  try {
    const docs = await API.get(`/api/documents?projectId=${id}&category=permits&ts=${Date.now()}`);
    if (!Array.isArray(docs) || !docs.length) {
      targetEl.innerHTML = '<div class="small muted">No hay documentos de permisos.</div>';
      return;
    }
    targetEl.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Nombre</th><th>Tipo</th><th>Tamaño</th><th>Subido</th><th>Caduca</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${docs.map(d => `
              <tr data-id="${d._id}">
                <td>${d.originalname || d.filename || 'Documento'}</td>
                <td>${d.mimetype || '—'}</td>
                <td>${d.size ? (Math.round(d.size/1024))+' KB' : '—'}</td>
                <td>${d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '—'}</td>
                <td>${d.expiryDate ? new Date(d.expiryDate).toLocaleDateString() : '—'}</td>
                <td style="white-space:nowrap;">
                  <a class="btn btn-light btn-xs" href="/api/documents/${d._id}/download" target="_blank">Ver</a>
                  <button class="btn btn-danger btn-xs js-permit-doc-del">Eliminar</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Borrado con PIN (usa tu route POST /:id/delete)
    targetEl.querySelectorAll('.js-permit-doc-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const tr = e.target.closest('tr[data-id]');
        const docId = tr?.dataset?.id;
        if (!docId) return;
        const pin = prompt('PIN para eliminar (por defecto 2580):', '');
        if (pin === null) return;
        try {
          await API.post(`/api/documents/${docId}/delete`, { pin });
          tr.remove();
        } catch (err) {
          console.error('[permits.doc.delete]', err);
          alert('No se pudo eliminar el documento.');
        }
      });
    });
  } catch (err) {
    console.error('[permits.docs.list]', err);
    targetEl.innerHTML = '<div class="error">Error cargando documentos.</div>';
  }
}

// Subir docs a category=permits
async function uploadPermitsDocs(files, expiryInput, onDone) {
  const arr = Array.from(files || []);
  if (!arr.length) { alert('Selecciona al menos un archivo.'); return; }
  const fd = new FormData();
  arr.forEach(f => fd.append('files', f));
  fd.append('projectId', id);
  fd.append('category', 'permits');
  const exp = (expiryInput?.value || '').trim();
  if (exp) fd.append('expiryDate', exp); // YYYY-MM-DD

  // OJO: no fijes Content-Type manualmente (deja que el navegador ponga multipart)
  const headers = { ...authHeaders(), ...tenantHeaders() };
  try {
    const res = await fetch('/api/documents/upload', { method:'POST', body: fd, headers, credentials:'include' });
    const data = await res.json().catch(()=> ({}));
    if (!res.ok) {
      if (data?.error === 'Falta projectId') return alert('Falta projectId en la subida.');
      if (data?.error === 'Falta archivo(s)') return alert('No llegaron archivos al servidor.');
      throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
    }
    if (typeof onDone === 'function') onDone();
  } catch (err) {
    console.error('[permits.docs.upload]', err);
    alert('No se pudo subir el/los archivo(s).');
  }
}


function setDocsCount(clId, n) {
  const btn = document.querySelector(`.js-open-docs[data-cl="${clId}"]`);
  if (btn) btn.innerHTML = `📎 Docs (${n})`;
}




// ====== Rol del usuario (para visibilidad/validación) ======  // ROLE-SEP
const FULL_ACCESS_ROLES = ['admin','bank','promoter','gerencia','socios','financiero','contable'];
let myRole = (currentUser.role || 'promoter').toLowerCase().trim();

try {
  const me = await API.get('/api/auth/me').catch(() => null);
  if (me?.role)   myRole = String(me.role).toLowerCase().trim();
  if (me?.status) currentUser.status = String(me.status).toLowerCase().trim();
} catch (_) {}

let __ALLOWED_ROLES = null; // null => sin filtro (ver todo)


function applyRoleVisibility() {                                // ROLE-SEP
  const isAdminOrBank = (myRole === 'admin' || myRole === 'bank');
  const isFull = FULL_ACCESS_ROLES.includes(myRole);            // <- clave

  // Mapas de tabs (botones y panes)
  const tabBtns = {
    resumen:   document.getElementById('tabBtn-resumen'),
    proyecto:  document.getElementById('tabBtn-proyecto'),
    finanzas:  document.getElementById('tabBtn-finanzas'),
    comercial: document.getElementById('tabBtn-comercial'),
    docs:      document.getElementById('tabBtn-docs'),
    chat:      document.getElementById('tabBtn-chat'),
  };
  const tabPanes = {
    resumen:   document.getElementById('tab-resumen'),
    proyecto:  document.getElementById('tab-proyecto'),
    finanzas:  document.getElementById('tab-finanzas'),
    comercial: document.getElementById('tab-comercial'),
    docs:      document.getElementById('tab-docs'),
    chat:      document.getElementById('tab-chat'), 
  };
  const show = (k) => { if (tabBtns[k]) tabBtns[k].style.display = '';  if (tabPanes[k]) tabPanes[k].style.display = '';  };
  const hide = (k) => { if (tabBtns[k]) tabBtns[k].style.display = 'none'; if (tabPanes[k]) tabPanes[k].style.display = 'none'; };

  // Controles de estado del proyecto: sólo admin/bank
  if (statusWrap) statusWrap.style.display = isAdminOrBank ? '' : 'none';
  if (disbRow)    disbRow.style.display    = isAdminOrBank ? '' : 'none';

  // === Header (descripción + KPIs) ===
  const isPartial = ['tecnico','legal','commercial'].includes(myRole) && !isFull;
  if (pdesc)   pdesc.style.display   = isPartial ? 'none' : '';
  if (kpisDiv) kpisDiv.style.display = isPartial ? 'none' : '';

  // Utilidad para ocultar/mostrar piezas dentro de "Proyecto"
  const togglePartialUI = (hideIt) => {
    const globalPhasePanel = document.querySelector('#tab-proyecto > .phase');
    const asideRoles       = document.querySelector('#tab-proyecto aside.roles-panel');
    if (globalPhasePanel) globalPhasePanel.style.display = hideIt ? 'none' : '';
    if (asideRoles)       asideRoles.style.display       = hideIt ? 'none' : '';
    document.querySelectorAll('#tab-proyecto .js-add-cl').forEach(el => { el.style.display = hideIt ? 'none' : ''; });
    document.querySelectorAll('#tab-proyecto .cl-actions').forEach(el => { el.style.display = hideIt ? 'none' : ''; });
    ['verHistorialBtn','configProyectoBtn','toggleAllPhasesBtn'].forEach(id=>{
      const b = document.getElementById(id); if (b) b.style.display = hideIt ? 'none' : '';
    });
  };

  // === MATRIZ DE VISIBILIDAD DE CHECKLISTS ===
  // Full access => ver TODO (sin filtro)
  __ALLOWED_ROLES = null;
  if (typeof state !== 'undefined' && state) state.allowedChecklistRoles = null;

  if (isFull) {
    ['resumen','proyecto','finanzas','comercial','docs','chat'].forEach(show);
    togglePartialUI(false);
    if (typeof renderProyecto === 'function') renderProyecto();
    if (document.getElementById('tab-docs')?.classList.contains('active') && typeof loadDocs === 'function') loadDocs();
    return;
  }

  // TÉCNICO
  if (myRole === 'tecnico') {
    __ALLOWED_ROLES = ['TECNICO'];
    if (state) state.allowedChecklistRoles = __ALLOWED_ROLES;
    ['resumen','finanzas','comercial'].forEach(hide);
    ['proyecto','docs'].forEach(show);
    activateTab('proyecto');
    togglePartialUI(true);
    if (typeof renderProyecto === 'function') renderProyecto();
    if (document.getElementById('tab-docs')?.classList.contains('active') && typeof loadDocs === 'function') loadDocs();
    return;
  }

  // LEGAL
  if (myRole === 'legal') {
    __ALLOWED_ROLES = ['LEGAL'];
    if (state) state.allowedChecklistRoles = __ALLOWED_ROLES;
    ['resumen','finanzas','comercial'].forEach(hide);
    ['proyecto','docs'].forEach(show);
    activateTab('proyecto');
    togglePartialUI(true);
    if (typeof renderProyecto === 'function') renderProyecto();
    if (document.getElementById('tab-docs')?.classList.contains('active') && typeof loadDocs === 'function') loadDocs();
    return;
  }

  // COMERCIAL
  if (myRole === 'commercial') {
    __ALLOWED_ROLES = ['COMERCIAL'];
    if (state) state.allowedChecklistRoles = __ALLOWED_ROLES;
    ['resumen','finanzas'].forEach(hide);
    ['proyecto','comercial','docs'].forEach(show);
    activateTab('comercial');
    togglePartialUI(true);
    if (typeof renderProyecto === 'function') renderProyecto();
    if (document.getElementById('tab-docs')?.classList.contains('active') && typeof loadDocs === 'function') loadDocs();
    return;
  }

  // Fallback ultra-restringido
  ['resumen','finanzas','comercial','docs'].forEach(hide);
  ['proyecto'].forEach(show);
  activateTab('proyecto');
  __ALLOWED_ROLES = null;
  if (state) state.allowedChecklistRoles = __ALLOWED_ROLES;
  togglePartialUI(true);
  if (typeof renderProyecto === 'function') renderProyecto();
  if (document.getElementById('tab-docs')?.classList.contains('active') && typeof loadDocs === 'function') loadDocs();
}

function bindSummaryOnce() {
  if (bindSummaryOnce.bound) return;
  bindSummaryOnce.bound = true;

  const beforeInp = document.getElementById('uploadBefore');
  const afterInp  = document.getElementById('uploadAfter');
  const prevB     = document.getElementById('previewBefore');
  const prevA     = document.getElementById('previewAfter');

  const showPreview = (file, targetDiv) => {
    if (!file || !targetDiv) return;
    const reader = new FileReader();
    reader.onload = () => {
      // Imagen → muestra img | PDF/otros → link
      if (/image\//.test(file.type)) {
        targetDiv.innerHTML = `<img src="${reader.result}" style="max-width:100%; border-radius:8px;" />`;
      } else if (file.type === 'application/pdf') {
        targetDiv.innerHTML = `<a class="btn" href="${reader.result}" target="_blank">Ver PDF</a>`;
      } else {
        targetDiv.innerHTML = `<div class="small muted">${file.name} (${file.type || 'archivo'})</div>`;
      }
    };
    reader.readAsDataURL(file);
  };

  if (beforeInp) beforeInp.addEventListener('change', e => showPreview(e.target.files?.[0], prevB));
  if (afterInp)  afterInp.addEventListener('change',  e => showPreview(e.target.files?.[0], prevA));
}

// Llama una vez (por ejemplo al terminar loadSummary)

// ====== Resumen (KPIs + Charts + Antes/Después) ======
let __sumCharts = {};

function sumDestroy(key){
  if (__sumCharts[key] && typeof __sumCharts[key].destroy === 'function') {
    __sumCharts[key].destroy();
  }
}

function kpiCard(label, value, sub=''){
  return `<div class="kpi">
    <div class="label">${label}</div>
    <div class="value">${value ?? '—'}</div>
    ${sub ? `<div class="small muted">${sub}</div>` : ''}
  </div>`;
}

// cerca de tus helpers en public/js/project.js
function renderHeaderKpis(project, hs = {}, kpis = {}) {
  const fmt = (n) => (Number(n||0)).toLocaleString();
  const loanApproved   = project.loanApproved   ?? kpis.loan?.approved   ?? 0;
  const loanDisbursed  = project.loanDisbursed  ?? kpis.loan?.disbursed  ?? 0;
  const budgetApproved = project.budgetApproved ?? 0;            // si no lo llevas en kpis, quedará 0
  const budgetSpent    = project.budgetSpent    ?? project.expense ?? 0;

  const tiles = [
    { key:'loan-approved',   label:'Loan aprobado',     value: fmt(loanApproved) },
    { key:'disbursed',       label:'Desembolsado',      value: fmt(loanDisbursed) },
    { key:'budget-approved', label:'Budget aprobado',   value: fmt(budgetApproved) },
    { key:'expense', label:'Gasto', value: fmt(window.FINANCE_KPIS?.real?.uses ?? budgetSpent ?? 0) },
    { key:'units-total',     label:'Unidades totales',  value: (hs.unitsTotal ?? project.unitsTotal ?? 0) },
    { key:'units-sold',      label:'Unidades vendidas', value: (hs.unitsSold  ?? project.unitsSold  ?? 0) },
  ];

  kpisDiv.innerHTML = tiles.map(t => `
    <div class="kpi" data-key="${t.key}">
      <div class="label">${t.label}</div>
      <div class="value">${t.value}</div>
    </div>
  `).join('');
}

function authHeadersFromApp(){
  const h = {};

  const token =
    (window.API && typeof API.getToken === 'function' && API.getToken()) ||
    (document.cookie.split('; ').find(r=>r.startsWith('token='))?.split('=')[1]) ||
    localStorage.getItem('authToken') ||
    localStorage.getItem('token') ||
    sessionStorage.getItem('authToken') ||
    sessionStorage.getItem('token');

  // SOLO si hay token real (no null/undefined/cadena vacía)
  if (token && token !== 'null' && token !== 'undefined') {
    h['Authorization'] = `Bearer ${token}`;
    h['x-auth-token'] = token; // compat
  }

  const tenant =
    (window.API && typeof API.getTenantKey === 'function' && API.getTenantKey()) ||
    (document.cookie.split('; ').find(r=>r.startsWith('tenantKey='))?.split('=')[1]) ||
    localStorage.getItem('tenantKey') ||
    sessionStorage.getItem('tenantKey');

  if (tenant && tenant !== 'null' && tenant !== 'undefined') {
    h['x-tenant'] = tenant;
    h['x-tenant-key'] = tenant; // compat
  }
  return h;
}

// --- 1) ÚNICA versión de renderBeforeAfter (tolerante a tag/baTag)
function renderBeforeAfter(items){
  const getTag = (x) => (x?.tag || x?.baTag || '').toUpperCase();
  const before = (items||[]).filter(x => getTag(x) === 'BEFORE');
  const after  = (items||[]).filter(x => getTag(x) === 'AFTER');

  const paint = (arr, gridId) => {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    if (!arr.length){
      grid.innerHTML = '<div class="small muted">Sin imágenes.</div>';
      return;
    }
    grid.innerHTML = arr.map(it=>`
      <figure class="ba-card">
        <img src="/${it.path}" alt="${it.label||''}" style="width:100%;height:180px;object-fit:cover;border-radius:10px"/>
        <figcaption class="small" style="margin-top:6px">${it.label||'Foto'}</figcaption>
        <div class="row space-between small muted">
          <span>${getTag(it)}</span>
          <button class="btn btn-ghost btn-xs js-ba-delete" data-id="${it._id}">Eliminar</button>
        </div>
      </figure>
    `).join('');
  };

  paint(before, 'baBeforeGrid');
  paint(after,  'baAfterGrid');
}

// --- 2) Helper que SÍ lee la fuente real
async function refreshBeforeAfter() {
  try {
    // 1) Trae docs de beforeAfter
    const list = await API.get(`/api/documents?projectId=${id}&category=beforeAfter&ts=${Date.now()}`);

    // 2) Normaliza a array
    const docs = Array.isArray(list) ? list : (list?.documents || list?.items || []);

    // ===============================
    // ✅ Export: preparar Antes/Después
    // ===============================
    const toAbs = (u) => {
      if (!u) return null;
      if (/^https?:\/\//i.test(u)) return u;
      return `${location.origin}${u.startsWith('/') ? '' : '/'}${u}`;
    };

    // URL del archivo (ajusta si tu backend usa otro nombre)
    const getUrl = (d) => d?.url || d?.fileUrl || d?.downloadUrl || d?.path || d?.href || null;

    // Filtra SOLO imágenes y ordénalas por fecha
    const imgDocs = (docs || [])
      .filter(d => String(d?.mimetype || d?.contentType || '').startsWith('image/'))
      .slice()
      .sort((a,b) => new Date(a.createdAt || a.updatedAt || 0) - new Date(b.createdAt || b.updatedAt || 0));

    // ✅ MODO SEGURO: exporta todas las fotos en orden (sin depender de side)
    window.__BEFORE_AFTER__ = imgDocs
      .map(d => toAbs(getUrl(d)))
      .filter(Boolean);

    console.log('[BA] docs total:', docs.length);
    console.log('[BA] imgDocs:', imgDocs.length);
    console.log('[BA] export list len:', window.__BEFORE_AFTER__.length);
    console.log('[BA] first:', window.__BEFORE_AFTER__[0]);

    // 3) Render UI con el array normalizado
    renderBeforeAfter(docs);

  } catch (e) {
    console.error('refreshBeforeAfter error', e);
  }
}

// --- 3) Subida usando refreshBeforeAfter
async function uploadBA(which, files) {
  if (!files?.length) return;

  const fd = new FormData();
  [...files].forEach(f => fd.append('files', f));
  if (window.__activeChecklistId) fd.append('checklistId', window.__activeChecklistId);
  if (window.__currentUnitId)     fd.append('unitId', window.__currentUnitId);

  const url = `/api/documents/upload?projectId=${encodeURIComponent(id)}&category=beforeAfter&baTag=${encodeURIComponent(which)}`;
  const headers = { ...authHeaders(), ...tenantHeaders() }; // ya los tienes definidos arriba

  const resp = await fetch(url, { method:'POST', body: fd, credentials:'include', headers });
  if (!resp.ok) {
    const txt = await resp.text().catch(()=> '');
    console.error('uploadBA error:', resp.status, txt);
    alert(`Error subiendo archivos (${resp.status}).`);
    return;
  }
  await refreshBeforeAfter();
}

// ✅ Bind global: borrar fotos Antes/Después
(function bindBADeleteOnce(){
  if (window.__BA_DELETE_BOUND__) return;
  window.__BA_DELETE_BOUND__ = true;

  // roles que NO necesitan PIN (igual que FULL_ACCESS_ROLES del backend)
  const FULL = ['admin','bank','promoter','gerencia','socios',];

  const getRole = () => {
    try {
      // si tienes API.getAuth() úsalo
      const a = (typeof API !== 'undefined' && typeof API.getAuth === 'function') ? API.getAuth() : null;
      const r = (a?.role || localStorage.getItem('role') || '').toString().toLowerCase().trim();
      return r;
    } catch {
      return (localStorage.getItem('role') || '').toString().toLowerCase().trim();
    }
  };

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.js-ba-delete');
    if (!btn) return;

    const docId = btn.dataset.id;
    if (!docId) return;

    if (!confirm('¿Eliminar esta imagen?')) return;

    const role = getRole();
    const needsPin = !FULL.includes(role);

    // ✅ si NO es rol alto, pedimos PIN
    let pin = '';
    if (needsPin) {
      pin = prompt('Introduce el PIN para borrar:') || '';
      pin = pin.trim();
      if (!pin) return; // cancelado / vacío
    }

    try {
      // ✅ manda pin por query (más robusto que body en DELETE)
      const url = needsPin
        ? `/api/documents/${docId}?pin=${encodeURIComponent(pin)}`
        : `/api/documents/${docId}`;

      const resp = await fetch(url, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          ...(typeof authHeaders === 'function' ? authHeaders() : {}),
          ...(typeof tenantHeaders === 'function' ? tenantHeaders() : {})
        }
      });

      if (!resp.ok) {
        const txt = await resp.text().catch(()=> '');
        throw new Error(`No se pudo eliminar (HTTP ${resp.status}) ${txt}`);
      }

      await refreshBeforeAfter();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Error eliminando');
    }
  });
})();

function wireBAUploads(){
  const bInput = document.getElementById('baBeforeInput');
  const aInput = document.getElementById('baAfterInput');
  const bBtn   = document.getElementById('baBeforeBtn');
  const aBtn   = document.getElementById('baAfterBtn');
  if (bBtn && bInput) bBtn.onclick = ()=> uploadBA('BEFORE', bInput.files);
  if (aBtn && aInput) aBtn.onclick = ()=> uploadBA('AFTER',  aInput.files);
}

async function renderSummaryUI(payload){

  // 1) Datos base
  const project    = payload.project || {};
  const headerKpis = payload.headerKpis || {};

    // ✅ Cargar permisos reales para que la gráfica salga bien "de primeras"
  try {
    if (!__permits?.items?.length) {
      __permits = await apiPermitsGetProject(true); // GET permisos del proyecto
    }
  } catch (e) {
    console.warn('[Summary] No se pudieron cargar permisos para gráfica', e);
  }

    // 2) Pintar cabecera (los cuadros)
  // ✅ Prioridad: lo persistido en Project (se actualiza al importar)
  // fallback: headerKpis (por si algún proyecto viejo aún no tiene números guardados)
  const headerKpisFixed = {
    ...headerKpis,
    unitsTotal: (project.unitsTotal ?? headerKpis.unitsTotal ?? 0),
    unitsSold:  (project.unitsSold  ?? headerKpis.unitsSold  ?? 0),
  };

  renderHeaderKpis(project, headerKpisFixed);

  // 3) Texto “x/y unidades vendidas (%)”
  const sold  = headerKpisFixed.unitsSold  ?? 0;
  const total = headerKpisFixed.unitsTotal ?? 0;
  const pct   = total ? Math.round(100 * sold / total) : 0;
  const unitsTxt = document.getElementById('summaryUnits');
  if (unitsTxt) unitsTxt.textContent = `${sold}/${total} unidades vendidas (${pct}%)`;

  // 4) KPIs (fallback SOLO si backend no envía payload.kpis)
  const kpis = payload.kpis || (()=>{
    // ✅ Absorción 3m (frontend) si backend no lo trae / viene 0
if (!kpis.absorption3m || Number(kpis.absorption3m) === 0) {
  const calc = calcAbsorption3mFromSalesMonthly(salesMonthly);
  if (calc) kpis.absorption3m = calc;
}
    const progressPct = Number(payload?.progress?.globalPct || 0);
    return {
      progressPct,
      units: {
        total: project.unitsTotal||0,
        available: project.unitsAvailable||0,
        sold: project.unitsSold||0,
        escrituradas: project.unitsDeeded||0
      },
      absorption3m: project.absorption3m || 0,
      avgTicket: project.avgTicket || 0,
      inventoryValue: project.inventoryValue || 0,
      loan: {
        approved: project.loanApproved||0,
        disbursed: project.loanDisbursed||0,
        pct: (project.loanApproved
              ? Math.round(100*(project.loanDisbursed||0)/project.loanApproved)
              : 0)
      },
      cpp: { active: project.cppActive||0, due30: project.cppDue30||0, due60: project.cppDue60||0, due90: project.cppDue90||0 },
      permits: { approved: project.permitsApproved||0, inProcess: project.permitsInProcess||0, pending: project.permitsPending||0, pct: project.permitsPct||0 },
      appraisal: { avg: project.appraisalAvg||0, min: project.appraisalMin||0, max: project.appraisalMax||0 },
      clientMortgages30d: project.clientMortgages30d||0
    };
  })();

  const progressByPhase      = payload.progressByPhase      || [];
  const permitsByInstitution = payload.permitsByInstitution || [];
  const cppByBank            = payload.cppByBank            || [];
  const proformasByBank      = payload.proformasByBank      || [];
  const unitsByStatus        = payload.unitsByStatus        || [];
  const salesMonthly         = payload.salesMonthly         || [];
  const disbursements        = payload.disbursements        || { planCum:[], realCum:[] };
  const mortgagesByBank      = payload.mortgagesByBank      || [];
  const alerts               = payload.alerts               || { expiries:[], notes:[] };
  const beforeAfter          = payload.beforeAfter          || [];
  const financePhases = payload?.finance?.phases || [];

  renderPhaseChart(financePhases, 'sumPhaseChart');

  // Cabecera
  const name = project.name || 'Proyecto';
  document.getElementById('summaryProjectName').textContent = name;
  document.getElementById('summaryUpdatedAt').textContent = 'Actualizado: ' + (new Date(project?.updatedAt||Date.now())).toLocaleString();
  

  // KPIs
  const u = kpis.units || {};
  const loan = kpis.loan || {};
  const cpp  = kpis.cpp  || {};
  const app  = kpis.appraisal || {};
  const cards = [
  kpiCard('Progreso global', (kpis.progressPct||0) + '%'),
  kpiCard('Unidades', `${u.total||0} totales`, `${u.available||0} disp · ${u.sold||0} vend · ${u.escrituradas||0} escr.`),
  kpiCard('Absorción 3m', (kpis.absorption3m||0)+' u/mes'),
  kpiCard('Ticket promedio', (kpis.avgTicket||0).toLocaleString()),
  (kpis.inventoryValue ? kpiCard('Inventario a valor', (kpis.inventoryValue||0).toLocaleString()) : ''),
  kpiCard('CPP', `${cpp.active||0} activos`, `30d:${cpp.due30||0} · 60d:${cpp.due60||0} · 90d:${cpp.due90||0}`),
  kpiCard('Permisos', `${kpis.permits?.approved||0} A / ${kpis.permits?.inProcess||0} T / ${kpis.permits?.pending||0} P`, (kpis.permits?.pct||0)+'%'),
  ((app.avg || app.min || app.max) ? kpiCard('Avalúo promedio', (app.avg||0).toLocaleString(), `min ${app.min||0} · max ${app.max||0}`) : ''),
  kpiCard('Hipotecas 30d', kpis.clientMortgages30d||0)
].filter(Boolean);
  document.getElementById('summaryKpis').innerHTML = cards.join('');

  // ================================
// Gráfica de FINANZAS dentro del RESUMEN
// ================================
try {
  const fin = await API.get(`/api/projects/${id}/finance?ts=${Date.now()}`);
  const phases = fin?.finance?.phases || [];

  if (phases.length) {
    renderPhaseChart(phases, 'sumPhaseChart');
  } else {
    console.warn('[Resumen] Finanzas sin fases');
  }
} catch (e) {
  console.error('[Resumen] Error cargando fases de finanzas', e);
}


  // Progreso global (barra bajo KPIs)
const progressPct = Number(kpis?.progressPct || 0);
const spT = document.getElementById('summaryProgressText');
const spB = document.getElementById('summaryProgressBar');
if (spT) spT.textContent = `${progressPct}% completado`;
if (spB) spB.style.width = `${progressPct}%`;

  // ====== FIX GRÁFICAS: normalizadores (para que no dependan del backend perfecto) ======
const toNum = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  // "1.234,56" o "1234.56"
  const s = String(v).trim().replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

const toStr = (v) => (v === null || v === undefined) ? '' : String(v).trim();

// Ordena "YYYY-MM" o "YYYY/MM" o "MM/YYYY" (si viene raro)
const monthKey = (m) => {
  const s = toStr(m).replace('/', '-');
  // si ya viene YYYY-MM
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  // si viene MM-YYYY
  const mmYYYY = s.match(/^(\d{2})-(\d{4})$/);
  if (mmYYYY) return `${mmYYYY[2]}-${mmYYYY[1]}`;
  return s; // fallback
};

const sortByMonth = (arr) =>
  (arr || []).slice().sort((a, b) => monthKey(a.month).localeCompare(monthKey(b.month)));

const uniq = (arr) => Array.from(new Set(arr || []));

// Helpers
const ctx = (id) => {
  const el = document.getElementById(id);
  return (el && typeof Chart !== 'undefined') ? el.getContext('2d') : null;
};

function calcAbsorption3mFromSalesMonthly(salesMonthly) {
  const sm = sortByMonth(salesMonthly).map(x => ({
    month: monthKey(x.month),
    units: toNum(x.units)
  }));

  // Nos quedamos con los últimos 3 meses que existan
  const last3 = sm.slice(-3);
  if (!last3.length) return 0;

  const sum = last3.reduce((a, x) => a + (x.units || 0), 0);
  const avg = sum / last3.length;

  // 1 decimal para que quede bonito (puedes cambiarlo a Math.round si quieres entero)
  return Math.round(avg * 10) / 10;
}

// ---------- Progreso por fase ----------
sumDestroy('p1');
if (ctx('sumProgressByPhase')) {
  __sumCharts.p1 = new Chart(ctx('sumProgressByPhase'), {
    type: 'bar',
    data: {
      labels: (progressByPhase || []).map(x => x.phase),
      datasets: [{ label: '% completado', data: (progressByPhase || []).map(x => toNum(x.pct)) }]
    },
    options: { responsive: true, scales: { y: { beginAtZero: true, max: 100 } } }
  });
}

// ---------- Permisos por institución (apilada) ----------
sumDestroy('p2');
if (ctx('sumPermitsByInstitution')) {

  // 1) Si tenemos __permits (cargado por modal), recalculamos perfecto desde items
  // 2) Si NO, usamos lo que trae el backend (payload.permitsByInstitution) para no dejarlo vacío
  const inst = (__permits?.items?.length)
    ? buildPermitsByInstitution(__permits.items)
    : (permitsByInstitution || []);

  __sumCharts.p2 = new Chart(ctx('sumPermitsByInstitution'), {
    type: 'bar',
    data: {
      labels: inst.map(x => x.institution),
      datasets: [
        { label: 'Pendiente',  data: inst.map(x => toNum(x.pending)),   stack: 's' },
        { label: 'En trámite', data: inst.map(x => toNum(x.inProcess)), stack: 's' },
        { label: 'Aprobado',   data: inst.map(x => toNum(x.approved)),  stack: 's' },
        { label: 'Rechazado',  data: inst.map(x => toNum(x.rejected)),  stack: 's' },
      ]
    },
    options: { responsive: true, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
  });
}

// ---------- CPP por banco (pie) ----------
sumDestroy('p3');
if (ctx('sumCppPie')) {
  __sumCharts.p3 = new Chart(ctx('sumCppPie'), {
    type: 'pie',
    data: {
      labels: (cppByBank || []).map(x => x.bank),
      datasets: [{ data: (cppByBank || []).map(x => toNum(x.count)) }]
    },
    options: { responsive: true, plugins: { legend: { position: 'right' } } }
  });
}

// ---------- Proformas por banco ----------
sumDestroy('p4');

const pfLabels = (proformasByBank || []).map(x => x.bank);
const pfData   = (proformasByBank || []).map(x => toNum(x.count));

const pfTotal = pfData.reduce((a,v)=>a + (Number(v)||0), 0);
const elTot = document.getElementById('sumProformasTotal');
if (elTot) elTot.textContent = pfTotal;

if (ctx('sumProformasBar')) {
  __sumCharts.p4 = new Chart(ctx('sumProformasBar'), {
    type: 'bar',
    data: {
      labels: pfLabels,
      datasets: [{
        label: 'Proformas',
        data: pfData
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => ` ${c.label}: ${c.parsed.y}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0 }
        }
      }
    }
  });
}

// ---------- Estado de unidades (donut) ----------
sumDestroy('p5');
if (ctx('sumUnitsDonut')) {
  __sumCharts.p5 = new Chart(ctx('sumUnitsDonut'), {
    type: 'doughnut',
    data: {
      labels: (unitsByStatus || []).map(x => x.status),
      datasets: [{ data: (unitsByStatus || []).map(x => toNum(x.count)) }]
    },
    options: { responsive: true, plugins: { legend: { position: 'right' } } }
  });
}

// ---------- Ventas mensuales (FIX: orden y números) ----------
sumDestroy('p6');
if (ctx('sumSalesMonthly')) {
  const sm = sortByMonth(salesMonthly).map(x => ({
    month: monthKey(x.month),
    units: toNum(x.units)
  }));

  __sumCharts.p6 = new Chart(ctx('sumSalesMonthly'), {
    type: 'line',
    data: {
      labels: sm.map(x => x.month),
      datasets: [{ label: 'Unidades', data: sm.map(x => x.units), tension: .3 }]
    },
    options: { responsive: true, scales: { y: { beginAtZero: true } } }
  });
}

// ---------- Desembolsos plan vs real (FIX: alinear meses + ordenar + números) ----------
sumDestroy('p7');
if (ctx('sumDisbPlanReal')) {
  const planRaw = sortByMonth(disbursements?.planCum || []).map(x => ({
    month: monthKey(x.month),
    amount: toNum(x.amount)
  }));
  const realRaw = sortByMonth(disbursements?.realCum || []).map(x => ({
    month: monthKey(x.month),
    amount: toNum(x.amount)
  }));

  const months = uniq([
    ...planRaw.map(x => x.month),
    ...realRaw.map(x => x.month)
  ]).sort((a, b) => a.localeCompare(b));

  const planMap = new Map(planRaw.map(x => [x.month, x.amount]));
  const realMap = new Map(realRaw.map(x => [x.month, x.amount]));

  __sumCharts.p7 = new Chart(ctx('sumDisbPlanReal'), {
    type: 'line',
    data: {
      labels: months,
      datasets: [
        { label: 'Plan', data: months.map(m => planMap.get(m) ?? 0), tension: .3 },
        { label: 'Real', data: months.map(m => realMap.get(m) ?? 0), tension: .3 }
      ]
    },
    options: { responsive: true, scales: { y: { beginAtZero: true } } }
  });
}

// ---------- Hipotecas por banco ----------
sumDestroy('p8');
if (ctx('sumMortgagesByBank')) {
  __sumCharts.p8 = new Chart(ctx('sumMortgagesByBank'), {
    type: 'bar',
    data: {
      labels: (mortgagesByBank || []).map(x => x.bank),
      datasets: [{ label: 'Hipotecas', data: (mortgagesByBank || []).map(x => toNum(x.count)) }]
    },
    options: { responsive: true, scales: { y: { beginAtZero: true } } }
  });
}

// ---------- Alertas por severidad ----------
sumDestroy('p9');
if (ctx('sumAlertsSeverity')) {
  const sev = (alerts?.bySeverity || []);
  __sumCharts.p9 = new Chart(ctx('sumAlertsSeverity'), {
    type: 'bar',
    data: {
      labels: sev.map(x => x.severity),
      datasets: [{
        label: 'Alertas',
        data: sev.map(x => toNum(x.count))
      }]
    },
    options: { responsive: true, scales: { y: { beginAtZero: true } } }
  });
}

// ---------- Expedientes atrasados por etapa ----------
sumDestroy('p10');
if (ctx('sumDelaysByStage')) {
  const d = (kpis?.delaysByStage || []);
  __sumCharts.p10 = new Chart(ctx('sumDelaysByStage'), {
    type: 'bar',
    data: {
      labels: d.map(x => x.stage),
      datasets: [{
        label: 'Expedientes atrasados',
        data: d.map(x => toNum(x.count))
      }]
    },
    options: { responsive: true, scales: { y: { beginAtZero: true } } }
  });
}

// ---------- Alertas + conclusiones ----------
// ✅ Solo mostrar vencimientos de documentos ACTIVOS (no cumplidos / no reemplazados)
const isActiveDoc = (a) => String(a?.status || '').toUpperCase() === 'ACTIVE';
const alertsDiv = document.getElementById('summaryAlerts');
if (alertsDiv) {
  alertsDiv.innerHTML = (alerts?.expiries || []).filter(isActiveDoc)
    .sort((a,b) => new Date(a.due || 0) - new Date(b.due || 0))
    .slice(0, 10)
    .map(a =>
      `<div class="row space-between small" style="padding:6px 8px;border:1px solid #eee;border-radius:8px;margin-bottom:6px;">
        <div>${a.type} — <b>${a.name || a.bank || a.institution || ''}</b></div>
        <div>${a.due ? new Date(a.due).toISOString().slice(0, 10) : '—'}</div>
      </div>`
    )
    .join('') || '<div class="small muted">Sin vencimientos próximos</div>';
}

const notesUl = document.getElementById('summaryNotes');
if (notesUl) {
  notesUl.innerHTML = (alerts?.notes || []).map(n => `<li>${n}</li>`).join('') || '<li class="muted">Sin observaciones</li>';
}

// Antes / Después
wireBADeleteDelegation();      // ✅ bind 1 sola vez
await loadBeforeAfterGallery();
addInfoBadges();
wireInfoTooltips();
}

async function syncUnitsSoldFromPortfolio() {
  try {
    // 1) Traemos el mismo listado que usa el portfolio
    const list = await API.get('/api/projects/portfolio');
    const me = (list || []).find(p => String(p._id) === String(id));
    if (!me) return;

    // 2) Actualizamos los tiles de cabecera
    const tiles = (kpisDiv && kpisDiv.querySelectorAll('.kpi')) || [];
    tiles.forEach(tile => {
      const label = tile.querySelector('.label')?.textContent?.trim().toLowerCase();
      const valEl = tile.querySelector('.value');
      if (!valEl || !label) return;

      if (label === 'unidades vendidas') {
        valEl.textContent = (me.unitsSold || 0).toLocaleString();
      }
      if (label === 'unidades totales') {
        valEl.textContent = (me.unitsTotal || 0).toLocaleString();
      }
    });

    // 3) (opcional) Línea pequeña “x/y unidades vendidas (%)” si la tienes
    const unitsTxt = document.getElementById('summaryUnits');
    if (unitsTxt) {
      const sold  = me.unitsSold  || 0;
      const total = me.unitsTotal || 0;
      const pct   = total ? Math.round(100 * sold / total) : 0;
      unitsTxt.textContent = `${sold}/${total} unidades vendidas (${pct}%)`;
    }
  } catch (e) {
    console.error('syncUnitsSoldFromPortfolio error', e);
  }
}

window.__BEFORE_AFTER__ = [];

async function loadSummary() {
  try {
    // evitar caché del navegador
    const res = await API.get(`/api/projects/${id}/summary?ts=${Date.now()}`);

    // 🔥 recalcular progreso EXACTAMENTE igual que Proyecto
 try {
  const raw = await API.get(`/api/projects/${id}/checklists?ts=${Date.now()}`);
  const list = (raw?.checklists || raw || []);

  const filtered = list.filter(c => true); // igual que globalProgress (sin onlyPending)
  const total = filtered.reduce((acc, c) => acc + checklistProgress(c), 0);
  const pct = filtered.length ? Math.round(total / filtered.length) : 0;

  res.kpis = res.kpis || {};
  res.kpis.progressPct = pct;

  res.progress = res.progress || {};
  res.progress.globalPct = pct;

  console.log('[Resumen] Progreso recalculado:', pct);
} catch (e) {
  console.warn('Error recalculando progreso', e);
}

    // ===== Exportación (RESUMEN) => POST + incluir gráficas (canvas) =====
    const exl = document.getElementById('exportSummaryXlsx');
    const pdf = document.getElementById('exportSummaryPdf');

    const captureCanvas = (canvasId) => {
      const c = document.getElementById(canvasId);
      if (!c) return null;

      // 2x + fondo blanco (para que no salga transparente en PDF/Excel)
      const scale = 2;
      const off = document.createElement('canvas');
      off.width = c.width * scale;
      off.height = c.height * scale;

      const ctx2 = off.getContext('2d');
      ctx2.fillStyle = '#ffffff';
      ctx2.fillRect(0, 0, off.width, off.height);
      ctx2.drawImage(c, 0, 0, off.width, off.height);

      return off.toDataURL('image/png');
    };

    const downloadBlob = async (resp, filename) => {
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    };

    const exportSummary = async (format) => {
      // Capturamos charts (los que existan)
      const charts = {
        'Progreso por fase': captureCanvas('sumProgressByPhase'),
        'Permisos por institución': captureCanvas('sumPermitsByInstitution'),
        'CPP por banco': captureCanvas('sumCppPie'),
        'Proformas por banco': captureCanvas('sumProformasBar'),
        'Estado de unidades': captureCanvas('sumUnitsDonut'),
        'Ventas mensuales': captureCanvas('sumSalesMonthly'),
        'Hipotecas por banco': captureCanvas('sumMortgagesByBank'),
        // NUEVAS (si las añadiste al HTML)
        'Alertas por severidad': captureCanvas('sumAlertsSeverity'),
        'Expedientes atrasados por etapa': captureCanvas('sumDelaysByStage'),
      };

      // Limpia nulls
Object.keys(charts).forEach(k => { if (!charts[k]) delete charts[k]; });

// 1) payload del summary: si no existe, no rompe
const payload = window.__LAST_SUMMARY_PAYLOAD__ || {};

// 2) datasets (para que el backend pueda sacar "insights")
const datasets = {
  permitsByInstitution: payload.permitsByInstitution || [],
  cppByBank: payload.cppByBank || [],
  proformasByBank: payload.proformasByBank || [],
  unitsByStatus: payload.unitsByStatus || [],
  salesMonthly: payload.salesMonthly || [],
  mortgagesByBank: payload.mortgagesByBank || [],
  progressByPhase: payload.progressByPhase || [],
  alerts: payload.alerts || {},
  kpis: payload.kpis || {},
  project: payload.project || {}
};

// 3) ✅ antes/después desde la UI (si no existe, manda [])
const beforeAfter = Array.isArray(window.__BEFORE_AFTER__) ? window.__BEFORE_AFTER__ : [];

const resp2 = await fetch(`/api/projects/${id}/summary/export`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(typeof authHeaders === 'function' ? authHeaders() : {}),
    ...(typeof tenantHeaders === 'function' ? tenantHeaders() : {}),
  },
  body: JSON.stringify({ format, charts, datasets, beforeAfter })
});

      if (!resp2.ok) {
        const txt = await resp2.text().catch(() => '');
        throw new Error(`Export falló (HTTP ${resp2.status}) ${txt}`);
      }

      const ext = (format === 'pdf') ? 'pdf' : 'xlsx';
      await downloadBlob(resp2, `resumen_${id}.${ext}`);
    };

    // Bind una sola vez (Excel)
    if (exl) {
      exl.href = '#';
      if (!exl.dataset.bound) {
        exl.dataset.bound = '1';
        exl.addEventListener('click', (e) => {
          e.preventDefault();
          exportSummary('xlsx').catch(err => {
            console.error(err);
            alert(err.message || 'Error exportando Excel');
          });
        });
      }
    }

    // Bind una sola vez (PDF)
    if (pdf) {
      pdf.href = '#';
      if (!pdf.dataset.bound) {
        pdf.dataset.bound = '1';
        pdf.addEventListener('click', (e) => {
          e.preventDefault();
          exportSummary('pdf').catch(err => {
            console.error(err);
            alert(err.message || 'Error exportando PDF');
          });
        });
      }
    }

    // ===== Pintar todo el resumen =====
    renderSummaryUI(res);

    // ===== Importar Dato Único (bind una sola vez) =====
    const importBtn = document.getElementById('importDatoUnicoBtn');
    if (importBtn && !importBtn.dataset.bound) {
      importBtn.dataset.bound = '1';
      importBtn.addEventListener('click', async () => {
        try {
          const input = document.getElementById('datoUnicoFile');
          const f = input?.files?.[0];
          if (!f) return alert('Selecciona el Excel primero');

          const fd = new FormData();
          fd.append('file', f);

          const resp3 = await fetch(`/api/projects/${id}/import-dato-unico`, {
            method: 'POST',
            body: fd,
            headers: {
              ...(typeof authHeaders === 'function' ? authHeaders() : {}),
              ...(typeof tenantHeaders === 'function' ? tenantHeaders() : {}),
            }
          });

          if (!resp3.ok) {
            const txt = await resp3.text().catch(() => '');
            console.error(txt);
            return alert('Error importando Dato Único (mira consola)');
          }

          const json = await resp3.json();
          alert(`Importado: ${json.ventasUpserted} ventas / ${json.unitsUpserted} unidades`);

          // recargar resumen/gráficas
          await loadSummary();
          await refreshTopHeaderKpis();
          if (typeof loadCommercial === 'function') {
  await loadCommercial();
}
        } catch (err) {
          console.error(err);
          alert(err.message || 'Error importando Dato Único');
        }
      });
    }

    // Wire de subida Antes/Después
    wireBAUploads();

    // Refrescar la grilla A/D directamente desde /api/documents
    await refreshBeforeAfter();

    await syncUnitsSoldFromPortfolio();
  } catch (e) {
    console.error('Error cargando resumen', e);
  }
}

async function refreshTopHeaderKpis() {
  const payload = await API.get(`/api/projects/${id}/summary?ts=${Date.now()}`);

  const project    = payload.project || {};
  const headerKpis = payload.headerKpis || {};

  const headerKpisFixed = {
    ...headerKpis,
    unitsTotal: (project.unitsTotal ?? headerKpis.unitsTotal ?? 0),
    unitsSold:  (project.unitsSold  ?? headerKpis.unitsSold  ?? 0),
  };

  renderHeaderKpis(project, headerKpisFixed);

  const pname = document.getElementById('pname');
  if (pname && project.name) pname.textContent = project.name;
}

function addInfoBadges(){
  const tips = {
    sumProgressByPhase: 'Promedio de avance por fase según checklists (level 1..6).',
    sumPermitsByInstitution: 'Permisos por institución: pendiente / trámite / aprobado.',
    sumCppPie: 'CPP/aprobaciones por banco: statusBanco contiene CPP/APROB o fechas CPP.',
    sumProformasBar: 'Proformas entregadas por banco (statusBanco contiene PROFORMA).',
    sumUnitsDonut: 'Unidades: disponibles, reservadas, vendidas, escrituradas, canceladas.',
    sumSalesMonthly: 'Contratos firmados por mes (fechaContratoCliente).',
    sumDisbPlanReal: 'Desembolsos plan vs. real (acumulado).',
    sumMortgagesByBank: 'Hipotecas aprobadas por banco (statusBanco contiene APROB).'
  };
  for (const [id, tip] of Object.entries(tips)) {
    const canvas = document.getElementById(id);
    if (!canvas) continue;
    const h3 = canvas.closest('.card')?.querySelector('h3');
    if (h3 && !h3.querySelector('.info-dot')) {
      const i = document.createElement('span');
      i.className = 'info-dot';
      i.dataset.tip = tip;
      i.textContent = 'i';
      h3.appendChild(i);
    }
  }
}

let __infoTogglesWired = false;
function wireInfoTooltips(){
  if (__infoTogglesWired) return;
  __infoTogglesWired = true;
  // Toggle por click (sirve para móvil); click fuera cierra
  document.addEventListener('click', (e)=>{
    const isDot = e.target.closest('.info-dot');
    document.querySelectorAll('#tab-resumen .info-dot[data-open="1"]')
      .forEach(el => el.setAttribute('data-open','0'));
    if (isDot) {
      isDot.setAttribute('data-open','1');
      e.stopPropagation();
    }
  });
}

  // ====== Catálogos: fases y roles ======
  const PHASES = [
    { key:'PREESTUDIOS',     name:'Pre-estudios',         color:'#1e90ff', pale:'#e6f2ff' },
    { key:'PERMISOS',        name:'Permisos',             color:'#2ecc71', pale:'#eafff2' },
    { key:'FINANCIACION',    name:'Financiación',         color:'#f39c12', pale:'#fff4e0' },
    { key:'CONTRATISTAS',    name:'Contratistas',         color:'#9b59b6', pale:'#f5e9fb' },
    { key:'OBRA',            name:'Obra',                 color:'#e74c3c', pale:'#ffe9e7' },
    { key:'ESCRITURACION',   name:'Escrituración',        color:'#16a085', pale:'#e6fffb' },
  ];
  const ROLE_COLORS = {
    'TECNICO'       : { color:'#60a5fa', pale:'#eaf2ff', label:'Técnico' },
    'LEGAL'         : { color:'#f87171', pale:'#fff0f0', label:'Legal' },
    'GERENCIA'      : { color:'#34d399', pale:'#ecfdf5', label:'Gerencia' },
    'COMERCIAL'     : { color:'#f59e0b', pale:'#fff7ed', label:'Comercial' },
    'FINANCIERO'    : { color:'#a78bfa', pale:'#f5f3ff', label:'Financiero' },
    'CONTABILIDAD'  : { color:'#22d3ee', pale:'#ecfeff', label:'Contabilidad' },
    'SOCIOS'        : { color:'#f472b6', pale:'#fdf2f8', label:'Socios' },
    'PROMOTOR_PM'   : { color:'#94a3b8', pale:'#f1f5f9', label:'Promotor' },
    'ADMIN'         : { color:'#0ea5e9', pale:'#e0f2fe', label:'Admin/Banco' },
    'BANCO'         : { color:'#0ea5e9', pale:'#e0f2fe', label:'Banco' },
  };

  // ====== Normalización ======
  const PHASE_ALIAS = new Map([
    ['PREESTUDIOS','PREESTUDIOS'], ['PRE-ESTUDIOS','PREESTUDIOS'], ['PRE ESTUDIOS','PREESTUDIOS'], ['FASE1','PREESTUDIOS'], ['FASE 1','PREESTUDIOS'],
    ['PERMISOS','PERMISOS'], ['LICENCIAS','PERMISOS'], ['FASE2','PERMISOS'], ['FASE 2','PERMISOS'],
    ['FINANCIACION','FINANCIACION'], ['FINANCIACIÓN','FINANCIACION'], ['FINANCIAMIENTO','FINANCIACION'], ['FASE3','FINANCIACION'], ['FASE 3','FINANCIACION'],
    ['CONTRATISTAS','CONTRATISTAS'], ['CONTRATOS','CONTRATISTAS'], ['FASE4','CONTRATISTAS'], ['FASE 4','CONTRATISTAS'],
    ['OBRA','OBRA'], ['CONSTRUCCION','OBRA'], ['CONSTRUCCIÓN','OBRA'], ['FASE5','OBRA'], ['FASE 5','OBRA'],
    ['ESCRITURACION','ESCRITURACION'], ['ESCRITURACIÓN','ESCRITURACION'], ['ENTREGA','ESCRITURACION'], ['FASE6','ESCRITURACION'], ['FASE 6','ESCRITURACION'],
  ]);
  const ROLE_ALIAS = new Map([
    ['TECNICO','TECNICO'], ['TÉCNICO','TECNICO'], ['ARQUITECTO','TECNICO'], ['INGENIERIA','TECNICO'],
    ['LEGAL','LEGAL'], ['JURIDICO','LEGAL'], ['JURÍDICO','LEGAL'],
    ['GERENCIA','GERENCIA'], ['DIRECCION','GERENCIA'], ['DIRECCIÓN','GERENCIA'],
    ['COMERCIAL','COMERCIAL'], ['VENTAS','COMERCIAL'], ['MARKETING','COMERCIAL'],
    ['FINANCIERO','FINANCIERO'], ['FINANZAS','FINANCIERO'],
    ['CONTABILIDAD','CONTABILIDAD'], ['CONTABLE','CONTABILIDAD'],
    ['SOCIOS','SOCIOS'], ['ACREEDORES','SOCIOS'],
    ['PROMOTOR','PROMOTOR_PM'], ['PROMOTOR_PM','PROMOTOR_PM'], ['PM','PROMOTOR_PM'],
    ['BANCO','BANCO'], ['ADMIN','ADMIN'], ['ADMIN/BANCO','ADMIN'], ['ADMON','ADMIN'],
  ]);

  function strip(s) {
    return (s||'').toString()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/['"`‘’“”]/g,'').replace(/\s+/g,' ').trim();
  }
  function canonPhase(s) {
    const raw = strip(s).toUpperCase().replace(/[\s\-]/g,'');
    return PHASE_ALIAS.get(raw) || PHASE_ALIAS.get(strip(s).toUpperCase()) || 'PREESTUDIOS';
  }
  function canonRole(s) {
    const raw = strip(s).toUpperCase();
    return ROLE_ALIAS.get(raw) || 'TECNICO';
  }
    // UI role (chips) -> owner del backend (minúsculas del schema)
function uiRoleToOwner(uiKey) {
  const map = {
    'TECNICO'      : 'tecnico',
    'LEGAL'        : 'legal',
    'GERENCIA'     : 'gerencia',
    'COMERCIAL'    : 'commercial',
    'FINANCIERO'   : 'financiero',
    'CONTABILIDAD' : 'contable',
    'SOCIOS'       : 'socios',
    'PROMOTOR_PM'  : 'promoter',
    'ADMIN'        : 'admin',
    'BANCO'        : 'bank'
  };
  return map[(uiKey||'').toUpperCase()] || 'tecnico';
}

  function pickOrder(c) {
    return Number(c.order ?? c.orderInLevel ?? c.level ?? c.nivel ?? c.sequence ?? c.seq ?? 0) || 0;
  }


  // ====== Estado del módulo Proyecto ======
const state = {
  project: null,
  checklists: [],
  docsByChecklist: {},
  filterRole: null,
  collapsed: new Set(),
  onlyPending: false,
  // NEW: filtro de roles permitidos en checklists (null = sin filtro)
  allowedChecklistRoles: __ALLOWED_ROLES,
  manualUnlocks: new Set()
};

  // ====== Utilidades ======
  const PIN = '2580';
  function askPinOrAbort(msg = 'Introduce PIN numérico (4 dígitos):') {
    const v = prompt(msg || '');
    if (v === null) return false;
    if (v.trim() !== PIN) { alert('PIN incorrecto'); return false; }
    return true;
  }
  function fmtDate(d) { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? '—' : x.toISOString().slice(0,10); }
  function phaseMeta(phaseKey) { return PHASES.find(p=>p.key===phaseKey) || {color:'#e5e7eb', pale:'#f3f4f6', name:phaseKey}; }
  function roleMeta(roleKey)  { return ROLE_COLORS[roleKey] || {color:'#d1d5db', pale:'#f3f4f6', label:roleKey || '—'}; }

  // Progreso por checklist (subtareas)
  function checklistProgress(cl) {
    const subs = cl?.subtasks || [];
    if (!subs.length) return (cl.status === 'COMPLETADO') ? 100 : (cl.status === 'EN_PROCESO' ? 50 : 0);
    const done = subs.filter(s=>!!s.completed).length;
    return Math.round((done / subs.length) * 100);
  }
  // Progreso por fase
  function phaseProgress(phaseKey) {
    const list = state.checklists.filter(c => c.phase === phaseKey && (!state.onlyPending || c.status!=='COMPLETADO'));
    if (!list.length) return 0;
    const total = list.reduce((acc,c)=>acc + checklistProgress(c),0);
    return Math.round(total / list.length);
  }
  // Progreso global
  function globalProgress() {
    const list = state.checklists.filter(c => (!state.onlyPending || c.status!=='COMPLETADO'));
    if (!list.length) return 0;
    const total = list.reduce((acc,c)=>acc + checklistProgress(c),0);
    return Math.round(total / list.length);
  }

// Secuencialidad: activo si está manualmente desbloqueado,
// o si todos los anteriores de la fase están validados o completados.
function isChecklistActive(cl) {
  if (!cl) return false;

  // Desbloqueo manual
  if (state.manualUnlocks && state.manualUnlocks.has(cl._id)) return true;

  const samePhase = state.checklists
    .filter(x => x.phase === cl.phase)
    .sort((a,b) => (a.order || 0) - (b.order || 0));

  const idx = samePhase.findIndex(x => x._id === cl._id);
  if (idx <= 0) return true; // primero de la fase

  // Los anteriores deben estar validados (o completados)
  return samePhase.slice(0, idx).every(x =>
    x.validated === true || x.status === 'COMPLETADO'
  );
}

  // Semáforo por rol
  // Semáforo por rol: considera SOLO checklists ACTIVOS y no completados.
// Rojo  = hay al menos 1 activo pendiente y vencido
// Amarillo = hay al menos 1 activo pendiente (no vencido)
// Verde = no hay activos pendientes para ese rol
function semaphoreForRole(roleKey) {
  const now = Date.now();

  // Solo los checklist de este rol que están ACTIVOS (secundados por validación o desbloqueo manual)
  const activeForRole = state.checklists.filter(c =>
    c.role === roleKey &&
    isChecklistActive(c) &&
    c.status !== 'COMPLETADO'
  );

  if (activeForRole.length === 0) {
    // No hay nada activo pendiente para este rol ahora mismo
    return '🟢';
  }

  const anyOverdue = activeForRole.some(c =>
    c.dueDate && new Date(c.dueDate).getTime() < now
  );

  return anyOverdue ? '🔴' : '🟡';
}


  function kpi(label, v) {
    return `<div class="kpi"><div class="label">${label}</div><div class="value">${(v||0).toLocaleString()}</div></div>`;
  }

  // ====== Carga de datos ======
  async function loadProject() {
    const p = await API.get('/api/projects/' + id);
    state.project = p;
    if (pname)  pname.textContent  = p.name || 'Proyecto';
    if (pdesc)  pdesc.textContent  = p.description || '';
    if (pdesc2) pdesc2.textContent = p.description || '';
    if (statusSel) statusSel.value = (p.status || 'EN_CURSO');

    kpisDiv.innerHTML = [
      kpi('Loan aprobado',     p.loanApproved),
      kpi('Desembolsado',      p.loanDisbursed),
      kpi('Budget aprobado',   p.budgetApproved),
      kpi('Gasto',             (window.FINANCE_KPIS?.real?.uses ?? p.budgetSpent ?? 0)),
      kpi('Unidades totales',  p.unitsTotal),
      kpi('Unidades vendidas', p.unitsSold)
    ].join('');
      // ROLE-SEP: control de publicación y UI para commercial
  const pub = String(
    p.publishStatus || p.publicationStatus || p.pubStatus || p.statusPublicacion || p.statusPublish || ''
  ).toLowerCase();
  const isApproved = (pub === 'approved');

  if (myRole === 'commercial') {
    window.__COMMERCIAL_LOCKED = !isApproved;
    if (reviewBanner) {
      reviewBanner.style.display = window.__COMMERCIAL_LOCKED ? '' : 'none';
    }
  } else {
    window.__COMMERCIAL_LOCKED = false;
    if (reviewBanner) reviewBanner.style.display = 'none';
  }
  }

  async function loadProyectoData() {
    try {
      let res = await API.get(`/api/projects/${id}/checklists?ts=${Date.now()}`);
      const listLen = Array.isArray(res) ? res.length : (res?.checklists?.length || 0);
      if (!listLen) {
        await API.post(`/api/projects/${id}/process/apply-template`, { force: true });
        res = await API.get(`/api/projects/${id}/checklists?ts=${Date.now()}`);
      }
      state.checklists = (res?.checklists || res || []).map(normalizeChecklist);
    } catch { state.checklists = []; }

    // Documentos
    try {
      const docs = await API.get(`/api/documents?projectId=${id}`);

      state.docsByChecklist = {};
      (docs || []).forEach(d => {
        if (!d.checklistId) return;
        if (!state.docsByChecklist[d.checklistId]) state.docsByChecklist[d.checklistId] = [];
        state.docsByChecklist[d.checklistId].push(d);
      });
    } catch { state.docsByChecklist = {}; }

    // Inicializa colapsado: todo cerrado salvo la primera fase con elementos
    if (state.collapsed.size === 0) {
      PHASES.forEach(p => state.collapsed.add(p.key));
      const firstWithItems = PHASES.find(p => state.checklists.some(c => c.phase===p.key));
      if (firstWithItems) state.collapsed.delete(firstWithItems.key);
    }
    // Precarga permisos para que la barra "Permisos" funcione a la primera
    try { __permits = await apiPermitsGetProject(true); } catch { __permits = null; }
  }

  function normalizeChecklist(c) {
    const phaseRaw = c.phase || c.phaseKey || c.fase || c.category || '';
    const roleRaw  = c.roleOwner || c.role || c.ownerRole || c.responsable || c.asignado || (Array.isArray(c.visibleToRoles) ? c.visibleToRoles[0] : '') || '';
    const st = (c.status || '').toUpperCase();

const rawSubs = Array.isArray(c.subtasks)
  ? c.subtasks
  : (Array.isArray(c.children) ? c.children : []);

const subs = (rawSubs || []).map(s => ({
  ...s,
  completed: !!s.completed
}));

// ✅ Status REAL derivado de subtareas (si existen)
let derivedStatus = null;
if (subs.length) {
  const done = subs.filter(s => !!s.completed).length;
  if (done === subs.length) derivedStatus = 'COMPLETADO';
  else if (done > 0) derivedStatus = 'EN_PROCESO';
  else derivedStatus = 'PENDIENTE';
}

// Si no hay subtareas, usa el status backend
const backendCompleted = (c.completed === true || st === 'COMPLETADO' || st === 'DONE');
const status = derivedStatus || (backendCompleted ? 'COMPLETADO'
  : (st === 'EN_PROCESO' || st === 'IN_PROGRESS' ? 'EN_PROCESO' : 'PENDIENTE'));

return {
  _id: c._id || c.id,
  title: c.title || c.name || 'Checklist',
  phase: canonPhase((c.phase || c.phaseKey || c.fase || c.category || '') || 'PREESTUDIOS'),
  role:  canonRole((c.roleOwner || c.role || c.ownerRole || c.responsable || c.asignado || (Array.isArray(c.visibleToRoles) ? c.visibleToRoles[0] : '') || '') || 'TECNICO'),
  status,
  order: pickOrder(c),
  dueDate: c.dueDate || c.vencimiento || null,
  validated: !!c.validated,
  notes: Array.isArray(c.notes) ? c.notes : [],
  subtasks: subs,
  documents: Array.isArray(c.documents) ? c.documents : [],
  createdAt: c.createdAt, updatedAt:c.updatedAt, completedAt:c.completedAt, validatedAt:c.validatedAt
};
  }

  // ====== Render Proyecto ======
  const phasesHost = document.getElementById('phasesHost');
  const rolesList  = document.getElementById('rolesList');
  const globalProgressText = document.getElementById('globalProgressText');
  const globalProgressBar  = document.getElementById('globalProgressBar');
  const verHistorialBtn    = document.getElementById('verHistorialBtn');
  const configProyectoBtn  = document.getElementById('configProyectoBtn');
  const limpiarFiltroRolBtn= document.getElementById('limpiarFiltroRol');
  const toggleAllPhasesBtn = document.getElementById('toggleAllPhasesBtn');
  const togglePendientesBtn= document.getElementById('togglePendientesBtn');

  if (verHistorialBtn) verHistorialBtn.onclick = openHistoryModal;
  if (configProyectoBtn) configProyectoBtn.onclick = openConfigureFlow;
  if (limpiarFiltroRolBtn) limpiarFiltroRolBtn.onclick = () => { state.filterRole = null; renderProyecto(); };
  if (togglePendientesBtn) togglePendientesBtn.onclick = () => {
    state.onlyPending = !state.onlyPending;
    if (togglePendientesBtn) {
  togglePendientesBtn.classList.toggle('is-on', state.onlyPending);
  const st = togglePendientesBtn.querySelector('.state');
  if (st) st.textContent = state.onlyPending ? 'on' : 'off';
   }

    renderProyecto();
  };
  if (toggleAllPhasesBtn) toggleAllPhasesBtn.onclick = () => {
    if (state.collapsed.size) { state.collapsed.clear(); }
    else { PHASES.forEach(p => state.collapsed.add(p.key)); }
    renderProyecto();
  };

  function renderProyecto() {
    const g = globalProgress();
    globalProgressText.textContent = `${g}% completado`;
    globalProgressBar.style.width = `${g}%`;

    // Roles panel
   const distinctRoles = Array.from(new Set(state.checklists.map(c => c.role))).sort();
   const roleKeys = distinctRoles.length ? distinctRoles : Object.keys(ROLE_COLORS);

   rolesList.innerHTML = roleKeys.map(rk => {
   const rm = roleMeta(rk);
   const sem = semaphoreForRole(rk);

   // métricas para tooltip
   const now = Date.now();
   const activePend = state.checklists.filter(c =>
    c.role === rk && isChecklistActive(c) && c.status !== 'COMPLETADO'
   );
   const cntActive  = activePend.length;
   const cntOverdue = activePend.filter(c => c.dueDate && new Date(c.dueDate).getTime() < now).length;
   const ttl = (cntActive > 0)
    ? `Activos pendientes: ${cntActive} · Vencidos: ${cntOverdue}`
    : 'Sin tareas activas pendientes';

   const cls = (state.filterRole === rk) ? 'role-row filter-on' : 'role-row';
   return `<div class="${cls}" data-role="${rk}" style="--role-color:${rm.color}" title="${ttl}">
    <div class="row"><span class="role-badge" style="--role-color:${rm.color};--role-pale:${rm.pale}">${rm.label}</span></div>
    <div class="light" title="${ttl}">
    <span class="sem-dot ${semClassFromEmoji(sem)}" aria-hidden="true"></span>
    </div>
   </div>`;
   }).join('');

   rolesList.querySelectorAll('.role-row').forEach(el=>{
   el.onclick = () => { state.filterRole = el.dataset.role; renderProyecto(); };
   });

    // Fases
    phasesHost.innerHTML = PHASES.map(ph => renderPhase(ph)).join('');
    wireDynamicHandlers();

    // Texto del botón global
    if (toggleAllPhasesBtn) {
      toggleAllPhasesBtn.textContent = state.collapsed.size ? 'Expandir todo' : 'Colapsar todo';
    }
  }

  function semClassFromEmoji(sem) {
  if (sem === '🟢') return 'ok';
  if (sem === '🟡') return 'warn';
  return 'danger'; // 🔴 o cualquier cosa
  }

  function renderPhase(ph) {
  const list = state.checklists
    .filter(c => c.phase === ph.key)
    .filter(c => !state.filterRole || c.role === state.filterRole)
    .filter(c => !state.onlyPending || c.status !== 'COMPLETADO')
    .filter(c => !state.allowedChecklistRoles || state.allowedChecklistRoles.includes(c.role))
    .sort((a,b)=> (a.order??0) - (b.order??0));

  const prChecklist = phaseProgress(ph.key); // calcula por checklists
  let prUI = prChecklist;

  // Si es PERMISOS y ya tenemos los items, sustituimos por progreso real de permisos
  if (ph.key === 'PERMISOS' && __permits?.items?.length) {
    prUI = permitProgress(__permits);
  }

  const collapsedCls = state.collapsed.has(ph.key) ? 'collapsed' : '';
  const addBtn = `
    ${ph.key === 'PERMISOS'
      ? `<button type="button" class="btn btn-ghost btn-xs js-open-permits" data-permits="open">Gestionar permisos</button>`
      : ``}
    <button class="btn btn-ghost btn-xs js-add-cl" data-phase="${ph.key}">+ Checklist</button>
  `;

  return `
    <section class="phase ${collapsedCls}" style="--phase-color:${ph.color}; --phase-pale:${ph.pale}">
      <div class="phase-header">
        <div class="phase-toggle js-toggle-phase" data-phase="${ph.key}">
          <span class="chev">▾</span>
          <div class="phase-title">
            <span>${ph.name}</span>
            <span class="phase-badge">${prUI}% fase</span>   <!-- ✅ usa prUI -->
          </div>
        </div>
        <div class="phase-actions">${addBtn}</div>
      </div>
      <div class="progress"><div style="width:${prUI}%; --accent:${ph.color}"></div></div> <!-- ✅ usa prUI -->
      <div class="cl-list">
        ${list.map(cl => renderChecklistCard(cl, ph)).join('')}
      </div>
    </section>
  `;
}

  function renderChecklistCard(cl, ph) {
  const active = isChecklistActive(cl);
  const disabled = !active; // <- NUEVO
  const rm = roleMeta(cl.role);
  const prog = checklistProgress(cl);
  const delayed = (cl.status!=='COMPLETADO' && cl.dueDate && new Date(cl.dueDate).getTime() < Date.now());
  const docs = state.docsByChecklist[cl._id] || [];
  const statusText = delayed ? 'RETRASADO' : (cl.status || 'PENDIENTE');

  return `
    <div class="cl-card ${disabled ? 'locked' : ''}" data-id="${cl._id}" data-phase="${cl.phase}" style="--role-color:${rm.color}; --role-pale:${rm.pale}; ${disabled ? 'opacity:0.6;' : ''}">
      <div class="cl-head">
        <div class="cl-title">${cl.title}</div>
        <div class="row">
          <span class="role-badge">${rm.label}</span>
          <span class="status-badge">${statusText}</span>
        </div>
      </div>

      <div class="cl-meta">
        <span class="tag">Fase: ${phaseMeta(cl.phase).name}</span>
        <span class="tag">Orden: ${cl.order ?? 0}</span>
        <span class="tag">Vence: ${fmtDate(cl.dueDate)}</span>
        <span class="tag">Validación: ${cl.validated ? '✔︎' : '—'}</span>
      </div>

      <div>
        <div class="progress progress-sm"><div style="width:${prog}%"></div></div>
        <div class="small muted">${prog}% subtareas</div>
      </div>

      <div class="subtasks">
        ${(cl.subtasks||[]).map(s => `
          <label class="subtask">
            <input type="checkbox" class="js-subtoggle subtask-check"
  data-id="${cl._id}"
  data-sid="${s._id||s.id||s.title}"
  ${s.completed ? 'checked':''}
  ${disabled ? 'disabled' : ''}
/>
            <span class="subtask-title">${s.title || s.name}</span>
          </label>
        `).join('')}
        <div class="row">
          <input type="text" class="w-100" placeholder="Nueva subtarea…" data-newsub="${cl._id}" ${disabled ? 'disabled' : ''}/>
          <button class="btn btn-ghost btn-xs js-add-sub" data-id="${cl._id}" ${disabled ? 'disabled' : ''}>Añadir</button>
        </div>
      </div>

      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:8px;">
  <button class="btn btn-ghost btn-xs js-open-docs" data-cl="${cl._id}" ${disabled ? 'disabled' : ''}>
    📎 Docs (${(state.docsByChecklist[cl._id]||[]).length})
  </button>
</div>


      <div class="cl-actions">
        <button class="btn btn-success btn-xs js-complete" data-id="${cl._id}" ${disabled ? 'disabled' : ''}>
        ${cl.status === 'COMPLETADO' ? 'Descompletar' : 'Completar'}
        </button>
        <button class="btn btn-warning btn-xs js-validate" data-id="${cl._id}" ${disabled ? 'disabled' : ''}>Validar</button>
        <button class="btn btn-ghost btn-xs js-notes" data-id="${cl._id}">Notas</button>
        <button class="btn btn-ghost btn-xs js-edit" data-id="${cl._id}" ${disabled ? 'disabled' : ''}>Editar</button>
        <button class="btn btn-danger btn-xs js-del-cl" data-id="${cl._id}" ${disabled ? 'disabled' : ''}>Eliminar</button>
      </div>

      ${active ? '' : `
        <div class="lock">
          <span>🔒 Checklist bloqueado: valida los anteriores para continuar</span>
        </div>
      `}
    </div>
  `;
}


  function wireDynamicHandlers() {
  // Helper: ¿está activo este checklist según la secuencia?
  function isActiveById(clId) {
    const cl = state.checklists.find(c => c._id === clId);
    if (!cl) return false;
    return isChecklistActive(cl);
  }

  // Toggle de fase (accordion)
  document.querySelectorAll('.js-toggle-phase').forEach(btn => btn.onclick = (e) => {
    const key = btn.dataset.phase;
    if (state.collapsed.has(key)) state.collapsed.delete(key);
    else state.collapsed.add(key);
    renderProyecto();
  });

  // ===== NUEVO: click en tarjeta bloqueada → confirmar desbloqueo manual =====
  document.querySelectorAll('.cl-card.locked').forEach(card => {
    card.onclick = (ev) => {
      // Ignorar si se ha hecho click en controles interactivos de la tarjeta
      if (ev.target.closest('a,button,input,label,.js-toggle-phase,.js-add-cl')) return;

      const clId = card.dataset.id;
      // Si por alguna razón ya está activo, no hacemos nada
      if (isActiveById(clId)) return;

      const ok = confirm('Este checklist aún no está desbloqueado por secuencia.\n\n¿Quieres trabajar en este checklist igualmente?');
      if (!ok) return;

      // Marcar desbloqueo manual y re-renderizar
      state.manualUnlocks.add(clId);
      renderProyecto();
    };
  });

  // Añadir checklist
  document.querySelectorAll('.js-add-cl').forEach(btn => {
    btn.onclick = () => openCreateChecklist(btn.dataset.phase);
  });


  // Completar / Descompletar checklist (toggle)
  document.querySelectorAll('.js-complete').forEach(btn => {
   btn.onclick = async () => {
    const idCL = btn.dataset.id;

    if (!isActiveById(idCL)) {
      alert('Este checklist está bloqueado hasta validar los anteriores de la fase (o desbloquéalo manualmente tocando la tarjeta).');
      return;
    }

    const cl = state.checklists.find(c => c._id === idCL);
    const isDone = (cl?.status === 'COMPLETADO');

    if (isDone) {
      // ✅ DESCOMPLETAR
      try {
        // si algún día creas endpoint /uncomplete lo usas aquí
        await API.put(`/api/checklists/${idCL}`, { status: 'PENDIENTE' });
      } catch {
        await API.put(`/api/checklists/${idCL}`, { completed: false, status: 'PENDIENTE' });
      }
    } else {
      // ✅ COMPLETAR
      try {
        await API.post(`/api/checklists/${idCL}/complete`, { force: false });
      } catch {
        await API.put(`/api/checklists/${idCL}`, { status: 'COMPLETADO' });
      }
    }

    await reloadProyecto();
   };
  });


  // Validar checklist (solo si ACTIVO y rol permitido)
  document.querySelectorAll('.js-validate').forEach(btn => {
    btn.onclick = async () => {
      const idCL = btn.dataset.id;
      if (!isActiveById(idCL)) {
        alert('Este checklist está bloqueado hasta validar los anteriores de la fase (o desbloquéalo manualmente tocando la tarjeta).');
        return;
      }
      const canValidate = (myRole === 'admin' || myRole === 'bank' || myRole === 'gerencia');
      if (!canValidate) return alert('Solo Banco/Admin/Gerencia pueden validar.');
      await API.post(`/api/checklists/${idCL}/validate`, { validated: true })
        .catch(() => API.put(`/api/checklists/${idCL}`, { validated: true }));
      await reloadProyecto(); // desbloqueará el siguiente por la lógica nueva
    };
  });

  // Editar checklist (solo si ACTIVO)
  document.querySelectorAll('.js-edit').forEach(btn => {
    btn.onclick = () => {
      const idCL = btn.dataset.id;
      if (!isActiveById(idCL)) {
        alert('Checklist bloqueado: valida los anteriores o desbloquéalo manualmente tocando la tarjeta.');
        return;
      }
      openEditChecklist(idCL);
    };
  });

  // Eliminar checklist (solo si ACTIVO + PIN)
  document.querySelectorAll('.js-del-cl').forEach(btn => {
    btn.onclick = async () => {
      const idCL = btn.dataset.id;
      if (!isActiveById(idCL)) {
        alert('Checklist bloqueado: valida los anteriores o desbloquéalo manualmente tocando la tarjeta.');
        return;
      }
      if (!askPinOrAbort('Para eliminar este checklist, introduce el PIN:')) return;
      await API.del(`/api/checklists/${idCL}`).catch(() => API.post(`/api/checklists/${idCL}/delete`, {}));
      await reloadProyecto();
    };
  });

  // Notas (permitido aunque esté bloqueado)
  document.querySelectorAll('.js-notes').forEach(btn => {
    btn.onclick = () => openNotes(btn.dataset.id);
  });

  // Subtareas: toggle (solo si ACTIVO)
  document.querySelectorAll('.js-subtoggle').forEach(chk => {
    chk.onchange = async () => {
      const clId = chk.dataset.id, sid = chk.dataset.sid;
      if (!isActiveById(clId)) {
        chk.checked = !chk.checked; // revertir visualmente
        alert('Checklist bloqueado: valida los anteriores o desbloquéalo manualmente tocando la tarjeta.');
        return;
      }
      await API.put(`/api/checklists/${clId}/subtasks/${sid}`, { completed: chk.checked });
      await reloadProyecto(false);
    };
  });

  // Subtareas: añadir (solo si ACTIVO)
  document.querySelectorAll('.js-add-sub').forEach(btn => {
    btn.onclick = async () => {
      const clId = btn.dataset.id;
      if (!isActiveById(clId)) {
        alert('Checklist bloqueado: valida los anteriores o desbloquéalo manualmente tocando la tarjeta.');
        return;
      }
      const inp = document.querySelector(`input[data-newsub="${clId}"]`);
      const title = (inp?.value || '').trim();
      if (!title) return;
      await API.post(`/api/checklists/${clId}/subtasks`, { title });
      await reloadProyecto(false);
    };
  });
    // Botón de documentos por checklist (abre modal)
  document.querySelectorAll('.js-open-docs').forEach(btn => {
    btn.onclick = () => {
      const clId = btn.dataset.cl;
      openChecklistDocs(clId);
    };
  });

}

  async function reloadProyecto() {
    await loadProyectoData();
    renderProyecto();
  }

  // ====== Modales ======
  function openCreateChecklist(phaseKey) {
    const rolesOptions = Object.entries(ROLE_COLORS).map(([k,v]) => `<option value="${k}">${v.label}</option>`).join('');
    const phaseOptions = PHASES.map(p => `<option value="${p.key}" ${p.key===phaseKey?'selected':''}>${p.name}</option>`).join('');
    openModal('Nuevo checklist', `
      <div class="row w-100"><input id="clTitle" class="w-100" placeholder="Título del checklist"></div>
      <div class="row w-100">
        <label>Fase</label><select id="clPhase">${phaseOptions}</select>
        <label>Rol</label><select id="clRole">${rolesOptions}</select>
        <label>Orden</label><input id="clOrder" type="number" min="0" step="1" value="0" style="width:100px">
        <label>Vence</label><input id="clDue" type="date">
      </div>
    `, 'Crear', async () => {
      const payload = {
  projectId: id,
  title: document.getElementById('clTitle').value.trim() || 'Checklist',
  // Tu UI usa fases como claves: en el backend ya esperas `phase` en ese formato
  phase: document.getElementById('clPhase').value,
  // CAMBIO: roleOwner en vez de role
  roleOwner: uiRoleToOwner(document.getElementById('clRole').value),
  // CAMBIO: orderInLevel en vez de order
  orderInLevel: Number(document.getElementById('clOrder').value) || 0,
  // (opcional) Si quieres persistir el nivel desde la UI, añade level=1..n (no obligatorio)
  // level: PHASES.findIndex(p => p.key === document.getElementById('clPhase').value) + 1,
  dueDate: document.getElementById('clDue').value || null
};
await API.post('/api/checklists', payload);

      await API.post('/api/checklists', payload);
      modalBackdrop.style.display = 'none';
      await reloadProyecto();
    });
  }

  function openEditChecklist(clId) {
    const cl = state.checklists.find(x=>x._id===clId);
    if (!cl) return;
    const rolesOptions = Object.entries(ROLE_COLORS).map(([k,v]) => `<option value="${k}" ${k===cl.role?'selected':''}>${v.label}</option>`).join('');
    const phaseOptions = PHASES.map(p => `<option value="${p.key}" ${p.key===cl.phase?'selected':''}>${p.name}</option>`).join('');
    openModal('Editar checklist', `
      <div class="row w-100"><input id="eTitle" class="w-100" value="${cl.title}"></div>
      <div class="row w-100">
        <label>Fase</label><select id="ePhase">${phaseOptions}</select>
        <label>Rol</label><select id="eRole">${rolesOptions}</select>
        <label>Orden</label><input id="eOrder" type="number" min="0" step="1" value="${cl.order||0}" style="width:100px">
        <label>Vence</label><input id="eDue" type="date" value="${cl.dueDate ? fmtDate(cl.dueDate) : ''}">
      </div>
    `, 'Guardar', async () => {
      const payload = {
  title: document.getElementById('eTitle').value.trim() || cl.title,
  phase: document.getElementById('ePhase').value,
  // CAMBIO: roleOwner en vez de role
  roleOwner: uiRoleToOwner(document.getElementById('eRole').value),
  // CAMBIO: orderInLevel en vez de order
  orderInLevel: Number(document.getElementById('eOrder').value) || 0,
  dueDate: document.getElementById('eDue').value || null
};
await API.put(`/api/checklists/${clId}`, payload);

      await API.put(`/api/checklists/${clId}`, payload);
      modalBackdrop.style.display = 'none';
      await reloadProyecto();
    });
  }

  function openNotes(clId) {
    const cl = state.checklists.find(x=>x._id===clId);
    const existing = (cl?.notes || []).slice().reverse().map(n => `
      <div style="border:1px solid #eef2f7; border-radius:8px; padding:8px;">
        <div class="small muted">${fmtDate(n.date||n.createdAt)} — ${n.author||'—'}</div>
        <div>${(n.text||'').replace(/\n/g,'<br>')}</div>
      </div>
    `).join('') || '<div class="small muted">Sin notas</div>';

    openModal('Notas / observaciones', `
      <textarea id="noteText" rows="4" class="w-100" placeholder="Añadir nota interna..."></textarea>
      <div class="small muted">Historial</div>
      <div>${existing}</div>
    `, 'Guardar nota', async () => {
      const text = (document.getElementById('noteText').value || '').trim();
      if (!text) { modalBackdrop.style.display='none'; return; }
      await API.post(`/api/checklists/${clId}/notes`, { text });
      modalBackdrop.style.display='none';
      await reloadProyecto(false);
    });
  }

  async function openHistoryModal() {
    let html = '';
    try {
      const logs = await API.get(`/api/audit?projectId=${id}`);
      html = (logs||[]).slice(0,300).map(l => `
        <div style="border:1px solid #eef2f7; border-radius:8px; padding:8px;">
          <div class="small muted">${new Date(l.date||l.createdAt).toLocaleString()} — ${l.user||'—'}</div>
          <div><b>${l.action||l.type}</b> — ${l.entity||''} ${l.entityId||''}</div>
          <div class="small">${l.details ? JSON.stringify(l.details) : ''}</div>
        </div>
      `).join('') || '<div class="small muted">Sin actividad registrada</div>';
    } catch {
      html = '<div class="small muted">Historial no disponible</div>';
    }
    openModal('Historial de cambios', html, 'Cerrar', ()=> { modalBackdrop.style.display='none'; });
  }

  function openConfigureFlow() {
    const byPhase = PHASES.map(ph => {
      const items = state.checklists.filter(c=>c.phase===ph.key).sort((a,b)=>(a.order??0)-(b.order??0));
      return `
        <div class="phase" style="--phase-color:${ph.color}; --phase-pale:${ph.pale}; margin-bottom:8px;">
          <div class="phase-header"><div class="phase-title">${ph.name}</div></div>
          <ol style="margin-left:16px;">
            ${items.map(i=>`<li>${i.title} — <span class="small muted">Orden ${i.order??0}</span></li>`).join('') || '<div class="small muted">Sin checklists</div>'}
          </ol>
        </div>
      `;
    }).join('');
    openModal('Configuración del flujo', byPhase, 'Cerrar', ()=> { modalBackdrop.style.display='none'; });
  }

  // ==========================
// ====== FINANZAS v2 =======
// Plan por fases + Real por fases + Desembolso por fase
// ==========================
let FINANCE = null;
let FINANCE_KPIS = null;

const fmt = (n) => (Number(n || 0)).toLocaleString('es-ES');
const sumItems = (arr = []) => (arr || []).reduce((a, it) => a + (Number(it?.amount) || 0), 0);

function numOr0(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fillFinanceKpiInputsFromProject(project) {
  const a = document.getElementById('finLoanApproved');
  const d = document.getElementById('finLoanDisbursed');
  const b = document.getElementById('finBudgetApproved');
  if (!a || !d || !b) return;

  a.value = numOr0(project?.loanApproved);
  d.value = numOr0(project?.loanDisbursed);
  b.value = numOr0(project?.budgetApproved);
}

async function saveFinanceProjectKpis() {
  const payload = {
    loanApproved:   numOr0(document.getElementById('finLoanApproved')?.value),
    disbursed:      numOr0(document.getElementById('finLoanDisbursed')?.value),
    budgetApproved: numOr0(document.getElementById('finBudgetApproved')?.value),
  };

  try {
    await API.put(`/api/projects/${id}/finance/kpis`, payload);
    await loadFinance();
    alert('KPIs actualizados');
  } catch (e) {
    console.error(e);
    alert('No se pudieron guardar los KPIs');
  }
}


function renderFinanceAlerts(alerts) {
  const box = document.getElementById('financeAlerts');
  if (!box) return;
  box.innerHTML = '';
  (alerts || []).forEach(a => {
    const div = document.createElement('div');
    div.className = 'alert warn';
    div.textContent = a.message;
    box.appendChild(div);
  });
}

// -------------------------
// Estado por fase (banca-friendly)
// -------------------------
function getPhaseStatus(ph, { deviationPct = 0.10 } = {}) {
  const planUses = sumItems(ph?.planUses);
  const realUses = sumItems(ph?.uses);

  const planSources = sumItems(ph?.planSources);
  const realSources = sumItems(ph?.sources);

  const disbExpected = Number(ph?.disbExpected || 0);
  const disbActual = Number(ph?.disbActual || 0);
  const disbRequested = !!ph?.disbRequested;

  // 1) Requiere desembolso
  if (disbRequested && disbExpected > 0 && disbActual + 1e-9 < disbExpected) {
    return { key: 'NEEDS_DISB', label: 'Se requiere desembolso', tone: 'warn' };
  }

  // 2) Desviación (plan vs real) — simple y entendible
  // Si no hay plan (0), no marcamos desviación por % (para no dar falsos rojos)
  if (planUses > 0) {
    const pct = Math.abs(realUses - planUses) / planUses;
    if (pct > deviationPct) return { key: 'DEVIATION', label: 'Desviación', tone: 'error' };
  }

  // 3) Control básico de consistencia (usos > fuentes) — típico de banca
  if (realUses > realSources + 1e-9) {
    return { key: 'DEVIATION', label: 'Desviación', tone: 'error' };
  }

  return { key: 'OK', label: 'OK', tone: 'ok' };
}

// -------------------------
// Load principal
// -------------------------
async function loadFinance() {
  try {
    const res = await API.get(`/api/projects/${id}/finance`);
    FINANCE = res.finance;
    FINANCE_KPIS = res.kpis;
    window.FINANCE_KPIS = FINANCE_KPIS;

    // ✅ Guardamos FINANCE en window para el modal "Iniciar REAL" (dropdown de fases)
    window.FINANCE = FINANCE;

    // ================================
    // ✅ Bind botones PLAN / REAL (solo 1 vez)
    // ================================
    const planBtn = document.getElementById('addPhasePlanBtn');
    if (planBtn && !planBtn.dataset.bound) {
      planBtn.addEventListener('click', () => {
        openPhaseEditor(null, 'plan');
      });
      planBtn.dataset.bound = '1';
    }

    const realBtn = document.getElementById('addPhaseRealBtn');
    if (realBtn && !realBtn.dataset.bound) {
      realBtn.addEventListener('click', () => {
        openPhaseEditor(null, 'real');
      });
      realBtn.dataset.bound = '1';
    }

    // (Legacy) si aún existe el botón antiguo, lo desactivamos para evitar confusión
    const legacyBtn = document.getElementById('addPhaseBtn');
    if (legacyBtn && !legacyBtn.dataset.bound) {
      legacyBtn.addEventListener('click', () => {
        // Por defecto, crear fase debe ser PLAN
        openPhaseEditor(null, 'plan');
      });
      legacyBtn.dataset.bound = '1';
    }

    // KPIs del proyecto (cabecera)
    if (res.project) fillFinanceKpiInputsFromProject(res.project);
    else {
      try {
        const pr = await API.get(`/api/projects/${id}`);
        fillFinanceKpiInputsFromProject(pr);
      } catch(_) {}
    }

    // KPIs tiles
    document.getElementById('kpiExec').textContent      = `${((FINANCE_KPIS?.percentExecution || 0) * 100).toFixed(1)}%`;
    document.getElementById('kpiIntereses').textContent = fmt(FINANCE_KPIS?.totalIntereses || 0);
    document.getElementById('kpiPreventas').textContent = fmt(FINANCE_KPIS?.totalPreventas || 0);

    // Alertas (por fechas de fin, como ya tienes)
    renderFinanceAlerts(res.alerts || []);

    // Fases: cards
    renderPhases(FINANCE?.phases || []);

    // Chart: Plan vs Real por fase (dos barras)
    renderPhaseChart(FINANCE?.phases || []);

    // Resumen acumulado final
    renderAccumSummary(FINANCE?.phases || []);

    // (Opcional) si mantienes tu tabla de real acumulado antigua:
    renderRealAccumFromPhases(FINANCE?.phases || []);

    // Bind UI una vez
    bindFinanceOnce();
  } catch (e) {
    console.error('loadFinance error', e);
  }
}

function bindFinanceOnce() {
  if (bindFinanceOnce.bound) return;
  bindFinanceOnce.bound = true;

  document.getElementById('addPhaseBtn')?.addEventListener('click', () => openPhaseEditor(null));
  document.getElementById('saveFinanceKpisBtn')?.addEventListener('click', saveFinanceProjectKpis);

  document.getElementById('exportXlsx')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await downloadFinanceExport('xlsx');
  });

  document.getElementById('exportPdf')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await downloadFinanceExport('pdf');
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function downloadFinanceExport(format) {
  try {
    const token =
      localStorage.getItem('token') ||
      localStorage.getItem('authToken') ||
      sessionStorage.getItem('token');

    if (!token) return alert('No hay token. Vuelve a iniciar sesión.');

    let url = `/api/projects/${id}/finance/export?format=${format}`;
    let method = 'GET';
    let body = null;
    const headers = { Authorization: `Bearer ${token}` };

    if (format === 'pdf') {
      // Espera un poco por si Chart.js está terminando de renderizar
      await sleep(60);

      const el = document.getElementById('phaseChart');
      if (!el) return alert('No existe #phaseChart en el DOM.');

      // ✅ MEJOR: sacar imagen desde Chart.js (si existe)
      let chart = el._chart?.toBase64Image?.();

      // fallback
      if (!chart && el.toDataURL) chart = el.toDataURL('image/png', 1.0);

      if (!chart || !chart.startsWith('data:image/')) {
        console.warn('chart base64 inválido:', chart?.slice?.(0, 40));
        return alert('El gráfico no está listo / está vacío. Prueba otra vez.');
      }

      method = 'POST';
      url = `/api/projects/${id}/finance/export`;
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({ format: 'pdf', chart });
    }

    const resp = await fetch(url, { method, headers, body });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      console.error('Export error:', resp.status, txt);
      return alert(`No se pudo exportar (${resp.status}). Mira consola.`);
    }

    const blob = await resp.blob();
    const ext = format === 'xlsx' ? 'xlsx' : 'pdf';

    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `finanzas_${id}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);

  } catch (e) {
    console.error(e);
    alert('Error exportando');
  }
}
// -------------------------
// Render: resumen acumulado final
// -------------------------
function renderAccumSummary(phases) {
  const planUses = (phases || []).reduce((a, ph) => a + sumItems(ph.planUses), 0);
  const planSources = (phases || []).reduce((a, ph) => a + sumItems(ph.planSources), 0);
  const realUses = (phases || []).reduce((a, ph) => a + sumItems(ph.uses), 0);
  const realSources = (phases || []).reduce((a, ph) => a + sumItems(ph.sources), 0);

  // si tienes esos IDs en HTML:
  const elPU = document.getElementById('accPlanUses');
  const elPS = document.getElementById('accPlanSources');
  const elRU = document.getElementById('accRealUses');
  const elRS = document.getElementById('accRealSources');
  if (elPU) elPU.textContent = fmt(planUses);
  if (elPS) elPS.textContent = fmt(planSources);
  if (elRU) elRU.textContent = fmt(realUses);
  if (elRS) elRS.textContent = fmt(realSources);
}

function renderRealAccumFromPhases(phases) {
  const usesBody = document.querySelector('#realUsesTable tbody');
  const srcsBody = document.querySelector('#realSourcesTable tbody');
  if (!usesBody || !srcsBody) return;

  const realUses = (phases || []).reduce((a, ph) => a + sumItems(ph.uses), 0);
  const realSources = (phases || []).reduce((a, ph) => a + sumItems(ph.sources), 0);

  usesBody.innerHTML = `<tr><td>Total</td><td class="right">${fmt(realUses)}</td></tr>`;
  srcsBody.innerHTML = `<tr><td>Total</td><td class="right">${fmt(realSources)}</td></tr>`;

  const elUsesTotal = document.getElementById('realUsesTotal');
  if (elUsesTotal) elUsesTotal.textContent = fmt(realUses);

  const elSourcesTotal = document.getElementById('realSourcesTotal');
  if (elSourcesTotal) elSourcesTotal.textContent = fmt(realSources);
}

// -------------------------
// Render: gráfica por fases (dos barras plan vs real)
// ✅ FIX: ahora acepta canvasId para reusarla en RESUMEN sin romper FINANZAS
// -------------------------
function renderPhaseChart(phases, canvasId = 'phaseChart') {
  const el = document.getElementById(canvasId);
  if (!el) return;

  // si guardas chart en el canvas (como haces en export)
  if (el._chart && typeof el._chart.destroy === 'function') el._chart.destroy();

  const labels = (phases || []).map(p => p.name || p.title || p.phase || 'Fase');

  const plan = (phases || []).map(p => {
    const planUses = (p.planUses || []).reduce((a,it)=> a + (Number(it.amount)||0), 0);
    return planUses;
  });

  const real = (phases || []).map(p => {
    const uses = (p.uses || []).reduce((a,it)=> a + (Number(it.amount)||0), 0);
    return uses;
  });

  const chart = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Plan (fase)', data: plan },
        { label: 'Real (fase)', data: real },
      ]
    },
    options: { responsive: true, scales: { y: { beginAtZero: true } } }
  });

  // ✅ importante para export y para poder destruir
  el._chart = chart;
}

// -------------------------
// Render: fases (cards) con PLAN vs REAL + desembolso
// -------------------------
function renderPhases(phases = []) {
  const wrapPlan = document.getElementById('phasesPlanList');
  const wrapReal = document.getElementById('phasesRealList');

  // Fallback compat: si no existen los nuevos contenedores, usa el antiguo
  const wrapLegacy = document.getElementById('phasesList');

  if (!wrapPlan || !wrapReal) {
    // Si aún no has pegado el HTML nuevo, no rompas nada:
    if (!wrapLegacy) return;
    wrapLegacy.innerHTML = '<div class="small muted">⚠️ Faltan contenedores #phasesPlanList y #phasesRealList en el HTML.</div>';
    return;
  }

  wrapPlan.innerHTML = '';
  wrapReal.innerHTML = '';

  const dateFmt = (d) => {
    if (!d) return '—';
    const dt = (d instanceof Date) ? d : new Date(d);
    return isNaN(dt.getTime()) ? '—' : dt.toISOString().slice(0,10);
  };

  const makeCardShell = ({ variant, ph, titleRight = '' }) => {
    const card = document.createElement('div');
    card.className = 'card fin-phase-card';
    card.dataset.variant = variant; // plan | real

    const st = getPhaseStatus(ph);

    // Badge: para REAL, si está solicitado, lo marcamos claro
    const disbReq = !!ph?.disbRequested;
    const disbBadge = disbReq
      ? `<span class="fin-tag danger">Desembolso solicitado</span>`
      : '';

    // Tono status solo lo muestro en REAL (para no ensuciar PLAN)
    const statusBadge = (variant === 'real')
      ? `<span class="fin-tag ${st.tone}">${st.label}</span>`
      : `<span class="fin-tag neutral">Estimación</span>`;

    card.innerHTML = `
      <div class="fin-phase-head">
        <div class="fin-phase-left">
          <div class="fin-phase-name">${ph?.name || 'Fase'}</div>
          <div class="fin-phase-dates">${dateFmt(ph?.startDate)} → ${dateFmt(ph?.endDate)}</div>
          <div class="fin-phase-badges">
            ${statusBadge}
            ${variant === 'real' ? disbBadge : ''}
          </div>
        </div>

        <div class="fin-phase-actions">
  <button class="fin-btn fin-btn-edit" data-act="edit">
    ${variant === 'plan' ? 'Editar plan' : 'Editar real'}
  </button>
  <button class="fin-btn fin-btn-del" data-act="del">
    Eliminar
  </button>
</div>
      </div>

      <div class="fin-phase-body">
        ${titleRight}
      </div>
    `;
    return card;
  };

  (phases || []).forEach(ph => {
    const planUsesTotal = sumItems(ph?.planUses);
    const planSrcsTotal = sumItems(ph?.planSources);
    const realUsesTotal = sumItems(ph?.uses);
    const realSrcsTotal = sumItems(ph?.sources);

    const disbExpected = Number(ph?.disbExpected || 0);
    const disbActual   = Number(ph?.disbActual || 0);

    // -------------------------
    // CARD PLAN (estimación)
    // -------------------------
    const planBody = `
      <div class="fin-kpi-grid">
        <div class="fin-kpi">
          <div class="label">Usos plan</div>
          <div class="value">${fmt(planUsesTotal)}</div>
        </div>
        <div class="fin-kpi">
          <div class="label">Fuentes plan</div>
          <div class="value">${fmt(planSrcsTotal)}</div>
        </div>
      </div>
      <div class="small muted" style="margin-top:8px;">
        Edita el plan de esta fase (usos/fuentes estimados).
      </div>
    `;

    const planCard = makeCardShell({ variant: 'plan', ph, titleRight: planBody });

    // Actions PLAN
    planCard.querySelector('[data-act="edit"]')?.addEventListener('click', () => openPhaseEditor(ph, 'plan'));

    planCard.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
      if (!ph?._id) return alert('Fase inválida');
      if (!confirm('¿Eliminar fase?')) return;
      try {
        await API.del(`/api/projects/${id}/finance/phases/${ph._id}`);
        await loadFinance();
      } catch (e) {
        console.error(e);
        alert('No se pudo eliminar la fase');
      }
    });

    wrapPlan.appendChild(planCard);

    // ✅ NO mostrar REAL si está vacío y aún no ha empezado
const today = new Date();
const startedByDate = ph?.startDate ? (new Date(ph.startDate) <= today) : false;
const hasRealData =
  (realUsesTotal > 0) ||
  (realSrcsTotal > 0) ||
  (disbExpected > 0) ||
  (disbActual > 0) ||
  !!ph?.disbRequested;

if (!hasRealData && !startedByDate) {
  // Solo mostramos PLAN, pero NO mostramos esta fase en la lista REAL
  return;
}

    // -------------------------
    // CARD REAL (ejecución)
    // -------------------------
    const realBody = `
      <div class="fin-kpi-grid">
        <div class="fin-kpi">
          <div class="label">Usos real</div>
          <div class="value">${fmt(realUsesTotal)}</div>
        </div>
        <div class="fin-kpi">
          <div class="label">Fuentes real</div>
          <div class="value">${fmt(realSrcsTotal)}</div>
        </div>
      </div>

      <div class="fin-line" style="margin-top:10px;">
        <div class="label">Desembolso (banco)</div>
        <div class="row between" style="align-items:center;">
          <div class="small">
            Esperado: <b>${fmt(disbExpected)}</b> · Real: <b>${fmt(disbActual)}</b>
          </div>
          <div class="row gap">
            <button class="btn btn-warning btn-xs" data-act="request">Solicitar</button>
            <button class="btn btn-ghost btn-xs" data-act="clearRequest">Resuelto</button>
          </div>
        </div>
      </div>
    `;

    const realCard = makeCardShell({ variant: 'real', ph, titleRight: realBody });

    // Actions REAL
    realCard.querySelector('[data-act="edit"]')?.addEventListener('click', () => openPhaseEditor(ph, 'real'));

    realCard.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
      if (!ph?._id) return alert('Fase inválida');
      if (!confirm('¿Eliminar fase?')) return;
      try {
        await API.del(`/api/projects/${id}/finance/phases/${ph._id}`);
        await loadFinance();
      } catch (e) {
        console.error(e);
        alert('No se pudo eliminar la fase');
      }
    });

    realCard.querySelector('[data-act="request"]')?.addEventListener('click', async () => {
      // Pedimos el monto esperado (si está a 0) o confirmamos solicitud
      const current = Number(ph?.disbExpected || 0);
      let expected = current;

      if (!expected) {
        const suggested = Math.max(0, planUsesTotal);
        const inp = prompt('Monto de desembolso esperado (banco) para esta fase:', String(suggested || 0));
        if (inp == null) return;
        expected = Number(String(inp).replace(/[, ]/g, '')) || 0;
      }

      try {
        await API.put(`/api/projects/${id}/finance/phases/${ph._id}`, {
          disbExpected: expected,
          disbRequested: true,
          disbRequestedAt: new Date().toISOString()
        });
        await loadFinance();
      } catch (e) {
        console.error(e);
        alert('No se pudo solicitar el desembolso');
      }
    });

    realCard.querySelector('[data-act="clearRequest"]')?.addEventListener('click', async () => {
      try {
        await API.put(`/api/projects/${id}/finance/phases/${ph._id}`, {
          disbRequested: false,
          disbRequestedAt: null
        });
        await loadFinance();
      } catch (e) {
        console.error(e);
        alert('No se pudo actualizar el estado del desembolso');
      }
    });

    wrapReal.appendChild(realCard);
  });

  // Mantén el legacy oculto vacío (por si tu CSS/JS lo toca)
  if (wrapLegacy) wrapLegacy.innerHTML = '';
}


// -------------------------
// Modal: crear/editar fase con 4 tablas:
// PLAN usos/fuentes + REAL usos/fuentes + desembolso esperado/real
// (SIMPLIFICADO: quitamos Intereses/Aportes/Preventas para evitar duplicidad)
function openPhaseEditor(ph = null, focus = 'plan') {
  const isEdit = !!ph;

  // Necesario para "Iniciar REAL" sin crear fase nueva:
  const allPhases = (window.FINANCE?.phases || []);

  const tbl = (tableId, rows) => `
    <table class="table" id="${tableId}">
      <thead><tr><th>Partida</th><th class="right">Monto</th><th></th></tr></thead>
      <tbody>
        ${(rows || []).map(r => `
          <tr>
            <td><input class="input" type="text" value="${(r.name||'').replace(/"/g,'&quot;')}" placeholder="Partida"/></td>
            <td class="right"><input class="input amount" type="number" value="${Number(r.amount||0)}"/></td>
            <td class="right"><button class="btn btn-ghost btn-xs js-del-row">✕</button></td>
          </tr>
        `).join('')}
      </tbody>
      <tfoot><tr><td>Total</td><td class="right" id="${tableId}-total">0</td><td></td></tr></tfoot>
    </table>
    <button class="btn btn-ghost btn-xs js-add-row" data-target="${tableId}">+ Añadir</button>
  `;

  // Datos base
  const phaseData = {
    name: ph?.name || '',
    startDate: ph ? new Date(ph.startDate).toISOString().slice(0,10) : '',
    endDate:   ph ? new Date(ph.endDate).toISOString().slice(0,10)   : '',

    planUses: Array.isArray(ph?.planUses) ? ph.planUses.slice() : [],
    planSources: Array.isArray(ph?.planSources) ? ph.planSources.slice() : [],

    uses: Array.isArray(ph?.uses) ? ph.uses.slice() : [],
    sources: Array.isArray(ph?.sources) ? ph.sources.slice() : [],

    alertDaysBefore: Number.isFinite(ph?.alertDaysBefore) ? ph.alertDaysBefore : 15,

    disbExpected: Number(ph?.disbExpected || 0),
    disbActual:   Number(ph?.disbActual || 0),
    disbRequested: !!ph?.disbRequested,
    disbRequestedAt: ph?.disbRequestedAt || null,
  };

  // Título y botón
  const title =
    focus === 'plan'
      ? (isEdit ? 'Editar fase (PLAN)' : 'Nueva fase (PLAN)')
      : (isEdit ? 'Editar fase (REAL)' : 'Iniciar fase (REAL)');

  const cta =
    isEdit ? 'Guardar' : (focus === 'plan' ? 'Crear' : 'Guardar');

  // =========================
  // HTML del modal (SEPARADO)
  // =========================
  const htmlPlan = `
    <div class="grid-2">
      <div>
        <label>Nombre</label>
        <input id="ph-name" class="input" value="${phaseData.name}" placeholder="Fase 1"/>
      </div>
      <div></div>
      <div>
        <label>Inicio</label>
        <input id="ph-start" type="date" class="input" value="${phaseData.startDate}"/>
      </div>
      <div>
        <label>Fin</label>
        <input id="ph-end" type="date" class="input" value="${phaseData.endDate}"/>
      </div>
    </div>

    <div style="margin-top:10px;">
      <label>Alertar X días antes del fin</label>
      <input id="ph-alert" type="number" class="input" value="${phaseData.alertDaysBefore}" min="0"/>
    </div>

    <h4 style="margin-top:14px;">PLAN (estimación) — Usos</h4>
    ${tbl('ph-plan-uses', phaseData.planUses)}

    <h4 style="margin-top:12px;">PLAN (estimación) — Fuentes</h4>
    ${tbl('ph-plan-sources', phaseData.planSources)}
  `;

  const htmlReal = `
    ${(!isEdit) ? `
      <div style="margin-bottom:10px;">
        <label>Selecciona una fase del PLAN</label>
        <select id="ph-pick-existing" class="input">
          ${allPhases.map(p => `
            <option value="${p._id}">
              ${p?.name || 'Fase'} (${(p?.startDate||'').slice(0,10)} → ${(p?.endDate||'').slice(0,10)})
            </option>
          `).join('')}
        </select>
        <div class="small muted" style="margin-top:6px;">
          Esto registra ejecución REAL para una fase ya estimada.
        </div>
      </div>
    ` : ''}

    <div style="margin-top:10px;">
      <label>Alertar X días antes del fin</label>
      <input id="ph-alert" type="number" class="input" value="${phaseData.alertDaysBefore}" min="0"/>
    </div>

    <h4 style="margin-top:14px;">REAL (ejecución) — Usos</h4>
    ${tbl('ph-real-uses', phaseData.uses)}

    <h4 style="margin-top:12px;">REAL (ejecución) — Fuentes</h4>
    ${tbl('ph-real-sources', phaseData.sources)}
  `;

  openModal(title, (focus === 'plan') ? htmlPlan : htmlReal, cta, async () => {
    const collect = (tableId) => {
      const tbody = document.querySelector(`#${tableId} tbody`);
      const rows = [];
      tbody?.querySelectorAll('tr')?.forEach(tr => {
        const name = tr.querySelector('input[type="text"]')?.value?.trim();
        const amt  = Number(tr.querySelector('input.amount')?.value || 0);
        if (name) rows.push({ name, amount: amt });
      });
      return rows;
    };

    // =========================
    // GUARDADO — SEPARADO
    // =========================
    try {
      if (focus === 'plan') {
        // Crear/editar PLAN
        const payload = {
          name: document.getElementById('ph-name').value.trim() || 'Fase',
          startDate: document.getElementById('ph-start').value,
          endDate:   document.getElementById('ph-end').value,
          alertDaysBefore: Number(document.getElementById('ph-alert').value || 15),
          planUses: collect('ph-plan-uses'),
          planSources: collect('ph-plan-sources'),
        };

        if (!payload.startDate || !payload.endDate) {
          alert('Inicio y fin son obligatorios');
          return;
        }

        if (isEdit) {
          // solo toca PLAN, no toca REAL
          await API.put(`/api/projects/${id}/finance/phases/${ph._id}`, payload);
        } else {
          await API.post(`/api/projects/${id}/finance/phases`, payload);
        }
      }

      if (focus === 'real') {
        // Editar REAL / iniciar REAL
        const targetId = isEdit
          ? ph._id
          : (document.getElementById('ph-pick-existing')?.value);

        if (!targetId) {
          alert('Selecciona una fase del PLAN');
          return;
        }

        const payload = {
  alertDaysBefore: Number(document.getElementById('ph-alert').value || 15),
  uses: collect('ph-real-uses'),
  sources: collect('ph-real-sources'),
  // ✅ No tocamos desembolsos aquí (se gestionan desde la tarjeta con "Solicitar/Resuelto")
};

        // solo toca REAL, no toca PLAN
        await API.put(`/api/projects/${id}/finance/phases/${targetId}`, payload);
      }

      modalBackdrop.style.display = 'none';
      await loadFinance();
    } catch (e) {
      console.error(e);
      alert('No se pudo guardar la fase');
    }
  });

  // =========================
  // Totales y tablas (solo las que existan)
  // =========================
  const recalcTotal = (tableId) => {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;
    const total = [...tbody.querySelectorAll('input.amount')].reduce((a, inp) => a + Number(inp.value || 0), 0);
    const cell = document.getElementById(`${tableId}-total`);
    if (cell) cell.textContent = total.toLocaleString('es-ES');
  };

  const hookTable = (tableId) => {
    const box = modalBody;

    box.addEventListener('click', (ev) => {
      const btnAdd = ev.target.closest('.js-add-row');
      const btnDel = ev.target.closest('.js-del-row');

      if (btnAdd && btnAdd.dataset.target === tableId) {
        const tbody = document.querySelector(`#${tableId} tbody`);
        if (!tbody) return;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><input class="input" type="text" placeholder="Partida"/></td>
          <td class="right"><input class="input amount" type="number" value="0"/></td>
          <td class="right"><button class="btn btn-ghost btn-xs js-del-row">✕</button></td>
        `;
        tbody.appendChild(tr);
        recalcTotal(tableId);
      }

      if (btnDel && btnDel.closest(`#${tableId}`)) {
        btnDel.closest('tr')?.remove();
        recalcTotal(tableId);
      }
    });

    box.addEventListener('input', (ev) => {
      if (ev.target.closest(`#${tableId}`)) recalcTotal(tableId);
    });

    recalcTotal(tableId);
  };

  // Solo engancha las que existan en el modal actual
  hookTable('ph-plan-uses');
  hookTable('ph-plan-sources');
  hookTable('ph-real-uses');
  hookTable('ph-real-sources');
}


// ====== Comercial ======
(function initComercial() {
    // ===== Export helpers (Comercial) =====
  function buildAuthTenantHeaders() {
    let token = '';
    if (window.API && typeof API.getToken === 'function') {
      token = API.getToken() || '';
    } else {
      token =
        localStorage.getItem('token') ||
        localStorage.getItem('jwt') ||
        localStorage.getItem('accessToken') ||
        '';
    }

    const tenantKey =
      localStorage.getItem('tenantKey') ||
      localStorage.getItem('tenant') ||
      '';

    const headers = {};
    if (token) headers['Authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    if (tenantKey) headers['x-tenant-key'] = tenantKey;
    return headers;
  }

  async function downloadFile(url, filename) {
    const headers = buildAuthTenantHeaders();

    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Export falló (${res.status}): ${txt || 'sin detalle'}`);
    }

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
  }

  const tab = document.getElementById('tab-comercial');
  if (!tab) return;

  // DOM
  const grid = document.getElementById('unitsGrid');
  const kpisDiv = document.getElementById('kpisComercial');
  const filtroEstado = document.getElementById('filtroEstado');
  const buscarInput = document.getElementById('buscarUnidad');
  const btnCrear = document.getElementById('btnCrearLote');
  const btnExportarCsv = document.getElementById('btnExportarCsv');
  const btnExportarExcel = document.getElementById('btnExportarExcel');
  const btnBatch = document.getElementById('btnEditarSel');
  const btnDel = document.getElementById('btnEliminarSel');
  const btnSelectAll = document.getElementById('btnSelectAll');

  // Modales
  const modalCrear = document.getElementById('modalCrearLote');
  const modalCrearCerrar = document.getElementById('modalCrearCerrar');
  const btnCrearSubmit = document.getElementById('cl-crear');

  const modalFicha = document.getElementById('fichaUnidadModal');
  const fichaCerrar = document.getElementById('fichaCerrar');
  const fichaGuardar = document.getElementById('fichaGuardar');

  const modalBatch = document.getElementById('modalBatch');
  const batchCerrar = document.getElementById('batchCerrar');
  const batchAplicar = document.getElementById('batchAplicar');

  const modalDel = document.getElementById('modalDel');
  const delCerrar = document.getElementById('delCerrar');
  const delAplicar = document.getElementById('delAplicar');

  // Helpers API
  function mergedHeaders() {
  // Siempre enviamos token + tenant + content-type
  return { 'Content-Type': 'application/json', ...authHeaders(), ...tenantHeaders() };
}

async function parseJson(res) {
  if (res.status === 204) return {};
  const text = await res.text().catch(() => '');
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

async function apiGet(url) {
  if (API?.get) return API.get(url);
  const res = await fetch(url, { method: 'GET', headers: mergedHeaders() });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return parseJson(res);
}

async function apiPost(url, body) {
  if (API?.post) return API.post(url, body);
  const res = await fetch(url, { method: 'POST', headers: mergedHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return parseJson(res);
}

async function apiPatch(url, body) {
  if (API?.patch) return API.patch(url, body);
  const res = await fetch(url, { method: 'PATCH', headers: mergedHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return parseJson(res);
}

async function apiDelete(url, body) {
  if (API?.delete) return API.delete(url, body);
  const res = await fetch(url, { method: 'DELETE', headers: mergedHeaders(), body: JSON.stringify(body || {}) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return parseJson(res);
}

// === Helper para subir FormData (NO poner Content-Type manual) ===
async function apiUpload(url, formData) {
  // Si tu wrapper global lo soporta
  if (API?.upload) return API.upload(url, formData);

  // Encabezados de auth/tenant, SIN Content-Type
  const headers = { ...authHeaders(), ...tenantHeaders() };
  delete headers['Content-Type'];

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: formData
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  try {
    return await res.json();
  } catch {
    return {};
  }
}

// ===== Helpers UI para ficha comercial (pares label/control) =====
const seccion = (title, html, cls='form-grid-4') => `
  <div class="section">
    <h4><span>${title}</span><button type="button" class="toggle" aria-label="Mostrar/ocultar">▾</button></h4>
    <div class="body ${cls}">${html}</div>
  </div>
`;

// 🔒 Sanea cualquier valor antes de pintarlo en un <input>
function safeVal(x) {
  if (x == null) return '';
  if (typeof x === 'function') return '';     // <- evita "function Object() { [native code] }"
  return String(x);
}

// Cada helper devuelve DOS celdas de grid: <div class="label"> + <input>
const input = (id, label, value='', type='text') =>
  `<div class="label">${label}</div><input id="${id}" type="${type}" value="${safeVal(value)}">`;

const inputDate = (id, label, iso) =>
  `<div class="label">${label}</div><input id="${id}" type="date" value="${iso?String(iso).slice(0,10):''}">`;

const inputNum = (id, label, value=0) =>
  `<div class="label">${label}</div><input id="${id}" type="number" value="${Number(value)||0}">`;

const inputChk = (id, label, on=false) =>
  `<div class="label">${label}</div><input id="${id}" class="chk-box" type="checkbox" ${on?'checked':''}>`;

const selectRow = (id, label, optionsHtml='') =>
  `<div class="label">${label}</div>
   <select id="${id}">
     ${optionsHtml}
   </select>`;

// Lectores seguros para guardar
function vVal(id){ const el = document.getElementById(id); return el ? el.value : null; }
function vNum(id){ const v = Number(vVal(id)); return Number.isFinite(v) ? v : null; }
function vDate(id){ const s = vVal(id); return s ? new Date(s).toISOString() : null; }
function vChk(id){ const el = document.getElementById(id); return !!(el && el.checked); }

// ==============================
// Status en Banco (select + OTRO)
// ==============================
const STATUS_BANCO = [
  { v: 'PROFORMA',              l: 'PROFORMA (Proforma entregada)' },
  { v: 'EXPEDIENTE_ENTREGADO',  l: 'EXPEDIENTE ENTREGADO' },
  { v: 'EN_REVISION',           l: 'EN REVISIÓN' },
  { v: 'SUBSANAR',              l: 'SUBSANAR / DEVUELTO' },
  { v: 'APROBADO_CPP',          l: 'APROBADO CPP' },
  { v: 'RECHAZADO',             l: 'RECHAZADO' },
  { v: 'DESEMBOLSO',            l: 'DESEMBOLSO' },
  { v: 'ESCRITURADO',           l: 'ESCRITURADO' },
  { v: 'OTRO',                  l: 'OTRO' },
];

function normalizeStatusBanco(raw) {
  const s = String(raw || '').trim();
  if (!s) return { code: '', other: '' };

  const u = s.toUpperCase().replace(/\s+/g, '_');

  if (u.includes('PROFORMA')) return { code: 'PROFORMA', other: '' };
  if (u.includes('EXPEDIENTE')) return { code: 'EXPEDIENTE_ENTREGADO', other: '' };
  if (u.includes('REVISION')) return { code: 'EN_REVISION', other: '' };
  if (u.includes('SUBSAN') || u.includes('DEVUEL')) return { code: 'SUBSANAR', other: '' };
  if (u.includes('APROB')) return { code: 'APROBADO_CPP', other: '' }; // APROBADA CCP / APROBADA CPP / etc.
  if (u.includes('RECHAZ')) return { code: 'RECHAZADO', other: '' };
  if (u.includes('DESEMBOL')) return { code: 'DESEMBOLSO', other: '' };
  if (u.includes('ESCRIT')) return { code: 'ESCRITURADO', other: '' };

  // Si no encaja, lo conservamos como OTRO
  return { code: 'OTRO', other: s };
}

function fillStatusBancoSelect(selectEl, { includeEmpty = false } = {}) {
  if (!selectEl) return;
  selectEl.innerHTML = '';

  if (includeEmpty) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(no cambiar)';
    selectEl.appendChild(opt);
  }

  for (const o of STATUS_BANCO) {
    const opt = document.createElement('option');
    opt.value = o.v;
    opt.textContent = o.l;
    selectEl.appendChild(opt);
  }
}

function initStatusBancoUI(selId, otherLblId, otherId, currentValue, { includeEmpty = false } = {}) {
  const sel   = document.getElementById(selId);
  const lbl   = document.getElementById(otherLblId);
  const other = document.getElementById(otherId);

  if (!sel) return; // si no existe, no hacemos nada

  fillStatusBancoSelect(sel, { includeEmpty });

  const norm = normalizeStatusBanco(currentValue);
  sel.value = norm.code || (includeEmpty ? '' : 'OTRO');

  const refresh = () => {
    const isOther = (sel.value === 'OTRO');
    if (lbl)   lbl.style.display = isOther ? 'block' : 'none';
    if (other) {
      other.style.display = isOther ? 'block' : 'none';
      other.value = isOther ? (norm.other || (other.value || '')) : '';
    }
  };

  sel.onchange = () => {
    if (sel.value !== 'OTRO' && other) other.value = '';
    refresh();
  };

  refresh();
}


function getStatusBancoValue(selId, otherId) {
  const sel = document.getElementById(selId);
  const other = document.getElementById(otherId);
  const v = (sel?.value || '').trim();
  if (!v) return '';               // para batch "(no cambiar)" o vacío
  if (v !== 'OTRO') return v;
  return (other?.value || '').trim();
}

// Acordeón simple
function installSectionToggles() {
  document.querySelectorAll('#fichaContenido .section h4 .toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const sec = btn.closest('.section');
      const collapsed = sec.classList.toggle('collapsed');
      btn.textContent = collapsed ? '▸' : '▾';
    });
  });
}

// === Catálogo de pasos RBS (resume y completa según tu DOC) ===
const RBS_STEPS = [
  // Ventas
  { code:'V-01', title:'Recopilación de documentación de cliente', help:'Recepción, requisitos, APC, copias, Ficha FV-01, etc.' },
  { code:'V-02', title:'Separación y reserva de lote', help:'Declaración FV-02, pago de reserva, depósitos, control de depósitos.' },
  { code:'V-03', title:'Creación de expediente de cliente', help:'Armar expediente físico y digital según checklist.' },
  { code:'V-04', title:'Elaboración y entrega de proforma', help:'Solicitud FV-03, DV-01, envío y control.' },
  { code:'V-05', title:'Seguimiento aprobación de hipoteca', help:'Comunicación con oficial, comités, reporte semanal.' },
  { code:'V-06', title:'Firma carta de términos en banco', help:'Asegurar firma correcta y copia.' },
  { code:'V-07', title:'Emisión Carta Promesa de Pago', help:'Seguimiento, retiro, archivo y control.' },
  { code:'V-08', title:'Firma contrato promesa de compraventa', help:'Elaboración, firma promotora y cliente, constancias.' },

  // Escrituración
  { code:'E-01', title:'Cesión CPP por banco cliente', help:'Solicitar, retirar, enviar a banco interino, archivar.' },
  { code:'E-02', title:'Minuta de cancelación banco interino', help:'Solicitar M1, seguimiento, retiro, escaneo.' },
  { code:'E-03', title:'Minuta de compraventa (promotora)', help:'Solicitar/elaborar M2, planos, etc.' },
  { code:'E-04', title:'Minuta de préstamo (banco cliente)', help:'Solicitar M3, seguimiento, retiro.' },
  { code:'E-05', title:'Protocolo de escritura', help:'Solicitar, elaborar DE-04, imprimir para firmas.' },
  { code:'E-06', title:'Paz y salvo de clientes', help:'Solicitudes y verificaciones.' },
  { code:'E-07', title:'Firma protocolo por promotora', help:'Firma RL.' },
  { code:'E-08', title:'Firma protocolo por banco interino', help:'Envío, seguimiento, retiro.' },
  { code:'E-09', title:'Firma protocolo por el cliente', help:'Cita, asistencia, envío.' },
  { code:'E-10', title:'Firma protocolo por banco cliente', help:'Envío, seguimiento, retiro.' },
  { code:'E-11', title:'Cierre en notaría', help:'Revisión, envío, cierre, Escritura Pública.' },
  { code:'E-12', title:'Inscripción en Registro Público', help:'Ingreso, seguimiento, retiro, exoneración.' },
  { code:'E-13', title:'Desembolso CPP', help:'Solicitud DE-07, seguimiento, cheque, depósito.' },

  // Bono/MIVI (si aplica)
  { code:'M-01', title:'Expediente MIVI', help:'Armar y enviar a MIVIOT.' },
  { code:'M-02', title:'Inspección de vivienda por cliente', help:'Coordinar con técnico, carta de aceptación.' },
  { code:'M-03', title:'Aprobación bono solidario', help:'Ingreso y resolución.' },
  { code:'M-04', title:'Emisión/desembolso CPP Banco Nacional', help:'Seguimiento a emisión y desembolso.' }
];

// Valores de estado
const STEP_STATES = ['pendiente','en_proceso','completado','bloqueado'];

function renderChecklistView(venta = {}) {
  const byCode = new Map((venta.checklist || []).map(s => [s.code, s]));

  const itemsHtml = RBS_STEPS.map(s => {
    const cur = byCode.get(s.code) || {};
    const due = cur.dueAt ? String(cur.dueAt).slice(0,10) : '';
    const done = cur.doneAt ? String(cur.doneAt).slice(0,10) : '';
    const st = cur.state || 'pendiente';
    const note = cur.note || '';

    return `
      <div class="chk-item" data-code="${s.code}">
        <div class="head">
          <strong>${s.code} — ${s.title}</strong>
          <button class="help" type="button" data-code="${s.code}">ℹ️</button>
        </div>
        <div class="form-grid-4">
          <div class="label">Estado</div>
          <select id="chk-state-${s.code}">
            ${STEP_STATES.map(x => `<option value="${x}" ${st===x?'selected':''}>${x.replace(/_/g,' ')}</option>`).join('')}
          </select>

          <div class="label">Fecha límite</div>
          <input id="chk-due-${s.code}" type="date" value="${due}">

          <div class="label">Fecha realización</div>
          <input id="chk-done-${s.code}" type="date" value="${done}">

          <div class="label">Notas</div>
          <input id="chk-note-${s.code}" type="text" value="${note}">
        </div>
        <div class="help-box" id="help-${s.code}" hidden>${s.help || ''}</div>
      </div>
    `;
  }).join('');

  return seccion('Checklist RBS', `<div id="chkList">${itemsHtml}</div>`, ''); // sin grid wrapper
}

function wireChecklistHelpToggles() {
  document.querySelectorAll('#chkList .help').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.code;
      const box = document.getElementById(`help-${code}`);
      if (box) box.hidden = !box.hidden;
    });
  });
}

// Recolecta payload de checklist para guardar
function collectChecklistPayload() {
  // Leemos por el patrón de ids que pinta renderChecklistView
  return RBS_STEPS.map(s => {
    const code = s.code;
    const stEl  = document.getElementById(`chk-state-${code}`);
    const dueEl = document.getElementById(`chk-due-${code}`);
    const dnEl  = document.getElementById(`chk-done-${code}`);
    const ntEl  = document.getElementById(`chk-note-${code}`);

    const state = (stEl?.value || 'pendiente').trim();
    const due   = (dueEl?.value || '').trim();
    const done  = (dnEl?.value  || '').trim();
    const note  = (ntEl?.value  || '').trim();

    return {
      code,
      state,
      dueAt:  due  ? due  : null,
      doneAt: done ? done : null,
      note
    };
  });
}

  // Estado
  let unitsCache = [];
  let ventasMap = new Map(); // unitId -> venta
  let selected = new Set();
  let fichaUnitId = null;

  function pill(txt){ return `<span class="tag">${txt||'-'}</span>`; }

  // Carga ventas del proyecto y crea mapa por unidad
  async function loadVentasMap() {
    const ventas = await apiGet(`/api/ventas?projectId=${id}`);
    ventasMap = new Map((ventas||[]).map(v => [String(v.unitId), v]));
  }

  function updateSelectAllLabel() {
  if (!btnSelectAll) return;
  const total = (unitsCache || []).length;
  btnSelectAll.textContent = (selected.size >= total && total > 0) ? 'Deseleccionar todo' : 'Seleccionar todo';
}

function selectAllVisible() {
  // Selecciona todas las unidades visibles en el grid (unitsCache ya está filtrado por estado/búsqueda)
  unitsCache.forEach(u => selected.add(String(u._id)));

  // Marca checks + clase selected en UI
  grid.querySelectorAll('.unit-card').forEach(card => {
    card.classList.add('selected');
    const cb = card.querySelector('.sel');
    if (cb) cb.checked = true;
  });

  updateSelectAllLabel();
}

function deselectAllVisible() {
  // Quita del set las visibles
  unitsCache.forEach(u => selected.delete(String(u._id)));

  grid.querySelectorAll('.unit-card').forEach(card => {
    card.classList.remove('selected');
    const cb = card.querySelector('.sel');
    if (cb) cb.checked = false;
  });

  updateSelectAllLabel();
}


  async function loadUnits() {
    const estado = filtroEstado ? filtroEstado.value : '';
    const q = buscarInput ? buscarInput.value : '';
    const qEnc = encodeURIComponent(q||'');

    // Unidades
    let units = [];
    try {
      units = await apiGet(`/api/units?projectId=${id}&estado=${estado}&q=${qEnc}`);
    } catch {
      const legacy = await apiGet(`/api/inventory/${id}`);
      units = (legacy||[]).map(u => ({
        _id: u._id,
        manzana: (u.code||'').split('-')[0] || '',
        lote: (u.code||'').split('-')[1] || '',
        modelo: '',
        m2: 0,
        precioLista: u.price||0,
        estado: (String(u.status||'').toLowerCase().includes('reserv')) ? 'reservado' : 'disponible'
      }));
    }
    unitsCache = units;

    // Ventas (dato único)
    try { await loadVentasMap(); } catch(e){ console.warn('ventas map err', e); }

    // KPIs
    const resumen = { disponible:0,reservado:0,en_escrituracion:0,escriturado:0,entregado:0,valor:0 };
    units.forEach(u => { resumen[u.estado] = (resumen[u.estado]||0)+1; resumen.valor += u.precioLista||0; });
    kpisDiv.innerHTML = `
      <div>Disponibles: ${resumen.disponible||0}</div>
      <div>Reservados: ${resumen.reservado||0}</div>
      <div>En escrituración: ${resumen.en_escrituracion||0}</div>
      <div>Escriturados: ${resumen.escriturado||0}</div>
      <div>Entregados: ${resumen.entregado||0}</div>
      <div>Valor total: $${(resumen.valor||0).toLocaleString()}</div>
    `;

    // Grid
    // ----- Render grid mejorado -----
grid.innerHTML = units.map(u => {
  const venta = ventasMap.get(String(u._id));
  const banco = venta?.banco || '';
  const cpp = venta?.numCPP || '';
  const cliente = venta?.clienteNombre || venta?.cliente?.nombre || u.clienteId?.nombre || '';
  const idu = String(u._id);
  const estadoTxt = (u.estado||'disponible').replace(/_/g, ' ');
  // “Impago” si suena a mora/rechazo/atraso:
  const impago = /mora|impago|rechaz|atras|vencid|moros/i.test(venta?.statusBanco||'');

  return `
    <div class="unit-card estado-${u.estado||'disponible'} ${selected.has(idu)?'selected':''}" data-id="${idu}">
      ${impago ? `<span class="alert-ribbon">Impago</span>` : ``}
      <div class="head">
        <div class="title">
          <b>${u.manzana||'-'}-${u.lote||''}</b>
          <span class="status">${estadoTxt}</span>
        </div>
        <label class="sel-wrap" title="Seleccionar">
          <input type="checkbox" class="sel" ${selected.has(idu)?'checked':''} />
          <span class="sel-box"></span>
        </label>
      </div>
      <div class="meta">${u.modelo || '—'} — ${u.m2 || 0} m²</div>
      <div class="price">$${((u.precioLista||0)).toLocaleString()}</div>
      <div class="badges">
        ${cliente ? `<span class="chip">${cliente}</span>` : `<span class="chip ghost">Sin cliente</span>`}
        ${banco   ? `<span class="chip">Banco: ${banco}</span>` : ``}
        ${cpp     ? `<span class="chip">CPP: ${cpp}</span>` : ``}
      </div>
    </div>`;
}).join('') || `<div class="empty">No hay unidades.</div>`;

// ----- Eventos de tarjeta / checkbox -----
Array.from(grid.querySelectorAll('.unit-card')).forEach(el => {
  const id = el.dataset.id;

  el.addEventListener('click', (ev) => {
    // si hicieron click en el checkbox, no abrir ficha
    if (ev.target && (ev.target.classList?.contains('sel') || ev.target.classList?.contains('sel-box'))) return;
    abrirFichaUnidad(id);
  });

  const cb = el.querySelector('.sel');
  cb.addEventListener('change', () => {
  if (cb.checked){ selected.add(id); el.classList.add('selected'); }
  else { selected.delete(id); el.classList.remove('selected'); }
  updateSelectAllLabel();
});
});
  }
  window.loadUnits = loadUnits;

  function renderUnidadDocsSkeleton(unit) {
  const tag = `${unit?.manzana || '-'}-${unit?.lote || ''}`;
  return `
    <div id="unitDocs" class="unit-docs-wrap">
      <div class="subtle">Documentos de la unidad <b>${tag}</b></div>

      <form id="unitUploadForm" class="upload-box">
        <input id="unitFiles" type="file" multiple />
        <input id="unitDocName" type="text" placeholder="Nombre (opcional)" />
        <input id="unitDocExpiry" type="date" placeholder="Fecha de expiración (opcional)" />
        <button type="submit" class="btn">Subir</button>
      </form>

      <div id="unitDocsList" class="docs-list small-gap"></div>
    </div>
  `;
}

async function loadUnidadDocs(projectId, unitId) {
  const list = await apiGet(`/api/documents?projectId=${projectId}&unitId=${unitId}`).catch(() => []);
  const listDiv = document.getElementById('unitDocsList');
  if (!listDiv) return;

  listDiv.innerHTML = (list || []).map(d => `
    <div class="doc">
      <div>
        <span class="doc-item-title">${d.originalname || d.name}</span>
        <div class="doc-meta">${d.mimetype || ''} — ${(d.size || 0).toLocaleString()} bytes</div>
        <div class="doc-expiry ${d.expiryDate && new Date(d.expiryDate) < new Date(Date.now()+30*24*60*60*1000) ? 'warn' : ''}">
          Expira: ${d.expiryDate ? String(d.expiryDate).slice(0,10) : '—'}
        </div>
        ${d.checklistId ? `<div class="doc-meta">Checklist: ${d.checklistTitle || ''}</div>` : ''}
      </div>
      <div class="doc-actions">
        <a class="btn" href="/${d.path}" target="_blank" rel="noopener">Ver</a>
        <button class="btn danger doc-del" data-id="${d._id}">Eliminar</button>
      </div>
    </div>
  `).join('') || '<div class="small muted">No hay documentos para esta unidad.</div>';

  // asegurar que el delegado de click está instalado
  wireUnidadDocDelete(projectId, unitId);
}

function wireUnidadDocDelete(projectId, unitId) {
  const listDiv = document.getElementById('unitDocsList');
  if (!listDiv || listDiv.__wiredDelete) return; // evita doble binding
  listDiv.__wiredDelete = true;

  listDiv.addEventListener('click', async (e) => {
    const btn = e.target.closest('.doc-del');
    if (!btn) return;

    const docId = btn.dataset.id;
    const pin = prompt('Introduce el PIN para eliminar este documento:');
    if (!pin) return;

    try {
      await apiDelete(`/api/documents/${docId}`, { pin }); // el backend valida el PIN
      await loadUnidadDocs(projectId, unitId);             // refresca lista de la unidad
      if (typeof loadDocs === 'function') loadDocs();      // refresca pestaña "Docs" general
    } catch (err) {
      alert('Error eliminando documento: ' + (err?.message || ''));
    }
  });
}

function wireUnidadUpload(projectId, unitId) {
  const form = document.getElementById('unitUploadForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const files = document.getElementById('unitFiles')?.files;
    if (!files || !files.length) { alert('Selecciona al menos un archivo.'); return; }

    const fd = new FormData();
    // Campos obligatorios para backend
    fd.append('projectId', projectId);
    fd.append('unitId', unitId);

    // Opcionales
    const name  = document.getElementById('unitDocName')?.value?.trim();
    const exp   = document.getElementById('unitDocExpiry')?.value?.trim();
    if (name) fd.append('name', name);
    if (exp)  fd.append('expiryDate', exp);

    // Archivos
    Array.from(files).forEach(f => fd.append('files', f));

    try {
      await apiUpload('/api/documents/upload', fd);
      // Limpieza rápida
      form.reset();
      await loadUnidadDocs(projectId, unitId);
      // Opcional: refresca también la pestaña Docs general para que aparezcan unificados
      if (typeof loadDocs === 'function') loadDocs();
    } catch (err) {
      alert('Error subiendo archivos: ' + err.message);
    }
  });
}

  async function abrirFichaUnidad(unitId) {
  fichaUnitId = unitId;
  const u = unitsCache.find(x => String(x._id) === String(unitId)) || await apiGet(`/api/units/${unitId}`);
  const rawV = ventasMap.get(String(unitId)) || {};
  // 👇 v sin prototipo (no tiene .constructor heredado)
  const v = Object.assign(Object.create(null), rawV);


  document.getElementById('fichaTitulo').textContent = `Unidad ${(u.manzana||'')}-${(u.lote||'')}`;

  // ---------- Tabs ----------
const cont = document.getElementById('fichaContenido');
cont.innerHTML = `
  <div class="modal-tabs" id="fichaTabs">
    <button class="modal-tab active" data-tab="ficha">Ficha</button>
    <button class="modal-tab" data-tab="checklist">Checklist</button>
    <button class="modal-tab" data-tab="docs">Documentos</button>
  </div>
  <div id="fichaViews"></div>
`;

// ---------- FICHA (tu código) ----------
const htmlUnidad = `
  <div class="grid-2">
    <div>
      <h4>Datos de la unidad</h4>
      <label>Estado</label>
      <select id="fu-estado">
        ${['disponible','reservado','en_escrituracion','escriturado','entregado']
          .map(s => `<option value="${s}" ${u.estado===s?'selected':''}>${s}</option>`).join('')}
      </select>
      <label>Modelo</label><input id="fu-modelo" value="${u.modelo||''}">
      <label>m²</label><input id="fu-m2" type="number" value="${u.m2||0}">
      <label>Precio lista</label><input id="fu-precio" type="number" value="${u.precioLista||0}">
    </div>
    <div>
      <h4>Cliente (resumen)</h4>
      ${input('fv-clienteNombre','Cliente', v.clienteNombre||'')}
      ${input('fv-cedula','Cédula', v.cedula||'')}
      ${input('fv-empresa','Empresa', v.empresa||'')}
      ${inputNum('fv-valor','Valor', v.valor||0)}
      ${inputDate('fv-fechaContratoCliente','Fecha contrato firmado por cliente', v.fechaContratoCliente)}
    </div>
  </div>
`;

const htmlBancoCPP = seccion('Banco / CPP', [
  input('fv-banco','Banco', v.banco||''),
  input('fv-oficialBanco','Oficial de Banco', v.oficialBanco||''),
  selectRow('fv-statusBancoSel', 'Status en Banco', ''),
  `<div class="label" id="fv-statusBancoOtherLbl" style="display:none;">Especificar (OTRO)</div>
   <input id="fv-statusBancoOther" style="display:none;" placeholder="Especificar (OTRO)...">`,

  input('fv-numCPP','N° CPP', v.numCPP||''),
  inputDate('fv-entregaExpedienteBanco','Entrega expediente a banco', v.entregaExpedienteBanco),
  inputDate('fv-recibidoCPP','Recibido CPP', v.recibidoCPP),
  inputNum('fv-plazoAprobacionDias','Plazo aprobación (días)', v.plazoAprobacionDias),
  inputDate('fv-fechaValorCPP','Fecha valor CPP', v.fechaValorCPP),
  inputDate('fv-fechaVencimientoCPP','Vencimiento CPP', v.fechaVencimientoCPP),
  inputDate('fv-vencimientoCPPBnMivi','Vencimiento CPP BN-MIVI', v.vencimientoCPPBnMivi),
].join(''));

const htmlContrato = seccion('Contrato / Protocolo / Notaría / RP', [
  input('fv-estatusContrato','Estatus contrato', v.estatusContrato||''),
  input('fv-pagare','Pagaré', v.pagare||''),
  inputDate('fv-fechaFirma','Fecha firma', v.fechaFirma),
  inputChk('fv-protocoloFirmaCliente','Protocolo firma de cliente', !!v.protocoloFirmaCliente),
  inputDate('fv-fechaEntregaBanco','Fecha entrega a banco', v.fechaEntregaBanco),
  inputChk('fv-protocoloFirmaRLBancoInter','Protocolo firma RL / Banco Inter', !!v.protocoloFirmaRLBancoInter),
  inputDate('fv-fechaRegresoBanco','Fecha regreso banco', v.fechaRegresoBanco),
  inputNum('fv-diasTranscurridosBanco','Días transcurridos banco', v.diasTranscurridosBanco),
  inputDate('fv-fechaEntregaProtocoloBancoCli','Entrega protocolo banco cliente', v.fechaEntregaProtocoloBancoCli),
  inputChk('fv-firmaProtocoloBancoCliente','Firma protocolo banco cliente', !!v.firmaProtocoloBancoCliente),
  inputDate('fv-fechaRegresoProtocoloBancoCli','Regreso protocolo banco cliente', v.fechaRegresoProtocoloBancoCli),
  inputNum('fv-diasTranscurridosProtocolo','Días transcurridos protocolo', v.diasTranscurridosProtocolo),
  inputDate('fv-cierreNotaria','Cierre de notaría', v.cierreNotaria),
  inputDate('fv-fechaPagoImpuesto','Fecha pago impuestos', v.fechaPagoImpuesto),
  inputDate('fv-ingresoRP','Ingreso al RP', v.ingresoRP),
  inputDate('fv-fechaInscripcion','Fecha inscripción', v.fechaInscripcion),
  inputDate('fv-solicitudDesembolso','Solicitud desembolso (banco)', v.solicitudDesembolso),
  inputDate('fv-fechaRecibidoCheque','Fecha recibido cheque', v.fechaRecibidoCheque),
].join(''));

const htmlMivi = seccion('MIVI', [
  input('fv-expedienteMIVI','Expediente MIVI', v.expedienteMIVI||''),
  inputDate('fv-entregaExpMIVI','Fecha entrega exp. MIVI', v.entregaExpMIVI),
  input('fv-resolucionMIVI','N° Resolución MIVI', v.resolucionMIVI||''),
  inputDate('fv-fechaResolucionMIVI','Fecha resolución', v.fechaResolucionMIVI),
  inputDate('fv-solicitudMiviDesembolso','Solicitud MIVI desembolso', v.solicitudMiviDesembolso),
  inputNum('fv-desembolsoMivi','Desembolso MIVI', v.desembolsoMivi),
  inputDate('fv-fechaPagoMivi','Fecha pago MIVI', v.fechaPagoMivi),
].join(''));

const htmlLegal = seccion('Legal / Permisos / Obra / Otros', [
  inputChk('fv-enConstruccion','En construcción', !!v.enConstruccion),
  input('fv-faseConstruccion','Fase construcción', v.faseConstruccion||''),
  input('fv-permisoConstruccionNum','Permiso construcción N° resolución', v.permisoConstruccionNum||''),
  inputChk('fv-permisoOcupacion','Permiso de ocupación', !!v.permisoOcupacion),
  input('fv-permisoOcupacionNum','N° permiso de ocupación', v.permisoOcupacionNum||''),
  input('fv-constructora','Constructor', v.constructora||''),
  inputChk('fv-pazSalvoGesproban','Paz y salvo Gesproban', !!v.pazSalvoGesproban),
  inputChk('fv-pazSalvoPromotora','Paz y salvo Promotora', !!v.pazSalvoPromotora),
  input('fv-mLiberacion','M. Liberación', v.mLiberacion||''),
  input('fv-mSegregacion','M. Segregación', v.mSegregacion||''),
  input('fv-mPrestamo','M. Préstamo', v.mPrestamo||''),
  inputDate('fv-solicitudAvaluo','Solicitud de avalúo', v.solicitudAvaluo),
  inputDate('fv-avaluoRealizado','Avalúo realizado', v.avaluoRealizado),
  inputDate('fv-entregaCasa','Entrega de casa', v.entregaCasa),
  inputDate('fv-entregaANATI','Entrega ANATI', v.entregaANATI),
  input('fv-comentario','Comentario', v.comentario||''),
].join(''));

const fichaHTML = htmlUnidad + htmlBancoCPP + htmlContrato + htmlMivi + htmlLegal;

// ---------- CHECKLIST ----------
const checklistHTML = renderChecklistView(v);

// ---------- DOCUMENTOS (vista) ----------
const docsHTML = (typeof renderUnidadDocsSkeleton === 'function')
  ? renderUnidadDocsSkeleton(u)
  : `<div class="small muted">Subida de documentos por unidad aún no disponible.</div>`;

// Montar vistas
const views    = document.getElementById('fichaViews');
const viewFicha = document.createElement('div');
const viewChk   = document.createElement('div');
const viewDocs  = document.createElement('div');

viewFicha.id = 'view-ficha';
viewChk.id   = 'view-checklist';
viewDocs.id  = 'view-docs';

viewFicha.innerHTML = fichaHTML;
viewChk.innerHTML   = checklistHTML;
viewDocs.innerHTML  = docsHTML;

views.innerHTML = '';
views.appendChild(viewFicha);
views.appendChild(viewChk);
views.appendChild(viewDocs);

initStatusBancoUI(
  'fv-statusBancoSel',
  'fv-statusBancoOtherLbl',
  'fv-statusBancoOther',
  v.statusBanco || '',
  { includeEmpty: false }
);

// Asegura que el input de constructora quede correcto pase lo que pase
const elCons = document.getElementById('fv-constructora');
if (elCons) elCons.value = safeVal(v.constructora);

// ✅ Status Banco (select + OTRO) — inicializar con lo que ya tiene guardado
initStatusBancoUI(
  'fv-statusBancoSel',
  'fv-statusBancoOtherWrap',
  'fv-statusBancoOther',
  v.statusBanco || '',
  { includeEmpty: false }
);

views.appendChild(viewFicha);
views.appendChild(viewChk);
views.appendChild(viewDocs);

// Visibilidad inicial
viewFicha.style.display = '';
viewChk.style.display   = 'none';
viewDocs.style.display  = 'none';

// Tabs
cont.querySelectorAll('.modal-tab').forEach(btn => {
  btn.addEventListener('click', async () => {
    cont.querySelectorAll('.modal-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;

    viewFicha.style.display = (tab === 'ficha') ? '' : 'none';
    viewChk.style.display   = (tab === 'checklist') ? '' : 'none';
    viewDocs.style.display  = (tab === 'docs') ? '' : 'none';

    if (tab === 'docs') {
      if (typeof loadUnidadDocs === 'function') await loadUnidadDocs(id, unitId);
      if (typeof wireUnidadUpload === 'function') wireUnidadUpload(id, unitId);
    }
  });
});

// Toggle de ayudas (ℹ️)
wireChecklistHelpToggles();

modalFicha.style.display = 'flex';
}


  window.abrirFichaUnidad = abrirFichaUnidad;

  async function guardarFicha() {
  // ROLE-SEP: bloqueo para commercial si proyecto no aprobado
  if (myRole === 'commercial' && window.__COMMERCIAL_LOCKED) {
    alert('Este proyecto aún no está aprobado. Edición comercial bloqueada.');
    return;
  }
  if (!fichaUnitId) return;

  // 1) Actualizar la unidad
  const uBody = {
    estado: document.getElementById('fu-estado').value,
    modelo: document.getElementById('fu-modelo').value,
    m2: Number(document.getElementById('fu-m2').value||0),
    precioLista: Number(document.getElementById('fu-precio').value||0),
  };
  await apiPatch(`/api/units/${fichaUnitId}`, uBody);

  // 2) Upsert de la venta con TODOS los campos del expediente
  const vBody = {
    projectId: id,
    unitId: fichaUnitId,

    // Cliente
    clienteNombre: vVal('fv-clienteNombre'),
    cedula:        vVal('fv-cedula'),
    empresa:       vVal('fv-empresa'),
    valor:         vNum('fv-valor'),
    fechaContratoCliente: vDate('fv-fechaContratoCliente'),

    // Banco / CPP
    banco:          vVal('fv-banco'),
    oficialBanco:   vVal('fv-oficialBanco'),
    statusBanco: getStatusBancoValue('fv-statusBancoSel', 'fv-statusBancoOther'),
    numCPP:         vVal('fv-numCPP'),
    entregaExpedienteBanco: vDate('fv-entregaExpedienteBanco'),
    recibidoCPP:            vDate('fv-recibidoCPP'),
    plazoAprobacionDias:    vNum('fv-plazoAprobacionDias'),
    fechaValorCPP:          vDate('fv-fechaValorCPP'),
    fechaVencimientoCPP:    vDate('fv-fechaVencimientoCPP'),
    vencimientoCPPBnMivi:   vDate('fv-vencimientoCPPBnMivi'),

    // Contrato / Protocolo / Notaría / RP / Desembolso
    estatusContrato:              vVal('fv-estatusContrato'),
    pagare:                       vVal('fv-pagare'),
    fechaFirma:                   vDate('fv-fechaFirma'),
    protocoloFirmaCliente:        vChk('fv-protocoloFirmaCliente'),
    fechaEntregaBanco:            vDate('fv-fechaEntregaBanco'),
    protocoloFirmaRLBancoInter:   vChk('fv-protocoloFirmaRLBancoInter'),
    fechaRegresoBanco:            vDate('fv-fechaRegresoBanco'),
    diasTranscurridosBanco:       vNum('fv-diasTranscurridosBanco'),
    fechaEntregaProtocoloBancoCli:vDate('fv-fechaEntregaProtocoloBancoCli'),
    firmaProtocoloBancoCliente:   vChk('fv-firmaProtocoloBancoCliente'),
    fechaRegresoProtocoloBancoCli:vDate('fv-fechaRegresoProtocoloBancoCli'),
    diasTranscurridosProtocolo:   vNum('fv-diasTranscurridosProtocolo'),
    cierreNotaria:                vDate('fv-cierreNotaria'),
    fechaPagoImpuesto:            vDate('fv-fechaPagoImpuesto'),
    ingresoRP:                    vDate('fv-ingresoRP'),
    fechaInscripcion:             vDate('fv-fechaInscripcion'),
    solicitudDesembolso:          vDate('fv-solicitudDesembolso'),
    fechaRecibidoCheque:          vDate('fv-fechaRecibidoCheque'),

    // MIVI
    expedienteMIVI:          vVal('fv-expedienteMIVI'),
    entregaExpMIVI:          vDate('fv-entregaExpMIVI'),
    resolucionMIVI:          vVal('fv-resolucionMIVI'),
    fechaResolucionMIVI:     vDate('fv-fechaResolucionMIVI'),
    solicitudMiviDesembolso: vDate('fv-solicitudMiviDesembolso'),
    desembolsoMivi:          vNum('fv-desembolsoMivi'),
    fechaPagoMivi:           vDate('fv-fechaPagoMivi'),

    // Legal / Obra / Otros
    enConstruccion:         vChk('fv-enConstruccion'),
    faseConstruccion:       vVal('fv-faseConstruccion'),
    permisoConstruccionNum: vVal('fv-permisoConstruccionNum'),
    permisoOcupacion:       vChk('fv-permisoOcupacion'),
    permisoOcupacionNum:    vVal('fv-permisoOcupacionNum'),
    constructora:            vVal('fv-constructora'),
    pazSalvoGesproban:      vChk('fv-pazSalvoGesproban'),
    pazSalvoPromotora:      vChk('fv-pazSalvoPromotora'),
    mLiberacion:            vVal('fv-mLiberacion'),
    mSegregacion:           vVal('fv-mSegregacion'),
    mPrestamo:              vVal('fv-mPrestamo'),
    solicitudAvaluo:        vDate('fv-solicitudAvaluo'),
    avaluoRealizado:        vDate('fv-avaluoRealizado'),
    entregaCasa:            vDate('fv-entregaCasa'),
    entregaANATI:           vDate('fv-entregaANATI'),
    comentario:             vVal('fv-comentario'),
  };

  vBody.checklist = collectChecklistPayload();

  await apiPost('/api/ventas/upsert-by-unit', vBody);

  modalFicha.style.display = 'none';
  await loadUnits();
}

  // === Batch ===
  function openBatch() {
  if (!selected.size) return alert('Selecciona al menos una unidad.');
  modalBatch.style.display='flex';

  // ✅ llenar select y permitir "(no cambiar)"
  initStatusBancoUI(
    'b-statusBancoSel',
    'b-statusBancoOtherWrap',
    'b-statusBancoOther',
    '',
    { includeEmpty: true }
  );
}
  function closeBatch(){ modalBatch.style.display='none'; }

  async function aplicarBatch() {
        // ROLE-SEP: bloquear edición si commercial y no aprobado
    if (myRole === 'commercial' && window.__COMMERCIAL_LOCKED) {
      alert('Este proyecto aún no está aprobado. Edición comercial bloqueada.');
      return;
    }
    if (!selected.size) return;
    const ids = Array.from(selected);
    // Unit updates
    const updUnit = {};
    const e = document.getElementById('b-estado').value; if (e) updUnit.estado = e;
    const mo = document.getElementById('b-modelo').value; if (mo) updUnit.modelo = mo;
    const m2 = document.getElementById('b-m2').value; if (m2) updUnit.m2 = Number(m2);
    const pr = document.getElementById('b-precio').value; if (pr) updUnit.precioLista = Number(pr);
    if (Object.keys(updUnit).length) await apiPatch('/api/units/batch', { ids, update: updUnit, projectId: id });

    // Venta updates
    const updVenta = {};
    const banco = document.getElementById('b-banco').value; if (banco) updVenta.banco = banco;
    const sb = getStatusBancoValue('b-statusBancoSel','b-statusBancoOther');
    if (sb) updVenta.statusBanco = sb;
    const cpp = document.getElementById('b-numCPP').value; if (cpp) updVenta.numCPP = cpp;
    const val = document.getElementById('b-valor').value; if (val) updVenta.valor = Number(val);
    if (Object.keys(updVenta).length) await apiPatch('/api/ventas/batch', { unitIds: ids, update: updVenta, upsert: true, projectId: id });

    closeBatch();
    await loadUnits();
  }

  function openDel() { if (!selected.size) return alert('Selecciona al menos una unidad.'); modalDel.style.display='flex'; }
  function closeDel(){ modalDel.style.display='none'; }

  async function aplicarDel() {
        // ROLE-SEP: bloquear borrado si commercial y no aprobado
    if (myRole === 'commercial' && window.__COMMERCIAL_LOCKED) {
      alert('Este proyecto aún no está aprobado. Eliminación bloqueada.');
      return;
    }
    const pin = document.getElementById('del-pin').value;
    if (!pin) return alert('PIN requerido');
    const ids = Array.from(selected);
    await apiDelete('/api/units/batch', { ids, pin, projectId: id });
    selected.clear();
    closeDel();
    await loadUnits();
  }

  // === Eventos ===
  if (fichaGuardar) fichaGuardar.addEventListener('click', guardarFicha);
  if (fichaCerrar) fichaCerrar.addEventListener('click', () => modalFicha.style.display='none');

  if (filtroEstado) filtroEstado.addEventListener('change', loadUnits);
  if (buscarInput) buscarInput.addEventListener('input', () => { clearTimeout(window.__deb); window.__deb = setTimeout(loadUnits, 250); });

  if (btnExportarCsv) {
  btnExportarCsv.addEventListener('click', async () => {
    try {
      const url = `/api/export/comercial.csv?projectId=${encodeURIComponent(id)}`;
      await downloadFile(url, `comercial_${id}.csv`);
    } catch (e) {
      console.error(e);
      alert(e.message || 'Error exportando CSV');
    }
  });
}

if (btnExportarExcel) {
  btnExportarExcel.addEventListener('click', async () => {
    try {
      const url = `/api/export/comercial.xlsx?projectId=${encodeURIComponent(id)}`;
      await downloadFile(url, `comercial_${id}.xlsx`);
    } catch (e) {
      console.error(e);
      alert(e.message || 'Error exportando Excel');
    }
  });
}

  if (btnCrear) btnCrear.addEventListener('click', () => modalCrear.style.display='flex');
  if (modalCrearCerrar) modalCrearCerrar.addEventListener('click', () => modalCrear.style.display='none');
  if (btnBatch) btnBatch.addEventListener('click', openBatch);
  if (batchCerrar) batchCerrar.addEventListener('click', () => modalBatch.style.display='none');
  if (batchAplicar) batchAplicar.addEventListener('click', aplicarBatch);
  if (btnDel) btnDel.addEventListener('click', openDel);
  if (delCerrar) delCerrar.addEventListener('click', closeDel);
  if (delAplicar) delAplicar.addEventListener('click', aplicarDel);

  if (btnCrearSubmit) {
    btnCrearSubmit.addEventListener('click', async () => {
            // ROLE-SEP: bloquear creación si commercial y no aprobado
      if (myRole === 'commercial' && window.__COMMERCIAL_LOCKED) {
        alert('Este proyecto aún no está aprobado. Creación de unidades bloqueada.');
        return;
      }
      const body = {
        projectId: id,
        manzana: document.getElementById('cl-manzana').value || 'A',
        modo: 'A',
        cantidad: Number(document.getElementById('cl-cantidad').value || 0),
        modelo: document.getElementById('cl-modelo').value || '',
        m2: Number(document.getElementById('cl-m2').value || 0),
        precioLista: Number(document.getElementById('cl-precio').value || 0),
        estado: document.getElementById('cl-estado').value || 'disponible'
      };
      try {
        await apiPost('/api/units/batch', body);
        modalCrear.style.display = 'none';
        await loadUnits();
      } catch (e) { alert('Error creando unidades: ' + e.message); }
    });
  }

  if (btnSelectAll) {
  btnSelectAll.addEventListener('click', () => {
    const total = (unitsCache || []).length;
    if (!total) return;

    if (selected.size >= total) deselectAllVisible();
    else selectAllVisible();
  });
  }

  // Carga inicial
  loadUnits();
})();


  // ======================
// ====== DOCS (Bank73)
// ======================

let _allDocs = []; // cache

function normStatus(s){ return String(s||'ACTIVE').toUpperCase(); }
function isActiveDoc(d){ return normStatus(d.status) === 'ACTIVE'; }

function docExpiryMeta(d){
  const expTs = d.expiryDate ? new Date(d.expiryDate).getTime() : null;
  const now   = Date.now();
  const soon  = now + 30*24*60*60*1000;

  if (!expTs) return { expTs:null, label:'—', cls:'', state:'NO_EXPIRY' };

  const expText = new Date(d.expiryDate).toISOString().slice(0,10);
  if (expTs < now)  return { expTs, label:expText, cls:'danger', state:'EXPIRED' };
  if (expTs < soon) return { expTs, label:expText, cls:'warn',   state:'SOON' };
  return { expTs, label:expText, cls:'', state:'OK' };
}

function findChecklistTitle(idCL) {
  if (!idCL) return '—';
  const x = String(idCL);
  const hit = (state.checklists || []).find(c => String(c._id) === x);
  return hit?.title || '—';
}

function docChips(d){
  const chips = [];
  if (d.checklistId) chips.push(`<span class="chip">Checklist: ${escapeHtml(findChecklistTitle(d.checklistId))}</span>`);
  if (d.unitTag)     chips.push(`<span class="chip">Unidad: ${escapeHtml(d.unitTag)}</span>`);
  if (d.baTag)       chips.push(`<span class="chip ${d.baTag === 'BEFORE' ? 'chip-gray' : 'chip-green'}">${escapeHtml(d.baTag)}</span>`);
  if (d.permitCode)  chips.push(`<span class="chip">Permiso: ${escapeHtml(d.permitCode)}</span>`);
  return chips.join(' ');
}

function canDeleteDoc() {
  return ['admin','bank','promoter','gerencia','socios','financiero','contable','legal','tecnico','commercial'].includes(myRole);
}
function renderDeleteBtn(d){
  if (!canDeleteDoc()) return '';
  return `<button class="btn btn-danger" data-del="${d._id}">Eliminar</button>`;
}

// ✅ NUEVO: botón Cumplir
function canCompleteDoc(){
  // Ajusta si quieres: por ejemplo solo bank/promoter/admin/gerencia…
  return ['admin','bank','promoter','gerencia','socios','financiero','contable','legal','tecnico','commercial'].includes(myRole);
}
function renderCompleteBtn(d){
  const st = normStatus(d.status);
  if (!canCompleteDoc()) return '';
  if (st !== 'ACTIVE') return '';
if (!d.expiryDate) return ''; // ✅ si no hay vencimiento, no tiene sentido “cumplir”
return `<button class="btn" data-complete="${d._id}">Cumplir</button>`;
}

// ✅ NUEVO: botón Reemplazar (sube nuevo y archiva el viejo)
function canReplaceDoc(){
  return ['admin','bank','promoter','gerencia','socios','financiero','contable'].includes(myRole);
}
function renderReplaceBtn(d){
  const st = normStatus(d.status);
  if (!canReplaceDoc()) return '';
  if (st !== 'ACTIVE') return '';
if (!d.expiryDate) return ''; // ✅ solo si tiene vencimiento
return `<button class="btn" data-replace="${d._id}">Reemplazar</button>`;
}

function renderStatusPill(d){
  const st = normStatus(d.status);
  if (st === 'COMPLETED') return `<span class="pill pill-gray">CUMPLIDO</span>`;
  if (st === 'REPLACED')  return `<span class="pill pill-gray">REEMPLAZADO</span>`;
  return `<span class="pill pill-blue">ACTIVO</span>`;
}

function matchesDocQuery(d, q){
  if (!q) return true;
  q = q.toLowerCase();
  const fields = [
    d.originalname, d.title, d.filename, d.mimetype, d.unitTag,
    d.permitCode, d.permitTitle,
    findChecklistTitle(d.checklistId)
  ];
  return fields.some(v => String(v || '').toLowerCase().includes(q));
}

async function loadDocs({ q } = {}) {
  const docsDiv    = document.getElementById('docs');
  const uploadForm = document.getElementById('uploadForm');
  const countEl    = document.getElementById('docsCount');
  if (!docsDiv) return;

  const partial = ['tecnico','legal','commercial'].includes(myRole);
  if (uploadForm) uploadForm.style.display = partial ? 'none' : '';

  // Carga una sola vez y cachea
  if (!_allDocs.length) {
    _allDocs = await API.get('/api/documents?projectId=' + id).catch(()=>[]);
  }

  // Filtro por roles (tu lógica)
  const allowed = (state.allowedChecklistRoles || []);
  const clMap = new Map((state.checklists || []).map(c => [String(c._id), (c.role || c.roleOwner || '').toLowerCase()]));
  let filtered = _allDocs.filter(d => {
    if (!allowed.length) return true;
    if (d.unitId) return true;
    if (d.checklistId) {
      const r = (clMap.get(String(d.checklistId)) || '').toLowerCase();
      return r && allowed.includes(r);
    }
    return !partial;
  });

  // Filtro por query
  if (q && q.trim()) filtered = filtered.filter(d => matchesDocQuery(d, q));

  if (!filtered.length) {
    docsDiv.innerHTML = '<div class="small muted">No hay documentos</div>';
    if (countEl) countEl.textContent = '';
    return;
  }

  const MB = 1024*1024;

  docsDiv.innerHTML = filtered.map(d => {
    const sizeStr = (d.size >= MB) ? (d.size/MB).toFixed(2)+' MB' : Math.round((d.size||0)/1024)+' KB';
    const exp = docExpiryMeta(d);

    // Texto “Expira” + clases según estado
    const expLine = d.expiryDate
      ? `<div class="small ${exp.cls}">Expira: ${exp.label}</div>`
      : `<div class="small muted">Expira: —</div>`;

    // Si está completado, mostrar info auditoría
    const st = normStatus(d.status);
    const extra = (st === 'COMPLETED' && d.completedAt)
      ? `<div class="small muted">Cumplido: ${new Date(d.completedAt).toISOString().slice(0,10)} ${d.completionNote ? '— ' + escapeHtml(d.completionNote) : ''}</div>`
      : '';

    return `
      <div class="doc">
        <div class="doc-info">
          <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
            <b>${escapeHtml(d.originalname || d.title || d.name || 'Documento')}</b>
            ${renderStatusPill(d)}
          </div>
          <div class="small muted">${escapeHtml(d.mimetype || '')} — ${sizeStr}</div>
          ${expLine}
          ${extra}
          <div class="chips">${docChips(d)}</div>
        </div>
        <div class="doc-actions">
          <a class="btn" href="/${d.path}" target="_blank">Ver</a>
          <a class="btn" href="/api/documents/${d._id}/download">Descargar</a>
          ${renderCompleteBtn(d)}
          ${renderReplaceBtn(d)}
          ${renderDeleteBtn(d)}
        </div>
      </div>
    `;
  }).join('');

  if (countEl) countEl.textContent = `${filtered.length} / ${_allDocs.length}`;
}

// wire buscador (debounce)
(function(){
  const inp = document.getElementById('docsSearch');
  if (!inp) return;
  let t;
  inp.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => loadDocs({ q: inp.value }), 150);
  });
})();

// ===== Upload normal (tu lógica, con pequeño extra para "replaces") =====
function wireDocsUpload() {
  const form = document.getElementById('uploadForm');
  const btn  = document.getElementById('docsUploadBtn');
  const fileEl = document.getElementById('file');
  const expEl  = document.getElementById('expiry');

  if (!form || !btn || !fileEl) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const f = fileEl.files && fileEl.files[0];
    if (!f) return alert('Selecciona un archivo primero');

    const fd = new FormData();
    fd.append('projectId', id);
    fd.append('file', f);
    if (expEl && expEl.value) fd.append('expiryDate', expEl.value);

    btn.disabled = true;
    btn.textContent = 'Subiendo...';

    try {
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: { ...tenantHeaders(), ...authHeaders() },
        body: fd
      });

      if (!res.ok) {
        const j = await res.json().catch(()=> ({}));
        throw new Error(j?.message || j?.error || `HTTP ${res.status}`);
      }

      fileEl.value = '';
      if (expEl) expEl.value = '';

      _allDocs = [];
      await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
      alert('Documento subido');
    } catch (err) {
      console.error('[Docs Upload] error', err);
      alert('No se pudo subir: ' + (err.message || ''));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Subir';
    }
  });
}

// ===== Delegación: Eliminar / Cumplir / Reemplazar =====
document.addEventListener('click', async (ev) => {

  // ---- eliminar ----
  const delBtn = ev.target.closest('button[data-del]');
  if (delBtn) {
    const docId = delBtn.getAttribute('data-del');
    if (!docId) return;

    const pin = prompt('Introduce el PIN para eliminar (configurable en .env como DELETE_DOCS_PIN):', '');
    if (pin === null) return;

    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(docId)}?pin=${encodeURIComponent(pin)}`, {
        method: 'DELETE',
        headers: { ...tenantHeaders(), ...authHeaders() }
      });
      if (!res.ok) {
        const j = await res.json().catch(()=> ({}));
        if (j?.error === 'pin_invalid') throw new Error('PIN inválido');
        throw new Error(j?.error || `HTTP ${res.status}`);
      }

      // refrescar cache + UI
      _allDocs = [];
      await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });

    } catch (e) {
      alert('No se pudo eliminar: ' + (e.message || ''));
    }
    return;
  }

  // ---- cumplir ----
  const compBtn = ev.target.closest('button[data-complete]');
  if (compBtn) {
    const docId = compBtn.getAttribute('data-complete');
    if (!docId) return;

    const note = prompt('Nota (opcional): ¿qué se cumplió / cómo se resolvió?', '');
    if (note === null) return; // ✅ si cancelas, NO se cumple

    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(docId)}/complete`, {
        method: 'PATCH',
        headers: { 'Content-Type':'application/json', ...tenantHeaders(), ...authHeaders() },
        body: JSON.stringify({ note })
      });
      if (!res.ok) {
        const j = await res.json().catch(()=> ({}));
        throw new Error(j?.error || j?.message || `HTTP ${res.status}`);
      }

      _allDocs = [];
      await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });

    } catch (e) {
      alert('No se pudo marcar como cumplido: ' + (e.message || ''));
    }
    return;
  }

  // ---- reemplazar ----
  const repBtn = ev.target.closest('button[data-replace]');
  if (repBtn) {
    const docId = repBtn.getAttribute('data-replace');
    if (!docId) return;

    // Abrimos un input file “al vuelo”
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '*/*';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;

      // fecha opcional
      const expiry = prompt('Fecha de vencimiento del NUEVO documento (YYYY-MM-DD) o vacío:', '') || '';

      const fd = new FormData();
      fd.append('projectId', id);
      fd.append('file', f);
      if (expiry.trim()) fd.append('expiryDate', expiry.trim());

      // 👇 clave: este upload reemplaza a docId
      fd.append('replaces', docId);

      try {
        const res = await fetch('/api/documents/upload', {
          method: 'POST',
          headers: { ...tenantHeaders(), ...authHeaders() },
          body: fd
        });
        if (!res.ok) {
          const j = await res.json().catch(()=> ({}));
          throw new Error(j?.message || j?.error || `HTTP ${res.status}`);
        }

        _allDocs = [];
        await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
        alert('Reemplazo subido. El documento anterior queda archivado.');

      } catch (e) {
        alert('No se pudo reemplazar: ' + (e.message || ''));
      }
    };
    input.click();
    return;
  }
});

// Llamadas iniciales
wireDocsUpload();
// (tu loadProject o init debe llamar a loadDocs)

// ====== Chat (pestaña Chat) ======
let chatBeforeCursor = null; // para paginación "cargar más"
const chatListEl   = document.getElementById('chatList');
const chatForm     = document.getElementById('chatForm');
const chatInput    = document.getElementById('chatInput');
const chatLoadMore = document.getElementById('chatLoadMore');

async function loadChatMessages({ append=false } = {}) {
  if (!chatListEl) return;
  if (!append) chatBeforeCursor = null;            // reset

  let url = `/api/chat/projects/${id}?limit=30`;
  if (chatBeforeCursor) url += `&before=${encodeURIComponent(chatBeforeCursor)}`;
  url += `&ts=${Date.now()}`;

  const res = await API.get(url).catch(()=>({ messages:[] }));
  const msgs = res.messages || [];

  if (!append) chatListEl.innerHTML = '';

  if (msgs.length) {
    // ahora el backend devuelve [nuevo -> viejo]
    chatBeforeCursor = msgs[msgs.length - 1].createdAt;  // el MÁS VIEJO recibid
    const html = msgs.map(renderChatMessage).join('');

    if (append) {
      // “anteriores” = más viejos → se agregan AL FINAL
      chatListEl.insertAdjacentHTML('beforeend', html);
    } else {
      // carga inicial: nuevos arriba
      chatListEl.innerHTML = html;
    }
    chatLoadMore.style.display = 'block';
  } else if (!append) {
    chatListEl.innerHTML = '<div class="small muted">No hay mensajes aún</div>';
    chatLoadMore.style.display = 'none';
  }
}

function renderChatMessage(m) {
  const initials = (m.userEmail || m.userName || '?').slice(0,1).toUpperCase();
  const date = m.createdAt ? new Date(m.createdAt).toLocaleString() : '';
  return `
    <div class="chat-item" data-id="${m._id}">
      <div class="chat-avatar">${initials}</div>
      <div class="chat-body">
        <div class="chat-meta">
          <b>${escapeHtml(m.userEmail || m.userName || '—')}</b>
          <span>${escapeHtml(date)}</span>
        </div>
        <div class="chat-text">${escapeHtml(m.text)}</div>
        <div class="chat-actions">
          <button class="chat-del" data-id="${m._id}">Borrar</button>
        </div>
      </div>
    </div>`;
}

function escapeHtml(str){
  return String(str||'').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function sendChatMessage(txt){
  const res = await API.post(`/api/chat/projects/${id}`, { text: txt });
  return res.message;
}

async function deleteChatMessage(mid){
  const res = await fetch(`/api/chat/${mid}`, {
    method: 'DELETE',
    headers: {
      ...tenantHeaders(),   // ya las tienes definidas arriba
      ...authHeadersNoContentType(),
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

if (chatForm) {
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const txt = chatInput.value.trim();
    if (!txt) return;
    try {
      const msg = await sendChatMessage(txt);
      chatInput.value = '';

      // 👇 Añadir el nuevo mensaje ARRIBA sin recargar todo
      chatListEl.insertAdjacentHTML('afterbegin', renderChatMessage(msg));
      chatListEl.scrollTop = 0; // opcional: subir del todo
    } catch (err) {
      alert('Error enviando mensaje: ' + (err?.message || ''));
    }
  });
}


if (chatListEl) {
  chatListEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.chat-del');
    if (!btn) return;
    const id = btn.dataset.id;
    if (!id) return;
    if (!confirm('¿Borrar este mensaje?')) return;
    try {
      await deleteChatMessage(id);
      const item = chatListEl.querySelector(`.chat-item[data-id="${id}"]`);
      if (item) item.remove();
    } catch (err) { alert('Error al borrar: ' + err.message); }
  });
}

if (chatLoadMore) {
  chatLoadMore.addEventListener('click', () => loadChatMessages({ append:true }));
}


// ====== Init ======
applyRoleVisibility();

if (['tecnico','legal'].includes(myRole)) {
  // Estos roles SOLO pueden ver checklists y docs (RBAC)
  await loadProyectoData();   // /api/projects/:id/checklists  ✅ permitido
  renderProyecto();
  await loadDocs();           // /api/documents?projectId=...  ✅ permitido
  await loadChatMessages();
  
} else if (myRole === 'commercial') {
  // Comercial: unidades + (ahora) checklists propios + docs
  await loadUnits();          // ✅
  await loadProyectoData();   // ✅ /api/projects/:id/checklists (ya permitido por el cambio de arriba)
  renderProyecto();           // pinta la pestaña Proyecto con solo COMERCIAL
  await loadDocs();           // ✅
  await loadChatMessages();
} else {
  // Roles full (admin, bank, promoter, gerencia, socios, financiero, contable)
  await loadProject();        // ✅
  await Promise.all([
    loadSummary(),            // ✅
    loadFinance(),            // ✅
    loadUnits()               // ✅
  ]);
  await loadProyectoData();   // ✅
  renderProyecto();
  await loadDocs();           // ✅
  await loadChatMessages();
}

  // logout
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', () => { API.logout(); location.href = '/'; });
})();
