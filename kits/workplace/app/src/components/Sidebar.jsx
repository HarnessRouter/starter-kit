// The room list, the way a desktop chat draws it: soft grey, a search box, one row per teammate
// with the last thing said and when, a blue dot for something new, groups as clusters of faces,
// the library and the person at the bottom.
import React, { useMemo, useRef, useState } from 'react';
import { Images, Plus, Search, X } from 'lucide-react';
import { Popover } from 'reifyui';
import { useWorkplace } from '../App.jsx';
import { Avatar, ClusterAvatar, MemberAvatar } from '../lib/avatars.jsx';
import { findDm } from '../lib/dm.js';
import { liveTyping } from '../lib/groupdoc.js';
import { whenLabel } from './Message.jsx';

const firstLine = (s) => String(s || '').split('\n').map((l) => l.trim()).find(Boolean) || '';

export default function Sidebar({ open }) {
  const wp = useWorkplace();
  const { teammates, cards, groupCards, docs, working, route, me, navigate, unread, closeDrawer } = wp;
  const [q, setQ] = useState('');
  const [plusOpen, setPlusOpen] = useState(false);
  const plusRef = useRef(null);
  const needle = q.trim().toLowerCase();

  const dms = useMemo(() => (teammates || []).map((t) => {
    const card = findDm(cards, t.id, me);
    const preview = card ? firstLine(card.result) || firstLine(card.user_prompt) : (t.greeting || t.tagline);
    return { t, card, preview, at: card && card.finished_at ? Number(card.finished_at) * 1000 : 0,
             marker: card ? (card.last_response_id || card.finished_at || card.id) : '' };
  }).filter((r) => !needle || r.t.name.toLowerCase().includes(needle) || r.t.tagline.toLowerCase().includes(needle)), [teammates, cards, me, needle]);

  const groups = useMemo(() => groupCards.map((c) => {
    const d = docs[c.id];
    const last = d ? [...d.messages].reverse().find((m) => m.from.kind !== 'system') : null;
    const who = last?.from.kind === 'teammate' ? (teammates || []).find((t) => t.id === last.from.id)?.name : last?.from.name;
    return { id: c.id, name: d?.name || String(c.title || '').replace(/^#/, ''), doc: d,
             members: (d?.members || []).map((id) => (teammates || []).find((t) => t.id === id)).filter(Boolean),
             preview: last ? `${who ? who + ': ' : ''}${firstLine(last.text)}` : (d?.topic || ''), at: last?.at || d?.createdAt || 0,
             typing: d ? liveTyping(d) : [], marker: d ? String(d.messages.length) : '' };
  }).filter((g) => !needle || g.name.toLowerCase().includes(needle)), [groupCards, docs, teammates, needle]);

  const isDm = (id) => route.kind === 'dm' && route.id === id;
  const isGroup = (id) => route.kind === 'group' && route.id === id;
  const go = (path) => { navigate(path); closeDrawer(); };

  return (
    <aside className={`wp-side${open ? ' is-open' : ''}`} aria-label="Rooms">
      <div className="wp-side-top">
        <label className="wp-search">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search rooms" />
          {q ? <button type="button" className="wp-search-x" onClick={() => setQ('')} aria-label="Clear"><X size={12} /></button> : null}
        </label>
        <button type="button" ref={plusRef} className="wp-plus" onClick={() => setPlusOpen((o) => !o)} aria-label="New" aria-expanded={plusOpen}><Plus size={18} /></button>
        <button type="button" className="wp-side-close" onClick={closeDrawer} aria-label="Close the room list"><X size={18} /></button>
        <Popover open={plusOpen} anchorRef={plusRef} onClose={() => setPlusOpen(false)} width={220} label="New">
          <div className="wp-menu">
            <button type="button" className="wp-menu-item" onClick={() => { setPlusOpen(false); go('new'); }}>New teammate</button>
            <button type="button" className="wp-menu-item" disabled={!teammates || !teammates.length} onClick={() => { setPlusOpen(false); window.dispatchEvent(new CustomEvent('wp:new-group')); }}>New group</button>
          </div>
        </Popover>
      </div>

      <nav className="wp-side-scroll">
        {teammates && !teammates.length && !groups.length ? (
          <button type="button" className="wp-row is-first" onClick={() => go('new')}>
            <Avatar avatar={{ shape: 'round', color: 'blue' }} size={34} />
            <span className="wp-row-main"><span className="wp-row-name">Create your first teammate</span></span>
          </button>
        ) : null}
        {dms.length ? <div className="wp-side-h">Teammates</div> : null}
        {dms.map(({ t, preview, at, marker }) => (
          <button key={t.id} type="button" className={`wp-row${isDm(t.id) ? ' is-active' : ''}`} onClick={() => go(`dm/${t.id}`)}>
            <Avatar avatar={t.avatar} id={t.id} size={34} working={working.has(t.id)} />
            <span className="wp-row-main">
              <span className="wp-row-line"><span className="wp-row-name">{t.name}</span>{at ? <span className="wp-row-time">{whenLabel(at)}</span> : null}</span>
              <span className="wp-row-prev">{preview}</span>
            </span>
            {!isDm(t.id) && unread(`dm:${t.id}`, marker) ? <span className="wp-row-dot" aria-label="New messages" /> : null}
          </button>
        ))}
        {groups.length ? <div className="wp-side-h">Groups</div> : null}
        {groups.map((g) => (
          <button key={g.id} type="button" className={`wp-row${isGroup(g.id) ? ' is-active' : ''}`} onClick={() => go(`group/${g.id}`)}>
            <ClusterAvatar members={g.members} size={34} />
            <span className="wp-row-main">
              <span className="wp-row-line"><span className="wp-row-name">{g.name}</span>{g.at ? <span className="wp-row-time">{whenLabel(g.at)}</span> : null}</span>
              <span className="wp-row-prev">{g.typing.length ? `${g.members.find((t) => t.id === g.typing[0])?.name || 'Someone'} is writing…` : g.preview}</span>
            </span>
            {!isGroup(g.id) && unread(`g:${g.id}`, g.marker) ? <span className="wp-row-dot" aria-label="New messages" /> : null}
          </button>
        ))}
        {teammates && teammates.length && !dms.length && !groups.length ? <div className="wp-side-empty">Nothing matches.</div> : null}
      </nav>

      <div className="wp-side-foot">
        <button type="button" className={`wp-row is-tool${route.kind === 'artifacts' ? ' is-active' : ''}`} onClick={() => go('artifacts')}>
          <span className="wp-row-ic"><Images size={16} /></span>
          <span className="wp-row-main"><span className="wp-row-name">Artifacts</span></span>
        </button>
        <div className="wp-me">
          <MemberAvatar name={me?.name} size={28} />
          <span className="wp-me-name">{me?.name}</span>
        </div>
      </div>
    </aside>
  );
}
