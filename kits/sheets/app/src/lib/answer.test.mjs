// A cell holds the answer and nothing else, pinned against the shapes a turn's output takes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cellAnswer, finalAnswer, stripTracking } from './answer.js';

const msg = (text, annotations = []) =>
  ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations }] });
const call = (name = 'WebSearch') => ({ type: 'function_call', call_id: 'c1', name, arguments: '{}' });
const result = () => ({ type: 'function_call_output', call_id: 'c1', output: 'ok' });
const thinking = () => ({ type: 'reasoning', summary: [{ type: 'summary_text', text: 'hmm' }] });

test('the narration before a tool step is not part of the cell (staging, 2026-10-19)', () => {
  const res = { output: [
    msg("Checking Qdrant's official docs to keep the table entry accurate, then I'll give a one-sentence cell-ready answer."),
    call(),
    msg('Best at production-grade semantic and hybrid search.'),
  ] };
  assert.equal(finalAnswer(res), 'Best at production-grade semantic and hybrid search.');
});

test('only the text after the LAST tool step counts', () => {
  const res = { output: [
    msg('Looking it up.'), call(), result(),
    msg('Found the site, reading the pricing page.'), call('WebFetch'), result(),
    thinking(),
    msg('Three tiers, from $25 a month.'),
  ] };
  assert.equal(finalAnswer(res), 'Three tiers, from $25 a month.');
});

test('a turn with no tool steps is answered whole', () => {
  assert.equal(finalAnswer({ output: [thinking(), msg('42')] }), '42');
  assert.equal(finalAnswer({ output: [msg('First line.'), thinking(), msg('Second line.')] }),
    'First line.\nSecond line.');
});

test('reasoning between the tool step and the reply does not split the reply', () => {
  const res = { output: [msg('Searching.'), call(), result(), thinking(), msg('A.'), thinking(), msg('B.')] };
  assert.equal(finalAnswer(res), 'A.\nB.');
});

test('a turn that ends on a tool step has no answer, never its narration', () => {
  // cut off at its step cap mid-research: the last words were "about to look"
  const res = { output: [msg('Checking the docs first.'), call(), result()] };
  assert.equal(finalAnswer(res), '');
});

test('an empty message carrying file citations is not text, and a closing note after the reply stays', () => {
  const res = { output: [
    msg('Writing the notes.'), call('Write'), result(),
    msg('Summary in one sentence.'),
    msg('', [{ type: 'container_file_citation', file_id: 'f1', filename: 'notes.md' }]),
    msg('big.csv was too large to attach.'),
  ] };
  assert.equal(finalAnswer(res), 'Summary in one sentence.\nbig.csv was too large to attach.');
});

test('a missing or empty output is an empty answer', () => {
  assert.equal(finalAnswer(null), '');
  assert.equal(finalAnswer({}), '');
  assert.equal(finalAnswer({ output: [] }), '');
});

test('tracking parameters come off a cited link; the rest of the link stays', () => {
  assert.equal(
    stripTracking('Best at hybrid search ([qdrant.tech](https://qdrant.tech/documentation/?utm_source=openai))'),
    'Best at hybrid search ([qdrant.tech](https://qdrant.tech/documentation/))',
  );
  assert.equal(
    stripTracking('See https://example.com/p?id=7&utm_source=openai&utm_medium=chat#plans.'),
    'See https://example.com/p?id=7#plans.',
  );
  assert.equal(stripTracking('<https://a.example/x?gclid=abc&q=1>'), '<https://a.example/x?q=1>');
  assert.equal(stripTracking('https://a.example/x?fbclid=1, then more'), 'https://a.example/x, then more');
});

test('links without tracking, and text without links, are left exactly as they were', () => {
  const same = [
    'Plain answer, no links.',
    'https://example.com/search?q=utm_source&page=2',
    '[docs](https://example.com/a?b=1&c=2)',
    'https://example.com/path?',
  ];
  for (const s of same) assert.equal(stripTracking(s), s);
  assert.equal(stripTracking(null), '');
});

test('the cell value is the final answer with its links cleaned', () => {
  const res = { output: [
    msg('Checking the site, then answering.'), call(),
    msg('Open source, Apache 2.0 ([github.com](https://github.com/qdrant/qdrant?utm_source=openai)).'),
  ] };
  assert.equal(cellAnswer(res), 'Open source, Apache 2.0 ([github.com](https://github.com/qdrant/qdrant)).');
});
