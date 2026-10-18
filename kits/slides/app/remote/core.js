// Remote mode: a kit app on its owner's own hosting (Vercel first), reaching HarnessRouter's
// cloud through one server route in the same project.
//
// In the console a kit is served at /kits/<kit> and its calls to /api/harness/v1/... are
// same-origin: the console's proxy adds the key, and the console's sign-in decides who gets in.
// Remote mode keeps those paths, so the app does not change, and puts three things in their place:
//
//   the gate   nothing reaches the app or the route without the kit's password (a signed cookie);
//   the route  forwards only what the kit's allowlist names, with the key added on the server;
//   the pin    every task runs on the kit's one harness, whatever the browser asks for.
//
// The key, the password and the cookie secret are server-side environment variables. None of them
// is ever sent to a browser, and remote/check-bundle.mjs fails a build whose output contains one.
//
// Written against Web standard Request/Response and WebCrypto only, so the same code runs in
// Vercel's Node and Edge runtimes and in remote/dev-server.mjs.

export const COOKIE = 'kit_session';
export const COOKIE_HOURS = 12;
export const MIN_PASSWORD = 20;
export const MIN_SECRET = 32;
export const MAX_BODY = 4 * 1024 * 1024;        // under Vercel's 4.5 MB request limit
const DEFAULT_BASE = 'https://api.harnessrouter.ai';
const enc = new TextEncoder();

// ── configuration ────────────────────────────────────────────────────────────

/** The kit's settings from the environment, and what is wrong with them. A route with problems
 *  refuses everything: an unset or weak password must never become an open door. */
export function settings(env) {
  const problems = [];
  const key = String(env.HR_API_KEY || '');
  const harness = String(env.HR_HARNESS_ID || '');
  const password = String(env.KIT_PASSWORD || '');
  const secret = String(env.KIT_COOKIE_SECRET || '');
  let base = String(env.HR_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
  if (!key) problems.push('HR_API_KEY is not set');
  if (!harness) problems.push('HR_HARNESS_ID is not set');
  if (password.length < MIN_PASSWORD) problems.push(`KIT_PASSWORD is shorter than ${MIN_PASSWORD} characters`);
  if (secret.length < MIN_SECRET) problems.push(`KIT_COOKIE_SECRET is shorter than ${MIN_SECRET} characters`);
  if (secret && secret === password) problems.push('KIT_COOKIE_SECRET must not be the password');
  try {
    const u = new URL(base);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) problems.push('HR_BASE_URL must be https');
  } catch {
    problems.push('HR_BASE_URL is not a URL');
    base = '';
  }
  return { ok: problems.length === 0, problems, key, harness, password, secret, base };
}

// ── constant-time comparison and the signed cookie ───────────────────────────

async function hmac(secret, text) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(text)));
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Equal, in time that does not depend on where the strings differ or how long either is: both
 *  are reduced to an HMAC first, and the digests are compared byte by byte without an early exit. */
