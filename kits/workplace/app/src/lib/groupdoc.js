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

/** Who answers a human message, in what order: the mentioned, in the order mentioned, then the rest of the room. */
export function planRound(doc, msg, roster) {
  const members = doc.members.filter((id) => roster.some((t) => t.id === id));
  const all = mentionsAll(msg.text);
  const mentioned = (msg.mentions || []).filter((id) => members.includes(id));
  const rest = members.filter((id) => !mentioned.includes(id));
  return [
    ...mentioned.map((id) => ({ id, hop: 0, mentioned: true, cause: msg.id })),
    ...rest.map((id) => ({ id, hop: 0, mentioned: all, cause: msg.id })),
  ];
}

/** After a teammate's reply: who it pulled in, if the chain may continue. */
export function planFollowUps(doc, reply, queue, done) {
  if ((reply.hop ?? 0) >= MAX_HOPS) return [];
  const out = [];
  for (const id of reply.mentions || []) {
    if (id === reply.from.id || !doc.members.includes(id)) continue;
    const key = `${reply.id}:${id}`;
    if (done.has(key) || queue.some((q) => q.id === id && q.cause === reply.id)) continue;
    out.push({ id, hop: (reply.hop ?? 0) + 1, mentioned: true, cause: reply.id });
  }
  return out;
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

/** Human messages the round should still answer: those after the round began that no teammate has seen. */
export function pendingHuman(doc, sinceId) {
  const i = doc.messages.findIndex((m) => m.id === sinceId);
  return doc.messages.slice(i + 1).filter((m) => m.from.kind === 'member');
}
