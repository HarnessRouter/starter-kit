// What a teammate's turn says to the group — pure, so it can be pinned without a server.
//
// A turn's output is a sequence of items: messages, reasoning, and the tool steps between them. A
// teammate that looks something up first says so ("Let me check the site"), and that line is a
// message of its own, written before the tool step. The room used to get every text fragment of
// the turn run together, with no space between them, so the narration led the message. The group
// gets the teammate's LAST assistant text of the turn, wherever its tool steps fall: usually the
// reply after the last step, or the answer it gave before a final save.

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

/** Does this response carry its output items? A terminal event or a stored record does; it is
 *  the authority on what the turn said, over the text deltas a stream happened to deliver. */
export const hasOutput = (response) => Array.isArray(response?.output) && response.output.length > 0;
