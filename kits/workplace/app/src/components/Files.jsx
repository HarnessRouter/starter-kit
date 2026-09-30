// Files a teammate made, as they appear under a message and in the rail: an image shows itself,
// anything else is a chip with its type; both open the preview.
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { FilePreview, FileTypeIcon, bytesLabel } from 'reifyui';
import { isImage } from '../lib/api.js';

export function FileChips({ files, onOpen }) {
  if (!files || !files.length) return null;
  return (
    <div className="wp-files">
      {files.map((f) => (isImage(f) ? (
        <button key={f.file_id} type="button" className="wp-file-img" onClick={() => onOpen?.(f)} title={f.filename}>
          <img src={f.url} alt={f.filename} loading="lazy" />
        </button>
      ) : (
        <button key={f.file_id} type="button" className="wp-file-chip" onClick={() => onOpen?.(f)} title={f.path || f.filename}>
          <FileTypeIcon name={f.filename} size={18} />
          <span className="wp-file-name">{f.filename}</span>
          {f.bytes != null ? <span className="wp-file-size">{bytesLabel(f.bytes)}</span> : null}
        </button>
      )))}
    </div>
  );
}

/** The preview, full screen, with a download that carries the console's session. */
export function FileOverlay({ file, onClose }) {
  if (!file) return null;
  return createPortal(
    <div className="wp-overlay" role="dialog" aria-label={file.filename}>
      <div className="wp-overlay-head">
        <span className="wp-overlay-title">{file.path || file.filename}</span>
        <a className="wp-iconbtn is-light" href={file.url} download={file.filename} aria-label="Download"><Download size={18} /></a>
        <button type="button" className="wp-iconbtn is-light" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>
      <div className="wp-overlay-body">
        <FilePreview file={{ url: file.url, name: file.filename }} onClose={onClose} />
      </div>
    </div>,
    document.body,
  );
}

/** One place that owns "which file is open". */
export function useFileOverlay() {
  const [file, setFile] = useState(null);
  return { file, open: setFile, close: () => setFile(null), overlay: <FileOverlay file={file} onClose={() => setFile(null)} /> };
}
