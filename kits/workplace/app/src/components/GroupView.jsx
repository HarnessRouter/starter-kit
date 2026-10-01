// A group: the document is the room. This tab reads it every few seconds, appends what the person
// says, and, when nobody else is driving, runs the teammates' turns (engine.js), showing each one's
// work live in its own bubble while it runs. When another window drives, the teammates' turns are
// watched on the event stream and shown live here all the same.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu, MoreHorizontal, PanelRight, Users } from 'lucide-react';
import { Popover, useDialog } from 'reifyui';
import { deleteSession, patchSession } from 'reifyui/harness';
import { useWorkplace } from '../App.jsx';
import { Avatar, ClusterAvatar } from '../lib/avatars.jsx';
import { appendMessage, cleanGroupName, groupTitle, humanMessage, liveTyping, mergeDoc, needsDriver, roundHeldByOther, systemMessage } from '../lib/groupdoc.js';
import { readGroup, writeGroup } from '../lib/groups.js';
import { driveRoom } from '../lib/engine.js';
import { watchTurn } from '../lib/bus.js';
import { mentionItems } from '../lib/mentions.js';
import Composer from './Composer.jsx';
import Rail, { useRail } from './Rail.jsx';
import { Bubble, SystemLine, TypingBubble, withTimeLabels } from './Message.jsx';
import { useFilePane } from './Files.jsx';
import { Markdown } from './Markdown.jsx';

const POLL_MS = 3000;

