import test from 'node:test';
import assert from 'node:assert/strict';
import { newGroupDoc, mergeDoc, appendMessage, humanMessage, teammateMessage, planPending, orphans, needsDriver, isSkip, unseenFor, renderDelta, cleanGroupName, coerceDoc, roundHeldByOther } from './groupdoc.js';

const roster = [{ id: 'a', name: 'Nova' }, { id: 'b', name: 'Atlas' }, { id: 'c', name: 'Kira' }];
const me = { id: '*', name: 'Richard' };

test('a merge keeps every message from both sides and the furthest cursor', () => {
  const base = newGroupDoc({ id: 's', name: 'Design', members: ['a', 'b'] });
  const m1 = humanMessage({ me, text: 'hi' });
  const left = { ...appendMessage(base, m1), bots: { a: { session: 'sa', seen: 1 } }, rev: 3 };
  const m2 = teammateMessage({ botId: 'b', text: 'hello' });
  const right = { ...appendMessage(base, m2), bots: { a: { session: '', seen: 2 }, b: { session: 'sb', seen: 2 } }, rev: 4 };
  const out = mergeDoc(left, right);
  assert.deepEqual(out.messages.map((m) => m.id).sort(), [m1.id, m2.id].sort());
  assert.deepEqual(out.bots, { a: { session: 'sa', seen: 2 }, b: { session: 'sb', seen: 2 } });
  assert.equal(out.rev, 5);
  assert.equal(out.name, 'design');
});

test('the mentioned answer first, in the order mentioned, then the rest of the room', () => {
  let doc = newGroupDoc({ id: 's', name: 'x', members: ['a', 'b', 'c', 'zombie'] });
  doc = appendMessage(doc, humanMessage({ me, text: '@Kira and @Nova?', mentions: ['c', 'a'] }));
  assert.deepEqual(planPending(doc, roster).map((q) => [q.id, q.mentioned, q.hop]), [['c', true, 0], ['a', true, 0], ['b', false, 0]]);
  let all = newGroupDoc({ id: 's', name: 'x', members: ['a', 'b'] });
  all = appendMessage(all, humanMessage({ me, text: '@everyone status?' }));
  assert.ok(planPending(all, roster).every((q) => q.mentioned));
  // a teammate that has read the message owes nothing; one that has not still owes a look
  doc.bots = { c: { session: 'sc', seen: 1 }, a: { session: 'sa', seen: 1 } };
  assert.deepEqual(planPending(doc, roster).map((q) => q.id), ['b']);
  assert.deepEqual(planPending({ ...doc, bots: { ...doc.bots, b: { session: '', seen: 1 } } }, roster), []);
});

test('a reply pulls in the teammates it mentions, up to the hop cap, never itself', () => {
  let doc = newGroupDoc({ id: 's', name: 'x', members: ['a', 'b', 'c'] });
  doc = appendMessage(doc, humanMessage({ me, text: 'go', mentions: ['a'] }));
  const r = teammateMessage({ botId: 'a', text: '@Atlas check @Nova @Kira', mentions: ['b', 'c'], hop: 0 });
  doc = appendMessage(doc, r);
  doc.bots = { a: { session: 'sa', seen: 2 } };
  // b and c owe the person a look (hop 0) and are now mentioned, in the order the reply named them
  assert.deepEqual(planPending(doc, roster).map((q) => [q.id, q.hop, q.mentioned, q.cause]), [['b', 0, true, r.id], ['c', 0, true, r.id]]);
  // once they have read the person, a mention alone is a follow-up one hop on
  doc.bots = { a: { session: 'sa', seen: 2 }, b: { session: 'sb', seen: 1 }, c: { session: 'sc', seen: 1 } };
  assert.deepEqual(planPending(doc, roster).map((q) => [q.id, q.hop]), [['b', 1], ['c', 1]]);
  // the chain is capped, and a teammate never answers its own mention of itself
  let capped = newGroupDoc({ id: 's', name: 'x', members: ['a', 'b'] });
  capped = appendMessage(capped, teammateMessage({ botId: 'a', text: '@Atlas', mentions: ['b'], hop: 3 }));
  assert.deepEqual(planPending(capped, roster), []);
  let selfie = newGroupDoc({ id: 's', name: 'x', members: ['a'] });
  selfie = appendMessage(selfie, teammateMessage({ botId: 'a', text: '@Nova', mentions: ['a'], hop: 0 }));
  assert.deepEqual(planPending(selfie, roster), []);
});

