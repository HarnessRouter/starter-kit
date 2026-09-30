import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarOf, SHAPES, COLOR_IDS } from './faces.js';

test('a stored face is kept, a legacy name maps, and anything else is stable by seed', () => {
  assert.deepEqual(avatarOf({ shape: 'hex', color: 'pink' }), { shape: 'hex', color: 'pink' });
  assert.deepEqual(avatarOf('fox'), { shape: 'drop', color: 'orange' });
  const a = avatarOf(undefined, 'chrn_1'), b = avatarOf(undefined, 'chrn_1');
  assert.deepEqual(a, b);
  assert.ok(SHAPES.includes(a.shape) && COLOR_IDS.includes(a.color));
  assert.ok(SHAPES.includes(avatarOf({ shape: 'nope', color: 'blue' }, 'x').shape));
});
