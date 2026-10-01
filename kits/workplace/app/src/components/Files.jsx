// Files a teammate made, as they appear under a bubble and in the panel: an image shows itself,
// anything else is a small white card with its type, name and size; both open the preview.
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FilePreview, FileTypeIcon, bytesLabel } from 'reifyui';
import { isImage } from '../lib/api.js';

const kindOf = (name) => { const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1].toUpperCase() : 'File'; };

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

export function FileOverlay({ file, onClose }) {
  // Escape closes, as every sheet in the console does.
  useEffect(() => {
    if (!file) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [file, onClose]);
  if (!file) return null;
  // The console's own viewer for a task's artifact (the shared FilePreview: its header carries the
  // type, the name, Download and Close; its body renders the file itself), in a centred sheet
  // over the room. The dark full-screen frame with a second header of its own is gone.
  return createPortal(
    <div className="wp-viewer-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="wp-viewer" role="dialog" aria-modal="true" aria-label={file.filename}>
        <FilePreview file={{ url: file.url, name: file.filename }} onClose={onClose} />
      </div>
    </div>,
    document.body,
  );
}

export function useFileOverlay() {
  const [file, setFile] = useState(null);
  return { file, open: setFile, close: () => setFile(null), overlay: <FileOverlay file={file} onClose={() => setFile(null)} /> };
}
