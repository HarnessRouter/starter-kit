import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeGuideText } from '../src/guide.js';

test('removes implementation details from a family-facing guide', () => {
  const text = "I’ll create a concise checklist and save the exact guide in `lumacare-guide.md`.\nPrimary artifact: [lumacare-guide.md](/workspace/lumacare-guide.md)\n## What I heard";
  assert.equal(normalizeGuideText(text), '## What I heard');
});

test('keeps ordinary guide content and removes inline code formatting', () => {
  assert.equal(normalizeGuideText('Bring your `question list`.'), 'Bring your question list.');
});
