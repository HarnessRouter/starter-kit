// Groups on the wire. A group is one session on the recruiter Harness; group.json in its workspace
// is the whole group (see groupdoc.js). The session exists because a turn opened it: opening a
// group asks the recruiter for one word, which is the only turn that session ever runs, so its
// workspace is never busy when the app writes to it.
import { kitHarness, patchSession, readJsonFile, streamTurn, writeFile } from 'reifyui/harness';
import { GROUP_FILE } from './kit.js';
import { cleanGroupName, coerceDoc, groupTitle, isGroupTitle, mergeDoc, newGroupDoc, systemMessage } from './groupdoc.js';
import { settled, sleep } from './api.js';

export function findGroups(cards, recruiterId) {
  return (cards || []).filter((c) => c.harness_id === recruiterId && isGroupTitle(c.title));
}

export async function readGroup(sid) {
  const d = coerceDoc(await readJsonFile(sid, GROUP_FILE));
  if (d) d.id = sid;
  return d;
}

/** Read, merge, write. Re-armed on `session_busy`, which only happens in the seconds after the
 *  opening turn; anything else is the caller's to see. Returns what is now stored. */
export async function writeGroup(sid, doc) {
  let last = null;
  for (let i = 0; i < 4; i += 1) {
    try {
      const remote = coerceDoc(await readJsonFile(sid, GROUP_FILE));
      const merged = mergeDoc(doc, remote);
      merged.id = sid;
      await writeFile(sid, GROUP_FILE, JSON.stringify(merged));
      return merged;
    } catch (e) {
      last = e;
      if (e?.status !== 409) throw e;
      await sleep(1500 * (i + 1));
    }
  }
  throw last;
}

const SETUP = 'This is a setup step of the workplace app, not a person talking to you. Reply with exactly the word: ready. Ask nothing and use no tools.';

/** Open a group: one setup turn on the recruiter opens the session, then the app names it and
 *  writes the first document. `onStep` narrates. */
export async function createGroup({ name, topic = '', members = [], me, onStep }) {
  const rec = await kitHarness();
  if (!rec) throw new Error('The workplace has not been launched.');
  const clean = cleanGroupName(name);
  let sid = '';
  onStep?.('Opening the room');
  const r = await streamTurn({
    harnessId: rec.id, input: `Set up the group #${clean}.`, instructions: SETUP,
    handlers: { onSession: (id) => { sid = id; } },
  });
  if (r?.connecting) throw new Error('Still connecting. Try again in a moment.');
  if (!sid) throw new Error('The room could not be opened.');
  onStep?.('Naming it');
  await settled(sid, { timeoutMs: 120000, every: 1500 });
  await patchSession(sid, { title: groupTitle({ name: clean }) }).catch(() => {});
  onStep?.('Seating the team');
  let doc = newGroupDoc({ id: sid, name: clean, topic, members, createdBy: me?.name || '' });
  doc.messages.push(systemMessage(`${me?.name || 'Someone'} created #${clean}${topic ? `: ${topic}` : ''}`));
  doc = await writeGroup(sid, doc);
  return doc;
}
