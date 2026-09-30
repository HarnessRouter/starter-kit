// The message box: one pill. Attach on the left, the editor in the middle (type @ to pick a
// teammate in a group), send on the right once there is something to send. Enter sends,
// Shift+Enter breaks the line. Mentions come back resolved from the editor, never parsed.
import React, { useRef, useState } from 'react';
import { ArrowUp, Plus, X } from 'lucide-react';
import { MentionInput, mention } from 'reifyui';
import { fileToInputBlock } from 'reifyui/harness';
import { Avatar } from '../lib/avatars.jsx';

export default function Composer({ items = [], placeholder = 'Message', disabled = false, onSend, autoFocus = false, hint = '' }) {
  const [value, setValue] = useState('');
  const [mentions, setMentions] = useState([]);
  const [staged, setStaged] = useState([]);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);
  const canSend = !disabled && (value.trim() || staged.length);

  const send = () => {
    const text = value.trim();
    if (!canSend) return;
    onSend({ text, mentions: mentions.map((m) => m.id), files: staged.map((s) => s.payload),
             attachments: staged.map((s) => ({ name: s.name || s.payload?.filename || 'file', bytes: s.size ?? null })) });
    setValue(''); setMentions([]); setStaged([]); setErr('');
  };
  const pick = async (files) => {
    for (const f of files) {
      try { const blk = await fileToInputBlock(f); setStaged((s) => [...s, blk]); }
      catch (e) { setErr(e?.message || `${f.name} could not be attached.`); }
    }
  };

  return (
    <div className={`wp-composer${disabled ? ' is-disabled' : ''}`}>
      {staged.length ? (
        <div className="wp-staged">
          {staged.map((s, i) => (
            <span key={i} className="wp-staged-chip">{s.name || s.payload?.filename}
              <button type="button" aria-label={`Remove ${s.name || 'file'}`} onClick={() => setStaged((x) => x.filter((_, j) => j !== i))}><X size={12} /></button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="wp-pill">
        <button type="button" className="wp-pill-btn" onClick={() => fileRef.current?.click()} aria-label="Attach a file" disabled={disabled}><Plus size={18} /></button>
        <MentionInput className="wp-pill-input" value={value} onChange={(v, m) => { setValue(v); setMentions(m || []); }}
                      items={items} format={mention.AT} placeholder={placeholder} disabled={disabled}
                      submitOnEnter onSubmit={send} autoFocus={autoFocus} menuTitle="Teammates" emptyText="No teammate by that name"
                      renderIcon={(item) => <Avatar avatar={item.avatar} id={item.id} size={20} />} label="Message" />
        <button type="button" className={`wp-pill-send${canSend ? ' is-on' : ''}`} onClick={send} disabled={!canSend} aria-label="Send"><ArrowUp size={16} /></button>
      </div>
      {err ? <div className="wp-composer-err" role="alert">{err}</div> : hint ? <div className="wp-composer-hint">{hint}</div> : null}
      <input ref={fileRef} type="file" multiple hidden onChange={(e) => { pick([...e.target.files]); e.target.value = ''; }} />
    </div>
  );
}
