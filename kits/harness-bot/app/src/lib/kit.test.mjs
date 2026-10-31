// The kit's name, and the name it had before. People launched it as My Workplace (id `workplace`,
// teammate package harnessrouter-workplace-teammate): their recruiter and their teammates must
// keep working whether the gateway behind the app already knows the new id or not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KIT_ID, KIT_BASE, KIT_IDS, LEGACY_KIT_IDS, TEAMMATE_PACKAGE, TEAMMATE_PACKAGES } from './kit.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const kitJson = read('../../../kit.json');

test('the app and the kit agree on the id, the aliases, the route and the packages', () => {
  assert.equal(KIT_ID, kitJson.id);
  assert.deepEqual(LEGACY_KIT_IDS, kitJson.aliases);
  assert.equal(KIT_BASE, `${kitJson.app.route}/`);
  assert.equal(TEAMMATE_PACKAGE, read('../../../teammate-plugin/plugin.json').name);
  assert.ok(read('../../../../../kits.json').kits.some((k) => k.name === KIT_ID && k.include));
  // the recruiter is told to read its Skill by name; the Skill must be called that
  const skill = readFileSync(new URL('../../../plugin/skills/harness-bot-recruiter/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /^name: harness-bot-recruiter$/m);
  assert.match(kitJson.harness.system_prompt, /harness-bot-recruiter Skill/);
  assert.ok(!kitJson.harness.replaces_packages.includes(read('../../../plugin/plugin.json').name));
  assert.ok(!kitJson.harness.replaces_names.includes(kitJson.harness.name));
});

// A gateway answering from this table: GET /kits, GET /harnesses, and a teammate's package files.
function gateway({ kits = null, harnesses = [], files = {} } = {}) {
  const asked = [];
  globalThis.fetch = async (url) => {
    const path = String(url).replace('/api/harness/v1', '');
    asked.push(path);
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (path === '/kits') return kits ? json(200, { kits }) : json(503, { error: { message: 'down' } });
    if (path === '/harnesses') return json(200, { harnesses });
    const m = path.match(/^\/harnesses\/([^/]+)\/plugins\/([^/]+)\/files$/);
    if (m && files[`${m[1]}/${m[2]}`]) return json(200, { files: [{ path: 'teammate.json', content: JSON.stringify(files[`${m[1]}/${m[2]}`]) }] });
    return json(404, { error: { message: 'not found' } });
  };
  return asked;
}
const { recruiter, listTeammates, isTeammate } = await import('./teammates.js');

const REC = { id: 'h_rec', name: 'Workplace recruiter', kit: 'workplace', base: 'dsh' };

test('a recruiter launched as workplace is found, by a gateway that knows the new id or one that does not', async () => {
  // a gateway from before the rename lists the kit under its old id
  gateway({ kits: [{ id: 'workplace', launched: true, harnessId: 'h_rec' }], harnesses: [REC] });
  assert.equal((await recruiter())?.id, 'h_rec');
  // one that knows the alias lists it under the new id, the record reporting the new id too
  gateway({ kits: [{ id: 'harness-bot', launched: true, harnessId: 'h_rec' }], harnesses: [{ ...REC, kit: 'harness-bot' }] });
  assert.equal((await recruiter())?.id, 'h_rec');
  // the catalog unreadable: the harness list's kit field, either id
  gateway({ harnesses: [{ id: 'h_x', kit: 'slides' }, REC] });
  assert.equal((await recruiter())?.id, 'h_rec');
  // not launched in this workspace: nothing, not another workspace's recruiter
  gateway({ kits: [{ id: 'harness-bot', launched: false, harnessId: null }], harnesses: [REC] });
  assert.equal(await recruiter(), null);
});

test('teammates under either package are listed, each profile read from the package it has', async () => {
  const pkg = (name) => [{ name, enabled: true }];
  const asked = gateway({
    harnesses: [
      { id: 'h_old', name: 'Marlowe', plugins: pkg('harnessrouter-workplace-teammate'), createdAt: 1 },
      { id: 'h_new', name: 'Penn', plugins: pkg(TEAMMATE_PACKAGE), createdAt: 2 },
      { id: 'h_other', name: 'Deck', plugins: pkg('harnessrouter-slides') },
      REC,
    ],
    files: {
      'h_old/harnessrouter-workplace-teammate': { avatar: { shape: 'hex', color: 'pink' }, tagline: 'Copywriter' },
      [`h_new/${TEAMMATE_PACKAGE}`]: { avatar: { color: 'teal' }, tagline: 'Strategist' },
    },
  });
  const team = await listTeammates();
  assert.deepEqual(team.map((t) => [t.name, t.tagline, t.avatar.color]), [['Marlowe', 'Copywriter', 'coral'], ['Penn', 'Strategist', 'teal']]);
  assert.ok(asked.includes('/harnesses/h_old/plugins/harnessrouter-workplace-teammate/files'));
  assert.ok(TEAMMATE_PACKAGES.every((name) => isTeammate({ plugins: pkg(name) })));
  assert.equal(isTeammate({ plugins: [{ name: TEAMMATE_PACKAGE, enabled: false }] }), false);
  assert.deepEqual(KIT_IDS, ['harness-bot', 'workplace']);
});
