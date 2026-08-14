// One agent cell, in full: the whole answer, the steps it took, and the files it produced.
//
// The grid cell holds a truncated copy of the answer so the sheet stays small and exports stay
// readable. Nothing is lost — the untruncated text is in the turn itself, which is what this
// panel reads, and which replays live while the turn is still going.
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { CodeBlock, ToolGroup } from 'reifyui';
import { containerFileUrl, sessionTurns } from 'reifyui/harness';
import { consoleSessionUrl } from '../lib/sh';

const POLL_MS = 1000;

const ext = (name) => String(name || '').split('.').pop().toLowerCase();
const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
const TEXT = ['md', 'txt', 'json', 'csv', 'tsv', 'py', 'js', 'ts', 'jsx', 'tsx', 'sh', 'yaml', 'yml', 'html', 'css', 'sql'];
const LANG = { md: 'markdown', py: 'python', js: 'javascript', ts: 'typescript', sh: 'bash', yml: 'yaml' };

function bytesLabel(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/** One produced file: images inline, text in a code block, anything else a download link. */
function Artifact({ artifact }) {
  const url = containerFileUrl(artifact.container_id, artifact.file_id);
  const e = ext(artifact.filename);
  const [text, setText] = useState(null);
  const [size, setSize] = useState(artifact.bytes ?? null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || !TEXT.includes(e) || text !== null) return undefined;
    let dead = false;
    fetch(url, { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((t) => { if (!dead) { setText(t); setSize(t.length); } })
      .catch(() => { if (!dead) setText(''); });
    return () => { dead = true; };
  }, [open, e, url, text]);

  if (IMAGE.includes(e)) {
    return (
      <div className="cd-art">
        <div className="cd-art-h"><b>{artifact.filename}</b>
          <a href={url} download={artifact.filename}>Download</a></div>
        <img className="cd-art-img" src={url} alt={artifact.filename} />
      </div>
    );
  }
  return (
    <div className="cd-art">
      <div className="cd-art-h">
        <b>{artifact.filename}</b>
        {size != null && <span className="cd-art-size">{bytesLabel(size)}</span>}
        {TEXT.includes(e) && (
          <button className="linkish" onClick={() => setOpen((v) => !v)}>{open ? 'Hide' : 'Preview'}</button>
        )}
        <a href={url} download={artifact.filename}>Download</a>
      </div>
      {open && TEXT.includes(e) && (
        text === null ? <div className="cd-note">Loading…</div>
                      : <CodeBlock code={text} lang={LANG[e] || e} />
      )}
    </div>
  );
}

export function CellDrawer({ cell, column, rowIndex, agentName, onClose, onLive }) {
  // The agent id lives on the column, not on the cell: the cell records which session ran,
  // and the console's deep link needs both.
  const harnessId = column?.harness?.harness_id || '';
  const [turns, setTurns] = useState(null);
  const sid = cell?.session_id;
  const runningNow = cell?.status === 'running';

  useEffect(() => {
    if (!sid) return undefined;
    let dead = false;
    const load = () => sessionTurns(sid).then((t) => { if (!dead) setTurns(t); }).catch(() => {});
    load();
    if (!runningNow) return () => { dead = true; };
    // The turn replay serves a running turn too, so one mechanism covers both watching it happen
    // and reading it afterwards — including in a tab that was reopened and has no stream.
    const iv = window.setInterval(load, POLL_MS);
    return () => { dead = true; window.clearInterval(iv); };
  }, [sid, runningNow]);

  const text = useMemo(() => {
    const parts = (turns || []).map((t) => t.assistant).filter(Boolean);
    return parts.join('\n\n');
  }, [turns]);

  // While this cell runs, its first line is worth showing in the grid — this is the only place
  // already polling for it, so the grid gets it from here rather than starting its own poll.
  useEffect(() => {
    if (!onLive) return;
    onLive(runningNow ? (text.split('\n').find(Boolean) || '').slice(0, 160) : '');
  }, [text, runningNow, onLive]);

  const steps = useMemo(
    () => (turns || []).flatMap((t) => (t.tools || []).map((x) => ({ name: x.name, args: x.arguments, result: x.result }))),
    [turns],
  );

  const duration = cell?.started_at && cell?.ended_at
    ? `${Math.max(0, cell.ended_at - cell.started_at)}s` : '';

  return (
    <aside className="cd" role="dialog" aria-label={`${column?.name}, row ${rowIndex + 1}`}>
      <header className="cd-h">
        <div className="cd-h-main">
          <b>{column?.name}</b> · row {rowIndex + 1}
          <div className="cd-sub">
            {agentName || 'Agent'}
            {cell?.status ? ` · ${cell.status}` : ''}
            {duration ? ` · ${duration}` : ''}
          </div>
        </div>
        <button className="pane-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </header>

      <div className="cd-body scroll">
        {cell?.error && <div className="cd-err">{cell.error}</div>}

        {!sid && !cell?.error && <div className="cd-note">This cell has not been run yet.</div>}

        {sid && turns === null && <div className="cd-note">Loading the conversation…</div>}

        {text && <div className="cd-text">{text}</div>}
        {sid && turns !== null && !text && !cell?.error && (
          <div className="cd-note">{runningNow ? 'Working…' : 'This turn produced no text.'}</div>
        )}

        {steps.length > 0 && <ToolGroup steps={steps} />}

        {cell?.artifacts?.length > 0 && (
          <section className="cd-arts">
            <h4>Files</h4>
            {cell.artifacts.map((a) => <Artifact key={a.file_id} artifact={a} />)}
          </section>
        )}
        {runningNow && (
          <div className="cd-note">Files appear when the agent finishes.</div>
        )}
      </div>

      {sid && (
        <footer className="cd-f">
          <a className="btn" href={consoleSessionUrl(harnessId, sid)} target="_blank" rel="noreferrer">
            Open the full conversation <ExternalLink size={13} />
          </a>
        </footer>
      )}
    </aside>
  );
}
