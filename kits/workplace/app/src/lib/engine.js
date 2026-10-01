// The group's turn-taking, run by whichever tab holds the room.
//
// One human message starts one round: the teammates it mentions answer first, in the order
// mentioned, then everyone else in the room looks and either answers or says [skip]. A reply that
// mentions a teammate pulls that teammate in for another hop, up to MAX_HOPS from the human
// message; nobody answers themselves, and nobody answers the same message twice. Each teammate
// runs in its own session for this group and is handed only what it has not seen, so a quiet
// teammate costs one short turn and a busy one keeps its own memory of the room.
//
// The room's state is the document (groupdoc.js): who has read what, who is typing, who holds
// the round. Nothing a second tab would need lives in this tab's memory. Only one tab drives a
// group at a time: the driver holds `round` in the document and heartbeats it; another tab that
// posts meanwhile appends its message and leaves the answering to the driver, who plans again
// after every turn and so picks it up. A driver that vanishes mid-turn (the tab closed, or the
// page reloaded) releases the room after a minute of silence; the next tab that opens the group
// takes it, reads back the reply the vanished tab never wrote (the turn ran on in the teammate's
// session), and carries on with whoever still owes an answer. Before that, a refresh lost a
// finished launch plan and nobody followed it up (2026-10-01).
import { FILE_MAX, bufferToDataUrl, patchSession, streamTurn } from 'reifyui/harness';
import { handleOf } from './builder.js';
import { parseMentions } from './mentions.js';
import { appendMessage, isSkip, orphans, planPending, renderDelta, roundHeldByOther, teammateMessage, unseenFor } from './groupdoc.js';
import { changedFiles, lastText, settled, sleep, turnInput } from './api.js';

const HEARTBEAT_MS = 15000;
const TAKEOVER_WAIT_MS = 2000;   // after claiming the room, long enough for a racing claim to land
const MAX_TURNS = 40;            // per hold: a room cannot talk to itself forever
const HANDED_FILES_MAX = 12;     // files from the room carried into one turn
const SHARED_DIR = 'shared';     // where they land in the receiving teammate's working directory

/** Everyone in the room, with their role, so a teammate hands work to the one whose job it is. */
function rosterLines(doc, roster, selfId) {
  const role = (t) => [t.tagline, t.expertise?.length ? `expertise: ${t.expertise.join(', ')}` : ''].filter(Boolean).join('; ');
  return doc.members.map((id) => roster.find((t) => t.id === id)).filter((t) => t && t.id !== selfId)
    .map((t) => `- @${handleOf(t.name)}: ${role(t) || 'teammate'}`);
}

export function groupInstructions({ doc, bot, roster, me, mentioned }) {
  const others = rosterLines(doc, roster, bot.id);
  const self = [bot.tagline, bot.expertise?.length ? `expertise: ${bot.expertise.join(', ')}` : ''].filter(Boolean).join('; ');
  return [
    `[My Workplace] Group #${doc.name}${doc.topic ? ` (${doc.topic})` : ''}.`,
    `People here: ${me?.name || 'a person'}. You are @${handleOf(bot.name)}${self ? ` (${self})` : ''}.`,
    others.length ? `Teammates in this group, with their roles:\n${others.join('\n')}` : 'No other teammates are in this group.',
    'Below are the messages since you last looked, oldest first, as "Name: text".',
    mentioned ? 'You were mentioned, or the whole group was asked: answer. If the mention asks nothing of you (a thank-you, a note for your information), reply with exactly [skip] and nothing else.'
              : 'Answer only if this needs you. A request or a plan here that puts work in your role is yours even when nobody wrote your handle: do the work and post the result. Otherwise reply with exactly [skip] and nothing else.',
    'Write to the group in your own voice, in chat size. When work has to be handed out, give each piece to the teammate whose role fits it, one line each with their @handle exactly as listed, so they pick it up; do not do a teammate\'s job yourself when they are in the room, and never mention yourself. Files you save in your working directory are shared with the group automatically; the files teammates shared since you last looked are in the shared/ folder of your working directory, under the names shown.',
  ].join('\n');
}

class TakenOver extends Error { constructor() { super('Another window took over the replies.'); } }

/** Write a teammate's finished turn into the room: its reply (unless it stayed quiet or failed),
 *  its cursor, its typing mark off. The one place a turn becomes part of the document, whether
 *  this tab ran it or read it back from the session after the driver vanished. */
