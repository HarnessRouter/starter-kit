// The library: everything every teammate has made, as a grid of cards with the file itself in
// view (an image, the first lines of a document or a script, otherwise its type), who made it and
// in which room. Read from the sessions' workspaces when the page opens; nothing is indexed, so
// nothing can be out of date. A card opens the same viewer a task's artifact opens in the console.
import React, { useEffect, useMemo, useState } from 'react';
import { Menu, Search, X } from 'lucide-react';
import { useWorkplace } from '../App.jsx';
import { sessionFiles } from '../lib/api.js';
import { findDm } from '../lib/dm.js';
import { ArtifactCard, useFilePane } from './Files.jsx';
import { Markdown } from './Markdown.jsx';

export default function ArtifactsPage() {
  const { me, cards, teammates, groupCards, docs, openDrawer } = useWorkplace();
  const [items, setItems] = useState(null);
  const [q, setQ] = useState('');
  const files = useFilePane({ renderMarkdown: (text) => <Markdown text={text} /> });

  // The conversations to read: each teammate's direct message, each group's teammate sessions;
  // every session names the teammate whose work it holds, which is who made the files in it.
  const convs = useMemo(() => {
    const out = [];
    const byId = new Map((teammates || []).map((t) => [t.id, t]));
    for (const t of teammates || []) {
      const c = findDm(cards, t.id, me);
      if (c) out.push({ key: `dm:${t.id}`, room: 'Direct message', sessions: [{ sid: c.id, teammate: t }] });
    }
    for (const g of groupCards) {
      const d = docs[g.id];
      const name = d?.name || String(g.title || '').replace(/^#/, '');
      const sessions = Object.entries(d?.bots || {}).filter(([, b]) => b?.session).map(([id, b]) => ({ sid: b.session, teammate: byId.get(id) || null }));
      if (sessions.length) out.push({ key: `g:${g.id}`, room: `#${name}`, sessions });
    }
    return out;
  }, [teammates, cards, me, groupCards, docs]);

  // Re-read when the SET of conversations changes, not when the session list is polled again
  // (that gave the page a fresh "Looking…" every five seconds). What is on screen stays until
  // the new read has something to say.
  const convKey = convs.map((c) => `${c.key}:${c.sessions.map((s) => s.sid).join('+')}`).join('|');
  useEffect(() => {
    let alive = true;
    const list = convs;
    (async () => {
      const out = [];
      for (const c of list) {
        for (const s of c.sessions) {
          const fs = await sessionFiles(s.sid).catch(() => []);
          for (const file of fs) out.push({ file, teammate: s.teammate, room: c.room, convKey: c.key });
        }
      }
      if (alive) setItems(out);
    })();
    return () => { alive = false; };
  }, [convKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The search reads what the card shows: the name, the type, who made it and where.
  const needle = q.trim().toLowerCase();
  const shown = items === null ? null : (needle ? items.filter(({ file, teammate, room }) =>
    [file.filename, file.path, teammate?.name, room].some((v) => String(v || '').toLowerCase().includes(needle))) : items);
  const rooms = new Set((items || []).map((i) => i.convKey)).size;
  const total = (items || []).length;
  return (
    <div className={`wp-page${files.file ? ' has-preview' : ''}`}>
      <header className="wp-head is-page">
        <button type="button" className="wp-iconbtn wp-menubtn" onClick={openDrawer} aria-label="Rooms"><Menu size={20} /></button>
        <div className="wp-head-titles"><h1 className="wp-head-title">Artifacts</h1><div className="wp-head-sub">{items === null ? 'Looking…' : `${total} file${total === 1 ? '' : 's'} across ${rooms} conversation${rooms === 1 ? '' : 's'}`}</div></div>
        <label className="wp-search wp-lib-search">
          <Search size={14} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search artifacts" aria-label="Search artifacts" />
          {q ? <button type="button" className="wp-search-x" onClick={() => setQ('')} aria-label="Clear"><X size={12} /></button> : null}
        </label>
      </header>
      <div className="wp-page-row">
      <div className="wp-page-scroll">
        <div className="wp-lib">
          {items && !items.length ? <p className="wp-lib-empty">Nothing yet. Ask a teammate for a report, a spreadsheet or an image; what they make lands here.</p> : null}
          {shown && !shown.length && items && items.length ? <p className="wp-lib-empty">Nothing matches "{q}".</p> : null}
          {shown && shown.length ? (
            <div className="wp-grid">
              {shown.map(({ file, teammate, room }) => (
                <ArtifactCard key={`${file.container_id}:${file.file_id}`} file={file} teammate={teammate} room={room} onOpen={files.open} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {files.pane}
      </div>
    </div>
  );
}
