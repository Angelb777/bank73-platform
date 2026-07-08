const API = (() => {
  const tokenKey = 'tkn';
  const roleKey = 'role';
  const tokenAliases = ['tkn', 'token', 'authToken', 'jwt', 'accessToken'];
  const LOGIN_PATH = '/login';
  const publicPaths = new Set(['/', '/login', '/register', '/pending.html']);
  const TENANT =
  new URLSearchParams(location.search).get('tenant') ||
  localStorage.getItem('tenantKey') ||
  'bancodemo';

  let redirectingToLogin = false;

  function normalizePath(value) {
    try {
      const url = new URL(value, location.origin);
      return url.pathname;
    } catch (_) {
      return String(value || '');
    }
  }

  function isPublicPage() {
    return publicPaths.has(location.pathname);
  }

  function isAuthEndpoint(path) {
    const p = normalizePath(path);
    return p.startsWith('/api/auth/login') || p.startsWith('/api/auth/register');
  }

  function isSessionError(status, payload) {
    if (status === 401) return true;
    if (status !== 403) return false;

    const msg = String(
      payload?.error ||
      payload?.message ||
      payload ||
      ''
    ).toLowerCase();

    return (
      msg.includes('token') ||
      msg.includes('autentic') ||
      msg.includes('unauthorized') ||
      msg.includes('no autenticado') ||
      msg.includes('usuario no encontrado') ||
      msg.includes('cuenta pendiente')
    );
  }

  function clearAuth() {
    tokenAliases.forEach(k => localStorage.removeItem(k));
    localStorage.removeItem(roleKey);
    localStorage.removeItem('status');
    localStorage.removeItem('userId');
    localStorage.removeItem('tenantKeys');
    delete window.currentUser;
  }

  function redirectToLogin() {
    if (redirectingToLogin) return;
    redirectingToLogin = true;
    clearAuth();
    if (!isPublicPage()) location.replace(LOGIN_PATH);
  }

  function setAuth(token, role, status, extra = {}) {
    localStorage.setItem(tokenKey, token);
    localStorage.setItem('token', token);
    localStorage.setItem(roleKey, role);
    if (status) localStorage.setItem('status', String(status).toLowerCase());
    if (extra.userId) localStorage.setItem('userId', extra.userId);
    if (Array.isArray(extra.tenantKeys)) localStorage.setItem('tenantKeys', JSON.stringify(extra.tenantKeys));
  }
  function getToken() {
    for (const key of tokenAliases) {
      const value = localStorage.getItem(key);
      if (value) return value;
    }
    return null;
  }
  function getRole()  { return localStorage.getItem(roleKey); }
  function getAuth() {
    let tenantKeys = [];
    try { tenantKeys = JSON.parse(localStorage.getItem('tenantKeys') || '[]'); } catch (_) {}
    return {
      token: getToken(),
      role: getRole(),
      status: localStorage.getItem('status'),
      tenant: localStorage.getItem('tenantKey') || TENANT,
      tenantKey: localStorage.getItem('tenantKey') || TENANT,
      tenantKeys,
      userId: localStorage.getItem('userId')
    };
  }
  function setTenant(t) { localStorage.setItem('tenantKey', t); }

  async function readErrorPayload(res) {
    const clone = res.clone();
    try { return await clone.json(); } catch (_) {}
    try { return await res.clone().text(); } catch (_) {}
    return null;
  }

  async function handleAuthResponse(res, path) {
    if (!res || res.ok || isAuthEndpoint(path)) return false;
    const payload = await readErrorPayload(res);
    if (!isSessionError(res.status, payload)) return false;
    redirectToLogin();
    return true;
  }

  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  if (nativeFetch && !window.__API_AUTH_FETCH_PATCHED__) {
    window.__API_AUTH_FETCH_PATCHED__ = true;
    window.fetch = async function apiAuthFetch(input, init = {}) {
      const res = await nativeFetch(input, init);
      const path = typeof input === 'string' ? input : input?.url;
      const headers = new Headers(init?.headers || input?.headers || {});
      const hasAuth = headers.has('Authorization') || headers.has('authorization') || !!getToken();
      if (!isPublicPage() && hasAuth && await handleAuthResponse(res, path)) {
        return new Promise(() => {});
      }
      return res;
    };
  }

  /**
   * request(path, { method, headers, body, isForm, silent })
   * - silent=true: no lanza alert ni throw, devuelve { ok:false, error }
   */
  async function request(path, { method='GET', headers={}, body=null, isForm=false, silent=false } = {}) {
    const h = { 'x-tenant': TENANT, ...headers };        
    const token = getToken();
    if (token) h['Authorization'] = 'Bearer ' + token;
    if (!isForm) h['Content-Type'] = 'application/json';

    const res  = await fetch(path, { method, headers: h, body });
    if (await handleAuthResponse(res, path)) {
      return new Promise(() => {});
    }
    const text = await res.text();
    let json   = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* respuesta no-JSON */ }

    if (!res.ok) {
      const msg = (json && (json.error || json.message)) || `${res.status} ${res.statusText}`;
      if (silent) {
        console.warn('[API error silent]', path, msg);
        return { ok:false, error: msg, status: res.status };
      }
      // No mostramos alert aquí: dejamos que el caller decida UI.
      throw new Error(msg);
    }
    return json ?? { ok:true };
  }

  // helpers normales (lanzan error si falla)
  const get  = (p, opts)         => request(p, { ...opts });
  const post = (p, data, opts)   => request(p, { method:'POST', body: JSON.stringify(data ?? {}), ...opts });
  const put  = (p, data, opts)   => request(p, { method:'PUT',  body: JSON.stringify(data ?? {}), ...opts });
  const patch = (p, data, opts)  => request(p, { method:'PATCH', body: JSON.stringify(data ?? {}), ...opts });
  const del  = (p, opts)         => request(p, { method:'DELETE', ...opts });
  const upload = (p, formData, opts) => request(p, { method:'POST', body: formData, isForm:true, ...opts });

  // helpers "silenciosos" (no tiran alert/throw; devuelven {ok:false,error})
  const getSilent  = (p, opts)         => request(p, { ...opts, silent:true });
  const postSilent = (p, data, opts)   => request(p, { method:'POST', body: JSON.stringify(data ?? {}), silent:true, ...opts });
  const putSilent  = (p, data, opts)   => request(p, { method:'PUT',  body: JSON.stringify(data ?? {}), silent:true, ...opts });
  const patchSilent = (p, data, opts)  => request(p, { method:'PATCH', body: JSON.stringify(data ?? {}), silent:true, ...opts });
  const delSilent  = (p, opts)         => request(p, { method:'DELETE', silent:true, ...opts });

  return {
    setAuth, getAuth, getToken, getRole, clearAuth,
    get, post, put, patch, del, upload, setTenant,
    getSilent, postSilent, putSilent, patchSilent, delSilent,
    logout: () => clearAuth()
  };
})();
