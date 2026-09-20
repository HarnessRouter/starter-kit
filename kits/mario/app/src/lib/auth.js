// Identity, borrowed rather than built: the console authenticated whoever is looking at this app
// before it was served, and the browser carries that session on every same-origin request.
export const SESSION_EVENT = 'mario:session';

let _session = null;
let _asked = false;

/** Who the console says is signed in. Null until the first load resolves. */
export function getSession() {
  if (!_asked) {
    _asked = true;
    fetch('/api/selfhost/session', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.user) return;
        _session = { member: { email: d.user, id: d.user }, gated: Boolean(d.gated) };
        window.dispatchEvent(new CustomEvent(SESSION_EVENT));
      })
      .catch(() => {});
  }
  return _session;
}

/** The console owns the session, so signing out is its business, not this app's. */
export function logout() {
  fetch('/api/selfhost/logout', { method: 'POST' })
    .catch(() => {})
    .finally(() => { window.location.href = '/'; });
}
