// "Last opened" in the list reads the session list's own time, which is in epoch SECONDS.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { relativeTime } from './sh.js';

const HOUR = 3600;
// Two and a half hours ago: the middle of the "2 h ago" bucket, so no clock edge can tip it.
const AGO = 2.5 * HOUR;

test('a time in epoch seconds is that time, not January 1970 (staging, 2026-10-19)', () => {
  const s = Math.floor(Date.now() / 1000 - AGO);
  assert.equal(relativeTime(s), '2 h ago');
  assert.equal(relativeTime(s + 0.25), '2 h ago');   // the list's created_at carries a fraction
});

test('milliseconds, a numeric string and an ISO date read the same', () => {
  const ms = Date.now() - AGO * 1000;
  assert.equal(relativeTime(ms), '2 h ago');
  assert.equal(relativeTime(String(Math.floor(ms / 1000))), '2 h ago');
  assert.equal(relativeTime(new Date(ms).toISOString()), '2 h ago');
});

test('an older time in seconds is shown as its own date', () => {
  const s = Date.UTC(2025, 0, 15, 12) / 1000;
  assert.equal(relativeTime(s), new Date(s * 1000).toLocaleDateString());
  assert.notEqual(new Date(s * 1000).getFullYear(), 1970);
});

test('no time, or a time that is not one, shows nothing', () => {
  assert.equal(relativeTime(null), null);
  assert.equal(relativeTime(0), null);
  assert.equal(relativeTime('not a date'), null);
});
