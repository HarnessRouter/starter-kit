import assert from 'node:assert/strict';
import test from 'node:test';
import { OwnershipStore } from '../server/store.js';

const record = {
  sessionId: 'hsess_alice',
  responseId: 'resp_one',
  userId: 'alice',
  featureKey: 'care_companion',
  title: 'Build a demo',
  prompt: 'Build a demo',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  status: 'running',
};

test('session ownership allows the creator', () => {
  const store = new OwnershipStore();
  store.save(record);
  assert.equal(store.getAuthorized('hsess_alice', 'alice')?.responseId, 'resp_one');
});

test('session ownership hides records from another user', () => {
  const store = new OwnershipStore();
  store.save(record);
  assert.equal(store.getAuthorized('hsess_alice', 'bob'), null);
  assert.equal(store.list('bob').length, 0);
});

test('status updates preserve ownership', () => {
  const store = new OwnershipStore();
  store.save(record);
  store.update('hsess_alice', { status: 'completed', responseId: 'resp_two' });
  assert.equal(store.getAuthorized('hsess_alice', 'alice')?.status, 'completed');
  assert.equal(store.getAuthorized('hsess_alice', 'alice')?.responseId, 'resp_two');
});
