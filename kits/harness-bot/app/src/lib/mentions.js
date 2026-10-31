// @mentions, resolved by the app against the roster — never by ids a model wrote.
//
// A person types one in the composer and the editor hands back the ids it resolved. A teammate
// writes one as text (`@Atlas`) and this file finds it: the roster's handles and names, longest
// first so "@NovaLee" is not read as "@Nova" plus "Lee", case-insensitive, at a word boundary. A
// teammate cannot mention itself, and an @ that names nobody stays ordinary text.
import { handleOf } from './builder.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The items the composer's @ menu offers. `exclude` is the teammate whose own composer it is (none for a person). */
export function mentionItems(teammates, exclude = '') {
  return (teammates || []).filter((t) => t.id !== exclude).map((t) => ({
    id: t.id, name: t.name, description: t.tagline || '', kind: 'teammate', avatar: t.avatar,
  }));
}

/** Ids of the teammates a text mentions, in order of first appearance, without `selfId`. */
export function parseMentions(text, teammates, selfId = '') {
  const s = String(text || '');
  if (!s.includes('@')) return [];
  const keys = [];
  for (const t of teammates || []) {
    if (!t || t.id === selfId) continue;
    for (const k of new Set([handleOf(t.name), t.name].filter(Boolean))) keys.push({ key: k, id: t.id });
  }
  keys.sort((a, b) => b.key.length - a.key.length);
  const found = [];
  let work = s;
  for (const { key, id } of keys) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}_])@${esc(key)}(?![\\p{L}\\p{N}_])`, 'iu');
    const m = re.exec(work);
    if (!m) continue;
    // The span is blanked so a shorter key cannot match inside a longer one it is a prefix of
    // ("@Nova Lee" is one mention, not two).
    const at = m.index + m[1].length;
    work = work.slice(0, at) + ' '.repeat(key.length + 1) + work.slice(at + key.length + 1);
    if (!found.some((f) => f.id === id)) found.push({ id, at });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.id);
}

/** Whether a text mentions everybody. */
export function mentionsAll(text) {
  return /(^|[^\p{L}\p{N}_])@(everyone|all|team|channel|here)(?![\p{L}\p{N}_])/iu.test(String(text || ''));
}

/** The text with every known @handle shown as the teammate's display name, for rendering. */
export function prettyMentions(text, teammates) {
  let s = String(text || '');
  for (const t of teammates || []) {
    const h = handleOf(t.name);
    if (h && h !== t.name) s = s.replace(new RegExp(`(^|[^\\p{L}\\p{N}_])@${esc(h)}(?![\\p{L}\\p{N}_])`, 'giu'), `$1@${t.name}`);
  }
  return s;
}
