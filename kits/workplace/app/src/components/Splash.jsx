// The screens that are not a conversation: loading, not launched, no identity, nothing picked.
import React from 'react';
import { Users } from 'lucide-react';

const COPY = {
  loading: { title: 'Opening the workplace', text: '' },
  unlaunched: { title: 'This workplace has not been launched', text: 'Open Starter Kits in the console and launch My Workplace. That sets up the recruiter this app talks to; nothing else is deployed.' },
  noidentity: { title: 'Who is here?', text: 'The console did not say who is signed in, so direct messages cannot be attributed. Sign in to the console and open this page again.' },
  pick: { title: 'Pick a teammate or a group', text: 'Your direct messages and groups are on the left. Every teammate remembers your conversation with them.' },
  missing: { title: 'Not here', text: '' },
  error: { title: 'Something went wrong', text: '' },
};

export function Splash({ kind, text, inline }) {
  const c = COPY[kind] || COPY.error;
  return (
    <div className={`wp-splash${inline ? ' is-inline' : ''}`} role={kind === 'error' ? 'alert' : undefined}>
      <div className="wp-splash-card">
        <span className="wp-splash-mark"><Users size={22} /></span>
        <h1>{c.title}</h1>
        {(text || c.text) ? <p>{text || c.text}</p> : null}
        {kind === 'loading' && <div className="wp-dots" aria-hidden="true"><span /><span /><span /></div>}
        {kind === 'unlaunched' && <a className="wp-btn is-primary" href="/kits">Open Starter Kits</a>}
      </div>
    </div>
  );
}
