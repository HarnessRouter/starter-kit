// The names of the twelve faces and how one is chosen — plain data, so the logic that needs a
// face (the recruiter protocol, the tests) never pulls React in. The drawings are in avatars.jsx.
export const AVATAR_IDS = ['fox', 'owl', 'cat', 'bear', 'panda', 'robot', 'koala', 'penguin', 'bunny', 'frog', 'whale', 'sloth'];

/** A face by name, or a stable one for a name the set does not have. */
export function avatarOf(id, seed = '') {
  if (id && AVATAR_IDS.includes(id)) return id;
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_IDS[h % AVATAR_IDS.length];
}
