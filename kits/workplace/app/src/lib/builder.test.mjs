import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBuilderReply, answersToText, handleOf, cleanName, extractJson } from './builder.js';

test('a fenced questions reply is read and the free-text option is never duplicated', () => {
  const r = parseBuilderReply('Here you go:\n```json\n{"type":"questions","intro":"Let us design them.","questions":[{"id":"Job Role","prompt":"What should they do?","options":["Research","Writing","Something else"],"multiple":false},{"id":"","prompt":"Tone?","options":["Warm","Terse","Playful"],"multiple":true}]}\n```');
  assert.equal(r.type, 'questions');
  assert.equal(r.questions[0].id, 'job-role');
  assert.deepEqual(r.questions[0].options, ['Research', 'Writing']);
  assert.equal(r.questions[1].id, 'q2');
  assert.equal(r.questions[1].multiple, true);
});

test('a teammate reply is clipped and its face validated', () => {
  const r = parseBuilderReply(JSON.stringify({ type: 'teammate', name: 'Nova <script>', tagline: 'x'.repeat(100), expertise: ['a', '', 'b'], greeting: 'hi', system_prompt: 'You are Nova.' }));
  assert.equal(r.type, 'teammate');
  assert.equal(r.name, 'Nova script');
  assert.equal(r.tagline.length, 60);
  assert.equal(r.avatar, undefined);   // the person picks the face; the recruiter never does
  assert.deepEqual(r.expertise, ['a', 'b']);
});

test('prose, an array, or a profile without a prompt is not a reply', () => {
  assert.equal(parseBuilderReply('Sure! What would you like?'), null);
  assert.equal(parseBuilderReply('[1,2]'), null);
  assert.equal(parseBuilderReply('{"type":"teammate","name":"X"}'), null);
  assert.equal(extractJson(''), null);
});

test('answers read back one line per question, with free text marked', () => {
  const qs = [{ id: 'job' }, { id: 'tone' }, { id: 'never' }];
  const t = answersToText(qs, { job: { picked: ['Research'] }, tone: { picked: [], other: 'like a pirate' }, never: { picked: [] } });
  assert.equal(t, 'Answers:\n- job: Research\n- tone: (in their words) like a pirate\nLeft open (decide yourself): never');
});

test('handles drop spaces and names keep letters only', () => {
  assert.equal(handleOf('Nova Lee'), 'NovaLee');
  assert.equal(cleanName(''), 'Teammate');
  assert.equal(cleanName('  Ada   Lovelace!!  '), 'Ada Lovelace');
});

test('a reply that slips at its very end is repaired', () => {
  const slip = '{"type":"teammate","name":"Marlowe","tagline":"Account strategist","expertise":["briefs"],"greeting":"Hi.","system_prompt":"You are Marlowe. If something is missing, say so.","}';
  assert.equal(parseBuilderReply(slip)?.name, 'Marlowe');
  assert.equal(parseBuilderReply('{"type":"questions","questions":[{"id":"job","prompt":"?","options":["a","b",],},]}')?.type, 'questions');
  assert.equal(parseBuilderReply('not json at all'), null);
});
