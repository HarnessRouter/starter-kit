// node --test remote/: remote mode's gate, route and pin, against a stand-in HarnessRouter.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  COOKIE, gate, issueCookie, login, logout, proxy, sameSecret, seg, session, settings, validCookie,
} from './core.js';

const ORIGIN = 'https://kit.example';
let upstream, seen = [];
const env = () => ({
  HR_API_KEY: 'hr_test_key_value_123', HR_HARNESS_ID: 'chrn_kit', HR_BASE_URL: `http://127.0.0.1:${upstream.address().port}`,
  KIT_PASSWORD: 'Pw' + 'x'.repeat(22), KIT_COOKIE_SECRET: 'S'.repeat(48),
});
const allow = [
  { method: 'GET', path: seg('/harnesses'), pin: 'harness-list' },
  { method: 'GET', path: seg('/sessions'), pin: 'session-list' },
  { method: 'GET', path: seg('/sessions/:id') },
  { method: 'POST', path: seg('/responses'), pin: 'response' },
  { method: 'PUT', path: seg('/sessions/:id/files/deck\\.json'), maxBody: 64 },
];

before(async () => {
  upstream = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
    if (req.url.startsWith('/v1/harnesses')) {
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'upstream=1' });
      return res.end(JSON.stringify({ harnesses: [{ id: 'chrn_kit', kit: 'slides' }, { id: 'chrn_other' }] }));
    }
    if (req.url.startsWith('/v1/responses')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"type":"response.created"}\n\n');
      return setTimeout(() => res.end('data: {"type":"response.completed"}\n\n'), 20);
    }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
});
after(() => upstream.close());

async function signedCookie() { return `${COOKIE}=${await issueCookie(env().KIT_COOKIE_SECRET)}`; }
const req = (path, init = {}) => new Request(ORIGIN + path, init);

test('the settings refuse a short password, a missing secret and a plain-http host', () => {
  assert.equal(settings(env()).ok, true);
  assert.equal(settings({ ...env(), KIT_PASSWORD: 'short' }).ok, false);
  assert.equal(settings({ ...env(), KIT_COOKIE_SECRET: '' }).ok, false);
  assert.equal(settings({ ...env(), HR_BASE_URL: 'http://api.example.com' }).ok, false);
  assert.equal(settings({ ...env(), KIT_COOKIE_SECRET: env().KIT_PASSWORD + 'x'.repeat(10), KIT_PASSWORD: env().KIT_PASSWORD }).ok, true);
});

test('a route that is not set up refuses everything, without saying why to the visitor', async () => {
  const r = await proxy(req('/api/harness/v1/harnesses', { headers: { cookie: await signedCookie() } }), {}, allow);
  assert.equal(r.status, 503);
  assert.doesNotMatch(await r.text(), /HR_API_KEY|KIT_PASSWORD/);
});

test('the cookie: valid until it expires, and only with the secret that signed it', async () => {
  const s = env().KIT_COOKIE_SECRET;
  const c = await issueCookie(s);
  assert.equal(await validCookie(c, s), true);
  assert.equal(await validCookie(c, 'T'.repeat(48)), false);                  // a rotated secret signs everyone out
  assert.equal(await validCookie(c, s, Date.now() + 13 * 3600 * 1000), false); // twelve hours
  assert.equal(await validCookie(c.replace(/.$/, (x) => (x === 'A' ? 'B' : 'A')), s), false);
  assert.equal(await sameSecret('abc', 'abc', s), true);
  assert.equal(await sameSecret('abc', 'abd', s), false);
});

test('the gate sends a page to sign in and refuses an API call, and lets a signed-in one through', async () => {
  let r = await gate(req('/kits/slides/'), env());
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /^\/api\/kit\/login\?next=%2Fkits%2Fslides%2F$/);
  r = await gate(req('/api/harness/v1/harnesses'), env());
  assert.equal(r.status, 401);
  assert.equal(await gate(req('/api/kit/login'), env()), null);
  assert.equal(await gate(req('/kits/slides/', { headers: { cookie: await signedCookie() } }), env()), null);
});

test('sign-in: the right password sets a short-lived httpOnly cookie, a wrong one does not', async () => {
  const post = (pw, extra = {}) => req('/api/kit/login', { method: 'POST', body: new URLSearchParams({ password: pw, next: '/kits/slides/' }),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin', ...extra } });
  let r = await login(post('wrong'), env());
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('set-cookie'), null);
  r = await login(post(env().KIT_PASSWORD), env());
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/kits/slides/');
  assert.match(r.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax; Max-Age=43200/);
  r = await login(post(env().KIT_PASSWORD, { 'sec-fetch-site': 'cross-site' }), env());
  assert.equal(r.status, 403);
  const off = req('/api/kit/login', { method: 'POST', body: new URLSearchParams({ password: env().KIT_PASSWORD, next: '//evil.example/' }),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin' } });
  assert.equal((await login(off, env())).headers.get('location'), '/');      // never another site
});

test('sign-out clears the cookie; the session answers as the console does', async () => {
  const r = await logout(req('/api/kit/logout', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } }));
  assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await session(req('/api/kit/session'), env())).status, 401);
  const ok = await session(req('/api/kit/session', { headers: { cookie: await signedCookie() } }), env());
  assert.deepEqual(await ok.json(), { user: 'kit', gated: true });
});

