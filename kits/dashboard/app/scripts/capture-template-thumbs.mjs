/* Capture one PNG per template, from the template's own preview board.
 *
 * The card used to draw a grid of grey rectangles — the panel LAYOUT and nothing else. Every
 * template has roughly the same layout, so the cards were indistinguishable and told nobody which
 * template to pick. A captured board is the honest answer: it IS the thing being chosen, charts
 * and all.
 *
 * Captured rather than rendered live because a board laid out at ~230px is not the same board
 * shrunk: the canvas collapses its columns at that width, so a live miniature shows a layout
 * nobody will ever get. It also keeps five chart-drawing boards off the landing page's first
 * paint.
 *
 * The figures come from each template's `sample` block, which the copilot cannot reach — the same
 * rule that lets the eye-preview show numbers at all.
 *
 * Usage: node scripts/capture-template-thumbs.mjs [baseUrl]
 *   HR_USER / HR_PASS  log in first, for a console that gates the kit behind a session.
 *
 * Playwright is deliberately NOT a devDependency: this is a maintenance tool run by hand when a
 * template changes, and adding it would make every install of the kit download browsers. Run it
 * with `npx playwright@1.62 ...` available, or `npm i -D playwright` temporarily.
 */
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(HERE, '..', '..');   // scripts/ -> app/ -> kit root
const OUT = path.join(KIT, 'templates', 'thumbs');
const BASE = process.argv[2] || 'http://localhost:5173/kits/dashboard';
const W = 1200;                       // board width; the card scales it down with object-fit

const tpl = JSON.parse(await readFile(path.join(KIT, 'templates', 'templates.json'), 'utf8'));
const templates = Array.isArray(tpl) ? tpl : (tpl.templates || []);
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2,
                                       ignoreHTTPSErrors: true });
// A self-hosted console gates every page behind a session, so a headless run lands on /login and
// finds no templates at all. Logging in through the same endpoint the login form posts to keeps
// this a normal client rather than a special case in the app.
if (process.env.HR_USER && process.env.HR_PASS) {
  const origin = new URL(BASE).origin;
  const r = await ctx.request.post(`${origin}/api/selfhost/login`, {
    data: { username: process.env.HR_USER, password: process.env.HR_PASS },
  });
  if (!r.ok()) { console.error(`login failed: HTTP ${r.status()}`); process.exit(1); }
}
const page = await ctx.newPage();
let ok = 0;

for (const [i, t] of templates.entries()) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
  // The eye button is a hover overlay; click it directly rather than simulating the hover.
  const opened = await page.evaluate((idx) => {
    const eyes = document.querySelectorAll('.db-eye');
    if (!eyes[idx]) return false;
    eyes[idx].click();
    return true;
  }, i);
  if (!opened) { console.error(`no preview control for ${t.id}`); continue; }
  await page.waitForSelector('.uic-modal .db-preview-canvas', { timeout: 15000 });
  // Isolate the board so a plain viewport capture IS the thumbnail: element screenshots time out
  // waiting for "stable" while the charts settle, and cropping afterwards needs an image library.
  const size = await page.evaluate((w) => {
    const c = document.querySelector('.uic-modal .db-preview-canvas');
    const host = document.createElement('div');
    host.id = '__shot';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#fff;overflow:hidden';
    c.style.width = `${w}px`;
    c.style.maxHeight = 'none';
    host.appendChild(c);
    document.body.appendChild(host);
    for (const el of [...document.body.children]) if (el.id !== '__shot') el.style.display = 'none';
    const r = c.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  }, W);
  await page.setViewportSize({ width: size.w, height: size.h });
  await page.waitForTimeout(600);                       // let the chart library settle
  const file = path.join(OUT, `${t.id}.png`);
  await page.screenshot({ path: file });
  console.log(`${t.id}  ${size.w}x${size.h}  ->  templates/thumbs/${t.id}.png`);
  ok += 1;
}

await browser.close();
if (ok !== templates.length) {
  console.error(`captured ${ok}/${templates.length}`);
  process.exit(1);
}
console.log(`captured ${ok}/${templates.length}`);
