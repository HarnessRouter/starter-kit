import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeRuns, flowchartSource } from './deckContent.js';

// The shapes the agent writes, from the deck model: these are what the deck view draws.
const flow = { type: 'flowchart', content: { mermaid: 'flowchart LR\n  A["Introduced"] --> B["Committee"]' } };
const code = { type: 'code', content: { lang: 'python', source: 'def add(a, b):\n    return a + b\n' } };

test('a flowchart is exported from its Mermaid source', () => {
  assert.equal(flowchartSource(flow), flow.content.mermaid);
});

test('a code block is exported from its source, line breaks and all', () => {
  assert.deepEqual(codeRuns(code), [{ text: code.content.source }]);
});

test('fields the deck view does not draw are not exported either', () => {
  // the old readers' fields: a deck carrying only these shows nothing on the slide
  assert.equal(flowchartSource({ type: 'flowchart', content: { code: 'flowchart LR\n A --> B' } }), '');
  assert.deepEqual(codeRuns({ type: 'code', content: { runs: [{ text: 'x = 1' }] } }), []);
});

test('an element with nothing to show gives nothing, so the export can say it left it out', () => {
  for (const el of [{}, { content: null }, { content: { mermaid: '   ' } }, { content: { mermaid: 42 } }]) {
    assert.equal(flowchartSource(el), '');
  }
  for (const el of [{}, { content: {} }, { content: { source: '\n' } }]) {
    assert.deepEqual(codeRuns(el), []);
  }
});
