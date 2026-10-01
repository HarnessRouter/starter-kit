// A group, as a document: its roster, its transcript, and where each teammate has read to.
//
// The whole thing is one JSON file in the group session's workspace, written by whichever tab is
// driving. There is no server merge, so every write is read-merge-write here, and the merge is
// defined so that two tabs racing lose nothing that was appended: messages union by id, cursors
// take the furthest, sessions take whichever exists. Nothing in here talks to the network.
import { GROUP_PREFIX, MAX_HOPS, SKIP } from './kit.js';
import { mentionsAll } from './mentions.js';

export const DOC_VERSION = 1;
const ROUND_STALE_MS = 60 * 1000;     // a driver that has not heart-beaten for this long is gone
const TYPING_STALE_MS = 3 * 60 * 1000;

export function newId(prefix = 'm') {
  const r = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${r}`;
}

export function newGroupDoc({ id, name, topic = '', members = [], createdBy = '' }) {
  return {
    v: DOC_VERSION, id, name: cleanGroupName(name), topic: String(topic || '').trim().slice(0, 200),
    members: [...new Set(members)], createdBy, createdAt: Date.now(),
    messages: [], bots: {}, typing: {}, round: null, rev: 0,
  };
}

/** "#Design Review" -> "design-review": one word, safe in a title and a URL. */
export function cleanGroupName(s) {
  const n = String(s || '').trim().replace(/^#+/, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return n.slice(0, 40) || 'group';
}

export const groupTitle = (doc) => `${GROUP_PREFIX}${doc.name}`;

export function isGroupTitle(title) {
  return String(title || '').startsWith(GROUP_PREFIX);
}

/** Read a stored document, or null when it is not one of ours. */
export function coerceDoc(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.messages) || typeof raw.name !== 'string') return null;
  return {
    v: DOC_VERSION, id: String(raw.id || ''), name: raw.name, topic: String(raw.topic || ''),
    members: Array.isArray(raw.members) ? raw.members.map(String) : [],
    createdBy: String(raw.createdBy || ''), createdAt: Number(raw.createdAt) || 0,
    messages: raw.messages.filter((m) => m && typeof m === 'object' && m.id),
    bots: raw.bots && typeof raw.bots === 'object' ? raw.bots : {},
    typing: raw.typing && typeof raw.typing === 'object' ? raw.typing : {},
    round: raw.round && typeof raw.round === 'object' ? raw.round : null,
    rev: Number(raw.rev) || 0,
  };
}

/** The union of two versions of the same document. Order is by time, then by the order seen. */
export function mergeDoc(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const byId = new Map();
  for (const m of [...remote.messages, ...local.messages]) if (!byId.has(m.id)) byId.set(m.id, m);
  const messages = [...byId.values()].sort((a, b) => (a.at - b.at) || String(a.id).localeCompare(String(b.id)));
  const bots = {};
  for (const id of new Set([...Object.keys(remote.bots), ...Object.keys(local.bots)])) {
    const a = remote.bots[id] || {}, b = local.bots[id] || {};
    bots[id] = { session: b.session || a.session || '', seen: Math.max(Number(a.seen) || 0, Number(b.seen) || 0) };
  }
  const newer = local.rev >= remote.rev ? local : remote;
  // Typing marks and the round lock are timestamped: per key, the newest write wins, so a tab
  // that cleared one (a newer `on: false`) is not overruled by a stale copy on the other side.
  const typing = {};
  for (const id of new Set([...Object.keys(remote.typing || {}), ...Object.keys(local.typing || {})])) {
    const a = remote.typing?.[id], b = local.typing?.[id];
    typing[id] = !a ? b : !b ? a : (Number(b.at) >= Number(a.at) ? b : a);
  }
  const round = !local.round ? remote.round : !remote.round ? local.round
    : (Number(local.round.at) >= Number(remote.round.at) ? local.round : remote.round);
  return {
    ...newer, messages, bots,
    members: newer.members, name: newer.name, topic: newer.topic,
    typing, round: round || null,
    rev: Math.max(local.rev, remote.rev) + 1,
  };
}

export function humanMessage({ me, text, mentions = [], attachments = [] }) {
  return {
    id: newId('m'), at: Date.now(),
    from: { kind: 'member', id: me?.id || '', name: me?.name || 'You' },
    text: String(text || ''), mentions: [...new Set(mentions)],
    ...(attachments.length ? { attachments: attachments.map((a) => ({ name: a.name, bytes: a.bytes })) } : {}),
  };
}

export function teammateMessage({ botId, text, mentions = [], files = [], hop = 0, replyTo = '', response = '' }) {
  return {
    id: newId('m'), at: Date.now(),
    from: { kind: 'teammate', id: botId },
    text: String(text || ''), mentions: [...new Set(mentions)], hop,
    ...(replyTo ? { replyTo } : {}), ...(files.length ? { files } : {}), ...(response ? { response } : {}),
  };
}

export function systemMessage(text) {
  return { id: newId('s'), at: Date.now(), from: { kind: 'system', id: 'system' }, text: String(text || ''), mentions: [] };
}

export const appendMessage = (doc, msg) => ({ ...doc, messages: [...doc.messages, msg] });

/** The messages a teammate has not seen, oldest first. */
export function unseenFor(doc, botId) {
  const seen = Number(doc.bots?.[botId]?.seen) || 0;
  return doc.messages.slice(seen);
}

/** A teammate's inbox as text: `Name: text`, one message per line block. */
export function renderDelta(messages, roster, me) {
  return messages.map((m) => {
    const who = m.from.kind === 'teammate' ? (roster.find((t) => t.id === m.from.id)?.name || 'Teammate')
      : m.from.kind === 'system' ? '(system)' : (m.from.name || me?.name || 'Someone');
    const files = (m.files || []).map((f) => f.path || f.filename).filter(Boolean);
    const att = (m.attachments || []).map((a) => a.name).filter(Boolean);
    const extra = [...files.map((f) => `[file: ${f}]`), ...att.map((a) => `[attached: ${a}]`)].join(' ');
    return `${who}: ${m.text}${extra ? `\n${extra}` : ''}`;
  }).join('\n\n');
}

/** Who still owes the room a turn, in the order they take it. A teammate owes one when a
 *  person wrote something it has not seen (everyone looks; the mentioned answer first, in the
 *  order mentioned, then the rest of the room judge), or when another teammate's reply mentioned
 *  it (a follow-up, one hop further from the person's message, up to MAX_HOPS). Read from the
 *  document alone: a teammate's `seen` cursor is its memory of the room, so whichever tab holds
 *  the room continues exactly where the last one stopped, with nothing kept in a tab. */
export function planPending(doc, roster) {
  const members = doc.members.filter((id) => roster.some((t) => t.id === id));
  const jobs = new Map();
  doc.messages.forEach((m, idx) => {
    if (!m || !m.from || m.from.kind === 'system') return;
    const human = m.from.kind === 'member';
    const all = human && mentionsAll(m.text);
    for (const id of members) {
      if (idx < (Number(doc.bots?.[id]?.seen) || 0)) continue;    // already in its past
      const named = m.from.id !== id && (m.mentions || []).includes(id);
      let j = jobs.get(id);
      if (human) {
        if (!j) j = { id, hop: 0, mentioned: false, cause: m.id, rank: 2, order: Infinity };
        else { j.hop = 0; j.cause = m.id; }
        if (named || all) { j.mentioned = true; j.rank = Math.min(j.rank, named ? 0 : 1); }
        if (named) j.order = Math.min(j.order, idx * 1000 + m.mentions.indexOf(id));
      } else if (named && (m.hop ?? 0) < MAX_HOPS) {
        if (!j) j = { id, hop: (m.hop ?? 0) + 1, mentioned: true, cause: m.id, rank: 1, order: idx * 1000 };
        else if (!j.mentioned) { j.mentioned = true; j.rank = 1; j.cause = m.id; j.order = idx * 1000; }
      } else continue;
      jobs.set(id, j);
    }
  });
  const pos = (id) => members.indexOf(id);
  return [...jobs.values()]
    .sort((a, b) => a.rank - b.rank || a.order - b.order || pos(a.id) - pos(b.id))
    .map(({ id, hop, mentioned, cause }) => ({ id, hop, mentioned, cause }));
}

export function isSkip(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  return t.toLowerCase() === SKIP || /^\[?skip\]?\.?$/i.test(t);
}

/** The typing indicators still worth showing. */
export function liveTyping(doc, now = Date.now()) {
  return Object.entries(doc.typing || {}).filter(([, v]) => v && v.on && now - Number(v.at) < TYPING_STALE_MS).map(([id]) => id);
}

/** Whether another tab is driving this group's replies right now. */
export function roundHeldByOther(doc, tabId, now = Date.now()) {
  const r = doc.round;
  return !!(r && r.by && r.by !== tabId && now - Number(r.at) < ROUND_STALE_MS);
}

/** Teammates marked as typing: while a tab drives the room that is the one it is running; with
 *  no live driver it is a turn whose driver vanished, still running (or finished) in the
 *  teammate's session, and the next driver reads it back from there. */
export function orphans(doc) {
  return Object.entries(doc.typing || {}).filter(([, v]) => v && v.on).map(([id]) => ({ id, session: doc.bots?.[id]?.session || '' }));
}

/** Whether this tab should take the room: nobody alive is driving, and there is work. */
export function needsDriver(doc, roster, tabId, now = Date.now()) {
  if (!doc || roundHeldByOther(doc, tabId, now)) return false;
  return orphans(doc).length > 0 || planPending(doc, roster).length > 0;
}
