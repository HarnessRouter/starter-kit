// Opening a group: a name, a topic, the teammates. Opened by the sidebar's button through one
// window event, so the host lives once at the root and the sidebar knows nothing about it.
import React, { useEffect, useState } from 'react';
import { Modal, Field, Input, Button, FormActions } from 'reifyui';
import { useWorkplace } from '../App.jsx';
import { Avatar } from '../lib/avatars.jsx';
import { cleanGroupName } from '../lib/groupdoc.js';
import { createGroup } from '../lib/groups.js';

export default function NewGroup() {
  const { me, teammates, navigate, refreshCards, setDoc } = useWorkplace();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    const on = () => { setOpen(true); setName(''); setTopic(''); setPicked((teammates || []).slice(0, 3).map((t) => t.id)); setErr(''); setBusy(''); };
    window.addEventListener('wp:new-group', on);
    return () => window.removeEventListener('wp:new-group', on);
  }, [teammates]);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    const clean = cleanGroupName(name);
    if (!name.trim()) { setErr('Give the group a name.'); return; }
    if (!picked.length) { setErr('Pick at least one teammate.'); return; }
    setErr('');
    try {
      const doc = await createGroup({ name: clean, topic, members: picked, me, onStep: setBusy });
      setDoc(doc.id, doc);
      await refreshCards();
      setOpen(false);
      navigate(`group/${doc.id}`);
    } catch (e2) { setErr(e2?.message || 'The group could not be opened.'); }
    finally { setBusy(''); }
  };

  return (
    <Modal open={open} onClose={() => { if (!busy) setOpen(false); }} title="New group" description="A room where several teammates work with you. They answer when it is their turn, or when you @mention them.">
      <form onSubmit={submit} className="wp-form">
        <Field label="Name" htmlFor="g-name"><Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="design" autoFocus disabled={!!busy} /></Field>
        {name.trim() ? <div className="wp-form-hint">#{cleanGroupName(name)}</div> : null}
        <Field label="What is it for" htmlFor="g-topic" hint="Optional. Every teammate sees it."><Input id="g-topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="the spring launch" disabled={!!busy} /></Field>
        <div className="uic-field"><div className="uic-field-label">Teammates</div>
          <div className="wp-pick">
            {(teammates || []).map((t) => {
              const on = picked.includes(t.id);
              return (
                <button key={t.id} type="button" role="checkbox" aria-checked={on} className={`wp-pick-item${on ? ' is-on' : ''}`} disabled={!!busy}
                        onClick={() => setPicked((p) => (on ? p.filter((x) => x !== t.id) : [...p, t.id]))}>
                  <Avatar id={t.avatar} size={28} /><span className="wp-pick-name">{t.name}</span><span className="wp-pick-sub">{t.tagline}</span>
                </button>
              );
            })}
          </div>
        </div>
        {err ? <div className="wp-err" role="alert">{err}</div> : null}
        {busy ? <div className="wp-form-busy" aria-live="polite">{busy}…</div> : null}
        <FormActions>
          <Button variant="default" onClick={() => setOpen(false)} disabled={!!busy}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!!busy}>Open the group</Button>
        </FormActions>
      </form>
    </Modal>
  );
}
