// A cell holds the answer and nothing else, pinned against the shapes a turn's output takes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cellAnswer, endsOnToolStep, lastAssistantText, linkParts, settledAnswer, stripTracking,
} from './answer.js';

const msg = (text, annotations = []) =>
  ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations }] });
const call = (name = 'WebSearch') => ({ type: 'function_call', call_id: 'c1', name, arguments: '{}' });
const result = () => ({ type: 'function_call_output', call_id: 'c1', output: 'ok' });
const thinking = () => ({ type: 'reasoning', summary: [{ type: 'summary_text', text: 'hmm' }] });

test('narration, then tools, then the answer: the cell is the answer (staging, 2026-10-19)', () => {
  const res = { output: [
    msg("Checking Qdrant's official docs to keep the table entry accurate, then I'll give a one-sentence cell-ready answer."),
    call(), result(),
    msg('Best at production-grade semantic and hybrid search.'),
  ] };
  assert.equal(lastAssistantText(res), 'Best at production-grade semantic and hybrid search.');
  assert.equal(settledAnswer(res), 'Best at production-grade semantic and hybrid search.');
});

test('an answer given before a final validate step is the answer, once nothing follows it', () => {
  const res = { output: [msg('Three tiers, from $25 a month.'), call('Bash'), result()] };
  assert.equal(endsOnToolStep(res), true);
  assert.equal(settledAnswer(res), '');                       // may still be writing: wait
  assert.equal(cellAnswer(res), 'Three tiers, from $25 a month.');   // nothing came: this is it
});

test('tools and no text at all: no answer, so the cell says the agent finished without answering', () => {
  const res = { output: [call(), result(), call('Write'), result()] };
  assert.equal(settledAnswer(res), '');
  assert.equal(cellAnswer(res), '');
});

test('an early read, before the final message is written, counts as empty', () => {
  // the same turn as the first test, read two seconds before its reply landed
  const early = { output: [msg('Checking the docs first.'), call(), result()] };
  assert.equal(settledAnswer(early), '');
  assert.equal(settledAnswer({ output: [] }), '');
  assert.equal(settledAnswer({}), '');
});

test('with several tool steps, the last text wins', () => {
  const res = { output: [
    msg('Looking it up.'), call(), result(),
    msg('Found the site, reading the pricing page.'), call('WebFetch'), result(),
    thinking(),
    msg('Three tiers, from $25 a month.'),
  ] };
  assert.equal(cellAnswer(res), 'Three tiers, from $25 a month.');
});

test('a turn with no tool steps is answered whole; reasoning does not split a reply', () => {
  assert.equal(cellAnswer({ output: [thinking(), msg('42')] }), '42');
  assert.equal(cellAnswer({ output: [msg('First line.'), thinking(), msg('Second line.')] }),
    'First line.\nSecond line.');
  assert.equal(endsOnToolStep({ output: [msg('Done.'), thinking()] }), false);
});

test('an empty message carrying file citations is not text, and the closing note on files stays with the reply', () => {
  const res = { output: [
    msg('Writing the notes.'), call('Write'), result(),
    msg('Summary in one sentence.'),
    msg('', [{ type: 'container_file_citation', file_id: 'f1', filename: 'notes.md' }]),
    msg('big.csv was too large to attach.'),
  ] };
  assert.equal(endsOnToolStep(res), false);
  assert.equal(settledAnswer(res), 'Summary in one sentence.\nbig.csv was too large to attach.');
});

test('a turn that saved a file after answering is settled by the file citation the platform adds', () => {
  const res = { output: [
    msg('Open source, Apache 2.0.'), call('Write'), result(),
    msg('', [{ type: 'container_file_citation', file_id: 'f1', filename: 'notes.md' }]),
  ] };
  assert.equal(endsOnToolStep(res), false);
  assert.equal(settledAnswer(res), 'Open source, Apache 2.0.');
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

test('the cell value is the answer with its links cleaned', () => {
  const res = { output: [
    msg('Checking the site, then answering.'), call(), result(),
    msg('Open source, Apache 2.0 ([github.com](https://github.com/qdrant/qdrant?utm_source=openai)).'),
  ] };
  assert.equal(cellAnswer(res), 'Open source, Apache 2.0 ([github.com](https://github.com/qdrant/qdrant)).');
});

// ── a cell's links ───────────────────────────────────────────────────────────
// The value keeps its inline citations (cellAnswer above); the grid draws each as a link named by
// its text. Shown raw it read "Zero-ops hybrid retrieval for AI apps ([docs.trychroma.com]…" (staging,
// 2026-10-19).

test('an inline Markdown link becomes a link part named by its text; the text around it stays', () => {
  assert.deepEqual(
    linkParts('Hybrid search for RAG workloads. ([qdrant.tech](https://qdrant.tech/documentation/search/))'),
    [{ text: 'Hybrid search for RAG workloads. (' },
     { text: 'qdrant.tech', href: 'https://qdrant.tech/documentation/search/' },
     { text: ')' }]);
});

test('a link whose address is not http or https stays text, exactly as written', () => {
  assert.deepEqual(linkParts('[click](javascript:alert(1))'), [{ text: '[click](javascript:alert(1))' }]);
  assert.deepEqual(linkParts('Write to [us](mailto:team@example.com).'), [{ text: 'Write to [us](mailto:team@example.com).' }]);
});

test('plain text is one text part, and an empty value is no parts', () => {
  assert.deepEqual(linkParts('Best at production-grade semantic search.'), [{ text: 'Best at production-grade semantic search.' }]);
  assert.deepEqual(linkParts(''), []);
  assert.deepEqual(linkParts(null), []);
});

test('an address with balanced parentheses keeps them, and two links in a row are two parts', () => {
  assert.deepEqual(
    linkParts('[Rust](https://en.wikipedia.org/wiki/Rust_(programming_language)) and [docs](https://doc.rust-lang.org)'),
    [{ text: 'Rust', href: 'https://en.wikipedia.org/wiki/Rust_(programming_language)' },
     { text: ' and ' },
     { text: 'docs', href: 'https://doc.rust-lang.org' }]);
});