export default function GroupView({ sid }) {
  const wp = useWorkplace();
  const { me, teammates, docs, setDoc, navigate, markLive, markSeen, tabId, openDrawer, refreshCards } = wp;
  const dialog = useDialog();
  const [doc, setDocState] = useState(docs[sid] || null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const [live, setLive] = useState({});
  const [err, setErr] = useState('');
  const [railOpen, setRailOpen] = useRail();
  const [menuOpen, setMenuOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const menuRef = useRef(null);
  const membersRef = useRef(null);
  const bodyRef = useRef(null);
  const attachments = useRef({});
  const files = useFilePane({ renderMarkdown: (text) => <Markdown text={text} /> });
  // The preview takes the rail's place while a file is open (two side panels would squeeze the
  // conversation to a column); the rail comes back when the preview closes, if it was open.
  const railBefore = useRef(null);
  useEffect(() => {
    if (files.file) { if (railBefore.current === null) { railBefore.current = railOpen; setRailOpen(false); } }
    else if (railBefore.current !== null) { const was = railBefore.current; railBefore.current = null; if (was) setRailOpen(true); }
  }, [files.file]); // eslint-disable-line react-hooks/exhaustive-deps

  const adopt = useCallback((next) => { docRef.current = next; setDocState(next); setDoc(sid, next); }, [sid, setDoc]);
  const getDoc = useCallback(() => docRef.current, []);
  const putDoc = useCallback(async (next) => { const stored = await writeGroup(sid, next); adopt(stored); return stored; }, [sid, adopt]);
  const refresh = useCallback(async () => {
    const remote = await readGroup(sid).catch(() => null);
    if (!remote) return docRef.current;
    const cur = docRef.current;
    const next = cur ? { ...mergeDoc(cur, remote), rev: Math.max(cur.rev, remote.rev) } : remote;
    adopt(next);
    return next;
  }, [sid, adopt]);

  const roster = teammates || [];
  const rosterRef = useRef(roster);
  rosterRef.current = roster;
  const liveRef = useRef(live);
  liveRef.current = live;

  const onLive = useCallback((id, v) => {
    setLive((m) => { const n = { ...m }; if (v) n[id] = v; else delete n[id]; return n; });
    markLive(id, !!v);
  }, [markLive]);

  // Drive the room: run the teammates' turns until nobody owes one. Once at a time in this tab;
  // the document's round lock keeps it to one tab across windows.
  const driving = useRef(false);
  const drive = useCallback(() => {
    if (driving.current) return;
    driving.current = true;
    driveRoom({ sid, tabId, me, roster: rosterRef.current, getDoc, putDoc, refresh, onLive,
                attachmentsFor: (id) => attachments.current[id] || [], onError: (bot, why) => setErr(`${bot.name}: ${why}`) })
      .catch((e) => setErr(e?.message || 'The round stopped.'))
      .finally(() => { driving.current = false; attachments.current = {}; setTick((n) => n + 1); refreshCards(); });
  }, [sid, tabId, me, getDoc, putDoc, refresh, onLive, refreshCards]);
  const driveRef = useRef(drive);
  driveRef.current = drive;

  useEffect(() => {
    let alive = true;
    const tick_ = async () => {
      const remote = await readGroup(sid).catch(() => null);
      if (!alive) return;
      if (remote) {
        const cur = docRef.current;
        const same = cur && cur.rev === remote.rev && cur.messages.length === remote.messages.length && JSON.stringify(cur.typing) === JSON.stringify(remote.typing);
        if (!same) adopt(cur ? { ...mergeDoc(cur, remote), rev: Math.max(cur.rev, remote.rev) } : remote);
      }
      // A room with work and nobody alive driving it: the tab that was driving closed or
      // reloaded mid-turn, or a message arrived from another window after its driver finished.
      const d = docRef.current;
      if (d && rosterRef.current.length && needsDriver(d, rosterRef.current, tabId)) driveRef.current();
    };
    tick_();
    const id = window.setInterval(() => { if (!document.hidden) tick_(); }, POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [sid, adopt, tabId]);

  const members = useMemo(() => (doc ? doc.members.map((id) => roster.find((t) => t.id === id)).filter(Boolean) : []), [doc, roster]);
  const items = useMemo(() => mentionItems(members), [members]);
  const typing = doc ? liveTyping(doc) : [];
  // Every teammate marked as typing, however old the mark: a turn can run longer than the mark is
  // shown as dots, and its stream is still worth following.
  const marked = doc ? Object.entries(doc.typing || {}).filter(([, v]) => v && v.on).map(([id]) => id) : [];
  const busyLocal = Object.values(live).some((v) => v && !v.external);
  const heldElsewhere = doc ? roundHeldByOther(doc, tabId) : false;

  useEffect(() => { if (doc) markSeen(`g:${sid}`, String(doc.messages.length)); }, [doc?.messages.length, sid, markSeen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Teammates typing in a turn this tab is not running (another window drives the room): watch
  // their sessions' events so their work shows here as it happens, not only once it is done. The
  // bubble stays, with the finished text, until the driver has written the reply into the room
  // (the same write turns the typing mark off), so a reply never blinks out before it is there.
  const watchers = useRef({});
  const watchKey = marked.map((id) => `${id}:${doc?.bots?.[id]?.session || ''}:${live[id] && !live[id].external ? 'local' : ''}`).join(',');
  useEffect(() => {
    const want = new Map(marked.filter((id) => !live[id] || live[id].external).map((id) => [id, doc?.bots?.[id]?.session || '']));
    for (const [id, w] of Object.entries(watchers.current)) {
      if (want.get(id) === w.session) continue;
      w.stop();
      delete watchers.current[id];
      if (liveRef.current[id]?.external) onLive(id, null);
    }
    for (const [id, session] of want) {
      if (watchers.current[id]) continue;
      const mine = () => liveRef.current[id] && !liveRef.current[id].external;   // this tab took the turn over meanwhile
      const stop = watchTurn({
        harnessId: id, sessionId: session,
        onLive: (v) => { if (!mine()) onLive(id, { text: v.text, steps: v.steps, status: v.status === 'running' ? 'running' : 'done', session: v.session, rid: v.rid, external: true }); },
      });
      watchers.current[id] = { session, stop };
    }
  }, [watchKey, onLive]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { for (const w of Object.values(watchers.current)) w.stop(); }, []);

  const send = useCallback(async ({ text, mentions, files: blocks, attachments: att }) => {
    if (!doc) return;
    setErr('');
    const msg = humanMessage({ me, text, mentions, attachments: att });
    if (blocks.length) attachments.current[msg.id] = blocks;
    try { await putDoc(appendMessage(getDoc(), msg)); }
    catch (e) { setErr(e?.message || 'The message could not be posted.'); return; }
    drive();   // or, when another window drives, it sees the message on its next plan
  }, [doc, me, getDoc, putDoc, drive]);

  const setMembers = async (ids) => {
    const cur = getDoc();
    const added = ids.filter((id) => !cur.members.includes(id)).map((id) => roster.find((t) => t.id === id)?.name).filter(Boolean);
    const gone = cur.members.filter((id) => !ids.includes(id)).map((id) => roster.find((t) => t.id === id)?.name).filter(Boolean);
    let next = { ...cur, members: ids };
    if (added.length) next = appendMessage(next, systemMessage(`${me?.name || 'Someone'} added ${added.join(', ')}`));
    if (gone.length) next = appendMessage(next, systemMessage(`${me?.name || 'Someone'} removed ${gone.join(', ')}`));
    await putDoc(next).catch((e) => setErr(e?.message || 'Could not change the members.'));
  };
  const rename = async () => {
    setMenuOpen(false);
    const v = await dialog.prompt({ title: 'Rename the group', label: 'Name', value: doc.name, placeholder: 'design' });
    if (!v) return;
    const name = cleanGroupName(v);
    await putDoc({ ...getDoc(), name }).catch(() => {});
    await patchSession(sid, { title: groupTitle({ name }) }).catch(() => {});
    refreshCards();
  };
  const remove = async () => {
    setMenuOpen(false);
    const ok = await dialog.confirm({ title: `Delete ${doc.name}?`, message: 'The conversation and the files made in it are deleted. The teammates stay.', destructive: true, confirmLabel: 'Delete' });
    if (!ok) return;
    try { await deleteSession(sid); await refreshCards(); navigate('', true); }
    catch (e) { dialog.alert({ title: 'Could not delete', message: e?.message || 'Try again.' }); }
  };

  const rows = useMemo(() => {
    if (!doc) return [];
    const items_ = [];
    let prev = '';
    for (const m of doc.messages) {
      if (m.from.kind === 'system') { items_.push({ at: m.at, node: <SystemLine key={m.id} text={m.text} /> }); prev = 'system'; continue; }
      const t = m.from.kind === 'teammate' ? roster.find((x) => x.id === m.from.id) : null;
      const isMe = m.from.kind === 'member' && (me?.id === '*' || m.from.id === me?.id);
      const from = t ? { kind: 'teammate', id: t.id, name: t.name, avatar: t.avatar }
        : m.from.kind === 'teammate' ? { kind: 'teammate', id: m.from.id, name: 'Former teammate' }
        : isMe ? { kind: 'me', name: me?.name } : { kind: 'member', name: m.from.name || 'Someone' };
      const key = `${from.kind}:${from.id || from.name}`;
      const first = prev !== key;
      prev = key;
      items_.push({ at: m.at, node: <Bubble key={m.id} from={from} first={first} text={m.text} files={m.files} attachments={m.attachments} teammates={roster}
                                            onMention={(id) => navigate(`dm/${id}`)} onOpenFile={files.open} onName={t ? () => navigate(`dm/${t.id}`) : undefined} /> });
    }
    const out = withTimeLabels(items_, (it) => it.node.key);
    for (const [id, v] of Object.entries(live)) {
      const t = roster.find((x) => x.id === id);
      if (!t || !v) continue;
      const blocks = [];
      if (v.steps.length) blocks.push({ kind: 'tools', reasoning: '', steps: v.steps });
      if (v.text) blocks.push({ kind: 'text', text: v.text });
      out.push(<Bubble key={`live-${id}`} from={{ kind: 'teammate', id: t.id, name: t.name, avatar: t.avatar }} turn={{ blocks, status: v.status === 'done' ? 'done' : 'running' }} teammates={roster} workingLabel={`${t.name} is thinking…`} />);
    }
    for (const id of typing) {
      if (live[id]) continue;
      const t = roster.find((x) => x.id === id);
      if (t) out.push(<TypingBubble key={`typing-${id}`} from={{ id: t.id, name: t.name, avatar: t.avatar }} />);
    }
    return out;
  }, [doc, live, typing.join(','), roster, navigate, files.open, me]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const el = bodyRef.current; if (el) el.scrollTop = el.scrollHeight; }, [rows.length, JSON.stringify(Object.values(live).map((v) => v && [v.text.length, v.steps.length]))]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!doc) return <div className={`wp-room${files.file ? ' has-preview' : ''}`}><div className="wp-conv"><div className="wp-loading">Opening the group…</div></div></div>;

  return (
    <div className={`wp-room${files.file ? ' has-preview' : ''}`}>
      <div className="wp-conv">
        <header className="wp-head">
          <button type="button" className="wp-iconbtn wp-menubtn" onClick={openDrawer} aria-label="Rooms"><Menu size={20} /></button>
          <ClusterAvatar members={members} size={26} />
          <div className="wp-head-titles">
            <h1 className="wp-head-title">{doc.name}</h1>
            <div className="wp-head-sub">{doc.topic || `${members.length} teammate${members.length === 1 ? '' : 's'}`}</div>
          </div>
          <div className="wp-head-acts">
            <button type="button" ref={membersRef} className="wp-iconbtn" onClick={() => setMembersOpen((o) => !o)} aria-label="Members" aria-expanded={membersOpen}><Users size={18} /></button>
            <button type="button" ref={menuRef} className="wp-iconbtn" onClick={() => setMenuOpen((o) => !o)} aria-label="More" aria-expanded={menuOpen}><MoreHorizontal size={18} /></button>
            <button type="button" className={`wp-iconbtn${railOpen ? ' is-on' : ''}`} onClick={() => setRailOpen((o) => !o)} aria-label={railOpen ? 'Hide details' : 'Show details'}><PanelRight size={18} /></button>
          </div>
          <Popover open={membersOpen} anchorRef={membersRef} onClose={() => setMembersOpen(false)} width={300} label="Members">
            <div className="wp-menu">
              <div className="wp-menu-h">Teammates in {doc.name}</div>
              {roster.map((t) => {
                const on = doc.members.includes(t.id);
                return (
                  <label key={t.id} className="wp-menu-check">
                    <input type="checkbox" checked={on} onChange={() => setMembers(on ? doc.members.filter((id) => id !== t.id) : [...doc.members, t.id])} />
                    <Avatar avatar={t.avatar} id={t.id} size={22} /><span>{t.name}</span><span className="wp-menu-sub">{t.tagline}</span>
                  </label>
                );
              })}
              {!roster.length ? <div className="wp-menu-sub">No teammates yet.</div> : null}
            </div>
          </Popover>
          <Popover open={menuOpen} anchorRef={menuRef} onClose={() => setMenuOpen(false)} width={220} label="Group">
            <div className="wp-menu">
              <button type="button" className="wp-menu-item" onClick={rename}>Rename</button>
              <button type="button" className="wp-menu-item is-danger" onClick={remove}>Delete group</button>
            </div>
          </Popover>
        </header>

        <div className="wp-body" ref={bodyRef}>
          {doc.messages.length <= 1 ? <p className="wp-greeting-hint is-center">The start of {doc.name}. Say something; the teammates who should answer will, and you can @mention one to be sure.</p> : null}
          {rows}
          {err ? <div className="wp-err" role="alert">{err}</div> : null}
        </div>

        <Composer items={items} placeholder={`Message ${doc.name}`} onSend={send} autoFocus
                  hint={heldElsewhere && !busyLocal ? 'Another window is running the replies.' : members.length ? 'Type @ to call a teammate.' : 'Add a teammate to this group to get answers.'} />
      </div>
      {files.pane}
      <Rail open={railOpen} onClose={() => setRailOpen(false)} members={members} live={live} title={doc.name}
            sessions={Object.values(doc.bots || {}).map((b) => b.session).filter(Boolean)} refreshKey={tick} onOpenFile={files.open}
            makers={Object.fromEntries(Object.entries(doc.bots || {}).filter(([, b]) => b?.session).map(([id, b]) => [b.session, roster.find((t) => t.id === id) || null]))} />
    </div>
  );
}
