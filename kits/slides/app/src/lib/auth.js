// Identity, borrowed rather than built.
//
// The hosted product ships its own sign-in, JWT and sliding-refresh. This app has none of that on
// purpose: it is served by the HarnessRouter console at /kits/slides, so the console's middleware
// has already authenticated whoever is looking at it, and the browser carries that session on
// every same-origin request. There is nothing left for the app to do — no token to hold, no login
// screen to render, no refresh to schedule.
//
// The module still exists because the pages import from it. Each export is the honest local answer
// to the question the hosted version answers with a token.
export const SESSION_EVENT = 'slides:session';

/** Same-origin: the console session rides along, and its proxy attaches the internal key. */
export function authFetch(url, init = {}) {
  return fetch(url, { cache: 'no-store', ...init });
}

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

/** Always: reaching this app at all means the console already let you in. */
export function isAuthed() {
  return true;
}

/** The console owns the session, so signing out is its business, not this app's. */
export function logout() {
  fetch('/api/selfhost/logout', { method: 'POST' })
    .catch(() => {})
    .finally(() => { window.location.href = '/'; });
}

/** No token here to refresh. */
export function refreshToken() {
  return Promise.resolve();
}
