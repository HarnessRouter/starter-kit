// In-app dialogs. House rule: never window.alert / confirm / prompt.
import { useEffect, useRef, useState } from 'react';

export function Dialog({ onClose, children, width }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="dlg-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="dlg" style={width ? { width } : undefined} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, body, confirmLabel = 'Delete', busy, onConfirm, onClose }) {
  return (
    <Dialog onClose={busy ? undefined : onClose}>
      <h3>{title}</h3>
      <div className="body">{body}</div>
      <div className="foot">
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn danger" onClick={onConfirm} disabled={busy}>
          {busy ? 'Working...' : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

export function NameDialog({ title, body, defaultValue = '', confirmLabel = 'Create', busy, onSubmit, onClose }) {
  const [value, setValue] = useState(defaultValue);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const ok = value.trim().length > 0;
  return (
    <Dialog onClose={busy ? undefined : onClose}>
      <h3>{title}</h3>
      {body && <div className="body">{body}</div>}
      <form onSubmit={(e) => { e.preventDefault(); if (ok && !busy) onSubmit(value.trim()); }}>
        <input
          ref={ref}
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Deck name"
          maxLength={80}
        />
        <div className="foot">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!ok || busy}>
            {busy ? 'Creating...' : confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
