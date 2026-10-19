// What a finished agent turn puts in its cell — pure, so it can be pinned without a server.
//
// A turn's output is a sequence of items: messages, reasoning, and the tool steps between them
// (function_call, function_call_output, or any other item that is not a message). An agent that
// looks something up first says so — "Checking the official docs, then I'll answer" — and that
// line is a message item of its own, written BEFORE the tool step. Joining every message of the
// turn put that narration in front of the answer in the cell (staging, 2026-10-19). A cell holds
// the answer and nothing else.
//
// So the cell's text is the assistant's text AFTER its last tool step: the final reply. Words said
// before a tool step are never the answer, even when nothing follows the step: a turn cut off at
// its step cap mid-research ends on a tool step, and its last words are the narration. Such a turn
// has no answer, and the cell says so (lib/cell.js) rather than showing the narration as one.
// Reasoning items sit between messages without being steps, so they never split a reply.

/** The text of one message item. */
function messageText(item) {
  const parts = [];
  for (const c of item?.content || []) if (c?.type === 'output_text' && c.text) parts.push(c.text);
  return parts.join('\n').trim();
}

/**
 * The final answer of a finished response: the assistant text after its last tool step, '' when
 * the turn said nothing after it. Messages after that step (the reply, and any closing paragraph
 * the platform adds about files) are joined with a newline, as the whole turn's were before.
 */
export function finalAnswer(response) {
  let reply = [];
  for (const item of response?.output || []) {
    const type = item?.type;
    if (type === 'message') {
      const t = messageText(item);
      if (t) reply.push(t);
    } else if (type !== 'reasoning') {
      reply = [];   // a tool step: whatever was said before it was not the final word
    }
  }
  return reply.join('\n').trim();
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

/** The cell's value from a finished response: its final answer, with tracking removed from links. */
export function cellAnswer(response) {
  return stripTracking(finalAnswer(response));
}
