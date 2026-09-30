// The workspace this page is open in, the way the console decides it.
//
// A kit is launched per workspace and the gateway scopes every call by two headers the console
// adds from its own record of the active workspace (localStorage, one key per org). This app is
// served on the console's origin, so it reads the same record and adds the same headers to its
// own calls; without them the gateway answers unscoped, and on an instance where the kit has been
// launched in two workspaces the app picked the wrong recruiter (2026-09-30). The shared
// transport (reifyui/harness) takes no headers yet, so they are added where every call goes
// through: fetch, for this origin's API path only.
const PREFIX = 'hr.workspace.current.';
const API = '/api/harness/';

export function currentWorkspace() {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX));
    // One org per browser on a self-hosted instance; on a hosted one the console keeps a key per
    // org it has shown, and the newest write wins there too (a single key in practice).
    for (const k of keys.reverse()) {
      const raw = JSON.parse(localStorage.getItem(k) || 'null');
      if (raw && raw.id) return { id: String(raw.id), isDefault: !!raw.def };
    }
  } catch { /* private mode or malformed */ }
  return null;
}

export function workspaceHeaders() {
  const ws = currentWorkspace();
  if (!ws) return {};
  return { 'x-harness-workspace': ws.id, ...(ws.isDefault ? { 'x-harness-workspace-default': '1' } : {}) };
}

/** Add the workspace headers to every call this page makes to the console's API. */
export function installWorkspaceScope() {
  if (typeof window === 'undefined' || window.__wpScoped) return;
  window.__wpScoped = true;
  const raw = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.startsWith(API) && !url.startsWith(`${window.location.origin}${API}`)) return raw(input, init);
    const extra = workspaceHeaders();
    if (!Object.keys(extra).length) return raw(input, init);
    const headers = new Headers(init?.headers || (typeof input !== 'string' ? input.headers : undefined) || {});
    for (const [k, v] of Object.entries(extra)) if (!headers.has(k)) headers.set(k, v);
    return raw(input, { ...(init || {}), headers });
  };
}