export async function sameSecret(a, b, secret) {
  const [x, y] = await Promise.all([hmac(secret, String(a)), hmac(secret, String(b))]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** `<expiry>.<signature>`: no identity in it, only "the password was given, until then". */
export async function issueCookie(secret, now = Date.now()) {
  const exp = Math.floor(now / 1000) + COOKIE_HOURS * 3600;
  return `${exp}.${b64url(await hmac(secret, `kit:${exp}`))}`;
}

export async function validCookie(value, secret, now = Date.now()) {
  const m = /^(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(String(value || ''));
  if (!m || Number(m[1]) * 1000 <= now) return false;
  return sameSecret(m[2], b64url(await hmac(secret, `kit:${m[1]}`)), secret);
}

function cookieOf(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

export async function signedIn(request, s) {
  return validCookie(cookieOf(request, COOKIE), s.secret);
}

/** A write that came from this app's own pages: SameSite=Lax already keeps the cookie off other
 *  sites' form posts, and this refuses the rest (CAT, 10-18). */
export function sameOrigin(request) {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = request.headers.get('origin');
  return Boolean(origin) && origin === new URL(request.url).origin;
}

// ── plain answers ────────────────────────────────────────────────────────────

function json(status, message, extra = {}) {
  return new Response(JSON.stringify({ error: { message }, ...extra }), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function notSetUp(s) {
  // The owner reads the reason in the deployment's logs; a visitor learns only that it is not ready.
  console.error(`kit remote mode is not set up: ${s.problems.join('; ')}`);
  return json(503, 'This app is not set up yet. Its owner needs to finish its setup.');
}

function page(status, body, headers = {}) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; box-sizing: border-box; }
  form { width: 100%; max-width: 360px; display: grid; gap: 12px; }
  h1 { font-size: 20px; margin: 0; }
  p { margin: 0; opacity: .75; line-height: 1.45; }
  input, button { font: inherit; padding: 10px 12px; border-radius: 8px; border: 1px solid #8884; }
  button { background: #285aff; color: #fff; border: 0; cursor: pointer; }
  .err { color: #c0392b; opacity: 1; }
</style></head><body>${body}</body></html>`, {
    status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Where to go after signing in: a path on this site, never another site. */
function safeNext(raw) {
  const n = String(raw || '/');
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/';
}

function form(next, error = '') {
  return `<form method="post" action="/api/kit/login">
  <h1>Sign in</h1>
  <p>This app is private. Enter the password its owner gave you.</p>
  ${error ? `<p class="err" role="alert">${escapeHtml(error)}</p>` : ''}
  <input type="password" name="password" autocomplete="current-password" aria-label="Password" required autofocus>
  <input type="hidden" name="next" value="${escapeHtml(safeNext(next))}">
  <button type="submit">Sign in</button>
</form>`;
}

function setCookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

// ── the gate, sign-in, sign-out, session ─────────────────────────────────────

/** Middleware: null lets the request through, a Response answers it. Everything but the sign-in
 *  page needs the cookie: the app's pages (sent to sign in) and its API calls (told to). */
export async function gate(request, env) {
  const path = new URL(request.url).pathname;
  if (path === '/api/kit/login') return null;
  const s = settings(env);
  if (!s.ok) return notSetUp(s);
  if (await signedIn(request, s)) return null;
  if (path.startsWith('/api/')) return json(401, 'Sign in to use this app.');
  const url = new URL(request.url);
  return new Response(null, { status: 302, headers: {
    location: `/api/kit/login?next=${encodeURIComponent(url.pathname + url.search)}`, 'cache-control': 'no-store' } });
}

export async function login(request, env) {
  const s = settings(env);
  if (!s.ok) return notSetUp(s);
  const url = new URL(request.url);
  if (request.method === 'GET') return page(200, form(url.searchParams.get('next')));
  if (request.method !== 'POST') return json(405, 'Use GET or POST.');
  if (!sameOrigin(request)) return json(403, 'Sign in from this app’s own page.');
  const body = new URLSearchParams(await request.text());
  const next = safeNext(body.get('next'));
  if (!(await sameSecret(body.get('password') || '', s.password, s.secret))) {
    return page(401, form(next, 'That password is not right.'));
  }
  return new Response(null, { status: 303, headers: {
    location: next, 'set-cookie': setCookie(await issueCookie(s.secret), COOKIE_HOURS * 3600), 'cache-control': 'no-store' } });
}

export async function logout(request) {
  if (request.method !== 'POST') return json(405, 'Use POST.');
  if (!sameOrigin(request)) return json(403, 'Sign out from this app’s own page.');
  return new Response(null, { status: 303, headers: {
    location: '/api/kit/login', 'set-cookie': setCookie('', 0), 'cache-control': 'no-store' } });
}

/** The answer the console gives at /api/selfhost/session, so the app's auth.js needs no change. */
export async function session(request, env) {
  const s = settings(env);
  if (!s.ok) return notSetUp(s);
  if (!(await signedIn(request, s))) return json(401, 'Sign in to use this app.');
  return new Response(JSON.stringify({ user: 'kit', gated: true }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

// ── the route ────────────────────────────────────────────────────────────────

const ID = '[A-Za-z0-9][A-Za-z0-9_.-]*';
/** A path segment the allowlist may name: an id, never `.`, `..` or an encoded separator. */
export const seg = (re) => new RegExp('^' + re.replace(/:id/g, ID) + '$');

const KEEP_REQUEST = ['content-type', 'accept', 'last-event-id'];
// Not content-length or content-encoding: fetch hands back the body decoded, so the upstream's
// length would no longer describe it.
const KEEP_RESPONSE = ['content-type', 'content-disposition', 'cache-control'];

async function readCapped(request, cap) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > cap) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const parts = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > cap) { reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(n); let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Forward one call to HarnessRouter, if the kit's allowlist names it.
 *  allow: [{ method, path: RegExp over the path after /v1, pin?, maxBody? }] */
export async function proxy(request, env, allow) {
  const s = settings(env);
  if (!s.ok) return notSetUp(s);
  if (!(await signedIn(request, s))) return json(401, 'Sign in to use this app.');
  const method = request.method.toUpperCase();
  if (!['GET', 'HEAD'].includes(method) && !sameOrigin(request)) return json(403, 'That request did not come from this app.');

  const url = new URL(request.url);
  const m = /^\/api\/harness\/v1(\/.*)$/.exec(url.pathname);
  const rest = m ? m[1] : '';
  const rule = rest && allow.find((r) => r.method === method && r.path.test(rest));
  // Not "forbidden": a path this app does not use does not exist, as far as the browser can tell.
  if (!rule) return json(404, 'Not found.');

  let body;
  if (!['GET', 'HEAD'].includes(method)) {
    const bytes = await readCapped(request, rule.maxBody ?? MAX_BODY);
    if (bytes === null) return json(413, 'That is too large to send through this app.');
    body = bytes;
  }

  // The pin: a task runs on the kit's harness, and lists show only the kit's harness and sessions.
  if (rule.pin === 'response') {
    let doc;
    try { doc = JSON.parse(new TextDecoder().decode(body)); } catch { return json(400, 'The request body is not JSON.'); }
    const asked = doc?.metadata?.harness_id || doc?.harness_id;
    if (asked && asked !== s.harness) return json(409, 'This app runs only its own harness.');
    doc.metadata = { ...(doc.metadata || {}), harness_id: s.harness };
    delete doc.harness_id;
    body = enc.encode(JSON.stringify(doc));
  }
  if (rule.pin === 'session-list') {
    const h = url.searchParams.get('harness');
    if (h && h !== s.harness) return json(409, 'This app lists only its own harness’s sessions.');
    url.searchParams.set('harness', s.harness);
  }

  const headers = new Headers({ authorization: `Bearer ${s.key}`, 'user-agent': 'harnessrouter-kit-remote/1' });
  for (const h of KEEP_REQUEST) { const v = request.headers.get(h); if (v) headers.set(h, v); }
  let up;
  try {
    up = await fetch(`${s.base}/v1${rest}${url.search}`, { method, headers, body, redirect: 'manual' });
  } catch {
    console.error('kit remote mode: HarnessRouter did not answer');   // no request detail in logs
    return json(502, 'HarnessRouter did not answer. Try again in a moment.');
  }

  if (rule.pin === 'harness-list' && up.ok) {
    const doc = await up.json().catch(() => null);
    for (const k of ['harnesses', 'data']) {
      if (Array.isArray(doc?.[k])) doc[k] = doc[k].filter((h) => h?.id === s.harness);
    }
    return new Response(JSON.stringify(doc ?? {}), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }

  const out = new Headers({ 'cache-control': 'no-store' });
  for (const h of KEEP_RESPONSE) { const v = up.headers.get(h); if (v) out.set(h, v); }
  // A redirect from upstream would hand the browser a URL it cannot use with this app's cookie.
  if (up.status >= 300 && up.status < 400) return json(502, 'HarnessRouter answered with a redirect.');
  return new Response(method === 'HEAD' ? null : up.body, { status: up.status, headers: out });
}
