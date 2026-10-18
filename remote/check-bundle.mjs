#!/usr/bin/env node
// Fails a remote-mode build whose output carries a secret: the key, the password or the cookie
// secret by value (read from the build's environment, where the host sets them), or the name of
// one of them (a sign that browser code reads it). Run after `vite build`: node remote/check-bundle.mjs dist
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const NAMES = ['HR_API_KEY', 'KIT_PASSWORD', 'KIT_COOKIE_SECRET'];
const dir = process.argv[2] || 'dist';
const values = NAMES.map((n) => process.env[n]).filter((v) => v && v.length >= 8);

function* files(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

const found = [];
for (const p of files(dir)) {
  const text = readFileSync(p).toString('latin1');
  for (const n of NAMES) if (text.includes(n)) found.push(`${p} names ${n}`);
  // the value itself is never printed, only that it was found and where
  values.forEach((v, i) => { if (text.includes(v)) found.push(`${p} contains the value of a secret (#${i + 1})`); });
}
if (found.length) {
  console.error('remote mode: the build output carries a secret, so this build is refused:\n  ' + found.join('\n  '));
  process.exit(1);
}
console.log(`remote mode: ${dir} carries no secret (${values.length} value(s) checked)`);
