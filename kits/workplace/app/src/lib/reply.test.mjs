// The group gets a teammate's last assistant text of the turn, never its narration run into it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasOutput, lastAssistantText } from './reply.js';

const msg = (text, annotations = []) =>
  ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations }] });
const call = (name = 'browser.navigate') => ({ type: 'function_call', call_id: 'c1', name, arguments: '{}' });
const result = () => ({ type: 'function_call_output', call_id: 'c1', output: 'ok' });
const thinking = () => ({ type: 'reasoning', summary: [{ type: 'summary_text', text: 'hmm' }] });

test('narration, then tools, then the reply: the group gets the reply', () => {
  const res = { output: [msg('Let me check their pricing page.'), call(), result(),
                         msg('@Atlas their plans start at $25 a month; can you draft the comparison?')] };
  assert.equal(lastAssistantText(res), '@Atlas their plans start at $25 a month; can you draft the comparison?');
});

test('a reply given before a final save is the reply', () => {
  const res = { output: [msg('The brief is ready: three competitors, one page.'), call('Write'), result()] };
  assert.equal(lastAssistantText(res), 'The brief is ready: three competitors, one page.');
});

test('[skip] after a look around is still a skip', () => {
  const res = { output: [msg('Reading the thread.'), call('Read'), result(), msg('[skip]')] };
  assert.equal(lastAssistantText(res), '[skip]');
});

test('tools and no text: nothing to post', () => {
  assert.equal(lastAssistantText({ output: [call(), result()] }), '');
  assert.equal(lastAssistantText({}), '');
});

test('reasoning does not split a reply, and the closing note on files stays with it', () => {
  const res = { output: [call(), result(), thinking(), msg('Done.'), thinking(), msg('Saved as a file.'),
                         msg('', [{ type: 'container_file_citation', file_id: 'f1', filename: 'brief.md' }])] };
  assert.equal(lastAssistantText(res), 'Done.\nSaved as a file.');
});

test('only a response that carries its items is the authority', () => {
  assert.equal(hasOutput({ output: [msg('x')] }), true);
  assert.equal(hasOutput({ output: [] }), false);
  assert.equal(hasOutput(null), false);
});
