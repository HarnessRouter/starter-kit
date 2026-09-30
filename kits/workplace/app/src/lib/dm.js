// A direct message is one session on the teammate's Harness, per person, forever: its turns are
// the conversation and its memory. The first message opens it; the app then names it so the
// sidebar and the console both know what it is.
import { patchSession, sessionTurns, streamTurn, turnsToMessages } from 'reifyui/harness';
import { DM_TITLE } from './kit.js';
import { mine } from './auth.js';
import { turnInput } from './api.js';

export const dmTitle = (me) => `${DM_TITLE} · ${me?.name || 'me'}`;

/** This person's direct message with a teammate, from the card list (newest first): the oldest match. */
export function findDm(cards, botId, me) {
  const ours = (cards || []).filter((c) => c.harness_id === botId && mine(c, me) && String(c.title || '').startsWith(DM_TITLE));
  return ours.length ? ours[ours.length - 1] : null;
}

export function dmInstructions(bot, me) {
  return `[My Workplace] Direct message with ${me?.name || 'a person'}. This is your ongoing private conversation with them; your earlier turns are your memory of them, so use what they told you before. Reply as ${bot.name}, in chat size unless they ask for more. Files you save in your working directory reach them as artifacts; do not paste a whole document into the chat.`;
}

export async function loadDm(sid) {
  const turns = await sessionTurns(sid);
  return { messages: turnsToMessages(turns), turns };
}

/** One turn. `handlers` are the stream's; onSession fires with the new id on the first message. */
export function sendDm({ sid, bot, me, text, files = [], handlers = {} }) {
  return streamTurn({
    sessionId: sid, harnessId: bot.id, input: turnInput(text, files), instructions: dmInstructions(bot, me),
    handlers: {
      ...handlers,
      onSession: (id) => {
        if (!sid && id) patchSession(id, { title: dmTitle(me) }).catch(() => {});
        handlers.onSession?.(id);
      },
    },
  });
}