async function finishTurn(ctx, bot, job, { sid, rid, text, status, failed }) {
  // After every turn, not only the first: the turn's finish names the card after the message it
  // answered, and the name is what tells this session apart in the console's list.
  if (sid) await patchSession(sid, { title: `#${ctx.getDoc().name} · ${bot.name}` }).catch(() => {});
  const files = sid && !failed ? await changedFiles(sid) : [];
  const doc = ctx.getDoc();
  const reply = failed || isSkip(text) ? null
    : teammateMessage({ botId: bot.id, text, mentions: parseMentions(text, ctx.roster, bot.id), files, hop: job.hop, replyTo: job.cause, response: rid });
  const seen = doc.messages.length + (reply ? 1 : 0);
  const was = doc.bots?.[bot.id] || {};
  let next = { ...doc, typing: { ...doc.typing, [bot.id]: { at: Date.now(), on: false } },
               bots: { ...doc.bots, [bot.id]: { session: sid || was.session || '', seen: failed ? (Number(was.seen) || 0) : seen } } };
  if (reply) next = appendMessage(next, reply);
  await ctx.putDoc(next);
  ctx.onLive?.(bot.id, null);   // only once the reply is in the room: the bubble never blinks out before the message is there
  if (failed) ctx.onError?.(bot, status === 'connecting' ? 'Still connecting; try again in a moment.' : 'This turn failed.');
  return { reply, failed };
}

/** The files other teammates shared in the messages a teammate is about to read, as input
 *  blocks, so they are in its working directory when it starts, under `shared/`. Each teammate
 *  works in its own session, so without this a brief one teammate wrote was a name in the chat
 *  to the next one (2026-10-01: "in the chat but not in my working directory"). The folder keeps
 *  them apart from what the teammate makes: a copy at the top level was listed as that
 *  teammate's own artifact, and the library showed every file once per teammate. Best effort: a
 *  file that cannot be read, or is too big, is left out and stays a name. */
async function handedFiles(inbox, botId) {
  const out = [];
  for (const m of inbox) {
    if (m.from?.kind !== 'teammate' || m.from.id === botId) continue;
    for (const f of m.files || []) {
      if (out.length >= HANDED_FILES_MAX || !f?.url) break;
      if (Number(f.bytes) > FILE_MAX) continue;
      const filename = f.filename || String(f.path || '').split('/').pop();
      if (!filename || out.some((b) => b.filename === filename)) continue;
      try {
        const res = await fetch(f.url, { cache: 'no-store' });
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        if (buf.byteLength > FILE_MAX) continue;
        out.push({ type: 'input_file', filename: `${SHARED_DIR}/${filename}`, file_data: bufferToDataUrl(buf, filename, f.media_type || undefined) });
      } catch { /* left out */ }
    }
  }
  return out;
}

