#!/usr/bin/env node
// Remote mode's setup, run once by the kit's owner: npm run remote:setup
//
// It checks the key against HarnessRouter, generates the password and the cookie secret, and
// writes the values to .env.local (readable by you only) for `npm run remote:dev` and for pasting
// into your host's environment settings. The password is generated, never chosen: a serverless
// route cannot count failed attempts, so the password's strength is the defence (CAT, 10-18).
//
// It refuses to finish while spending is unbounded. Anyone with the password spends the key's
// credit, so the harness needs a per-task cost cap and the key's workspace a monthly one.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const KIT = JSON.parse(readFileSync(new URL('../../kit.json', import.meta.url))).id;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** n characters, uniform over ALPHABET (rejection sampling: no modulo bias). */
function generate(n) {
  const out = []; const lim = 256 - (256 % ALPHABET.length);
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) {
      if (b < lim && out.length < n) out.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return out.join('');
}

async function ask(question, { hidden = false } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) rl._writeToOutput = (s) => { if (!s.includes(question)) return; rl.output.write(question); };
  const answer = await new Promise((r) => rl.question(question, r));
  rl.close();
  if (hidden) process.stdout.write('\n');
  return answer.trim();
}

function stop(sentence) {
  console.error(`\nSetup did not finish: ${sentence}`);
  process.exit(1);
}

const base = (process.env.HR_BASE_URL || 'https://api.harnessrouter.ai').replace(/\/+$/, '');
const key = process.env.HR_API_KEY || await ask('HarnessRouter API key (for the kit’s own workspace): ', { hidden: true });
if (!key) stop('no API key was given.');

async function api(path) {
  const r = await fetch(`${base}/v1${path}`, { headers: { authorization: `Bearer ${key}` } });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const listed = await api('/harnesses');
if (listed.status === 401 || listed.status === 403) stop('HarnessRouter did not accept that key.');
if (listed.status !== 200) stop(`HarnessRouter answered ${listed.status} when asked for the key’s harnesses.`);
const harnesses = (listed.body?.harnesses || listed.body?.data || []).filter((h) => h?.kit === KIT);
let harness = process.env.HR_HARNESS_ID ? harnesses.find((h) => h.id === process.env.HR_HARNESS_ID) : harnesses[0];
if (!harness) stop(`the key’s workspace has no ${KIT} harness. Launch the ${KIT} kit in that workspace first.`);
if (harnesses.length > 1 && !process.env.HR_HARNESS_ID) {
  stop(`the workspace has ${harnesses.length} ${KIT} harnesses; set HR_HARNESS_ID to the one this app should use.`);
}

// Spending bounds. A task's cap is the harness's own (its Runtime limits); without one a task can
// spend up to the platform default, which is not a bound the owner chose.
const taskCap = Number(harness.max_cost_usd ?? harness.runtime?.max_cost_usd);
if (!(taskCap > 0)) {
  stop(`the ${KIT} harness has no cost cap per task. Set one under Runtime limits in its settings, so one task cannot spend more than you chose.`);
}
// A monthly cap bounds how many tasks the password can buy. HarnessRouter does not offer one yet
// (10-18); remote mode stays unreleased until it does, and this check reads it once it exists.
const monthCap = null;
if (!monthCap) {
  stop('remote mode needs a monthly spending cap on the key’s workspace, and HarnessRouter does not offer one yet, so anyone with the password could spend without limit.');
}

const values = {
  HR_BASE_URL: base,
  HR_HARNESS_ID: harness.id,
  HR_API_KEY: key,
  KIT_PASSWORD: generate(24),
  KIT_COOKIE_SECRET: generate(48),
};
const file = new URL('../.env.local', import.meta.url);
if (existsSync(file)) stop('.env.local already exists. Move it away to set up again (this changes the password).');
writeFileSync(file, Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
chmodSync(file, 0o600);
// The values are never printed: a terminal's scrollback and a CI log both outlive the moment.
console.log(`
Done. The five values are in app/.env.local, readable by you only.
Add them to your host's environment settings (on Vercel: Project, Settings, Environment Variables),
then deploy. The app's password is KIT_PASSWORD in that file: share it only with the people who
should use this app. To sign everyone out, set a new KIT_COOKIE_SECRET. To change the password,
set a new KIT_PASSWORD.`);
