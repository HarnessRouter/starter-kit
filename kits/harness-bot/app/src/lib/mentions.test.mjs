import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMentions, mentionsAll, prettyMentions } from './mentions.js';

const roster = [{ id: 'a', name: 'Nova' }, { id: 'b', name: 'Nova Lee' }, { id: 'c', name: 'Atlas' }];

test('mentions resolve by handle or name, longest first, in order of appearance, never self', () => {
  assert.deepEqual(parseMentions('@Atlas can you check with @NovaLee?', roster), ['c', 'b']);
  assert.deepEqual(parseMentions('ping @nova', roster), ['a']);
  assert.deepEqual(parseMentions('@Nova Lee please', roster), ['b']);
  assert.deepEqual(parseMentions('@Atlas @Atlas', roster, 'c'), []);
  assert.deepEqual(parseMentions('mail me at nova@atlas.com', roster), []);
  assert.deepEqual(parseMentions('no at sign', roster), []);
});

test('everyone is a word, not a teammate', () => {
  assert.equal(mentionsAll('@everyone lunch?'), true);
  assert.equal(mentionsAll('@all'), true);
  assert.equal(mentionsAll('@allison'), false);
});

test('handles render as display names', () => {
  assert.equal(prettyMentions('ask @NovaLee', roster), 'ask @Nova Lee');
});
