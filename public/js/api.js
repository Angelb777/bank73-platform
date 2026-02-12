const API = (() => {
  const tokenKey = 'tkn';
  const roleKey = 'role';
  const TENANT =
  new URLSearchParams(location.search).get('tenant') ||
  localStorage.getItem('tenantKey') ||
  'bancodemo';


  function setAuth(token, role) {
    localStorage.setItem(tokenKey, token);
    localStorage.setItem(roleKey, role);
  }
  function getToken() { return localStorage.getItem(tokenKey); }
  function getRole()  { return localStorage.getItem(roleKey); }
  function clearAuth() {
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(roleKey);
  }
  function setTenant(t) { localStorage.setItem('tenantKey', t); }


  /**
   * request(path, { method, headers, body, isForm, silent })
   * - silent=true: no lanza alert ni throw, devuelve { ok:false, error }
   */
  async function request(path, { method='GET', headers={}, body=null, isForm=false, silent=false } = {}) {
    const h = { 'X-Tenant': TENANT, ...headers };
    const token = getToken();
    if (token) h['Authorization'] = 'Bearer ' + token;
    if (!isForm) h['Content-Type'] = 'application/json';

    const res  = await fetch(path, { method, headers: h, body });
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
  const del  = (p, opts)         => request(p, { method:'DELETE', ...opts });
  const upload = (p, formData, opts) => request(p, { method:'POST', body: formData, isForm:true, ...opts });

  // helpers "silenciosos" (no tiran alert/throw; devuelven {ok:false,error})
  const getSilent  = (p, opts)         => request(p, { ...opts, silent:true });
  const postSilent = (p, data, opts)   => request(p, { method:'POST', body: JSON.stringify(data ?? {}), silent:true, ...opts });
  const putSilent  = (p, data, opts)   => request(p, { method:'PUT',  body: JSON.stringify(data ?? {}), silent:true, ...opts });
  const delSilent  = (p, opts)         => request(p, { method:'DELETE', silent:true, ...opts });

  return {
    setAuth, getToken, getRole, clearAuth,
    get, post, put, del, upload, setTenant,
    getSilent, postSilent, putSilent, delSilent,
    logout: () => clearAuth()
  };
})();