/** One teammate's turn on its inbox, streamed into this tab. */
async function runTurn(ctx, job) {
  const bot = ctx.roster.find((t) => t.id === job.id);
  if (!bot) return { reply: null, failed: true };
  let doc = ctx.getDoc();
  const inbox = unseenFor(doc, bot.id);
  if (!inbox.length) return { reply: null, failed: true };
  ctx.setRunning?.(bot.id);
  doc = await ctx.putDoc({ ...doc, typing: { ...doc.typing, [bot.id]: { at: Date.now(), on: true } } });

  const sid0 = doc.bots?.[bot.id]?.session || '';
  let sid = sid0, rid = '';
  const live = { text: '', steps: [], status: 'running' };
  const emit = () => ctx.onLive?.(bot.id, { ...live, steps: live.steps.slice(), session: sid });
  emit();
  const attachments = [...(job.hop === 0 ? ctx.attachmentsFor?.(job.cause) || [] : []), ...(await handedFiles(inbox, bot.id))];
  let r;
  try {
    r = await streamTurn({
      sessionId: sid0, harnessId: bot.id,
      input: turnInput(renderDelta(inbox, ctx.roster, ctx.me), attachments),
      instructions: groupInstructions({ doc, bot, roster: ctx.roster, me: ctx.me, mentioned: job.mentioned }),
      handlers: {
        // The session is written down the moment it exists: a tab that takes the room over after
        // this one vanishes finds the turn there, and another window watches it live.
        onSession: (id) => {
          if (!id || id === sid) return;
          sid = id; emit();
          const d = ctx.getDoc();
          ctx.putDoc({ ...d, bots: { ...d.bots, [bot.id]: { seen: Number(d.bots?.[bot.id]?.seen) || 0, session: id } } }).catch(() => {});
        },
        onCreated: (id) => { rid = id; },
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
    text = t.text; status = t.status || status; rid = rid || t.id || '';
  }
  // A stopped turn (a person cancelled it) is neither a reply nor a failure: nothing is posted
  // and the teammate counts the messages as seen, so no window runs the same turn again on its
  // own; a fresh mention brings the teammate back. Its partial text was posted as an answer once.
  const stopped = status === 'cancelled';
  const failed = !stopped && (status === 'connecting' || status === 'failed' || (r && r.ok === false && !text));
  ctx.setRunning?.(null);
  return finishTurn(ctx, bot, job, { sid, rid, text: stopped ? '' : text, status, failed });
}

/** A teammate marked as typing with no driver alive: its turn went on in its session. Wait for
 *  it, read what it answered, and write that into the room as if the driver had stayed. */
async function harvestTurn(ctx, { id, session }) {
  const bot = ctx.roster.find((t) => t.id === id);
  const clear = async () => { const d = ctx.getDoc(); await ctx.putDoc({ ...d, typing: { ...d.typing, [id]: { at: Date.now(), on: false } } }); ctx.onLive?.(id, null); };
  if (!bot || !session) { await clear(); return { reply: null, failed: false }; }   // nothing to read back; planned again if it still owes a turn
  ctx.onLive?.(bot.id, { text: '', steps: [], status: 'running', session, external: true });
  ctx.setRunning?.(bot.id);
  await settled(session);
  ctx.setRunning?.(null);
  const t = await lastText(session).catch(() => null);
  const doc = ctx.getDoc();
  const want = renderDelta(unseenFor(doc, bot.id), ctx.roster, ctx.me).trim();
  const asked = String(t?.user || '').trim();
  const ours = !!t && !!asked && (asked === want || want.startsWith(`${asked}\n\n`));
  // Not this inbox (the turn never started, or the session's last turn is an older one), or a
  // reply the vanished tab did write just before it went: nothing to add.
  if (!ours || (t.id && doc.messages.some((m) => m.response === t.id))) { await clear(); return { reply: null, failed: false }; }
  const job = planPending(doc, ctx.roster).find((j) => j.id === bot.id) || { hop: 0, cause: '' };
  const stopped = t.status === 'cancelled';
  const failed = !stopped && t.status !== 'completed' && !t.text;
  return finishTurn(ctx, bot, job, { sid: session, rid: t.id, text: stopped ? '' : t.text, status: t.status, failed });
}

/** Drive the room until nobody owes it a turn: claim it, read back any turn whose driver
 *  vanished, then run whoever is planned, re-planning after every turn (a reply's mentions and
 *  messages posted meanwhile are seen that way). Returns 'held' when another tab is driving. */
export async function driveRoom(ctx) {
  const { tabId } = ctx;
  if (roundHeldByOther(ctx.getDoc(), tabId)) return 'held';
  const hold = () => ({ by: tabId, at: Date.now() });
  let running = null;   // the teammate whose turn is in flight: its typing mark is kept fresh with the claim
  // Every write this driver makes carries its claim, and none goes out once a fresher claim by
  // another tab has reached this one (the poll merges the newest claim in).
  const put = async (d) => {
    if (roundHeldByOther(ctx.getDoc(), tabId)) throw new TakenOver();
    const typing = running ? { ...d.typing, [running]: { at: Date.now(), on: true } } : d.typing;
    return ctx.putDoc({ ...d, typing, round: hold() });
  };
  await put(ctx.getDoc());
  await sleep(TAKEOVER_WAIT_MS);
  const now = await ctx.refresh?.();
  if (now && roundHeldByOther(now, tabId)) return 'held';
  const hb = setInterval(() => { put(ctx.getDoc()).catch(() => {}); }, HEARTBEAT_MS);
  const dctx = { ...ctx, putDoc: put, setRunning: (id) => { running = id; } };
  const tried = new Set();
  try {
    for (let n = 0; n < MAX_TURNS; n += 1) {
      const doc = ctx.getDoc();
      const orphan = orphans(doc).find((o) => !tried.has(`o:${o.id}`));
      if (orphan) { tried.add(`o:${orphan.id}`); await harvestTurn(dctx, orphan); continue; }
      const job = planPending(doc, ctx.roster).find((j) => !tried.has(j.id));
      if (!job) break;
      const { failed } = await runTurn(dctx, job);
      if (failed) tried.add(job.id);   // not again in this hold; the next message or the next open retries it
    }
  } catch (e) {
    if (!(e instanceof TakenOver)) throw e;
  } finally {
    clearInterval(hb);
    if (!roundHeldByOther(ctx.getDoc(), tabId)) await ctx.putDoc({ ...ctx.getDoc(), round: { by: '', at: Date.now() } }).catch(() => {});
  }
  return 'done';
}