test('the route forwards an allowed call with the key, and nothing of the browser’s identity', async () => {
  seen = [];
  const r = await proxy(req('/api/harness/v1/sessions/hsess_1', { headers: { cookie: await signedCookie(), authorization: 'Bearer browser', 'x-forwarded-for': '1.2.3.4' } }), env(), allow);
  assert.equal(r.status, 200);
  const h = seen[0].headers;
  assert.equal(h.authorization, 'Bearer hr_test_key_value_123');
  assert.equal(h.cookie, undefined);
  assert.equal(h['x-forwarded-for'], undefined);
});

test('the route refuses what the allowlist does not name, a traversal, and a write from another site', async () => {
  const c = await signedCookie();
  for (const p of ['/api/harness/v1/keys', '/api/harness/v1/harnesses/chrn_kit', '/api/harness/v1/sessions/..%2Fkeys', '/api/harness/v2/x']) {
    assert.equal((await proxy(req(p, { headers: { cookie: c } }), env(), allow)).status, 404, p);
  }
  const cross = req('/api/harness/v1/responses', { method: 'POST', body: '{}', headers: { cookie: c, 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' } });
  assert.equal((await proxy(cross, env(), allow)).status, 403);
});

test('a turn runs on the kit’s harness, and asking for another is refused', async () => {
  seen = [];
  const c = await signedCookie();
  const post = (body) => req('/api/harness/v1/responses', { method: 'POST', body: JSON.stringify(body),
    headers: { cookie: c, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } });
  let r = await proxy(post({ input: 'hi', stream: true }), env(), allow);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /response\.completed/);                         // the stream passes through
  assert.equal(JSON.parse(seen[0].body).metadata.harness_id, 'chrn_kit');
  r = await proxy(post({ input: 'hi', metadata: { harness_id: 'chrn_other' } }), env(), allow);
  assert.equal(r.status, 409);
  r = await proxy(post({ input: 'hi', harness_id: 'chrn_other' }), env(), allow);
  assert.equal(r.status, 409);
});

test('lists show only the kit’s harness and its sessions; upstream cookies never reach the browser', async () => {
  seen = [];
  const c = await signedCookie();
  let r = await proxy(req('/api/harness/v1/harnesses', { headers: { cookie: c } }), env(), allow);
  assert.deepEqual((await r.json()).harnesses.map((h) => h.id), ['chrn_kit']);
  assert.equal(r.headers.get('set-cookie'), null);
  r = await proxy(req('/api/harness/v1/sessions?limit=5', { headers: { cookie: c } }), env(), allow);
  assert.match(seen.at(-1).url, /harness=chrn_kit/);
  r = await proxy(req('/api/harness/v1/sessions?harness=chrn_other', { headers: { cookie: c } }), env(), allow);
  assert.equal(r.status, 409);
});

test('a body over the route’s cap is refused before it is forwarded', async () => {
  seen = [];
  const big = req('/api/harness/v1/sessions/hsess_1/files/deck.json', { method: 'PUT', body: 'x'.repeat(65),
    headers: { cookie: await signedCookie(), 'sec-fetch-site': 'same-origin' } });
  assert.equal((await proxy(big, env(), allow)).status, 413);
  assert.equal(seen.length, 0);
});

test('the bundle check refuses a build that carries a secret’s name or value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kit-dist-'));
  const run = (content, extraEnv = {}) => {
    writeFileSync(join(dir, 'a.js'), content);
    try { execFileSync(process.execPath, [new URL('./check-bundle.mjs', import.meta.url).pathname, dir], { env: { ...process.env, ...extraEnv }, stdio: 'pipe' }); return 0; }
    catch (e) { return e.status; }
  };
  assert.equal(run('console.log(1)'), 0);
  assert.equal(run('const k = import.meta.env.HR_API_KEY'), 1);
  assert.equal(run('const k = "hr_live_abcdefgh"', { HR_API_KEY: 'hr_live_abcdefgh' }), 1);
});

test('every kit app carries the current shared files', () => {
  execFileSync(process.execPath, [new URL('./sync.mjs', import.meta.url).pathname, '--check'], { stdio: 'pipe' });
});
