// The library: everything every teammate has made, by conversation. Read from the sessions'
// workspaces when the page opens; nothing is indexed, so nothing can be out of date.
import React, { useEffect, useMemo, useState } from 'react';
import { Hash, Menu } from 'lucide-react';
import { useWorkplace } from '../App.jsx';
import { Avatar } from '../lib/avatars.jsx';
import { sessionFiles } from '../lib/api.js';
import { findDm } from '../lib/dm.js';
import { FileChips, useFileOverlay } from './Files.jsx';

export default function ArtifactsPage() {
  const { me, cards, teammates, groupCards, docs, navigate, openDrawer } = useWorkplace();
  const [groups, setGroups] = useState(null);
  const files = useFileOverlay();

  // The conversations to read: each teammate's direct message, each group's teammate sessions.
  const convs = useMemo(() => {
    const out = [];
    for (const t of teammates || []) {
      const c = findDm(cards, t.id, me);
      if (c) out.push({ key: `dm:${t.id}`, kind: 'dm', label: t.name, teammate: t, sessions: [c.id], route: `dm/${t.id}` });
    }
    for (const g of groupCards) {
      const d = docs[g.id];
      const sessions = Object.values(d?.bots || {}).map((b) => b.session).filter(Boolean);
      if (sessions.length) out.push({ key: `g:${g.id}`, kind: 'group', label: d?.name || String(g.title || '').replace(/^#/, ''), sessions, route: `group/${g.id}` });
    }
    return out;
  }, [teammates, cards, me, groupCards, docs]);

  // Re-read when the SET of conversations changes, not when the session list is polled again
  // (that gave the page a fresh "Looking…" every five seconds). What is on screen stays until
  // the new read has something to say.
  const convKey = convs.map((c) => `${c.key}:${c.sessions.join('+')}`).join('|');
  useEffect(() => {
    let alive = true;
    const list = convs;
    (async () => {
      const out = [];
      for (const c of list) {
        const fs = (await Promise.all(c.sessions.map((sid) => sessionFiles(sid).catch(() => [])))).flat();
        if (fs.length) out.push({ ...c, files: fs });
      }
      if (alive) setGroups(out);
    })();
    return () => { alive = false; };
  }, [convKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = (groups || []).reduce((n, g) => n + g.files.length, 0);
  return (
    <div className="wp-page">
      <header className="wp-head is-page">
        <button type="button" className="wp-iconbtn wp-menubtn" onClick={openDrawer} aria-label="Rooms"><Menu size={20} /></button>
        <div className="wp-head-titles"><h1 className="wp-head-title">Artifacts</h1><div className="wp-head-sub">{groups === null ? 'Looking…' : `${total} file${total === 1 ? '' : 's'} across ${groups.length} conversation${groups.length === 1 ? '' : 's'}`}</div></div>
      </header>
      <div className="wp-page-scroll">
        <div className="wp-lib">
          {groups && !groups.length ? <p className="wp-lib-empty">Nothing yet. Ask a teammate for a report, a spreadsheet or an image; what they make lands here.</p> : null}
          {(groups || []).map((g) => (
            <section key={g.key} className="wp-lib-sec">
              <button type="button" className="wp-lib-h" onClick={() => navigate(g.route)}>
                {g.kind === 'dm' ? <Avatar avatar={g.teammate.avatar} id={g.teammate.id} size={24} /> : <span className="wp-lib-hash"><Hash size={16} /></span>}
                <span>{g.kind === 'dm' ? g.label : `#${g.label}`}</span>
                <span className="wp-count">{g.files.length}</span>
              </button>
              <FileChips files={g.files} onOpen={files.open} />
            </section>
          ))}
        </div>
      </div>
      {files.overlay}
    </div>
  );
}
