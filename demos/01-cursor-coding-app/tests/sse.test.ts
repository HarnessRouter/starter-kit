import assert from 'node:assert/strict';
import test from 'node:test';
import { SSEParser } from '../src/api.js';

test('dispatches using the JSON type in data-only SSE frames', () => {
  const parser = new SSEParser();
  const events = parser.push('data: {"type":"response.created","response":{"id":"resp_1","metadata":{"session_id":"hsess_1"}}}\n\n');
  assert.equal(events[0].type, 'response.created');
  assert.equal(events[0].response.metadata.session_id, 'hsess_1');
});

test('buffers split chunks and accepts unknown event types', () => {
  const parser = new SSEParser();
  assert.equal(parser.push('data: {"type":"response.future').length, 0);
  const events = parser.push('.event","sequence_number":4}\n\n');
  assert.equal(events[0].type, 'response.future.event');
});

test('ignores malformed frames without stopping later events', () => {
  const parser = new SSEParser();
  const events = parser.push('data: not-json\n\ndata: {"type":"response.completed"}\n\n');
  assert.deepEqual(events.map((event) => event.type), ['response.completed']);
});
