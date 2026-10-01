// Files a teammate made, as they appear under a bubble and in the panel: an image shows itself,
// anything else is a small white card with its type, name and size; both open the preview.
import React, { useEffect, useState } from 'react';
import { FilePreview, FileTypeIcon, bytesLabel } from 'reifyui';
import { isImage } from '../lib/api.js';
import { Avatar } from '../lib/avatars.jsx';

export const kindOf = (name) => { const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1].toUpperCase() : 'File'; };
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

export function ArtifactPreview({ file }) {
  if (isImage(file)) return <img src={file.url} alt="" loading="lazy" />;
  if (TEXTY.test(file.filename) && (file.bytes == null || file.bytes <= SNIPPET_MAX_BYTES)) return <Snippet file={file} />;
  return <span className="wp-art-ic"><FileTypeIcon name={file.filename} size={44} /></span>;
}

/** One artifact as a card: the file itself in view (an image, the first lines of a document or a
 *  script, otherwise its type), its name, type and size, and who made it where. The library's
 *  grid and a channel's rail draw the same card; the rail's is the compact one. */
export function ArtifactCard({ file, teammate, room, compact = false, onOpen }) {
  return (
    <button type="button" className={`wp-art${compact ? ' is-compact' : ''}`} onClick={() => onOpen?.(file)} title={file.path || file.filename}>
      <span className="wp-art-prev"><ArtifactPreview file={file} /></span>
      <span className="wp-art-body">
        <span className="wp-art-name">{file.filename}</span>
        <span className="wp-art-sub">{kindOf(file.filename)}{file.bytes != null ? ` · ${bytesLabel(file.bytes)}` : ''}</span>
        {teammate || room ? (
          <span className="wp-art-by">
            {teammate ? <Avatar avatar={teammate.avatar} id={teammate.id} size={18} /> : null}
            <span className="wp-art-by-name">{teammate ? teammate.name : 'A teammate'}</span>
            {room ? <span className="wp-art-by-room">· {room}</span> : null}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function FileChips({ files, onOpen }) {
  if (!files || !files.length) return null;
  return (
    <div className="wp-files">
      {files.map((f) => (isImage(f) ? (
        <button key={f.file_id} type="button" className="wp-file-img" onClick={() => onOpen?.(f)} title={f.filename}>
          <img src={f.url} alt={f.filename} loading="lazy" />
        </button>
      ) : (
        <button key={f.file_id} type="button" className="wp-file-card" onClick={() => onOpen?.(f)} title={f.path || f.filename}>
          <span className="wp-file-ic"><FileTypeIcon name={f.filename} size={26} /></span>
          <span className="wp-file-meta">
            <span className="wp-file-name">{f.filename}</span>
            <span className="wp-file-sub">{kindOf(f.filename)}{f.bytes != null ? ` · ${bytesLabel(f.bytes)}` : ''}</span>
          </span>
        </button>
      )))}
    </div>
  );
}

const MIN_W = 360;
const MAX_FRAC = 0.62;

/** The preview, as a pane the room makes room for: the console's task page shows an artifact
 *  the same way, beside the conversation with a handle to resize it. Below 1024px the pane takes
 *  the room, since there is nothing to push; Close brings the conversation back. */
/** A spreadsheet's tabs as rows for the shared viewer. The library loads only when a sheet is
 *  opened, so it is not in the bundle of a workplace that never makes one. */
async function parseWorkbook(buf) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array' });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name] || {};
    const filled = Boolean(ws['!ref']);
    return { name, filled, rows: filled ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }).map((r) => r.map((c) => String(c ?? ''))) : [] };
  });
}

export function FilePane({ file, onClose, width, onWidth, renderMarkdown }) {
  useEffect(() => {
    if (!file) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [file, onClose]);
  const drag = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const room = e.currentTarget.parentElement;
    const move = (ev) => {
      const r = room.getBoundingClientRect();
      const w = Math.min(Math.max(r.right - ev.clientX, MIN_W), r.width * MAX_FRAC);
      onWidth?.(Math.round(w));
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.style.cursor = ''; };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  if (!file) return null;
  return (
    <>
      <div className="wp-vresize" onMouseDown={drag} role="separator" aria-orientation="vertical" aria-label="Resize the preview" />
      <aside className="wp-preview" style={width ? { width } : undefined} aria-label={`Preview of ${file.filename}`}>
        <FilePreview file={{ url: file.url, name: file.filename }} onClose={onClose} renderMarkdown={renderMarkdown} parseWorkbook={parseWorkbook} />
      </aside>
    </>
  );
}

export function useFilePane({ renderMarkdown } = {}) {
  const [file, setFile] = useState(null);
  const [width, setWidth] = useState(null);
  const close = () => setFile(null);
  return { file, open: setFile, close,
           pane: <FilePane file={file} onClose={close} width={width} onWidth={setWidth} renderMarkdown={renderMarkdown} /> };
}

/** Kept under its old name for the rooms that still say it. */
export const useFileOverlay = useFilePane;
