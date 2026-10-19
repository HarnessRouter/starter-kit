// What a finished agent turn puts in its cell — pure, so it can be pinned without a server.
//
// A turn's output is a sequence of items: messages, reasoning, and the tool steps between them
// (function_call, function_call_output, or any other item that is not a message). An agent that
// looks something up first says so — "Checking the official docs, then I'll answer" — and that
// line is a message item of its own, written BEFORE the tool step. Joining every message of the
// turn put that narration in front of the answer in the cell (staging, 2026-10-19). A cell holds
// the answer and nothing else.
//
// The rule: the cell is the LAST assistant text of the turn, wherever the tool steps fall. Usually
// that is the reply after the last tool step; for an agent that answers and then saves or checks
// something, it is the answer before that final step. A turn with no assistant text at all has
// no answer, and the cell says so (lib/cell.js).
//
// One read cannot tell those two apart from a record read too early: a record that ends on a tool
// step may be a turn that answered and then validated, or a turn whose reply has not been written
// yet (a terminal status arrives about two seconds before the output, see SETTLE_MS in cell.js).
// So such a record is not settled: settledAnswer() reads it as empty, the dispatcher waits for a
// reply to follow, and only when none does it takes cellAnswer(), the last text there is.

/** The text of one message item. */
function messageText(item) {
  const parts = [];
  for (const c of item?.content || []) if (c?.type === 'output_text' && c.text) parts.push(c.text);
  return parts.join('\n').trim();
}

const isToolStep = (item) => item?.type !== 'message' && item?.type !== 'reasoning';

/**
 * The last assistant text of a response: the last message with text, together with the messages
 * just before it back to the previous tool step (a reply and the closing paragraph the platform
 * adds after it about files, say). Reasoning between messages does not separate them. '' when the
 * turn said nothing.
 */
export function lastAssistantText(response) {
  const items = response?.output || [];
  let end = items.length - 1;
  while (end >= 0 && !(items[end]?.type === 'message' && messageText(items[end]))) end -= 1;
  if (end < 0) return '';
  const run = [];
  for (let i = end; i >= 0 && !isToolStep(items[i]); i -= 1) {
    if (items[i]?.type === 'message') {
      const t = messageText(items[i]);
      if (t) run.unshift(t);
    }
  }
  return run.join('\n').trim();
}

/** Does the record end on a tool step, so that a reply may still be written after it? */
export function endsOnToolStep(response) {
  const items = response?.output || [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i]?.type === 'reasoning') continue;
    return isToolStep(items[i]);
  }
  return false;
}

// Query parameters that only tell the linked site who sent the visit. Removing them never changes
// the page a link opens: utm_* (which search tools add, e.g. utm_source=openai) and the ad-click
// ids of the large networks.
const TRACKING = /^(utm_[a-z0-9_]*|gclid|dclid|gbraid|wbraid|fbclid|msclkid|yclid|igshid|mc_cid|mc_eid|_hsenc|_hsmi|srsltid)$/i;

// A URL as it sits in prose or Markdown: up to whitespace, a quote, an angle bracket, or the
// closing ) or ] of a Markdown link.
const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi;

/** `text` with tracking parameters removed from every link in it. Everything else is unchanged. */
export function stripTracking(text) {
  return String(text ?? '').replace(URL_RE, (match) => {
    // Sentence punctuation directly after a link is the sentence's, not the link's.
    const tail = /[.,;:!?]+$/.exec(match)?.[0] || '';
    const url = tail ? match.slice(0, -tail.length) : match;
    const q = url.indexOf('?');
    if (q < 0) return match;
    const h = url.indexOf('#', q);
    const query = url.slice(q + 1, h < 0 ? undefined : h);
    const hash = h < 0 ? '' : url.slice(h);
    const pairs = query.split('&').filter(Boolean);
    const kept = pairs.filter((kv) => !TRACKING.test(kv.split('=')[0]));
    if (kept.length === pairs.length) return match;
    return url.slice(0, q) + (kept.length ? `?${kept.join('&')}` : '') + hash + tail;
  });
}

/** The cell's value: the turn's last assistant text, with tracking removed from its links. */
export function cellAnswer(response) {
  return stripTracking(lastAssistantText(response));
}

/** The cell's value from a record that has settled, '' from one that may still be writing its
 *  reply (it ends on a tool step). The dispatcher waits on '' before concluding anything. */
export function settledAnswer(response) {
  return endsOnToolStep(response) ? '' : cellAnswer(response);
}

// An inline Markdown link: [text](address), the address allowed one level of balanced parentheses
// (Wikipedia's "Rust_(programming_language)").
const MD_LINK = /\[([^[\]\n]+)\]\(((?:[^\s()<>]|\([^\s()<>]*\))+)\)/g;

/** A cell's value as the grid draws it: text parts, and a link part for each inline Markdown link
 *  whose address is http or https, named by the link's own text. The value itself is unchanged
 *  (it keeps its citations, and the export carries them as written); this is only how it reads.
 *  Any other address (javascript:, mailto:, a relative path) stays text, exactly as written. */
export function linkParts(value) {
  const text = String(value ?? '');
  const parts = [];
  let at = 0;
  for (const m of text.matchAll(MD_LINK)) {
    let href = '';
    try {
      const u = new URL(m[2]);
      if (u.protocol === 'http:' || u.protocol === 'https:') href = m[2];
    } catch { /* not an address: stays text */ }
    if (!href) continue;
    if (m.index > at) parts.push({ text: text.slice(at, m.index) });
    parts.push({ text: m[1], href });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}
