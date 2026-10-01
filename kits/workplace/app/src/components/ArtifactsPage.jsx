// The library: everything every teammate has made, as a grid of cards with the file itself in
// view (an image, the first lines of a document or a script, otherwise its type), who made it and
// in which room. Read from the sessions' workspaces when the page opens; nothing is indexed, so
// nothing can be out of date. A card opens the same viewer a task's artifact opens in the console.
import React, { useEffect, useMemo, useState } from 'react';
import { Menu } from 'lucide-react';
import { FileTypeIcon, bytesLabel } from 'reifyui';
import { useWorkplace } from '../App.jsx';
import { Avatar } from '../lib/avatars.jsx';
import { isImage, sessionFiles } from '../lib/api.js';
import { findDm } from '../lib/dm.js';
import { useFileOverlay } from './Files.jsx';

const kindOf = (name) => { const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1].toUpperCase() : 'File'; };
const TEXTY = /\.(md|markdown|txt|csv|tsv|json|ya?ml|toml|py|js|mjs|ts|tsx|jsx|html?|css|sh|sql|log|xml|svg|ini|cfg|env)$/i;
const DOCY = /\.(md|markdown|txt)$/i;
const SNIPPET_MAX_BYTES = 256 * 1024;
const snippets = new Map();   // url -> text, read once per page life

/** The first lines of a text file, read once. Nothing is shown until the bytes are here. */
function Snippet({ file }) {
  const [text, setText] = useState(snippets.get(file.url) ?? null);
  useEffect(() => {
    if (text !== null || snippets.has(file.url)) return undefined;
    let alive = true;
    fetch(file.url).then((r) => (r.ok ? r.text() : '')).then((t) => {
      const head = t.replace(/\r/g, '').split('\n').slice(0, 14).join('\n').slice(0, 700);
      snippets.set(file.url, head);
      if (alive) setText(head);
    }).catch(() => { snippets.set(file.url, ''); if (alive) setText(''); });
    return () => { alive = false; };
  }, [file.url, text]);
  if (!text) return <span className="wp-art-ic"><FileTypeIcon name={file.filename} size={44} /></span>;
  return <pre className={`wp-art-snip${DOCY.test(file.filename) ? ' is-doc' : ''}`} aria-hidden="true">{text}</pre>;
}

function Preview({ file }) {
  if (isImage(file)) return <img src={file.url} alt="" loading="lazy" />;
  if (TEXTY.test(file.filename) && (file.bytes == null || file.bytes <= SNIPPET_MAX_BYTES)) return <Snippet file={file} />;
  return <span className="wp-art-ic"><FileTypeIcon name={file.filename} size={44} /></span>;
}

export default function ArtifactsPage() {
  const { me, cards, teammates, groupCards, docs, openDrawer } = useWorkplace();
  const [items, setItems] = useState(null);
  const files = useFileOverlay();

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

  const rooms = new Set((items || []).map((i) => i.convKey)).size;
  const total = (items || []).length;
  return (
    <div className="wp-page">
      <header className="wp-head is-page">
        <button type="button" className="wp-iconbtn wp-menubtn" onClick={openDrawer} aria-label="Rooms"><Menu size={20} /></button>
        <div className="wp-head-titles"><h1 className="wp-head-title">Artifacts</h1><div className="wp-head-sub">{items === null ? 'Looking…' : `${total} file${total === 1 ? '' : 's'} across ${rooms} conversation${rooms === 1 ? '' : 's'}`}</div></div>
      </header>
      <div className="wp-page-scroll">
        <div className="wp-lib">
          {items && !items.length ? <p className="wp-lib-empty">Nothing yet. Ask a teammate for a report, a spreadsheet or an image; what they make lands here.</p> : null}
          {items && items.length ? (
            <div className="wp-grid">
              {items.map(({ file, teammate, room }) => (
                <button key={`${file.container_id}:${file.file_id}`} type="button" className="wp-art" onClick={() => files.open(file)} title={file.path || file.filename}>
                  <span className="wp-art-prev"><Preview file={file} /></span>
                  <span className="wp-art-body">
                    <span className="wp-art-name">{file.filename}</span>
                    <span className="wp-art-sub">{kindOf(file.filename)}{file.bytes != null ? ` · ${bytesLabel(file.bytes)}` : ''}</span>
                    <span className="wp-art-by">
                      {teammate ? <Avatar avatar={teammate.avatar} id={teammate.id} size={18} /> : null}
                      <span className="wp-art-by-name">{teammate ? teammate.name : 'A teammate'}</span>
                      <span className="wp-art-by-room">· {room}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {files.overlay}
    </div>
  );
}
