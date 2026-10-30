import assert from 'node:assert/strict';
import { validateHeaderValue } from 'node:http';
import test from 'node:test';
import { contentDisposition } from '../server/disposition.js';

// validateHeaderValue is the check res.setHeader makes, the one that threw on the raw name.
const cases: [string, string, string][] = [
  ['notes.txt', 'notes.txt', 'notes.txt'],
  ['报告.md', '__.md', '%E6%8A%A5%E5%91%8A.md'],
  ['季度 汇总.xlsx', '__ __.xlsx', '%E5%AD%A3%E5%BA%A6%20%E6%B1%87%E6%80%BB.xlsx'],
  ['🚀 launch.png', '_ launch.png', '%F0%9F%9A%80%20launch.png'],
  ['say "hi".txt', 'say hi.txt', 'say%20%22hi%22.txt'],
  ['café (1).md', 'caf_ (1).md', 'caf%C3%A9%20%281%29.md'],
  ['a\r\nset-cookie: x=1.txt', 'a__set-cookie: x=1.txt', 'a%0D%0Aset-cookie%3A%20x%3D1.txt'],
  ['out/deep/report.pdf', 'report.pdf', 'report.pdf'],
  ['', 'download', 'download'],
];

for (const [name, fallback, star] of cases) {
  test(`a file named ${JSON.stringify(name)} gets a header Node will send`, () => {
    for (const kind of ['inline', 'attachment'] as const) {
      const value = contentDisposition(kind, name);
      assert.equal(value, `${kind}; filename="${fallback}"; filename*=UTF-8''${star}`);
      assert.doesNotThrow(() => validateHeaderValue('Content-Disposition', value));
    }
  });
}

test('the header these routes used to send is the one Node refuses', () => {
  assert.throws(() => validateHeaderValue('Content-Disposition', 'attachment; filename="报告.md"'),
                { code: 'ERR_INVALID_CHAR' });
});
