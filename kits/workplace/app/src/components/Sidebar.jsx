// The room list: every teammate as a direct message, then the groups, then the library. Like a
// team chat's rail: dark, dense, a dot for something new and a pulse for someone at work.
import React, { useMemo } from 'react';
import { Hash, Images, Plus, UserPlus, X } from 'lucide-react';
import { useWorkplace } from '../App.jsx';
import { Avatar, MemberAvatar } from '../lib/avatars.jsx';
import { findDm } from '../lib/dm.js';
import { liveTyping } from '../lib/groupdoc.js';

export default function Sidebar({ open }) {
  const wp = useWorkplace();
  const { teammates, cards, groupCards, docs, working, route, me, navigate, unread, closeDrawer } = wp;

  const groups = useMemo(() => groupCards.map((c) => {
    const d = docs[c.id];
    return { id: c.id, name: d?.name || String(c.title || '').replace(/^#/, ''), doc: d, members: d?.members || [] };
  }), [groupCards, docs]);

  const isDm = (id) => route.kind === 'dm' && route.id === id;
  const isGroup = (id) => route.kind === 'group' && route.id === id;

  return (
    <aside className={`wp-side${open ? ' is-open' : ''}`} aria-label="Rooms">
      <div className="wp-side-head">
        <span className="wp-side-title">My Workplace</span>
        <button className="wp-side-close" onClick={closeDrawer} aria-label="Close the room list"><X size={18} /></button>
      </div>

      <nav className="wp-side-scroll">
        <div className="wp-side-sec">
          <div className="wp-side-sec-h">Direct messages</div>
          {(teammates || []).map((t) => {
            const card = findDm(cards, t.id, me);
            const marker = card ? (card.last_response_id || card.finished_at || card.id) : '';
            return (
              <button key={t.id} className={`wp-side-row${isDm(t.id) ? ' is-active' : ''}`} onClick={() => navigate(`dm/${t.id}`)}>
                <span className="wp-side-ava"><Avatar id={t.avatar} size={24} working={working.has(t.id)} /></span>
                <span className="wp-side-name">{t.name}</span>
                {t.tagline ? <span className="wp-side-sub">{t.tagline}</span> : null}
                {!isDm(t.id) && unread(`dm:${t.id}`, marker) ? <span className="wp-side-dot" aria-label="New messages" /> : null}
              </button>
            );
          })}
          {teammates && !teammates.length ? <div className="wp-side-empty">No teammates yet.</div> : null}
          <button className={`wp-side-row is-action${route.kind === 'new' ? ' is-active' : ''}`} onClick={() => navigate('new')}>
            <span className="wp-side-ava is-ic"><UserPlus size={16} /></span>
            <span className="wp-side-name">New teammate</span>
          </button>
        </div>

        <div className="wp-side-sec">
          <div className="wp-side-sec-h">Groups</div>
          {groups.map((g) => {
            const typing = g.doc ? liveTyping(g.doc) : [];
            const marker = g.doc ? String(g.doc.messages.length) : '';
            return (
              <button key={g.id} className={`wp-side-row${isGroup(g.id) ? ' is-active' : ''}`} onClick={() => navigate(`group/${g.id}`)}>
                <span className="wp-side-ava is-ic"><Hash size={16} /></span>
                <span className="wp-side-name">{g.name}</span>
                <span className="wp-side-stack" aria-hidden="true">
                  {g.members.slice(0, 3).map((id) => {
                    const t = (teammates || []).find((x) => x.id === id);
                    return t ? <Avatar key={id} id={t.avatar} size={18} working={typing.includes(id) || working.has(id)} /> : null;
                  })}
                </span>
                {!isGroup(g.id) && unread(`g:${g.id}`, marker) ? <span className="wp-side-dot" aria-label="New messages" /> : null}
              </button>
            );
          })}
          {!groups.length ? <div className="wp-side-empty">No groups yet.</div> : null}
          <button className="wp-side-row is-action" onClick={() => window.dispatchEvent(new CustomEvent('wp:new-group'))} disabled={!teammates || !teammates.length}
                  title={!teammates || !teammates.length ? 'Add a teammate first' : undefined}>
            <span className="wp-side-ava is-ic"><Plus size={16} /></span>
            <span className="wp-side-name">New group</span>
          </button>
        </div>

        <div className="wp-side-sec">
          <div className="wp-side-sec-h">Library</div>
          <button className={`wp-side-row${route.kind === 'artifacts' ? ' is-active' : ''}`} onClick={() => navigate('artifacts')}>
            <span className="wp-side-ava is-ic"><Images size={16} /></span>
            <span className="wp-side-name">Artifacts</span>
          </button>
        </div>
      </nav>

      <div className="wp-side-foot">
        <MemberAvatar name={me?.name} size={26} />
        <span className="wp-side-me">{me?.name}</span>
      </div>
    </aside>
  );
}
