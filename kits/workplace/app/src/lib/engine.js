// The group's turn-taking, run by the tab that posted the message.
//
// One human message starts one round: the teammates it mentions answer first, in the order
// mentioned, then everyone else in the room looks and either answers or says [skip]. A reply that
// mentions a teammate pulls that teammate in for another hop, up to MAX_HOPS from the human
// message; nobody answers themselves, and nobody answers the same message twice. Each teammate
// runs in its own session for this group and is handed only what it has not seen, so a quiet
// teammate costs one short turn and a busy one keeps its own memory of the room.
//
// Only one tab drives a group at a time: the driver holds `round` in the document and heartbeats
// it; another tab that posts meanwhile appends its message and leaves the answering to the driver,
// who picks up whatever arrived once its queue is empty. A driver that vanishes releases the
// room after a minute of silence.
import { patchSession, streamTurn } from 'reifyui/harness';
import { handleOf } from './builder.js';
import { parseMentions } from './mentions.js';
import { appendMessage, isSkip, pendingHuman, planFollowUps, planRound, renderDelta, roundHeldByOther, teammateMessage, unseenFor } from './groupdoc.js';
import { changedFiles, lastText, settled, turnInput } from './api.js';

const HEARTBEAT_MS = 15000;

export function groupInstructions({ doc, bot, roster, me, mentioned }) {
  const others = doc.members.map((id) => roster.find((t) => t.id === id)).filter((t) => t && t.id !== bot.id);
  const line = (t) => `@${handleOf(t.name)}${t.tagline ? ` (${t.tagline})` : ''}`;
  return [
    `[My Workplace] Group #${doc.name}${doc.topic ? ` (${doc.topic})` : ''}.`,
    `People here: ${me?.name || 'a person'}. You are @${handleOf(bot.name)}.` + (others.length ? ` Teammates: ${others.map(line).join(', ')}.` : ' No other teammates are in this group.'),
    'Below are the messages since you last looked, oldest first, as "Name: text".',
    mentioned ? 'You were mentioned, or the whole group was asked: answer.'
              : `Answer only if this needs you; otherwise reply with exactly [skip] and nothing else.`,
    'Write to the group in your own voice, in chat size. To ask a teammate for something write their @handle exactly as listed; never mention yourself. Files you save in your working directory are shared with the group automatically.',
  ].join('\n');
}

/** One teammate's turn on its inbox. Returns the reply message, or null when it stayed quiet. */
async function runTurn(ctx, job) {
  const bot = ctx.roster.find((t) => t.id === job.id);
  if (!bot) return null;
  let doc = ctx.getDoc();
  const inbox = unseenFor(doc, bot.id);
  if (!inbox.length) return null;
  doc = await ctx.putDoc({ ...doc, typing: { ...doc.typing, [bot.id]: { at: Date.now(), on: true } } });

  const sid0 = doc.bots?.[bot.id]?.session || '';
  let sid = sid0, rid = '';
  const live = { text: '', steps: [], status: 'running' };
  ctx.onLive?.(bot.id, { ...live, session: sid });
  const emit = () => ctx.onLive?.(bot.id, { ...live, steps: live.steps.slice(), session: sid });
  const attachments = job.hop === 0 ? ctx.attachmentsFor?.(job.cause) || [] : [];
  let r;
  try {
    r = await streamTurn({
      sessionId: sid0, harnessId: bot.id,
      input: turnInput(renderDelta(inbox, ctx.roster, ctx.me), attachments),
      instructions: groupInstructions({ doc, bot, roster: ctx.roster, me: ctx.me, mentioned: job.mentioned }),
      handlers: {
        onSession: (id) => { sid = id; emit(); },
        onId: (id) => { rid = id; },
        onTextDelta: (t) => { live.text += t; emit(); },
        onToolCall: (name, args, callId) => { live.steps.push({ name, args, callId }); emit(); },
        onToolResult: (callId, output) => { const s = live.steps.find((x) => x.callId === callId); if (s) { s.result = output; emit(); } },
        onDone: (status) => { live.status = status || 'done'; emit(); },
      },
    });
  } catch (e) {
    r = { ok: false, error: e };
  }
  let text = live.text, status = live.status;
  if (r?.connecting) { status = 'connecting'; }
  else if (r?.dropped || (!text && sid)) {
    // The turn ran without this stream (a dropped stream, or an answer the stream did not carry):
    // wait for it and read what the session says it answered.
    await settled(sid);
    const t = await lastText(sid).catch(() => ({ text: '', status: '' }));
    text = t.text; status = t.status || status;
  }
  // After every turn, not only the first: the turn's finish names the card after the message it
  // answered, and the name is what tells this session apart in the console's list.
  if (sid) await patchSession(sid, { title: `#${doc.name} · ${bot.name}` }).catch(() => {});
  const files = sid ? await changedFiles(sid) : [];
  ctx.onLive?.(bot.id, null);

  doc = ctx.getDoc();
  const failed = status === 'connecting' || status === 'failed' || (r && r.ok === false && !text);
  const reply = failed || isSkip(text) ? null
    : teammateMessage({ botId: bot.id, text, mentions: parseMentions(text, ctx.roster, bot.id), files, hop: job.hop, replyTo: job.cause, response: rid });
  const seen = doc.messages.length + (reply ? 1 : 0);
  let next = { ...doc, typing: { ...doc.typing, [bot.id]: { at: Date.now(), on: false } },
               bots: { ...doc.bots, [bot.id]: { session: sid, seen: failed ? (doc.bots?.[bot.id]?.seen || 0) : seen } } };
  if (reply) next = appendMessage(next, reply);
  await ctx.putDoc(next);
  if (failed) ctx.onError?.(bot, status === 'connecting' ? 'Still connecting; try again in a moment.' : 'This turn failed.');
  return reply;
}

/** Answer one human message, and whatever arrives while answering it. */
export async function runRound(ctx, humanMsg) {
  const first = ctx.getDoc();
  if (roundHeldByOther(first, ctx.tabId)) return;   // another tab is driving; it will see the message
  const hold = () => ({ by: ctx.tabId, at: Date.now(), since: humanMsg.id });
  await ctx.putDoc({ ...ctx.getDoc(), round: hold() });
  const hb = setInterval(() => { ctx.putDoc({ ...ctx.getDoc(), round: hold() }).catch(() => {}); }, HEARTBEAT_MS);
  try {
    let msg = humanMsg;
    for (let rounds = 0; msg && rounds < 20; rounds += 1) {
      const queue = planRound(ctx.getDoc(), msg, ctx.roster);
      const done = new Set();
      while (queue.length) {
        const job = queue.shift();
        const key = `${job.cause}:${job.id}`;
        if (done.has(key)) continue;
        done.add(key);
        const reply = await runTurn(ctx, job);
        if (reply) queue.push(...planFollowUps(ctx.getDoc(), reply, queue, done));
      }
      // Human messages that arrived meanwhile: one more round, planned on all of them together
      // (every teammate's inbox already carries them; only the mention routing needs the union).
      const later = pendingHuman(ctx.getDoc(), msg.id);
      msg = later.length ? { id: later[later.length - 1].id, text: later.map((m) => m.text).join('\n'),
                             mentions: [...new Set(later.flatMap((m) => m.mentions || []))] } : null;
    }
  } finally {
    clearInterval(hb);
    await ctx.putDoc({ ...ctx.getDoc(), round: { by: '', at: Date.now() } }).catch(() => {});
  }
}
