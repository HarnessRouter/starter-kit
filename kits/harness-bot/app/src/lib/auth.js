// Who is here. The console signed the person in before this page loaded and its session rides on
// every same-origin call, so there is no token to hold. What the app still needs is an identity to
// tell "my direct message with Nova" from a teammate's: that is the workspace member.
//
// A self-hosted instance has one login and one member: every session on it is the person's, and
// the console's own route says who they are by name. A hosted console answers /api/session with the
// signed-in member. When neither answers, direct messages cannot be attributed and the app says so
// rather than showing someone else's.
let _pending = null;

export function whoami() {
  if (_pending) return _pending;
  _pending = (async () => {
    try {
      const r = await fetch('/api/selfhost/session', { cache: 'no-store' });
      if (r.ok) {
        const d = await r.json();
        if (d && d.user) return { id: '*', name: String(d.user), single: true };
      }
    } catch { /* not self-hosted, or the route is elsewhere */ }
    try {
      const r = await fetch('/api/session', { cache: 'no-store' });
      if (r.ok) {
        const d = await r.json();
        const id = d?.member?.id || d?.member?.email || d?.member || d?.email || null;
        if (d?.authed !== false && id) {
          return { id: String(id), name: String(d?.member?.name || d?.name || id), single: false };
        }
      }
    } catch { /* fail closed below */ }
    return null;
  })();
  return _pending;
}

/** Whether a session card belongs to this person. On a one-person instance every card does. */
export function mine(card, me) {
  if (!me) return false;
  if (me.id === '*') return true;
  return String(card?.member_id || '') === me.id;
}
