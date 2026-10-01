// The workspace this page is open in: the console's cookie decides; the per-organization records
// are the fallback; nothing known is null. A browser signed in to several organizations holds a
// record per organization, and the last one written was not the one the page was open in.
import test from 'node:test';
import assert from 'node:assert/strict';

function world({ cookie = '', records = {} } = {}) {
  globalThis.document = { cookie };
  const store = { ...records };
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null) };
  Object.defineProperty(globalThis.localStorage, 'keys', { value: () => Object.keys(store) });
  globalThis.Object.keys = ((orig) => (o) => (o === globalThis.localStorage ? Object.getOwnPropertyNames(store) : orig(o)))(Object.keys);
}
const { currentWorkspace, workspaceHeaders } = await import('./workspace.js');

test('the cookie names the workspace even when other organizations left records', () => {
  world({ cookie: 'hr_auth=secret; hr_workspace=org.epsilla__hr_default%7C1',
          records: { 'hr.workspace.current.org.a': JSON.stringify({ id: 'org.a__hr_default', def: true }),
                     'hr.workspace.current.org.epsilla': JSON.stringify({ id: 'org.epsilla__hr_default', def: true }),
                     'hr.workspace.current.org.z': JSON.stringify({ id: 'org.z__hr_default', def: true }) } });
  assert.deepEqual(currentWorkspace(), { id: 'org.epsilla__hr_default', isDefault: true });
  assert.deepEqual(workspaceHeaders(), { 'x-harness-workspace': 'org.epsilla__hr_default', 'x-harness-workspace-default': '1' });
});

test('a named, non-default workspace in the cookie carries no default flag', () => {
  world({ cookie: 'hr_workspace=org.epsilla__hrws_7' });
  assert.deepEqual(currentWorkspace(), { id: 'org.epsilla__hrws_7', isDefault: false });
  assert.deepEqual(workspaceHeaders(), { 'x-harness-workspace': 'org.epsilla__hrws_7' });
});

test('without a cookie the record is the answer, and nothing known is null', () => {
  world({ records: { 'hr.workspace.current.org.one': JSON.stringify({ id: 'org.one__hr_default', def: true }) } });
  assert.deepEqual(currentWorkspace(), { id: 'org.one__hr_default', isDefault: true });
  world();
  assert.equal(currentWorkspace(), null);
  assert.deepEqual(workspaceHeaders(), {});
});
