// Messages as bubbles: the person in black on the right, a teammate in grey on the left with its
// face on the first bubble of a run, a small centred time label where the conversation paused.
// A teammate's turn in progress uses the shared assistant turn inside its bubble, so the tools it
// is using show where its words will appear.
import React from 'react';
import { AssistantTurn } from 'reifyui';
import { Avatar, MemberAvatar } from '../lib/avatars.jsx';
import { Markdown } from './Markdown.jsx';
import { FileChips } from './Files.jsx';

export const PAUSE_MS = 15 * 60 * 1000;

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function fmtTime(at) {
  try { return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; }
}

/** "9:41 AM" today, "Yesterday 9:41 AM", "Mon 9:41 AM", or the date for older. */
export function whenLabel(at, withTime = true) {
  if (!at) return '';
  const d = new Date(at), now = new Date();
  const time = fmtTime(at);
  if (sameDay(d, now)) return time;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return withTime ? `Yesterday ${time}` : 'Yesterday';
  if (now - d < 6 * 86400000) { const w = d.toLocaleDateString([], { weekday: 'short' }); return withTime ? `${w} ${time}` : w; }
  const ds = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return withTime ? `${ds} ${time}` : ds;
}

export function TimeLabel({ at }) {
  return <div className="wp-when" role="separator"><span>{whenLabel(at)}</span></div>;
}

export function SystemLine({ text }) {
  return <div className="wp-sys">{text}</div>;
}

const md = (teammates, onMention) => (t) => <Markdown text={t} teammates={teammates} onMention={onMention} />;

/**
 * from: { kind: 'me' | 'teammate' | 'member', name, avatar, id }
 * first: the first bubble of a run from this sender (face and name shown)
 * text (markdown) or turn ({ blocks, status }) for a teammate's turn with its tools.
 */
export function Bubble({ from, first = true, text, turn, files, attachments, teammates, onMention, onOpenFile, onName, workingLabel }) {
  const me = from.kind === 'me';
  const live = turn?.status === 'running';
  return (
    <div className={`wp-b${me ? ' is-me' : ' is-them'}${first ? ' is-first' : ''}${live ? ' is-live' : ''}`}>
      {!me ? (
        <span className="wp-b-ava">
          {first ? (from.kind === 'teammate' ? <Avatar avatar={from.avatar} id={from.id} size={28} /> : <MemberAvatar name={from.name} size={28} />) : null}
        </span>
      ) : null}
      <div className="wp-b-col">
        {!me && first ? <button type="button" className="wp-b-name" onClick={onName} disabled={!onName}>{from.name}</button> : null}
        <div className="wp-b-bubble">
          {turn ? (
            <AssistantTurn msg={turn} renderMarkdown={md(teammates, onMention)} workingLabel={workingLabel || `${from.name} is working…`} />
          ) : (
            <div className="wbx-md wp-b-text"><Markdown text={text} teammates={teammates} onMention={onMention} /></div>
          )}
          {attachments && attachments.length ? (
            <div className="wp-attached">{attachments.map((a, i) => <span key={i} className="wp-attached-chip">{a.name}</span>)}</div>
          ) : null}
        </div>
        <FileChips files={files} onOpen={onOpenFile} />
      </div>
    </div>
  );
}

export function TypingBubble({ from, label }) {
  return (
    <div className="wp-b is-them is-first is-typing" aria-live="polite">
      <span className="wp-b-ava"><Avatar avatar={from.avatar} id={from.id} size={28} working /></span>
      <div className="wp-b-col">
        <span className="wp-b-name">{from.name}</span>
        <div className="wp-b-bubble"><span className="wp-typing" aria-label={label || `${from.name} is writing`}><span /><span /><span /></span></div>
      </div>
    </div>
  );
}

/** Lay a list of {at, ...} items out with time labels at every pause. */
export function withTimeLabels(items, keyOf) {
  const out = [];
  let last = 0;
  for (const it of items) {
    const at = Number(it.at) || 0;
    if (at && (!last || at - last > PAUSE_MS)) { out.push(<TimeLabel key={`t${keyOf(it)}`} at={at} />); }
    if (at) last = at;
    out.push(it.node);
  }
  return out;
}