test('a room with work and no live driver needs one; a typing mark without a driver is an orphan', () => {
  let doc = newGroupDoc({ id: 's', name: 'x', members: ['a', 'b'] });
  assert.equal(needsDriver(doc, roster, 't2'), false);
  doc = appendMessage(doc, humanMessage({ me, text: 'hello' }));
  assert.equal(needsDriver(doc, roster, 't2'), true);
  doc.round = { by: 't1', at: Date.now() };
  assert.equal(needsDriver(doc, roster, 't2'), false);            // t1 is alive
  doc.round = { by: 't1', at: Date.now() - 120000 };
  assert.equal(needsDriver(doc, roster, 't2'), true);             // t1 went silent
  doc.bots = { a: { session: 'sa', seen: 1 }, b: { session: '', seen: 1 } };
  doc.typing = { a: { on: true, at: 1 } };
  assert.deepEqual(orphans(doc), [{ id: 'a', session: 'sa' }]);
  assert.equal(needsDriver(doc, roster, 't2'), true);             // nothing planned, but a turn to read back
  doc.typing = { a: { on: false, at: 2 } };
  assert.equal(needsDriver(doc, roster, 't2'), false);
});

test('skip is recognised loosely and an inbox renders by name', () => {
  assert.equal(isSkip(' [SKIP] '), true);
  assert.equal(isSkip('skip.'), true);
  assert.equal(isSkip(''), true);
  assert.equal(isSkip('I will skip lunch'), false);
  let doc = newGroupDoc({ id: 's', name: 'x', members: ['a', 'b'] });
  doc = appendMessage(doc, humanMessage({ me, text: 'hello all' }));
  doc = appendMessage(doc, teammateMessage({ botId: 'a', text: 'hi', files: [{ path: 'notes.md' }] }));
  doc.bots.b = { session: '', seen: 1 };
  const inbox = unseenFor(doc, 'b');
  assert.equal(inbox.length, 1);
  assert.equal(renderDelta(inbox, roster, me), 'Nova: hi\n[file: notes.md]');
  assert.equal(renderDelta(unseenFor(doc, 'a'), roster, me).split('\n\n')[0], 'Richard: hello all');
});

test('names, stored docs and the round lock', () => {
  assert.equal(cleanGroupName('# Design Review!'), 'design-review');
  assert.equal(coerceDoc({ foo: 1 }), null);
  assert.equal(coerceDoc({ name: 'x', messages: [] }).v, 1);
  const doc = { round: { by: 't1', at: Date.now() } };
  assert.equal(roundHeldByOther(doc, 't2'), true);
  assert.equal(roundHeldByOther(doc, 't1'), false);
  assert.equal(roundHeldByOther({ round: { by: 't1', at: Date.now() - 120000 } }, 't2'), false);
});

test('typing marks and the round lock merge by newest write', () => {
  const base = newGroupDoc({ id: 's', name: 'x', members: ['a'] });
  const t = Date.now();
  const remote = { ...base, typing: { a: { at: t - 10, on: true } }, round: { by: 'other', at: t - 5 }, rev: 1 };
  const local = { ...base, typing: { a: { at: t, on: false } }, round: { by: '', at: t }, rev: 1 };
  const out = mergeDoc(local, remote);
  assert.equal(out.typing.a.on, false);
  assert.equal(out.round.by, '');
  const out2 = mergeDoc({ ...base, round: null, rev: 1 }, remote);
  assert.equal(out2.round.by, 'other');
});
