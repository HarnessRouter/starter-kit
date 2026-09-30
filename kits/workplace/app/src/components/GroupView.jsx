// A group: the document is the room. This tab reads it every few seconds, appends what the person
// says, and — when nobody else is driving — runs the teammates' turns (engine.js), showing each
// one's work live in its own message while it runs.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Hash, Menu, MoreHorizontal, PanelRight, Users } from 'lucide-react';
import { Popover, useDialog } from 'reifyui';
import { deleteSession, patchSession } from 'reifyui/harness';
import { useWorkplace } from '../App.jsx';
import { Avatar } from '../lib/avatars.jsx';
import { appendMessage, cleanGroupName, groupTitle, humanMessage, liveTyping, mergeDoc, roundHeldByOther, systemMessage } from '../lib/groupdoc.js';
import { readGroup, writeGroup } from '../lib/groups.js';
import { runRound } from '../lib/engine.js';
import { mentionItems } from '../lib/mentions.js';
import Composer from './Composer.jsx';
import Rail, { useRail } from './Rail.jsx';
import { DayDivider, MessageRow, SystemLine, TypingRow } from './Message.jsx';
import { useFileOverlay } from './Files.jsx';

const POLL_MS = 3000;

export default function GroupView({ sid }) {
  const wp = useWorkplace();
  const { me, teammates, docs, setDoc, navigate, markLive, markSeen, tabId, openDrawer, refreshCards } = wp;
  const dialog = useDialog();
  const [doc, setDocState] = useState(docs[sid] || null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const [live, setLive] = useState({});        // teammate id -> { text, steps, status, session }
  const [err, setErr] = useState('');
  const [railOpen, setRailOpen] = useRail();
  const [menuOpen, setMenuOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const menuRef = useRef(null);
  const membersRef = useRef(null);
  const bodyRef = useRef(null);
  const attachments = useRef({});              // human message id -> prepared file blocks, this tab only
  const files = useFileOverlay();

  const adopt = useCallback((next) => { docRef.current = next; setDocState(next); setDoc(sid, next); }, [sid, setDoc]);
  const getDoc = useCallback(() => docRef.current, []);
  const putDoc = useCallback(async (next) => { const stored = await writeGroup(sid, next); adopt(stored); return stored; }, [sid, adopt]);

  // Read the room every few seconds: other tabs' messages, and the driver's replies when it is not us.
  useEffect(() => {
    let alive = true;
    const tick_ = async () => {
      const remote = await readGroup(sid).catch(() => null);
      if (!alive || !remote) return;
      const cur = docRef.current;
      if (cur && cur.rev === remote.rev && cur.messages.length === remote.messages.length && JSON.stringify(cur.typing) === JSON.stringify(remote.typing)) return;
      adopt(cur ? { ...mergeDoc(cur, remote), rev: Math.max(cur.rev, remote.rev) } : remote);
    };
    tick_();
    const id = window.setInterval(() => { if (!document.hidden) tick_(); }, POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [sid, adopt]);

  const roster = teammates || [];
  const members = useMemo(() => (doc ? doc.members.map((id) => roster.find((t) => t.id === id)).filter(Boolean) : []), [doc, roster]);
  const items = useMemo(() => mentionItems(members), [members]);
  const typing = doc ? liveTyping(doc) : [];
  const busyLocal = Object.values(live).some(Boolean);
  const heldElsewhere = doc ? roundHeldByOther(doc, tabId) : false;

  useEffect(() => { if (doc) markSeen(`g:${sid}`, String(doc.messages.length)); }, [doc?.messages.length, sid, markSeen]); // eslint-disable-line react-hooks/exhaustive-deps

  const onLive = useCallback((id, v) => {
    setLive((m) => { const n = { ...m }; if (v) n[id] = v; else delete n[id]; return n; });
    markLive(id, !!v);
  }, [markLive]);

  const send = useCallback(async ({ text, mentions, files: blocks, attachments: att }) => {
    if (!doc) return;
    setErr('');
    const msg = humanMessage({ me, text, mentions, attachments: att });
    if (blocks.length) attachments.current[msg.id] = blocks;
    try {
      await putDoc(appendMessage(getDoc(), msg));
    } catch (e) { setErr(e?.message || 'The message could not be posted.'); return; }
    runRound({
      sid, tabId, me, roster, getDoc, putDoc, onLive,
      attachmentsFor: (id) => attachments.current[id] || [],
      onError: (bot, why) => setErr(`${bot.name}: ${why}`),
    }, msg).catch((e) => setErr(e?.message || 'The round stopped.')).finally(() => { delete attachments.current[msg.id]; setTick((n) => n + 1); refreshCards(); });
  }, [doc, me, roster, sid, tabId, getDoc, putDoc, onLive, refreshCards]);

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
    const ok = await dialog.confirm({ title: `Delete #${doc.name}?`, message: 'The conversation and the files made in it are deleted. The teammates stay.', destructive: true, confirmLabel: 'Delete' });
    if (!ok) return;
    try { await deleteSession(sid); await refreshCards(); navigate('', true); }
    catch (e) { dialog.alert({ title: 'Could not delete', message: e?.message || 'Try again.' }); }
  };

  const rows = useMemo(() => {
    if (!doc) return [];
    const out = [];
    let lastDay = '';
    for (const m of doc.messages) {
      const d = new Date(m.at).toDateString();
      if (d !== lastDay) { out.push(<DayDivider key={`d${d}`} at={m.at} />); lastDay = d; }
      if (m.from.kind === 'system') { out.push(<SystemLine key={m.id} text={m.text} />); continue; }
      const t = m.from.kind === 'teammate' ? roster.find((x) => x.id === m.from.id) : null;
      const from = t ? { kind: 'teammate', name: t.name, avatar: t.avatar } : m.from.kind === 'teammate' ? { kind: 'teammate', name: 'Former teammate', avatar: 'robot' } : { kind: 'member', name: m.from.name || 'Someone' };
      out.push(<MessageRow key={m.id} from={from} at={m.at} text={m.text} files={m.files} attachments={m.attachments} teammates={roster}
                           onMention={(id) => navigate(`dm/${id}`)} onOpenFile={files.open} onName={t ? () => navigate(`dm/${t.id}`) : undefined} />);
    }
    for (const [id, v] of Object.entries(live)) {
      const t = roster.find((x) => x.id === id);
      if (!t || !v) continue;
      const blocks = [];
      if (v.steps.length) blocks.push({ kind: 'tools', reasoning: '', steps: v.steps });
      if (v.text) blocks.push({ kind: 'text', text: v.text });
      out.push(<MessageRow key={`live-${id}`} from={{ kind: 'teammate', name: t.name, avatar: t.avatar }} turn={{ blocks, status: 'running' }} teammates={roster} workingLabel={`${t.name} is thinking…`} />);
    }
    for (const id of typing) {
      if (live[id]) continue;
      const t = roster.find((x) => x.id === id);
      if (t) out.push(<TypingRow key={`typing-${id}`} from={{ name: t.name, avatar: t.avatar }} />);
    }
    return out;
  }, [doc, live, typing.join(','), roster, navigate, files.open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const el = bodyRef.current; if (el) el.scrollTop = el.scrollHeight; }, [rows.length, JSON.stringify(Object.values(live).map((v) => v && [v.text.length, v.steps.length]))]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!doc) return <div className="wp-room"><div className="wp-conv"><div className="wp-loading">Opening #…</div></div></div>;

  return (
    <div className="wp-room">
      <div className="wp-conv">
        <header className="wp-head">
          <button type="button" className="wp-iconbtn wp-menubtn" onClick={openDrawer} aria-label="Rooms"><Menu size={20} /></button>
          <span className="wp-head-hash"><Hash size={18} /></span>
          <div className="wp-head-titles">
            <h1 className="wp-head-title">{doc.name}</h1>
            <div className="wp-head-sub">{doc.topic || `${members.length} teammate${members.length === 1 ? '' : 's'}`}</div>
          </div>
          <div className="wp-head-acts">
            <button type="button" ref={membersRef} className="wp-members-btn" onClick={() => setMembersOpen((o) => !o)} aria-label="Members" aria-expanded={membersOpen}>
              <span className="wp-stack">{members.slice(0, 4).map((t) => <Avatar key={t.id} id={t.avatar} size={22} working={!!live[t.id] || typing.includes(t.id)} />)}</span>
              <span className="wp-members-n"><Users size={14} />{members.length}</span>
            </button>
            <button type="button" ref={menuRef} className="wp-iconbtn" onClick={() => setMenuOpen((o) => !o)} aria-label="More" aria-expanded={menuOpen}><MoreHorizontal size={20} /></button>
            <button type="button" className={`wp-iconbtn${railOpen ? ' is-on' : ''}`} onClick={() => setRailOpen((o) => !o)} aria-label={railOpen ? 'Hide details' : 'Show details'}><PanelRight size={20} /></button>
          </div>
          <Popover open={membersOpen} anchorRef={membersRef} onClose={() => setMembersOpen(false)} width={300} label="Members">
            <div className="wp-menu">
              <div className="wp-menu-h">Teammates in #{doc.name}</div>
              {roster.map((t) => {
                const on = doc.members.includes(t.id);
                return (
                  <label key={t.id} className="wp-menu-check">
                    <input type="checkbox" checked={on} onChange={() => setMembers(on ? doc.members.filter((id) => id !== t.id) : [...doc.members, t.id])} />
                    <Avatar id={t.avatar} size={22} /><span>{t.name}</span><span className="wp-menu-sub">{t.tagline}</span>
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
          {doc.messages.length <= 1 ? (
            <div className="wp-greeting">
              <p className="wp-greeting-hint">This is the start of #{doc.name}. Say something; the teammates who should answer will, and you can @mention one to be sure.</p>
            </div>
          ) : null}
          {rows}
          {err ? <div className="wp-err" role="alert">{err}</div> : null}
        </div>

        <Composer items={items} placeholder={`Message #${doc.name}`} onSend={send} autoFocus
                  hint={heldElsewhere && !busyLocal ? 'Another window is running the replies.' : members.length ? 'Type @ to call a teammate.' : 'Add a teammate to this group to get answers.'} />
      </div>
      <Rail open={railOpen} onClose={() => setRailOpen(false)} members={members} live={live}
            sessions={Object.values(doc.bots || {}).map((b) => b.session).filter(Boolean)} refreshKey={tick} onOpenFile={files.open} />
      {files.overlay}
    </div>
  );
}
