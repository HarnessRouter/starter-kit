#!/usr/bin/env node
// Copies remote/'s runtime files (core.js, check-bundle.mjs, setup.mjs, dev-server.mjs) into every kit app that has remote mode
// (a kits/<kit>/app/remote/allow.js). Each app is deployed from its own folder, so it carries its
// own copy; `node remote/sync.mjs --check` fails when a copy has drifted (the tests run it).
import { copyFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const kits = join(here, '..', 'kits');
const SHARED = ['core.js', 'check-bundle.mjs', 'setup.mjs', 'dev-server.mjs'];
const check = process.argv.includes('--check');
let drift = 0;

for (const kit of readdirSync(kits)) {
  const dest = join(kits, kit, 'app', 'remote');
  if (!existsSync(join(dest, 'allow.js'))) continue;
  for (const f of SHARED) {
    const want = readFileSync(join(here, f));
    const at = join(dest, f);
    const same = existsSync(at) && readFileSync(at).equals(want);
    if (check && !same) { console.error(`${kit}: app/remote/${f} differs from remote/${f}`); drift++; }
    if (!check && !same) { copyFileSync(join(here, f), at); console.log(`${kit}: app/remote/${f} updated`); }
  }
}
if (drift) process.exit(1);
