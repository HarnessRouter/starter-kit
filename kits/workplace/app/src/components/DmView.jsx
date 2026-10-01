// A direct message: one person, one teammate, one session that is the whole history. The first
// message opens the session; everything after is a turn on it. While a turn runs the teammate's
// tools show inside its bubble, and its screen, if it opens one, in the panel.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu, MoreHorizontal, PanelRight } from 'lucide-react';
import { Popover, useDialog, withReasoning, withResult, withStep, withText } from 'reifyui';
import { sessionTurns, turnsToMessages, containerFileUrl } from 'reifyui/harness';
import { useWorkplace } from '../App.jsx';
import { Avatar } from '../lib/avatars.jsx';
import { isLive } from '../lib/api.js';
import { findDm, sendDm } from '../lib/dm.js';
import { removeTeammate } from '../lib/teammates.js';
import Composer from './Composer.jsx';
import Rail, { useRail } from './Rail.jsx';
import { Bubble, withTimeLabels } from './Message.jsx';
import { useFileOverlay } from './Files.jsx';

const POLL_MS = 3000;

function turnTime(t) {
  const raw = t?.created_at ?? t?._created_at ?? t?.created ?? t?.started_at ?? t?.at;
  if (raw == null || raw === '' || raw === 0) return 0;
  const n = typeof raw === 'number' ? (raw < 1e12 ? raw * 1000 : raw) : Number(new Date(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function turnFiles(t, sid) {
  return (t?.files || []).filter((f) => f && f.file_id).map((f) => ({
    path: f.filename || '', filename: f.filename || 'file', file_id: f.file_id, container_id: f.container_id || sid,
    bytes: null, media_type: f.media_type || '', url: containerFileUrl(f.container_id || sid, f.file_id),
  }));
}

export default function DmView({ teammate }) {
  const wp = useWorkplace();
  const { me, cards, teammates, navigate, markLive, markSeen, refreshCards, refreshTeammates, openDrawer } = wp;
  const dialog = useDialog();
  const card = findDm(cards, teammate.id, me);
  const [sid, setSid] = useState(card?.id || '');
  const [turns, setTurns] = useState(null);
  const [live, setLive] = useState(null);
  const [pendingText, setPendingText] = useState('');
  const [railOpen, setRailOpen] = useRail();
  const [menuOpen, setMenuOpen] = useState(false);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  const menuRef = useRef(null);
  const bodyRef = useRef(null);
  const files = useFileOverlay();

  useEffect(() => { if (!sid && card?.id) setSid(card.id); }, [card?.id, sid]);
  const externalBusy = !!(card && isLive(card)) && !live;
  const busy = !!live || externalBusy;

  const load = useCallback(async () => {
    if (!sid) { setTurns([]); return; }
    try { setTurns(await sessionTurns(sid)); } catch { setTurns((t) => t || []); }
  }, [sid]);
  useEffect(() => { setTurns(null); load(); }, [load]);
  // The conversation is read from the server while this room is open, not only while this tab
  // believes a turn is running: a message sent from another window (another machine, the same
  // login) is a turn on the same session, listed with its text and its tool rows while it runs,
  // and this window showed it only after its own six-second card poll noticed the teammate was
  // busy (2026-10-01). While this tab streams the turn itself the stream is the source.
  useEffect(() => {
    if (live) return undefined;
    const poll = () => { if (!document.hidden) load(); };
    const id = window.setInterval(poll, POLL_MS);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [live, load]);
  const wasBusy = useRef(false);
  useEffect(() => { if (wasBusy.current && !busy) { load(); setTick((n) => n + 1); } wasBusy.current = busy; }, [busy, load]);

  const marker = card ? (card.last_response_id || card.finished_at || card.id) : '';
  useEffect(() => { markSeen(`dm:${teammate.id}`, marker); }, [marker, teammate.id, markSeen]);

  const send = useCallback(async ({ text, files: blocks }) => {
    setErr('');
    setPendingText(text || (blocks.length ? `(${blocks.length} file${blocks.length > 1 ? 's' : ''})` : ''));
    setLive({ blocks: [], status: 'running' });
    markLive(teammate.id, true);
    let started = sid;
    try {
      const r = await sendDm({
        sid, bot: teammate, me, text, files: blocks,
        handlers: {
          onSession: (id) => { started = id; setSid((s) => s || id); },
          onTextDelta: (d) => setLive((l) => l && ({ ...l, blocks: withText(l.blocks, d) })),
          onReasoningDelta: (d) => setLive((l) => l && ({ ...l, blocks: withReasoning(l.blocks, d) })),
          onToolCall: (name, args, callId) => setLive((l) => l && ({ ...l, blocks: withStep(l.blocks, { name, args, callId }) })),
          onToolResult: (callId, output) => setLive((l) => l && ({ ...l, blocks: withResult(l.blocks, callId, output) })),
          onError: (m) => setErr(String(m || 'This turn failed.')),
        },
      });
      if (r?.connecting) setErr('Still connecting. Send it again in a moment.');
    } catch (e) {
      setErr(e?.message || 'This turn failed.');
    } finally {
      markLive(teammate.id, false);
      setLive(null);
      setPendingText('');
      if (started) await load();
      refreshCards();
      setTick((n) => n + 1);
    }
  }, [sid, teammate, me, markLive, load, refreshCards]);

  const remove = async () => {
    setMenuOpen(false);
    const ok = await dialog.confirm({ title: `Remove ${teammate.name}?`, message: 'Their conversations and files go with them. This cannot be undone.', destructive: true, confirmLabel: 'Remove' });
    if (!ok) return;
    try { await removeTeammate(teammate.id); await refreshTeammates(); navigate('', true); }
    catch (e) { dialog.alert({ title: 'Could not remove', message: e?.message || 'Try again.' }); }
  };

  const them = { kind: 'teammate', id: teammate.id, name: teammate.name, avatar: teammate.avatar };
  const mine = { kind: 'me', name: me?.name };
  const rows = useMemo(() => {
    const items = [];
    let prev = '';
    const add = (at, key, from, props) => { const first = prev !== from.kind; prev = from.kind; items.push({ at, node: <Bubble key={key} from={from} first={first} teammates={teammates} onMention={(id) => navigate(`dm/${id}`)} onOpenFile={files.open} {...props} /> }); };
    for (const [i, t] of (turns || []).entries()) {
      const at = turnTime(t);
      if (t.user) add(at, `u${i}`, mine, { text: t.user, attachments: (t.user_files || []).map((f) => ({ name: f.name })) });
      for (const m of turnsToMessages([t]).filter((x) => x.role === 'assistant')) {
        const running = m.status === 'running' && !(live && i === turns.length - 1);
        add(at, `a${i}`, them, { turn: running ? m : { ...m, status: m.status === 'running' ? 'done' : m.status }, files: turnFiles(t, sid) });
      }
    }
    if (pendingText && !(turns || []).some((t) => String(t.user || '') === pendingText)) add(Date.now(), 'pending', mine, { text: pendingText });
    if (live) add(Date.now(), 'live', them, { turn: live });
    return withTimeLabels(items, (it) => it.node.key);
  }, [turns, live, pendingText, me, teammate, teammates, sid, navigate, files.open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const el = bodyRef.current; if (el) el.scrollTop = el.scrollHeight; }, [rows.length, live?.blocks?.length]);

  return (
    <div className="wp-room">
      <div className="wp-conv">
        <header className="wp-head">
          <button type="button" className="wp-iconbtn wp-menubtn" onClick={openDrawer} aria-label="Rooms"><Menu size={20} /></button>
          <Avatar avatar={teammate.avatar} id={teammate.id} size={24} working={busy} />
          <div className="wp-head-titles">
            <h1 className="wp-head-title">{teammate.name}</h1>
            <div className="wp-head-sub">{busy ? 'working…' : teammate.tagline || 'Teammate'}</div>
          </div>
          <div className="wp-head-acts">
            <button type="button" ref={menuRef} className="wp-iconbtn" onClick={() => setMenuOpen((o) => !o)} aria-label="More" aria-expanded={menuOpen}><MoreHorizontal size={18} /></button>
            <button type="button" className={`wp-iconbtn${railOpen ? ' is-on' : ''}`} onClick={() => setRailOpen((o) => !o)} aria-label={railOpen ? 'Hide details' : 'Show details'}><PanelRight size={18} /></button>
          </div>
          <Popover open={menuOpen} anchorRef={menuRef} onClose={() => setMenuOpen(false)} width={220} label="Teammate">
            <div className="wp-menu">
              <a className="wp-menu-item" href={`/harnesses/${encodeURIComponent(teammate.id)}`} target="_blank" rel="noreferrer">Open in the console</a>
              <button type="button" className="wp-menu-item is-danger" onClick={remove}>Remove from workplace</button>
            </div>
          </Popover>
        </header>

        <div className="wp-body" ref={bodyRef}>
          {turns === null ? <div className="wp-loading">Loading…</div> : null}
          {turns && !turns.length && !live && !pendingText ? (
            <div className="wp-greeting">
              <Bubble from={them} text={teammate.greeting || `Hi, I'm ${teammate.name}. What can I do for you?`} teammates={teammates} />
              <p className="wp-greeting-hint">The start of your conversation with {teammate.name}. They will remember it.</p>
            </div>
          ) : null}
          {rows}
          {err ? <div className="wp-err" role="alert">{err}</div> : null}
        </div>

        <Composer placeholder={`Message ${teammate.name}`} disabled={busy} onSend={send} autoFocus
                  hint={busy ? `${teammate.name} is working on your last message.` : ''} />
      </div>
      <Rail open={railOpen} onClose={() => setRailOpen(false)} teammate={teammate} sessions={sid ? [sid] : []} title={teammate.name}
            busySessions={busy && sid ? [{ sid, busy: true, name: teammate.name }] : []} refreshKey={tick} onOpenFile={files.open} />
      {files.overlay}
    </div>
  );
}
