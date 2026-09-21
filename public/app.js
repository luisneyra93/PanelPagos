/* Dashboard SPEI — sin dependencias, consume /api/spei, /api/projects y /api/auth */
const API = '/api/spei';
const PROJECTS_API = '/api/projects';
const AUTH_API = '/api/auth';
const AUTH_KEY = 'pagos_auth_session';

const state = {
  status: 'all',
  search: '',
  from: '',
  to: '',
  page: 1,
  limit: 25,
};

let autoTimer = null;
let editingProjectId = null;
let dashboardReady = false;

// ───────────────────────── Utilidades ─────────────────────────

const $ = (id) => document.getElementById(id);

const money = (n) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);

const fecha = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return '—';
  return d.toLocaleString('es-MX', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LABELS = { pending: 'Pendiente', accredited: 'Acreditado', failed: 'Vencido' };

function toast(msg, kind = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3500);
}

async function api(path, options) {
  const res = await fetch(path, options);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join(', ') : (data?.message ?? `Error ${res.status}`);
    throw new Error(msg);
  }
  return data;
}

// ───────────────────────── Auth ─────────────────────────

function getSession() {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(payload, userName) {
  const token =
    payload?.token ||
    payload?.accessToken ||
    payload?.access_token ||
    payload?.data?.token ||
    payload?.data?.accessToken ||
    null;

  const session = {
    userName,
    token,
    raw: payload,
    at: Date.now(),
  };
  sessionStorage.setItem(AUTH_KEY, JSON.stringify(session));
  return session;
}

function clearSession() {
  sessionStorage.removeItem(AUTH_KEY);
}

function showLogin() {
  $('loginScreen').hidden = false;
  $('appShell').hidden = true;
  document.body.classList.add('is-login');
}

function showDashboard(session) {
  $('loginScreen').hidden = true;
  $('appShell').hidden = false;
  document.body.classList.remove('is-login');

  const userEl = $('sessionUser');
  if (session?.userName) {
    userEl.textContent = session.userName;
    userEl.hidden = false;
    userEl.title = session.userName;
  } else {
    userEl.hidden = true;
  }

  if (!dashboardReady) {
    initDashboard();
    dashboardReady = true;
  } else {
    reload();
  }
}

async function handleLogin(ev) {
  ev.preventDefault();
  const err = $('loginError');
  const btn = $('btnLogin');
  err.hidden = true;

  const userName = $('loginUser').value.trim();
  const password = $('loginPass').value;

  if (!userName || !password) {
    err.textContent = 'Usuario y contraseña son obligatorios.';
    err.hidden = false;
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Ingresando…';

  try {
    const data = await api(`${AUTH_API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName, password }),
    });

    // Algunos backends responden 200 con success:false
    if (data && data.success === false) {
      throw new Error(data.message || data.error || 'Credenciales inválidas');
    }

    const session = saveSession(data, userName);
    toast('Sesión iniciada', 'ok');
    showDashboard(session);
  } catch (e) {
    err.textContent = e.message || 'No se pudo iniciar sesión';
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Iniciar Sesión';
  }
}

function handleLogout() {
  clearInterval(autoTimer);
  clearSession();
  showLogin();
  $('formLogin')?.reset();
  $('loginError').hidden = true;
  toast('Sesión cerrada');
}

function initAuthUi() {
  $('formLogin').addEventListener('submit', handleLogin);
  $('btnLogout').addEventListener('click', handleLogout);

  $('btnTogglePass').addEventListener('click', () => {
    const input = $('loginPass');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('eyeOpen').hidden = show;
    $('eyeClosed').hidden = !show;
    $('btnTogglePass').setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
  });
}

function queryString() {
  const p = new URLSearchParams();
  if (state.status !== 'all') p.set('status', state.status);
  if (state.search) p.set('search', state.search);
  if (state.from) p.set('from', state.from);
  if (state.to) p.set('to', state.to);
  p.set('page', state.page);
  p.set('limit', state.limit);
  return p.toString();
}

function copy(text) {
  navigator.clipboard.writeText(text).then(
    () => toast('Copiado al portapapeles', 'ok'),
    () => toast('No se pudo copiar', 'err'),
  );
}

// ───────────────────────── Carga de datos ─────────────────────────

async function loadStats() {
  try {
    const s = await api(`${API}/stats?${queryString()}`);
    $('cTotal').textContent = s.total.count;
    $('cTotalAmt').textContent = money(s.total.amount);
    $('cPending').textContent = s.pending.count;
    $('cPendingAmt').textContent = money(s.pending.amount);
    $('cOk').textContent = s.accredited.count;
    $('cOkAmt').textContent = money(s.accredited.amount);
    $('cBad').textContent = s.failed.count;
    $('cBadAmt').textContent = money(s.failed.amount);
    $('cRate').textContent = `${s.tasa_conversion}%`;
  } catch (e) {
    toast(`Stats: ${e.message}`, 'err');
  }
}

async function loadGrid() {
  const tbody = $('tbody');
  try {
    const r = await api(`${API}?${queryString()}`);

    if (!r.data.length) {
      tbody.innerHTML = '<tr><td colspan="11" class="empty">Sin resultados con estos filtros.</td></tr>';
    } else {
      tbody.innerHTML = r.data.map(rowHtml).join('');
    }

    $('pageInfo').textContent = `Página ${r.page} de ${r.pages} · ${r.total} registro(s)`;
    $('btnPrev').disabled = r.page <= 1;
    $('btnNext').disabled = r.page >= r.pages;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="11" class="empty">Error: ${esc(e.message)}</td></tr>`;
  }
}

function rowHtml(p) {
  const clabe = p.clabe
    ? `<span class="mono">${esc(p.clabe)}</span>
       <button class="copy" data-copy="${esc(p.clabe)}" title="Copiar CLABE">⧉</button>`
    : '<span class="muted">—</span>';

  return `
    <tr data-id="${esc(p.payment_id)}">
      <td><span class="badge ${p.grupo}">${LABELS[p.grupo]}</span></td>
      <td title="${esc(p.business_name ?? '')}">${esc(p.business_name ?? '—')}</td>
      <td class="mono" title="${esc(p.order_id)}">${esc(String(p.order_id).slice(0, 16))}…</td>
      <td>${clabe}</td>
      <td class="mono">${esc(p.referencia ?? '—')}</td>
      <td class="right amount">${money(p.amount)}</td>
      <td>${esc(p.payer_email ?? '—')}</td>
      <td class="mono">${esc(p.external_reference ?? '—')}</td>
      <td>${fecha(p.fh_registro)}</td>
      <td>${fecha(p.fh_expiracion)}</td>
      <td>
        <button class="btn mini ghost" data-detail="${esc(p.payment_id)}">Ver</button>
        <button class="btn mini ghost" data-refresh="${esc(p.payment_id)}">↻</button>
      </td>
    </tr>`;
}

async function reload() {
  await Promise.all([loadStats(), loadGrid()]);
}

// ───────────────────────── Proyectos (Projects) ─────────────────────────

async function loadActiveProjects(selected = '') {
  const sel = $('nBusiness');
  try {
    const rows = await api(`${PROJECTS_API}/active`);
    if (!rows.length) {
      sel.innerHTML = '<option value="">Sin proyectos activos — créalos en Proyectos</option>';
      return;
    }
    sel.innerHTML =
      '<option value="">Selecciona un proyecto…</option>' +
      rows.map((p) =>
        `<option value="${esc(p.name)}" ${p.name === selected ? 'selected' : ''}>${esc(p.name)}</option>`,
      ).join('');
  } catch (e) {
    sel.innerHTML = `<option value="">Error: ${esc(e.message)}</option>`;
  }
}

async function loadProjectsGrid() {
  const tbody = $('projectsBody');
  try {
    const rows = await api(PROJECTS_API);
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">No hay proyectos. Agrega el primero arriba.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((p) => {
      const active = Number(p.estatus) === 1;
      const keyShort = p.key ? `${String(p.key).slice(0, 12)}…` : '—';
      return `
        <tr>
          <td class="mono">${p.id}</td>
          <td>${esc(p.name)}</td>
          <td><span class="badge ${active ? 'active' : 'inactive'}">${active ? 'Activo' : 'Inactivo'}</span></td>
          <td class="mono" title="${esc(p.key ?? '')}">
            ${esc(keyShort)}
            ${p.key ? `<button class="copy" data-copy="${esc(p.key)}" title="Copiar ApiKey">⧉</button>` : ''}
          </td>
          <td>${fecha(p.fh_registro)}</td>
          <td>
            <button class="btn mini ghost" data-project-edit="${p.id}" data-name="${esc(p.name)}">Editar</button>
            <button class="btn mini ghost" data-project-regen="${p.id}" title="Regenerar ApiKey">Key</button>
            <button class="btn mini ghost" data-project-toggle="${p.id}" data-estatus="${active ? 0 : 1}">
              ${active ? 'Desactivar' : 'Activar'}
            </button>
            <button class="btn mini danger" data-project-del="${p.id}" data-name="${esc(p.name)}">Eliminar</button>
          </td>
        </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">Error: ${esc(e.message)}</td></tr>`;
  }
}

function resetProjectForm() {
  editingProjectId = null;
  $('pId').value = '';
  $('pName').value = '';
  $('btnSaveProject').textContent = 'Agregar';
  $('btnCancelProject').hidden = true;
  $('pError').hidden = true;
}

async function openProjectsModal() {
  resetProjectForm();
  await loadProjectsGrid();
  $('dlgProjects').showModal();
}

async function submitProject(ev) {
  ev.preventDefault();
  const err = $('pError');
  err.hidden = true;
  const btn = $('btnSaveProject');
  btn.disabled = true;

  const body = {
    name: $('pName').value.trim(),
  };

  try {
    if (editingProjectId) {
      await api(`${PROJECTS_API}/${editingProjectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      toast('Proyecto actualizado', 'ok');
    } else {
      await api(PROJECTS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      toast('Proyecto creado', 'ok');
    }
    resetProjectForm();
    await Promise.all([loadProjectsGrid(), loadActiveProjects()]);
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

function startEditProject(id, name) {
  editingProjectId = Number(id);
  $('pId').value = id;
  $('pName').value = name;
  $('btnSaveProject').textContent = 'Guardar';
  $('btnCancelProject').hidden = false;
  $('pName').focus();
}

async function toggleProject(id, estatus) {
  try {
    await api(`${PROJECTS_API}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estatus: Number(estatus) }),
    });
    toast(Number(estatus) === 1 ? 'Proyecto activado' : 'Proyecto desactivado', 'ok');
    await Promise.all([loadProjectsGrid(), loadActiveProjects()]);
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function regenerateProjectKey(id) {
  if (!confirm('¿Regenerar la ApiKey? Los sistemas que usen la anterior dejarán de funcionar.')) return;
  try {
    const p = await api(`${PROJECTS_API}/${id}/regenerate-key`, { method: 'PUT' });
    toast('ApiKey regenerada', 'ok');
    if (p.key) copy(p.key);
    await loadProjectsGrid();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function deleteProject(id, name) {
  if (!confirm(`¿Eliminar el proyecto "${name}"?`)) return;
  try {
    await api(`${PROJECTS_API}/${id}`, { method: 'DELETE' });
    toast('Proyecto eliminado', 'ok');
    if (editingProjectId === Number(id)) resetProjectForm();
    await Promise.all([loadProjectsGrid(), loadActiveProjects()]);
  } catch (e) {
    toast(e.message, 'err');
  }
}

// ───────────────────────── Detalle ─────────────────────────

async function showDetail(id) {
  try {
    const p = await api(`${API}/${encodeURIComponent(id)}`);
    $('detailBody').innerHTML = `
      <h2>SPEI <span class="badge ${p.grupo}">${LABELS[p.grupo]}</span></h2>
      ${p.clabe ? `
        <div class="clabe-box">
          <div class="muted">CLABE de depósito · ${esc(p.banco ?? 'STP')}</div>
          <div class="big">${esc(p.clabe)}</div>
          <button class="btn mini ghost" data-copy="${esc(p.clabe)}">Copiar CLABE</button>
        </div>` : ''}
      <dl class="detail-grid">
        <dt>Proyecto</dt><dd>${esc(p.business_name ?? '—')}</dd>
        <dt>Id Project</dt><dd class="mono">${esc(p.id_project ?? '—')}</dd>
        <dt>Order ID</dt><dd class="mono">${esc(p.order_id)}</dd>
        <dt>Payment ID</dt><dd class="mono">${esc(p.payment_id)}</dd>
        <dt>Estado MP</dt><dd>${esc(p.status)} <span class="muted">${esc(p.status_detail ?? '')}</span></dd>
        <dt>Monto</dt><dd class="amount">${money(p.amount)} ${esc(p.currency)}</dd>
        <dt>Referencia</dt><dd class="mono">${esc(p.referencia ?? '—')}</dd>
        <dt>Pagador</dt><dd>${esc(p.payer_email ?? '—')}</dd>
        <dt>Descripción</dt><dd>${esc(p.description ?? '—')}</dd>
        <dt>Ref. externa</dt><dd class="mono">${esc(p.external_reference ?? '—')}</dd>
        <dt>Creado</dt><dd>${fecha(p.fh_registro)}</dd>
        <dt>Expira</dt><dd>${fecha(p.fh_expiracion)}</dd>
        <dt>Acreditado</dt><dd>${fecha(p.fh_acreditacion)}</dd>
        ${p.ticket_url ? `<dt>Comprobante</dt><dd><a href="${esc(p.ticket_url)}" target="_blank" rel="noopener">Abrir en MP ↗</a></dd>` : ''}
      </dl>`;
    $('dlgDetail').showModal();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function refreshOne(id) {
  toast('Consultando Mercado Pago…');
  try {
    const r = await api(`${API}/${encodeURIComponent(id)}/refresh`, { method: 'PUT' });
    toast(`Actualizado: ${r.status}${r.status_detail ? ` (${r.status_detail})` : ''}`, 'ok');
    await reload();
  } catch (e) {
    toast(e.message, 'err');
  }
}

// ───────────────────────── Generar SPEI ─────────────────────────

async function openNewSpei() {
  await loadActiveProjects();
  $('nError').hidden = true;
  $('dlgNew').showModal();
}

async function submitNew(ev) {
  ev.preventDefault();
  const btn = $('btnSubmitNew');
  const err = $('nError');
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Generando…';

  const body = {
    business_name: $('nBusiness').value.trim(),
    transaction_amount: Number($('nAmount').value),
    payer: { email: $('nEmail').value.trim() },
  };
  if (!body.business_name) {
    err.textContent = 'El proyecto es obligatorio.';
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Generar';
    return;
  }
  if ($('nDesc').value.trim()) body.description = $('nDesc').value.trim();
  if ($('nRef').value.trim()) body.external_reference = $('nRef').value.trim();

  try {
    const r = await api(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    $('dlgNew').close();
    $('formNew').reset();
    await reload();
    toast(r.reused_pending ? 'Se reutilizó una CLABE pendiente' : 'SPEI generado', 'ok');
    showDetail(r.payment_id);
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generar';
  }
}

// ───────────────────────── Eventos ─────────────────────────

function setStatus(status) {
  state.status = status;
  state.page = 1;
  document.querySelectorAll('.card[data-status]').forEach((c) =>
    c.classList.toggle('selected', c.dataset.status === status));
  const chip = $('activeChip');
  if (status === 'all') {
    chip.hidden = true;
  } else {
    chip.textContent = `Filtro: ${LABELS[status]}`;
    chip.hidden = false;
  }
  reload();
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function setAutoRefresh(on) {
  clearInterval(autoTimer);
  $('autoDot').classList.toggle('off', !on);
  if (on) autoTimer = setInterval(reload, 30000);
}

document.addEventListener('DOMContentLoaded', () => {
  initAuthUi();

  const session = getSession();
  if (session) {
    showDashboard(session);
  } else {
    showLogin();
  }
});

function initDashboard() {
  document.querySelectorAll('.card[data-status]').forEach((c) =>
    c.addEventListener('click', () => setStatus(c.dataset.status)));

  $('fSearch').addEventListener('input', debounce((e) => {
    state.search = e.target.value.trim();
    state.page = 1;
    reload();
  }, 350));

  $('fFrom').addEventListener('change', (e) => { state.from = e.target.value; state.page = 1; reload(); });
  $('fTo').addEventListener('change', (e) => { state.to = e.target.value; state.page = 1; reload(); });
  $('fLimit').addEventListener('change', (e) => { state.limit = Number(e.target.value); state.page = 1; reload(); });

  $('btnClear').addEventListener('click', () => {
    Object.assign(state, { status: 'all', search: '', from: '', to: '', page: 1 });
    $('fSearch').value = ''; $('fFrom').value = ''; $('fTo').value = '';
    setStatus('all');
  });

  $('btnReload').addEventListener('click', reload);
  $('btnPrev').addEventListener('click', () => { if (state.page > 1) { state.page--; loadGrid(); } });
  $('btnNext').addEventListener('click', () => { state.page++; loadGrid(); });

  $('btnNew').addEventListener('click', openNewSpei);
  $('btnCancelNew').addEventListener('click', () => $('dlgNew').close());
  $('formNew').addEventListener('submit', submitNew);
  $('btnCloseDetail').addEventListener('click', () => $('dlgDetail').close());

  $('btnProjects').addEventListener('click', openProjectsModal);
  $('btnCloseProjects').addEventListener('click', () => $('dlgProjects').close());
  $('formProject').addEventListener('submit', submitProject);
  $('btnCancelProject').addEventListener('click', resetProjectForm);

  $('autoRefresh').addEventListener('change', (e) => setAutoRefresh(e.target.checked));

  document.addEventListener('click', (e) => {
    const detail = e.target.closest('[data-detail]');
    if (detail) return showDetail(detail.dataset.detail);

    const refresh = e.target.closest('[data-refresh]');
    if (refresh) return refreshOne(refresh.dataset.refresh);

    const cp = e.target.closest('[data-copy]');
    if (cp) return copy(cp.dataset.copy);

    const pedit = e.target.closest('[data-project-edit]');
    if (pedit) {
      return startEditProject(pedit.dataset.projectEdit, pedit.dataset.name);
    }

    const ptoggle = e.target.closest('[data-project-toggle]');
    if (ptoggle) return toggleProject(ptoggle.dataset.projectToggle, ptoggle.dataset.estatus);

    const pregen = e.target.closest('[data-project-regen]');
    if (pregen) return regenerateProjectKey(pregen.dataset.projectRegen);

    const pdel = e.target.closest('[data-project-del]');
    if (pdel) return deleteProject(pdel.dataset.projectDel, pdel.dataset.name);
  });

  loadActiveProjects();
  setStatus('all');
  setAutoRefresh(true);
}
