// Files a teammate made, as they appear under a bubble and in the panel: an image shows itself,
// anything else is a small white card with its type, name and size; both open the preview.
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
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
  if (!file) return null;
  return createPortal(
    <div className="wp-overlay" role="dialog" aria-label={file.filename}>
      <div className="wp-overlay-head">
        <span className="wp-overlay-title">{file.path || file.filename}</span>
        <a className="wp-iconbtn is-light" href={file.url} download={file.filename} aria-label="Download"><Download size={18} /></a>
        <button type="button" className="wp-iconbtn is-light" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>
      <div className="wp-overlay-body"><FilePreview file={{ url: file.url, name: file.filename }} onClose={onClose} /></div>
    </div>,
    document.body,
  );
}

export function useFileOverlay() {
  const [file, setFile] = useState(null);
  return { file, open: setFile, close: () => setFile(null), overlay: <FileOverlay file={file} onClose={() => setFile(null)} /> };
}
