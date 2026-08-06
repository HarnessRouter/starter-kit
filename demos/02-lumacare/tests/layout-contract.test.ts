import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('keeps the guide viewport stable while waiting and streaming', () => {
  assert.match(styles, /\.result-body\{height:clamp\(320px,56vh,620px\);overflow-y:auto/);
  assert.doesNotMatch(styles, /\.result-body\{max-height:/);
});

test('uses stable responsive guide heights on tablet and phone layouts', () => {
  assert.match(styles, /@media\(max-width:850px\).*?\.result-body\{height:clamp\(320px,60svh,540px\)\}/s);
  assert.match(styles, /@media\(max-width:600px\).*?\.result-body\{height:clamp\(300px,62svh,480px\)\}/s);
});
