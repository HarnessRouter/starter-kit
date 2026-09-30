// The right side of a room: the teammate's browser when one is open, who is at work, who is in
// the room, and what has been made here. Everything in it is derived from the sessions of this
// conversation; nothing is stored for it.
import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useWorkplace } from '../App.jsx';
import { Avatar } from '../lib/avatars.jsx';
import { sessionFiles } from '../lib/api.js';
import { BrowserCard } from './BrowserCard.jsx';
import { FileChips } from './Files.jsx';

/** The files of several sessions, refreshed when `key` changes. */
export function useArtifacts(sessions, key) {
  const [files, setFiles] = useState([]);
  const ids = sessions.filter(Boolean).join(',');
  useEffect(() => {
    let alive = true;
    if (!ids) { setFiles([]); return undefined; }
    Promise.all(ids.split(',').map((sid) => sessionFiles(sid).then((fs) => fs.map((f) => ({ ...f, session: sid }))).catch(() => [])))
      .then((all) => { if (alive) setFiles(all.flat()); });
    return () => { alive = false; };
  }, [ids, key]);
  return files;
}

export default function Rail({ open, onClose, teammate, members = [], sessions = [], live = {}, busySessions = [], refreshKey = 0, onOpenFile }) {
  const { teammates, navigate } = useWorkplace();
  const files = useArtifacts(sessions, refreshKey);
  const liveList = useMemo(() => Object.entries(live || {}).filter(([, v]) => v), [live]);
  const browsers = useMemo(() => {
    const out = new Map();
    for (const [id, v] of liveList) if (v.session) out.set(v.session, { sid: v.session, busy: true, name: (teammates || []).find((t) => t.id === id)?.name });
    for (const b of busySessions) if (b?.sid && !out.has(b.sid)) out.set(b.sid, b);
    return [...out.values()];
  }, [liveList, busySessions, teammates]);

  return (
    <aside className={`wp-rail${open ? ' is-open' : ''}`} aria-label="Details">
      <div className="wp-rail-head">
        <span>Details</span>
        <button type="button" className="wp-iconbtn" onClick={onClose} aria-label="Close details"><X size={18} /></button>
      </div>
      <div className="wp-rail-scroll">
        {browsers.map((b) => <BrowserCard key={b.sid} sid={b.sid} busy={b.busy} name={b.name} />)}

        {liveList.length ? (
          <section className="wp-rail-sec">
            <h3>Working now</h3>
            {liveList.map(([id, v]) => {
              const t = (teammates || []).find((x) => x.id === id);
              const last = v.steps && v.steps.length ? v.steps[v.steps.length - 1].name : '';
              return t ? (
                <div key={id} className="wp-rail-row">
                  <Avatar id={t.avatar} size={22} working />
                  <span className="wp-rail-row-name">{t.name}</span>
                  <span className="wp-rail-row-sub">{last || 'thinking'}</span>
                </div>
              ) : null;
            })}
          </section>
        ) : null}

        {teammate ? (
          <section className="wp-rail-sec">
            <h3>About {teammate.name}</h3>
            <div className="wp-about">
              <Avatar id={teammate.avatar} size={56} />
              <div className="wp-about-tag">{teammate.tagline}</div>
              {teammate.expertise.length ? <div className="wp-tags">{teammate.expertise.map((e) => <span key={e} className="wp-tag">{e}</span>)}</div> : null}
              <div className="wp-about-meta">
                {teammate.createdBy ? <div>Hired by {teammate.createdBy}</div> : null}
                {teammate.base ? <div>Runs on {teammate.base}{teammate.model ? ` · ${teammate.model}` : ''}</div> : null}
              </div>
            </div>
          </section>
        ) : null}

        {members.length ? (
          <section className="wp-rail-sec">
            <h3>In this group</h3>
            {members.map((t) => (
              <button key={t.id} type="button" className="wp-rail-row is-link" onClick={() => navigate(`dm/${t.id}`)}>
                <Avatar id={t.avatar} size={22} working={!!live?.[t.id]} />
                <span className="wp-rail-row-name">{t.name}</span>
                <span className="wp-rail-row-sub">{t.tagline}</span>
              </button>
            ))}
          </section>
        ) : null}

        <section className="wp-rail-sec">
          <h3>Artifacts here <span className="wp-count">{files.length}</span></h3>
          {files.length ? <FileChips files={files} onOpen={onOpenFile} /> : <p className="wp-rail-empty">Files a teammate makes in this conversation appear here.</p>}
          <button type="button" className="wp-linkbtn" onClick={() => navigate('artifacts')}>All artifacts</button>
        </section>
      </div>
    </aside>
  );
}
