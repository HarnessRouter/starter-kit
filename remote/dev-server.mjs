#!/usr/bin/env node
// Remote mode on your own machine: npm run remote:dev (after npm run build and npm run remote:setup)
//
// Serves the built app the way vercel.json does on Vercel (the gate first, the kit's path, the
// session paths the app already calls, the one route to HarnessRouter), from app/.env.local.
// PORT sets the port (default 4173).
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { gate, login, logout, proxy, session } from './core.js';

const app = new URL('..', import.meta.url).pathname;
const route = JSON.parse(readFileSync(join(app, '..', 'kit.json'))).app.route;   // e.g. /kits/slides
const allow = (await import(join(app, 'remote', 'allow.js'))).default;
const dist = join(app, 'dist');
const env = { ...process.env };
const envFile = join(app, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0 && !line.startsWith('#')) env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim();
  }
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function staticFile(path) {
  const p = normalize(join(dist, path === '/' ? 'index.html' : path));
  if (!p.startsWith(dist) || !existsSync(p) || statSync(p).isDirectory()) return null;
  return new Response(readFileSync(p), { headers: { 'content-type': TYPES[extname(p)] || 'application/octet-stream' } });
}

async function handle(request) {
  const url = new URL(request.url);
  let path = url.pathname;
  if (path === '/') return new Response(null, { status: 302, headers: { location: `${route}/` } });
  const stop = await gate(request, env);                                  // the middleware
  if (stop) return stop;
  if (path === '/api/selfhost/session') path = '/api/kit/session';      // the rewrites
  if (path === '/api/selfhost/logout') path = '/api/kit/logout';
  if (path === '/api/kit/login') return login(request, env);
  if (path === '/api/kit/logout') return logout(request);
  if (path === '/api/kit/session') return session(request, env);
  if (path.startsWith('/api/harness/')) return proxy(request, env, allow);
  if (path.startsWith(`${route}/`)) path = path.slice(route.length);
  return staticFile(path) || staticFile('/index.html');
}

const port = Number(process.env.PORT || 4173);
createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
  });
  const response = await handle(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) for await (const c of response.body) res.write(c);
  res.end();
}).listen(port, '127.0.0.1', () => console.log(`remote mode on http://localhost:${port}${route}/`));
