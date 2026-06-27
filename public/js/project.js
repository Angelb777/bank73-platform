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
  const projectCurrencySel = document.getElementById('projectCurrencySel');
  const projectTypeText = document.getElementById('projectTypeText');
  const startBtn    = document.getElementById('startBtn');
  const projectAlertsBtn = document.getElementById('projectAlertsBtn');

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
  let __summaryDirty = false;
  const PROJECT_CURRENCIES = {
    PAB: { code: 'PAB', label: 'B/. Balboa', symbol: 'B/.' },
    USD: { code: 'USD', label: '$ Dolar estadounidense', symbol: '$' },
    EUR: { code: 'EUR', label: '€ Euro', symbol: '€' }
  };
  let currentProjectCurrency = 'PAB';
  let isProjectSettingsSaving = false;

  function normalizeProjectCurrency(value) {
    const code = String(value || '').trim().toUpperCase();
    return PROJECT_CURRENCIES[code] ? code : 'PAB';
  }

  function projectCurrencySymbol(currency = currentProjectCurrency) {
    return PROJECT_CURRENCIES[normalizeProjectCurrency(currency)].symbol;
  }

  function parsePanamaNumber(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const cleaned = String(value)
      .trim()
      .replace(/B\/\.|\$|€/gi, '')
      .replace(/\s/g, '')
      .replace(/,/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }

  function formatPanamaNumber(value, decimals = 2) {
    return Number(value || 0).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function formatProjectMoney(value, decimals = 2) {
    return `${projectCurrencySymbol()} ${formatPanamaNumber(value, decimals)}`;
  }

  function updateCurrencyControlMeta() {
    if (!projectCurrencySel) return;
    const meta = PROJECT_CURRENCIES[normalizeProjectCurrency(projectCurrencySel.value)];
    projectCurrencySel.title = meta.label;
    projectCurrencySel.closest('.currency-picker')?.setAttribute('title', meta.label);
  }

  async function refreshSummaryFromServer() {
    if (typeof loadSummary === 'function') {
      await loadSummary();
      __summaryDirty = false;
      return;
    }

    const payload = await API.get(`/api/projects/${id}/summary?ts=${Date.now()}`);
    window.__LAST_SUMMARY_PAYLOAD__ = payload;
    if (typeof renderSummaryUI === 'function') await renderSummaryUI(payload);
    if (typeof renderResumen === 'function') await renderResumen(payload);
    if (typeof renderSummary === 'function') await renderSummary(payload);
    __summaryDirty = false;
  }

  async function markProjectDataChanged({ refreshSummary = false, refreshHeader = true } = {}) {
    __summaryDirty = true;

    try {
      if (refreshHeader && typeof refreshTopHeaderKpis === 'function') {
        await refreshTopHeaderKpis();
      }

      const resumenActive = !!panes.resumen?.classList.contains('active');
      if (refreshSummary || resumenActive) {
        await refreshSummaryFromServer();
      }
    } catch (e) {
      console.warn('[Project] No se pudo refrescar el resumen tras guardar cambios', e);
    }
  }

  function activateTab(key){
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === key));
    Object.entries(panes).forEach(([k,el]) => el && el.classList.toggle('active', k === key));
    if (key === 'docs' && window.__docsModuleReady && typeof loadDocs === 'function') {
      invalidateProjectDocsCache();
      loadDocs({ q: (document.getElementById('docsSearch')?.value || '') }).catch(e => {
        console.warn('[Docs] No se pudo refrescar al abrir la pestana', e);
      });
    }
    if (key === 'resumen' && __summaryDirty) {
      refreshSummaryFromServer().catch(e => {
        console.warn('[Summary] No se pudo refrescar al abrir la pestana resumen', e);
      });
    }
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

  setTimeout(() => bindDatoUnicoImportControls(), 0);

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
        await markProjectDataChanged({ refreshSummary: true });
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
  await markProjectDataChanged({ refreshSummary: true });

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
  card.style.width = 'min(1380px, 96vw)';
  card.style.maxHeight = '94vh';
  card.style.display = 'flex';
  card.style.flexDirection = 'column';
  card.style.overflow = 'hidden';
}
if (modalBody) {
  modalBody.style.flex = '1 1 auto';
  modalBody.style.padding = '18px 22px 28px';
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

function secureDocUrl(docId) {
  return docId ? `/api/documents/${encodeURIComponent(docId)}/download` : '';
}

async function fetchSecureBlob(url) {
  const resp = await fetch(url, {
    headers: { ...authHeaders(), ...tenantHeaders() },
    credentials: 'include'
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(txt || `HTTP ${resp.status}`);
  }

  return resp.blob();
}

async function openSecureFile(url, filename, action = 'view') {
  if (!url) return;

  const blob = await fetchSecureBlob(url);
  const objectUrl = URL.createObjectURL(blob);

  if (action === 'download') {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename || 'documento';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return;
  }

  window.open(objectUrl, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60 * 1000);
}

async function hydrateSecureImages(root = document) {
  const imgs = Array.from(root.querySelectorAll('img[data-secure-src]'));

  await Promise.all(imgs.map(async (img) => {
    const url = img.dataset.secureSrc;
    if (!url || img.dataset.secureLoaded === '1') return;

    try {
      const blob = await fetchSecureBlob(url);
      const objectUrl = URL.createObjectURL(blob);
      img.src = objectUrl;
      img.dataset.secureLoaded = '1';
      img.dataset.objectUrl = objectUrl;
    } catch (err) {
      console.error('[secure image]', err);
      img.alt = 'No se pudo cargar la imagen';
    }
  }));
}

document.addEventListener('click', (ev) => {
  const link = ev.target.closest('.js-secure-file');
  if (!link) return;

  ev.preventDefault();
  openSecureFile(link.dataset.url, link.dataset.filename, link.dataset.action || 'view')
    .catch(err => {
      console.error('[secure file]', err);
      alert('No se pudo abrir el documento.');
    });
});


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
        <a class="btn btn-ghost btn-xs js-secure-file" href="#" data-url="${secureDocUrl(d._id)}" data-filename="${escapeHtml(d.originalname || d.name || 'documento')}" data-action="view">Ver</a>
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
      if (typeof invalidateProjectDocsCache === 'function') invalidateProjectDocsCache();
      await reloadProyecto(false);
      await refreshDocsListInModal(clId);
      if (document.getElementById('tab-docs')?.classList.contains('active') && typeof loadDocs === 'function') {
        await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
      }
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
    await markProjectDataChanged({ refreshSummary: true });
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

let __commercialUnitsForPermits = [];

function __normTxt(v) {
  return String(v || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isConstructionPermit(it) {
  const title = __normTxt(it?.title || '');
  const type  = __normTxt(it?.type || '');
  const code  = __normTxt(it?.code || '');

  return (
    title === 'permiso de construccion - municipio' ||
    title === 'permiso de construccion' ||
    type === 'permiso de construccion' ||
    code === 'permiso_construccion' ||
    code === 'permiso-de-construccion'
  );
}

function isOccupationPermit(it) {
  const title = __normTxt(it?.title || '');
  const type  = __normTxt(it?.type || '');
  const code  = __normTxt(it?.code || '');

  return (
    title === 'permiso de ocupacion - municipio' ||
    title === 'permiso de ocupacion' ||
    type === 'permiso de ocupacion' ||
    code === 'permiso_ocupacion' ||
    code === 'permiso-de-ocupacion'
  );
}

function commercialUnitName(u) {
  return u.nombre || u.name || u.codigo || u.code || u.numero || u.unitNumber || u.lote || u._id || 'Unidad';
}

function getCommercialPermitData(u, kind) {
  const isCons = kind === 'construction';
  const venta = u.__venta || {};

  const number = isCons
    ? (venta.permisoConstruccionNum || '')
    : (venta.permisoOcupacionNum || '');

  const approved = !!String(number || '').trim();

  return {
    number: number || '—',
    status: approved ? 'approved' : 'pending',
    label: approved ? 'Aprobado' : 'Pendiente'
  };
}

async function apiCommercialUnitsForPermits() {
  let units = [];
  let ventas = [];

  try {
    units = await API.get(`/api/units?projectId=${id}`);
  } catch (e) {
    console.error('[Permits] units error', e);
    units = [];
  }

  try {
    ventas = await API.get(`/api/ventas?projectId=${id}`);
  } catch (e) {
    console.error('[Permits] ventas error', e);
    ventas = [];
  }

  const ventasByUnit = new Map(
    (ventas || []).map(v => [String(v.unitId), v])
  );

  return (units || []).map(u => ({
    ...u,
    __venta: ventasByUnit.get(String(u._id)) || {}
  }));
}

function buildAggregatedPermitSummary(kind) {
  const units = __commercialUnitsForPermits || [];
  const rows = units.map(u => ({
    unit: commercialUnitName(u),
    ...getCommercialPermitData(u, kind)
  }));

  const total = rows.length;
  const approved = rows.filter(r => r.status === 'approved').length;

  return {
    total,
    approved,
    status: total > 0 && approved === total ? 'approved' : 'pending',
    label: total > 0 && approved === total ? 'Aprobado' : 'Pendiente',
    rows
  };
}

async function renderPermitsModal() {
  try {
    __commercialUnitsForPermits = await apiCommercialUnitsForPermits();
  } catch (e) {
    console.error('[Commercial units permits]', e);
    __commercialUnitsForPermits = [];
  }

  const idx = buildIndexByCode(__permits.items);
  const { groups, order } = groupByPhase(__permits.items);

  (__permits.items || []).forEach(it => {
    if (isConstructionPermit(it)) {
      it.__aggregate = buildAggregatedPermitSummary('construction');
      it.__computedStatus = it.__aggregate.status;
    }

    if (isOccupationPermit(it)) {
      it.__aggregate = buildAggregatedPermitSummary('occupation');
      it.__computedStatus = it.__aggregate.status;
    }
  });

  const pct = permitProgress({
    ...__permits,
    items: (__permits.items || []).map(it => ({
      ...it,
      status: it.__computedStatus || it.status
    }))
  });

  const head = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
      <div style="min-width:140px;">Progreso:</div>
      <div class="progress" style="flex:1"><div style="width:${pct}%;"></div></div>
      <div style="min-width:70px;text-align:right;"><b>${pct}%</b></div>
    </div>

    <div class="small muted">Plantilla: v${__permits?.templateVersion || 1}</div>

    <div class="small muted" style="margin-top:6px;">
      Los permisos de construcción y ocupación se calculan automáticamente desde la pestaña Comercial.
    </div>

    <hr style="margin:10px 0;">

    <div class="row" style="gap:8px; align-items:center; margin:4px 0 12px 0;">
      <button class="btn btn-ghost btn-xs" id="permAddFromTpl">+ Agregar trámites de una plantilla…</button>
      <div id="permAddBox" class="small muted"></div>
    </div>
  `;

  const permPhaseProgress = (list) => {
    const valid = (list || []).filter(i => i.status !== 'waived');
    const tot = valid.length;
    const done = valid.filter(i => (i.__computedStatus || i.status) === 'approved').length;
    const pct = tot ? Math.round((done / tot) * 100) : 0;
    return { pct, done, tot };
  };

  const accordions = order.map(phase => {
    const list = groups[phase] || [];
    const phasePctObj = permPhaseProgress(list);
    const phasePct = Number(phasePctObj.pct || 0);

    const rows = list.map(it => {
      const isAggregated = !!it.__aggregate;
      const aggregate = it.__aggregate;

      if (isAggregated) {
        const reqs = (it.requirements || []).map(r => `<li>${r}</li>`).join('');
        const obs = (it.observations || []).map(r => `<li>${r}</li>`).join('');

        const docsViewer = `
          <div class="small" id="permDocs-${it.code}">
            <div class="muted">Cargando documentos…</div>
          </div>
        `;

        const aggRows = aggregate.rows.map(r => `
          <tr>
            <td class="small">${r.unit}</td>
            <td class="small">${r.number}</td>
            <td class="small">
              <span class="badge ${r.status === 'approved' ? 'ok' : ''}">
                ${r.label}
              </span>
            </td>
          </tr>
        `).join('');

        return `
          <tr class="perm-main-row" data-code="${it.code}">
            <td style="white-space:nowrap">
              <select class="perm-state" disabled>
                ${PERMIT_STATES.map(s => `
                  <option value="${s}" ${aggregate.status === s ? 'selected' : ''}>
                    ${PERMIT_LABEL[s]}
                  </option>
                `).join('')}
              </select>
            </td>

            <td>
              <b>${it.title || it.code}</b><br/>
              <span class="small muted">${it.institution || ''}</span>
              <div class="small muted" style="margin-top:4px;">
                ${aggregate.approved} / ${aggregate.total} permisos aprobados
              </div>
            </td>

            <td class="small">
              ${it.slaDays ? (it.slaDays + ' días hábiles') : '—'}
            </td>

            <td class="small">
              <button type="button" class="perm-see-btn js-toggle-perm-details" data-code="${it.code}">
                Ver detalles
              </button>
            </td>

            <td class="small">
              <button class="btn btn-ghost btn-xs js-perm-docs" data-code="${it.code}">📎 Adjuntar</button>
            </td>
          </tr>

          <tr class="perm-extra-row" data-extra-code="${it.code}">
            <td colspan="5">
              <div class="perm-details-box">
                ${reqs ? `
                  <div>
                    <b>Requisitos</b>
                    <ul>${reqs}</ul>
                  </div>
                ` : ''}

                ${obs ? `
                  <div style="margin-top:14px;">
                    <b>Observaciones</b>
                    <ul>${obs}</ul>
                  </div>
                ` : ''}

                <div style="margin-top:14px;">
                  <b>Resumen por unidad comercial</b>
                  <div class="small muted" style="margin:4px 0 8px;">
                    Información alimentada automáticamente desde Comercial.
                  </div>

                  <div class="table-wrap">
                    <table class="table compact">
                      <thead>
                        <tr>
                          <th>Unidad comercial</th>
                          <th>Nº permiso</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${aggRows || `<tr><td colspan="3" class="small muted">No hay unidades comerciales registradas.</td></tr>`}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div style="margin-top:14px;"><b>Documentos adjuntos</b></div>
                ${docsViewer}
              </div>
            </td>
          </tr>
        `;
      }

      const unlocked = isUnlocked(it, idx);
      const lockedBadge = unlocked ? '' :
        `<span class="badge" title="Debes completar: ${(it.dependencies || []).join(', ')}">🔒 Bloqueado</span>`;

      const sel = `
        <select class="perm-state" data-code="${it.code}" ${unlocked ? '' : 'disabled'}>
          ${PERMIT_STATES.map(s => `<option value="${s}" ${it.status === s ? 'selected' : ''}>${PERMIT_LABEL[s]}</option>`).join('')}
        </select>
      `;

      const reqs = (it.requirements || []).map(r => `<li>${r}</li>`).join('');
      const obs = (it.observations || []).map(r => `<li>${r}</li>`).join('');

      const depsHtml = (it.dependencies || []).length ? `
        <div class="small muted">Depende de: ${(it.dependencies || []).map(c => {
          const dep = idx[c];
          return dep ? (dep.title || c) : c;
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
        <tr class="perm-main-row" data-code="${it.code}">
          <td style="white-space:nowrap">${sel}${lockedBadge}</td>

          <td>
            <b>${it.title || it.code}</b><br/>
            <span class="small muted">${it.institution || ''}</span>
            ${depsHtml}
          </td>

          <td class="small">${it.slaDays ? (it.slaDays + ' días hábiles') : '—'}</td>

          <td class="small">
            <button type="button" class="perm-see-btn js-toggle-perm-details" data-code="${it.code}">
              Ver detalles
            </button>
          </td>

          <td class="small">
            <button class="btn btn-ghost btn-xs js-perm-docs" data-code="${it.code}">📎 Adjuntar</button>
            ${unlockBtn}
          </td>
        </tr>

        <tr class="perm-extra-row" data-extra-code="${it.code}">
          <td colspan="5">
            <div class="perm-details-box">
              ${reqs ? `<div><b>Requisitos</b><ul>${reqs}</ul></div>` : ''}
              ${obs ? `<div style="margin-top:14px;"><b>Observaciones</b><ul>${obs}</ul></div>` : ''}
              ${(!reqs && !obs) ? `<div class="small muted">Sin requisitos / observaciones.</div>` : ''}

              <div style="margin-top:14px;"><b>Documentos adjuntos</b></div>
              ${docsViewer}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <section class="phase-card permits-phase-card" data-phase="${phase}">
        <header class="row permits-phase-header">
          <div style="font-weight:700;">${phase}</div>
          <div class="progress small" style="flex:1;background:#ffffff22;">
            <div style="width:${phasePct}%; background:#22c55e;"></div>
          </div>
          <div><b>${phasePct}%</b></div>
        </header>

        <div class="table-wrap permits-table-wrap">
          <table class="table dark">
            <thead>
              <tr>
                <th>Estado</th>
                <th>Trámite</th>
                <th>Tiempo</th>
                <th>Detalles</th>
                <th>Docs</th>
              </tr>
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

  const fmt = (n) => (typeof n === 'number' ? (Math.round(n / 1024)) + ' KB' : '—');

  async function fetchDocsFor(code) {
    const host = modalBody.querySelector(`#permDocs-${CSS.escape(code)}`);
    if (!host) return;

    host.innerHTML = '<div class="small muted">Cargando…</div>';

    try {
      let url = `/api/documents?projectId=${id}&category=permits&permitCode=${encodeURIComponent(code)}&ts=${Date.now()}`;
      let res = await fetch(url, { headers: { ...authHeaders(), ...tenantHeaders() } });
      let docs;

      if (res.ok) {
        docs = await res.json();
      } else {
        url = `/api/documents?projectId=${id}&category=permits&ts=${Date.now()}`;
        res = await fetch(url, { headers: { ...authHeaders(), ...tenantHeaders() } });
        docs = res.ok ? await res.json() : [];

        const rx = new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        docs = (docs || []).filter(d => rx.test(d.title || '') || rx.test(d.originalname || ''));
      }

      if (!Array.isArray(docs) || !docs.length) {
        host.innerHTML = '<div class="small muted">Sin documentos para este trámite.</div>';
        return;
      }

      host.innerHTML = `
        <div class="table-wrap">
          <table class="table compact">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Tamaño</th>
                <th>Subido</th>
                <th>Caduca</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${docs.map(d => `
                <tr data-id="${d._id}">
                  <td class="small">${d.originalname || d.filename || 'Documento'}</td>
                  <td class="small">${d.mimetype || '—'}</td>
                  <td class="small">${fmt(d.size)}</td>
                  <td class="small">${d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '—'}</td>
                  <td class="small">${d.expiryDate ? new Date(d.expiryDate).toLocaleDateString() : '—'}</td>
                  <td class="small" style="white-space:nowrap;">
                    <a class="btn btn-light btn-xs js-secure-file" href="#" data-url="${secureDocUrl(d._id)}" data-filename="${escapeHtml(d.originalname || d.filename || 'documento')}" data-action="view">Ver</a>
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

  (__permits.items || []).forEach(it => fetchDocsFor(it.code));

  document.querySelectorAll('.js-toggle-perm-details').forEach(btn => {
  btn.onclick = () => {
    const code = btn.dataset.code;

    const row = document.querySelector(`tr[data-code="${CSS.escape(code)}"]`);
    const extra = document.querySelector(`tr[data-extra-code="${CSS.escape(code)}"]`);

    if (!extra || !row) return;

    const open = extra.classList.toggle('is-open');

    row.classList.toggle('is-open', open);
    btn.classList.toggle('open', open);
  };
});

  modalBody.querySelectorAll('select.perm-state[data-code]').forEach(sel => {
    sel.onchange = async () => {
      const code = sel.dataset.code;
      const status = sel.value;

      try {
        await apiPermitsPatchItem(code, { status });
        __permits = await apiPermitsGetProject(true);
        renderPermitsModal();
        updatePermitsByInstitutionChart();
        await markProjectDataChanged({ refreshSummary: true });
      } catch (e) {
        console.error(e);
        alert('No se pudo actualizar el estado.');
      }
    };
  });

  modalBody.querySelectorAll('.js-unlock').forEach(btn => {
    btn.onclick = () => {
      const code = btn.dataset.code;
      if (!confirm('¿Desbloquear este trámite manualmente para trabajar en paralelo?')) return;
      __permitsUnlockOverrides.add(code);
      renderPermitsModal();
    };
  });

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
        fd.append('permitCode', code);

        if (expiry) fd.append('expiryDate', expiry);

        try {
          const headers = { ...authHeaders(), ...tenantHeaders() };

          const resp = await fetch('/api/documents/upload', {
            method: 'POST',
            body: fd,
            headers,
            credentials: 'include'
          });

          const data = await resp.json().catch(() => ({}));

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
            <a class="btn btn-ghost btn-xs js-secure-file" href="#" data-url="${secureDocUrl(d._id)}" data-filename="${escapeHtml(d.originalname || d.name || 'documento')}" data-action="view">Ver</a>
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
                  <a class="btn btn-light btn-xs js-secure-file" href="#" data-url="${secureDocUrl(d._id)}" data-filename="${escapeHtml(d.originalname || d.filename || 'documento')}" data-action="view">Ver</a>
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
    activateTab('resumen');
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
    activateTab('proyecto');
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
  const loanApproved   = project.loanApproved   ?? kpis.loan?.approved   ?? 0;
  const loanDisbursed  = project.loanDisbursed  ?? kpis.loan?.disbursed  ?? 0;
  const budgetApproved = project.budgetApproved ?? 0;            // si no lo llevas en kpis, quedará 0
  const budgetSpent    = project.budgetSpent    ?? project.expense ?? 0;

  const tiles = [
    { key:'loan-approved',   label:'Loan aprobado',     value: formatProjectMoney(loanApproved) },
    { key:'disbursed',       label:'Desembolsado',      value: formatProjectMoney(loanDisbursed) },
    { key:'budget-approved', label:'Budget aprobado',   value: formatProjectMoney(budgetApproved) },
    { key:'expense', label:'Gasto', value: formatProjectMoney(window.FINANCE_KPIS?.real?.uses ?? budgetSpent ?? 0) },
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
    grid.innerHTML = arr.map(it=>{
      const src = secureDocUrl(it._id);
      const title = it.label || 'Foto';
      const downloadUrl = src;

      return `
      <figure class="ba-card">
        <button
          type="button"
          class="ba-photo-btn js-ba-open"
          data-src="${escapeHtml(src)}"
          data-title="${escapeHtml(title)}"
          data-download="${escapeHtml(downloadUrl)}"
          aria-label="Ver imagen en grande"
        >
          <img src="" data-secure-src="${escapeHtml(src)}" alt="${escapeHtml(title)}" style="width:100%;height:180px;object-fit:cover;border-radius:10px"/>
        </button>
        <figcaption class="small" style="margin-top:6px">${escapeHtml(title)}</figcaption>
        <div class="row space-between small muted">
          <span>${getTag(it)}</span>
          <button class="btn btn-ghost btn-xs js-ba-delete" data-id="${it._id}">Eliminar</button>
        </div>
      </figure>
    `;
    }).join('');
    hydrateSecureImages(grid);
  };

  paint(before, 'baBeforeGrid');
  paint(after,  'baAfterGrid');
}

// --- 2) Helper que SÍ lee la fuente real
function ensureBAImageViewer(){
  let viewer = document.getElementById('baImageViewer');
  if (viewer) return viewer;

  viewer = document.createElement('div');
  viewer.id = 'baImageViewer';
  viewer.className = 'ba-viewer';
  viewer.innerHTML = `
    <div class="ba-viewer-dialog" role="dialog" aria-modal="true" aria-label="Vista ampliada de imagen">
      <div class="ba-viewer-head">
        <b id="baViewerTitle">Foto</b>
        <div class="ba-viewer-actions">
          <a id="baViewerDownload" class="btn btn-primary btn-xs" href="#" download>Descargar</a>
          <button type="button" class="btn btn-ghost btn-xs" data-ba-viewer-close aria-label="Cerrar">X</button>
        </div>
      </div>
      <div class="ba-viewer-body">
        <img id="baViewerImg" src="" alt="" />
      </div>
    </div>
  `;
  document.body.appendChild(viewer);
  return viewer;
}

function closeBAImageViewer(){
  const viewer = document.getElementById('baImageViewer');
  if (!viewer) return;
  viewer.classList.remove('is-open');
  document.body.classList.remove('ba-viewer-open');
}

async function openBAImageViewer(src, title, downloadUrl){
  const viewer = ensureBAImageViewer();
  const img = viewer.querySelector('#baViewerImg');
  const titleEl = viewer.querySelector('#baViewerTitle');
  const downloadEl = viewer.querySelector('#baViewerDownload');

  if (img) {
    img.src = '';
    img.alt = title || 'Foto';
    try {
      const blob = await fetchSecureBlob(src);
      const objectUrl = URL.createObjectURL(blob);
      if (img.dataset.objectUrl) URL.revokeObjectURL(img.dataset.objectUrl);
      img.src = objectUrl;
      img.dataset.objectUrl = objectUrl;
    } catch (err) {
      console.error('[BA viewer image]', err);
      alert('No se pudo cargar la imagen.');
    }
  }
  if (titleEl) titleEl.textContent = title || 'Foto';
  if (downloadEl) {
    downloadEl.href = downloadUrl || src;
    downloadEl.setAttribute('download', '');
  }

  viewer.classList.add('is-open');
  document.body.classList.add('ba-viewer-open');
}

async function downloadBAImage(url, filename){
  if (!url) return;

  const resp = await fetch(url, {
    headers: { ...authHeaders(), ...tenantHeaders() },
    credentials: 'include'
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(txt || `HTTP ${resp.status}`);
  }

  const blob = await resp.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename || 'foto';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

(function bindBAImageViewerOnce(){
  if (window.__BA_VIEWER_BOUND__) return;
  window.__BA_VIEWER_BOUND__ = true;

  document.addEventListener('click', (e) => {
    const download = e.target.closest('#baViewerDownload');
    if (download) {
      e.preventDefault();
      const title = document.getElementById('baViewerTitle')?.textContent?.trim() || 'foto';
      downloadBAImage(download.href, title).catch(err => {
        console.error('[BA download]', err);
        alert('No se pudo descargar la imagen.');
      });
      return;
    }

    const opener = e.target.closest('.js-ba-open');
    if (opener) {
      e.preventDefault();
      openBAImageViewer(opener.dataset.src, opener.dataset.title, opener.dataset.download);
      return;
    }

    if (e.target.closest('[data-ba-viewer-close]') || e.target.id === 'baImageViewer') {
      closeBAImageViewer();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeBAImageViewer();
  });
})();

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
    const getUrl = (d) => d?._id ? secureDocUrl(d._id) : (d?.url || d?.fileUrl || d?.downloadUrl || d?.href || null);

    // Filtra SOLO imágenes y ordénalas por fecha
    const imgDocs = (docs || [])
      .filter(d => String(d?.mimetype || d?.contentType || '').startsWith('image/'))
      .slice()
      .sort((a,b) => new Date(a.createdAt || a.updatedAt || 0) - new Date(b.createdAt || b.updatedAt || 0));

    // ✅ MODO SEGURO: exporta todas las fotos en orden (sin depender de side)
    window.__BEFORE_AFTER__ = imgDocs
      .map(d => ({
        src: toAbs(getUrl(d)),
        createdAt: d.createdAt || d.updatedAt || null
      }))
      .filter(d => d.src);

    console.log('[BA] docs total:', docs.length);
    console.log('[BA] imgDocs:', imgDocs.length);
    console.log('[BA] export list len:', window.__BEFORE_AFTER__.length);
    console.log('[BA] first:', window.__BEFORE_AFTER__[0]);

    // 3) En informe de periodo, mostrar solo evidencia subida en ese intervalo.
    const activePeriod = window.__ACTIVE_SUMMARY_PERIOD__;
    const visibleDocs = activePeriod
      ? docs.filter(d => {
          const rawDate = d.createdAt || d.updatedAt;
          if (!rawDate) return false;
          const time = new Date(rawDate).getTime();
          const start = new Date(`${activePeriod.from}T00:00:00.000Z`).getTime();
          const end = new Date(`${activePeriod.to}T23:59:59.999Z`).getTime();
          return Number.isFinite(time) && time >= start && time <= end;
        })
      : docs;
    renderBeforeAfter(visibleDocs);

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

function formatNum(v) {
  const n = Number(v || 0);
  return n.toLocaleString('en-US');
}

function formatMoney(v) {
  return formatProjectMoney(v);
}

function formatMoneyCompact(v) {
  return formatProjectMoney(v);
}

function isSummarySoldUnit(u) {
  const estado = normalizeUnitEstadoFrontend(u?.estado || u?.status || '');

  return [
    'con_cpp',
    'tramite_legal_activado',
    'escriturado_traspasado',
    'vivienda_entregada'
  ].includes(estado);
}

function isSummaryActiveCpp(v) {
  const hasCpp =
    String(v?.estatusCPP || '').toLowerCase().includes('cpp') ||
    String(v?.statusBanco || '').toLowerCase().includes('cpp') ||
    String(v?.numCPP || '').trim();

  if (!hasCpp) return false;

  const exp = v?.fechaVencimientoCPP || v?.vencimientoCPPBnMivi;
  if (!exp) return true;

  const d = new Date(exp);
  if (isNaN(d.getTime())) return false;

  d.setHours(23, 59, 59, 999);
  return d.getTime() >= Date.now();
}

function calcTotal(arr, key = 'count') {
  return (arr || []).reduce((acc, x) => acc + Number(x?.[key] || 0), 0);
}

function renderChartSummary(containerId, items, {
  labelKey = 'label',
  valueKey = 'value',
  totalLabel = 'Total',
  formatter = formatNum
} = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const total = (items || []).reduce((acc, x) => acc + Number(x?.[valueKey] || 0), 0);

  if (!items || !items.length) {
    el.innerHTML = `<div class="small muted">Sin datos</div>`;
    return;
  }

  el.innerHTML = `
    <div class="summary-mini-box">
      ${(items || []).map(item => `
        <div class="summary-mini-row">
          <span class="summary-mini-label">${item[labelKey] ?? '—'}</span>
          <span class="summary-mini-value">${formatter(item[valueKey], item)}</span>
        </div>
      `).join('')}
      <div class="summary-mini-row summary-mini-total">
        <span class="summary-mini-label">${totalLabel}</span>
        <span class="summary-mini-value">${formatter(total)}</span>
      </div>
    </div>
  `;
}

function renderFinancePhaseSummary(phases = []) {
  const el = document.getElementById('sumPhaseChartSummary');
  if (!el) return;

  el.closest('.summary-chart-card')?.classList.add('summary-phase-card');

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const sum = (items) => (items || []).reduce((acc, item) => acc + parsePanamaNumber(item?.amount || 0), 0);
  const money = (amount) => formatMoney(amount);

  const rows = (items) => {
    const data = Array.isArray(items) ? items : [];
    if (!data.length) return `<div class="summary-phase-line"><span>Sin partidas</span><strong>${money(0)}</strong></div>`;
    return data.map(item => `
      <div class="summary-phase-line">
        <span>${escapeHtml(item?.name || 'Partida')}</span>
        <strong>${money(item?.amount)}</strong>
      </div>
    `).join('');
  };

  const group = (title, items) => `
    <div class="summary-phase-group">
      <div class="summary-phase-group-title">${title}</div>
      ${rows(items)}
      <div class="summary-phase-line summary-phase-total">
        <span>Total</span>
        <strong>${money(sum(items))}</strong>
      </div>
    </div>
  `;

  if (!Array.isArray(phases) || !phases.length) {
    el.innerHTML = '<div class="small muted">Sin fases financieras registradas</div>';
    return;
  }

  el.innerHTML = phases.map((phase) => `
    <section class="summary-phase-item">
      <div class="summary-phase-title">${escapeHtml(phase?.name || phase?.title || phase?.phase || 'Fase')}</div>
      <div class="summary-phase-columns">
        ${group('Usos estimados', phase?.planUses)}
        ${group('Fuentes estimadas', phase?.planSources)}
        ${group('Usos reales', phase?.uses)}
        ${group('Fuentes reales', phase?.sources)}
      </div>
    </section>
  `).join('');
}

function renderMiniKpiBox(containerId, rows = []) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!rows.length) {
    el.innerHTML = `<div class="small muted">Sin resumen disponible</div>`;
    return;
  }

  el.innerHTML = `
    <div class="summary-resume-box">
      ${rows.map(r => `
        <div class="summary-resume-item ${r.className || ''}">
          <div class="summary-resume-title">${r.title}</div>
          <div class="summary-resume-value">${r.value}</div>
          ${r.sub ? `<div class="summary-resume-sub">${r.sub}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

async function renderSummaryUI(payload) {
  // 1) Datos base
  const project = payload.project || {};
  currentProjectCurrency = normalizeProjectCurrency(project.currency || currentProjectCurrency);
  if (projectCurrencySel) {
    projectCurrencySel.value = currentProjectCurrency;
    updateCurrencyControlMeta();
  }
  const headerKpis = payload.headerKpis || {};
  const reportPeriod = payload.reportPeriod || null;
  const isPeriodView = !!reportPeriod;

  // ✅ Cargar permisos reales para que la gráfica salga bien desde el inicio
  try {
    if (!isPeriodView && !__permits?.items?.length) {
      __permits = await apiPermitsGetProject(true);
    }
  } catch (e) {
    console.warn('[Summary] No se pudieron cargar permisos para gráfica', e);
  }

  // 2) Datos de series PRIMERO
  const progressByPhase      = payload.progressByPhase      || [];
  const permitsByInstitution = payload.permitsByInstitution || [];
  const cppByBank            = payload.cppByBank            || [];
  const proformasByBank      = payload.proformasByBank      || [];
  const unitsByStatus        = payload.unitsByStatus        || [];
  const salesMonthly         = payload.salesMonthly         || [];
  const disbursements        = payload.disbursements        || { planCum: [], realCum: [] };
  const mortgagesByBank      = payload.mortgagesByBank      || [];
  const alerts               = payload.alerts               || { expiries: [], notes: [], bySeverity: [] };
  const beforeAfter          = payload.beforeAfter          || [];
  const financePhases        = payload?.finance?.phases     || [];
  const commercial = payload.commercial || {};
  const legal      = payload.legal      || {};
  const technical  = payload.technical  || {};
  const financial  = payload.financial  || {};
  const periodActivity = payload.periodActivity || null;

  // Helpers locales
  const toNum = (v) => {
    const n = parsePanamaNumber(v);
    return Number.isFinite(n) ? n : 0;
  };

  const toStr = (v) => (v === null || v === undefined) ? '' : String(v).trim();

  const monthKey = (m) => {
    const s = toStr(m).replace('/', '-');
    if (/^\d{4}-\d{2}$/.test(s)) return s;
    const mmYYYY = s.match(/^(\d{2})-(\d{4})$/);
    if (mmYYYY) return `${mmYYYY[2]}-${mmYYYY[1]}`;
    return s;
  };

  const sortByMonth = (arr) =>
    (arr || []).slice().sort((a, b) => monthKey(a.month).localeCompare(monthKey(b.month)));

  const uniq = (arr) => Array.from(new Set(arr || []));

  const ctx = (id) => {
    const el = document.getElementById(id);
    return (el && typeof Chart !== 'undefined') ? el.getContext('2d') : null;
  };

  function calcAbsorption3mFromSalesMonthly(salesMonthly) {
    const sm = sortByMonth(salesMonthly).map(x => ({
      month: monthKey(x.month),
      units: toNum(x.units)
    }));

    const last3 = sm.slice(-3);
    if (!last3.length) return 0;

    const sum = last3.reduce((a, x) => a + (x.units || 0), 0);
    const avg = sum / last3.length;
    return Math.round(avg * 10) / 10;
  }

  const summaryChartOpts = (extra = {}) => ({
    responsive: true,
    maintainAspectRatio: false,
    ...extra
  });
  const summaryLegend = (position = 'bottom') => ({
    position,
    labels: {
      boxWidth: 16,
      boxHeight: 10,
      padding: 12,
      font: { size: 13, weight: '600' }
    }
  });

  const renderTargetKpis = (targetId, items) => {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.innerHTML = (items || []).filter(Boolean).map(x =>
      kpiCard(x.title, x.value, x.sub || '')
    ).join('');
  };

  const renderPieLike = (chartKey, canvasId, data, labelKey, valueKey, summaryId, totalLabel, type = 'doughnut') => {
    sumDestroy(chartKey);

    const list = data || [];
    if (ctx(canvasId)) {
      __sumCharts[chartKey] = new Chart(ctx(canvasId), {
        type,
        data: {
          labels: list.map(x => x[labelKey]),
          datasets: [{ data: list.map(x => toNum(x[valueKey])) }]
        },
        options: summaryChartOpts({
          plugins: { legend: summaryLegend() }
        })
      });
    }

    renderChartSummary(
      summaryId,
      list.map(x => ({ label: x[labelKey], value: toNum(x[valueKey]) })),
      { totalLabel }
    );
  };

  const renderBarSimple = (chartKey, canvasId, data, labelKey, valueKey, summaryId, totalLabel, formatter) => {
    sumDestroy(chartKey);

    const list = data || [];
    if (ctx(canvasId)) {
      __sumCharts[chartKey] = new Chart(ctx(canvasId), {
        type: 'bar',
        data: {
          labels: list.map(x => x[labelKey]),
          datasets: [{
            label: totalLabel || 'Total',
            data: list.map(x => toNum(x[valueKey]))
          }]
        },
        options: summaryChartOpts({
          plugins: { legend: { display: false } },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { precision: 0 }
            }
          }
        })
      });
    }

    renderChartSummary(
      summaryId,
      list.map(x => ({ label: x[labelKey], value: toNum(x[valueKey]), ...x })),
      { totalLabel, formatter }
    );
  };

  const summaryTab = document.getElementById('tab-resumen');
  const periodSection = document.getElementById('summaryPeriodActivity');
  if (summaryTab) summaryTab.classList.toggle('is-period-report', isPeriodView);
  if (periodSection) periodSection.hidden = !isPeriodView;

  if (isPeriodView) {
    const projectNameEl = document.getElementById('summaryProjectName');
    const updatedAtEl = document.getElementById('summaryUpdatedAt');
    if (projectNameEl) projectNameEl.textContent = project.name || 'Proyecto';
    if (updatedAtEl) updatedAtEl.textContent = `Avances registrados: ${reportPeriod.from} a ${reportPeriod.to}`;

    const totals = periodActivity?.totals || {};
    renderTargetKpis('summaryPeriodKpis', [
      { title: 'Avances registrados', value: totals.events || 0 },
      { title: 'Ventas formalizadas (contrato)', value: totals.contracts || 0, sub: formatMoney(totals.salesAmount || 0) },
      { title: 'Permisos aprobados', value: totals.permitsApproved || 0, sub: `${totals.permitsSubmitted || 0} presentados` },
      { title: 'Tareas completadas', value: totals.tasksCompleted || 0, sub: `${totals.tasksValidated || 0} validadas` },
      { title: 'CPP emitidos', value: totals.cpp || 0, sub: formatMoney(totals.cppAmount || 0) },
      { title: 'Desembolsos recibidos', value: formatMoney(totals.disbursedAmount || 0) }
    ]);

    const periodComparison = payload.periodComparison || null;
    const comparisonCard = document.getElementById('summaryPeriodCompareCard');
    const salesSeries = periodComparison?.salesSeries || null;
    if (comparisonCard) comparisonCard.hidden = !periodComparison || (!Array.isArray(periodComparison.metrics) || !periodComparison.metrics.length) && !salesSeries;

    // Si backend envío series de ventas, renderizar comparación por mes (preferible)
    if (salesSeries && ctx('sumPeriodComparison')) {
      sumDestroy('periodComparison');
      __sumCharts.periodComparison = new Chart(ctx('sumPeriodComparison'), {
        type: 'line',
        data: {
          labels: salesSeries.labels.map(l => l),
          datasets: [
            { label: 'Periodo actual', data: salesSeries.current.map(n => Number(n)), borderColor: 'rgba(54, 162, 235, 1)', backgroundColor: 'rgba(54, 162, 235, 0.08)', tension: 0.35, fill: false, pointRadius: 3 },
            { label: 'Periodo comparativo', data: salesSeries.previous.map(n => Number(n)), borderColor: 'rgba(220, 53, 69, 1)', backgroundColor: 'rgba(220, 53, 69, 0.08)', tension: 0.35, fill: false, pointRadius: 3 }
          ]
        },
        options: summaryChartOpts({
          plugins: { legend: summaryLegend() },
          scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
        })
      });

      const comparisonSummary = document.getElementById('sumPeriodComparisonSummary');
      if (comparisonSummary) {
        const totalCur = (salesSeries.current || []).reduce((a, b) => a + (Number(b) || 0), 0);
        const totalPrev = (salesSeries.previous || []).reduce((a, b) => a + (Number(b) || 0), 0);
        const diff = totalCur - totalPrev;
        const diffPct = totalPrev ? Math.round((diff / Math.abs(totalPrev)) * 100) : 0;
        const trend = diff > 0 ? `+${formatMoney(diff)} (${diffPct}%)` : diff < 0 ? `${formatMoney(diff)} (${diffPct}%)` : 'Sin cambio';
        const granularity = salesSeries.granularity === 'day' ? 'Días' : 'Meses';

        comparisonSummary.innerHTML = `
          <div class="summary-chart-summary-row"><strong>Periodo actual:</strong> ${periodComparison.period || reportPeriod.label} · ${formatMoney(totalCur)}</div>
          <div class="summary-chart-summary-row"><strong>Periodo comparativo:</strong> ${periodComparison.previousPeriod || 'Mismo periodo del año anterior'} · ${formatMoney(totalPrev)}</div>
          <div class="summary-chart-summary-row"><strong>Variación:</strong> ${trend}</div>
          <div class="summary-chart-summary-row"><strong>Granularidad:</strong> ${granularity}</div>
          <div class="summary-chart-summary-row small muted">Si no se indica comparativo, se usa por defecto el mismo intervalo del año anterior.</div>
        `;
      }

    } else {
      // Fallback: usar métricas agregadas
      if (comparisonCard) comparisonCard.hidden = !periodComparison || !Array.isArray(periodComparison.metrics) || !periodComparison.metrics.length;
      const comparisonItems = (periodComparison?.metrics || []).map(item => ({ label: item.label, current: item.current || 0, previous: item.previous || 0 }));
      if (ctx('sumPeriodComparison') && comparisonItems.length) {
        sumDestroy('periodComparison');
        __sumCharts.periodComparison = new Chart(ctx('sumPeriodComparison'), {
          type: 'bar',
          data: {
            labels: comparisonItems.map(x => x.label),
            datasets: [
              { label: 'Periodo actual', data: comparisonItems.map(x => x.current), backgroundColor: 'rgba(54, 162, 235, 0.8)' },
              { label: 'Periodo comparativo', data: comparisonItems.map(x => x.previous), backgroundColor: 'rgba(153, 102, 255, 0.8)' }
            ]
          },
          options: summaryChartOpts({ plugins: { legend: summaryLegend() }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } })
        });
      }

      const comparisonSummary = document.getElementById('sumPeriodComparisonSummary');
      if (comparisonSummary) {
        const rows = (periodComparison?.metrics || []).map(item => `
          <div class="summary-chart-summary-row"><strong>${item.label}:</strong> ${item.current.toLocaleString()} vs ${item.previous.toLocaleString()}</div>
        `).join('');
        comparisonSummary.innerHTML = rows || '<div class="small muted">No hay datos comparativos disponibles para este periodo.</div>';
      }
    }

    sumDestroy('periodEvents');
    const eventCounts = periodActivity?.counts || [];
    const periodChartCard = document.getElementById('summaryPeriodChartCard');
    // Ocultar 'Hitos por tipo' cuando estamos mostrando series de ventas (no aporta)
    if (periodChartCard) periodChartCard.hidden = !!salesSeries || eventCounts.length === 0;
    if (!salesSeries && ctx('sumPeriodEvents')) {
      __sumCharts.periodEvents = new Chart(ctx('sumPeriodEvents'), {
        type: 'bar',
        data: {
          labels: eventCounts.map(x => x.type),
          datasets: [{ label: 'Avances', data: eventCounts.map(x => toNum(x.count)) }]
        },
        options: summaryChartOpts({
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
        })
      });
    }
    renderChartSummary(
      'sumPeriodEventsSummary',
      eventCounts.map(x => ({ label: x.type, value: toNum(x.count) })),
      { totalLabel: 'Total avances' }
    );

    const timeline = document.getElementById('summaryPeriodTimeline');
    if (timeline) {
      timeline.innerHTML = (periodActivity?.events || []).map(event => `
        <div class="summary-period-row">
          <span>${new Date(event.date).toLocaleDateString()}</span>
          <strong>${event.type}</strong>
          <span>${event.detail || ''}</span>
        </div>
      `).join('') || '<div class="small muted">No hay avances fechados dentro del periodo seleccionado.</div>';
    }

    if (typeof refreshBeforeAfter === 'function') await refreshBeforeAfter();
    addInfoBadges();
    wireInfoTooltips();
    return;
  }

  // 3) Cabecera fija
  const periodUnits = payload.kpis?.units || {};
  const headerKpisFixed = {
    ...headerKpis,
    unitsTotal: isPeriodView ? (periodUnits.total || 0) : (project.unitsTotal ?? headerKpis.unitsTotal ?? 0),
    unitsSold:  isPeriodView ? (periodUnits.sold || 0) : (project.unitsSold  ?? headerKpis.unitsSold  ?? 0),
  };

  if (!isPeriodView) renderHeaderKpis(project, headerKpisFixed);

    // 4) Texto unidades vendidas
  let sold = headerKpisFixed.unitsSold ?? 0;
  let total = headerKpisFixed.unitsTotal ?? 0;
  let pct = total ? Math.round(100 * sold / total) : 0;
  const unitsTxt = document.getElementById('summaryUnits');
  if (unitsTxt) unitsTxt.textContent = `${sold}/${total} unidades vendidas (${pct}%)`;

  // 5) KPIs
  let kpis = payload.kpis || {
    progressPct: Number(payload?.progress?.globalPct || 0),
    units: {
      total: project.unitsTotal || 0,
      available: project.unitsAvailable || 0,
      sold: project.unitsSold || 0,
      escrituradas: project.unitsDeeded || 0
    },
    absorption3m: project.absorption3m || 0,
    avgTicket: project.avgTicket || 0,
    inventoryValue: project.inventoryValue || 0,
    loan: {
      approved: project.loanApproved || 0,
      disbursed: project.loanDisbursed || 0,
      pct: (project.loanApproved
        ? Math.round(100 * (project.loanDisbursed || 0) / project.loanApproved)
        : 0)
    },
    cpp: {
      active: project.cppActive || 0,
      due30: project.cppDue30 || 0,
      due60: project.cppDue60 || 0,
      due90: project.cppDue90 || 0
    },
    permits: {
      approved: project.permitsApproved || 0,
      inProcess: project.permitsInProcess || 0,
      pending: project.permitsPending || 0,
      pct: project.permitsPct || 0
    },
    appraisal: {
      avg: project.appraisalAvg || 0,
      min: project.appraisalMin || 0,
      max: project.appraisalMax || 0
    },
    clientMortgages30d: project.clientMortgages30d || 0,
    delaysByStage: []
  };

    // ✅ FIX SUMMARY: recalcula ventas y CPP activos desde datos reales
  if (!isPeriodView) try {
    const unitsFix = await API.get(`/api/units?projectId=${id}&ts=${Date.now()}`);
    const ventasFix = await API.get(`/api/ventas?projectId=${id}&ts=${Date.now()}`);

    total = Array.isArray(unitsFix) ? unitsFix.length : total;
    sold = (unitsFix || []).filter(isSummarySoldUnit).length;
    pct = total ? Math.round(100 * sold / total) : 0;

    kpis.units = kpis.units || {};
    kpis.units.total = total;
    kpis.units.sold = sold;
    kpis.units.available = Math.max(0, total - sold);

    const cppActive = (ventasFix || []).filter(isSummaryActiveCpp).length;

    kpis.cpp = kpis.cpp || {};
    kpis.cpp.active = cppActive;

  } catch (e) {
    console.warn('[Summary FIX] No se pudo recalcular ventas/CPP', e);
  }

  // ✅ Si no viene absorción, la calculamos desde ventas mensuales
  if (!kpis.absorption3m || Number(kpis.absorption3m) === 0) {
    kpis.absorption3m = calcAbsorption3mFromSalesMonthly(salesMonthly);
  }

  renderPhaseChart(financePhases, 'sumPhaseChart');
  renderPhaseSourceChart(financePhases, 'sumPhaseSourceChart');
  renderFinanceTimeCharts(financePhases, {
    durationCanvasId: 'sumPhaseTimeDurationChart',
    delayCanvasId: 'sumPhaseTimeDelayChart',
    delaySummaryId: 'sumPhaseTimeDelaySummary',
    durationSummaryId: 'sumPhaseTimeDurationSummary',
  });
  renderFinancePhaseLineCharts(financePhases, 'summaryPhaseLineCharts', 'sumPhaseLineChart', {
    lines: financial.creditLines || [],
    summary: true,
  });
  renderFinancePhaseSummary(financePhases);

  // Cabecera textual
  const name = project.name || 'Proyecto';
  const projectNameEl = document.getElementById('summaryProjectName');
  const updatedAtEl = document.getElementById('summaryUpdatedAt');

  if (projectNameEl) projectNameEl.textContent = name;
  if (updatedAtEl) {
    updatedAtEl.textContent = isPeriodView
      ? `Actividad del periodo: ${reportPeriod.from} a ${reportPeriod.to}`
      : 'Actualizado: ' + (new Date(project?.updatedAt || Date.now())).toLocaleString();
  }

  // Tarjetas KPI
  const u = kpis.units || {};
const loan = kpis.loan || {};
let cpp = kpis.cpp || {};
const app = kpis.appraisal || {};

// ✅ FIX: usar la misma fuente que los KPIs globales del proyecto
if (!isPeriodView) try {
  const portfolio = await API.get(`/api/projects/portfolio?ts=${Date.now()}`);
  const me = (portfolio || []).find(p => String(p._id) === String(id));

  if (me) {
    total = Number(me.unitsTotal || 0);
    sold = Number(me.unitsSold || 0);
    pct = total ? Math.round(100 * sold / total) : 0;

    kpis.units = kpis.units || {};
    kpis.units.total = total;
    kpis.units.sold = sold;
    kpis.units.available = Math.max(0, total - sold);
  }
} catch (e) {
  console.warn('[Summary] No se pudo sincronizar ventas con portfolio', e);
}

// ✅ FIX: CPP activos = tienen numCPP y NO están vencidos
if (!isPeriodView) try {
  const ventas = await API.get(`/api/ventas?projectId=${id}&ts=${Date.now()}`);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffDays = (dateValue) => {
    if (!dateValue) return null;
    const d = new Date(dateValue);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  };

  const cppVigentes = (ventas || []).filter(v => {
    const hasCpp = String(v?.numCPP || '').trim();
    const days = diffDays(v?.fechaVencimientoCPP);
    return hasCpp && days !== null && days >= 0;
  });

  cpp = {
    ...cpp,
    active: cppVigentes.length,
    due30: cppVigentes.filter(v => {
      const d = diffDays(v.fechaVencimientoCPP);
      return d >= 0 && d <= 30;
    }).length,
    due60: cppVigentes.filter(v => {
      const d = diffDays(v.fechaVencimientoCPP);
      return d > 30 && d <= 60;
    }).length,
    due90: cppVigentes.filter(v => {
      const d = diffDays(v.fechaVencimientoCPP);
      return d > 60 && d <= 90;
    }).length,
  };

  kpis.cpp = cpp;
} catch (e) {
  console.warn('[Summary] No se pudo recalcular CPP activos', e);
}

  const cards = [
    kpiCard('Progreso global', (kpis.progressPct || 0) + '%'),
    kpiCard('Unidades', `${u.total || 0} totales`, `${u.available || 0} disp · ${u.sold || 0} vend · ${u.escrituradas || 0} escr.`),
    kpiCard('Absorción 3m', (kpis.absorption3m || 0) + ' u/mes'),
    kpiCard('Ticket promedio', formatMoney(kpis.avgTicket || 0)),
    (kpis.inventoryValue ? kpiCard('Inventario a valor', formatMoney(kpis.inventoryValue || 0)) : ''),
    kpiCard('CPP', `${cpp.active || 0} activos`, `30d:${cpp.due30 || 0} · 60d:${cpp.due60 || 0} · 90d:${cpp.due90 || 0}`),
    kpiCard('Permisos', `${kpis.permits?.approved || 0} A / ${kpis.permits?.inProcess || 0} T / ${kpis.permits?.pending || 0} P`, (kpis.permits?.pct || 0) + '%'),
    ((app.avg || app.min || app.max) ? kpiCard('Avalúo promedio', formatMoney(app.avg || 0), `min ${formatMoney(app.min || 0)} · max ${formatMoney(app.max || 0)}`) : ''),
    kpiCard('Hipotecas 30d', kpis.clientMortgages30d || 0)
  ].filter(Boolean);

  const summaryKpisEl = document.getElementById('summaryKpis');
  if (summaryKpisEl) summaryKpisEl.innerHTML = cards.join('');

  const projectTypeLabel = project.projectType || project.tipoProyecto || 'No definido';
  const promoterNames = Array.isArray(project.promoters)
    ? project.promoters.map(p => p?.name || p?.email).filter(Boolean)
    : [];
  const promoterLabel = promoterNames.length
    ? promoterNames.join(', ')
    : (project.promoterName || 'No definido');
  const promoterCompanyLabel =
    project.promoterCompanyName ||
    project.promoterSocietyName ||
    project.legalData?.promoterLegalName ||
    project.legalCompanyName ||
    project.sociedad ||
    project.promoterProfile?.companyName ||
    (Array.isArray(project.promoters)
      ? project.promoters.map(p => p?.promoterProfile?.companyName).find(Boolean)
      : '') ||
    'Sociedad no definida';
  const promoterCategoryLabel = project.promoterCategory || 'No definido';
  const promoterTypeLabel =
    project.promoterType ||
    project.promoterProfile?.promoterType ||
    (Array.isArray(project.promoters)
      ? project.promoters.map(p => p?.promoterType || p?.promoterProfile?.promoterType).find(Boolean)
      : '') ||
    'No definido';

  // Resumen general extra
  renderMiniKpiBox('summaryResumeBox', [
    {
      title: 'Perfil del proyecto',
      value: `Tipo de proyecto: ${projectTypeLabel}`,
      sub: `Sociedad: ${promoterCompanyLabel} · Promotor: ${promoterLabel} · Tipo promotor: ${promoterTypeLabel} · Perfil del promotor: ${promoterCategoryLabel}`,
      className: 'project-profile-kpi'
    },
    {
      title: 'Ventas',
      value: `${sold}/${total}`,
      sub: `${pct}% vendido`
    },
    {
      title: 'CPP activos',
      value: String(cpp.active || 0),
      sub: `30d:${cpp.due30 || 0} · 60d:${cpp.due60 || 0} · 90d:${cpp.due90 || 0}`
    },
    {
      title: 'Hipotecas',
      value: String(calcTotal(mortgagesByBank, 'count')),
      sub: `${mortgagesByBank.length} bancos`
    },
    {
      title: 'Proformas',
      value: String(calcTotal(proformasByBank, 'count')),
      sub: `${proformasByBank.length} bancos`
    }
  ]);

  const legalData = project.legalData || {};
  document.getElementById('summaryLegalDataBox')?.remove();
  const legalRows = [
    ['Promotor/deudor como sociedad legal', legalData.promoterLegalName || project.legalCompanyName || project.sociedad],
    ['Banco interino', legalData.interimBank],
    ['Fideicomiso', legalData.trustApplies ? 'Aplica' : 'No aplica'],
    ['Nombre del fideicomiso', legalData.trustName],
    ['Representantes legales', (legalData.legalRepresentatives || legalData.representantesLegales || []).map(x => x.name || x.nombre || x).filter(Boolean).join(', ')]
  ].filter(([, value]) => String(value || '').trim());
  const boardRows = (legalData.boardMembers || []).map(item =>
    [item.name, item.cedula, item.position].filter(Boolean).join(' - ')
  ).filter(Boolean);
  const shareholderRows = (legalData.shareholders || []).map(item =>
    [item.name, item.cedula, item.percentage ? `${item.percentage}%` : ''].filter(Boolean).join(' - ')
  ).filter(Boolean);
  const legalBox = document.getElementById('summaryLegalProjectData');
  if (legalBox) legalBox.innerHTML = `
    <div class="finance-conditions-subgrid summary-legal-project-data">
      ${legalRows.map(([label, value]) => `<div class="finance-condition-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '---')}</strong></div>`).join('') || '<div class="small muted">Sin datos legales registrados.</div>'}
    </div>
    <div class="charts-grid" style="margin-top:12px;">
      <div class="card summary-chart-card"><h3>Junta directiva</h3><div class="small muted">${boardRows.map(escapeHtml).join('<br>') || 'Sin directivos registrados.'}</div></div>
      <div class="card summary-chart-card"><h3>Accionistas</h3><div class="small muted">${shareholderRows.map(escapeHtml).join('<br>') || 'Sin accionistas registrados.'}</div></div>
    </div>
  `;
  renderMiniKpiBox('summaryFinancialProfile', [
    {
      title: 'Estado del proyecto',
      value: project.status || project.estado || 'No definido',
      sub: `Tipo: ${projectTypeLabel} · Actualizado: ${project?.updatedAt ? new Date(project.updatedAt).toLocaleDateString() : '—'}`
    },
    {
      title: 'Datos del promotor',
      value: promoterLabel,
      sub: `Sociedad: ${promoterCompanyLabel} · Tipo: ${promoterTypeLabel} · Perfil: ${promoterCategoryLabel}`
    }
  ]);

  // Finanzas
  if (!isPeriodView) try {
    const fin = await API.get(`/api/projects/${id}/finance?ts=${Date.now()}`);
    const phases = fin?.finance?.phases || [];
    window.__LAST_SUMMARY_PAYLOAD__ = window.__LAST_SUMMARY_PAYLOAD__ || {};
    window.__LAST_SUMMARY_PAYLOAD__.finance = {
      ...(window.__LAST_SUMMARY_PAYLOAD__.finance || {}),
      phases
    };
    if (phases.length) {
      renderPhaseChart(phases, 'sumPhaseChart');
      renderPhaseSourceChart(phases, 'sumPhaseSourceChart');
      renderFinanceTimeCharts(phases, {
        durationCanvasId: 'sumPhaseTimeDurationChart',
        delayCanvasId: 'sumPhaseTimeDelayChart',
        delaySummaryId: 'sumPhaseTimeDelaySummary',
        durationSummaryId: 'sumPhaseTimeDurationSummary',
      });
      renderFinancePhaseLineCharts(phases, 'summaryPhaseLineCharts', 'sumPhaseLineChart', {
        lines: financial.creditLines || [],
        summary: true,
      });
      renderFinancePhaseSummary(phases);
    } else {
      renderPhaseChart([], 'sumPhaseChart');
      renderPhaseSourceChart([], 'sumPhaseSourceChart');
      renderFinanceTimeCharts([], {
        durationCanvasId: 'sumPhaseTimeDurationChart',
        delayCanvasId: 'sumPhaseTimeDelayChart',
        delaySummaryId: 'sumPhaseTimeDelaySummary',
        durationSummaryId: 'sumPhaseTimeDurationSummary',
      });
      renderFinancePhaseLineCharts([], 'summaryPhaseLineCharts', 'sumPhaseLineChart', {
        lines: financial.creditLines || [],
        summary: true,
      });
      renderFinancePhaseSummary([]);
      console.warn('[Resumen] Finanzas sin fases');
    }
  } catch (e) {
    console.error('[Resumen] Error cargando fases de finanzas', e);
  }

  // Barra progreso global
  const progressPct = Number(kpis?.progressPct || 0);
  const spT = document.getElementById('summaryProgressText');
  const spB = document.getElementById('summaryProgressBar');
  if (spT) spT.textContent = `${progressPct}% completado`;
  if (spB) spB.style.width = `${progressPct}%`;

  // ---------- Progreso por fase ----------
  sumDestroy('p1');
  if (ctx('sumProgressByPhase')) {
    __sumCharts.p1 = new Chart(ctx('sumProgressByPhase'), {
      type: 'bar',
      data: {
        labels: progressByPhase.map(x => x.phase),
        datasets: [{
          label: '% completado',
          data: progressByPhase.map(x => toNum(x.pct))
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 100 } }
      }
    });
  }
  renderChartSummary('sumProgressByPhaseSummary',
    progressByPhase.map(x => ({ label: x.phase, value: toNum(x.pct) })),
    { totalLabel: 'Suma', formatter: (v) => `${v}%` }
  );

  // ---------- Permisos por institución ----------
  sumDestroy('p2');
  if (ctx('sumPermitsByInstitution')) {
    const inst = (!isPeriodView && __permits?.items?.length)
      ? buildPermitsByInstitution(__permits.items)
      : permitsByInstitution;

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
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true }
        }
      }
    });

    renderChartSummary('sumPermitsByInstitutionSummary',
      inst.map(x => ({
        label: x.institution,
        value: toNum(x.pending) + toNum(x.inProcess) + toNum(x.approved) + toNum(x.rejected)
      })),
      { totalLabel: 'Total permisos' }
    );
  }

  // ---------- CPP por banco ----------
  sumDestroy('p3');
  if (ctx('sumCppPie')) {
    __sumCharts.p3 = new Chart(ctx('sumCppPie'), {
      type: 'pie',
      data: {
        labels: cppByBank.map(x => x.bank),
        datasets: [{ data: cppByBank.map(x => toNum(x.count)) }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: summaryLegend()
        }
      }
    });
  }
  renderChartSummary('sumCppPieSummary',
    cppByBank.map(x => ({ label: x.bank, value: toNum(x.count) })),
    { totalLabel: 'Total CPP' }
  );

  // ---------- Proformas por banco ----------
  sumDestroy('p4');
  const pfLabels = proformasByBank.map(x => x.bank);
  const pfData = proformasByBank.map(x => toNum(x.count));

  const pfTotal = pfData.reduce((a, v) => a + (Number(v) || 0), 0);
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
        maintainAspectRatio: false,
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
  renderChartSummary('sumProformasBarSummary',
    proformasByBank.map(x => ({ label: x.bank, value: toNum(x.count) })),
    { totalLabel: 'Total proformas' }
  );

  // ---------- Estado de unidades ----------
  sumDestroy('p5');
  if (ctx('sumUnitsDonut')) {
    __sumCharts.p5 = new Chart(ctx('sumUnitsDonut'), {
      type: 'doughnut',
      data: {
        labels: unitsByStatus.map(x => x.status),
        datasets: [{ data: unitsByStatus.map(x => toNum(x.count)) }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: summaryLegend()
        }
      }
    });
  }
  renderChartSummary('sumUnitsDonutSummary',
    unitsByStatus.map(x => ({ label: x.status, value: toNum(x.count) })),
    { totalLabel: 'Total unidades' }
  );

  // ---------- Ventas mensuales ----------
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
        datasets: [{
          label: 'Unidades',
          data: sm.map(x => x.units),
          tension: .3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true } }
      }
    });

    renderChartSummary('sumSalesMonthlySummary',
      sm.map(x => ({ label: x.month, value: x.units })),
      { totalLabel: 'Total ventas' }
    );
  }

  // ---------- Desembolsos plan vs real ----------
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
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  // ---------- Hipotecas por banco ----------
sumDestroy('p8');
if (ctx('sumMortgagesByBank')) {
  __sumCharts.p8 = new Chart(ctx('sumMortgagesByBank'), {
    type: 'bar',
    data: {
      labels: mortgagesByBank.map(x => x.bank),
      datasets: [{
        label: 'Hipotecas',
        data: mortgagesByBank.map(x => toNum(x.count))
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            label: (context) => {
              const item = mortgagesByBank[context.dataIndex] || {};
              const count = toNum(item.count);
              const amount = toNum(item.amount);
              return ` ${count} hipotecas · ${formatMoneyCompact(amount)}`;
            }
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
renderChartSummary(
  'sumMortgagesByBankSummary',
  mortgagesByBank.map(x => ({
    label: x.bank,
    value: toNum(x.count),
    amount: toNum(x.amount)
  })),
  {
    totalLabel: 'Total hipotecas',
    formatter: (v, item) => {
      const amount = toNum(item?.amount);
      return `${toNum(v)} · ${formatMoneyCompact(amount)}`;
    }
  }
);

  // =========================================================
  // NUEVO RESUMEN COMERCIAL / LEGAL / TÉCNICO / FINANCIERO
  // =========================================================

  // ---------- Comercial: ventas vs caídas ----------
  const commercialFallenSales = (commercial.salesVsFallenByYear || [])
    .reduce((sum, item) => sum + toNum(item.fallen), 0);
  const commercialCppAmount = calcTotal(commercial.cppAmountByBank || [], 'amount');

  renderTargetKpis('summaryCommercialKpis', [
    { title: 'Unidades totales', value: u.total || 0 },
    {
      title: 'Unidades vendidas',
      value: u.sold || 0,
      sub: `${pct}% del inventario`
    },
    { title: 'Unidades disponibles', value: u.available || 0 },
    { title: 'Absorción 3m', value: `${kpis.absorption3m || 0} u/mes` },
    { title: 'Ticket promedio', value: formatMoney(kpis.avgTicket || 0) },
    { title: 'Ventas caídas', value: commercialFallenSales },
    {
      title: 'CPP activos',
      value: cpp.active || 0,
      sub: formatMoney(commercialCppAmount)
    }
  ]);

  sumDestroy('p11');
  const salesVsFallen = commercial.salesVsFallenByYear || [];
  if (ctx('sumSalesVsFallen')) {
    __sumCharts.p11 = new Chart(ctx('sumSalesVsFallen'), {
      type: 'bar',
      data: {
        labels: salesVsFallen.map(x => x.year),
        datasets: [
          { label: 'Ventas', data: salesVsFallen.map(x => toNum(x.sales)), stack: 's' },
          { label: 'Ventas caídas', data: salesVsFallen.map(x => toNum(x.fallen)), stack: 's' }
        ]
      },
      options: summaryChartOpts({
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }
        }
      })
    });
  }
  renderChartSummary(
    'sumSalesVsFallenSummary',
    salesVsFallen.map(x => ({ label: x.year, value: toNum(x.sales), fallen: toNum(x.fallen) })),
    {
      totalLabel: 'Ventas reales',
      formatter: (v, item) => `${toNum(v)} ventas · ${toNum(item?.fallen)} caídas`
    }
  );

  // ---------- Comercial: modelos / perfiles ----------
  renderPieLike('p12', 'sumSalesByModel', commercial.salesByModel || [], 'model', 'count', 'sumSalesByModelSummary', 'Total ventas por modelo', 'pie');
  renderPieLike('p13', 'sumClientProfile', commercial.clientProfile || [], 'profile', 'count', 'sumClientProfileSummary', 'Total perfiles', 'doughnut');
  renderPieLike('p14', 'sumCompanyType', commercial.companyType || [], 'type', 'count', 'sumCompanyTypeSummary', 'Total empresas', 'doughnut');
  renderPieLike('p15', 'sumBankStatus', commercial.bankStatus || [], 'status', 'count', 'sumBankStatusSummary', 'Total estados banco', 'doughnut');

  // ---------- Comercial: montos CPP por banco ----------
  renderBarSimple(
    'p16',
    'sumCppAmountByBank',
    commercial.cppAmountByBank || [],
    'bank',
    'amount',
    'sumCppAmountByBankSummary',
    'Total monto CPP',
    (v, item) => `${formatMoneyCompact(toNum(item?.amount || v))}`
  );

  // ---------- Legal: KPIs ----------
  const lt = legal.totals || {};
  renderTargetKpis('summaryLegalKpis', [
    { title: 'Contratos firmados', value: lt.contratosFirmados || 0 },
    { title: 'Minutas liberación', value: lt.minutasLiberacion || 0 },
    { title: 'Minutas segregación', value: lt.minutasSegregacion || 0 },
    { title: 'Minutas préstamo', value: lt.minutasPrestamo || 0 },
    { title: 'Protocolos cliente', value: lt.protocolosCliente || 0 },
    { title: 'Protocolos banco cliente', value: lt.protocolosBancoCliente || 0 },
    { title: 'Protocolos banco', value: lt.protocolosBanco || 0 },
    { title: 'Escrituras inscritas', value: lt.escriturasInscritas || 0 },
    { title: 'Fincas segregadas', value: lt.fincasSegregadas || 0 }
  ]);

  renderPieLike('p17', 'sumLegalLiberacion', legal.minutasLiberacion || [], 'status', 'count', 'sumLegalLiberacionSummary', 'Total minutas', 'pie');
  renderPieLike('p18', 'sumLegalSegregacion', legal.minutasSegregacion || [], 'status', 'count', 'sumLegalSegregacionSummary', 'Total minutas', 'pie');
  renderPieLike('p19', 'sumLegalPrestamo', legal.minutasPrestamo || [], 'status', 'count', 'sumLegalPrestamoSummary', 'Total minutas', 'pie');

  // ---------- Legal: firma protocolo por banco ----------
  sumDestroy('p20');
  const protocolByBank = legal.protocolByBank || [];
  if (ctx('sumProtocolByBank')) {
    __sumCharts.p20 = new Chart(ctx('sumProtocolByBank'), {
      type: 'bar',
      data: {
        labels: protocolByBank.map(x => x.bank),
        datasets: [
          { label: 'Cliente', data: protocolByBank.map(x => toNum(x.cliente)) },
          { label: 'Banco cliente', data: protocolByBank.map(x => toNum(x.bancoCliente)) },
          { label: 'Banco interino', data: protocolByBank.map(x => toNum(x.bancoInterino)) }
        ]
      },
      options: summaryChartOpts({
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } }
        }
      })
    });
  }
  renderChartSummary(
    'sumProtocolByBankSummary',
    protocolByBank.map(x => ({
      label: x.bank,
      value: toNum(x.cliente) + toNum(x.bancoCliente) + toNum(x.bancoInterino)
    })),
    { totalLabel: 'Total firmas protocolo' }
  );

  // ---------- Técnico: KPIs ----------
  const tt = technical.permitsTotals || {};
  renderTargetKpis('summaryTechnicalKpis', [
    { title: 'Permisos construcción', value: tt.construction || 0 },
    { title: 'Permisos ocupación', value: tt.occupation || 0 },
    { title: 'Fases construcción', value: (technical.constructionPhase || []).length },
    { title: 'Modelos en construcción', value: (technical.modelsInConstruction || []).length }
  ]);

  renderPieLike('p21', 'sumConstructionStatus', technical.constructionStatus || [], 'status', 'count', 'sumConstructionStatusSummary', 'Total estatus', 'doughnut');
  renderBarSimple('p22', 'sumConstructionPhase', technical.constructionPhase || [], 'phase', 'count', 'sumConstructionPhaseSummary', 'Total fases');
  renderPieLike('p23', 'sumModelsInConstruction', technical.modelsInConstruction || [], 'model', 'count', 'sumModelsInConstructionSummary', 'Total modelos', 'pie');
  renderBarSimple('p24', 'sumConstructionProgressRanges', technical.constructionProgressRanges || [], 'range', 'count', 'sumConstructionProgressRangesSummary', 'Total unidades');

  // ---------- Financiero: KPIs ----------
  const fc = financial.cppCoverage || {};
  const financeTotals = financial.totals || {};

  const loanApprovedSummary =
    project.loanApproved ??
    headerKpis.loanApproved ??
    kpis.loan?.approved ??
    0;

  const loanDisbursedSummary =
    financeTotals.disbursed ??
    project.loanDisbursed ??
    headerKpis.loanDisbursed ??
    kpis.loan?.disbursed ??
    0;

  const budgetApprovedSummary =
    project.budgetApproved ??
    headerKpis.budgetApproved ??
    0;

  renderTargetKpis('summaryFinancialKpis', isPeriodView ? [
    {
      title: 'Totales financieros',
      value: 'Sin historico',
      sub: 'No existen movimientos fechados para reconstruir este periodo'
    },
    {
      title: 'CPP del periodo',
      value: formatMoney(fc.cppVigenteAmount || 0),
      sub: `${fc.coverageCppVigentePct || 0}% cobertura sobre datos fechables`
    },
    {
      title: 'CPP en tramite',
      value: `${cpp.active || 0} activos`,
      sub: `30d:${cpp.due30 || 0} - 60d:${cpp.due60 || 0} - 90d:${cpp.due90 || 0}`
    }
  ] : [
    {
      title: 'Loan aprobado',
      value: formatMoney(loanApprovedSummary)
    },
    {
      title: 'Desembolsado',
      value: formatMoney(loanDisbursedSummary)
    },
    {
      title: 'Amortización total',
      value: formatMoney(financeTotals.amortized || 0),
      sub: `${formatMoney(financeTotals.manualAmortized || 0)} manual · ${formatMoney(financeTotals.allocatedAmortized || 0)} ventas`
    },
    {
      title: 'Saldo por pagar',
      value: formatMoney(financeTotals.debt || 0)
    },
    {
      title: 'Budget aprobado',
      value: formatMoney(budgetApprovedSummary)
    },
    {
      title: 'Valor base / cheques',
      value: formatMoney(financeTotals.checkAmountTotal || 0)
    },
    {
      title: 'Total promotor',
      value: formatMoney(financeTotals.promoterTotal || 0)
    },
    {
      title: 'CPP vigente',
      value: formatMoney(fc.cppVigenteAmount || 0),
      sub: `${fc.coverageCppVigentePct || 0}% cobertura`
    },
    {
      title: 'CPP en trámite',
      value: `${cpp.active || 0} activos`,
      sub: `30d:${cpp.due30 || 0} · 60d:${cpp.due60 || 0} · 90d:${cpp.due90 || 0}`
    }
  ]);

  // ---------- Financiero: líneas crédito ----------
  renderMiniKpiBox('summaryFinanceControlCards', [
    {
      title: 'Prestamo promotor',
      value: `Desembolsado: ${formatMoney(financeTotals.disbursed || 0)}`,
      sub: `Saldo por pagar: ${formatMoney(financeTotals.debt || 0)}`
    },
    {
      title: 'Recuperacion del banco',
      value: formatMoney(financeTotals.amortized || 0),
      sub: `Manual: ${formatMoney(financeTotals.manualAmortized || 0)} · Ventas: ${formatMoney(financeTotals.allocatedAmortized || 0)}`
    },
    {
      title: 'Ventas / cheques',
      value: formatMoney(financeTotals.checkAmountTotal || 0),
      sub: `Destinado a promotor: ${formatMoney(financeTotals.promoterTotal || 0)}`
    }
  ]);

  sumDestroy('p25');
  const creditLines = financial.creditLines || [];
  const creditLineLabel = line => line.phaseName ? `${line.phaseName} · ${line.name}` : `Sin fase · ${line.name}`;
  if (ctx('sumCreditLines')) {
    __sumCharts.p25 = new Chart(ctx('sumCreditLines'), {
      type: 'bar',
      data: {
        labels: creditLines.map(creditLineLabel),
        datasets: [
          { label: 'Desembolsado', data: creditLines.map(x => toNum(x.disbursementAmount ?? x.disbursedAmount)) },
          { label: 'Amortizado total', data: creditLines.map(x => toNum(x.totalRecovered ?? x.amortizedAmount)) }
        ]
      },
      options: summaryChartOpts({
        scales: {
          x: { stacked: false },
          y: { stacked: false, beginAtZero: true }
        }
      })
    });
  }
  renderChartSummary(
    'sumCreditLinesSummary',
    creditLines.map(x => ({
      label: creditLineLabel(x),
      value: toNum(x.totalRecovered ?? x.amortizedAmount),
      balance: toNum(x.balanceAfterSales ?? x.debt),
      disbursed: toNum(x.disbursementAmount ?? x.disbursedAmount),
      amortized: toNum(x.totalRecovered ?? x.amortizedAmount)
    })),
    {
      totalLabel: 'Total amortizado',
      formatter: (v, item) => `${formatMoneyCompact(toNum(item?.disbursed))} desemb. - ${formatMoneyCompact(toNum(v))} amort. - ${formatMoneyCompact(toNum(item?.balance))} saldo`
    }
  );

  // ---------- Financiero: cobertura CPP ----------
  sumDestroy('p26');
  const coverageRows = [
    { label: 'Deuda actual', amount: toNum(fc.totalDebt) },
    { label: 'CPP vigentes', amount: toNum(fc.cppVigenteAmount) },
    { label: 'CPP en trámite', amount: toNum(fc.cppTramiteAmount) }
  ];

  if (ctx('sumCppCoverage')) {
    __sumCharts.p26 = new Chart(ctx('sumCppCoverage'), {
      type: 'bar',
      data: {
        labels: coverageRows.map(x => x.label),
        datasets: [{
          label: 'Monto',
          data: coverageRows.map(x => x.amount)
        }]
      },
      options: summaryChartOpts({
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      })
    });
  }
  renderChartSummary(
    'sumCppCoverageSummary',
    coverageRows.map(x => ({ label: x.label, value: x.amount })),
    {
      totalLabel: 'Referencia',
      formatter: (v) => formatMoneyCompact(toNum(v))
    }
  );

  // ---------- Alertas por severidad ----------
  sumDestroy('p9');
  if (ctx('sumAlertsSeverity')) {
    const sev = alerts?.bySeverity || [];
    __sumCharts.p9 = new Chart(ctx('sumAlertsSeverity'), {
      type: 'bar',
      data: {
        labels: sev.map(x => x.severity),
        datasets: [{
          label: 'Alertas',
          data: sev.map(x => toNum(x.count))
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true } }
      }
    });

    renderChartSummary('sumAlertsSeveritySummary',
      sev.map(x => ({ label: x.severity, value: toNum(x.count) })),
      { totalLabel: 'Total alertas' }
    );
  }

  // ---------- Expedientes atrasados por etapa ----------
  sumDestroy('p10');
  if (ctx('sumDelaysByStage')) {
    const d = kpis?.delaysByStage || [];
    __sumCharts.p10 = new Chart(ctx('sumDelaysByStage'), {
      type: 'bar',
      data: {
        labels: d.map(x => x.stage),
        datasets: [{
          label: 'Expedientes atrasados',
          data: d.map(x => toNum(x.count))
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true } }
      }
    });

    renderChartSummary('sumDelaysByStageSummary',
      d.map(x => ({ label: x.stage, value: toNum(x.count) })),
      { totalLabel: 'Total atrasados' }
    );
  }

  // Alertas / conclusiones
  const isActiveDoc = (a) => !a?.status || String(a?.status || '').toUpperCase() === 'ACTIVE';
  const alertsDiv = document.getElementById('summaryAlerts');
  if (alertsDiv) {
    alertsDiv.innerHTML = (alerts?.expiries || []).filter(isActiveDoc)
      .sort((a, b) => new Date(a.due || 0) - new Date(b.due || 0))
      .slice(0, 10)
      .map(a => {
        const due = a.due ? new Date(a.due).toISOString().slice(0, 10) : '—';
        const days = Number(a.daysLeft);
        const daysText = Number.isFinite(days)
          ? days < 0
            ? `Vencido hace ${Math.abs(days)} dias`
            : `Vence en ${days} dias`
          : due;
        const extra = a.balance ? ` · Saldo ${formatMoney(a.balance)}` : '';
        return `<div class="row space-between small" style="padding:8px 10px;border:1px solid rgba(148,163,184,.25);border-radius:10px;margin-bottom:7px;">
          <div>${a.type} — <b>${a.name || a.bank || a.institution || ''}</b><span class="muted">${extra}</span></div>
          <div>${daysText}</div>
        </div>`;
      })
      .join('') || '<div class="small muted">Sin vencimientos próximos</div>';
  }

  const notesUl = document.getElementById('summaryNotes');
  if (notesUl) {
    notesUl.innerHTML = (alerts?.notes || []).map(n => `<li>${n}</li>`).join('') || '<li class="muted">Sin observaciones</li>';
  }

  // Antes / Después
  if (typeof wireBADeleteDelegation === 'function') {
  wireBADeleteDelegation();
}

if (typeof refreshBeforeAfter === 'function') {
  await refreshBeforeAfter();
}

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
      let sold = Number(me.unitsSold || 0);
      let total = Number(me.unitsTotal || 0);
      let pct = total ? Math.round(100 * sold / total) : 0;
      unitsTxt.textContent = `${sold}/${total} unidades vendidas (${pct}%)`;
    }
  } catch (e) {
    console.error('syncUnitsSoldFromPortfolio error', e);
  }
}

window.__BEFORE_AFTER__ = [];

async function loadSummary() {
  try {
    const activePeriod = window.__ACTIVE_SUMMARY_PERIOD__ || null;
    const periodQuery = activePeriod
      ? `&dateFrom=${encodeURIComponent(activePeriod.from)}&dateTo=${encodeURIComponent(activePeriod.to)}${activePeriod.compareFrom && activePeriod.compareTo ? `&compareDateFrom=${encodeURIComponent(activePeriod.compareFrom)}&compareDateTo=${encodeURIComponent(activePeriod.compareTo)}` : ''}`
      : '';
    // evitar caché del navegador
    const res = await API.get(`/api/projects/${id}/summary?ts=${Date.now()}${periodQuery}`);
    window.__LAST_SUMMARY_PAYLOAD__ = res;

    // 🔥 recalcular progreso EXACTAMENTE igual que Proyecto
 if (!activePeriod) try {
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
    const reportDateFrom = document.getElementById('summaryReportDateFrom');
    const reportDateTo = document.getElementById('summaryReportDateTo');
    const compareDateFrom = document.getElementById('summaryCompareDateFrom');
    const compareDateTo = document.getElementById('summaryCompareDateTo');
    const reportDateApply = document.getElementById('summaryReportDateApply');
    const reportDateClear = document.getElementById('summaryReportDateClear');

    if (activePeriod) {
      if (reportDateFrom) reportDateFrom.value = activePeriod.from || '';
      if (reportDateTo) reportDateTo.value = activePeriod.to || '';
      if (compareDateFrom) compareDateFrom.value = activePeriod.compareFrom || '';
      if (compareDateTo) compareDateTo.value = activePeriod.compareTo || '';
    }

    if (reportDateApply && !reportDateApply.dataset.bound) {
      reportDateApply.dataset.bound = '1';
      reportDateApply.addEventListener('click', async () => {
        try {
          window.__ACTIVE_SUMMARY_PERIOD__ = selectedReportPeriod();
          await loadSummary();
        } catch (err) {
          alert(err.message || 'No se pudo aplicar el periodo.');
        }
      });
    }

    if (reportDateClear && !reportDateClear.dataset.bound) {
      reportDateClear.dataset.bound = '1';
      reportDateClear.addEventListener('click', async () => {
        if (reportDateFrom) reportDateFrom.value = '';
        if (reportDateTo) reportDateTo.value = '';
        if (compareDateFrom) compareDateFrom.value = '';
        if (compareDateTo) compareDateTo.value = '';
        window.__ACTIVE_SUMMARY_PERIOD__ = null;
        await loadSummary();
      });
    }

    const selectedReportPeriod = () => {
      const from = reportDateFrom?.value || '';
      const to = reportDateTo?.value || '';
      const compareFrom = compareDateFrom?.value || '';
      const compareTo = compareDateTo?.value || '';
      if (!from && !to && (compareFrom || compareTo)) throw new Error('Selecciona primero el periodo del resumen antes de indicar un comparativo.');
      if (!from && !to) return null;
      if (!from || !to) throw new Error('Selecciona las dos fechas del periodo o limpia el filtro para generar el informe global.');
      if (from > to) throw new Error('La fecha inicial no puede ser posterior a la fecha final.');
      if ((compareFrom && !compareTo) || (!compareFrom && compareTo)) throw new Error('Selecciona las dos fechas del periodo de comparación o déjalo vacío.');
      if (compareFrom && compareTo && compareFrom > compareTo) throw new Error('La fecha inicial de comparación no puede ser posterior a la fecha final.');
      const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00.000Z`).getTime() - new Date(`${a}T00:00:00.000Z`).getTime()) / 86400000) + 1;
      if (compareFrom && compareTo) {
        const currentDays = daysBetween(from, to);
        const comparisonDays = daysBetween(compareFrom, compareTo);
        const daysDifference = Math.abs(currentDays - comparisonDays);
        const currentStart = new Date(`${from}T00:00:00.000Z`);
        const comparisonStart = new Date(`${compareFrom}T00:00:00.000Z`);
        const monthShift = Math.abs((comparisonStart.getFullYear() - currentStart.getFullYear()) * 12 + (comparisonStart.getMonth() - currentStart.getMonth()));
        const sameStartDay = currentStart.getDate() === comparisonStart.getDate();
        const isAdjacentMonth = sameStartDay && monthShift === 1 && daysDifference <= 4;
        if (currentDays !== comparisonDays && !isAdjacentMonth) {
          throw new Error('El periodo de comparación debe tener la misma duración que el periodo analizado, salvo meses consecutivos con distinta cantidad de días.');
        }
      }
      return { from, to, compareFrom, compareTo, label: `${from} - ${to}` };
    };

    const inReportPeriod = (value, period) => {
      if (!period) return true;
      const time = new Date(value || 0).getTime();
      const from = new Date(`${period.from}T00:00:00.000Z`).getTime();
      const to = new Date(`${period.to}T23:59:59.999Z`).getTime();
      return Number.isFinite(time) && time >= from && time <= to;
    };

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

    const safeReportFilenamePart = (value, fallback = 'Proyecto') => {
      const clean = String(value || fallback)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return (clean || fallback).slice(0, 90);
    };

    const downloadDateStamp = () => {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };

    const exportReportFilename = (payload, ext, reportPeriod) => {
      const projectName =
        payload?.project?.name ||
        payload?.projectName ||
        document.getElementById('pname')?.textContent ||
        'Proyecto';

      const periodPart = reportPeriod ? ` - ${reportPeriod.from}_a_${reportPeriod.to}` : '';
      return `Informe Bank73 - ${safeReportFilenamePart(projectName)}${periodPart} - ${downloadDateStamp()}.${ext}`;
    };

    const exportSummary = async (format) => {
  const btn = format === 'pdf' ? pdf : exl;
  const originalText = btn?.textContent || '';

  if (btn?.dataset.loading === '1') return;

  try {
    [pdf, exl].forEach(b => {
  if (!b) return;
  b.dataset.loading = '1';
  b.style.pointerEvents = 'none';
  b.style.opacity = '0.6';
});

if (btn) {
  btn.textContent = format === 'pdf' ? 'Generando PDF...' : 'Generando Excel...';
}
      const reportPeriod = selectedReportPeriod();
      const activePeriod = window.__ACTIVE_SUMMARY_PERIOD__ || null;
      const periodKey = (period) => period ? `${period.from}|${period.to}|${period.compareFrom || ''}|${period.compareTo || ''}` : '';
      if (periodKey(reportPeriod) !== periodKey(activePeriod)) {
        window.__ACTIVE_SUMMARY_PERIOD__ = reportPeriod;
        await loadSummary();
      }
      const payload = window.__LAST_SUMMARY_PAYLOAD__ || {};

      // Capturamos charts (los que existan)
      const charts = reportPeriod ? {
        'Avances registrados en el periodo': captureCanvas('sumPeriodComparison') || captureCanvas('sumPeriodEvents'),
      } : {
        'Estatus lotes / unidades': captureCanvas('sumUnitsDonut'),
        'Ventas mensuales': captureCanvas('sumSalesMonthly'),
        'Ventas vs ventas caídas': captureCanvas('sumSalesVsFallen'),
        'Ventas por modelo de vivienda': captureCanvas('sumSalesByModel'),
        'Estatus en banco': captureCanvas('sumBankStatus'),
        'CPP por banco': captureCanvas('sumCppPie'),
        'Montos CPP por banco': captureCanvas('sumCppAmountByBank'),
        'Proformas por banco': captureCanvas('sumProformasBar'),
        'Hipotecas por banco': captureCanvas('sumMortgagesByBank'),

        'Minutas de liberación': captureCanvas('sumLegalLiberacion'),
        'Minutas de segregación': captureCanvas('sumLegalSegregacion'),
        'Minutas de préstamo': captureCanvas('sumLegalPrestamo'),
        'Firma de protocolo por banco': captureCanvas('sumProtocolByBank'),

        'Estatus construcción': captureCanvas('sumConstructionStatus'),
        'Fase de construcción': captureCanvas('sumConstructionPhase'),
        'Modelos en construcción': captureCanvas('sumModelsInConstruction'),
        'Permisos por institución': captureCanvas('sumPermitsByInstitution'),

        'Comparación por fase (Usos)': captureCanvas('sumPhaseChart'),
        'Comparación por fase (Fuentes)': captureCanvas('sumPhaseSourceChart'),
        'Desviación temporal - Duración por fase': captureCanvas('sumPhaseTimeDurationChart'),
        'Desviación temporal - Fecha final': captureCanvas('sumPhaseTimeDelayChart'),
        'Cobertura CPP vs préstamo': captureCanvas('sumCppCoverage'),

      };

      document.querySelectorAll('[data-summary-phase-line-chart]').forEach(canvas => {
        const title = canvas.dataset.chartTitle || `Gráfica líneas ${canvas.id || ''}`.trim();
        charts[title] = captureCanvas(canvas.id);
      });

      // Limpia nulls
Object.keys(charts).forEach(k => { if (!charts[k]) delete charts[k]; });

// Datasets del resumen global o del periodo seleccionado.
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
  project: payload.project || {},

  commercial: payload.commercial || {},
  legal: payload.legal || {},
  technical: payload.technical || {},
  financial: payload.financial || {},
  finance: payload.finance || {},
  periodActivity: payload.periodActivity || null,
  periodComparison: payload.periodComparison || null,
};

// 3) ✅ antes/después desde la UI (si no existe, manda [])
const beforeAfter = (Array.isArray(window.__BEFORE_AFTER__) ? window.__BEFORE_AFTER__ : [])
  .filter(item => !reportPeriod || inReportPeriod(item?.createdAt, reportPeriod));

const resp2 = await fetch(`/api/projects/${id}/summary/export`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(typeof authHeaders === 'function' ? authHeaders() : {}),
    ...(typeof tenantHeaders === 'function' ? tenantHeaders() : {}),
  },
  body: JSON.stringify({ format, charts, datasets, beforeAfter, reportPeriod })
});

      if (!resp2.ok) {
        const txt = await resp2.text().catch(() => '');
        throw new Error(`Export falló (HTTP ${resp2.status}) ${txt}`);
      }

      const ext = (format === 'pdf') ? 'pdf' : 'xlsx';
      await downloadBlob(resp2, exportReportFilename(payload, ext, reportPeriod));
      } finally {
  [pdf, exl].forEach(b => {
    if (!b) return;
    b.dataset.loading = '0';
    b.style.pointerEvents = '';
    b.style.opacity = '';
  });

  if (btn) {
    btn.textContent = originalText;
  }
}
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
    await renderSummaryUI(res);

    // ===== Importar Dato Único (bind una sola vez) =====
    const importBtn = document.getElementById('importDatoUnicoBtn');
    const datoUnicoInput = document.getElementById('datoUnicoFile');
    const datoUnicoFileName = document.getElementById('datoUnicoFileName');
    if (datoUnicoInput && datoUnicoFileName && !datoUnicoInput.dataset.bound) {
      datoUnicoInput.dataset.bound = '1';
      datoUnicoInput.addEventListener('change', () => {
        datoUnicoFileName.textContent = datoUnicoInput.files?.[0]?.name || 'Ningún archivo seleccionado';
      });
    }
    if (importBtn && !importBtn.dataset.bound) {
      importBtn.dataset.bound = '1';
      importBtn.addEventListener('click', async () => {
  if (importBtn.disabled) return;

  try {
    const input = document.getElementById('datoUnicoFile');
    const f = input?.files?.[0];
    if (!f) return alert('Selecciona el Excel primero');

    // 🔒 bloquear botón
    importBtn.disabled = true;
    const originalText = importBtn.innerText;
    importBtn.innerText = 'Importando...';

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
      alert('Error importando Dato Único (mira consola)');
      return;
    }

    const json = await resp3.json();

    alert(`Importado: ${json.ventasUpserted} ventas / ${json.unitsUpserted} unidades`);

    await loadSummary();
    await refreshTopHeaderKpis();
    if (typeof loadCommercial === 'function') {
      await loadCommercial();
    }

  } catch (err) {
    console.error(err);
    alert(err.message || 'Error importando Dato Único');

  } finally {
  importBtn.disabled = false;
  importBtn.innerText = 'Importar Dato Único';
}
});
    }

    // Wire de subida Antes/Después
    wireBAUploads();

    // Refrescar la grilla A/D directamente desde /api/documents
    await refreshBeforeAfter();

    if (!activePeriod) await syncUnitsSoldFromPortfolio();
    __summaryDirty = false;
  } catch (e) {
    console.error('Error cargando resumen', e);
  }
}

function bindDatoUnicoImportControls() {
  const importBlock = document.querySelector('.summary-import-actions');
  const slot = document.getElementById('commercialImportDatoUnicoSlot');
  if (importBlock && slot && importBlock.parentElement !== slot) {
    importBlock.style.display = '';
    slot.appendChild(importBlock);
  }

  const importBtn = document.getElementById('importDatoUnicoBtn');
  const datoUnicoInput = document.getElementById('datoUnicoFile');
  const datoUnicoFileName = document.getElementById('datoUnicoFileName');
  if (datoUnicoInput && datoUnicoFileName && !datoUnicoInput.dataset.bound) {
    datoUnicoInput.dataset.bound = '1';
    datoUnicoInput.addEventListener('change', () => {
      datoUnicoFileName.textContent = datoUnicoInput.files?.[0]?.name || 'Ningun archivo seleccionado';
    });
  }
  if (importBtn && !importBtn.dataset.bound) {
    importBtn.dataset.bound = '1';
    importBtn.addEventListener('click', async () => {
      if (importBtn.disabled) return;

      try {
        const f = datoUnicoInput?.files?.[0];
        if (!f) return alert('Selecciona el Excel primero');

        importBtn.disabled = true;
        importBtn.innerText = 'Importando...';

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
          alert('Error importando Dato Unico (mira consola)');
          return;
        }

        const json = await resp3.json();
        alert(`Importado: ${json.ventasUpserted} ventas / ${json.unitsUpserted} unidades`);

        await loadSummary();
        await refreshTopHeaderKpis();
        if (typeof loadCommercial === 'function') await loadCommercial();
      } catch (err) {
        console.error(err);
        alert(err.message || 'Error importando Dato Unico');
      } finally {
        importBtn.disabled = false;
        importBtn.innerText = 'Importar Dato Unico';
      }
    });
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
    sumMortgagesByBank: 'Hipotecas aprobadas por banco (statusBanco contiene APROB).',
    sumSalesVsFallen: 'Compara ventas reales contra ventas caídas/canceladas por año.',
    sumSalesByModel: 'Distribución de ventas por modelo de vivienda.',
    sumClientProfile: 'Perfil del cliente comprador: independiente, asalariado o mixto.',
    sumCompanyType: 'Tipo de empresa del cliente: pública, privada o mixta.',
    sumBankStatus: 'Estado del expediente dentro del banco.',
    sumCppAmountByBank: 'Monto financiado o CPP acumulado por banco.',
    sumLegalLiberacion: 'Minutas de liberación completadas frente a pendientes.',
    sumLegalSegregacion: 'Minutas de segregación completadas frente a pendientes.',
    sumLegalPrestamo: 'Minutas de préstamo completadas frente a pendientes.',
    sumProtocolByBank: 'Firmas de protocolo agrupadas por banco.',
    sumConstructionStatus: 'Estado general de construcción de las unidades.',
    sumConstructionPhase: 'Fase constructiva actual de las unidades.',
    sumModelsInConstruction: 'Modelos de vivienda actualmente en construcción.',
    sumConstructionProgressRanges: 'Avance de construcción agrupado por rangos porcentuales.',
    sumCreditLines: 'Líneas de crédito: desembolsado frente a amortizado total.',
    sumCppCoverage: 'Cobertura de CPP vigente y en trámite frente a deuda actual.',
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
    const isMoney = /loan|desembols|budget|gasto/i.test(label);
    const value = isMoney ? formatProjectMoney(v) : formatNum(v);
    return `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div></div>`;
  }

  // ====== Carga de datos ======
  async function loadProject() {
    const p = await API.get('/api/projects/' + id);
    state.project = p;
    currentProjectCurrency = normalizeProjectCurrency(p.currency);
    if (projectCurrencySel) {
      projectCurrencySel.value = currentProjectCurrency;
      updateCurrencyControlMeta();
    }
    if (pname)  pname.textContent  = p.name || 'Proyecto';
    if (pdesc)  pdesc.textContent  = p.description || '';
    if (pdesc2) pdesc2.textContent = p.description || '';
    if (statusSel) statusSel.value = (p.status || 'EN_CURSO');
    if (projectTypeText) projectTypeText.textContent = `Tipo de proyecto: ${p.projectType || p.tipoProyecto || 'No definido'}`;

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

  async function saveProjectSettingsAuto() {
    if (isProjectSettingsSaving) return;
    isProjectSettingsSaving = true;
    const previousCurrency = currentProjectCurrency;
    const nextCurrency = normalizeProjectCurrency(projectCurrencySel?.value || currentProjectCurrency);
    currentProjectCurrency = nextCurrency;
    updateCurrencyControlMeta();

    try {
      if (statusSel) statusSel.disabled = true;
      if (projectCurrencySel) projectCurrencySel.disabled = true;

      await API.put(`/api/projects/${id}`, {
        status: statusSel?.value || 'EN_CURSO',
        currency: nextCurrency
      });

      await loadProject();
      if (typeof loadSummary === 'function') await loadSummary();
      if (previousCurrency !== nextCurrency && typeof loadFinance === 'function') await loadFinance();
    } catch (e) {
      currentProjectCurrency = previousCurrency;
      if (projectCurrencySel) projectCurrencySel.value = previousCurrency;
      updateCurrencyControlMeta();
      alert(e.message || 'No se pudo guardar el proyecto');
    } finally {
      if (statusSel) statusSel.disabled = false;
      if (projectCurrencySel) projectCurrencySel.disabled = false;
      isProjectSettingsSaving = false;
    }
  }

  statusSel?.addEventListener('change', saveProjectSettingsAuto);
  projectCurrencySel?.addEventListener('change', saveProjectSettingsAuto);

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
          <div class="subtask">
            <input type="checkbox" class="js-subtoggle subtask-check"
  data-id="${cl._id}"
  data-sid="${s._id||s.id||s.title}"
  ${s.completed ? 'checked':''}
  ${disabled ? 'disabled' : ''}
/>
            <span class="subtask-title">${s.title || s.name}</span>
            <button class="btn btn-danger btn-xs js-del-sub"
              data-id="${cl._id}"
              data-sid="${s._id||s.id||s.title}"
              ${disabled ? 'disabled' : ''}>X</button>
          </div>
        `).join('')}
        <div class="row">
          <input type="text" class="w-100" placeholder="Nueva subtarea…" data-newsub="${cl._id}" ${disabled ? 'disabled' : ''}/>
          <button class="btn btn-ghost btn-xs js-add-sub" data-id="${cl._id}" ${disabled ? 'disabled' : ''}>Añadir</button>
        </div>
      </div>

      <div class="cl-actions">
        <button class="btn btn-ghost btn-xs js-open-docs" data-cl="${cl._id}" ${disabled ? 'disabled' : ''}>
        📎 Docs (${(state.docsByChecklist[cl._id]||[]).length})
        </button>
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

  // Subtareas: eliminar (solo si ACTIVO)
  document.querySelectorAll('.js-del-sub').forEach(btn => {
    btn.onclick = async () => {
      const clId = btn.dataset.id, sid = btn.dataset.sid;
      if (!isActiveById(clId)) {
        alert('Checklist bloqueado: valida los anteriores o desbloquéalo manualmente tocando la tarjeta.');
        return;
      }
      if (!confirm('¿Eliminar esta subtarea?')) return;
      await API.del(`/api/checklists/${clId}/subtasks/${sid}`);
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
let FINANCE_CONTROL = null;
let FINANCE_PROJECT = null;
let FINANCE_COMMERCIAL_UNITS = [];
let FINANCE_LOAN_LINES_SAVE_IN_PROGRESS = false;
let FINANCE_LOAN_LINES_RENDER_TIMER = null;
let FINANCE_LOAN_LINE_EXPANDED = new Set();
let FINANCE_LOAN_LINE_COLLAPSED = new Set();
let FINANCE_ALL_LOAN_LINES = [];
let FINANCE_SELECTED_PHASE_ID = '';
let FINANCE_SELECTED_PHASE_NAME = '';
let FINANCE_MODAL_HOME = null;
let FINANCE_MODAL_NEXT = null;

const fmt = (n) => formatPanamaNumber(n);
const sumItems = (arr = []) => (arr || []).reduce((a, it) => a + parsePanamaNumber(it?.amount || 0), 0);
const isMongoIdLike = (v) => /^[a-f\d]{24}$/i.test(String(v || ''));

function numOr0(v) {
  const n = parsePanamaNumber(v);
  return Number.isFinite(n) ? n : 0;
}

function fillFinanceKpiInputsFromProject(project) {
  const a = document.getElementById('finLoanApproved');
  const d = document.getElementById('finLoanDisbursed');
  const b = document.getElementById('finBudgetApproved');
  const promoter = document.getElementById('finPromoterContribution');
  if (!a || !d || !b) return;

  const conditions = project?.financialConditions || {};
  a.value = formatPanamaNumber(conditions.bankFinancedAmount || project?.loanApproved);
  d.value = formatPanamaNumber(project?.loanDisbursed);
  b.value = formatPanamaNumber(conditions.projectTotal || project?.budgetApproved);
  a.readOnly = numOr0(conditions.bankFinancedAmount) > 0;
  b.readOnly = numOr0(conditions.projectTotal) > 0;
  a.title = a.readOnly ? 'Se edita desde Condiciones financieras' : '';
  b.title = b.readOnly ? 'Se edita desde Condiciones financieras' : '';
  if (promoter) promoter.value = formatPanamaNumber(
    conditions.promoterContribution || Math.max(0, numOr0(conditions.projectTotal || project?.budgetApproved) - numOr0(conditions.bankFinancedAmount || project?.loanApproved))
  );
}

function financeLinesForPhase(phaseId) {
  const target = String(phaseId || '');
  const firstPhaseId = String(FINANCE?.phases?.[0]?._id || '');
  return FINANCE_ALL_LOAN_LINES.filter(line => {
    const assigned = String(line.phaseId || '');
    if (assigned) return assigned === target;
    // Compatibilidad: las líneas históricas sin fase quedan en la primera fase
    // hasta que se guarden y reciban su asociación explícita.
    return target && target === firstPhaseId;
  });
}

function financeSeedLoanLinesFromApprovedPhaseLines(phase = {}) {
  const phaseId = String(phase?._id || FINANCE_SELECTED_PHASE_ID || '');
  const phaseName = phase?.name || FINANCE_SELECTED_PHASE_NAME || '';
  const approvedLines = Array.isArray(phase?.financingLines) ? phase.financingLines : [];
  return approvedLines
    .filter(line => String(line?.name || '').trim() || numOr0(line?.approvedAmount))
    .map((line, idx) => {
      const details = [
        numOr0(line.approvedAmount) ? `Aprobado: ${financeMoney(line.approvedAmount)}` : '',
        line.interestRate ? `Tasa: ${line.interestRate}` : '',
        line.term ? `Plazo: ${line.term}` : '',
        line.paymentMethod ? `Pago: ${line.paymentMethod}` : '',
        line.disbursementMethod ? `Desembolso: ${line.disbursementMethod}` : '',
        line.commission ? `Comision: ${line.commission}` : '',
        line.observations || ''
      ].filter(Boolean).join(' | ');
      return {
        _id: `approved-${phaseId || phaseName || 'phase'}-${idx}`,
        phaseId,
        phaseName,
        name: line.name || `Linea ${idx + 1}`,
        notes: details,
        entries: [{
          _id: `approved-entry-${phaseId || phaseName || 'phase'}-${idx}`,
          disbursementDate: '',
          loanNumber: '',
          disbursementAmount: 0,
          maturityDate: '',
          amortizedAmount: 0,
          notes: ''
        }]
      };
    });
}

function financeLoanLineHasMeaningfulData(line = {}, idx = 0) {
  const defaultName = new RegExp(`^linea\\s*${idx + 1}$`, 'i');
  const name = String(line.name || '').trim();
  const hasCustomName = name && !defaultName.test(name);
  const hasEntries = (Array.isArray(line.entries) ? line.entries : []).some(entry =>
    entry?.disbursementDate ||
    entry?.loanNumber ||
    numOr0(entry?.disbursementAmount) ||
    entry?.maturityDate ||
    numOr0(entry?.amortizedAmount) ||
    String(entry?.notes || '').trim()
  );
  return hasCustomName || String(line.notes || '').trim() || hasEntries || numOr0(line.disbursementAmount) || numOr0(line.amortizedAmount);
}

function financeLoanLinesWithApprovedSeeds(savedLines = [], phase = {}) {
  const seeds = financeSeedLoanLinesFromApprovedPhaseLines(phase);
  if (!seeds.length) return savedLines;
  if (!savedLines.length) return seeds;
  if (!savedLines.some((line, idx) => financeLoanLineHasMeaningfulData(line, idx))) return seeds;
  const savedNames = new Set(savedLines.map(line => String(line.name || '').trim().toLowerCase()).filter(Boolean));
  const missingSeeds = seeds.filter(line => !savedNames.has(String(line.name || '').trim().toLowerCase()));
  return [...savedLines, ...missingSeeds];
}

function financeProjectBasis() {
  const project = FINANCE_PROJECT || state.project || {};
  const conditions = project.financialConditions || {};
  const phases = Array.isArray(FINANCE?.phases) ? FINANCE.phases : [];
  const phaseProjectTotal = phases.reduce((sum, ph) => sum + numOr0(ph?.financialConditions?.phaseTotal), 0);
  const phaseBankApproved = phases.reduce((sum, ph) => sum + numOr0(ph?.financialConditions?.bankFinancedAmount), 0);
  const phasePromoterApproved = phases.reduce((sum, ph) => sum + numOr0(ph?.financialConditions?.promoterContribution), 0);
  const projectTotal = numOr0(conditions.projectTotal || project.budgetApproved || FINANCE_CONTROL?.totals?.budgetApproved) || phaseProjectTotal;
  const explicitBankApproved = numOr0(conditions.bankFinancedAmount || project.loanApproved || FINANCE_CONTROL?.totals?.loanApproved) || phaseBankApproved;
  const bankPct = numOr0(conditions.bankFinancedPct) || (projectTotal > 0 ? explicitBankApproved / projectTotal * 100 : 0);
  const bankApproved = explicitBankApproved || (projectTotal * bankPct / 100);
  const promoterApproved = numOr0(conditions.promoterContribution) || phasePromoterApproved || Math.max(0, projectTotal - bankApproved);
  const promoterPct = numOr0(conditions.promoterContributionPct) || (projectTotal > 0 ? promoterApproved / projectTotal * 100 : Math.max(0, 100 - bankPct));
  return { projectTotal, bankApproved, promoterApproved, bankPct, promoterPct };
}

function financePhaseFunding(ph = {}) {
  const basis = financeProjectBasis();
  const phaseConditions = ph.financialConditions || {};
  const planBudget = numOr0(phaseConditions.phaseTotal) || sumItems(ph.planUses);
  const phaseBankPct = numOr0(phaseConditions.bankFinancedPct) || basis.bankPct;
  const recommendedBank = numOr0(phaseConditions.bankFinancedAmount) || (planBudget * phaseBankPct / 100);
  const recommendedPromoter = numOr0(phaseConditions.promoterContribution) || Math.max(0, planBudget - recommendedBank);
  const phasePromoterPct = numOr0(phaseConditions.promoterContributionPct) || (planBudget > 0 ? recommendedPromoter / planBudget * 100 : Math.max(0, 100 - phaseBankPct));
  const lines = financeLinesForPhase(ph._id);
  const actual = lines.reduce((acc, line) => {
    const entries = Array.isArray(line.entries) && line.entries.length ? line.entries : [line];
    const disbursed = entries.reduce((sum, entry) => sum + numOr0(entry.disbursementAmount), 0);
    const manual = entries.reduce((sum, entry) => sum + numOr0(entry.amortizedAmount), 0);
    const amortized = manual + numOr0(line.allocatedAmortized);
    acc.disbursed += disbursed;
    acc.amortized += amortized;
    acc.debt += Math.max(0, disbursed - amortized);
    return acc;
  }, { disbursed: 0, amortized: 0, debt: 0 });
  return {
    ...basis,
    projectTotal: planBudget,
    bankApproved: recommendedBank,
    promoterApproved: recommendedPromoter,
    bankPct: phaseBankPct,
    promoterPct: phasePromoterPct,
    planBudget,
    recommendedBank,
    recommendedPromoter,
    linesCount: lines.length,
    ...actual,
    pendingRecommendedDisbursement: Math.max(0, recommendedBank - actual.disbursed),
  };
}

function renderFinanceCoherence(phases = FINANCE?.phases || []) {
  const box = document.getElementById('financeCoherenceSummary');
  const alertsBox = document.getElementById('financeCoherenceAlerts');
  if (!box || !alertsBox) return;
  const basis = financeProjectBasis();
  const planAllocated = phases.reduce((sum, ph) => sum + sumItems(ph.planUses), 0);
  const bankRecommended = phases.reduce((sum, ph) => sum + financePhaseFunding(ph).recommendedBank, 0);
  const promoterRecommended = phases.reduce((sum, ph) => sum + financePhaseFunding(ph).recommendedPromoter, 0);
  const totalDisbursed = numOr0(FINANCE_CONTROL?.totals?.totalDisbursed);
  const totalAmortized = numOr0(FINANCE_CONTROL?.totals?.totalAmortized);
  const debt = Math.max(0, totalDisbursed - totalAmortized);
  const rows = [
    ['Proyecto', basis.projectTotal, planAllocated, basis.projectTotal - planAllocated, 'Presupuesto aprobado', 'Distribuido en fases', 'Por distribuir'],
    ['Banco', basis.bankApproved, bankRecommended, basis.bankApproved - bankRecommended, 'Financiación aprobada', 'Recomendada en fases', 'Por asignar'],
    ['Promotor', basis.promoterApproved, promoterRecommended, basis.promoterApproved - promoterRecommended, 'Aporte previsto', 'Recomendado en fases', 'Por asignar'],
    ['Deuda bancaria', totalDisbursed, totalAmortized, debt, 'Desembolsado real', 'Amortizado real', 'Saldo por devolver'],
  ];
  box.innerHTML = rows.map(([name, approved, distributed, pending, approvedLabel, distributedLabel, pendingLabel]) => `
    <article class="finance-coherence-row">
      <h4>${escapeHtml(name)}</h4>
      <div><span>${escapeHtml(approvedLabel)}</span><strong>${financeMoney(approved)}</strong></div>
      <div><span>${escapeHtml(distributedLabel)}</span><strong>${financeMoney(distributed)}</strong></div>
      <div class="${pending < -0.01 ? 'is-danger' : ''}"><span>${escapeHtml(pendingLabel)}</span><strong>${financeMoney(pending)}</strong></div>
    </article>`).join('');

  const notices = [];
  if (!basis.projectTotal || !basis.bankApproved) notices.push(['info', 'Completa el total del proyecto y la financiación bancaria para activar todas las recomendaciones.']);
  if (planAllocated > basis.projectTotal + 0.01 && basis.projectTotal > 0) notices.push(['danger', `El PLAN de fases supera el total del proyecto en ${financeMoney(planAllocated - basis.projectTotal)}.`]);
  if (bankRecommended > basis.bankApproved + 0.01 && basis.bankApproved > 0) notices.push(['danger', `La financiación recomendada en fases supera el préstamo aprobado en ${financeMoney(bankRecommended - basis.bankApproved)}.`]);
  if (totalDisbursed > basis.bankApproved + 0.01 && basis.bankApproved > 0) notices.push(['danger', `Los desembolsos reales superan el préstamo aprobado en ${financeMoney(totalDisbursed - basis.bankApproved)}.`]);
  if (!notices.length) notices.push(['ok', 'Las fases y las líneas están dentro de los límites financieros del proyecto.']);
  alertsBox.innerHTML = notices.map(([tone, message]) => `<div class="finance-coherence-notice is-${tone}">${escapeHtml(message)}</div>`).join('');
}

function closeFinancePhaseModal() {
  const modal = document.getElementById('financePhaseLinesModal');
  if (modal) {
    modal.hidden = true;
    modal.classList.remove('is-fullscreen');
    modal.style.zoom = '';
  }
  const expand = document.getElementById('financePhaseFullscreenBtn');
  if (expand) { expand.textContent = '⛶'; expand.title = 'Pantalla completa'; }
  document.body.classList.remove('finance-modal-open');
  const page = document.getElementById('tab-finanzas-page');
  const portal = document.querySelector('.finance-modal-portal');
  if (modal && FINANCE_MODAL_HOME) {
    FINANCE_MODAL_HOME.insertBefore(modal, FINANCE_MODAL_NEXT?.parentNode === FINANCE_MODAL_HOME ? FINANCE_MODAL_NEXT : null);
  }
  if (page) page.id = 'tab-finanzas';
  portal?.remove();
}

function mountFinancePhaseModal() {
  const modal = document.getElementById('financePhaseLinesModal');
  const page = document.getElementById('tab-finanzas');
  if (!modal || !page || page.classList.contains('finance-modal-portal')) return modal;
  FINANCE_MODAL_HOME = modal.parentNode;
  FINANCE_MODAL_NEXT = modal.nextSibling;
  page.id = 'tab-finanzas-page';
  const portal = document.createElement('div');
  portal.id = 'tab-finanzas';
  portal.className = 'finance-modal-portal';
  document.body.appendChild(portal);
  portal.appendChild(modal);
  return modal;
}

function toggleFinancePhaseFullscreen() {
  const modal = document.getElementById('financePhaseLinesModal');
  const btn = document.getElementById('financePhaseFullscreenBtn');
  if (!modal) return;
  modal.classList.toggle('is-fullscreen');
  const full = modal.classList.contains('is-fullscreen');
  const bodyZoom = Number.parseFloat(getComputedStyle(document.body).zoom) || 1;
  modal.style.zoom = full && bodyZoom < 1 ? String(1 / bodyZoom) : '';
  if (btn) { btn.textContent = full ? '□' : '⛶'; btn.title = full ? 'Restaurar tamaño' : 'Pantalla completa'; }
  setTimeout(() => window.Chart?.getChart?.(document.getElementById('financeLoanLinesChart'))?.resize(), 30);
}

const FINANCE_CONDITION_FIELDS = [
  ['projectTotal','Total del proyecto','money'], ['bankFinancedAmount','Banco financia','money'],
  ['bankFinancedPct','% banco','pct'], ['promoterContribution','Promotor aporta','money'],
  ['promoterContributionPct','% promotor','pct'], ['interestRate','Tasa','pct'],
  ['term','Plazo'], ['paymentMethod','Forma de pago'], ['commission','Comisión'],
  ['disbursementMethod','Forma de desembolso'], ['disbursementConditions','Condiciones de desembolso'],
  ['amortizationConditions','Condiciones de amortización'], ['requiredPresales','Preventa requerida'],
  ['guarantees','Garantías'], ['insurance','Seguros']
];
const FINANCE_PRECEDENT_FIELDS = [
  ['presalesMet','Preventa cumplida'], ['constructionPermitsApproved','Permisos de construcción aprobados'],
  ['plansApproved','Planos aprobados'], ['insuranceDelivered','Seguros entregados'],
  ['guaranteesConstituted','Garantías constituidas'], ['environmentalStudyApproved','Estudio ambiental aprobado'],
  ['trustConstituted','Fideicomiso constituido'], ['otherRequirementsMet','Otros requisitos']
];
const FINANCE_OPERATION_FIELDS = [
  ['trustee','Fiduciaria'], ['trustType','Tipo de fideicomiso'],
  ['technicalInspector','Inspector técnico'], ['financialInspector','Inspector financiero']
];

const FINANCE_PHASE_CONDITION_FIELDS = [
  ['generalConditions','Condiciones generales'],
  ['phaseTotal','Total de la fase'],
  ['bankFinancedAmount','Financiacion bancaria'],
  ['promoterContribution','Aporte del promotor'],
  ['bankFinancedPct','% banco'],
  ['promoterContributionPct','% promotor'],
  ['guarantees','Garantias'],
  ['insurance','Seguros'],
  ['requiredPresales','Preventa requerida'],
  ['precedentConditions','Condiciones precedentes'],
  ['otherRequirements','Detalle de otros requisitos'],
  ['disbursementConditions','Condiciones de desembolso'],
  ['amortizationConditions','Condiciones de amortizacion/pago'],
  ['promoterObligations','Obligaciones del promotor'],
  ['covenants','Restricciones/covenants'],
  ['trustee','Fiduciaria'],
  ['trustType','Tipo de fideicomiso'],
  ['technicalInspector','Inspector tecnico'],
  ['financialInspector','Inspector financiero'],
  ['generalObservations','Observaciones generales']
];

function financePhaseConditionsHtml(ph = {}) {
  const c = ph.financialConditions || {};
  const hasConditions = Object.values(c || {}).some(value => String(value || '').trim());
  const lines = Array.isArray(ph.financingLines) ? ph.financingLines : [];
  const letterRows = [
    ['Banco/interino', c.interimBank],
    ['Fecha de carta', financeDateInput(c.letterDate)],
    ['Referencia', c.letterReference]
  ].map(([label, value]) => `<div class="finance-condition-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '---')}</strong></div>`).join('');
  const conditionRows = FINANCE_PHASE_CONDITION_FIELDS
    .filter(([key]) => String(c[key] || '').trim())
    .map(([key,label]) => `<div class="finance-condition-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(c[key])}</strong></div>`)
    .join('');
  const lineRows = lines.map((line, idx) => `
    <tr>
      <td>${escapeHtml(line.name || `Linea ${idx + 1}`)}</td>
      <td class="right">${financeMoney(line.approvedAmount)}</td>
      <td>${escapeHtml(line.interestRate || '---')}</td>
      <td>${escapeHtml(line.term || '---')}</td>
      <td>${escapeHtml(line.paymentMethod || '---')}</td>
      <td>${escapeHtml(line.disbursementMethod || '---')}</td>
      <td>${escapeHtml(line.commission || '---')}</td>
      <td>${escapeHtml(line.observations || '---')}</td>
    </tr>`).join('');
  return `
    <details class="finance-condition-collapsible finance-phase-conditions-compact">
      <summary>Condiciones y lineas aprobadas <span>${lines.length} lineas</span></summary>
      <div class="finance-conditions-subgrid">${letterRows}${conditionRows || (!hasConditions ? '<div class="small muted">Sin condiciones de fase registradas.</div>' : '')}</div>
      <div style="overflow:auto;margin:10px;">
        <table class="table">
          <thead><tr><th>Nombre/facilidad</th><th class="right">Monto aprobado</th><th>Tasa</th><th>Plazo</th><th>Forma de pago</th><th>Forma de desembolso</th><th>Comision</th><th>Observaciones</th></tr></thead>
          <tbody>${lineRows || '<tr><td colspan="8" class="muted">Sin lineas de financiacion aprobadas para esta fase.</td></tr>'}</tbody>
        </table>
      </div>
    </details>`;
}

function financeFacilityFormRow(item = {}) {
  return `<div class="finance-facility-form-row" data-facility-row>
    <label><span>Tipo de facilidad</span><input class="input" data-facility="facilityType" list="financeFacilityTypes" value="${escapeHtml(item.facilityType || '')}"></label>
    <label><span>Destino del préstamo</span><input class="input" data-facility="loanPurpose" value="${escapeHtml(item.loanPurpose || '')}"></label>
    <label><span>% financiado por banco</span><input class="input" data-facility="bankFinancedPct" type="number" step="any" value="${item.bankFinancedPct ?? ''}"></label>
    <label><span>% CPP/ventas a amortización</span><input class="input" data-facility="cppSalesAmortizationPct" type="number" step="any" value="${item.cppSalesAmortizationPct ?? ''}"></label>
    <label><span>Aporte requerido promotor</span><input class="input" data-facility="promoterRequiredContribution" type="number" step="any" value="${item.promoterRequiredContribution ?? ''}"></label>
    <button class="btn btn-danger btn-xs" type="button" data-remove-facility>Quitar</button>
  </div>`;
}

function renderFinanceConditions(project = state.project || {}) {
  const conditions = project.financialConditions || {};
  const effective = { ...conditions };
  if (!numOr0(effective.projectTotal)) effective.projectTotal = numOr0(project.budgetApproved);
  if (!numOr0(effective.bankFinancedAmount)) effective.bankFinancedAmount = numOr0(project.loanApproved);
  if (!numOr0(effective.promoterContribution)) effective.promoterContribution = Math.max(0, numOr0(effective.projectTotal) - numOr0(effective.bankFinancedAmount));
  if (!numOr0(effective.bankFinancedPct) && numOr0(effective.projectTotal)) effective.bankFinancedPct = numOr0(effective.bankFinancedAmount) / numOr0(effective.projectTotal) * 100;
  if (!numOr0(effective.promoterContributionPct) && numOr0(effective.projectTotal)) effective.promoterContributionPct = numOr0(effective.promoterContribution) / numOr0(effective.projectTotal) * 100;
  const view = document.getElementById('financeConditionsView');
  const form = document.getElementById('financeConditionsForm');
  const summary = document.getElementById('financeProjectFinancialSummary');
  const section = document.querySelector('.finance-conditions-card');
  if (!view || !form) return;
  if (summary) summary.innerHTML = `<h4>Datos financieros del proyecto</h4>` + [
    ['Total del proyecto', financeMoney(effective.projectTotal)],
    ['Financiación bancaria', financeMoney(effective.bankFinancedAmount)],
    ['Desembolsado', financeMoney(project.loanDisbursed)],
    ['Aporte promotor', financeMoney(effective.promoterContribution)],
    ['% banco', `${numOr0(effective.bankFinancedPct).toFixed(1)}%`],
    ['% promotor', `${numOr0(effective.promoterContributionPct).toFixed(1)}%`]
  ].map(([label,value]) => `<div class="finance-project-summary-item"><span>${label}</span><strong>${value}</strong></div>`).join('');

  const baseView = FINANCE_CONDITION_FIELDS.slice(5).map(([key,label,type]) => {
    const raw = effective[key];
    const value = type === 'money' ? financeMoney(raw) : type === 'pct' ? `${numOr0(raw)}%` : (raw || '—');
    return `<div class="finance-condition-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }).join('');
  const facilities = Array.isArray(conditions.facilities) ? conditions.facilities : [];
  const precedent = conditions.precedentConditions || {};
  const operation = conditions.operationStructure || {};
  if (section) section.hidden = true;
  view.innerHTML = `
    <details class="finance-condition-collapsible"><summary>Condiciones generales heredadas</summary><div class="finance-conditions-subgrid">${baseView}</div></details>
    <details class="finance-condition-collapsible"><summary>Facilidades o líneas aprobadas <span>${facilities.length}</span></summary><div class="finance-facilities-view">${facilities.map((item, idx) => `
      <article class="finance-facility-card"><strong>${escapeHtml(item.facilityType || `Facilidad ${idx + 1}`)}</strong><span>${escapeHtml(item.loanPurpose || 'Sin destino indicado')}</span>
      <div><b>${numOr0(item.bankFinancedPct)}%</b> banco · <b>${numOr0(item.cppSalesAmortizationPct)}%</b> CPP/ventas · Promotor <b>${financeMoney(item.promoterRequiredContribution)}</b></div></article>
    `).join('') || '<div class="small muted">Sin facilidades registradas.</div>'}</div></details>
    <details class="finance-condition-collapsible"><summary>Condiciones precedentes <span>${FINANCE_PRECEDENT_FIELDS.filter(([key]) => precedent[key]).length}/${FINANCE_PRECEDENT_FIELDS.length}</span></summary><div class="finance-precedent-view">${FINANCE_PRECEDENT_FIELDS.map(([key,label]) => `<span class="finance-check-state ${precedent[key] ? 'is-done' : ''}">${precedent[key] ? '✓' : '○'} ${escapeHtml(label)}</span>`).join('')}</div>${precedent.otherRequirements ? `<p class="small muted">Otros: ${escapeHtml(precedent.otherRequirements)}</p>` : ''}</details>
    <details class="finance-condition-collapsible"><summary>Estructura de la operación</summary><div class="finance-conditions-subgrid">${FINANCE_OPERATION_FIELDS.map(([key,label]) => `<div class="finance-condition-item"><span>${label}</span><strong>${escapeHtml(operation[key] || '—')}</strong></div>`).join('')}</div></details>`;

  const formField = ([key,label,type]) => `
    <label><span>${escapeHtml(label)}</span>${['money','pct'].includes(type)
      ? `<input class="input" data-finance-condition="${key}" type="number" step="any" value="${effective[key] ?? ''}">`
      : ['disbursementConditions','amortizationConditions','guarantees','insurance'].includes(key)
        ? `<textarea class="input" data-finance-condition="${key}" rows="2">${escapeHtml(effective[key] || '')}</textarea>`
        : `<input class="input" data-finance-condition="${key}" value="${escapeHtml(effective[key] || '')}">`}</label>`;
  const financialForm = FINANCE_CONDITION_FIELDS.slice(0, 6).map(formField).join('');
  const generalForm = FINANCE_CONDITION_FIELDS.slice(6).map(formField).join('');
  form.innerHTML = `
    <datalist id="financeFacilityTypes"><option value="Préstamo a término"><option value="Línea de crédito interina"><option value="Línea revolutiva"><option value="Infraestructura"><option value="Costos directos"><option value="Costos indirectos"></datalist>
    <details class="finance-condition-form-section" open><summary>Datos financieros del proyecto</summary><div class="finance-conditions-subgrid">${financialForm}<label><span>Desembolsado manual</span><input class="input" data-project-finance-kpi="loanDisbursed" type="number" step="any" value="${numOr0(project.loanDisbursed)}"></label></div></details>
    <details class="finance-condition-form-section"><summary>Condiciones bancarias generales</summary><div class="finance-conditions-subgrid">${generalForm}</div></details>
    <details class="finance-condition-form-section"><summary>Facilidades o líneas aprobadas <span>${facilities.length}</span></summary><div id="financeFacilitiesForm">${facilities.map(financeFacilityFormRow).join('')}</div><button class="btn btn-ghost btn-xs" type="button" data-add-facility>+ Añadir facilidad</button></details>
    <details class="finance-condition-form-section"><summary>Condiciones precedentes</summary><div class="finance-precedent-form">${FINANCE_PRECEDENT_FIELDS.map(([key,label]) => `<label><input type="checkbox" data-precedent="${key}" ${precedent[key] ? 'checked' : ''}> <span>${label}</span></label>`).join('')}</div><label class="finance-wide-field"><span>Detalle de otros requisitos</span><textarea class="input" data-precedent-notes rows="2">${escapeHtml(precedent.otherRequirements || '')}</textarea></label></details>
    <details class="finance-condition-form-section"><summary>Estructura de la operación</summary><div class="finance-conditions-subgrid">${FINANCE_OPERATION_FIELDS.map(([key,label]) => `<label><span>${label}</span><input class="input" data-operation="${key}" value="${escapeHtml(operation[key] || '')}"></label>`).join('')}</div></details>`;
  form.onclick = event => {
    if (event.target.closest('[data-add-facility]')) document.getElementById('financeFacilitiesForm')?.insertAdjacentHTML('beforeend', financeFacilityFormRow());
    if (event.target.closest('[data-remove-facility]')) event.target.closest('[data-facility-row]')?.remove();
  };
}

function setFinanceConditionsEditing(editing) {
  document.getElementById('financeProjectFinancialSummary').hidden = editing;
  document.getElementById('financeConditionsView').hidden = editing;
  document.getElementById('financeConditionsForm').hidden = !editing;
  document.getElementById('financeConditionsActions').hidden = !editing;
  document.getElementById('editFinanceConditionsBtn').hidden = editing;
}

async function saveFinanceConditions() {
  const numeric = new Set(['projectTotal','bankFinancedAmount','bankFinancedPct','promoterContribution','promoterContributionPct','interestRate']);
  const financialConditions = {};
  const form = document.getElementById('financeConditionsForm');
  form.querySelectorAll('[data-finance-condition]').forEach(input => {
    financialConditions[input.dataset.financeCondition] = numeric.has(input.dataset.financeCondition) ? numOr0(input.value) : input.value.trim();
  });
  financialConditions.facilities = Array.from(form.querySelectorAll('[data-facility-row]')).map(row => ({
    facilityType: row.querySelector('[data-facility="facilityType"]')?.value.trim() || '',
    loanPurpose: row.querySelector('[data-facility="loanPurpose"]')?.value.trim() || '',
    bankFinancedPct: numOr0(row.querySelector('[data-facility="bankFinancedPct"]')?.value),
    cppSalesAmortizationPct: numOr0(row.querySelector('[data-facility="cppSalesAmortizationPct"]')?.value),
    promoterRequiredContribution: numOr0(row.querySelector('[data-facility="promoterRequiredContribution"]')?.value)
  }));
  financialConditions.precedentConditions = {};
  form.querySelectorAll('[data-precedent]').forEach(input => { financialConditions.precedentConditions[input.dataset.precedent] = input.checked; });
  financialConditions.precedentConditions.otherRequirements = form.querySelector('[data-precedent-notes]')?.value.trim() || '';
  financialConditions.operationStructure = {};
  form.querySelectorAll('[data-operation]').forEach(input => { financialConditions.operationStructure[input.dataset.operation] = input.value.trim(); });
  const loanDisbursed = numOr0(form.querySelector('[data-project-finance-kpi="loanDisbursed"]')?.value);
  await API.put(`/api/projects/${id}`, { financialConditions, loanDisbursed });
  await loadProject();
  await loadFinance();
  setFinanceConditionsEditing(false);
  await markProjectDataChanged();
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
    await markProjectDataChanged();
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
  const section = document.getElementById('financeAlertsSection');
  if (section) section.hidden = true;
}

function financeMoney(n) {
  return formatProjectMoney(n);
}

function financePct(value, base, decimals = 1) {
  const numerator = numOr0(value);
  const denominator = numOr0(base);
  if (denominator <= 0) return '0%';
  return `${((numerator / denominator) * 100).toFixed(decimals)}%`;
}

function financeProgressWidth(value, base) {
  const denominator = numOr0(base);
  if (denominator <= 0) return 0;
  return Math.max(0, Math.min(100, (numOr0(value) / denominator) * 100));
}

function financeDateInput(v) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function financeLineStatus(line) {
  const entries = Array.isArray(line?.entries) && line.entries.length ? line.entries : [line];
  const statuses = entries.map(financeEntryStatus).map(s => s.key);
  if (statuses.includes('overdue')) return { key: 'overdue', label: 'Vencido' };
  if (statuses.includes('upcoming')) return { key: 'upcoming', label: 'Proximo a vencer' };
  if (statuses.includes('missing')) return { key: 'missing', label: 'Sin vencimiento' };
  const balance = entries.reduce((acc, entry) => acc + Math.max(0, numOr0(entry?.disbursementAmount) - numOr0(entry?.amortizedAmount)), 0);
  if (balance <= 0) return { key: 'amortized', label: 'Amortizado' };
  return { key: 'ok', label: 'OK' };
}

function financeEntryStatus(line) {
  const balance = Math.max(0, numOr0(line?.disbursementAmount) - numOr0(line?.amortizedAmount));
  if (balance <= 0) return { key: 'amortized', label: 'Amortizado' };
  if (!line?.maturityDate) return { key: 'missing', label: 'Sin vencimiento' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maturity = new Date(line.maturityDate);
  maturity.setHours(0, 0, 0, 0);
  const daysLeft = Math.ceil((maturity.getTime() - today.getTime()) / 86400000);
  if (daysLeft < 0) return { key: 'overdue', label: `Vencido hace ${Math.abs(daysLeft)} dias` };
  if (daysLeft <= 120) return { key: 'upcoming', label: `Vence en ${daysLeft} dias` };
  return { key: 'ok', label: 'OK' };
}

function collectFinanceLoanLines() {
  return Array.from(document.querySelectorAll('.finance-loan-line-card[data-line-card]')).map((card, idx) => ({
    _id: isMongoIdLike(card.dataset.id) ? card.dataset.id : undefined,
    phaseId: card.dataset.phaseId || FINANCE_SELECTED_PHASE_ID || null,
    phaseName: card.dataset.phaseName || FINANCE_SELECTED_PHASE_NAME || '',
    name: card.querySelector('[data-line-field="name"]')?.value || `Linea ${idx + 1}`,
    notes: card.querySelector('[data-line-field="notes"]')?.value || '',
    entries: Array.from(card.querySelectorAll('[data-entry-row]')).map(row => ({
      _id: isMongoIdLike(row.dataset.entryId) ? row.dataset.entryId : undefined,
      disbursementDate: row.querySelector('[data-field="disbursementDate"]')?.value || null,
      loanNumber: row.querySelector('[data-field="loanNumber"]')?.value || '',
      disbursementAmount: numOr0(row.querySelector('[data-field="disbursementAmount"]')?.value),
      maturityDate: row.querySelector('[data-field="maturityDate"]')?.value || null,
      amortizedAmount: numOr0(row.querySelector('[data-field="amortizedAmount"]')?.value),
      notes: row.querySelector('[data-field="notes"]')?.value || '',
    })).filter(entry =>
      entry.disbursementDate || entry.loanNumber || entry.disbursementAmount ||
      entry.maturityDate || entry.amortizedAmount || entry.notes
    ),
  }));
}

function readFinanceUnitCards() {
  return Array.from(document.querySelectorAll('.finance-unit-card[data-unit-card]')).map(card => ({
    _id: card.dataset.financeId && !card.dataset.financeId.startsWith('new-') ? card.dataset.financeId : undefined,
    unitId: card.dataset.unitId || undefined,
    clientName: card.querySelector('[data-field="clientName"]')?.value || '',
    lot: card.querySelector('[data-field="lot"]')?.value || '',
    buyerBank: card.querySelector('[data-field="buyerBank"]')?.value || '',
    checkNumber: card.querySelector('[data-field="checkNumber"]')?.value || '',
    checkDate: card.querySelector('[data-field="checkDate"]')?.value || null,
    checkAmount: numOr0(card.querySelector('[data-field="checkAmount"]')?.value),
    checkAmountSource: card.querySelector('[data-field="checkAmountSource"]')?.value || 'cpp',
    amortizationLine1: numOr0(card.querySelector('[data-field="amortizationLine1"]')?.value),
    amortizationLine2: numOr0(card.querySelector('[data-field="amortizationLine2"]')?.value),
    allocations: Array.from(card.querySelectorAll('[data-allocation-line]')).map(row => ({
      loanLineId: row.dataset.loanLineId || '',
      loanLineName: row.dataset.loanLineName || '',
      amount: numOr0(row.querySelector('[data-field="allocationAmount"]')?.value),
    })).filter(a => a.loanLineId || a.loanLineName || a.amount),
    promoterAmount: numOr0(card.querySelector('[data-field="promoterAmount"]')?.value),
    notes: card.querySelector('[data-field="notes"]')?.value || '',
  }));
}

function collectFinanceUnitAmortizations() {
  const commercialByUnit = new Map((FINANCE_COMMERCIAL_UNITS || []).map(u => [String(u.unitId || ''), u]));
  const savedByUnit = new Map((FINANCE_CONTROL?.unitAmortizations || []).map(u => [String(u.unitId || ''), u]));
  const visibleLineKeys = new Set(financeLoanLineOptions().flatMap(line => [String(line.id || ''), String(line.name || '')]).filter(Boolean));
  return readFinanceUnitCards().map(item => {
    const base = commercialByUnit.get(String(item.unitId || '')) || {};
    const saved = savedByUnit.get(String(item.unitId || '')) || {};
    const hiddenAllocations = (saved.allocations || []).filter(allocation => {
      const idKey = String(allocation.loanLineId || '');
      const nameKey = String(allocation.loanLineName || '');
      return !visibleLineKeys.has(idKey) && !visibleLineKeys.has(nameKey);
    });
    item.allocations = [...hiddenAllocations, ...(item.allocations || [])];
    const hasExistingFinance = !!item._id;
    const allocationTotal = (item.allocations || []).reduce((acc, a) => acc + numOr0(a.amount), 0);
    const hasDistribution = item.checkNumber || item.checkDate || allocationTotal || item.amortizationLine1 || item.amortizationLine2 || item.promoterAmount || item.notes;
    const hasOverrides =
      String(item.clientName || '') !== String(base.clientName || '') ||
      String(item.lot || '') !== String(base.lot || base.unitLabel || '') ||
      String(item.buyerBank || '') !== String(base.buyerBank || '') ||
      Math.abs(numOr0(item.checkAmount) - numOr0(base.cppAmount)) > 0.01;
    return (hasExistingFinance || hasDistribution || hasOverrides) ? item : null;
  }).filter(Boolean);
}

function computeFinanceControlTotals() {
  const loanLines = collectFinanceLoanLines().length ? collectFinanceLoanLines() : (FINANCE_CONTROL?.loanLines || []);
  const unitAmortizations = currentFinanceUnitAmortizations();
  const totalDisbursed = loanLines.reduce((a, l) => a + financeLoanLineTotals(l).disbursed, 0);
  const totalManualAmortized = loanLines.reduce((a, l) => a + financeLoanLineTotals(l).amortized, 0);
  const totalAllocatedAmortized = unitAmortizations.reduce((a, u) =>
    a + (u.allocations || []).reduce((acc, allocation) => acc + numOr0(allocation.amount), 0), 0);
  const totalAmortized = totalManualAmortized + totalAllocatedAmortized;
  const loanApproved = numOr0(document.getElementById('finLoanApproved')?.value || FINANCE_CONTROL?.totals?.loanApproved);
  const budgetApproved = numOr0(document.getElementById('finBudgetApproved')?.value || FINANCE_CONTROL?.totals?.budgetApproved);
  const planUses = (FINANCE?.phases || []).reduce((a, ph) => a + sumItems(ph.planUses), 0);
  const realUses = (FINANCE?.phases || []).reduce((a, ph) => a + sumItems(ph.uses), 0);

  return {
    budgetApproved,
    loanApproved,
    totalDisbursed,
    availableToDisburse: loanApproved - totalDisbursed,
    totalAmortized,
    currentDebtBalance: totalDisbursed - totalAmortized,
    amortizationPct: totalDisbursed > 0 ? totalAmortized / totalDisbursed : 0,
    upcomingMaturities: loanLines.filter(l => financeLineStatus(l).key === 'upcoming').length,
    overdueMaturities: loanLines.filter(l => financeLineStatus(l).key === 'overdue').length,
    checkAmountTotal: unitAmortizations.reduce((a, u) => a + numOr0(u.checkAmount), 0),
    promoterTotal: unitAmortizations.reduce((a, u) => a + numOr0(u.promoterAmount), 0),
    totalManualAmortized,
    totalAllocatedAmortized,
    planVsRealDifference: realUses - planUses,
  };
}

function financeLoanLineTotals(line = {}) {
  const entries = Array.isArray(line.entries) && line.entries.length ? line.entries : [line];
  const disbursed = entries.reduce((a, entry) => a + numOr0(entry.disbursementAmount), 0);
  const amortized = entries.reduce((a, entry) => a + numOr0(entry.amortizedAmount), 0);
  const allocated = financeAllocatedToLine(line);
  const recovered = amortized + allocated;
  return {
    disbursed,
    amortized,
    allocated,
    recovered,
    balance: Math.max(0, disbursed - recovered),
  };
}

function financeLoanLineChartTotals(line = {}) {
  const hasSummaryShape = [
    'disbursedAmount',
    'totalRecovered',
    'balanceAfterSales',
    'debt'
  ].some(key => line[key] !== undefined && line[key] !== null);

  if (hasSummaryShape) {
    const disbursed = numOr0(line.disbursementAmount ?? line.disbursedAmount);
    const recovered = numOr0(line.totalRecovered ?? line.amortizedAmount);
    const balance = line.balanceAfterSales !== undefined || line.debt !== undefined
      ? numOr0(line.balanceAfterSales ?? line.debt)
      : Math.max(0, disbursed - recovered);
    return {
      disbursed,
      recovered,
      amortized: recovered,
      allocated: 0,
      balance,
    };
  }

  return financeLoanLineTotals(line);
}

function destroyChartsByPrefix(prefix) {
  if (!prefix || !__sumCharts) return;
  Object.keys(__sumCharts).forEach(key => {
    if (!String(key).startsWith(prefix)) return;
    __sumCharts[key]?.destroy?.();
    delete __sumCharts[key];
  });
}

function renderLoanLinesBarChart(canvas, lines = [], chartKey = '') {
  if (!canvas || typeof Chart === 'undefined') return null;
  const existingChart = Chart.getChart?.(canvas) || canvas._chart;
  existingChart?.destroy?.();
  if (chartKey && __sumCharts?.[chartKey]) {
    __sumCharts[chartKey]?.destroy?.();
    delete __sumCharts[chartKey];
  }

  const safeLines = Array.isArray(lines) ? lines : [];
  const labels = safeLines.map((line, idx) => line.name || `Línea ${idx + 1}`);
  const totals = safeLines.map(line => financeLoanLineChartTotals(line));

  if (!labels.length) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return null;
  }

  const chart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Desembolsado',
          data: totals.map(t => t.disbursed),
          backgroundColor: 'rgba(34,197,94,.78)',
          borderColor: 'rgba(34,197,94,1)',
          borderWidth: 1,
          borderRadius: 6,
        },
        {
          label: 'Amortizado total',
          data: totals.map(t => t.recovered),
          backgroundColor: 'rgba(59,130,246,.72)',
          borderColor: 'rgba(59,130,246,1)',
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#94a3b8' } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${financeMoney(ctx.raw)}`,
            footer: (items) => {
              const idx = items?.[0]?.dataIndex ?? 0;
              const lineTotals = totals[idx] || {};
              return [
                `Amortizado: ${financePct(lineTotals.recovered, lineTotals.disbursed)}`,
                `Saldo por pagar: ${financeMoney(lineTotals.balance || 0)} (${financePct(lineTotals.balance, lineTotals.disbursed)})`
              ];
            },
          },
        },
      },
      scales: {
        x: { stacked: false, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.10)' } },
        y: { stacked: false, beginAtZero: true, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.12)' } },
      },
    },
  });

  canvas._chart = chart;
  if (chartKey) __sumCharts[chartKey] = chart;
  return chart;
}

function financeAllocatedToLine(line = {}) {
  const lineId = String(line._id || '');
  const lineName = String(line.name || '');
  return currentFinanceUnitAmortizations().reduce((acc, unit) => {
    return acc + (unit.allocations || []).reduce((sum, allocation) => {
      const sameId = lineId && String(allocation.loanLineId || '') === lineId;
      const sameName = !lineId && lineName && String(allocation.loanLineName || '') === lineName;
      return sum + (sameId || sameName ? numOr0(allocation.amount) : 0);
    }, 0);
  }, 0);
}

function financeSalesAllocationsForLine(line = {}) {
  const lineId = String(line._id || '');
  const lineName = String(line.name || '');
  return currentFinanceUnitAmortizations().flatMap(unit => {
    return (unit.allocations || []).map(allocation => {
      const sameId = lineId && String(allocation.loanLineId || '') === lineId;
      const sameName = !lineId && lineName && String(allocation.loanLineName || '') === lineName;
      if (!sameId && !sameName) return null;
      if (numOr0(allocation.amount) <= 0) return null;
      return {
        unitId: unit.unitId || '',
        financeId: unit._id || '',
        lot: unit.lot || '',
        clientName: unit.clientName || '',
        checkNumber: unit.checkNumber || '',
        checkDate: unit.checkDate || '',
        amount: numOr0(allocation.amount),
      };
    }).filter(Boolean);
  });
}

function financeSortDateValue(value) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? Number.MAX_SAFE_INTEGER : d.getTime();
}

function financeIdTimeValue(id) {
  const raw = String(id || '');
  if (/^[a-f\d]{24}$/i.test(raw)) return parseInt(raw.slice(0, 8), 16) * 1000;
  const generated = raw.match(/(?:new|new-entry)-(\d+)/);
  if (generated) return Number(generated[1]);
  return Number.MAX_SAFE_INTEGER;
}

function financeMovementSortValue(row) {
  const dateValue = row.type === 'manual'
    ? financeSortDateValue(row.entry?.disbursementDate)
    : financeSortDateValue(row.sale?.checkDate);
  if (dateValue !== Number.MAX_SAFE_INTEGER) return dateValue;
  const idValue = row.type === 'manual'
    ? financeIdTimeValue(row.entry?._id)
    : financeIdTimeValue(row.sale?.financeId || row.sale?.unitId);
  if (idValue !== Number.MAX_SAFE_INTEGER) return idValue;
  return Number.MAX_SAFE_INTEGER - 100000 + (row.sourceOrder || 0);
}

function currentFinanceUnitAmortizations() {
  const cards = document.querySelectorAll('#financeUnitAmortizations .finance-unit-card');
  return cards.length ? readFinanceUnitCards() : mergedFinanceUnitAmortizations();
}

function setFinanceButtonState(btn, label, isLoading = false) {
  if (!btn) return;
  btn.textContent = label;
  btn.disabled = !!isLoading;
  btn.classList.toggle('is-saving', !!isLoading);
}

function waitFinanceFeedback(ms = 350) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function renderFinanceLoanGlobalSummary(lines = collectFinanceLoanLines()) {
  const box = document.getElementById('financeLoanGlobalSummary');
  if (!box) return;
  const totals = lines.reduce((acc, line) => {
    const t = financeLoanLineTotals(line);
    acc.disbursed += t.disbursed;
    acc.amortized += t.amortized;
    acc.balance += t.balance;
    return acc;
  }, { disbursed: 0, amortized: 0, balance: 0 });
  const allocated = lines.reduce((a, l) => a + financeLoanLineTotals(l).allocated, 0);
  const totalAmortized = totals.amortized + allocated;
  box.innerHTML = [
    ['Total desembolsado', financeMoney(totals.disbursed), '100% base'],
    ['Amortizado manual', financeMoney(totals.amortized), `${financePct(totals.amortized, totals.disbursed)} del desembolsado`],
    ['Amortizado por ventas', financeMoney(allocated), `${financePct(allocated, totals.disbursed)} del desembolsado`],
    ['Amortización total', financeMoney(totalAmortized), `${financePct(totalAmortized, totals.disbursed)} del desembolsado`],
    ['Saldo por pagar', financeMoney(totals.balance), `${financePct(totals.balance, totals.disbursed)} pendiente`],
  ].map(([label, value, percent]) => `
    <article class="finance-loan-summary-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(percent)}</small>
    </article>
  `).join('');
}

function renderFinanceControlKpis(totals = null) {
  const box = document.getElementById('financeControlKpis');
  if (!box) return;
  totals = totals || FINANCE_CONTROL?.totals || computeFinanceControlTotals();
  console.log('[Finance] calculo KPIs', totals);
  const cards = [
    ['Budget aprobado', financeMoney(totals.budgetApproved), 'budget'],
    ['Loan aprobado', financeMoney(totals.loanApproved), 'loan'],
    ['Aporte promotor', financeMoney(totals.promoterContribution), 'promoter'],
    ['Desembolsado total', financeMoney(totals.totalDisbursed), 'disbursed'],
    ['Disponible por desembolsar', financeMoney(totals.availableToDisburse), totals.availableToDisburse < 0 ? 'danger' : 'ok'],
    ['Amortización total', financeMoney(totals.totalAmortized), 'ok'],
    ['Saldo por pagar', financeMoney(totals.currentDebtBalance), 'debt'],
    ['% amortizacion', `${((totals.amortizationPct || 0) * 100).toFixed(1)}%`, 'ok'],
    ['Vencimientos proximos', fmt(totals.upcomingMaturities), totals.upcomingMaturities ? 'warn' : 'ok'],
    ['Vencimientos vencidos', fmt(totals.overdueMaturities), totals.overdueMaturities ? 'danger' : 'ok'],
    ['Total valor base / cheques', financeMoney(totals.checkAmountTotal), 'cpp'],
    ['Total destinado a promotor', financeMoney(totals.promoterTotal), 'promoter'],
    ['Amortizacion manual', financeMoney(totals.totalManualAmortized), 'line1'],
    ['Amortizacion por ventas', financeMoney(totals.totalAllocatedAmortized), 'line2'],
    ['Diferencia Plan vs Real', financeMoney(totals.planVsRealDifference), Math.abs(totals.planVsRealDifference) > 0 ? 'warn' : 'ok'],
  ];
  box.innerHTML = cards.map(([label, value, tone]) => `
    <article class="finance-kpi-card is-${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `).join('');
}

function renderFinanceLoanLinesChart(lines = collectFinanceLoanLines()) {
  const el = document.getElementById('financeLoanLinesChart');
  if (!el || typeof Chart === 'undefined') return;
  renderLoanLinesBarChart(el, lines || []);
}

function renderFinancePhaseLineCharts(phases = [], containerId = 'financePhaseLineCharts', chartPrefix = 'financePhaseLineChart', options = {}) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  destroyChartsByPrefix(chartPrefix);

  const safePhases = Array.isArray(phases) ? phases : [];
  const sourceLines = Array.isArray(options.lines) ? options.lines : null;
  const getLinesForPhase = (phase) => {
    if (!sourceLines) return financeLinesForPhase(phase?._id);
    const phaseId = String(phase?._id || '');
    const phaseName = String(phase?.name || '');
    const firstPhaseId = String(safePhases?.[0]?._id || '');
    return sourceLines.filter(line => {
      const linePhaseId = String(line.phaseId || line.phase || '');
      const linePhaseName = String(line.phaseName || '');
      if ((phaseId && linePhaseId === phaseId) || (phaseName && linePhaseName === phaseName)) return true;
      return !linePhaseId && !linePhaseName && phaseId && phaseId === firstPhaseId;
    });
  };

  if (!safePhases.length) {
    wrap.innerHTML = '<div class="card small muted">Sin fases para construir gráficas de líneas.</div>';
    return;
  }

  wrap.innerHTML = safePhases.map((phase, index) => {
    const phaseName = phase?.name || `Fase ${index + 1}`;
    const canvasId = `${chartPrefix}-${index}`;
    const title = `Gráfica líneas ${phaseName}`;
    return `
      <div class="card finance-chart-card summary-chart-card">
        <h3>${escapeHtml(title)}</h3>
        <div class="small muted">Desembolsado frente a amortizado total de las líneas asociadas a esta fase.</div>
        <div class="finance-chart-box summary-chart-box">
          <canvas id="${escapeHtml(canvasId)}"${options.summary ? ` data-summary-phase-line-chart="1" data-chart-title="${escapeHtml(title)}"` : ''}></canvas>
        </div>
        <div id="${escapeHtml(canvasId)}Summary" class="summary-chart-summary finance-phase-line-summary"></div>
      </div>
    `;
  }).join('');

  safePhases.forEach((phase, index) => {
    const phaseName = phase?.name || `Fase ${index + 1}`;
    const canvasId = `${chartPrefix}-${index}`;
    const lines = getLinesForPhase(phase);
    const canvas = document.getElementById(canvasId);
    renderLoanLinesBarChart(canvas, lines, `${chartPrefix}-${index}`);
    const summary = document.getElementById(`${canvasId}Summary`);
    if (!summary) return;
    if (!lines.length) {
      summary.innerHTML = '<div class="small muted">Esta fase todavía no tiene líneas asociadas.</div>';
      return;
    }
    const totals = lines.map(line => ({ ...financeLoanLineChartTotals(line), label: line.name || 'Línea' }));
    renderChartSummary(
      `${canvasId}Summary`,
      totals.map(t => ({ label: t.label, value: t.recovered, disbursed: t.disbursed, balance: t.balance })),
      {
        totalLabel: `Total amortizado ${phaseName}`,
        formatter: (v, item) => item
          ? `${financeMoney(item?.disbursed || 0)} desemb. · ${financeMoney(v)} amort. · ${financeMoney(item?.balance || 0)} saldo`
          : financeMoney(v)
      }
    );
  });
}

function renderFinanceLoanLines(lines = []) {
  const body = document.getElementById('financeLoanLinesBody');
  if (!body) return;
  const safeLines = (lines || []).map((line, idx) => ({
    ...line,
    entries: Array.isArray(line.entries) && line.entries.length ? line.entries : [{
      _id: line._id ? `legacy-${line._id}` : `new-entry-${Date.now()}-${idx}`,
      disbursementDate: line.disbursementDate || '',
      loanNumber: line.loanNumber || '',
      disbursementAmount: numOr0(line.disbursementAmount),
      maturityDate: line.maturityDate || '',
      amortizedAmount: numOr0(line.amortizedAmount),
      notes: line.notes || '',
    }]
  }));
  body.innerHTML = safeLines.map((line, idx) => {
    const totals = financeLoanLineTotals(line);
    const recoveredPct = financePct(totals.recovered, totals.disbursed);
    const balancePct = financePct(totals.balance, totals.disbursed);
    const status = totals.balance <= 0 ? { key: 'amortized', label: 'Amortizado' } : financeLineStatus(line);
    const salesAllocations = financeSalesAllocationsForLine(line);
    const combinedRows = [
      ...line.entries.map((entry, entryIdx) => ({ type: 'manual', entry, entryIdx, sourceOrder: entryIdx })),
      ...salesAllocations.map((sale, saleIdx) => ({ type: 'sale', sale, saleIdx, sourceOrder: line.entries.length + saleIdx }))
    ].sort((a, b) => {
      const ad = financeMovementSortValue(a);
      const bd = financeMovementSortValue(b);
      if (ad !== bd) return ad - bd;
      return (a.sourceOrder || 0) - (b.sourceOrder || 0);
    });
    const rowId = line._id || `new-${Date.now()}-${idx}`;
    const rowKey = String(rowId);
    const rowsCount = combinedRows.length;
    const isCollapsed = FINANCE_LOAN_LINE_COLLAPSED.has(rowKey)
      || (rowsCount > 5 && !FINANCE_LOAN_LINE_EXPANDED.has(rowKey));
    return `
      <article class="finance-loan-line-card" data-line-card data-id="${escapeHtml(rowId)}" data-phase-id="${escapeHtml(line.phaseId || FINANCE_SELECTED_PHASE_ID || '')}" data-phase-name="${escapeHtml(line.phaseName || FINANCE_SELECTED_PHASE_NAME || '')}">
        <div class="finance-loan-line-head">
          <label>
            <span>Nombre de línea</span>
            <input data-line-field="name" value="${escapeHtml(line.name || `Linea ${idx + 1}`)}">
          </label>
          <div class="finance-loan-line-metrics">
            <span>Desembolsado <b>${financeMoney(totals.disbursed)}</b></span>
            <span>Manual <b>${financeMoney(totals.amortized)}</b></span>
            <span>Ventas <b>${financeMoney(totals.allocated)}</b></span>
            <span>Total amort. <b>${financeMoney(totals.recovered)} · ${recoveredPct}</b></span>
            <span>Saldo por pagar <b>${financeMoney(totals.balance)} · ${balancePct}</b></span>
            <span class="finance-status is-${status.key}">${status.label}</span>
            <div class="finance-line-progress" title="${recoveredPct} amortizado">
              <div style="width:${financeProgressWidth(totals.recovered, totals.disbursed)}%"></div>
            </div>
          </div>
          <div class="finance-inline-actions">
            <button class="btn btn-ghost btn-xs" type="button" data-finance-toggle-entries data-count="${rowsCount}" aria-expanded="${isCollapsed ? 'false' : 'true'}">${isCollapsed ? 'Mostrar' : 'Ocultar'} partidas (${rowsCount})</button>
            <button class="btn btn-xs" type="button" data-finance-add-entry>+ Partida</button>
            <button class="btn btn-xs" type="button" data-finance-save-line>Guardar</button>
            <button class="btn btn-danger btn-xs" type="button" data-finance-remove-line>Eliminar</button>
          </div>
        </div>
        <div class="finance-loan-line-notes">
          <input data-line-field="notes" value="${escapeHtml(line.notes || '')}" placeholder="Notas de la línea">
        </div>
        <div class="finance-table-wrap ${isCollapsed ? 'is-collapsed' : ''}" data-finance-entries-wrap>
          <table class="finance-loan-table">
            <thead>
              <tr>
                <th>Fecha desembolso</th>
                <th>No. préstamo</th>
                <th>Monto desembolso</th>
                <th>Fecha vencimiento</th>
                <th>Monto amortizado</th>
                <th>Saldo</th>
                <th>Estado</th>
                <th>Notas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${combinedRows.map(row => {
                if (row.type === 'sale') {
                  const sale = row.sale;
                  return `
                    <tr class="finance-sale-entry-row">
                      <td><input value="${escapeHtml(financeDateInput(sale.checkDate) || '-')}" disabled></td>
                      <td><input value="${escapeHtml(sale.checkNumber ? `Cheque ${sale.checkNumber}` : sale.lot || 'Venta')}" disabled></td>
                      <td><input value="${formatPanamaNumber(0)}" disabled></td>
                      <td><input value="-" disabled></td>
                      <td><input value="${formatPanamaNumber(sale.amount)}" disabled></td>
                      <td class="finance-balance">-</td>
                      <td><span class="finance-status is-ok">Venta</span></td>
                      <td><input value="${escapeHtml(`${sale.lot || 'Unidad'} · ${sale.clientName || 'Cliente'}`)}" disabled></td>
                      <td><span class="small muted">Desde unidad</span></td>
                    </tr>
                  `;
                }
                const entry = row.entry;
                const entryIdx = row.entryIdx;
                const entryBalance = Math.max(0, numOr0(entry.disbursementAmount) - numOr0(entry.amortizedAmount));
                const entryStatus = financeEntryStatus(entry);
                return `
                  <tr data-entry-row data-entry-id="${escapeHtml(entry._id || `new-entry-${Date.now()}-${entryIdx}`)}">
                    <td><input data-field="disbursementDate" type="date" value="${financeDateInput(entry.disbursementDate)}"></td>
                    <td><input data-field="loanNumber" value="${escapeHtml(entry.loanNumber || '')}"></td>
                    <td><input data-field="disbursementAmount" type="text" inputmode="decimal" value="${formatPanamaNumber(entry.disbursementAmount)}"></td>
                    <td><input data-field="maturityDate" type="date" value="${financeDateInput(entry.maturityDate)}"></td>
                    <td><input data-field="amortizedAmount" type="text" inputmode="decimal" value="${formatPanamaNumber(entry.amortizedAmount)}"></td>
                    <td class="finance-balance">${financeMoney(entryBalance)}</td>
                    <td><span class="finance-status is-${entryStatus.key}">${entryStatus.label}</span></td>
                    <td><input data-field="notes" value="${escapeHtml(entry.notes || '')}"></td>
                    <td><button class="btn btn-danger btn-xs" type="button" data-finance-remove-entry>Quitar</button></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }).join('') || `<div class="small muted">Sin lineas registradas.</div>`;
  document.getElementById('financeLoanLinesSummary').textContent =
    `${safeLines.length} linea(s) - saldo ${financeMoney(safeLines.reduce((a, l) => a + financeLoanLineTotals(l).balance, 0))}`;
  renderFinanceLoanGlobalSummary(safeLines);
  renderFinanceLoanLinesChart(safeLines);
  renderFinanceControlKpis();
}

function mergedFinanceUnitAmortizations() {
  const saved = FINANCE_CONTROL?.unitAmortizations || [];
  const savedByUnit = new Map(saved.filter(x => x.unitId).map(x => [String(x.unitId), x]));
  const out = (FINANCE_COMMERCIAL_UNITS || []).map((unit, idx) => {
    const savedItem = savedByUnit.get(String(unit.unitId)) || {};
    if (!savedItem._id && !String(unit.clientName || '').trim()) return null;
    const savedSource = savedItem.checkAmountSource || 'cpp';
    const baseCheckAmount = savedSource === 'cpp_initial'
      ? numOr0(unit.financeBaseAmountWithInitial)
      : savedSource === 'sale_price'
        ? numOr0(unit.salePrice)
        : numOr0(unit.cppAmount || unit.financeBaseAmount);
    const lines = financeLoanLineOptions();
    const legacyAllocations = [];
    if ((!savedItem.allocations || !savedItem.allocations.length) && (savedItem.amortizationLine1 || savedItem.amortizationLine2)) {
      if (lines[0] && savedItem.amortizationLine1) legacyAllocations.push({ loanLineId: lines[0].id, loanLineName: lines[0].name, amount: savedItem.amortizationLine1 });
      if (lines[1] && savedItem.amortizationLine2) legacyAllocations.push({ loanLineId: lines[1].id, loanLineName: lines[1].name, amount: savedItem.amortizationLine2 });
    }
    return {
      _id: savedItem._id || `new-${idx}`,
      unitId: unit.unitId,
      clientName: savedItem.clientName || unit.clientName || '',
      lot: savedItem.lot || unit.lot || unit.unitLabel || '',
      buyerBank: savedItem.buyerBank || unit.buyerBank || '',
      checkNumber: savedItem.checkNumber || '',
      checkDate: savedItem.checkDate || '',
      checkAmount: savedItem.checkAmount || baseCheckAmount || 0,
      checkAmountSource: savedSource,
      cppAmount: unit.cppAmount || 0,
      initialPayment: unit.initialPayment || 0,
      salePrice: unit.salePrice || 0,
      amortizationLine1: savedItem.amortizationLine1 || 0,
      amortizationLine2: savedItem.amortizationLine2 || 0,
      allocations: (savedItem.allocations && savedItem.allocations.length) ? savedItem.allocations : legacyAllocations,
      promoterAmount: savedItem.promoterAmount || 0,
      notes: savedItem.notes || '',
      commercialStatus: unit.commercialStatus || '',
      cppStatus: unit.cppStatus || '',
    };
  }).filter(Boolean);
  saved.filter(x => !x.unitId).forEach((item, idx) => out.push({ ...item, _id: item._id || `manual-${idx}` }));
  return out;
}

function financeUnitState(item) {
  const hasCore = item.clientName || item.lot || item.buyerBank || item.checkAmount;
  const allocationTotal = (item.allocations || []).reduce((acc, a) => acc + numOr0(a.amount), 0);
  const legacyTotal = numOr0(item.amortizationLine1) + numOr0(item.amortizationLine2);
  const distributed = (item.allocations?.length ? allocationTotal : legacyTotal) + numOr0(item.promoterAmount);
  const diff = numOr0(item.checkAmount) - distributed;
  if (!hasCore || !numOr0(item.checkAmount)) return { key: 'pending', label: 'Pendiente', diff, distributed };
  if (Math.abs(diff) > 0.01) return { key: 'warn', label: 'Descuadre', diff, distributed };
  return { key: 'ok', label: 'OK', diff, distributed };
}

function financeLoanLineOptions() {
  const domLines = collectFinanceLoanLines();
  const lines = domLines.length ? domLines : (FINANCE_CONTROL?.loanLines || []);
  return lines
    .filter(line => String(line.name || '').trim())
    .map((line, idx) => ({
      id: line._id || '',
      name: line.name || `Linea ${idx + 1}`,
    }));
}

function renderFinanceAllocationInputs(item) {
  const lines = financeLoanLineOptions();
  if (!lines.length) {
    return '<div class="finance-field-wide small muted">Crea primero una linea de prestamo para asignar amortizaciones.</div>';
  }
  const allocationByKey = new Map((item.allocations || []).map(a => [String(a.loanLineId || a.loanLineName || ''), a]));
  return lines.map(line => {
    const key = line.id || line.name;
    const saved = allocationByKey.get(String(key)) || allocationByKey.get(String(line.name)) || {};
    return `
      <label data-allocation-line data-loan-line-id="${escapeHtml(line.id)}" data-loan-line-name="${escapeHtml(line.name)}">
        Amortizacion ${escapeHtml(line.name)}
        <input data-field="allocationAmount" type="text" inputmode="decimal" value="${formatPanamaNumber(saved.amount)}">
      </label>
    `;
  }).join('');
}

function financeCheckAmountForSource(item, source) {
  if (source === 'cpp_initial') return numOr0(item.cppAmount) + numOr0(item.initialPayment);
  if (source === 'sale_price') return numOr0(item.salePrice);
  return numOr0(item.cppAmount);
}

function renderFinanceUnitAmortizations() {
  const box = document.getElementById('financeUnitAmortizations');
  if (!box) return;
  const items = mergedFinanceUnitAmortizations();
  console.log('[Finance] carga unidades comerciales', { count: items.length });
  renderFinanceUnitGlobalSummary(items);
  box.innerHTML = items.map(item => {
    const state = financeUnitState(item);
    const commercialStateClass = normalizeUnitEstadoFrontend(item.commercialStatus || '');
    return `
      <details class="finance-unit-card estado-${escapeHtml(commercialStateClass)}" data-unit-card data-finance-id="${escapeHtml(item._id || '')}" data-unit-id="${escapeHtml(item.unitId || '')}" data-cpp-amount="${numOr0(item.cppAmount)}" data-initial-payment="${numOr0(item.initialPayment)}" data-sale-price="${numOr0(item.salePrice)}">
        <summary>
          <div>
            <strong>${escapeHtml(item.lot || 'Unidad')}</strong>
            <span>${escapeHtml(item.clientName || 'Sin cliente')}</span>
          </div>
          <div class="finance-unit-money">
            <b>${financeMoney(item.checkAmount)}</b>
            <span class="finance-status is-${state.key}">${state.label}</span>
          </div>
        </summary>
        <div class="finance-unit-fields">
          <label>Nombre del cliente<input data-field="clientName" value="${escapeHtml(item.clientName || '')}"></label>
          <label>Lote / unidad<input data-field="lot" value="${escapeHtml(item.lot || '')}"></label>
          <label>Banco comprador<input data-field="buyerBank" value="${escapeHtml(item.buyerBank || '')}"></label>
          <label>No. cheque<input data-field="checkNumber" value="${escapeHtml(item.checkNumber || '')}"></label>
          <label>Base valor
            <select data-field="checkAmountSource">
              <option value="cpp" ${item.checkAmountSource === 'cpp' ? 'selected' : ''}>CPP</option>
              <option value="cpp_initial" ${item.checkAmountSource === 'cpp_initial' ? 'selected' : ''}>CPP + abono inicial</option>
              <option value="sale_price" ${item.checkAmountSource === 'sale_price' ? 'selected' : ''}>Precio venta</option>
            </select>
          </label>
          <label>Valor cheque / base<input data-field="checkAmount" type="text" inputmode="decimal" value="${formatPanamaNumber(item.checkAmount)}"></label>
          <label>Fecha cheque<input data-field="checkDate" type="date" value="${financeDateInput(item.checkDate)}"></label>
          <div class="finance-field-wide finance-commercial-base">
            CPP: <b>${financeMoney(item.cppAmount)}</b> · Abono inicial: <b>${financeMoney(item.initialPayment)}</b> · Precio venta: <b>${financeMoney(item.salePrice)}</b>
          </div>
          ${renderFinanceAllocationInputs(item)}
          <label>Promotor<input data-field="promoterAmount" type="text" inputmode="decimal" value="${formatPanamaNumber(item.promoterAmount)}"></label>
          <label class="finance-field-wide">Notas<input data-field="notes" value="${escapeHtml(item.notes || '')}"></label>
        </div>
        <div class="finance-unit-footer">
          <span>Total distribuido: <b data-unit-distributed>${financeMoney(state.distributed)}</b></span>
          <span>Diferencia: <b data-unit-difference>${financeMoney(state.diff)}</b></span>
          <button class="btn btn-xs" type="button" data-finance-save-unit>Guardar</button>
          <button class="btn btn-ghost btn-xs" type="button" data-finance-reset-unit>Limpiar</button>
        </div>
      </details>
    `;
  }).join('') || '<div class="small muted">No hay unidades comerciales cargadas.</div>';
  renderFinanceLoanLines(collectFinanceLoanLines());
  renderFinanceControlKpis();
}

function renderFinanceUnitGlobalSummary(items = mergedFinanceUnitAmortizations()) {
  const box = document.getElementById('financeUnitGlobalSummary');
  if (!box) return;
  const totals = items.reduce((acc, item) => {
    acc.checkAmount += numOr0(item.checkAmount);
    acc.allocated += (item.allocations || []).reduce((sum, allocation) => sum + numOr0(allocation.amount), 0);
    acc.promoter += numOr0(item.promoterAmount);
    return acc;
  }, { checkAmount: 0, allocated: 0, promoter: 0 });
  box.innerHTML = [
    ['Valor base / cheques', financeMoney(totals.checkAmount)],
    ['Amortizado a líneas', financeMoney(totals.allocated)],
    ['Total promotor', financeMoney(totals.promoter)],
  ].map(([label, value]) => `
    <article class="finance-loan-summary-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `).join('');
}

function refreshFinanceDerivedUI() {
  renderFinanceLoanLines(collectFinanceLoanLines());
  document.querySelectorAll('.finance-unit-card[data-unit-card]').forEach(card => {
    const item = readFinanceUnitCards().find(x => String(x.unitId || '') === String(card.dataset.unitId || '')) || {};
    const state = financeUnitState(item);
    card.querySelector('[data-unit-distributed]').textContent = financeMoney(state.distributed);
    card.querySelector('[data-unit-difference]').textContent = financeMoney(state.diff);
    const badge = card.querySelector('.finance-status');
    if (badge) {
      badge.className = `finance-status is-${state.key}`;
      badge.textContent = state.label;
    }
  });
  renderFinanceControlKpis();
}

async function saveFinanceLoanLines(btn = null) {
  const originalLabel = btn?.textContent || 'Guardar';
  FINANCE_LOAN_LINES_SAVE_IN_PROGRESS = true;
  if (FINANCE_LOAN_LINES_RENDER_TIMER) {
    clearTimeout(FINANCE_LOAN_LINES_RENDER_TIMER);
    FINANCE_LOAN_LINES_RENDER_TIMER = null;
  }
  try {
    setFinanceButtonState(btn, 'Guardando...', true);
    const visibleLines = collectFinanceLoanLines();
    const visibleIds = new Set(visibleLines.map(line => String(line._id || '')).filter(Boolean));
    const loanLines = [
      ...FINANCE_ALL_LOAN_LINES.filter(line => {
        if (visibleIds.has(String(line._id || ''))) return false;
        return String(line.phaseId || '') !== String(FINANCE_SELECTED_PHASE_ID || '');
      }),
      ...visibleLines
    ];
    console.log('[Finance] guardado lineas', loanLines);
    await API.put(`/api/projects/${id}/finance/loan-lines`, { loanLines });
    setFinanceButtonState(btn, 'Guardado', true);
    if (btn) await waitFinanceFeedback();
    await loadFinance();
    await markProjectDataChanged();
  } catch (e) {
    setFinanceButtonState(btn, originalLabel, false);
    console.error('[Finance] error guardando lineas', e);
    alert('No se pudieron guardar las lineas de prestamo');
  } finally {
    FINANCE_LOAN_LINES_SAVE_IN_PROGRESS = false;
  }
}

async function saveFinanceUnitAmortizations() {
  try {
    const unitAmortizations = collectFinanceUnitAmortizations();
    console.log('[Finance] guardado amortizaciones', unitAmortizations);
    await API.put(`/api/projects/${id}/finance/unit-amortizations`, { unitAmortizations });
    await loadFinance();
    await markProjectDataChanged();
  } catch (e) {
    console.error('[Finance] error guardando amortizaciones', e);
    alert('No se pudieron guardar las amortizaciones');
  }
}

async function saveFinanceSingleUnit(card, btn = null) {
  if (!card) return saveFinanceUnitAmortizations();
  const originalLabel = btn?.textContent || 'Guardar';
  const targetUnitId = String(card.dataset.unitId || '');
  const targetFinanceId = String(card.dataset.financeId || '');
  const current = collectFinanceUnitAmortizations();
  const incoming = readFinanceUnitCards().find(item =>
    String(item.unitId || '') === targetUnitId ||
    (targetFinanceId && String(item._id || '') === targetFinanceId)
  );
  if (!incoming) return saveFinanceUnitAmortizations();
  const next = current.filter(item => {
    if (targetUnitId) return String(item.unitId || '') !== targetUnitId;
    return String(item._id || '') !== targetFinanceId;
  });
  next.push(incoming);
  try {
    setFinanceButtonState(btn, 'Guardando...', true);
    console.log('[Finance] guardado amortizacion unidad', incoming);
    await API.put(`/api/projects/${id}/finance/unit-amortizations`, { unitAmortizations: next });
    setFinanceButtonState(btn, 'Guardado', true);
    if (btn) await waitFinanceFeedback();
    await loadFinance();
    await markProjectDataChanged();
  } catch (e) {
    setFinanceButtonState(btn, originalLabel, false);
    console.error('[Finance] error guardando unidad', e);
    alert('No se pudo guardar esta unidad');
  }
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
    console.log('[Finance] carga de finanzas', { projectId: id });
    const res = await API.get(`/api/projects/${id}/finance`);
    FINANCE = res.finance;
    FINANCE_KPIS = res.kpis;
    FINANCE_CONTROL = res.financeControl || null;
    FINANCE_PROJECT = res.project || state.project || null;
    FINANCE_ALL_LOAN_LINES = (FINANCE_CONTROL?.loanLines || []).map(line => ({ ...line }));
    FINANCE_COMMERCIAL_UNITS = res.commercialUnits || [];
    window.FINANCE_KPIS = FINANCE_KPIS;

    // ✅ Guardamos FINANCE en window para el modal "Iniciar REAL" (dropdown de fases)
    window.FINANCE = FINANCE;

    // ================================
    // ✅ Bind botones PLAN / REAL (solo 1 vez)
    // ================================
    const canEditFinanceStructure = ['admin', 'bank', 'financiero', 'gerencia', 'socios'].includes(myRole);
    const planBtn = document.getElementById('addPhasePlanBtn');
    if (planBtn) planBtn.hidden = !canEditFinanceStructure;
    if (planBtn && !planBtn.dataset.bound) {
      planBtn.addEventListener('click', () => {
        openPhaseEditor(null, 'plan');
      });
      planBtn.dataset.bound = '1';
    }

    const realBtn = document.getElementById('addPhaseRealBtn');
    if (realBtn) realBtn.hidden = !canEditFinanceStructure;
    if (realBtn && !realBtn.dataset.bound) {
      realBtn.addEventListener('click', () => {
        openPhaseEditor(null, 'real');
      });
      realBtn.dataset.bound = '1';
    }

    // (Legacy) si aún existe el botón antiguo, lo desactivamos para evitar confusión
    const legacyBtn = document.getElementById('addPhaseBtn');
    if (legacyBtn) legacyBtn.hidden = !canEditFinanceStructure;
    if (legacyBtn && !legacyBtn.dataset.bound) {
      legacyBtn.addEventListener('click', () => {
        // Por defecto, crear fase debe ser PLAN
        openPhaseEditor(null, 'plan');
      });
      legacyBtn.dataset.bound = '1';
    }
    const unifiedBtn = document.getElementById('addPhaseUnifiedBtn');
    if (unifiedBtn) unifiedBtn.hidden = !canEditFinanceStructure;

    // KPIs del proyecto (cabecera)
    if (res.project) {
      fillFinanceKpiInputsFromProject(res.project);
      renderFinanceConditions(res.project);
    }
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

    renderFinanceControlKpis(FINANCE_CONTROL?.totals || {});
    renderFinanceCoherence(FINANCE?.phases || []);
    const phaseLines = FINANCE_SELECTED_PHASE_ID
      ? financeLinesForPhase(FINANCE_SELECTED_PHASE_ID)
      : FINANCE_ALL_LOAN_LINES;
    renderFinanceLoanLines(phaseLines);
    renderFinanceUnitAmortizations();

    // Fases: cards
    renderPhases(FINANCE?.phases || []);
    renderUnifiedFinancePhases(FINANCE?.phases || []);

    // Charts: Plan vs Real por fase (usos y fuentes)
    renderPhaseChart(FINANCE?.phases || []);
    renderPhaseSourceChart(FINANCE?.phases || []);
    renderFinanceTimeCharts(FINANCE?.phases || []);
    renderFinancePhaseLineCharts(FINANCE?.phases || []);

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

  const formatFinanceMoneyInput = (el) => {
    if (!el || el.disabled || el.readOnly) return;
    const raw = String(el.value || '').trim();
    if (!raw) return;
    el.value = formatPanamaNumber(parsePanamaNumber(raw));
  };

  document.addEventListener('focusout', (ev) => {
    const input = ev.target.closest?.(
      '.amount, [data-field="disbursementAmount"], [data-field="amortizedAmount"], [data-field="allocationAmount"], [data-field="checkAmount"], [data-field="promoterAmount"], #finLoanApproved, #finLoanDisbursed, #finBudgetApproved'
    );
    if (input) formatFinanceMoneyInput(input);
  });

  document.getElementById('addPhaseBtn')?.addEventListener('click', () => openPhaseEditor(null));
  document.getElementById('editFinanceConditionsBtn')?.addEventListener('click', () => setFinanceConditionsEditing(true));
  document.getElementById('cancelFinanceConditionsBtn')?.addEventListener('click', () => {
    renderFinanceConditions(state.project || {});
    setFinanceConditionsEditing(false);
  });
  document.getElementById('saveFinanceConditionsBtn')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    try { await saveFinanceConditions(); } catch (e) { console.error(e); alert(e.message || 'No se pudieron guardar las condiciones'); }
    finally { btn.disabled = false; }
  });
  document.getElementById('addPhaseUnifiedBtn')?.addEventListener('click', () => openPhaseEditor(null, 'plan'));
  document.querySelectorAll('[data-close-finance-phase]').forEach(el => el.addEventListener('click', closeFinancePhaseModal));
  document.getElementById('financePhaseFullscreenBtn')?.addEventListener('click', toggleFinancePhaseFullscreen);
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && !document.getElementById('financePhaseLinesModal')?.hidden) closeFinancePhaseModal();
  });
  document.getElementById('financeAddLoanLineBtn')?.addEventListener('click', () => {
    const lines = collectFinanceLoanLines();
    lines.push({
      _id: `new-${Date.now()}`,
      name: `Linea ${lines.length + 1}`,
      notes: '',
      phaseId: FINANCE_SELECTED_PHASE_ID || null,
      phaseName: FINANCE_SELECTED_PHASE_NAME || '',
      entries: [{
        _id: `new-entry-${Date.now()}`,
        disbursementDate: '',
        loanNumber: '',
        disbursementAmount: 0,
        maturityDate: '',
        amortizedAmount: 0,
        notes: '',
      }],
    });
    renderFinanceLoanLines(lines);
  });

  document.getElementById('financeLoanLinesBody')?.addEventListener('input', () => {
    renderFinanceControlKpis();
  });
  document.getElementById('financeLoanLinesBody')?.addEventListener('change', () => {
    if (FINANCE_LOAN_LINES_RENDER_TIMER) clearTimeout(FINANCE_LOAN_LINES_RENDER_TIMER);
    FINANCE_LOAN_LINES_RENDER_TIMER = setTimeout(() => {
      FINANCE_LOAN_LINES_RENDER_TIMER = null;
      if (FINANCE_LOAN_LINES_SAVE_IN_PROGRESS) return;
      renderFinanceLoanLines(collectFinanceLoanLines());
    }, 120);
  });
  document.getElementById('financeLoanLinesBody')?.addEventListener('click', async (ev) => {
    const toggleEntriesBtn = ev.target.closest('[data-finance-toggle-entries]');
    if (toggleEntriesBtn) {
      const card = toggleEntriesBtn.closest('.finance-loan-line-card');
      const key = String(card?.dataset.id || '');
      const wrap = card?.querySelector('[data-finance-entries-wrap]');
      const nextCollapsed = !wrap?.classList.contains('is-collapsed');
      wrap?.classList.toggle('is-collapsed', nextCollapsed);
      if (key) {
        if (nextCollapsed) {
          FINANCE_LOAN_LINE_COLLAPSED.add(key);
          FINANCE_LOAN_LINE_EXPANDED.delete(key);
        } else {
          FINANCE_LOAN_LINE_EXPANDED.add(key);
          FINANCE_LOAN_LINE_COLLAPSED.delete(key);
        }
      }
      const count = toggleEntriesBtn.dataset.count || '';
      toggleEntriesBtn.textContent = `${nextCollapsed ? 'Mostrar' : 'Ocultar'} partidas${count ? ` (${count})` : ''}`;
      toggleEntriesBtn.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
      return;
    }

    const saveBtn = ev.target.closest('[data-finance-save-line]');
    if (saveBtn) {
      await saveFinanceLoanLines(saveBtn);
      return;
    }

    const addEntryBtn = ev.target.closest('[data-finance-add-entry]');
    if (addEntryBtn) {
      const card = addEntryBtn.closest('.finance-loan-line-card');
      const lines = collectFinanceLoanLines();
      const target = lines.find(line => String(line._id || '') === String(card?.dataset.id || ''));
      const fallback = lines[Array.from(document.querySelectorAll('.finance-loan-line-card')).indexOf(card)];
      const line = target || fallback;
      if (line) {
        line.entries = line.entries || [];
        line.entries.push({
          _id: `new-entry-${Date.now()}`,
          disbursementDate: '',
          loanNumber: '',
          disbursementAmount: 0,
          maturityDate: '',
          amortizedAmount: 0,
          notes: '',
        });
      }
      renderFinanceLoanLines(lines);
      return;
    }

    const removeEntryBtn = ev.target.closest('[data-finance-remove-entry]');
    if (removeEntryBtn) {
      const row = removeEntryBtn.closest('[data-entry-row]');
      row?.remove();
      renderFinanceLoanLines(collectFinanceLoanLines());
      return;
    }

    const removeLineBtn = ev.target.closest('[data-finance-remove-line]');
    if (removeLineBtn) {
      removeLineBtn.closest('.finance-loan-line-card')?.remove();
      renderFinanceLoanLines(collectFinanceLoanLines());
    }
  });

  document.getElementById('financeUnitAmortizations')?.addEventListener('input', () => {
    renderFinanceControlKpis();
  });
  document.getElementById('financeUnitAmortizations')?.addEventListener('change', (ev) => {
    const source = ev.target.closest('[data-field="checkAmountSource"]');
    if (source) {
      const card = source.closest('.finance-unit-card');
      const checkInput = card?.querySelector('[data-field="checkAmount"]');
      const cpp = numOr0(card?.dataset.cppAmount);
      const initial = numOr0(card?.dataset.initialPayment);
      const sale = numOr0(card?.dataset.salePrice);
      if (checkInput) {
        checkInput.value = source.value === 'cpp_initial' ? cpp + initial : source.value === 'sale_price' ? sale : cpp;
      }
    }
    refreshFinanceDerivedUI();
  });
  document.getElementById('financeUnitAmortizations')?.addEventListener('click', (ev) => {
    const saveUnitBtn = ev.target.closest('[data-finance-save-unit]');
    if (saveUnitBtn) {
      saveFinanceSingleUnit(saveUnitBtn.closest('.finance-unit-card'), saveUnitBtn);
      return;
    }

    const btn = ev.target.closest('[data-finance-reset-unit]');
    if (!btn) return;
    const card = btn.closest('.finance-unit-card');
    card?.querySelectorAll('input').forEach(input => {
      if (['clientName', 'lot', 'buyerBank', 'checkAmount'].includes(input.dataset.field)) return;
      input.value = '';
    });
    refreshFinanceDerivedUI();
  });

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
  const elPUPct = document.getElementById('accPlanUsesPct');
  const elPSPct = document.getElementById('accPlanSourcesPct');
  const elRUPct = document.getElementById('accRealUsesPct');
  const elRSPct = document.getElementById('accRealSourcesPct');
  if (elPU) elPU.textContent = fmt(planUses);
  if (elPS) elPS.textContent = fmt(planSources);
  if (elRU) elRU.textContent = fmt(realUses);
  if (elRS) elRS.textContent = fmt(realSources);
  if (elPUPct) elPUPct.textContent = '100% del plan de usos';
  if (elPSPct) elPSPct.textContent = `${financePct(planSources, planUses)} de cobertura del plan`;
  if (elRUPct) elRUPct.textContent = `${financePct(realUses, planUses)} ejecutado vs plan`;
  if (elRSPct) elRSPct.textContent = `${financePct(realSources, planSources)} ejecutado vs plan`;
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

// Paleta de colores: tonos azules para Plan, rojos para Real
function getPhaseColors(count, type = 'plan') {
  const blues = [
    '#1e40af', '#1e3a8a', '#1e3f5f', '#2563eb', '#3b82f6',
    '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe', '#eff6ff'
  ];
  const reds = [
    '#7f1d1d', '#991b1b', '#b91c1c', '#dc2626', '#ef4444',
    '#f87171', '#fca5a5', '#fecaca', '#fee2e2', '#fef2f2'
  ];
  const palette = type === 'plan' ? blues : reds;
  const colors = [];
  for (let i = 0; i < count; i++) {
    colors.push(palette[i % palette.length]);
  }
  return colors;
}

function renderPhaseChart(phases, canvasId = 'phaseChart') {
  const el = document.getElementById(canvasId);
  if (!el) return;

  const existingChart = Chart.getChart?.(el) || el._chart;
  if (existingChart && typeof existingChart.destroy === 'function') existingChart.destroy();

  const labels = (phases || []).map(p => p.name || p.title || p.phase || 'Fase');

  // Extraer todos los tipos de usos únicos
  const allUseTypes = new Set();
  (phases || []).forEach(p => {
    (p.planUses || []).forEach(u => allUseTypes.add(u.name || u.id || 'Sin nombre'));
    (p.uses || []).forEach(u => allUseTypes.add(u.name || u.id || 'Sin nombre'));
  });
  const useTypes = Array.from(allUseTypes).sort();

  // Paletas de colores
  const planColors = getPhaseColors(useTypes.length, 'plan');
  const realColors = getPhaseColors(useTypes.length, 'real');

  // Crear datasets: uno por cada tipo de uso (Plan y Real separados en stacks)
  const datasets = [];

  // Datasets para PLAN
  useTypes.forEach((useName, idx) => {
    const planData = (phases || []).map(p => {
      const item = (p.planUses || []).find(u => (u.name || u.id || 'Sin nombre') === useName);
      return parsePanamaNumber(item?.amount || 0);
    });
    datasets.push({
      label: `${useName} (Plan)`,
      data: planData,
      stack: 'plan',
      backgroundColor: planColors[idx],
      borderColor: planColors[idx]
    });
  });

  // Datasets para REAL
  useTypes.forEach((useName, idx) => {
    const realData = (phases || []).map(p => {
      const item = (p.uses || []).find(u => (u.name || u.id || 'Sin nombre') === useName);
      return parsePanamaNumber(item?.amount || 0);
    });
    datasets.push({
      label: `${useName} (Real)`,
      data: realData,
      stack: 'real',
      backgroundColor: realColors[idx],
      borderColor: realColors[idx]
    });
  });

  const chart = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: true, axis: 'xy' },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12 } },
        tooltip: {
          mode: 'nearest',
          intersect: true,
          callbacks: {
            title: (items) => items?.[0]?.label || '',
            label: (ctx) => {
              const value = numOr0(ctx.parsed.y);
              const stackTotal = (ctx.chart?.data?.datasets || [])
                .filter(ds => ds.stack === ctx.dataset.stack)
                .reduce((sum, ds) => sum + numOr0(ds.data?.[ctx.dataIndex]), 0);
              return `${ctx.dataset.label}: ${fmt(value)} (${financePct(value, stackTotal)})`;
            }
          }
        }
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true }
      }
    }
  });

  el._chart = chart;
}

// -------------------------
// Render: gráfica por fases FUENTES (barras apiladas por tipo de fuente)
// Similar a renderPhaseChart pero para sources en lugar de uses
// -------------------------
function renderPhaseSourceChart(phases, canvasId = 'phaseSourceChart') {
  const el = document.getElementById(canvasId);
  if (!el) return;

  const existingChart = Chart.getChart?.(el) || el._chart;
  if (existingChart && typeof existingChart.destroy === 'function') existingChart.destroy();

  const labels = (phases || []).map(p => p.name || p.title || p.phase || 'Fase');

  // Extraer todos los tipos de fuentes únicos
  const allSourceTypes = new Set();
  (phases || []).forEach(p => {
    (p.planSources || []).forEach(s => allSourceTypes.add(s.name || s.id || 'Sin nombre'));
    (p.sources || []).forEach(s => allSourceTypes.add(s.name || s.id || 'Sin nombre'));
  });
  const sourceTypes = Array.from(allSourceTypes).sort();

  // Paletas de colores
  const planColors = getPhaseColors(sourceTypes.length, 'plan');
  const realColors = getPhaseColors(sourceTypes.length, 'real');

  // Crear datasets: uno por cada tipo de fuente (Plan y Real separados en stacks)
  const datasets = [];

  // Datasets para PLAN
  sourceTypes.forEach((sourceName, idx) => {
    const planData = (phases || []).map(p => {
      const item = (p.planSources || []).find(s => (s.name || s.id || 'Sin nombre') === sourceName);
      return parsePanamaNumber(item?.amount || 0);
    });
    datasets.push({
      label: `${sourceName} (Plan)`,
      data: planData,
      stack: 'plan',
      backgroundColor: planColors[idx],
      borderColor: planColors[idx]
    });
  });

  // Datasets para REAL
  sourceTypes.forEach((sourceName, idx) => {
    const realData = (phases || []).map(p => {
      const item = (p.sources || []).find(s => (s.name || s.id || 'Sin nombre') === sourceName);
      return parsePanamaNumber(item?.amount || 0);
    });
    datasets.push({
      label: `${sourceName} (Real)`,
      data: realData,
      stack: 'real',
      backgroundColor: realColors[idx],
      borderColor: realColors[idx]
    });
  });

  const chart = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: true, axis: 'xy' },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12 } },
        tooltip: {
          mode: 'nearest',
          intersect: true,
          callbacks: {
            title: (items) => items?.[0]?.label || '',
            label: (ctx) => {
              const value = numOr0(ctx.parsed.y);
              const stackTotal = (ctx.chart?.data?.datasets || [])
                .filter(ds => ds.stack === ctx.dataset.stack)
                .reduce((sum, ds) => sum + numOr0(ds.data?.[ctx.dataIndex]), 0);
              return `${ctx.dataset.label}: ${fmt(value)} (${financePct(value, stackTotal)})`;
            }
          }
        }
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true }
      }
    }
  });

  el._chart = chart;
}

// -------------------------
// Render: fases (cards) con PLAN vs REAL + desembolso
// -------------------------
function renderFinanceTimeCharts(phases = [], opts = {}) {
  if (typeof Chart === 'undefined') return;
  const {
    durationCanvasId = 'phaseTimeDurationChart',
    delayCanvasId = 'phaseTimeDelayChart',
    delaySummaryId = 'phaseTimeDelaySummary',
    durationSummaryId = '',
  } = opts || {};
  const labels = phases.map((phase, index) => phase.name || `Fase ${index + 1}`);
  const dayMs = 86400000;
  const validDate = value => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  };
  const today = new Date();
  const plannedDuration = phases.map(phase => {
    const start = validDate(phase.startDate);
    const end = validDate(phase.endDate);
    return start && end ? Math.max(0, Math.ceil((end - start) / dayMs)) : null;
  });
  const actualDuration = phases.map(phase => {
    const hasLegacyReal = sumItems(phase.uses) > 0 || sumItems(phase.sources) > 0 || numOr0(phase.disbActual) > 0;
    const start = validDate(phase.actualStartDate) || (hasLegacyReal ? validDate(phase.startDate) : null);
    if (!start) return null;
    const end = validDate(phase.actualEndDate || phase.completedAt) || today;
    return Math.max(0, Math.ceil((end - start) / dayMs));
  });
  const timingStatus = phases.map(phase => {
    const plannedEnd = validDate(phase.endDate);
    const hasLegacyReal = sumItems(phase.uses) > 0 || sumItems(phase.sources) > 0 || numOr0(phase.disbActual) > 0;
    const actualStart = validDate(phase.actualStartDate) || (hasLegacyReal ? validDate(phase.startDate) : null);
    const finishedAt = validDate(phase.actualEndDate || phase.completedAt);
    if (!plannedEnd) return { value: 0, tone: 'neutral', label: 'Sin fecha final estimada' };
    const plannedLabel = plannedEnd.toLocaleDateString();
    if (!actualStart) return { value: 0, tone: 'neutral', label: `Sin iniciar · fin previsto ${plannedLabel}` };
    if (finishedAt) {
      const value = Math.ceil((finishedAt - plannedEnd) / dayMs);
      return value > 0
        ? { value, tone: 'danger', label: `Finalizada con ${value} día(s) de retraso` }
        : value < 0
          ? { value, tone: 'ok', label: `Finalizada ${Math.abs(value)} día(s) antes` }
          : { value: 0, tone: 'ok', label: 'Finalizada en fecha' };
    }
    const remaining = Math.ceil((plannedEnd - today) / dayMs);
    return remaining < 0
      ? { value: Math.abs(remaining), tone: 'danger', label: `En curso · ${Math.abs(remaining)} día(s) de retraso` }
      : { value: 0, tone: 'active', label: `En plazo · faltan ${remaining} día(s)` };
  });
  const endDeviation = timingStatus.map(item => item.value);

  const durationCanvas = document.getElementById(durationCanvasId);
  if (durationCanvas) {
    const existingDurationChart = Chart.getChart?.(durationCanvas) || durationCanvas._chart;
    existingDurationChart?.destroy?.();
    durationCanvas._chart = new Chart(durationCanvas.getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'Duración estimada', data: plannedDuration, backgroundColor: 'rgba(245,158,11,.72)', borderColor: '#f59e0b', borderWidth: 1, borderRadius: 6 },
        { label: 'Duración real', data: actualDuration, backgroundColor: 'rgba(56,189,248,.72)', borderColor: '#38bdf8', borderWidth: 1, borderRadius: 6 }
      ] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { tooltip: { callbacks: { label: context => `${context.dataset.label}: ${Number(context.raw || 0)} día(s)` } } },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'Días' } } }
      }
    });
  }

  const delayCanvas = document.getElementById(delayCanvasId);
  if (delayCanvas) {
    const existingDelayChart = Chart.getChart?.(delayCanvas) || delayCanvas._chart;
    existingDelayChart?.destroy?.();
    delayCanvas._chart = new Chart(delayCanvas.getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [{
        label: 'Desviación temporal',
        data: endDeviation,
        backgroundColor: timingStatus.map(item => item.tone === 'danger' ? 'rgba(239,68,68,.75)' : item.tone === 'ok' ? 'rgba(34,197,94,.72)' : item.tone === 'active' ? 'rgba(56,189,248,.72)' : 'rgba(148,163,184,.45)'),
        borderColor: timingStatus.map(item => item.tone === 'danger' ? '#ef4444' : item.tone === 'ok' ? '#22c55e' : item.tone === 'active' ? '#38bdf8' : '#94a3b8'),
        borderWidth: 1,
        borderRadius: 6,
        borderSkipped: false,
        minBarLength: 7
      }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { tooltip: { callbacks: { label: context => timingStatus[context.dataIndex]?.label || 'Sin datos' } } },
        scales: { y: {
          suggestedMin: -Math.max(1, ...endDeviation.map(value => Math.abs(value))) * 1.15,
          suggestedMax: Math.max(1, ...endDeviation.map(value => Math.abs(value))) * 1.15,
          ticks: { precision: 0 },
          title: { display: true, text: '+ retraso / − adelanto' }
        } }
      }
    });
  }
  const delaySummary = document.getElementById(delaySummaryId);
  if (delaySummary) delaySummary.innerHTML = timingStatus.map((item, index) => `
    <div class="finance-time-status is-${item.tone}"><strong>${escapeHtml(labels[index])}</strong><span>${escapeHtml(item.label)}</span></div>
  `).join('');
  if (durationSummaryId) {
    renderChartSummary(
      durationSummaryId,
      labels.map((label, index) => ({
        label,
        value: plannedDuration[index] || 0,
        actual: actualDuration[index] || 0
      })),
      {
        totalLabel: 'Duración estimada total',
        formatter: (v, item) => item
          ? `${Number(v || 0)} día(s) estimado · ${Number(item?.actual || 0)} día(s) real`
          : `${Number(v || 0)} día(s) estimado`
      }
    );
  }
}

function openFinancePhaseLines(phase) {
  FINANCE_SELECTED_PHASE_ID = String(phase?._id || '');
  FINANCE_SELECTED_PHASE_NAME = phase?.name || '';
  const modal = mountFinancePhaseModal();
  if (!modal) return;
  modal.classList.remove('is-fullscreen');
  modal.style.zoom = '';
  const expand = document.getElementById('financePhaseFullscreenBtn');
  if (expand) { expand.textContent = '⛶'; expand.title = 'Pantalla completa'; }
  document.getElementById('financePhaseModalTitle').textContent = `Líneas — ${FINANCE_SELECTED_PHASE_NAME}`;
  const savedLines = financeLinesForPhase(FINANCE_SELECTED_PHASE_ID);
  const lines = financeLoanLinesWithApprovedSeeds(savedLines, phase);
  const funding = financePhaseFunding(phase);
  const fundingSummary = document.getElementById('financePhaseFundingSummary');
  if (fundingSummary) fundingSummary.innerHTML = [
    ['Banco recomendado', funding.recommendedBank],
    ['Desembolsado', funding.disbursed],
    ['Amortizado', funding.amortized],
    ['Saldo por devolver', funding.debt],
    ['Pendiente por desembolsar', funding.pendingRecommendedDisbursement],
  ].map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${financeMoney(value)}</strong></div>`).join('');
  renderFinanceLoanLines(lines);
  renderFinanceUnitAmortizations();
  modal.hidden = false;
  document.body.classList.add('finance-modal-open');
  setTimeout(() => window.Chart?.getChart?.(document.getElementById('financeLoanLinesChart'))?.resize(), 30);
}

async function toggleFinancePhaseCompletion(phase) {
  const reopening = !!phase?.isCompleted;
  if (!confirm(reopening ? `¿Reabrir ${phase.name || 'esta fase'}?` : `¿Marcar ${phase.name || 'esta fase'} como finalizada?`)) return;
  const today = new Date().toISOString().slice(0, 10);
  try {
    await API.put(`/api/projects/${id}/finance/phases/${phase._id}`, reopening ? {
      isCompleted: false, completedAt: null, actualEndDate: null
    } : {
      isCompleted: true,
      completedAt: new Date().toISOString(),
      actualStartDate: phase.actualStartDate || today,
      actualEndDate: phase.actualEndDate || today
    });
    await loadFinance();
    await markProjectDataChanged();
  } catch (e) {
    console.error(e);
    alert('No se pudo actualizar el estado de la fase');
  }
}

function renderUnifiedFinancePhases(phases = []) {
  const wrap = document.getElementById('phasesUnifiedList');
  if (!wrap) return;
  const dateFmt = value => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : '—';
  };
  wrap.innerHTML = (phases || []).map(ph => {
    const planUses = sumItems(ph.planUses);
    const planSources = sumItems(ph.planSources);
    const realUses = sumItems(ph.uses);
    const realSources = sumItems(ph.sources);
    const expected = numOr0(ph.disbExpected);
    const actual = numOr0(ph.disbActual);
    const execution = planUses > 0 ? (realUses / planUses) * 100 : 0;
    const hasReal = !!ph.actualStartDate || !!ph.actualEndDate || realUses > 0 || realSources > 0 || actual > 0;
    const isCompleted = !!ph.isCompleted;
    const status = isCompleted
      ? { label: 'Finalizada', tone: 'ok' }
      : !hasReal
        ? { label: 'Estimación', tone: 'neutral' }
      : ph.disbRequested && actual < expected
        ? { label: 'Bloqueado', tone: 'danger' }
        : getPhaseStatus(ph).key === 'OK' ? { label: 'OK', tone: 'ok' } : { label: 'Desviación', tone: 'error' };
    const planEnd = ph.endDate ? new Date(ph.endDate) : null;
    const realEnd = ph.actualEndDate || ph.completedAt ? new Date(ph.actualEndDate || ph.completedAt) : null;
    const compareDate = realEnd || new Date();
    const dayDelta = planEnd && !Number.isNaN(planEnd.getTime()) ? Math.ceil((compareDate - planEnd) / 86400000) : 0;
    const timingText = isCompleted
      ? (dayDelta > 0 ? `Finalizada con ${dayDelta} día(s) de retraso` : dayDelta < 0 ? `Finalizada ${Math.abs(dayDelta)} día(s) antes` : 'Finalizada en la fecha prevista')
      : !hasReal ? 'Pendiente de iniciar ejecución real'
      : dayDelta > 0 ? `${dayDelta} día(s) de retraso sobre el plan` : `${Math.abs(dayDelta)} día(s) hasta el fin estimado`;
    return `
      <article class="card fin-phase-card finance-unified-phase" data-variant="unified" data-unified-phase="${escapeHtml(ph._id || '')}">
        <div class="fin-phase-head">
          <div class="fin-phase-left">
            <div class="fin-phase-name">${escapeHtml(ph.name || 'Fase')}</div>
            <div class="fin-phase-dates">${dateFmt(ph.startDate)} → ${dateFmt(ph.endDate)}</div>
            <div class="fin-phase-badges"><span class="fin-tag ${status.tone}">${status.label}</span></div>
          </div>
          <div class="fin-phase-actions">
            <button class="fin-btn fin-btn-edit" data-phase-edit-plan>Editar plan</button>
            <button class="fin-btn fin-btn-edit" data-phase-edit-real>${hasReal ? 'Editar real' : 'Iniciar real'}</button>
            <button class="fin-btn fin-btn-del" data-phase-delete>Eliminar</button>
          </div>
        </div>
        <div class="fin-phase-body">
        <div class="finance-phase-comparison">
          <section class="finance-phase-side is-plan">
            <div class="finance-phase-side-head"><span class="fin-tag neutral">Estimación</span><span>${dateFmt(ph.startDate)} → ${dateFmt(ph.endDate)}</span></div>
            <div class="fin-kpi-grid">
              <div class="fin-kpi"><div class="label">Usos plan</div><div class="value">${fmt(planUses)}</div></div>
              <div class="fin-kpi"><div class="label">Fuentes plan</div><div class="value">${fmt(planSources)}</div></div>
            </div>
          </section>
          <section class="finance-phase-side is-real">
            <div class="finance-phase-side-head"><span class="fin-tag ${isCompleted ? 'ok' : 'neutral'}">Real</span><span>${hasReal ? `${dateFmt(ph.actualStartDate)} → ${isCompleted || ph.actualEndDate ? dateFmt(ph.actualEndDate || ph.completedAt) : 'En curso'}` : 'Sin iniciar'}</span></div>
            <div class="fin-kpi-grid">
              <div class="fin-kpi"><div class="label">Usos real</div><div class="value">${fmt(realUses)}</div></div>
              <div class="fin-kpi"><div class="label">Fuentes real</div><div class="value">${fmt(realSources)}</div></div>
            </div>
          </section>
        </div>
        <div class="fin-line finance-unified-disbursement">
          <div class="label">Desembolso banco</div>
          <div class="small">Esperado: <b>${fmt(expected)}</b> · Real: <b>${fmt(actual)}</b> · Ejecutado: <b>${financePct(actual, expected)}</b></div>
        </div>
        <div class="finance-phase-ratio">Ejecución real vs plan: <b>${execution.toFixed(1)}%</b> · Calendario: <b>${timingText}</b></div>
        <div class="finance-phase-progress"><div style="width:${Math.min(100, Math.max(0, execution))}%"></div></div>
        <div class="finance-unified-actions">
          <button class="btn" data-phase-lines>Líneas de la fase</button>
          <button class="btn ${isCompleted ? 'btn-ghost' : 'btn-success'}" data-phase-complete>${isCompleted ? 'Reabrir fase' : 'Marcar finalizada'}</button>
        </div>
        </div>
      </article>`;
  }).join('') || '<div class="small muted">Todavía no hay fases financieras.</div>';

  wrap.querySelectorAll('[data-unified-phase]').forEach(card => {
    const phase = phases.find(item => String(item._id) === String(card.dataset.unifiedPhase));
    card.querySelector('[data-phase-edit-plan]')?.addEventListener('click', () => openPhaseEditor(phase, 'plan'));
    card.querySelector('[data-phase-edit-real]')?.addEventListener('click', () => openPhaseEditor(phase, 'real'));
    card.querySelector('[data-phase-delete]')?.addEventListener('click', async () => {
      if (!phase?._id || !confirm(`¿Eliminar ${phase.name || 'esta fase'}?`)) return;
      try {
        await API.del(`/api/projects/${id}/finance/phases/${phase._id}`);
        await loadFinance();
        await markProjectDataChanged();
      } catch (e) {
        console.error(e);
        alert('No se pudo eliminar la fase');
      }
    });
    card.querySelector('[data-phase-complete]')?.addEventListener('click', () => toggleFinancePhaseCompletion(phase));
    card.querySelector('[data-phase-lines]')?.addEventListener('click', () => openFinancePhaseLines(phase));
  });
}

function renderPhases(phases = []) {
  const canEditFinanceStructure = ['admin', 'bank', 'financiero', 'gerencia', 'socios'].includes(myRole);
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

  const allPlanUses = (phases || []).reduce((a, ph) => a + sumItems(ph?.planUses), 0);
  const allPlanSources = (phases || []).reduce((a, ph) => a + sumItems(ph?.planSources), 0);
  const allRealUses = (phases || []).reduce((a, ph) => a + sumItems(ph?.uses), 0);
  const allRealSources = (phases || []).reduce((a, ph) => a + sumItems(ph?.sources), 0);

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
    const phaseHasReal = !!ph?.actualStartDate || !!ph?.actualEndDate || sumItems(ph?.uses) > 0 || sumItems(ph?.sources) > 0 || numOr0(ph?.disbActual) > 0;
    const editLabel = variant === 'plan' ? 'Editar plan' : (phaseHasReal ? 'Editar real' : 'Iniciar real');

    // Badge: para REAL, si está solicitado, lo marcamos claro
    const disbReq = !!ph?.disbRequested;
    const disbBadge = disbReq
      ? `<span class="fin-tag danger">Desembolso solicitado</span>`
      : '';

    // Tono status solo lo muestro en REAL (para no ensuciar PLAN)
    const statusBadge = (variant === 'real')
      ? (ph?.isCompleted
          ? `<span class="fin-tag ok">Finalizada</span>`
          : phaseHasReal ? `<span class="fin-tag ${st.tone}">${st.label}</span>` : `<span class="fin-tag neutral">Pendiente de iniciar</span>`)
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
          ${canEditFinanceStructure ? `<button class="fin-btn fin-btn-edit" data-act="edit">${editLabel}</button>` : ''}
          ${canEditFinanceStructure ? '<button class="fin-btn fin-btn-del" data-act="del">Eliminar</button>' : ''}
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
    const planUsesShare = financePct(planUsesTotal, allPlanUses);
    const planSourcesShare = financePct(planSrcsTotal, allPlanSources);
    const realUsesExecution = financePct(realUsesTotal, planUsesTotal);
    const realSourcesExecution = financePct(realSrcsTotal, planSrcsTotal);
    const disbursementExecution = financePct(disbActual, disbExpected);
    const funding = financePhaseFunding(ph);

    // -------------------------
    // CARD PLAN (estimación)
    // -------------------------
    const planBody = `
      <div class="fin-kpi-grid">
        <div class="fin-kpi">
          <div class="label">Usos plan</div>
          <div class="value">${fmt(planUsesTotal)}</div>
          <div class="finance-percent-note">${planUsesShare} del plan total</div>
        </div>
        <div class="fin-kpi">
          <div class="label">Fuentes plan</div>
          <div class="value">${fmt(planSrcsTotal)}</div>
          <div class="finance-percent-note">${planSourcesShare} de las fuentes totales</div>
        </div>
      </div>
      <div class="finance-phase-ratio">
        Cobertura fuentes / usos: <b>${financePct(planSrcsTotal, planUsesTotal)}</b>
      </div>
      <div class="finance-phase-funding is-plan">
        <div class="finance-phase-funding-title">Distribución recomendada por las condiciones</div>
        <div><span>Banco (${funding.bankPct.toFixed(1)}%)</span><b>${financeMoney(funding.recommendedBank)}</b></div>
        <div><span>Promotor (${funding.promoterPct.toFixed(1)}%)</span><b>${financeMoney(funding.recommendedPromoter)}</b></div>
      </div>
      <div class="small muted" style="margin-top:8px;">
        Recomendación informativa: no modifica tus fuentes guardadas.
      </div>
      <div class="finance-phase-conditions-inline" style="margin-top:12px;">
        ${financePhaseConditionsHtml(ph)}
      </div>
      <div class="finance-phase-card-actions"><button class="btn btn-xs" data-act="lines">Gestionar desembolsos</button></div>
    `;

    const planCard = makeCardShell({ variant: 'plan', ph, titleRight: planBody });

    // Actions PLAN
    planCard.querySelector('[data-act="edit"]')?.addEventListener('click', () => openPhaseEditor(ph, 'plan'));
    planCard.querySelector('[data-act="lines"]')?.addEventListener('click', () => openFinancePhaseLines(ph));

    planCard.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
      if (!ph?._id) return alert('Fase inválida');
      if (!confirm('¿Eliminar fase?')) return;
      try {
        await API.del(`/api/projects/${id}/finance/phases/${ph._id}`);
        await loadFinance();
        await markProjectDataChanged();
      } catch (e) {
        console.error(e);
        alert('No se pudo eliminar la fase');
      }
    });

    wrapPlan.appendChild(planCard);

const hasRealData =
  !!ph?.actualStartDate ||
  !!ph?.actualEndDate ||
  (realUsesTotal > 0) ||
  (realSrcsTotal > 0) ||
  (disbActual > 0);

    // -------------------------
    // CARD REAL (ejecución)
    // -------------------------
    const realBody = `
      <div class="finance-real-date-row">
        <span>Fechas plan: <b>${dateFmt(ph?.startDate)} → ${dateFmt(ph?.endDate)}</b></span>
        <span>Fechas real: <b>${ph?.actualStartDate ? dateFmt(ph.actualStartDate) : 'Sin iniciar'} → ${ph?.actualEndDate || ph?.completedAt ? dateFmt(ph.actualEndDate || ph.completedAt) : (hasRealData ? 'En curso' : '—')}</b></span>
      </div>
      <div class="fin-kpi-grid">
        <div class="fin-kpi">
          <div class="label">Usos real</div>
          <div class="value">${fmt(realUsesTotal)}</div>
          <div class="finance-percent-note">${realUsesExecution} ejecutado vs plan</div>
          <div class="finance-phase-progress"><div style="width:${financeProgressWidth(realUsesTotal, planUsesTotal)}%"></div></div>
        </div>
        <div class="fin-kpi">
          <div class="label">Fuentes real</div>
          <div class="value">${fmt(realSrcsTotal)}</div>
          <div class="finance-percent-note">${realSourcesExecution} ejecutado vs plan</div>
          <div class="finance-phase-progress"><div style="width:${financeProgressWidth(realSrcsTotal, planSrcsTotal)}%"></div></div>
        </div>
      </div>

      <div class="finance-phase-ratio">
        Peso en la ejecución total: usos <b>${financePct(realUsesTotal, allRealUses)}</b> · fuentes <b>${financePct(realSrcsTotal, allRealSources)}</b>
      </div>

      <div class="fin-line" style="margin-top:10px;">
        <div class="label">Desembolso (banco)</div>
        <div class="row between" style="align-items:center;">
          <div class="small">
            Esperado: <b>${fmt(disbExpected)}</b> · Real: <b>${fmt(disbActual)}</b> · Ejecutado: <b>${disbursementExecution}</b>
          </div>
          <div class="row gap">
            <button class="btn btn-warning btn-xs" data-act="request">Solicitar</button>
            <button class="btn btn-ghost btn-xs" data-act="clearRequest">Resuelto</button>
          </div>
        </div>
        <div class="finance-phase-progress"><div style="width:${financeProgressWidth(disbActual, disbExpected)}%"></div></div>
      </div>
      <div class="finance-phase-funding is-real">
        <div class="finance-phase-funding-title">Banco en esta fase · ${funding.linesCount} línea(s)</div>
        <div><span>Desembolsado por líneas</span><b>${financeMoney(funding.disbursed)}</b></div>
        <div><span>Amortizado</span><b>${financeMoney(funding.amortized)}</b></div>
        <div class="is-debt"><span>Saldo por devolver</span><b>${financeMoney(funding.debt)}</b></div>
        <div><span>Pendiente vs recomendación</span><b>${financeMoney(funding.pendingRecommendedDisbursement)}</b></div>
      </div>
      <div class="finance-phase-card-actions">
        <button class="btn btn-xs" data-act="lines">Líneas de la fase</button>
        <button class="btn btn-xs ${ph?.isCompleted ? 'btn-ghost' : 'btn-success'}" data-act="complete">${ph?.isCompleted ? 'Reabrir fase' : 'Marcar finalizada'}</button>
      </div>
    `;

    const realCard = makeCardShell({ variant: 'real', ph, titleRight: realBody });

    // Actions REAL
    realCard.querySelector('[data-act="edit"]')?.addEventListener('click', () => openPhaseEditor(ph, 'real'));
    realCard.querySelector('[data-act="lines"]')?.addEventListener('click', () => openFinancePhaseLines(ph));
    realCard.querySelector('[data-act="complete"]')?.addEventListener('click', () => toggleFinancePhaseCompletion(ph));

    realCard.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
      if (!ph?._id) return alert('Fase inválida');
      if (!confirm('¿Eliminar fase?')) return;
      try {
        await API.del(`/api/projects/${id}/finance/phases/${ph._id}`);
        await loadFinance();
        await markProjectDataChanged();
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
        const suggested = Math.max(0, funding.recommendedBank);
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
        await markProjectDataChanged();
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
        await markProjectDataChanged();
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
const FINANCE_PHASE_CONDITION_FORM_FIELDS = [
  ['interimBank','Banco/interino','input','Banco General / Banistmo'],
  ['letterDate','Fecha de carta','date',''],
  ['letterReference','Numero o referencia de carta','input','Carta term sheet BG-2026-015'],
  ['phaseTotal','Total de la fase','number','10000000'],
  ['bankFinancedAmount','Financiacion bancaria','number','250000'],
  ['promoterContribution','Aporte del promotor','number','100000'],
  ['bankFinancedPct','% banco','number','70'],
  ['promoterContributionPct','% promotor','number','30'],
  ['generalConditions','Condiciones generales de la fase','textarea','Facilidad aprobada sujeta a cumplimiento de hitos tecnicos y legales'],
  ['guarantees','Garantias','textarea','Hipoteca, fideicomiso de garantia, cesion de ventas, fianza solidaria'],
  ['insurance','Seguros','textarea','CAR, incendio, cumplimiento, fianza de pago'],
  ['requiredPresales','Preventa requerida','textarea','40% de preventa evidenciada mediante CPP cedida al banco'],
  ['precedentConditions','Condiciones precedentes','textarea','Permisos aprobados, planos aprobados, seguros entregados, garantias constituidas'],
  ['otherRequirements','Detalle de otros requisitos','textarea','Permisos especiales, aprobaciones municipales o condiciones adicionales del banco'],
  ['disbursementConditions','Condiciones de desembolso','textarea','Contra avance certificado por inspector autorizado'],
  ['amortizationConditions','Condiciones de amortizacion/pago','textarea','Intereses y FECI mensuales, capital al vencimiento'],
  ['promoterObligations','Obligaciones del promotor','textarea','Aportes de capital previos a cada desembolso y entrega mensual de reportes'],
  ['covenants','Restricciones/covenants','textarea','No endeudamiento con otros bancos, no cambios accionarios sin autorizacion'],
  ['trustee','Fiduciaria','input','BG Trust, S.A.'],
  ['trustType','Tipo de fideicomiso','input','Fideicomiso de garantia y administracion'],
  ['technicalInspector','Inspector tecnico','input','Inspector autorizado por el banco'],
  ['financialInspector','Inspector financiero','input','Auditor financiero del banco'],
  ['generalObservations','Observaciones generales','textarea','Condiciones sujetas a contrato definitivo y aprobaciones internas']
];

function phaseConditionsFormHtml(conditions = {}) {
  return `<div class="finance-conditions-subgrid">${FINANCE_PHASE_CONDITION_FORM_FIELDS.map(([key, label, type, placeholder]) => {
    const value = key === 'letterDate' ? financeDateInput(conditions[key]) : (conditions[key] || '');
    if (type === 'textarea') return `<label><span>${escapeHtml(label)}</span><textarea class="input" data-phase-condition="${key}" rows="2" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea></label>`;
    if (key === 'interimBank' && window.BankSelect) {
      const known = (window.BANKS_PANAMA || []).some(bank => String(bank).toLowerCase() === String(value).toLowerCase());
      return `<label><span>${escapeHtml(label)}</span><select class="input" data-phase-condition="${key}" data-phase-bank>${window.BankSelect.bankOptionsHtml(value)}</select><input class="input" data-phase-bank-other value="${known ? '' : escapeHtml(value)}" placeholder="Especificar banco" style="display:${value && !known ? '' : 'none'};margin-top:6px;"></label>`;
    }
    return `<label><span>${escapeHtml(label)}</span><input class="input" data-phase-condition="${key}" type="${type}" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}"></label>`;
  }).join('')}</div>`;
}

function phaseFinancingLinesFormHtml(lines = []) {
  const safeLines = Array.isArray(lines) && lines.length
    ? lines
    : ['Terreno', 'Infraestructura', 'Construccion', 'Costos directos', 'Costos indirectos', 'Otra'].map(name => ({ name }));
  return `<div id="ph-financing-lines">${safeLines.map(line => `
    <div class="finance-facility-form-row" data-phase-financing-line>
      <label><span>Nombre/facilidad</span><input class="input" data-phase-financing="name" value="${escapeHtml(line.name || '')}" placeholder="Terreno"></label>
      <label><span>Monto aprobado</span><input class="input" data-phase-financing="approvedAmount" type="number" step="any" value="${numOr0(line.approvedAmount) || ''}" placeholder="250000"></label>
      <label><span>Tasa de interes</span><input class="input" data-phase-financing="interestRate" value="${escapeHtml(line.interestRate || '')}" placeholder="SOFR + 3.50%"></label>
      <label><span>Plazo</span><input class="input" data-phase-financing="term" value="${escapeHtml(line.term || '')}" placeholder="24 meses"></label>
      <label><span>Forma de pago</span><input class="input" data-phase-financing="paymentMethod" value="${escapeHtml(line.paymentMethod || '')}" placeholder="Intereses y FECI mensuales, capital al vencimiento"></label>
      <label><span>Forma de desembolso</span><input class="input" data-phase-financing="disbursementMethod" value="${escapeHtml(line.disbursementMethod || '')}" placeholder="Contra avance certificado por inspector autorizado"></label>
      <label><span>Comision</span><input class="input" data-phase-financing="commission" value="${escapeHtml(line.commission || '')}" placeholder="1% flat"></label>
      <label><span>Observaciones</span><input class="input" data-phase-financing="observations" value="${escapeHtml(line.observations || '')}" placeholder="Observaciones"></label>
      <button class="btn btn-danger btn-xs" type="button" data-remove-phase-financing>Quitar</button>
    </div>`).join('')}</div><button class="btn btn-ghost btn-xs" type="button" data-add-phase-financing>+ Añadir linea</button>`;
}

function collectPhaseFinancialConditionsFromModal() {
  const out = {};
  document.querySelectorAll('[data-phase-condition]').forEach(input => {
    out[input.dataset.phaseCondition] = input.matches('[data-phase-bank]')
      ? (input.value === '__OTHER__' ? input.parentElement?.querySelector('[data-phase-bank-other]')?.value?.trim() || '' : input.value || '')
      : (input.value?.trim() || '');
  });
  return out;
}

function collectPhaseFinancingLinesFromModal() {
  return Array.from(document.querySelectorAll('[data-phase-financing-line]')).map(row => ({
    name: row.querySelector('[data-phase-financing="name"]')?.value.trim() || '',
    approvedAmount: numOr0(row.querySelector('[data-phase-financing="approvedAmount"]')?.value),
    interestRate: row.querySelector('[data-phase-financing="interestRate"]')?.value.trim() || '',
    term: row.querySelector('[data-phase-financing="term"]')?.value.trim() || '',
    paymentMethod: row.querySelector('[data-phase-financing="paymentMethod"]')?.value.trim() || '',
    disbursementMethod: row.querySelector('[data-phase-financing="disbursementMethod"]')?.value.trim() || '',
    commission: row.querySelector('[data-phase-financing="commission"]')?.value.trim() || '',
    observations: row.querySelector('[data-phase-financing="observations"]')?.value.trim() || ''
  })).filter(item => Object.values(item).some(value => String(value ?? '').trim() !== '' && numOr0(value) !== 0));
}

function openPhaseEditor(ph = null, focus = 'plan') {
  if (!['admin', 'bank', 'financiero', 'gerencia', 'socios'].includes(myRole)) {
    alert('No tienes permiso para editar las fases financieras.');
    return;
  }
  const isEdit = !!ph;
  const hasExistingReal = !!ph?.actualStartDate || !!ph?.actualEndDate || sumItems(ph?.uses) > 0 || sumItems(ph?.sources) > 0 || numOr0(ph?.disbActual) > 0;
  const fundingBasis = financeProjectBasis();

  // Necesario para "Iniciar REAL" sin crear fase nueva:
  const allPhases = (window.FINANCE?.phases || []);

  const tbl = (tableId, rows) => `
    <table class="table" id="${tableId}">
      <thead><tr><th>Partida</th><th class="right">Monto</th><th></th></tr></thead>
      <tbody>
        ${(rows || []).map(r => `
          <tr>
            <td><input class="input" type="text" value="${(r.name||'').replace(/"/g,'&quot;')}" placeholder="Partida"/></td>
            <td class="right"><input class="input amount" type="text" inputmode="decimal" value="${formatPanamaNumber(r.amount)}"/></td>
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
    actualStartDate: ph?.actualStartDate ? new Date(ph.actualStartDate).toISOString().slice(0,10) : '',
    actualEndDate: ph?.actualEndDate ? new Date(ph.actualEndDate).toISOString().slice(0,10) : '',

    planUses: Array.isArray(ph?.planUses) ? ph.planUses.slice() : [],
    planSources: Array.isArray(ph?.planSources) ? ph.planSources.slice() : [],
    financialConditions: ph?.financialConditions || {},
    financingLines: Array.isArray(ph?.financingLines) ? ph.financingLines.slice() : [],

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
      : (hasExistingReal ? 'Editar fase (REAL)' : 'Iniciar fase (REAL)');

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
    <div class="finance-phase-editor-recommendation">
      <div>
        <strong>Recomendación según las condiciones del proyecto</strong>
        <span>Se calcula sobre los usos de esta fase y no cambia tus datos automáticamente.</span>
      </div>
      <div><span>Banco (${fundingBasis.bankPct.toFixed(1)}%)</span><b id="ph-recommended-bank">${financeMoney(sumItems(phaseData.planUses) * fundingBasis.bankPct / 100)}</b></div>
      <div><span>Promotor (${fundingBasis.promoterPct.toFixed(1)}%)</span><b id="ph-recommended-promoter">${financeMoney(sumItems(phaseData.planUses) * fundingBasis.promoterPct / 100)}</b></div>
    </div>
    ${tbl('ph-plan-uses', phaseData.planUses)}

    <h4 style="margin-top:12px;">PLAN (estimación) — Fuentes</h4>
    ${tbl('ph-plan-sources', phaseData.planSources)}

    <h4 style="margin-top:14px;">Carta y condiciones de la fase</h4>
    ${phaseConditionsFormHtml(phaseData.financialConditions)}

    <h4 style="margin-top:14px;">Lineas de financiacion aprobadas</h4>
    ${phaseFinancingLinesFormHtml(phaseData.financingLines)}
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

    <div class="grid-2 finance-real-dates" style="margin-bottom:10px;">
      <div>
        <label>Inicio real</label>
        <input id="ph-actual-start" type="date" class="input" value="${phaseData.actualStartDate}"/>
      </div>
      <div>
        <label>Fin real</label>
        <input id="ph-actual-end" type="date" class="input" value="${phaseData.actualEndDate}"/>
      </div>
    </div>

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
        const amt  = parsePanamaNumber(tr.querySelector('input.amount')?.value || 0);
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
          financialConditions: collectPhaseFinancialConditionsFromModal(),
          financingLines: collectPhaseFinancingLinesFromModal(),
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
  actualStartDate: document.getElementById('ph-actual-start')?.value || phaseData.actualStartDate || new Date().toISOString().slice(0, 10),
  actualEndDate: document.getElementById('ph-actual-end')?.value || null,
  uses: collect('ph-real-uses'),
  sources: collect('ph-real-sources'),
  // ✅ No tocamos desembolsos aquí (se gestionan desde la tarjeta con "Solicitar/Resuelto")
};

        // solo toca REAL, no toca PLAN
        await API.put(`/api/projects/${id}/finance/phases/${targetId}`, payload);
      }

      modalBackdrop.style.display = 'none';
      await loadFinance();
      await markProjectDataChanged();
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
    const total = [...tbody.querySelectorAll('input.amount')].reduce((a, inp) => a + parsePanamaNumber(inp.value || 0), 0);
    const cell = document.getElementById(`${tableId}-total`);
    if (cell) cell.textContent = formatProjectMoney(total);
    if (tableId === 'ph-plan-uses') {
      const bank = document.getElementById('ph-recommended-bank');
      const promoter = document.getElementById('ph-recommended-promoter');
      if (bank) bank.textContent = financeMoney(total * fundingBasis.bankPct / 100);
      if (promoter) promoter.textContent = financeMoney(total * fundingBasis.promoterPct / 100);
    }
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
          <td class="right"><input class="input amount" type="text" inputmode="decimal" value="${formatPanamaNumber(0)}"/></td>
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
  modalBody?.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-add-phase-financing]')) {
      document.getElementById('ph-financing-lines')?.insertAdjacentHTML('beforeend', `
        <div class="finance-facility-form-row" data-phase-financing-line>
          <label><span>Nombre/facilidad</span><input class="input" data-phase-financing="name" placeholder="Terreno"></label>
          <label><span>Monto aprobado</span><input class="input" data-phase-financing="approvedAmount" type="number" step="any" placeholder="250000"></label>
          <label><span>Tasa de interes</span><input class="input" data-phase-financing="interestRate" placeholder="SOFR + 3.50%"></label>
          <label><span>Plazo</span><input class="input" data-phase-financing="term" placeholder="24 meses"></label>
          <label><span>Forma de pago</span><input class="input" data-phase-financing="paymentMethod" placeholder="Intereses y FECI mensuales, capital al vencimiento"></label>
          <label><span>Forma de desembolso</span><input class="input" data-phase-financing="disbursementMethod" placeholder="Contra avance certificado por inspector autorizado"></label>
          <label><span>Comision</span><input class="input" data-phase-financing="commission" placeholder="1% flat"></label>
          <label><span>Observaciones</span><input class="input" data-phase-financing="observations" placeholder="Observaciones"></label>
          <button class="btn btn-danger btn-xs" type="button" data-remove-phase-financing>Quitar</button>
        </div>
      `);
    }
    if (ev.target.closest('[data-remove-phase-financing]')) {
      ev.target.closest('[data-phase-financing-line]')?.remove();
    }
  });
  modalBody?.querySelectorAll('[data-phase-bank]').forEach(select => {
    if (select.dataset.bankBound) return;
    select.dataset.bankBound = '1';
    select.addEventListener('change', () => {
      const other = select.parentElement?.querySelector('[data-phase-bank-other]');
      if (!other) return;
      other.style.display = select.value === '__OTHER__' ? '' : 'none';
      if (select.value !== '__OTHER__') other.value = '';
    });
    select.dispatchEvent(new Event('change'));
  });
  hookTable('ph-plan-uses');
  hookTable('ph-plan-sources');
  hookTable('ph-real-uses');
  hookTable('ph-real-sources');
}

function normalizeUnitEstadoFrontend(v) {
  const s = String(v || '').trim().toLowerCase();

  if (s === 'inventory') return 'inventario';
  if (s === 'inventario') return 'inventario';

  if (s === 'en_escrituracion') return 'tramite_legal_activado';
  if (s === 'escriturado') return 'escriturado_traspasado';
  if (s === 'entregado') return 'vivienda_entregada';

  return s || 'disponible';
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

  async function downloadFileWithLoading(btn, url, filename) {
  if (!btn) return;

  const oldText = btn.textContent;
  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.textContent = 'Generando PDF...';

  try {
    await downloadFile(url, filename);
  } catch (e) {
    console.error(e);
    alert(e.message || 'Error generando PDF');
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.textContent = oldText;
  }
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
  const fichaCerrarX = document.getElementById('fichaCerrarX');
  const fichaExpandir = document.getElementById('fichaExpandir');
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

const MONEY_FIELD_RE = /precio|valor|monto|ingreso|abono|financiamiento|contrato|mejoras|terreno/i;
const DECIMAL_MEASURE_FIELD_RE = /m2|metros|metraje|area|porcentaje/i;

function parseDecimalMeasureNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  let cleaned = String(value).trim().replace(/\s/g, '');
  if (!cleaned) return 0;

  if (cleaned.includes(',') && !cleaned.includes('.')) {
    cleaned = cleaned.replace(',', '.');
  } else {
    cleaned = cleaned.replace(/,/g, '');
  }

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function numberModeForId(id = '') {
  if (MONEY_FIELD_RE.test(id)) return 'money';
  if (DECIMAL_MEASURE_FIELD_RE.test(id)) return 'decimal';
  return 'integer';
}

function parseInputNumber(id, value) {
  return numberModeForId(id) === 'money'
    ? parsePanamaNumber(value)
    : parseDecimalMeasureNumber(value);
}

function formatInputNumber(id, value) {
  const mode = numberModeForId(id);
  if (mode === 'money') return formatPanamaNumber(value, 2);
  const n = parseDecimalMeasureNumber(value);
  return mode === 'integer' ? String(Math.round(n)) : n.toFixed(2);
}

const inputNum = (id, label, value = 0, opts = {}) => {
  const formatted = opts.decimals !== undefined
    ? formatPanamaNumber(value, opts.decimals)
    : formatInputNumber(id, value);
  return `<div class="label">${label}</div><input id="${id}" type="text" inputmode="decimal" data-number-input value="${formatted}" ${opts.readonly ? 'readonly' : ''}>`;
};

const inputChk = (id, label, on=false) =>
  `<div class="label">${label}</div><input id="${id}" class="chk-box" type="checkbox" ${on?'checked':''}>`;

const selectRow = (id, label, optionsHtml='') =>
  `<div class="label">${label}</div>
   <select id="${id}">
     ${optionsHtml}
   </select>`;

// Lectores seguros para guardar
function vVal(id){ const el = document.getElementById(id); return el ? el.value : null; }
function vNum(id){ const v = parseInputNumber(id, vVal(id)); return Number.isFinite(v) ? v : null; }
function vDate(id){ const s = vVal(id); return s ? new Date(s).toISOString() : null; }
function vChk(id){ const el = document.getElementById(id); return !!(el && el.checked); }

if (!window.__PROJECT_NUMBER_INPUT_FORMAT_BOUND__) {
  window.__PROJECT_NUMBER_INPUT_FORMAT_BOUND__ = true;
  document.addEventListener('focusout', (ev) => {
    const input = ev.target.closest?.('[data-number-input]');
    if (!input || input.readOnly || input.disabled) return;
    input.value = formatInputNumber(input.id, input.value);
  });
}

function calcDiffDays(startValue, endValue) {
  if (!startValue || !endValue) return 0;

  const start = new Date(startValue);
  const end = new Date(endValue);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;

  const msPerDay = 1000 * 60 * 60 * 24;
  const diff = Math.round((end.getTime() - start.getTime()) / msPerDay);

  return diff >= 0 ? diff : 0;
}

function refreshTiempoAprobacionDias() {
  const entregaEl = document.getElementById('fv-entregaExpedienteBanco');
  const recibidoEl = document.getElementById('fv-recibidoCPP');
  const tiempoEl = document.getElementById('fv-tiempoAprobacionDias');

  if (!entregaEl || !recibidoEl || !tiempoEl) return;

  const dias = calcDiffDays(entregaEl.value, recibidoEl.value);
  tiempoEl.value = dias;
}

function refreshFinanciamientoAuto(changedField = '') {
  const precioEl = document.getElementById('fv-precioVenta');
  const montoEl = document.getElementById('fv-montoFinanciamientoCPP');
  const pctEl = document.getElementById('fv-porcentajeFinanciamiento');
  const abonoEl = document.getElementById('fv-abonoInicial');

  if (!precioEl || !montoEl || !pctEl) return;

  const precio = parsePanamaNumber(precioEl.value);
  let monto = parsePanamaNumber(montoEl.value);
  let pct = parsePanamaNumber(pctEl.value);

  if (precio > 0) {
    if (changedField === 'pct') {
      monto = precio * (pct / 100);
      montoEl.value = formatPanamaNumber(monto);
    } else {
      pct = (monto / precio) * 100;
      pctEl.value = formatPanamaNumber(pct);
    }

    if (abonoEl) {
      abonoEl.value = formatPanamaNumber(Math.max(precio - monto, 0));
    }
  }
}

function refreshAreaTotalConstruccion() {
  const abiertaEl = document.getElementById('fv-areaAbierta');
  const cerradaEl = document.getElementById('fv-areaCerrada');
  const totalEl = document.getElementById('fv-areaTotalConstruccion');
  if (!abiertaEl || !cerradaEl || !totalEl) return;

  const total =
    parseInputNumber('fv-areaAbierta', abiertaEl.value) +
    parseInputNumber('fv-areaCerrada', cerradaEl.value);
  totalEl.value = formatInputNumber('fv-areaTotalConstruccion', total);
}

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

// Estados comerciales de unidad
const UNIT_ESTADOS = [
  { v: 'disponible', l: 'Disponible' },
  { v: 'inventario', l: 'Inventario' },
  { v: 'reservado', l: 'Reservado' },
  { v: 'con_cpp', l: 'Con CPP o venta al contado' },
  { v: 'tramite_legal_activado', l: 'Trámite legal activado' },
  { v: 'escriturado_traspasado', l: 'Escriturado / Traspasado' },
  { v: 'vivienda_entregada', l: 'Vivienda entregada' },
];

function estadoLabel(v) {
  const estado = normalizeUnitEstadoFrontend(v);
  return (UNIT_ESTADOS.find(e => e.v === estado)?.l) || estado.replace(/_/g, ' ');
}

  // Estado
  let unitsCache = [];
  let ventasMap = new Map(); // unitId -> venta
  let selected = new Set();
  let fichaUnitId = null;
  let foldersCache = [];
  let unitDocDepartment = 'commercial';
  let unitDocFolderId = '';
  let unitDocFoldersCache = [];
  let unitDocInsideDepartment = false;
  let latestFinanceExpiryAlerts = [];

  function pill(txt){ return `<span class="tag">${txt||'-'}</span>`; }

  function projectHousingModels() {
    return Array.isArray(state?.project?.housingModels) ? state.project.housingModels : [];
  }

  function findProjectHousingModel(value) {
    const key = String(value || '').trim();
    if (!key) return null;
    return projectHousingModels().find(model =>
      String(model._id || '') === key ||
      String(model.name || '').trim().toLowerCase() === key.toLowerCase()
    ) || null;
  }

  function projectModelOptions(current = '', { includeEmpty = true } = {}) {
    const models = projectHousingModels();
    const empty = includeEmpty ? `<option value="">Sin modelo / manual</option>` : '';
    return empty + models.map(model => {
      const value = String(model._id || model.name || '');
      const selected = String(current || '') === value || String(current || '').trim().toLowerCase() === String(model.name || '').trim().toLowerCase();
      return `<option value="${safeVal(value)}" ${selected ? 'selected' : ''}>${safeVal(model.name || 'Modelo')}</option>`;
    }).join('');
  }

  function modelToUnitDefaults(model) {
    if (!model) return {};
    return {
      modelId: model._id || '',
      modelo: model.name || '',
      m2: Number(model.openAreaM2 || 0) + Number(model.closedAreaM2 || 0),
      precioLista: Number(model.price || 0),
      areaAbierta: Number(model.openAreaM2 || 0),
      areaCerrada: Number(model.closedAreaM2 || 0),
      recamaras: Number(model.bedrooms || 0),
      banos: Number(model.bathrooms || 0)
    };
  }

  function applyProjectModelToOpenUnitForm(modelValue) {
    const model = findProjectHousingModel(modelValue);
    if (!model) return;
    const defaults = modelToUnitDefaults(model);
    const setValue = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value ?? '';
    };
    setValue('cl-modelo', defaults.modelo);
    setValue('cl-m2', formatInputNumber('cl-m2', defaults.m2));
    setValue('cl-precio', formatInputNumber('cl-precio', defaults.precioLista));
    const loc = document.getElementById('cl-ubicacion');
    if (loc && !loc.value) loc.value = state?.project?.location || state?.project?.address || '';
  }

  function applyProjectModelToFicha(modelValue) {
    const model = findProjectHousingModel(modelValue);
    if (!model) return;
    const defaults = modelToUnitDefaults(model);
    const setValue = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value ?? '';
    };
    setValue('fu-modelo', defaults.modelo);
    setValue('fu-m2', formatInputNumber('fu-m2', defaults.m2));
    setValue('fu-precio', formatInputNumber('fu-precio', defaults.precioLista));
    setValue('fv-areaAbierta', formatInputNumber('fv-areaAbierta', defaults.areaAbierta));
    setValue('fv-areaCerrada', formatInputNumber('fv-areaCerrada', defaults.areaCerrada));
    setValue('fv-recamaras', formatInputNumber('fv-recamaras', defaults.recamaras));
    setValue('fv-banos', formatInputNumber('fv-banos', defaults.banos));
    refreshAreaTotalConstruccion();
  }

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

let unassignedSettings = {
  name: 'Sin carpeta',
  color: '#0f172a'
};

async function loadCommercialFolders() {
  const data = await apiGet(`/api/commercial-folders?projectId=${id}`).catch(() => ({
    folders: [],
    unassigned: {
      name: 'Sin carpeta',
      color: '#0f172a'
    }
  }));

  foldersCache = Array.isArray(data) ? data : (data.folders || []);
  unassignedSettings = data.unassigned || {
    name: 'Sin carpeta',
    color: '#0f172a'
  };
}

function isCommercialFolderCollapsed(folderId) {
  return localStorage.getItem(`bank73_com_folder_closed_${id}_${folderId || 'unassigned'}`) === '1';
}

function setCommercialFolderCollapsed(folderId, closed) {
  localStorage.setItem(`bank73_com_folder_closed_${id}_${folderId || 'unassigned'}`, closed ? '1' : '0');
}

function getUnassignedFolderName() {
  return unassignedSettings?.name || 'Sin carpeta';
}

function getUnassignedFolderColor() {
  return unassignedSettings?.color || '#0f172a';
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
try { await loadCommercialFolders(); } catch(e){ console.warn('folders err', e); }

    // KPIs
    const resumen = {
  disponible: 0,
  inventario: 0,
  reservado: 0,
  con_cpp: 0,
  tramite_legal_activado: 0,
  escriturado_traspasado: 0,
  vivienda_entregada: 0,
  valor: 0
};

units.forEach(u => {
  const estado = normalizeUnitEstadoFrontend(u.estado);
resumen[estado] = (resumen[estado] || 0) + 1;
  resumen.valor += u.precioLista || 0;
});

kpisDiv.innerHTML = [
  { key: 'disponible', label: 'Disponibles', value: resumen.disponible || 0, sub: 'Listas para venta' },
  { key: 'inventario', label: 'Inventario', value: resumen.inventario || 0, sub: 'En cartera' },
  { key: 'reservado', label: 'Reservados', value: resumen.reservado || 0, sub: 'Separadas' },
  { key: 'cpp', label: 'Con CPP', value: resumen.con_cpp || 0, sub: 'Contrato activo' },
  { key: 'legal', label: 'Trámite legal', value: resumen.tramite_legal_activado || 0, sub: 'En proceso' },
  { key: 'escriturado', label: 'Escriturado / Traspasado', value: resumen.escriturado_traspasado || 0, sub: 'Cerradas' },
  { key: 'entregada', label: 'Vivienda entregada', value: resumen.vivienda_entregada || 0, sub: 'Entregas' },
  { key: 'valor', label: 'Valor total', value: formatProjectMoney(resumen.valor || 0), sub: 'Precio lista acumulado' }
].map(item => `
  <div class="commercial-kpi-card commercial-kpi-${item.key}">
    <span class="commercial-kpi-label">${item.label}</span>
    <strong class="commercial-kpi-value">${item.value}</strong>
    <span class="commercial-kpi-sub">${item.sub}</span>
  </div>
`).join('');
// ===== ALERTA CPP: 60 días antes de vencimiento =====
function daysUntil(dateValue) {
  if (!dateValue) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(dateValue);
  if (isNaN(target.getTime())) return null;
  target.setHours(0, 0, 0, 0);

  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function unitLabel(u) {
  const manzanaLote = `${u?.manzana || '-'}-${u?.lote || ''}`.trim();
  return manzanaLote !== '-' ? manzanaLote : (u?.nombre || u?.codigo || u?._id || 'Unidad');
}

function getCppExpiryAlert(u, venta) {
  const days = daysUntil(venta?.fechaVencimientoCPP);

  // Alerta desde 60 días antes hasta el día de vencimiento
  if (days === null || days < 0 || days > 60) return null;

  return {
    kind: 'cpp',
    unit: unitLabel(u),
    days,
    due: String(venta.fechaVencimientoCPP).slice(0, 10),
    banco: venta?.banco || '',
    cpp: venta?.numCPP || ''
  };
}

async function getCreditLineExpiryAlerts() {
  try {
    const res = await API.get(`/api/projects/${id}/finance`);
    const lines = res?.financeControl?.loanLines || [];
    return lines.flatMap(line => {
      const entries = Array.isArray(line.entries) && line.entries.length ? line.entries : [line];
      const lineBalance = numOr0(line.balanceAfterSales ?? line.balance ?? line.disbursementAmount);
      if (lineBalance <= 0) return [];
      return entries.map(entry => {
        const days = daysUntil(entry?.maturityDate);
        if (days === null || days > 120) return null;
        return {
          kind: 'credit_line',
          line: line.name || 'Linea de credito',
          loanNumber: entry?.loanNumber || '',
          days,
          due: String(entry.maturityDate).slice(0, 10),
          balance: lineBalance,
        };
      }).filter(Boolean);
    });
  } catch (e) {
    console.warn('[Finance] no se pudieron cargar alertas de vencimiento de lineas', e);
    return [];
  }
}

function updateProjectAlertsButton(alerts = []) {
  if (!projectAlertsBtn) return;
  const count = alerts.length;
  projectAlertsBtn.classList.toggle('has-alerts', count > 0);
  projectAlertsBtn.dataset.alertCount = count > 99 ? '99+' : String(count);
  projectAlertsBtn.title = count ? `Ver ${count} alertas` : 'Ver alertas';
  projectAlertsBtn.setAttribute('aria-label', count ? `Ver ${count} alertas` : 'Ver alertas');
}

function openNoFinanceAlertsPopup() {
  openModal(
    'Alertas',
    `
      <div style="
        border:1px solid rgba(148,163,184,.35);
        border-radius:20px;
        padding:24px;
        background:linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
        color:#0f172a;
        box-shadow:0 18px 45px rgba(15,23,42,.10);
      ">
        <div style="font-size:24px;font-weight:900;margin-bottom:8px;">No hay alertas actualmente</div>
        <div style="color:#64748b;font-size:14px;">No se encontraron vencimientos financieros próximos para este proyecto.</div>
      </div>
    `,
    'Cerrar',
    () => { modalBackdrop.style.display = 'none'; }
  );
}

function showCppExpiryPopup(alerts = [], { force = false } = {}) {
  latestFinanceExpiryAlerts = Array.isArray(alerts) ? alerts : [];
  updateProjectAlertsButton(latestFinanceExpiryAlerts);
  if (!latestFinanceExpiryAlerts.length) {
    if (force) openNoFinanceAlertsPopup();
    return;
  }
  alerts = latestFinanceExpiryAlerts;
  if (!alerts.length) return;

  const storageKey = `finance-expiry-alerts-shown-${id}-${new Date().toISOString().slice(0,10)}`;
  if (!force) {
    if (sessionStorage.getItem(storageKey) === '1') return;
    sessionStorage.setItem(storageKey, '1');
  }

  const rows = alerts.map(a => `
    <div style="
      border:1px solid #fecaca;
      background:#fff1f2;
      border-radius:14px;
      padding:12px 14px;
      margin-bottom:10px;
    ">
      <div style="font-weight:800;color:#991b1b;">
        Faltan ${a.days} días para que venza la CPP de la unidad ${a.unit}
      </div>
      <div class="small" style="margin-top:4px;color:#7f1d1d;">
        Vencimiento: <b>${a.due}</b>
        ${a.banco ? ` · Banco: <b>${a.banco}</b>` : ''}
        ${a.cpp ? ` · CPP: <b>${a.cpp}</b>` : ''}
      </div>
    </div>
  `).join('');

  openModal(
  'Vencimientos financieros próximos',
  `
    <div style="
      border:1px solid rgba(220,38,38,.28);
      border-left:7px solid #dc2626;
      border-radius:22px;
      padding:22px;
      background:
        linear-gradient(135deg, #fff7f7 0%, #ffffff 55%, #f8fafc 100%);
      box-shadow:0 18px 45px rgba(15,23,42,.12);
    ">
      <div style="
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:18px;
        margin-bottom:18px;
      ">
        <div>
          <div style="
            font-size:13px;
            font-weight:800;
            letter-spacing:.08em;
            text-transform:uppercase;
            color:#991b1b;
            margin-bottom:6px;
          ">
            Control de riesgo financiero
          </div>

          <div style="
            font-size:24px;
            line-height:1.15;
            font-weight:900;
            color:#0f172a;
          ">
            Vencimientos próximos
          </div>

          <div style="
            margin-top:7px;
            color:#64748b;
            font-size:14px;
          ">
            Revisa CPP y líneas de crédito antes de que venza su vigencia.
          </div>
        </div>

        <div style="
          min-width:58px;
          height:58px;
          border-radius:18px;
          background:#fee2e2;
          border:1px solid #fecaca;
          display:flex;
          align-items:center;
          justify-content:center;
          font-size:28px;
        ">
          ⚠️
        </div>
      </div>

      <div style="display:grid;gap:12px;">
        ${alerts.map(a => `
          <div style="
            border:1px solid #fecaca;
            background:rgba(255,241,242,.82);
            border-radius:18px;
            padding:16px 18px;
            display:flex;
            justify-content:space-between;
            gap:16px;
            align-items:center;
          ">
            <div>
              <div style="
                font-size:17px;
                font-weight:900;
                color:#991b1b;
              ">
                ${a.kind === 'credit_line'
                  ? `${a.line}${a.loanNumber ? ` · ${a.loanNumber}` : ''}`
                  : `Unidad ${a.unit}`}
              </div>

              <div style="
                margin-top:6px;
                color:#7f1d1d;
                font-size:14px;
              ">
                Vencimiento: <b>${a.due}</b>
                ${a.banco ? ` · Banco: <b>${a.banco}</b>` : ''}
                ${a.cpp ? ` · CPP: <b>${a.cpp}</b>` : ''}
                ${a.balance ? ` · Saldo: <b>${financeMoney(a.balance)}</b>` : ''}
              </div>
            </div>

            <div style="
              min-width:112px;
              text-align:center;
              background:#111827;
              color:#fff;
              border-radius:16px;
              padding:10px 12px;
              box-shadow:0 10px 25px rgba(15,23,42,.18);
            ">
              <div style="font-size:25px;font-weight:950;line-height:1;">
                ${Math.abs(a.days)}
              </div>
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-top:4px;">
                ${a.days < 0 ? 'dias vencido' : 'dias restantes'}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `,
  'Entendido',
  () => { modalBackdrop.style.display = 'none'; }
);
}

if (projectAlertsBtn) {
  projectAlertsBtn.addEventListener('click', () => {
    showCppExpiryPopup(latestFinanceExpiryAlerts, { force: true });
  });
}
    // Grid
    // ----- Render grid mejorado -----
function getDisplayClienteName(venta, unit) {
  const nickname = String(venta?.clienteNombre || '').trim();
  if (nickname) return nickname;

  const fullName = [
    venta?.primerNombre,
    venta?.primerApellido,
    venta?.segundoApellido
  ].map(x => String(x || '').trim()).filter(Boolean).join(' ');

  return fullName || venta?.cliente?.nombre || unit?.clienteId?.nombre || '';
}

function renderUnitCard(u) {
  const venta = ventasMap.get(String(u._id));
  const banco = venta?.banco || '';
  const cpp = venta?.numCPP || '';
  const cliente = getDisplayClienteName(venta, u);
  const idu = String(u._id);
  const estadoTxt = estadoLabel(u.estado || 'disponible');
  const impago = /mora|impago|rechaz|atras|vencid|moros/i.test(venta?.statusBanco || '');
  const cppAlert = getCppExpiryAlert(u, venta);

  return `
    <div class="unit-card estado-${normalizeUnitEstadoFrontend(u.estado)} ${selected.has(idu) ? 'selected' : ''}"
         data-id="${idu}"
         draggable="true">
      ${impago ? `<span class="alert-ribbon">Impago</span>` : ``}
${cppAlert ? `
  <span class="alert-ribbon" style="
    background:#dc2626;
    top:auto;
    bottom:12px;
    right:12px;
  ">
    CPP vence en ${cppAlert.days} días
  </span>
` : ``}

      <div class="head">
        <div class="title">
          <b>${u.manzana || '-'}-${u.lote || ''}</b>
          <span class="status">${estadoTxt}</span>
        </div>

        <label class="sel-wrap" title="Seleccionar">
          <input type="checkbox" class="sel" ${selected.has(idu) ? 'checked' : ''} />
          <span class="sel-box"></span>
        </label>
      </div>

      <div class="meta">${u.modelo || '—'} — ${u.m2 || 0} m²</div>
      <div class="price">${formatProjectMoney(u.precioLista || 0)}</div>

      <div class="badges">
        ${cliente ? `<span class="chip">${cliente}</span>` : `<span class="chip ghost">Sin cliente</span>`}
        ${banco ? `<span class="chip">Banco: ${banco}</span>` : ``}
        ${cpp ? `<span class="chip">CPP: ${cpp}</span>` : ``}
      </div>
    </div>`;
}

const byFolder = new Map();

foldersCache.forEach(f => {
  byFolder.set(String(f._id), []);
});

const unassigned = [];

units.forEach(u => {
  const fid = u.folderId ? String(u.folderId) : '';
  if (fid && byFolder.has(fid)) byFolder.get(fid).push(u);
  else unassigned.push(u);
});

grid.innerHTML = `
  <div class="commercial-folders-toolbar">
    <button type="button" class="btn primary" id="btnCrearCarpetaComercial">
      + Crear carpeta
    </button>
  </div>

  <div
  class="commercial-folder unassigned ${isCommercialFolderCollapsed('unassigned') ? 'collapsed' : ''}"
  data-folder-id=""
  style="--folder-color:${getUnassignedFolderColor()};"
  >
    <div class="commercial-folder-head">
      <h3>${getUnassignedFolderName()}</h3>

<div class="folder-actions">
  <span>${unassigned.length} unidades</span>

  <button type="button" class="btn mini folder-toggle" data-id="unassigned">
  ${isCommercialFolderCollapsed('unassigned') ? 'Mostrar' : 'Ocultar'}
  </button>

  <input
    type="color"
    class="folder-color-unassigned"
    value="${getUnassignedFolderColor()}"
    title="Color del sector"
  >

  <button type="button" class="btn mini folder-rename-unassigned">
    Renombrar
  </button>
</div>
    </div>

    <div class="commercial-folder-body">
      ${unassigned.map(renderUnitCard).join('') || `<div class="empty">Arrastra unidades aquí.</div>`}
    </div>
  </div>

  ${foldersCache.map(folder => {
    const folderUnits = byFolder.get(String(folder._id)) || [];
    const color = folder.color || '#0f172a';

    return `
      <div class="commercial-folder ${isCommercialFolderCollapsed(folder._id) ? 'collapsed' : ''}"
     data-folder-id="${folder._id}"
     style="--folder-color:${color};">
        <div class="commercial-folder-head">
          <h3 class="folder-title">${folder.name}</h3>

          <div class="folder-actions">
            <span>${folderUnits.length} unidades</span>

            <button type="button" class="btn mini folder-toggle" data-id="">
            ${isCommercialFolderCollapsed('unassigned') ? 'Mostrar' : 'Ocultar'}
            </button>

            <input
              type="color"
              class="folder-color"
              data-id="${folder._id}"
              value="${color}"
              title="Color de carpeta"
            >

            <button type="button" class="btn mini folder-rename" data-id="${folder._id}">
              Renombrar
            </button>

            <button type="button" class="btn mini danger folder-delete" data-id="${folder._id}">
              Eliminar
            </button>
          </div>
        </div>

        <div class="commercial-folder-body">
          ${folderUnits.map(renderUnitCard).join('') || `<div class="empty">Arrastra unidades aquí.</div>`}
        </div>
      </div>
    `;
  }).join('')}
`;

const cppAlerts = units
  .map(u => getCppExpiryAlert(u, ventasMap.get(String(u._id))))
  .filter(Boolean);

const creditLineAlerts = await getCreditLineExpiryAlerts();
showCppExpiryPopup([...cppAlerts, ...creditLineAlerts].sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999)));

wireUnitCards();
wireCommercialFolders();

// ----- Eventos de tarjeta / checkbox -----
  }
  window.loadUnits = loadUnits;

  function renderUnidadDocsSkeleton(unit) {
  const tag = `${unit?.manzana || '-'}-${unit?.lote || ''}`;

  return `
    <div id="unitDocs" class="unit-docs-wrap">
      <div class="subtle">Documentos de la unidad <b>${tag}</b></div>

      <div id="unitDocDepartments" class="unit-doc-departments"></div>

      <div id="unitDocFolderBar" class="unit-doc-folder-bar"></div>

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

function getVisibleDocDepartmentsFrontend() {
  const role = String(myRole || '').toLowerCase().trim();

  if ([
    'admin',
    'bank',
    'promoter',
    'gerencia',
    'socios',
    'financiero',
    'contable',
    'legal'
  ].includes(role)) {
    return [
      { id: 'commercial', label: 'Comercial' },
      { id: 'tecnico', label: 'Técnico' },
      { id: 'legal', label: 'Legal' }
    ];
  }

  if (role === 'commercial') {
    return [{ id: 'commercial', label: 'Comercial' }];
  }

  if (role === 'tecnico') {
    return [{ id: 'tecnico', label: 'Técnico' }];
  }

  return [];
}

async function loadUnitDocFolders(projectId, unitId) {
  const qs = new URLSearchParams({
    projectId,
    unitId
  });

  unitDocFoldersCache = await apiGet(`/api/unit-doc-folders?${qs.toString()}`).catch(() => []);
}

async function refreshUnitDocsUI(projectId, unitId) {
  await loadUnitDocFolders(projectId, unitId);

  if (!unitDocInsideDepartment) {
    renderUnitDocDepartmentCards(projectId, unitId);
    return;
  }

  renderUnitDocInsideDepartment(projectId, unitId);
  renderUnitDocFolderBar(projectId, unitId);

  await loadUnidadDocs(projectId, unitId);
}

function renderUnitDocDepartments(projectId, unitId) {
  const box = document.getElementById('unitDocDepartments');
  if (!box) return;

  const deps = getVisibleDocDepartmentsFrontend();

  if (!deps.length) {
    box.innerHTML = `<div class="small muted">No tienes acceso a carpetas documentales.</div>`;
    return;
  }

  if (!deps.some(d => d.id === unitDocDepartment)) {
    unitDocDepartment = deps[0].id;
  }

  box.innerHTML = deps.map(d => `
    <button
      type="button"
      class="modal-tab ${unitDocDepartment === d.id ? 'active' : ''}"
      data-doc-department="${d.id}">
      ${d.label}
    </button>
  `).join('');

  box.querySelectorAll('[data-doc-department]').forEach(btn => {
    btn.addEventListener('click', async () => {
      unitDocDepartment = btn.dataset.docDepartment;
      unitDocFolderId = '';
      await refreshUnitDocsUI(projectId, unitId);
    });
  });
}

function renderUnitDocDepartmentCards(projectId, unitId) {
  const deps = getVisibleDocDepartmentsFrontend();
  const box = document.getElementById('unitDocs');

  if (!box) return;

  if (!deps.length) {
    box.innerHTML = `<div class="small muted">No tienes acceso a documentos.</div>`;
    return;
  }

  box.innerHTML = `
    <div class="unit-docs-home">
      <div class="unit-docs-home-title">
        Selecciona una carpeta documental
      </div>

      <div class="unit-doc-main-folders">
        ${deps.map(d => `
          <button type="button" class="unit-doc-main-folder" data-doc-department="${d.id}">
            <div class="unit-doc-main-folder-icon">📁</div>
            <div>
              <strong>${d.label}</strong>
              <span>Ver documentos y subcarpetas</span>
            </div>
          </button>
        `).join('')}
      </div>
    </div>
  `;

  box.querySelectorAll('[data-doc-department]').forEach(btn => {
    btn.addEventListener('click', async () => {
      unitDocDepartment = btn.dataset.docDepartment;
      unitDocFolderId = '';
      unitDocInsideDepartment = true;
      await refreshUnitDocsUI(projectId, unitId);
    });
  });
}

function renderUnitDocInsideDepartment(projectId, unitId) {
  const departmentLabel = {
    commercial: 'Comercial',
    tecnico: 'Técnico',
    legal: 'Legal'
  };

  const box = document.getElementById('unitDocs');
  if (!box) return;

  box.innerHTML = `
    <div class="unit-docs-header-clean">
      <button type="button" class="btn mini" id="btnBackUnitDocDepartments">
        ← Carpetas
      </button>

      <div>
        <h3>📁 ${departmentLabel[unitDocDepartment] || 'Documentos'}</h3>
        <p>Sube y organiza documentos de esta área.</p>
      </div>
    </div>

    <div id="unitDocFolderBar" class="unit-doc-folder-bar"></div>

    <form id="unitUploadForm" class="upload-box">
      <input id="unitFiles" type="file" multiple />
      <input id="unitDocName" type="text" placeholder="Nombre (opcional)" />
      <input id="unitDocExpiry" type="date" placeholder="Fecha de expiración (opcional)" />
      <button type="submit" class="btn">Subir</button>
    </form>

    <div id="unitDocsList" class="docs-list small-gap"></div>
  `;

  document.getElementById('btnBackUnitDocDepartments')?.addEventListener('click', async () => {
    unitDocInsideDepartment = false;
    unitDocFolderId = '';
    await refreshUnitDocsUI(projectId, unitId);
  });

  wireUnidadUpload(projectId, unitId);
}

function renderUnitDocFolderBar(projectId, unitId) {
  const bar = document.getElementById('unitDocFolderBar');
  if (!bar) return;

  const folders = (unitDocFoldersCache || [])
    .filter(f => String(f.department) === String(unitDocDepartment));

  bar.innerHTML = `
    <div class="unit-doc-folder-actions">
      <button
        type="button"
        class="btn mini ${!unitDocFolderId ? 'primary' : ''}"
        id="btnUnitDocsRoot">
        📂 Principal
      </button>

      ${folders.map(f => `
        <button
          type="button"
          class="btn mini ${String(unitDocFolderId) === String(f._id) ? 'primary' : ''}"
          data-unit-doc-folder="${f._id}">
          📁 ${f.name}
        </button>
      `).join('')}

      <button type="button" class="btn mini" id="btnCreateUnitDocFolder">
        + Crear subcarpeta
      </button>

      ${unitDocFolderId ? `
        <button type="button" class="btn mini" id="btnRenameUnitDocFolder">
          Renombrar
        </button>

        <button type="button" class="btn mini danger" id="btnDeleteUnitDocFolder">
          Eliminar carpeta
        </button>
      ` : ''}
    </div>
  `;

  document.getElementById('btnUnitDocsRoot')?.addEventListener('click', async () => {
    unitDocFolderId = '';
    await refreshUnitDocsUI(projectId, unitId);
  });

  bar.querySelectorAll('[data-unit-doc-folder]').forEach(btn => {
    btn.addEventListener('click', async () => {
      unitDocFolderId = btn.dataset.unitDocFolder;
      await refreshUnitDocsUI(projectId, unitId);
    });
  });

  document.getElementById('btnCreateUnitDocFolder')?.addEventListener('click', async () => {
    const name = prompt('Nombre de la subcarpeta:');
    if (!name || !name.trim()) return;

    try {
      await apiPost('/api/unit-doc-folders', {
        projectId,
        unitId,
        department: unitDocDepartment,
        name: name.trim()
      });

      await refreshUnitDocsUI(projectId, unitId);
    } catch (e) {
      console.error(e);
      alert('Error creando subcarpeta.');
    }
  });

  document.getElementById('btnRenameUnitDocFolder')?.addEventListener('click', async () => {
    const folder = unitDocFoldersCache.find(f => String(f._id) === String(unitDocFolderId));
    const name = prompt('Nuevo nombre:', folder?.name || '');

    if (!name || !name.trim()) return;

    try {
      await apiPatch(`/api/unit-doc-folders/${unitDocFolderId}`, {
        projectId,
        unitId,
        name: name.trim()
      });

      await refreshUnitDocsUI(projectId, unitId);
    } catch (e) {
      console.error(e);
      alert('Error renombrando subcarpeta.');
    }
  });

  document.getElementById('btnDeleteUnitDocFolder')?.addEventListener('click', async () => {
    const pin = prompt('Introduce el PIN para eliminar esta carpeta:');
    if (!pin) return;

    try {
      await apiDelete(`/api/unit-doc-folders/${unitDocFolderId}`, {
        projectId,
        unitId,
        pin
      });

      unitDocFolderId = '';
      await refreshUnitDocsUI(projectId, unitId);
    } catch (e) {
      console.error(e);
      alert('Error eliminando subcarpeta.');
    }
  });
}

function wireUnitCards() {
  Array.from(grid.querySelectorAll('.unit-card')).forEach(el => {
    const unitId = el.dataset.id;

    el.addEventListener('dragstart', ev => {
      let dragIds = [];

      if (selected.has(unitId)) {
        dragIds = Array.from(selected);
      } else {
        dragIds = [unitId];
      }

      ev.dataTransfer.setData('application/json', JSON.stringify(dragIds));
      ev.dataTransfer.setData('text/plain', unitId);
      ev.dataTransfer.effectAllowed = 'move';

      grid.querySelectorAll('.unit-card').forEach(card => {
        if (dragIds.includes(card.dataset.id)) {
          card.classList.add('dragging');
        }
      });
    });

    el.addEventListener('dragend', () => {
      grid.querySelectorAll('.unit-card.dragging').forEach(card => {
        card.classList.remove('dragging');
      });
    });

    el.addEventListener('click', ev => {
      if (ev.target && (
        ev.target.classList?.contains('sel') ||
        ev.target.classList?.contains('sel-box') ||
        ev.target.closest?.('.sel-wrap')
      )) return;

      abrirFichaUnidad(unitId);
    });

    const cb = el.querySelector('.sel');

    if (cb) {
      cb.addEventListener('change', () => {
        if (cb.checked) {
          selected.add(unitId);
          el.classList.add('selected');
        } else {
          selected.delete(unitId);
          el.classList.remove('selected');
        }

        updateSelectAllLabel();
      });
    }
  });
}

function wireCommercialFolders() {
  document.getElementById('btnCrearCarpetaComercial')?.addEventListener('click', crearCarpetaComercial);

  grid.querySelectorAll('.commercial-folder').forEach(folderEl => {
    folderEl.addEventListener('dragover', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      folderEl.classList.add('is-drag-over');
    });

    folderEl.addEventListener('dragleave', ev => {
      if (!folderEl.contains(ev.relatedTarget)) {
        folderEl.classList.remove('is-drag-over');
      }
    });

    folderEl.addEventListener('drop', async ev => {
  ev.preventDefault();
  ev.stopPropagation();

  folderEl.classList.remove('is-drag-over');
  folderEl.classList.add('is-loading-folder');

  const draggedId = ev.dataTransfer.getData('text/plain');

  let unitIds = [];

  if (selected.has(draggedId)) {
    unitIds = Array.from(selected);
  } else {
    unitIds = [draggedId];
  }

  const folderId = folderEl.dataset.folderId;

  try {

    if (folderId) {

      await apiPatch(`/api/commercial-folders/${folderId}/units`, {
        unitIds
      });

    } else {

      await apiPatch('/api/commercial-folders/unassigned/units', {
        unitIds,
        projectId: id
      });

    }

    await loadUnits();

  } catch (e) {

    console.error(e);
    alert('Error moviendo unidades.');

  } finally {

    folderEl.classList.remove('is-loading-folder');

  }
});
  });

  grid.querySelectorAll('.folder-color').forEach(input => {
    input.addEventListener('change', async ev => {
      ev.stopPropagation();

      const folderId = input.dataset.id;
      const color = input.value || '#0f172a';

      await apiPatch(`/api/commercial-folders/${folderId}`, {
        color
      });

      await loadUnits();
    });
  });

  grid.querySelectorAll('.folder-rename').forEach(btn => {
    btn.addEventListener('click', async ev => {
      ev.stopPropagation();

      const folderId = btn.dataset.id;
      const folder = foldersCache.find(f => String(f._id) === String(folderId));
      const name = prompt('Nuevo nombre de la carpeta:', folder?.name || '');

      if (!name || !name.trim()) return;

      await apiPatch(`/api/commercial-folders/${folderId}`, {
        name: name.trim()
      });

      await loadUnits();
    });
  });

  grid.querySelectorAll('.folder-delete').forEach(btn => {
    btn.addEventListener('click', async ev => {
      ev.stopPropagation();

      const folderId = btn.dataset.id;
      const folder = foldersCache.find(f => String(f._id) === String(folderId));

      const ok = confirm(
        `¿Eliminar la carpeta "${folder?.name || ''}"?\n\nLas unidades NO se eliminarán, volverán a "Sin carpeta".`
      );

      if (!ok) return;

      await apiDelete(`/api/commercial-folders/${folderId}`);

      await loadUnits();
    });
  });

  grid.querySelector('.folder-rename-unassigned')?.addEventListener('click', async ev => {
  ev.preventDefault();
  ev.stopPropagation();

  const current = getUnassignedFolderName();
  const name = prompt('Nuevo nombre:', current);

  if (!name || !name.trim()) return;

  await apiPatch('/api/commercial-folders/unassigned/settings', {
    projectId: id,
    name: name.trim()
  });

  await loadUnits();
});

grid.querySelector('.folder-color-unassigned')?.addEventListener('change', async ev => {
  ev.preventDefault();
  ev.stopPropagation();

  await apiPatch('/api/commercial-folders/unassigned/settings', {
    projectId: id,
    color: ev.target.value || '#0f172a'
  });

  await loadUnits();
});

grid.querySelectorAll('.folder-toggle').forEach(btn => {
  const toggleFolder = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    const folderId = btn.dataset.id || 'unassigned';
    const folderEl = btn.closest('.commercial-folder');
    if (!folderEl) return;

    const closed = !folderEl.classList.contains('collapsed');

    setCommercialFolderCollapsed(folderId, closed);
    folderEl.classList.toggle('collapsed', closed);
    btn.textContent = closed ? 'Mostrar' : 'Ocultar';
  };

  btn.addEventListener('pointerdown', toggleFolder, { passive: false });
  btn.addEventListener('click', ev => {
    ev.preventDefault();
    ev.stopPropagation();
  });
});
}

async function crearCarpetaComercial() {
  if (myRole === 'commercial' && window.__COMMERCIAL_LOCKED) {
    alert('Este proyecto aún no está aprobado. Creación de carpetas bloqueada.');
    return;
  }

  const name = prompt('Nombre de la carpeta:', 'Torre 1');

  if (!name || !name.trim()) return;

  await apiPost('/api/commercial-folders', {
    projectId: id,
    name: name.trim(),
    color: '#0f172a'
  });

  await loadUnits();
}

async function loadUnidadDocs(projectId, unitId) {
  const qs = new URLSearchParams({
    projectId,
    unitId,
    department: unitDocDepartment,
    folderId: unitDocFolderId || ''
  });

  const list = await apiGet(`/api/documents?${qs.toString()}`).catch(() => []);

  const listDiv = document.getElementById('unitDocsList');
  if (!listDiv) return;

  const departmentLabel = {
    commercial: 'Comercial',
    tecnico: 'Técnico',
    legal: 'Legal'
  };

  listDiv.innerHTML = (list || []).map(d => `
    <div class="doc">
      <div>
        <span class="doc-item-title">${d.originalname || d.name || d.title || 'Documento'}</span>

        <div class="doc-meta">
          ${d.mimetype || ''} — ${(d.size || 0).toLocaleString()} bytes
        </div>

        <div class="doc-meta">
          Carpeta: ${departmentLabel[d.department || 'commercial'] || d.department || 'Comercial'}
        </div>

        <div class="doc-expiry ${d.expiryDate && new Date(d.expiryDate) < new Date(Date.now()+30*24*60*60*1000) ? 'warn' : ''}">
          Expira: ${d.expiryDate ? String(d.expiryDate).slice(0,10) : '—'}
        </div>

        ${d.checklistId ? `<div class="doc-meta">Checklist: ${d.checklistTitle || ''}</div>` : ''}
      </div>

      <div class="doc-actions">
        <a class="btn js-secure-file" href="#" data-url="${secureDocUrl(d._id)}" data-filename="${escapeHtml(d.originalname || d.name || d.title || 'documento')}" data-action="view">Ver</a>
        <button class="btn danger doc-del" data-id="${d._id}">Eliminar</button>
      </div>
    </div>
  `).join('') || '<div class="small muted">No hay documentos en esta carpeta.</div>';

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
  if (!form || form.__wiredUpload) return;

  form.__wiredUpload = true;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const files = document.getElementById('unitFiles')?.files;

    if (!files || !files.length) {
      alert('Selecciona al menos un archivo.');
      return;
    }

    const fd = new FormData();

    fd.append('projectId', projectId);
    fd.append('unitId', unitId);

    // ✅ NUEVO: área documental y subcarpeta
    fd.append('department', unitDocDepartment);
    fd.append('folderId', unitDocFolderId || '');

    const name = document.getElementById('unitDocName')?.value?.trim();
    const exp = document.getElementById('unitDocExpiry')?.value?.trim();

    if (name) fd.append('name', name);
    if (exp) fd.append('expiryDate', exp);

    Array.from(files).forEach(f => fd.append('files', f));

    try {
      await apiUpload('/api/documents/upload', fd);

      form.reset();

      await refreshUnitDocsUI(projectId, unitId);

      if (typeof loadDocs === 'function') loadDocs();
    } catch (err) {
      console.error(err);
      alert('Error subiendo archivos: ' + (err.message || ''));
    }
  });
}

function importLabelForField(field) {
  const labels = {
    clienteNombre: 'Cliente resumen',
    primerNombre: 'Primer nombre',
    segundoNombre: 'Segundo nombre',
    primerApellido: 'Apellido paterno',
    segundoApellido: 'Apellido materno',
    apellidoCasada: 'Apellido de casada',
    cedula: 'Cédula',
    sexo: 'Sexo',
    profesion: 'Profesión',
    estadoCivil: 'Estado civil',
    direccion: 'Dirección',
    telefonoResidencial: 'Teléfono residencial',
    telefonoOficina: 'Teléfono oficina',
    celular: 'Celular',
    correo: 'Correo',
    empresa: 'Empresa',
    lugarTrabajo: 'Lugar de trabajo',
    ingresoMensual: 'Ingreso mensual',
    cargo: 'Cargo',
    antiguedadLaboral: 'Antigüedad laboral',

    cliente2PrimerNombre: 'Cliente 2 - Primer nombre',
    cliente2SegundoNombre: 'Cliente 2 - Segundo nombre',
    cliente2PrimerApellido: 'Cliente 2 - Apellido paterno',
    cliente2SegundoApellido: 'Cliente 2 - Apellido materno',
    cliente2ApellidoCasada: 'Cliente 2 - Apellido de casada',
    cliente2Cedula: 'Cliente 2 - Cédula',
    cliente2Sexo: 'Cliente 2 - Sexo',
    cliente2Profesion: 'Cliente 2 - Profesión',
    cliente2Direccion: 'Cliente 2 - Dirección',
    cliente2LugarTrabajo: 'Cliente 2 - Lugar trabajo',

    pariente1Nombre: 'Pariente 1 - Nombre',
    pariente1Parentesco: 'Pariente 1 - Parentesco',
    pariente1Telefono: 'Pariente 1 - Teléfono',
    pariente1TelefonoTrabajo: 'Pariente 1 - Tel. trabajo',

    pariente2Nombre: 'Pariente 2 - Nombre',
    pariente2Parentesco: 'Pariente 2 - Parentesco',
    pariente2Telefono: 'Pariente 2 - Teléfono',
    pariente2TelefonoTrabajo: 'Pariente 2 - Tel. trabajo',

    referencia1Nombre: 'Referencia 1 - Nombre',
    referencia1Relacion: 'Referencia 1 - Relación',
    referencia1Telefono: 'Referencia 1 - Teléfono',
    referencia1TelefonoTrabajo: 'Referencia 1 - Tel. trabajo',

    referencia2Nombre: 'Referencia 2 - Nombre',
    referencia2Relacion: 'Referencia 2 - Relación',
    referencia2Telefono: 'Referencia 2 - Teléfono',
    referencia2TelefonoTrabajo: 'Referencia 2 - Tel. trabajo',

    lote: 'Lote',
    numeroFinca: 'Número de finca',
    codigoUbicacion: 'Código ubicación',
    ubicacion: 'Ubicación',
    calle: 'Calle',
    modelo: 'Modelo',
    recamaras: 'Recámaras',
    banos: 'Baños',
    metrajeLote: 'Metraje lote',
    areaAbierta: 'Área abierta',
    areaCerrada: 'Área cerrada',
    areaTotalConstruccion: 'Área total construcción',
    valorMejoras: 'Valor mejoras',
    valorTerreno: 'Valor terreno',
    fechaProbableEntrega: 'Fecha probable entrega',

    banco: 'Banco',
    oficialBanco: 'Oficial banco',
    precioVenta: 'Precio venta',
    montoFinanciamientoCPP: 'Monto financiamiento CPP',
    abonoCliente: 'Abono cliente',
    abonoInicial: 'Abono inicial',
    porcentajeFinanciamiento: '% financiamiento',
    cesionAFavorDe: 'Cesión a favor de',
    polizaVida: 'Póliza vida',
    abonoAlte: 'Abono ALTE',

    proformaSolicitadaPor: 'Proforma solicitada por',
    referidoPor: 'Referido por',
    observacionCliente: 'Observación',
  };

  return labels[field] || field;
}

function renderImportWordPreview(unitId, detected, type) {
  const box = document.getElementById('importWordPreview');
  if (!box) return;

  const entries = Object.entries(detected || {});

  if (!entries.length) {
    box.innerHTML = `
      <div class="small muted" style="color:#fff;">
        No se detectaron campos válidos en el Word.
      </div>
    `;
    return;
  }

  box.innerHTML = `
    <div style="
      background:#0f172a;
      border:1px solid rgba(255,255,255,.12);
      border-radius:16px;
      padding:18px;
      color:white;
    ">
      <h4 style="margin-top:0;">
        Vista previa importación: ${type === 'proforma' ? 'Proforma' : 'Ficha cliente'}
      </h4>

      <div class="form-grid-4">
        ${entries.map(([field, value]) => `
          <div class="label">${importLabelForField(field)}</div>
          <input data-import-field="${field}" value="${safeVal(value)}">
        `).join('')}
      </div>

      <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap;">
        <button type="button" class="export-doc-btn primary" id="btnApplyImportWord">
          Aplicar datos a la ficha
        </button>

        <button type="button" class="export-doc-btn" id="btnCancelImportWord">
          Cancelar
        </button>
      </div>
    </div>
  `;

  document.getElementById('btnApplyImportWord')?.addEventListener('click', async () => {
    await aplicarImportWord(unitId);
  });

  document.getElementById('btnCancelImportWord')?.addEventListener('click', () => {
    box.innerHTML = '';
  });
}

async function previewImportWord(unitId) {
  const input = document.getElementById('importWordInput');
  const file = input?.files?.[0];

  if (!file) {
    alert('Selecciona un archivo Word.');
    return;
  }

  const fd = new FormData();
  fd.append('file', file);

  const result = await apiUpload(`/api/import-word/preview/${unitId}`, fd);

  if (!result?.ok) {
    alert(result?.error || 'No se pudo leer el Word');
    return;
  }

  renderImportWordPreview(unitId, result.detected || {}, result.type);
}

async function aplicarImportWord(unitId) {
  const inputs = document.querySelectorAll('[data-import-field]');
  const data = {};

  inputs.forEach(input => {
    const key = input.dataset.importField;
    data[key] = input.value;
  });

  console.log('[IMPORT WORD] applying unitId:', unitId);
  console.log('[IMPORT WORD] data:', data);

  let result;

  try {
    result = await apiPost(`/api/import-word/apply/${unitId}`, { data });
  } catch (e) {
    console.error('[IMPORT WORD] apply error:', e);
    alert('Error aplicando importación. Mira la consola del backend.');
    return;
  }

  if (!result?.ok) {
    alert(result?.error || 'Error aplicando importación');
    return;
  }

  alert('Datos importados correctamente.');

  await loadVentasMap();

  await abrirFichaUnidad(unitId);

  await loadUnits();
}

  async function abrirFichaUnidad(unitId) {
  fichaUnitId = unitId;

  const u = unitsCache.find(x => String(x._id) === String(unitId)) || await apiGet(`/api/units/${unitId}`);
  const rawV = ventasMap.get(String(unitId)) || {};
  const v = Object.assign(Object.create(null), rawV);

  const info = (txt) => `
  <span class="info-wrap">
    <button type="button" class="info-btn" title="${safeVal(txt)}">i</button>
    <span class="info-tooltip">${safeVal(txt)}</span>
  </span>
`;

  const selectOptions = (opts, current = '') =>
    opts.map(o => `<option value="${o.v}" ${String(current || '') === o.v ? 'selected' : ''}>${o.l}</option>`).join('');

  const selectCustom = (id, label, opts, current = '') => `
    <div class="label">${label}</div>
    <select id="${id}">
      ${selectOptions(opts, current)}
    </select>
  `;

  const bankSelectCustom = (id, label, current = '') => `
    <div class="label">${label}</div>
    ${window.BankSelect?.bankSelectHtml?.(id, current) || input(id, label, current)}
  `;

  const tituloUnidad = document.getElementById('fichaTitulo');

tituloUnidad.innerHTML = `
  <span>Unidad</span>
  <input
    id="fu-nombreUnidad"
    class="unit-title-input"
    value="${safeVal(`${u.manzana || ''}-${u.lote || ''}`)}"
    title="Haz click para editar el nombre de la unidad"
  >
`;

  const cont = document.getElementById('fichaContenido');
  cont.innerHTML = `
    <div class="modal-tabs" id="fichaTabs">
  <button class="modal-tab active" data-tab="ficha">Ficha</button>
  <button class="modal-tab" data-tab="checklist">Checklist</button>
  <button class="modal-tab" data-tab="docs">Documentos</button>
  <button class="modal-tab" data-tab="exports">Exportar PDF</button>
</div>
    <div id="fichaViews"></div>
  `;

  const htmlUnidad = seccion('Datos de la unidad', `
    <div class="label label-with-info">
  <span>Estado</span>
  ${info('Estado comercial actual de la unidad.')}
</div>
    <select id="fu-estado">
      ${UNIT_ESTADOS
        .map(s => `<option value="${s.v}" ${normalizeUnitEstadoFrontend(u.estado) === s.v ? 'selected' : ''}>${s.l}</option>`)
        .join('')}
    </select>

   <div class="label">Modelo definido ${info('Selecciona una plantilla del proyecto para completar datos base. Puedes dejarlo manual.')}</div>
   <select id="fu-modeloSelect">${projectModelOptions(u.modelId || u.modelo || '')}</select>
   ${input('fu-modelo', `Modelo ${info('Modelo de vivienda asignado. Según el modelo seleccionado deberían completarse automáticamente áreas, recámaras y baños definidos por administración.')}`, u.modelo || '')}
${inputNum('fu-m2', `m² unidad ${info('Área general de la unidad. Puede servir como referencia rápida, aunque el modelo Bank73 separa metraje de lote, área abierta, área cerrada y área total de construcción.')}`, u.m2 || 0)}
${inputNum('fu-precio', `Precio lista ${info('Precio comercial base de la unidad antes de ajustes, abonos o financiamiento.')}`, u.precioLista || 0)}

${input('fv-numeroFinca', `Número de finca ${info('Identificador registral del inmueble. Según el modelo, este dato debería ser gestionado principalmente por administración.')}`, v.numeroFinca || '')}
${input('fv-codigoUbicacion', `Código de ubicación ${info('Código de ubicación registral o catastral del inmueble. Dato administrativo/legal del bien.')}`, v.codigoUbicacion || '')}
${input('fv-calle', `Calle ${info('Calle o vial interno donde se encuentra la unidad dentro del proyecto.')}`, v.calle || '')}

${selectCustom('fv-loteEsquina', `Lote esquina ${info('Indica si el lote es esquinero. Puede afectar precio, metraje adicional o condiciones comerciales.')}`, [
  { v: '', l: '—' },
  { v: 'SI', l: 'Sí' },
  { v: 'NO', l: 'No' }
], v.loteEsquina || '')}
${inputNum('fv-metrosExtra', `M² extra ${info('Metros adicionales asociados al lote o a condiciones especiales del inmueble.')}`, v.metrosExtra || 0)}
${inputNum('fv-precioLoteEsquina', `Precio lote esquinero ${info('Importe adicional aplicable si la unidad corresponde a lote de esquina.')}`, v.precioLoteEsquina || 0)}
${inputNum('fv-precioM2Extra', `Precio m² extra ${info('Precio aplicado por cada metro cuadrado adicional.')}`, v.precioM2Extra || 0)}

${inputNum('fv-areaAbierta', `Área abierta vivienda (m²) ${info('Área abierta de la vivienda. Según el modelo, debería completarse automáticamente al seleccionar el modelo definido por administración.')}`, v.areaAbierta || 0)}
${inputNum('fv-areaCerrada', `Área cerrada vivienda (m²) ${info('Área cerrada de la vivienda. Según el modelo, debería venir asociada al modelo de vivienda seleccionado.')}`, v.areaCerrada || 0)}
${inputNum('fv-areaTotalConstruccion', `Área total construcción (m²) ${info('Se calcula automáticamente como área abierta + área cerrada.')}`, (parseDecimalMeasureNumber(v.areaAbierta || 0) + parseDecimalMeasureNumber(v.areaCerrada || 0)), { readonly: true })}
${inputNum('fv-recamaras', `Recámaras ${info('Cantidad de recámaras. Según el modelo, debería completarse automáticamente según la tipología de vivienda.')}`, v.recamaras || 0)}
${inputNum('fv-banos', `Baños ${info('Cantidad de baños. Según el modelo, debería completarse automáticamente según la tipología de vivienda.')}`, v.banos || 0)}

${inputNum('fv-valorMejoras', `Valor mejoras ${info('Valor de las mejoras/construcción. En el modelo se calcula como precio de venta menos valor del terreno.')}`, v.valorMejoras || 0)}
${inputNum('fv-valorTerreno', `Valor terreno ${info('Valor asignado al terreno dentro del precio total de la unidad.')}`, v.valorTerreno || 0)}
`);

const htmlCliente1 = seccion('Cliente 1 / Solicitante principal', `
${input('fv-clienteNombre', `Nickname ${info('Nombre resumen del cliente para búsquedas, tarjetas y reportes comerciales.')}`, v.clienteNombre || '')}
${input('fv-primerNombre', `Primer nombre ${info('Primer nombre del solicitante principal.')}`, v.primerNombre || '')}
${input('fv-segundoNombre', `Segundo nombre ${info('Segundo nombre del solicitante principal, si aplica.')}`, v.segundoNombre || '')}
${input('fv-primerApellido', `Apellido paterno ${info('Primer apellido del solicitante principal.')}`, v.primerApellido || '')}
${input('fv-segundoApellido', `Apellido materno ${info('Segundo apellido del solicitante principal.')}`, v.segundoApellido || '')}
${input('fv-apellidoCasada', `Apellido de casada ${info('Apellido de casada del solicitante, si aplica.')}`, v.apellidoCasada || '')}

${input('fv-cedula', `Cédula ${info('Documento de identidad del cliente. Forma parte de la documentación base para aprobación bancaria.')}`, v.cedula || '')}
${selectCustom('fv-sexo', `Sexo ${info('Dato de identificación del cliente.')}`, [
  { v: '', l: '—' },
  { v: 'M', l: 'Masculino' },
  { v: 'F', l: 'Femenino' }
], v.sexo || '')}
${input('fv-profesion', `Profesión ${info('Profesión u ocupación del cliente. Ayuda a clasificar el perfil financiero.')}`, v.profesion || '')}
${selectCustom('fv-estadoCivil', `Estado civil ${info('Estado civil del cliente. El modelo contempla principalmente Soltero o Casado.')}`, [
  { v: '', l: '—' },
  { v: 'Soltero', l: 'Soltero' },
  { v: 'Casado', l: 'Casado' }
], v.estadoCivil || '')}

${input('fv-direccion', `Dirección / domicilio ${info('Dirección actual donde reside el cliente.')}`, v.direccion || '')}
${input('fv-telefonoResidencial', `Teléfono residencial ${info('Teléfono fijo o residencial del cliente, si aplica.')}`, v.telefonoResidencial || '')}
${input('fv-telefonoOficina', `Teléfono oficina ${info('Teléfono laboral o de oficina del cliente, si aplica.')}`, v.telefonoOficina || '')}
${input('fv-celular', `Celular ${info('Teléfono móvil principal del cliente.')}`, v.celular || '')}
${input('fv-correo', `Correo electrónico ${info('Correo electrónico del cliente para contacto y seguimiento documental.')}`, v.correo || '')}

${selectCustom('fv-perfilCliente', `Perfil ${info('Perfil laboral del cliente. Define qué documentación debe solicitarse para aprobación: asalariado o independiente.')}`, [
  { v: '', l: '—' },
  { v: 'Independiente', l: 'Independiente' },
  { v: 'Asalariado', l: 'Asalariado' }
], v.perfilCliente || '')}
${selectCustom('fv-tipoEmpresa', `Tipo de empresa ${info('Tipo de empleador del cliente asalariado: empresa privada o gubernamental.')}`, [
  { v: '', l: '—' },
  { v: 'Privada', l: 'Privada' },
  { v: 'Gubernamental', l: 'Gubernamental' }
], v.tipoEmpresa || '')}
${selectCustom('fv-sectorEmpresa', `Sector empresarial ${info('Sector o actividad del cliente. El modelo contempla agrícola, profesional idóneo u otros.')}`, [
  { v: '', l: '—' },
  { v: 'Agrícola', l: 'Agrícola' },
  { v: 'Profesional idóneo', l: 'Profesional idóneo' },
  { v: 'Otros', l: 'Otros' }
], v.sectorEmpresa || '')}

${inputNum('fv-ingresoMensual', `Ingreso mensual ${info('Ingreso mensual declarado del cliente para análisis de capacidad de pago.')}`, v.ingresoMensual || 0)}
${input('fv-cargo', `Cargo que desempeña ${info('Cargo, puesto o función del cliente dentro de la empresa.')}`, v.cargo || '')}
${input('fv-antiguedadLaboral', `Antigüedad laboral ${info('Tiempo que lleva el cliente en su empleo o actividad actual.')}`, v.antiguedadLaboral || '')}
`);

const htmlCliente2 = seccion('Cliente 2 / Co-solicitante', `
${input('fv-cliente2PrimerNombre', `Primer nombre ${info('Primer nombre del co-solicitante, si existe.')}`, v.cliente2PrimerNombre || '')}
${input('fv-cliente2SegundoNombre', `Segundo nombre ${info('Segundo nombre del co-solicitante, si aplica.')}`, v.cliente2SegundoNombre || '')}
${input('fv-cliente2PrimerApellido', `Apellido paterno ${info('Primer apellido del co-solicitante.')}`, v.cliente2PrimerApellido || '')}
${input('fv-cliente2SegundoApellido', `Apellido materno ${info('Segundo apellido del co-solicitante.')}`, v.cliente2SegundoApellido || '')}
${input('fv-cliente2ApellidoCasada', `Apellido de casada ${info('Apellido de casada del co-solicitante, si aplica.')}`, v.cliente2ApellidoCasada || '')}
${input('fv-cliente2Cedula', `Cédula ${info('Documento de identidad del co-solicitante.')}`, v.cliente2Cedula || '')}

${selectCustom('fv-cliente2Sexo', `Sexo ${info('Dato de identificación del co-solicitante.')}`, [
  { v: '', l: '—' },
  { v: 'M', l: 'Masculino' },
  { v: 'F', l: 'Femenino' }
], v.cliente2Sexo || '')}
${input('fv-cliente2Profesion', `Profesión ${info('Profesión u ocupación del co-solicitante.')}`, v.cliente2Profesion || '')}
${selectCustom('fv-cliente2EstadoCivil', `Estado civil ${info('Estado civil del co-solicitante.')}`, [
  { v: '', l: '—' },
  { v: 'Soltero', l: 'Soltero' },
  { v: 'Casado', l: 'Casado' }
], v.cliente2EstadoCivil || '')}
${input('fv-cliente2Direccion', `Dirección / domicilio ${info('Dirección actual donde reside el co-solicitante.')}`, v.cliente2Direccion || '')}

${input('fv-cliente2TelefonoResidencial', `Teléfono residencial ${info('Teléfono residencial del co-solicitante, si aplica.')}`, v.cliente2TelefonoResidencial || '')}
${input('fv-cliente2TelefonoOficina', `Teléfono oficina ${info('Teléfono laboral o de oficina del co-solicitante.')}`, v.cliente2TelefonoOficina || '')}
${input('fv-cliente2Celular', `Celular ${info('Teléfono móvil principal del co-solicitante.')}`, v.cliente2Celular || '')}
${input('fv-cliente2Correo', `Correo ${info('Correo electrónico del co-solicitante.')}`, v.cliente2Correo || '')}

${inputNum('fv-cliente2IngresoMensual', `Ingreso mensual ${info('Ingreso mensual declarado del co-solicitante.')}`, v.cliente2IngresoMensual || 0)}
${input('fv-cliente2Cargo', `Cargo ${info('Cargo o función laboral del co-solicitante.')}`, v.cliente2Cargo || '')}
${input('fv-cliente2AntiguedadLaboral', `Antigüedad laboral ${info('Tiempo que lleva el co-solicitante en su empleo o actividad actual.')}`, v.cliente2AntiguedadLaboral || '')}
`);

const htmlReferencias = seccion('Referencias personales', `
${input('fv-referencia1Nombre', `Referencia 1 - Nombre ${info('Nombre de la primera referencia personal.')}`, v.referencia1Nombre || '')}
${input('fv-referencia1Relacion', `Referencia 1 - Relación ${info('Relación de la referencia con el cliente.')}`, v.referencia1Relacion || '')}
${input('fv-referencia1Telefono', `Referencia 1 - Teléfono ${info('Teléfono principal de la referencia.')}`, v.referencia1Telefono || '')}
${input('fv-referencia1TelefonoTrabajo', `Referencia 1 - Tel. trabajo ${info('Teléfono laboral de la referencia, si aplica.')}`, v.referencia1TelefonoTrabajo || '')}

${input('fv-referencia2Nombre', `Referencia 2 - Nombre ${info('Nombre de la segunda referencia personal.')}`, v.referencia2Nombre || '')}
${input('fv-referencia2Relacion', `Referencia 2 - Relación ${info('Relación de la segunda referencia con el cliente.')}`, v.referencia2Relacion || '')}
${input('fv-referencia2Telefono', `Referencia 2 - Teléfono ${info('Teléfono principal de la segunda referencia.')}`, v.referencia2Telefono || '')}
${input('fv-referencia2TelefonoTrabajo', `Referencia 2 - Tel. trabajo ${info('Teléfono laboral de la segunda referencia, si aplica.')}`, v.referencia2TelefonoTrabajo || '')}
`, 'form-grid-2');

const htmlFinanciamiento = seccion('Financiamiento / Proforma', `
${inputNum('fv-precioVenta', `Precio de venta ${info('Precio comercial de venta de la unidad. Según el modelo, es un dato principalmente administrativo.')}`, v.precioVenta || u.precioLista || 0)}
${inputDate('fv-fechaProbableEntrega', `Fecha probable de entrega ${info('Fecha estimada de entrega de la vivienda. Se mueve a financiamiento por seguimiento de crédito/desembolsos.')}`, v.fechaProbableEntrega)}
${inputNum('fv-montoFinanciamientoCPP', `Monto financiamiento CPP / hipoteca ${info('Monto financiado mediante Carta Promesa de Pago o hipoteca aprobada.')}`, v.montoFinanciamientoCPP || v.valor || 0)}
${inputNum('fv-abonoInicial', `Abono inicial ${info('Se calcula automáticamente como precio de venta menos monto de financiamiento.')}`, v.abonoInicial || 0, { readonly: true })}
${inputNum('fv-porcentajeFinanciamiento', `% financiamiento ${info('Porcentaje del precio de venta cubierto por financiamiento bancario.')}`, v.porcentajeFinanciamiento || 0)}
${input('fv-cesionAFavorDe', `Cesión a favor de ${info('Entidad o banco a favor de quien se realiza la cesión de la CPP, si aplica.')}`, v.cesionAFavorDe || '')}

${bankSelectCustom('fv-banco', `Banco del cliente ${info('Banco que tramita o aprueba el financiamiento del cliente.')}`, v.banco || '')}
${input('fv-oficialBanco', `Oficial de trámite / crédito ${info('Oficial bancario encargado del expediente de crédito del cliente.')}`, v.oficialBanco || '')}
${inputDate('fv-fechaProforma', `Fecha proforma ${info('Fecha de emisión de la proforma comercial.')}`, v.fechaProforma)}

${selectRow('fv-statusBancoSel', `Status en Banco ${info('Estado actual del expediente en el banco: proforma, revisión, aprobado, desembolso, escriturado u otro.')}`, '')}
<div class="label" id="fv-statusBancoOtherLbl" style="display:none;">Especificar (OTRO)</div>
<input id="fv-statusBancoOther" style="display:none;" placeholder="Especificar (OTRO)...">

${selectCustom('fv-estatusCPP', `Estatus de CPP ${info('Estado de avance de la Carta Promesa de Pago: documentación entregada, en comité, aprobado o CPP recibida.')}`, [
  { v: '', l: '—' },
  { v: 'Documentación entregada', l: 'Documentación entregada' },
  { v: 'En comité', l: 'En comité' },
  { v: 'Aprobado', l: 'Aprobado' },
  { v: 'CPP recibida', l: 'CPP recibida' }
], v.estatusCPP || '')}
${input('fv-numCPP', `N° CPP ${info('Número o referencia de la Carta Promesa de Pago emitida por el banco.')}`, v.numCPP || '')}
${inputNum('fv-plazoAprobacionDias', `Plazo aprobación (días) ${info('Plazo estimado o pactado para aprobación del financiamiento.')}`, v.plazoAprobacionDias)}
${inputDate('fv-fechaValorCPP', `Fecha valor CPP ${info('Fecha de emisión o valor de la CPP.')}`, v.fechaValorCPP)}
${inputDate('fv-fechaVencimientoCPP', `Vencimiento CPP ${info('Fecha de vencimiento de la CPP. El modelo sugiere generar alerta aproximadamente dos meses antes del vencimiento.')}`, v.fechaVencimientoCPP)}

${inputChk('fv-aperturaCtaBanco', `Apertura cuenta banco ${info('Checklist para confirmar si el cliente abrió la cuenta bancaria requerida.')}`, !!v.aperturaCtaBanco)}
${inputChk('fv-pagoMinuta', `Pago minuta ${info('Control de pago relacionado con minuta o trámite legal, si aplica.')}`, !!v.pagoMinuta)}
${inputChk('fv-polizas', `Pólizas ${info('Checklist para confirmar gestión de pólizas requeridas por el financiamiento.')}`, !!v.polizas)}
${selectCustom('fv-tipoPoliza', `Tipo de póliza ${info('Tipo de póliza asociada al financiamiento: endosada o colectiva.')}`, [
  { v: '', l: '—' },
  { v: 'Endosada', l: 'Endosada' },
  { v: 'Colectiva', l: 'Colectiva' }
], v.tipoPoliza || '')}
`);

const htmlContrato = seccion('Contrato / Protocolo / Notaría / Registro Público', `
${inputDate('fv-fechaContratoCliente', `Fecha contrato firmado por cliente ${info('Fecha en que el cliente firma el contrato promesa de compraventa.')}`, v.fechaContratoCliente)}
${inputNum('fv-montoContrato', `Monto del contrato ${info('Monto reflejado en el contrato promesa de compraventa.')}`, v.montoContrato || 0)}
${input('fv-pagare', `Pagaré ${info('Referencia o estado del pagaré, si el flujo legal/financiero lo requiere.')}`, v.pagare || '')}
${inputChk('fv-contratoFirmado', `Contrato firmado ${info('Checklist para confirmar que el contrato promesa de compraventa fue firmado.')}`, !!v.contratoFirmado)}

${inputDate('fv-fechaActivacionTramite', `Fecha activación trámite legal ${info('Fecha en la que se activa formalmente el trámite legal de la unidad.')}`, v.fechaActivacionTramite)}

${inputChk('fv-protocoloFirmaCliente', `Protocolo firma cliente ${info('Checklist para confirmar firma de protocolo por parte del cliente.')}`, !!v.protocoloFirmaCliente)}
${inputDate('fv-fechaEntregaBanco', `Fecha entrega a banco ${info('Fecha de entrega del protocolo o documentación legal al banco correspondiente.')}`, v.fechaEntregaBanco)}
${inputChk('fv-protocoloFirmaRLBancoInter', `Protocolo firma RL / Banco Inter ${info('Checklist para confirmar firma del representante legal o banco interino.')}`, !!v.protocoloFirmaRLBancoInter)}
${inputDate('fv-fechaRegresoBanco', `Fecha regreso banco ${info('Fecha en que el documento/protocolo regresa desde el banco.')}`, v.fechaRegresoBanco)}
${inputNum('fv-diasTranscurridosBanco', `Días transcurridos banco ${info('Días transcurridos entre entrega al banco y regreso del documento.')}`, v.diasTranscurridosBanco)}

${inputDate('fv-fechaEntregaProtocoloBancoCli', `Entrega protocolo banco cliente ${info('Fecha de entrega del protocolo al banco del cliente.')}`, v.fechaEntregaProtocoloBancoCli)}
${inputChk('fv-firmaProtocoloBancoCliente', `Firma protocolo banco cliente ${info('Checklist para confirmar firma del protocolo por parte del banco del cliente.')}`, !!v.firmaProtocoloBancoCliente)}
${inputDate('fv-fechaRegresoProtocoloBancoCli', `Regreso protocolo banco cliente ${info('Fecha en la que regresa el protocolo firmado por el banco del cliente.')}`, v.fechaRegresoProtocoloBancoCli)}
${inputNum('fv-diasTranscurridosProtocolo', `Días transcurridos protocolo ${info('Días transcurridos en el ciclo de protocolo con el banco del cliente.')}`, v.diasTranscurridosProtocolo)}

${inputChk('fv-pagoImpuestos', `Pago de impuestos ${info('Checklist para confirmar pago de impuestos antes del cierre o inscripción.')}`, !!v.pagoImpuestos)}
${inputDate('fv-fechaPagoImpuesto', `Fecha pago impuestos ${info('Fecha en la que se realizó el pago de impuestos correspondiente.')}`, v.fechaPagoImpuesto)}
${inputChk('fv-cierreNotaria', `Cierre de notaría ${info('Checklist para confirmar que el expediente fue cerrado en notaría.')}`, !!v.cierreNotaria)}
${inputChk('fv-ingresoRP', `Ingreso al RP ${info('Checklist para confirmar ingreso del trámite al Registro Público.')}`, !!v.ingresoRP)}
${inputDate('fv-fechaIngresoRP', `Fecha ingreso RP ${info('Fecha de ingreso del documento al Registro Público.')}`, v.fechaIngresoRP)}
${inputDate('fv-fechaInscripcion', `Fecha inscripción ${info('Fecha de inscripción definitiva en Registro Público.')}`, v.fechaInscripcion)}
${inputChk('fv-solicitudDesembolso', `Solicitud desembolso ${info('Checklist para confirmar que se solicitó el desembolso correspondiente.')}`, !!v.solicitudDesembolso)}
${inputDate('fv-fechaDesembolso', `Fecha desembolso ${info('Fecha efectiva del desembolso del financiamiento.')}`, v.fechaDesembolso)}
${inputDate('fv-fechaRecibidoCheque', `Fecha recibido cheque ${info('Fecha en la que se recibe cheque o pago asociado al desembolso.')}`, v.fechaRecibidoCheque)}
`);

const htmlTecnico = seccion('Técnico / Permisos / Construcción', `
${inputChk('fv-enConstruccion', `En construcción ${info('Indica si la unidad se encuentra actualmente en proceso constructivo.')}`, !!v.enConstruccion)}
${selectCustom('fv-estatusConstruccion', `Estatus construcción ${info('Estado técnico de avance de la vivienda: pendiente, obra gris, acabados o culminada.')}`, [
  { v: '', l: '—' },
  { v: 'Pendiente', l: 'Pendiente' },
  { v: 'Obra gris', l: 'Obra gris' },
  { v: 'Acabados', l: 'Acabados' },
  { v: 'Culminada', l: 'Culminada' }
], v.estatusConstruccion || '')}
${input('fv-faseConstruccion', `Fase construcción ${info('Detalle adicional de la fase constructiva de la unidad.')}`, v.faseConstruccion || '')}

${inputChk('fv-permisoConstruccionMunicipal', `Permiso construcción municipal ${info('Checklist para confirmar existencia del permiso de construcción municipal.')}`, !!v.permisoConstruccionMunicipal)}
${input('fv-permisoConstruccionNum', `Resolución permiso construcción ${info('Número de resolución del permiso de construcción municipal.')}`, v.permisoConstruccionNum || '')}
${inputChk('fv-permisoOcupacion', `Permiso ocupación municipal ${info('Checklist para confirmar existencia del permiso de ocupación municipal.')}`, !!v.permisoOcupacion)}
${input('fv-permisoOcupacionNum', `Resolución permiso ocupación ${info('Número de resolución del permiso de ocupación municipal.')}`, v.permisoOcupacionNum || '')}
${inputDate('fv-fechaEmisionPermisoOcupacion', `Fecha emisión permiso ocupación ${info('Fecha en la que fue emitido el permiso de ocupación municipal.')}`, v.fechaEmisionPermisoOcupacion)}
${input('fv-constructora', `Constructor / constructora ${info('Empresa o responsable de la construcción de la vivienda.')}`, v.constructora || '')}
`);

const htmlLegal = seccion('Legal / Avalúo / Minutas / Paz y salvo', `
${input('fv-solicitudAvaluo', `Solicitud de avalúo ${info('Estado o referencia de la solicitud de avalúo de la unidad.')}`, v.solicitudAvaluo || '')}
${input('fv-avaluoRealizado', `Avalúo realizado ${info('Indica si el avalúo fue realizado o su estado actual.')}`, v.avaluoRealizado || '')}
${inputDate('fv-fechaAvaluo', `Fecha avalúo ${info('Fecha en la que se realizó el avalúo.')}`, v.fechaAvaluo)}
${input('fv-empresaAvaluadora', `Empresa avaluadora ${info('Empresa responsable del avalúo de la unidad.')}`, v.empresaAvaluadora || '')}

${selectCustom('fv-mLiberacion', `Minuta liberación / desafectación ${info('Estado de la minuta de liberación o desafectación: solicitada, lista o no aplica.')}`, [
  { v: '', l: '—' },
  { v: 'Solicitada', l: 'Solicitada' },
  { v: 'Lista', l: 'Lista' },
  { v: 'No aplica', l: 'No aplica' }
], v.mLiberacion || '')}
${selectCustom('fv-mSegregacion', `Minuta segregación / venta ${info('Estado de la minuta de segregación o venta: solicitada, lista o no aplica.')}`, [
  { v: '', l: '—' },
  { v: 'Solicitada', l: 'Solicitada' },
  { v: 'Lista', l: 'Lista' },
  { v: 'No aplica', l: 'No aplica' }
], v.mSegregacion || '')}
${selectCustom('fv-mPrestamo', `Minuta préstamo ${info('Estado de la minuta de préstamo del banco cliente: solicitada, lista o no aplica.')}`, [
  { v: '', l: '—' },
  { v: 'Solicitada', l: 'Solicitada' },
  { v: 'Lista', l: 'Lista' },
  { v: 'No aplica', l: 'No aplica' }
], v.mPrestamo || '')}

${inputChk('fv-pazSalvoGesproban', `Paz y salvo Gesproban ${info('Checklist interno para confirmar paz y salvo de Gesproban, si aplica al proceso.')}`, !!v.pazSalvoGesproban)}
${inputChk('fv-pazSalvoPromotora', `Paz y salvo Promotora ${info('Checklist para confirmar paz y salvo de la promotora antes de cierre o entrega.')}`, !!v.pazSalvoPromotora)}
`);

// Bono MIVI retirado: se mantiene comentado para conservar la referencia histórica.
// const htmlMivi = seccion('MIVI', `
// ${input('fv-expedienteMIVI', `Expediente MIVI ${info('Número o referencia del expediente MIVI, si aplica.')}`, v.expedienteMIVI || '')}
// ${inputDate('fv-entregaExpMIVI', `Fecha entrega exp. MIVI ${info('Fecha de entrega del expediente al MIVI.')}`, v.entregaExpMIVI)}
// ${input('fv-resolucionMIVI', `N° Resolución MIVI ${info('Número de resolución emitida por MIVI, si aplica.')}`, v.resolucionMIVI || '')}
// ${inputDate('fv-fechaResolucionMIVI', `Fecha resolución ${info('Fecha de resolución MIVI.')}`, v.fechaResolucionMIVI)}
// ${inputDate('fv-solicitudMiviDesembolso', `Solicitud MIVI desembolso ${info('Fecha de solicitud de desembolso MIVI, si aplica.')}`, v.solicitudMiviDesembolso)}
// ${input('fv-desembolsoMivi', `Desembolso MIVI ${info('Estado o referencia del desembolso MIVI.')}`, v.desembolsoMivi || '')}
// ${inputDate('fv-fechaPagoMivi', `Fecha pago MIVI ${info('Fecha de pago o desembolso MIVI.')}`, v.fechaPagoMivi)}
// `);
const htmlMivi = '';

const htmlEntregaOtros = seccion('Entrega / Captación / Observaciones', `
${input('fv-entregaCasa', `Entrega de casa ${info('Estado o confirmación de entrega de la vivienda al cliente.')}`, v.entregaCasa || '')}
${input('fv-entregaANATI', `Entrega ANATI ${info('Estado o referencia de entrega ANATI, si aplica.')}`, v.entregaANATI || '')}
${inputDate('fv-fechaEntregaVivienda', `Fecha entrega vivienda ${info('Fecha efectiva de entrega de la vivienda al cliente.')}`, v.fechaEntregaVivienda)}

${inputChk('fv-captadoAtencionOficina', `Captado atención oficina ${info('Indica si el cliente fue captado mediante atención en oficina.')}`, !!v.captadoAtencionOficina)}
${inputChk('fv-captadoMailInternet', `Captado mail / internet ${info('Indica si el cliente fue captado por correo, web o canal digital.')}`, !!v.captadoMailInternet)}
${inputChk('fv-captadoEnProyecto', `Captado en proyecto ${info('Indica si el cliente fue captado directamente en el proyecto.')}`, !!v.captadoEnProyecto)}
${inputChk('fv-captadoMercadeoProspecto', `Captado mercadeo / prospecteo ${info('Indica si el cliente proviene de campañas de mercadeo o prospección comercial.')}`, !!v.captadoMercadeoProspecto)}

${input('fv-proformaSolicitadaPor', `Proforma solicitada por ${info('Persona o canal que solicitó la proforma.')}`, v.proformaSolicitadaPor || '')}
${input('fv-referidoPor', `Referido por ${info('Persona, canal o entidad que refirió al cliente.')}`, v.referidoPor || '')}
${input('fv-observacionCliente', `Observación cliente ${info('Observaciones relevantes sobre el cliente o su expediente.')}`, v.observacionCliente || '')}
${input('fv-comentario', `Comentario interno ${info('Comentario interno para seguimiento operativo, comercial, legal o bancario.')}`, v.comentario || '')}
`);

  const fichaHTML =
    htmlUnidad +
    htmlCliente1 +
    htmlCliente2 +
    htmlReferencias +
    htmlFinanciamiento +
    htmlContrato +
    htmlTecnico +
    htmlLegal +
    // htmlMivi +
    htmlEntregaOtros;

  const checklistHTML = renderChecklistView(v);

  const docsHTML = (typeof renderUnidadDocsSkeleton === 'function')
    ? renderUnidadDocsSkeleton(u)
    : `<div class="small muted">Subida de documentos por unidad aún no disponible.</div>`;

  const exportsHTML = `
  <div class="export-docs-card">
    <h3 style="color:white;">Exportar documentos</h3>

    <p class="muted" style="color:rgba(255,255,255,0.75);">
      Genera automáticamente los PDFs con los datos guardados de esta unidad.
    </p>

    <div class="export-docs-actions">
      <button type="button" class="export-doc-btn primary" id="btnPdfFichaCliente">
        Descargar ficha de cliente
      </button>

      <button type="button" class="export-doc-btn primary" id="btnPdfProforma">
        Descargar proforma
      </button>
    </div>

    <hr style="margin:22px 0;border-color:rgba(255,255,255,.15);">

    <h3 style="color:white;">Importar Word</h3>

    <p class="muted" style="color:rgba(255,255,255,0.75);">
      Sube una ficha de cliente o proforma en Word. Bank73 detectará los campos y podrás revisarlos antes de aplicarlos.
    </p>

    <input id="importWordInput" type="file" accept=".docx" style="display:none;">

    <div class="export-docs-actions">
      <button type="button" class="export-doc-btn primary" id="btnImportWord">
        Importar ficha/proforma Word
      </button>
    </div>

    <div id="importWordPreview" style="margin-top:18px;"></div>
  </div>
`;
  const views = document.getElementById('fichaViews');
  const viewFicha = document.createElement('div');
const viewChk = document.createElement('div');
const viewDocs = document.createElement('div');
const viewExports = document.createElement('div');

  viewFicha.id = 'view-ficha';
  viewChk.id = 'view-checklist';
  viewDocs.id = 'view-docs';
  viewExports.id = 'view-exports';

  viewFicha.innerHTML = fichaHTML;
  viewChk.innerHTML = checklistHTML;
  viewDocs.innerHTML = docsHTML;
  viewExports.innerHTML = exportsHTML;

  views.innerHTML = '';
  views.appendChild(viewFicha);
  views.appendChild(viewChk);
  views.appendChild(viewDocs);
  views.appendChild(viewExports);

  initStatusBancoUI(
    'fv-statusBancoSel',
    'fv-statusBancoOtherLbl',
    'fv-statusBancoOther',
    v.statusBanco || '',
    { includeEmpty: false }
  );
  window.BankSelect?.bindBankSelect?.('fv-banco');

  const elCons = document.getElementById('fv-constructora');
  if (elCons) elCons.value = safeVal(v.constructora);

  viewFicha.style.display = '';
  viewChk.style.display = 'none';
  viewDocs.style.display = 'none';
  viewExports.style.display = 'none';

  cont.querySelectorAll('.modal-tab').forEach(btn => {
    btn.addEventListener('click', async () => {
      cont.querySelectorAll('.modal-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const tab = btn.dataset.tab;

      viewFicha.style.display = (tab === 'ficha') ? '' : 'none';
      viewChk.style.display = (tab === 'checklist') ? '' : 'none';
      viewDocs.style.display = (tab === 'docs') ? '' : 'none';
      viewExports.style.display = (tab === 'exports') ? '' : 'none';

      if (tab === 'docs') {
  unitDocInsideDepartment = false;
  unitDocFolderId = '';
  await refreshUnitDocsUI(id, unitId);
}
    });
  });

  wireChecklistHelpToggles();

  const entregaEl = document.getElementById('fv-entregaExpedienteBanco');
  const recibidoEl = document.getElementById('fv-recibidoCPP');

  if (entregaEl) entregaEl.addEventListener('change', refreshTiempoAprobacionDias);
  if (recibidoEl) recibidoEl.addEventListener('change', refreshTiempoAprobacionDias);

  refreshTiempoAprobacionDias();

  document.getElementById('fv-precioVenta')?.addEventListener('input', () => refreshFinanciamientoAuto('precio'));
document.getElementById('fv-montoFinanciamientoCPP')?.addEventListener('input', () => refreshFinanciamientoAuto('monto'));
document.getElementById('fv-porcentajeFinanciamiento')?.addEventListener('input', () => refreshFinanciamientoAuto('pct'));
document.getElementById('fv-areaAbierta')?.addEventListener('input', refreshAreaTotalConstruccion);
document.getElementById('fv-areaCerrada')?.addEventListener('input', refreshAreaTotalConstruccion);
document.getElementById('fu-modeloSelect')?.addEventListener('change', (event) => applyProjectModelToFicha(event.target.value));

refreshFinanciamientoAuto('monto');
refreshAreaTotalConstruccion();
  installSectionToggles();

  const btnPdfFichaCliente = document.getElementById('btnPdfFichaCliente');
const btnPdfProforma = document.getElementById('btnPdfProforma');
const btnImportWord = document.getElementById('btnImportWord');
const importWordInput = document.getElementById('importWordInput');

if (btnPdfFichaCliente) {
  btnPdfFichaCliente.addEventListener('click', async () => {

    await downloadFileWithLoading(
      btnPdfFichaCliente,
      `/api/export-pdf/ficha-cliente/${unitId}`,
      `ficha_cliente_${u.manzana || ''}_${u.lote || ''}.pdf`
    );

  });
}

if (btnPdfProforma) {
  btnPdfProforma.addEventListener('click', async () => {

    await downloadFileWithLoading(
      btnPdfProforma,
      `/api/export-pdf/proforma/${unitId}`,
      `proforma_${u.manzana || ''}_${u.lote || ''}.pdf`
    );

  });
}
if (btnImportWord && importWordInput) {

  btnImportWord.addEventListener('click', () => {
    importWordInput.value = '';
    importWordInput.click();
  });

  importWordInput.addEventListener('change', async () => {

    try {

      btnImportWord.disabled = true;
      btnImportWord.textContent = 'Leyendo Word...';

      await previewImportWord(unitId);

    } catch (e) {

      console.error(e);
      alert('Error importando Word: ' + (e.message || ''));

    } finally {

      btnImportWord.disabled = false;
      btnImportWord.textContent = 'Importar ficha/proforma Word';

    }

  });

}

  modalFicha.classList.remove('is-fullscreen');
  if (fichaExpandir) {
    fichaExpandir.textContent = '⛶';
    fichaExpandir.title = 'Pantalla completa';
    fichaExpandir.setAttribute('aria-label', 'Pantalla completa');
  }
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

  fichaGuardar.disabled = true;

  const oldText = fichaGuardar.textContent;
  fichaGuardar.textContent = 'Guardando...';
  fichaGuardar.classList.add('is-loading');

  try {
    // 1) Actualizar la unidad
    const nombreUnidad = (document.getElementById('fu-nombreUnidad')?.value || '').trim();

let manzana = '';
let lote = '';

if (nombreUnidad.includes('-')) {
  const parts = nombreUnidad.split('-');
  manzana = parts[0].trim();
  lote = parts.slice(1).join('-').trim();
} else {
  manzana = nombreUnidad.trim();
  lote = '';
}

const uBody = {
  manzana,
  lote,
  estado: document.getElementById('fu-estado').value,
  modelId: document.getElementById('fu-modeloSelect')?.value || undefined,
  modelo: document.getElementById('fu-modelo').value,
  m2: parseInputNumber('fu-m2', document.getElementById('fu-m2').value),
  precioLista: parsePanamaNumber(document.getElementById('fu-precio').value),
};

    await apiPatch(`/api/units/${fichaUnitId}`, uBody);

    // 2) Upsert de la venta
    const vBody = {
      projectId: id,
      unitId: fichaUnitId,

      // =====================================================
      // Cliente 1 / solicitante principal
      // =====================================================
      clienteNombre: vVal('fv-clienteNombre'),
      cedula: vVal('fv-cedula'),
      empresa: vVal('fv-empresa'),

      primerNombre: vVal('fv-primerNombre'),
      segundoNombre: vVal('fv-segundoNombre'),
      primerApellido: vVal('fv-primerApellido'),
      segundoApellido: vVal('fv-segundoApellido'),
      apellidoCasada: vVal('fv-apellidoCasada'),

      sexo: vVal('fv-sexo'),
      profesion: vVal('fv-profesion'),
      estadoCivil: vVal('fv-estadoCivil'),
      direccion: vVal('fv-direccion'),

      telefonoResidencial: vVal('fv-telefonoResidencial'),
      telefonoOficina: vVal('fv-telefonoOficina'),
      celular: vVal('fv-celular'),
      correo: vVal('fv-correo'),

      perfilCliente: vVal('fv-perfilCliente'),
      tipoEmpresa: vVal('fv-tipoEmpresa'),
      sectorEmpresa: vVal('fv-sectorEmpresa'),

      lugarTrabajo: vVal('fv-lugarTrabajo'),
      ingresoMensual: vNum('fv-ingresoMensual'),
      cargo: vVal('fv-cargo'),
      antiguedadLaboral: vVal('fv-antiguedadLaboral'),

      // =====================================================
      // Cliente 2 / co-solicitante
      // =====================================================
      cliente2PrimerNombre: vVal('fv-cliente2PrimerNombre'),
      cliente2SegundoNombre: vVal('fv-cliente2SegundoNombre'),
      cliente2PrimerApellido: vVal('fv-cliente2PrimerApellido'),
      cliente2SegundoApellido: vVal('fv-cliente2SegundoApellido'),
      cliente2ApellidoCasada: vVal('fv-cliente2ApellidoCasada'),
      cliente2Cedula: vVal('fv-cliente2Cedula'),

      cliente2Sexo: vVal('fv-cliente2Sexo'),
      cliente2Profesion: vVal('fv-cliente2Profesion'),
      cliente2EstadoCivil: vVal('fv-cliente2EstadoCivil'),
      cliente2Direccion: vVal('fv-cliente2Direccion'),

      cliente2TelefonoResidencial: vVal('fv-cliente2TelefonoResidencial'),
      cliente2TelefonoOficina: vVal('fv-cliente2TelefonoOficina'),
      cliente2Celular: vVal('fv-cliente2Celular'),
      cliente2Correo: vVal('fv-cliente2Correo'),

      cliente2LugarTrabajo: vVal('fv-cliente2LugarTrabajo'),
      cliente2IngresoMensual: vNum('fv-cliente2IngresoMensual'),
      cliente2Cargo: vVal('fv-cliente2Cargo'),
      cliente2AntiguedadLaboral: vVal('fv-cliente2AntiguedadLaboral'),

      // =====================================================
      // Parientes / referencias
      // =====================================================

      referencia1Nombre: vVal('fv-referencia1Nombre'),
      referencia1Relacion: vVal('fv-referencia1Relacion'),
      referencia1Telefono: vVal('fv-referencia1Telefono'),
      referencia1TelefonoTrabajo: vVal('fv-referencia1TelefonoTrabajo'),

      referencia2Nombre: vVal('fv-referencia2Nombre'),
      referencia2Relacion: vVal('fv-referencia2Relacion'),
      referencia2Telefono: vVal('fv-referencia2Telefono'),
      referencia2TelefonoTrabajo: vVal('fv-referencia2TelefonoTrabajo'),

      // =====================================================
      // Datos del inmueble / lote / vivienda
      // =====================================================
      numeroFinca: vVal('fv-numeroFinca'),
      codigoUbicacion: vVal('fv-codigoUbicacion'),
      ubicacion: vVal('fv-ubicacion'),
      calle: vVal('fv-calle'),

      metrajeLote: vNum('fv-metrajeLote'),
      loteEsquina: vVal('fv-loteEsquina'),
      metrosExtra: vNum('fv-metrosExtra'),
      precioLoteEsquina: vNum('fv-precioLoteEsquina'),
      precioM2Extra: vNum('fv-precioM2Extra'),

      areaAbierta: vNum('fv-areaAbierta'),
      areaCerrada: vNum('fv-areaCerrada'),
      areaTotalConstruccion: parseInputNumber('fv-areaAbierta', vVal('fv-areaAbierta')) + parseInputNumber('fv-areaCerrada', vVal('fv-areaCerrada')),
      recamaras: vNum('fv-recamaras'),
      banos: vNum('fv-banos'),

      valorMejoras: vNum('fv-valorMejoras'),
      valorTerreno: vNum('fv-valorTerreno'),
      fechaProbableEntrega: vDate('fv-fechaProbableEntrega'),

      // =====================================================
      // Banco / CPP / financiamiento
      // =====================================================
      banco: window.BankSelect?.getBankValue?.('fv-banco') || vVal('fv-banco'),
      oficialBanco: vVal('fv-oficialBanco'),
      statusBanco: getStatusBancoValue('fv-statusBancoSel', 'fv-statusBancoOther'),
      estatusCPP: vVal('fv-estatusCPP'),
      numCPP: vVal('fv-numCPP'),

      precioVenta: vNum('fv-precioVenta'),
      montoFinanciamientoCPP: vNum('fv-montoFinanciamientoCPP'),

      // legacy
      valor: vNum('fv-montoFinanciamientoCPP'),

      abonoCliente: vNum('fv-abonoCliente'),
      abonoInicial: Math.max(parsePanamaNumber(vVal('fv-precioVenta')) - parsePanamaNumber(vVal('fv-montoFinanciamientoCPP')), 0),
      porcentajeFinanciamiento: vNum('fv-porcentajeFinanciamiento'),
      cesionAFavorDe: vVal('fv-cesionAFavorDe'),

      entregaExpedienteBanco: vDate('fv-entregaExpedienteBanco'),
      recibidoCPP: vDate('fv-recibidoCPP'),
      plazoAprobacionDias: vNum('fv-plazoAprobacionDias'),
      fechaValorCPP: vDate('fv-fechaValorCPP'),
      fechaVencimientoCPP: vDate('fv-fechaVencimientoCPP'),
      vencimientoCPPBnMivi: vDate('fv-vencimientoCPPBnMivi'),

      fechaEntregaProformaBanco: vDate('fv-fechaEntregaProformaBanco'),
      fechaProforma: vDate('fv-fechaProforma'),

      aperturaCtaBanco: vChk('fv-aperturaCtaBanco'),
      primeraMensual: vChk('fv-primeraMensual'),
      pagoMinuta: vChk('fv-pagoMinuta'),

      tiempoAprobacionDias: calcDiffDays(
        vVal('fv-entregaExpedienteBanco'),
        vVal('fv-recibidoCPP')
      ),

      polizas: vChk('fv-polizas'),
      tipoPoliza: vVal('fv-tipoPoliza'),
      polizaVida: vVal('fv-polizaVida'),
      abonoAlte: vNum('fv-abonoAlte'),

      // =====================================================
      // Contrato / protocolo / notaría / RP
      // =====================================================
      fechaContratoCliente: vDate('fv-fechaContratoCliente'),
      estatusContrato: vVal('fv-estatusContrato'),
      montoContrato: vNum('fv-montoContrato'),
      pagare: vVal('fv-pagare'),
      fechaFirma: vDate('fv-fechaFirma'),
      contratoFirmado: vChk('fv-contratoFirmado'),

      fechaActivacionTramite: vDate('fv-fechaActivacionTramite'),

      protocoloFirmaCliente: vChk('fv-protocoloFirmaCliente'),
      fechaEntregaBanco: vDate('fv-fechaEntregaBanco'),
      protocoloFirmaRLBancoInter: vChk('fv-protocoloFirmaRLBancoInter'),
      fechaRegresoBanco: vDate('fv-fechaRegresoBanco'),
      diasTranscurridosBanco: vNum('fv-diasTranscurridosBanco'),

      fechaEntregaProtocoloBancoCli: vDate('fv-fechaEntregaProtocoloBancoCli'),
      firmaProtocoloBancoCliente: vChk('fv-firmaProtocoloBancoCliente'),
      fechaRegresoProtocoloBancoCli: vDate('fv-fechaRegresoProtocoloBancoCli'),
      diasTranscurridosProtocolo: vNum('fv-diasTranscurridosProtocolo'),

      cierreNotaria: vChk('fv-cierreNotaria'),
      pagoImpuestos: vChk('fv-pagoImpuestos'),
      fechaPagoImpuesto: vDate('fv-fechaPagoImpuesto'),
      ingresoRP: vChk('fv-ingresoRP'),
      fechaIngresoRP: vDate('fv-fechaIngresoRP'),
      fechaInscripcion: vDate('fv-fechaInscripcion'),

      solicitudDesembolso: vChk('fv-solicitudDesembolso'),
      fechaDesembolso: vDate('fv-fechaDesembolso'),
      fechaRecibidoCheque: vDate('fv-fechaRecibidoCheque'),

      // =====================================================
      // MIVI (retirado)
      // =====================================================
      // expedienteMIVI: vVal('fv-expedienteMIVI'),
      // entregaExpMIVI: vDate('fv-entregaExpMIVI'),
      // resolucionMIVI: vVal('fv-resolucionMIVI'),
      // fechaResolucionMIVI: vDate('fv-fechaResolucionMIVI'),
      // solicitudMiviDesembolso: vDate('fv-solicitudMiviDesembolso'),
      // desembolsoMivi: vVal('fv-desembolsoMivi'),
      // fechaPagoMivi: vDate('fv-fechaPagoMivi'),

      // =====================================================
      // Técnico / obra / permisos
      // =====================================================
      enConstruccion: vChk('fv-enConstruccion'),
      estatusConstruccion: vVal('fv-estatusConstruccion'),
      faseConstruccion: vVal('fv-faseConstruccion'),

      permisoConstruccionMunicipal: vChk('fv-permisoConstruccionMunicipal'),
      permisoConstruccionNum: vVal('fv-permisoConstruccionNum'),

      permisoOcupacion: vChk('fv-permisoOcupacion'),
      permisoOcupacionNum: vVal('fv-permisoOcupacionNum'),
      fechaEmisionPermisoOcupacion: vDate('fv-fechaEmisionPermisoOcupacion'),

      constructora: vVal('fv-constructora'),

      // =====================================================
      // Legal / minutas / avalúo / paz y salvo
      // =====================================================
      solicitudAvaluo: vVal('fv-solicitudAvaluo'),
      avaluoRealizado: vVal('fv-avaluoRealizado'),
      fechaAvaluo: vDate('fv-fechaAvaluo'),
      empresaAvaluadora: vVal('fv-empresaAvaluadora'),

      mLiberacion: vVal('fv-mLiberacion'),
      mSegregacion: vVal('fv-mSegregacion'),
      mPrestamo: vVal('fv-mPrestamo'),

      pazSalvoGesproban: vChk('fv-pazSalvoGesproban'),
      pazSalvoPromotora: vChk('fv-pazSalvoPromotora'),

      // =====================================================
      // Entrega / otros
      // =====================================================
      entregaCasa: vVal('fv-entregaCasa'),
      entregaANATI: vVal('fv-entregaANATI'),
      fechaEntregaVivienda: vDate('fv-fechaEntregaVivienda'),

      comentario: vVal('fv-comentario'),

      // =====================================================
      // Captación / proforma comercial
      // =====================================================
      captadoAtencionOficina: vChk('fv-captadoAtencionOficina'),
      captadoMailInternet: vChk('fv-captadoMailInternet'),
      captadoEnProyecto: vChk('fv-captadoEnProyecto'),
      captadoMercadeoProspecto: vChk('fv-captadoMercadeoProspecto'),

      proformaSolicitadaPor: vVal('fv-proformaSolicitadaPor'),
      referidoPor: vVal('fv-referidoPor'),
      observacionCliente: vVal('fv-observacionCliente'),
    };

    vBody.checklist = collectChecklistPayload();

    await apiPost('/api/ventas/upsert-by-unit', vBody);

    modalFicha.style.display = 'none';

    await loadUnits();
    await markProjectDataChanged();

  } catch (e) {
    console.error(e);
    alert('Error guardando la ficha');
  } finally {
    fichaGuardar.disabled = false;
    fichaGuardar.textContent = oldText;
    fichaGuardar.classList.remove('is-loading');
  }
}

  // === Batch ===
  function openBatch() {
  if (!selected.size) return alert('Selecciona al menos una unidad.');
  const bankBatch = document.getElementById('b-banco');
  if (bankBatch && window.BankSelect && !bankBatch.children.length) {
    bankBatch.innerHTML = window.BankSelect.bankOptionsHtml('');
  }
  window.BankSelect?.bindBankSelect?.('b-banco');
  modalBatch.querySelectorAll('input, select').forEach(el => {
    el.value = '';
  });
  document.getElementById('b-banco')?.dispatchEvent(new Event('change'));
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

  function addBatchField(update, field, type = 'text') {
    const el = document.getElementById(`b-${field}`);
    if (!el) return;

    const raw = field === 'banco' && window.BankSelect
      ? String(window.BankSelect.getBankValue('b-banco') || '').trim()
      : String(el.value || '').trim();
    if (!raw) return;

    if (type === 'number') {
      const num = parseInputNumber(`b-${field}`, raw);
      if (Number.isFinite(num)) update[field] = num;
      return;
    }

    if (type === 'date') {
      const dt = new Date(raw);
      if (!Number.isNaN(dt.getTime())) update[field] = dt.toISOString();
      return;
    }

    if (type === 'boolean') {
      update[field] = raw === 'true';
      return;
    }

    update[field] = raw;
  }

  function collectBatchVentaUpdate() {
    const update = {};

    [
      'banco',
      'oficialBanco',
      'numCPP',
      'estatusCPP',
      'cesionAFavorDe',
      'numeroFinca',
      'codigoUbicacion',
      'calle',
      'loteEsquina',
      'estatusConstruccion',
      'faseConstruccion',
      'permisoConstruccionNum',
      'permisoOcupacionNum',
      'constructora',
      'solicitudAvaluo',
      'avaluoRealizado',
      'empresaAvaluadora',
      'mLiberacion',
      'mSegregacion',
      'mPrestamo',
      'entregaCasa',
      'proformaSolicitadaPor',
      'referidoPor',
      'observacionCliente',
      'comentario'
    ].forEach(field => addBatchField(update, field));

    [
      'clienteNombre',
      'cedula',
      'empresa',
      'primerNombre',
      'segundoNombre',
      'primerApellido',
      'segundoApellido',
      'apellidoCasada',
      'sexo',
      'profesion',
      'estadoCivil',
      'direccion',
      'telefonoResidencial',
      'telefonoOficina',
      'celular',
      'correo',
      'perfilCliente',
      'tipoEmpresa',
      'sectorEmpresa',
      'lugarTrabajo',
      'cargo',
      'antiguedadLaboral',
      'cliente2PrimerNombre',
      'cliente2SegundoNombre',
      'cliente2PrimerApellido',
      'cliente2SegundoApellido',
      'cliente2ApellidoCasada',
      'cliente2Cedula',
      'cliente2Sexo',
      'cliente2Profesion',
      'cliente2EstadoCivil',
      'cliente2Direccion',
      'cliente2TelefonoResidencial',
      'cliente2TelefonoOficina',
      'cliente2Celular',
      'cliente2Correo',
      'cliente2LugarTrabajo',
      'cliente2Cargo',
      'cliente2AntiguedadLaboral'
    ].forEach(field => addBatchField(update, field));

    [
      'valor',
      'precioVenta',
      'montoFinanciamientoCPP',
      'porcentajeFinanciamiento',
      'metrosExtra',
      'precioLoteEsquina',
      'precioM2Extra',
      'areaAbierta',
      'areaCerrada',
      'recamaras',
      'banos',
      'valorMejoras',
      'valorTerreno',
      'montoContrato',
      'ingresoMensual',
      'cliente2IngresoMensual'
    ].forEach(field => addBatchField(update, field, 'number'));

    [
      'fechaProbableEntrega',
      'fechaProforma',
      'fechaVencimientoCPP',
      'fechaContratoCliente',
      'fechaActivacionTramite',
      'fechaEntregaBanco',
      'fechaInscripcion',
      'fechaDesembolso',
      'fechaEmisionPermisoOcupacion',
      'fechaAvaluo',
      'fechaEntregaVivienda'
    ].forEach(field => addBatchField(update, field, 'date'));

    [
      'contratoFirmado',
      'protocoloFirmaCliente',
      'pagoImpuestos',
      'ingresoRP',
      'solicitudDesembolso',
      'enConstruccion',
      'permisoConstruccionMunicipal',
      'permisoOcupacion',
      'pazSalvoGesproban',
      'pazSalvoPromotora',
      'captadoAtencionOficina',
      'captadoMailInternet',
      'captadoEnProyecto',
      'captadoMercadeoProspecto'
    ].forEach(field => addBatchField(update, field, 'boolean'));

    const sb = getStatusBancoValue('b-statusBancoSel','b-statusBancoOther');
    if (sb) update.statusBanco = sb;

    if (update.valor != null && update.montoFinanciamientoCPP == null) update.montoFinanciamientoCPP = update.valor;
    if (update.montoFinanciamientoCPP != null && update.valor == null) update.valor = update.montoFinanciamientoCPP;
    if (update.areaAbierta != null && update.areaCerrada != null) {
      update.areaTotalConstruccion = Number(update.areaAbierta || 0) + Number(update.areaCerrada || 0);
    }
    if (update.precioVenta != null && update.montoFinanciamientoCPP != null) {
      update.abonoInicial = Math.max(Number(update.precioVenta || 0) - Number(update.montoFinanciamientoCPP || 0), 0);
    }

    return update;
  }

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
    const m2 = document.getElementById('b-m2').value; if (m2) updUnit.m2 = parseInputNumber('b-m2', m2);
    const pr = document.getElementById('b-precio').value; if (pr) updUnit.precioLista = parsePanamaNumber(pr);
    if (Object.keys(updUnit).length) await apiPatch('/api/units/batch', { ids, update: updUnit, projectId: id });

    // Venta updates
    const updVenta = collectBatchVentaUpdate();
    if (Object.keys(updVenta).length) await apiPatch('/api/ventas/batch', { unitIds: ids, update: updVenta, upsert: true, projectId: id });

    closeBatch();
    await loadUnits();
    await markProjectDataChanged();
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
    await markProjectDataChanged();
  }

  // === Eventos ===
  function cerrarFichaUnidadModal() {
    modalFicha.classList.remove('is-fullscreen');
    modalFicha.style.display = 'none';
  }

  function toggleFichaFullscreen() {
    modalFicha.classList.toggle('is-fullscreen');
    const full = modalFicha.classList.contains('is-fullscreen');
    if (fichaExpandir) {
      fichaExpandir.textContent = full ? '□' : '⛶';
      fichaExpandir.title = full ? 'Restaurar tamaño' : 'Pantalla completa';
      fichaExpandir.setAttribute('aria-label', full ? 'Restaurar tamaño' : 'Pantalla completa');
    }
  }

  if (fichaGuardar) fichaGuardar.addEventListener('click', guardarFicha);
  if (fichaCerrarX) fichaCerrarX.addEventListener('click', cerrarFichaUnidadModal);
  if (fichaExpandir) fichaExpandir.addEventListener('click', toggleFichaFullscreen);

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

  if (btnCrear) btnCrear.addEventListener('click', () => {
    const modelSelect = document.getElementById('cl-modeloSelect');
    if (modelSelect) modelSelect.innerHTML = projectModelOptions('', { includeEmpty: true });
    const loc = document.getElementById('cl-ubicacion');
    if (loc) loc.value = state?.project?.location || state?.project?.address || '';
    modalCrear.style.display='flex';
  });
  if (modalCrearCerrar) modalCrearCerrar.addEventListener('click', () => modalCrear.style.display='none');
  if (btnBatch) btnBatch.addEventListener('click', openBatch);
  if (batchCerrar) batchCerrar.addEventListener('click', () => modalBatch.style.display='none');
  if (batchAplicar) batchAplicar.addEventListener('click', aplicarBatch);
  if (btnDel) btnDel.addEventListener('click', openDel);
  if (delCerrar) delCerrar.addEventListener('click', closeDel);
  if (delAplicar) delAplicar.addEventListener('click', aplicarDel);
  document.getElementById('cl-modeloSelect')?.addEventListener('change', (event) => applyProjectModelToOpenUnitForm(event.target.value));

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
        modelId: document.getElementById('cl-modeloSelect')?.value || undefined,
        modelo: document.getElementById('cl-modelo').value || '',
        ubicacion: document.getElementById('cl-ubicacion')?.value || state?.project?.location || state?.project?.address || '',
        m2: parseInputNumber('cl-m2', document.getElementById('cl-m2').value || 0),
        areaAbierta: parseInputNumber('cl-areaAbierta', document.getElementById('cl-areaAbierta')?.value || 0),
        areaCerrada: parseInputNumber('cl-areaCerrada', document.getElementById('cl-areaCerrada')?.value || 0),
        recamaras: parseInputNumber('cl-recamaras', document.getElementById('cl-recamaras')?.value || 0),
        banos: parseInputNumber('cl-banos', document.getElementById('cl-banos')?.value || 0),
        precioLista: parsePanamaNumber(document.getElementById('cl-precio').value || 0),
        estado: document.getElementById('cl-estado').value || 'disponible'
      };
      try {
        if (document.getElementById('cl-guardarModelo')?.checked && body.modelo) {
          const models = Array.isArray(state?.project?.housingModels) ? [...state.project.housingModels] : [];
          const exists = models.some(model => String(model.name || '').trim().toLowerCase() === String(body.modelo || '').trim().toLowerCase());
          if (!exists) {
            const initialStatuses = { disponible: 0, inventario: 0, reservado: 0, con_cpp: 0, tramite_legal_activado: 0, escriturado_traspasado: 0, vivienda_entregada: 0 };
            initialStatuses[body.estado] = body.cantidad;
            models.push({
              name: body.modelo,
              bedrooms: body.recamaras,
              bathrooms: body.banos,
              openAreaM2: body.areaAbierta || body.m2,
              closedAreaM2: body.areaCerrada,
              price: body.precioLista,
              unitsCount: body.cantidad,
              initialStatuses,
              observations: 'Creado desde Comercial'
            });
            await apiPatch(`/api/projects/${id}`, { housingModels: models });
            state.project.housingModels = models;
          }
        }
        await apiPost('/api/units/batch', body);
        modalCrear.style.display = 'none';
        await loadUnits();
        await markProjectDataChanged();
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
window.__docsModuleReady = true;

function invalidateProjectDocsCache() {
  _allDocs = [];
  _docsFolderMeta = null;
  _commercialDossierDocs = [];
}

function normStatus(s){ return String(s||'ACTIVE').toUpperCase(); }
function isActiveDoc(d){ return normStatus(d.status) === 'ACTIVE'; }

const PROJECT_DOC_FOLDERS = [
  { id: 'tecnico', label: 'Técnico', color: '#38bdf8', icon: 'T' },
  { id: 'comercial', label: 'Comercial', color: '#22c55e', icon: 'C' },
  { id: 'financiero', label: 'Financiero', color: '#f59e0b', icon: '$' },
  { id: 'legal', label: 'Legal', color: '#a78bfa', icon: 'L' },
  { id: 'gerencia', label: 'Gerencia', color: '#60a5fa', icon: 'G' }
];

let _docsFolderMeta = null;
let _activeDocsFolder = '';
let _activeDocsSubfolder = '';
let _docsManagersOpen = false;
let _movingDocId = '';
let _commercialDossierDocs = [];

function projectDocFolderLabel(folder) {
  const id = String(folder || '').toLowerCase();
  return PROJECT_DOC_FOLDERS.find(f => f.id === id)?.label || 'Gerencia';
}

function projectDocFolderConfig(folder) {
  const id = String(folder || '').toLowerCase();
  return PROJECT_DOC_FOLDERS.find(f => f.id === id) || PROJECT_DOC_FOLDERS[PROJECT_DOC_FOLDERS.length - 1];
}

function effectiveDocFolder(d) {
  const folder = String(d.folder || '').toLowerCase();
  return PROJECT_DOC_FOLDERS.some(f => f.id === folder) ? folder : 'gerencia';
}

function projectDocSubfolder(d) {
  return String(d.subfolder || '').trim();
}

function isCommercialDossierDoc(d) {
  return String(d?.category || '').trim() === 'commercialDossier';
}

function commercialDossierName(d) {
  return d?.originalname || d?.title || d?.name || 'Dossier comercial';
}

function commercialDossierSize(d) {
  const size = Number(d?.size || 0);
  if (!size) return '';
  const MB = 1024 * 1024;
  return size >= MB ? `${(size / MB).toFixed(2)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

async function loadCommercialDossierDocs(force = false) {
  if (_commercialDossierDocs.length && !force) return _commercialDossierDocs;

  const qs = new URLSearchParams({
    projectId: id,
    category: 'commercialDossier',
    folder: 'comercial',
    ts: String(Date.now())
  });

  _commercialDossierDocs = await API.get(`/api/documents?${qs.toString()}`)
    .catch(err => {
      console.warn('[Commercial dossier] No se pudo cargar', err);
      return [];
    });

  _commercialDossierDocs = Array.isArray(_commercialDossierDocs) ? _commercialDossierDocs : [];
  return _commercialDossierDocs;
}

function renderCommercialDossierButton(docs) {
  const btn = document.getElementById('commercialDossierBtn');
  const meta = document.getElementById('commercialDossierMeta');
  if (!btn || !meta) return;

  const count = Array.isArray(docs) ? docs.length : 0;
  btn.classList.toggle('has-file', count > 0);
  meta.textContent = count ? `${count} archivo${count === 1 ? '' : 's'}` : 'Sin archivo';
  btn.title = count
    ? `Dossier comercial: ${commercialDossierName(docs[0])}`
    : 'Subir dossier comercial del proyecto';
}

async function refreshCommercialDossier(force = false) {
  const docs = await loadCommercialDossierDocs(force);
  renderCommercialDossierButton(docs);
  return docs;
}

function renderCommercialDossierModal(docs) {
  const list = Array.isArray(docs) && docs.length ? docs.map(d => {
    const created = d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '';
    const size = commercialDossierSize(d);
    return `
      <div class="commercial-dossier-row">
        <div>
          <b>${escapeHtml(commercialDossierName(d))}</b>
          <div class="small muted">${escapeHtml([size, created ? `Subido: ${created}` : ''].filter(Boolean).join(' · '))}</div>
        </div>
        <div class="commercial-dossier-actions">
          <a class="btn btn-ghost btn-xs js-secure-file" href="#" data-url="${secureDocUrl(d._id)}" data-filename="${escapeHtml(commercialDossierName(d))}" data-action="view">Ver</a>
          <a class="btn btn-xs js-secure-file" href="#" data-url="${secureDocUrl(d._id)}" data-filename="${escapeHtml(commercialDossierName(d))}" data-action="download">Descargar</a>
          ${renderDeleteBtn(d)}
        </div>
      </div>
    `;
  }).join('') : '<div class="small muted">Todavia no hay dossier comercial guardado.</div>';

  return `
    <div class="commercial-dossier-upload">
      <input id="commercialDossierFile" type="file" accept=".pdf,.ppt,.pptx,.key,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" />
      <button id="commercialDossierUploadBtn" class="btn" type="button">Subir dossier</button>
    </div>
    <div class="small muted">Se guardara en Docs > Comercial y quedara disponible para descarga ejecutiva.</div>
    <div class="commercial-dossier-modal-list" style="margin-top:12px;">
      ${list}
    </div>
  `;
}

async function openCommercialDossierModal() {
  const docs = await refreshCommercialDossier(true);
  openModal('Dossier comercial', renderCommercialDossierModal(docs), 'Cerrar', () => {
    modalBackdrop.style.display = 'none';
  });

  const fileEl = document.getElementById('commercialDossierFile');
  const uploadBtn = document.getElementById('commercialDossierUploadBtn');
  if (!fileEl || !uploadBtn) return;

  uploadBtn.addEventListener('click', async () => {
    const f = fileEl.files && fileEl.files[0];
    if (!f) return alert('Selecciona un archivo primero');

    const fd = new FormData();
    fd.append('projectId', id);
    fd.append('file', f);
    fd.append('folder', 'comercial');
    fd.append('category', 'commercialDossier');

    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Subiendo...';

    try {
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: { ...tenantHeaders(), ...authHeaders() },
        body: fd,
        credentials: 'include'
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message || j?.error || `HTTP ${res.status}`);
      }

      fileEl.value = '';
      _allDocs = [];
      _commercialDossierDocs = [];
      if (document.getElementById('tab-docs')?.classList.contains('active')) {
        await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
      }
      await openCommercialDossierModal();
    } catch (err) {
      console.error('[Commercial dossier upload]', err);
      alert('No se pudo subir el dossier: ' + (err.message || 'Error desconocido'));
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Subir dossier';
    }
  });
}

document.getElementById('commercialDossierBtn')?.addEventListener('click', () => {
  openCommercialDossierModal().catch(err => {
    console.error('[Commercial dossier modal]', err);
    alert('No se pudo abrir el dossier comercial.');
  });
});

async function loadDocsFolderMeta(force = false) {
  if (_docsFolderMeta && !force) return _docsFolderMeta;
  _docsFolderMeta = await API.get(`/api/documents/folder-permissions?projectId=${encodeURIComponent(id)}&ts=${Date.now()}`).catch(() => ({
    folders: [],
    projectUsers: [],
    canManage: false
  }));
  _docsFolderMeta.folders = Array.isArray(_docsFolderMeta.folders) ? _docsFolderMeta.folders : [];
  _docsFolderMeta.projectUsers = Array.isArray(_docsFolderMeta.projectUsers) ? _docsFolderMeta.projectUsers : [];
  if (!_activeDocsFolder || !_docsFolderMeta.folders.some(f => f.folder === _activeDocsFolder)) {
    _activeDocsFolder = _docsFolderMeta.folders[0]?.folder || '';
    _activeDocsSubfolder = '';
  }
  return _docsFolderMeta;
}

function canViewGeneralDocs() {
  return !!id;
}

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

function docDepartmentLabel(d) {
  const dep = String(d.department || '').toLowerCase();
  if (dep === 'commercial') return 'Comercial';
  if (dep === 'tecnico') return 'Técnico';
  if (dep === 'legal') return 'Legal';
  return '';
}

function docChips(d){
  const chips = [];

  const dep = docDepartmentLabel(d);
  if (dep) chips.push(`<span class="chip">Área: ${escapeHtml(dep)}</span>`);

  if (d.checklistId) chips.push(`<span class="chip">Checklist: ${escapeHtml(findChecklistTitle(d.checklistId))}</span>`);
  if (d.unitTag)     chips.push(`<span class="chip">Unidad: ${escapeHtml(d.unitTag)}</span>`);
  if (d.baTag)       chips.push(`<span class="chip ${d.baTag === 'BEFORE' ? 'chip-gray' : 'chip-green'}">${escapeHtml(d.baTag)}</span>`);
  if (d.permitCode)  chips.push(`<span class="chip">Permiso: ${escapeHtml(d.permitCode)}</span>`);

  return chips.join(' ');
}

function canDeleteDoc() {
  return canViewGeneralDocs();
}

function renderDeleteBtn(d){
  if (!canDeleteDoc()) return '';
  return `<button class="btn btn-danger" data-del="${d._id}">Eliminar</button>`;
}

function renderMoveBtn(d, canManageDocs) {
  if (!canManageDocs) return '';
  return `<button class="btn btn-ghost" data-move-doc="${d._id}">Mover</button>`;
}

function canCompleteDoc(){
  return canViewGeneralDocs();
}

function renderCompleteBtn(d){
  const st = normStatus(d.status);
  if (!canCompleteDoc()) return '';
  if (st !== 'ACTIVE') return '';
  if (!d.expiryDate) return '';
  return `<button class="btn" data-complete="${d._id}">Cumplir</button>`;
}

function canReplaceDoc(){
  return canViewGeneralDocs();
}

function renderReplaceBtn(d){
  const st = normStatus(d.status);
  if (!canReplaceDoc()) return '';
  if (st !== 'ACTIVE') return '';
  if (!d.expiryDate) return '';
  return `<button class="btn" data-replace="${d._id}">Reemplazar</button>`;
}

function renderStatusPill(d){
  const st = normStatus(d.status);
  if (st === 'COMPLETED') return `<span class="pill pill-gray">CUMPLIDO</span>`;
  if (st === 'REPLACED')  return `<span class="pill pill-gray">REEMPLAZADO</span>`;
  if (!d.expiryDate) return '';
  return `<span class="pill pill-blue">ACTIVO</span>`;
}

function matchesDocQuery(d, q){
  if (!q) return true;

  q = q.toLowerCase();

  const fields = [
    d.originalname,
    d.title,
    d.filename,
    d.mimetype,
    d.unitTag,
    d.permitCode,
    d.permitTitle,
    projectDocFolderLabel(effectiveDocFolder(d)),
    projectDocSubfolder(d),
    docDepartmentLabel(d),
    findChecklistTitle(d.checklistId)
  ];

  return fields.some(v => String(v || '').toLowerCase().includes(q));
}

async function loadDocs({ q } = {}) {
  const docsDiv    = document.getElementById('docs');
  const uploadForm = document.getElementById('uploadForm');
  const countEl    = document.getElementById('docsCount');
  const folderSel  = document.getElementById('docsFolder');
  const subSel     = document.getElementById('docsSubfolder');

  if (!docsDiv) return;

  if (!canViewGeneralDocs()) {
    docsDiv.innerHTML = '<div class="small muted">No tienes acceso a la vista general de documentos.</div>';
    if (uploadForm) uploadForm.style.display = 'none';
    if (countEl) countEl.textContent = '';
    return;
  }

  if (uploadForm) uploadForm.style.display = '';
  const meta = await loadDocsFolderMeta();
  const visibleFolders = meta.folders || [];

  if (!visibleFolders.length) {
    docsDiv.innerHTML = '<div class="small muted">No tienes carpetas documentales asignadas en este proyecto.</div>';
    if (uploadForm) uploadForm.style.display = 'none';
    if (countEl) countEl.textContent = '';
    return;
  }

  if (!_activeDocsFolder) _activeDocsFolder = visibleFolders[0].folder;
  const activeFolderMeta = visibleFolders.find(f => f.folder === _activeDocsFolder) || visibleFolders[0];
  _activeDocsFolder = activeFolderMeta.folder;
  const subfolders = Array.isArray(activeFolderMeta.subfolders) ? activeFolderMeta.subfolders : [];

  if (folderSel) {
    folderSel.innerHTML = visibleFolders
      .map(f => `<option value="${escapeHtml(f.folder)}" ${f.folder === _activeDocsFolder ? 'selected' : ''}>${escapeHtml(projectDocFolderLabel(f.folder))}</option>`)
      .join('');
  }

  if (subSel) {
    subSel.innerHTML = `<option value="">Principal</option>` + subfolders
      .map(sf => {
        const name = sf.name || '';
        return `<option value="${escapeHtml(name)}" ${name === _activeDocsSubfolder ? 'selected' : ''}>${escapeHtml(name)}</option>`;
      })
      .join('');
  }

  // Carga una sola vez y cachea
  if (!_allDocs.length) {
    _allDocs = await API.get('/api/documents?projectId=' + id).catch(()=>[]);
  }

  const folderCounts = {};
  for (const f of visibleFolders) folderCounts[f.folder] = 0;
  (_allDocs || []).forEach(d => {
    const f = effectiveDocFolder(d);
    if (f in folderCounts) folderCounts[f] += 1;
  });

  const searchText = String(q || '').trim();
  const isGlobalDocsSearch = !!searchText && !!meta.canSearchAll;

  let filtered = isGlobalDocsSearch
    ? _allDocs.slice()
    : _allDocs
        .filter(d => effectiveDocFolder(d) === _activeDocsFolder)
        .filter(d => projectDocSubfolder(d) === _activeDocsSubfolder);

  if (searchText) filtered = filtered.filter(d => matchesDocQuery(d, searchText));

  const MB = 1024*1024;
  const activeCfg = projectDocFolderConfig(_activeDocsFolder);
  const folderMetaById = new Map(visibleFolders.map(f => [f.folder, f]));
  const subfolderCounts = { '': 0 };
  subfolders.forEach(sf => { subfolderCounts[sf.name || ''] = 0; });
  (_allDocs || [])
    .filter(d => effectiveDocFolder(d) === _activeDocsFolder)
    .forEach(d => {
      const key = projectDocSubfolder(d);
      subfolderCounts[key] = (subfolderCounts[key] || 0) + 1;
    });
  const assignedSet = new Set((activeFolderMeta.assignedUsers || []).map(String));
  const managerPanel = meta.canManage && _docsManagersOpen ? `
    <div class="docs-folder-users" id="docsManagersPanel">
      <b>Responsables</b>
      ${(meta.projectUsers || []).map(u => `
        <label>
          <input type="checkbox" class="docs-folder-user" value="${escapeHtml(String(u._id))}" ${assignedSet.has(String(u._id)) ? 'checked' : ''}>
          <span>${escapeHtml(u.name || u.email || 'Usuario')} <span class="small muted">${escapeHtml(u.role || '')}</span></span>
        </label>
      `).join('') || '<span class="small muted">No hay usuarios asignados al proyecto.</span>'}
      <button type="button" class="btn btn-ghost btn-xs" id="docsSaveFolderUsers">Guardar</button>
    </div>
  ` : '';

  const listHtml = filtered.length ? filtered.map(d => {
    const docFolder = effectiveDocFolder(d);
    const docFolderMeta = folderMetaById.get(docFolder) || activeFolderMeta;
    const docSubfolders = Array.isArray(docFolderMeta.subfolders) ? docFolderMeta.subfolders : [];
    const movePanel = meta.canMove && _movingDocId === String(d._id) ? `
      <div class="docs-move-panel">
        <select class="docs-move-folder" data-doc="${escapeHtml(String(d._id))}">
          ${visibleFolders.map(f => `<option value="${escapeHtml(f.folder)}" ${f.folder === docFolder ? 'selected' : ''}>${escapeHtml(projectDocFolderLabel(f.folder))}</option>`).join('')}
        </select>
        <select class="docs-move-subfolder" data-doc="${escapeHtml(String(d._id))}">
          <option value="">Principal</option>
          ${docSubfolders.map(sf => {
            const name = sf.name || '';
            return `<option value="${escapeHtml(name)}" ${name === projectDocSubfolder(d) ? 'selected' : ''}>${escapeHtml(name)}</option>`;
          }).join('')}
        </select>
        <button type="button" class="btn btn-xs primary docs-apply-move" data-doc="${escapeHtml(String(d._id))}">Mover aquí</button>
      </div>
    ` : '';
    const sizeStr = (d.size >= MB)
      ? (d.size/MB).toFixed(2)+' MB'
      : Math.round((d.size||0)/1024)+' KB';

    const exp = docExpiryMeta(d);

    const expLine = d.expiryDate
      ? `<div class="small ${exp.cls}">Expira: ${exp.label}</div>`
      : `<div class="small muted">Expira: —</div>`;

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

          <div class="chips">
            <span class="chip">Carpeta: ${escapeHtml(projectDocFolderLabel(effectiveDocFolder(d)))}</span>
            ${projectDocSubfolder(d) ? `<span class="chip">Subcarpeta: ${escapeHtml(projectDocSubfolder(d))}</span>` : ''}
            ${docChips(d)}
          </div>
        </div>

        <div class="doc-actions">
          <a class="btn js-secure-file" href="#" data-url="${secureDocUrl(d._id)}" data-filename="${escapeHtml(d.originalname || d.title || d.name || 'documento')}" data-action="view">Ver</a>
          <a class="btn js-secure-file" href="#" data-url="${secureDocUrl(d._id)}" data-filename="${escapeHtml(d.originalname || d.title || d.name || 'documento')}" data-action="download">Descargar</a>
          ${renderCompleteBtn(d)}
          ${renderReplaceBtn(d)}
          ${renderMoveBtn(d, meta.canMove)}
          ${renderDeleteBtn(d)}
        </div>
        ${movePanel}
      </div>
    `;
  }).join('') : '<div class="small muted">No hay documentos en esta carpeta.</div>';

  docsDiv.innerHTML = `
    <div class="docs-repo-layout">
      <div class="docs-folder-nav">
        ${visibleFolders.map(f => `
          <button type="button" class="docs-folder-btn ${f.folder === _activeDocsFolder ? 'active' : ''}" data-doc-folder="${escapeHtml(f.folder)}" style="--folder-color:${projectDocFolderConfig(f.folder).color};">
            <span class="docs-folder-icon">${escapeHtml(projectDocFolderConfig(f.folder).icon)}</span>
            <span class="docs-folder-name">${escapeHtml(projectDocFolderLabel(f.folder))}</span>
            <span class="docs-folder-count">${folderCounts[f.folder] || 0} documentos</span>
          </button>
        `).join('')}
      </div>

      <div class="docs-folder-panel" style="--folder-color:${activeCfg.color};">
        <div class="docs-folder-head">
          <div>
            <h3 style="margin:0;">${escapeHtml(projectDocFolderLabel(_activeDocsFolder))}</h3>
            <div class="small muted">${escapeHtml(isGlobalDocsSearch ? 'Resultados en todas las carpetas' : (_activeDocsSubfolder ? `Subcarpeta: ${_activeDocsSubfolder}` : 'Carpeta principal'))}</div>
          </div>
          <div class="docs-folder-tools">
            ${meta.canManage ? `<button type="button" class="docs-icon-btn" id="docsToggleManagers" title="Responsables" aria-label="Responsables">👤</button>` : ''}
            <button type="button" class="btn btn-ghost btn-xs" id="docsNewSubfolderBtn">Nueva subcarpeta</button>
          </div>
        </div>

        <div class="docs-subfolder-grid">
          <button type="button" class="docs-subfolder-card ${!_activeDocsSubfolder ? 'active' : ''}" data-doc-subfolder="" style="--folder-color:${activeCfg.color};">
            <strong>Principal</strong>
            <span class="small muted">${subfolderCounts[''] || 0} documentos</span>
          </button>
          ${subfolders.map(sf => {
            const name = sf.name || '';
            return `
              <div class="docs-subfolder-card ${name === _activeDocsSubfolder ? 'active' : ''}" data-doc-subfolder="${escapeHtml(name)}" style="--folder-color:${activeCfg.color};" role="button" tabindex="0">
                <div>
                  <strong>${escapeHtml(name)}</strong>
                  <span class="small muted">${subfolderCounts[name] || 0} documentos</span>
                </div>
                ${meta.canMove ? `<button type="button" class="docs-subfolder-delete" data-delete-subfolder="${escapeHtml(name)}" title="Eliminar subcarpeta" aria-label="Eliminar subcarpeta ${escapeHtml(name)}">Eliminar</button>` : ''}
              </div>
            `;
          }).join('')}
        </div>

        ${managerPanel}
        ${listHtml}
      </div>
    </div>
  `;

  if (countEl) countEl.textContent = `${filtered.length} / ${_allDocs.length}`;

  docsDiv.querySelectorAll('[data-doc-folder]').forEach(btn => {
    btn.addEventListener('click', async () => {
      _activeDocsFolder = btn.dataset.docFolder || '';
      _activeDocsSubfolder = '';
      await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
    });
  });

  docsDiv.querySelectorAll('[data-doc-subfolder]').forEach(btn => {
    btn.addEventListener('click', async () => {
      _activeDocsSubfolder = btn.dataset.docSubfolder || '';
      await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
    });
    btn.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      _activeDocsSubfolder = btn.dataset.docSubfolder || '';
      await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
    });
  });

  docsDiv.querySelectorAll('[data-delete-subfolder]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const name = btn.dataset.deleteSubfolder || '';
      if (!name) return;
      const count = subfolderCounts[name] || 0;
      const msg = count
        ? `Eliminar la subcarpeta "${name}"? Sus ${count} documento(s) pasarán a Principal.`
        : `Eliminar la subcarpeta "${name}"?`;
      if (!confirm(msg)) return;

      try {
        const res = await fetch(`/api/documents/folder-permissions/${encodeURIComponent(_activeDocsFolder)}/subfolders`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', ...tenantHeaders(), ...authHeaders() },
          credentials: 'include',
          body: JSON.stringify({ projectId: id, name })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.message || payload?.error || `HTTP ${res.status}`);

        if (_activeDocsSubfolder === name) _activeDocsSubfolder = '';
        _docsFolderMeta = null;
        _allDocs = [];
        await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
      } catch (err) {
        alert('No se pudo eliminar la subcarpeta: ' + (err.message || 'Error desconocido'));
      }
    });
  });

  document.getElementById('docsNewSubfolderBtn')?.addEventListener('click', async () => {
    const name = prompt('Nombre de la subcarpeta:');
    if (!name || !name.trim()) return;
    try {
      await API.post(`/api/documents/folder-permissions/${encodeURIComponent(_activeDocsFolder)}/subfolders`, {
        projectId: id,
        name: name.trim()
      });
      _activeDocsSubfolder = name.trim();
      _docsFolderMeta = null;
      await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
    } catch (e) {
      alert('No se pudo crear la subcarpeta.');
    }
  });

  document.getElementById('docsSaveFolderUsers')?.addEventListener('click', async () => {
    const assignedUsers = Array.from(docsDiv.querySelectorAll('.docs-folder-user:checked')).map(input => input.value);
    try {
      await API.patch(`/api/documents/folder-permissions/${encodeURIComponent(_activeDocsFolder)}`, {
        projectId: id,
        assignedUsers
      });
      _docsFolderMeta = null;
      _allDocs = [];
      _commercialDossierDocs = [];
      await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
      await refreshCommercialDossier(true);
    } catch (e) {
      alert('No se pudieron guardar los responsables.');
    }
  });

  document.getElementById('docsToggleManagers')?.addEventListener('click', async () => {
    _docsManagersOpen = !_docsManagersOpen;
    await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
  });

  docsDiv.querySelectorAll('[data-move-doc]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const docId = btn.dataset.moveDoc || '';
      _movingDocId = _movingDocId === docId ? '' : docId;
      await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
    });
  });

  docsDiv.querySelectorAll('.docs-move-folder').forEach(sel => {
    sel.addEventListener('change', () => {
      const docId = sel.dataset.doc || '';
      const subSel = docsDiv.querySelector(`.docs-move-subfolder[data-doc="${CSS.escape(docId)}"]`);
      const folderMeta = folderMetaById.get(sel.value);
      const nextSubfolders = Array.isArray(folderMeta?.subfolders) ? folderMeta.subfolders : [];
      if (subSel) {
        subSel.innerHTML = '<option value="">Principal</option>' + nextSubfolders
          .map(sf => `<option value="${escapeHtml(sf.name || '')}">${escapeHtml(sf.name || '')}</option>`)
          .join('');
      }
    });
  });

  docsDiv.querySelectorAll('.docs-apply-move').forEach(btn => {
    btn.addEventListener('click', async () => {
      const docId = btn.dataset.doc || '';
      const folder = docsDiv.querySelector(`.docs-move-folder[data-doc="${CSS.escape(docId)}"]`)?.value || _activeDocsFolder;
      const subfolder = docsDiv.querySelector(`.docs-move-subfolder[data-doc="${CSS.escape(docId)}"]`)?.value || '';

      try {
        const res = await fetch(`/api/documents/${encodeURIComponent(docId)}/location`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...tenantHeaders(), ...authHeaders() },
          credentials: 'include',
          body: JSON.stringify({ projectId: id, folder, subfolder })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.message || payload?.error || `HTTP ${res.status}`);

        _movingDocId = '';
        _activeDocsFolder = folder;
        _activeDocsSubfolder = subfolder;
        _allDocs = [];
        await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
      } catch (e) {
        alert('No se pudo mover el documento: ' + (e.message || 'Error desconocido'));
      }
    });
  });
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

// ===== Upload normal general =====
function wireDocsUpload() {
  const form = document.getElementById('uploadForm');
  const btn  = document.getElementById('docsUploadBtn');
  const fileEl = document.getElementById('file');
  const expEl  = document.getElementById('expiry');
  const folderEl = document.getElementById('docsFolder');
  const subfolderEl = document.getElementById('docsSubfolder');
  const fileNameEl = document.getElementById('docsFileName');

  if (!form || !btn || !fileEl) return;

  fileEl.addEventListener('change', () => {
    const f = fileEl.files && fileEl.files[0];
    if (fileNameEl) fileNameEl.textContent = f ? f.name : 'Ningún archivo seleccionado';
  });

  folderEl?.addEventListener('change', async () => {
    _activeDocsFolder = folderEl.value || _activeDocsFolder;
    _activeDocsSubfolder = '';
    await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
  });

  subfolderEl?.addEventListener('change', async () => {
    _activeDocsSubfolder = subfolderEl.value || '';
    await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!canViewGeneralDocs()) {
      alert('No tienes permisos para subir documentos generales.');
      return;
    }

    const f = fileEl.files && fileEl.files[0];
    if (!f) return alert('Selecciona un archivo primero');

    const fd = new FormData();
    fd.append('projectId', id);
    fd.append('file', f);
    fd.append('folder', folderEl?.value || _activeDocsFolder || 'gerencia');
    fd.append('subfolder', subfolderEl?.value || _activeDocsSubfolder || '');

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
      if (fileNameEl) fileNameEl.textContent = 'Ningún archivo seleccionado';
      if (expEl) expEl.value = '';

      _allDocs = [];
      _commercialDossierDocs = [];
      await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
      await refreshCommercialDossier(true);

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
  if (!canViewGeneralDocs()) return;

  // ---- eliminar ----
  const delBtn = ev.target.closest('button[data-del]');

  if (delBtn) {
    const docId = delBtn.getAttribute('data-del');
    if (!docId) return;
    const fromCommercialDossierModal = !!delBtn.closest('.commercial-dossier-row');

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

      _allDocs = [];
      _commercialDossierDocs = [];
      await loadDocs({ q: (document.getElementById('docsSearch')?.value || '') });
      await refreshCommercialDossier(true);
      if (fromCommercialDossierModal) await openCommercialDossierModal();

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
    if (note === null) return;

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

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '*/*';

    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;

      const expiry = prompt('Fecha de vencimiento del NUEVO documento (YYYY-MM-DD) o vacío:', '') || '';

      const fd = new FormData();
      fd.append('projectId', id);
      fd.append('file', f);

      if (expiry.trim()) fd.append('expiryDate', expiry.trim());

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
// tu loadProject o init debe llamar a loadDocs

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
  await refreshCommercialDossier(true);
  await loadChatMessages();
  
} else if (myRole === 'commercial') {
  // Comercial: unidades + (ahora) checklists propios + docs
  await loadUnits();          // ✅
  await loadProyectoData();   // ✅ /api/projects/:id/checklists (ya permitido por el cambio de arriba)
  renderProyecto();           // pinta la pestaña Proyecto con solo COMERCIAL
  await loadDocs();           // ✅
  await refreshCommercialDossier(true);
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
  await refreshCommercialDossier(true);
  await loadChatMessages();
}

  // logout
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', () => { API.logout(); location.href = '/'; });
})();
