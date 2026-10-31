import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarOf, COLOR_IDS } from './faces.js';

test('a stored face is kept, and anything else is stable by seed', () => {
  assert.deepEqual(avatarOf({ color: 'teal' }), { color: 'teal' });
  assert.deepEqual(avatarOf('violet'), { color: 'violet' });
  const a = avatarOf(undefined, 'chrn_1'), b = avatarOf(undefined, 'chrn_1');
  assert.deepEqual(a, b);
  assert.ok(COLOR_IDS.includes(a.color));
  assert.ok(COLOR_IDS.includes(avatarOf({ color: 'nope' }, 'x').color));
  assert.equal(COLOR_IDS.length, 6);
});

test('a face from before the six keeps one colour: the nearest of the six', () => {
  const blob = (color) => avatarOf({ shape: 'hex', color }).color;
  assert.deepEqual(
    ['red', 'orange', 'pink', 'purple', 'brown', 'grey', 'amber', 'green', 'teal', 'blue'].map(blob),
    ['coral', 'coral', 'coral', 'violet', 'amber', 'blue', 'amber', 'green', 'teal', 'blue'],
  );
  assert.deepEqual(avatarOf('fox'), { color: 'coral' });
  assert.deepEqual(avatarOf('owl'), { color: 'violet' });
  assert.deepEqual(avatarOf('sloth'), { color: 'amber' });
  // the same stored value gives the same face whatever the seed
  assert.deepEqual(avatarOf({ shape: 'star', color: 'pink' }, 'a'), avatarOf({ shape: 'round', color: 'pink' }, 'b'));
});
