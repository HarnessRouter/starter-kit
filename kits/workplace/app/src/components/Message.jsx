// One message in a room, the way a team chat draws it: face, name, time, then the text and the
// files. A teammate's turn in progress uses the shared assistant turn, so the tools it is using
// show inside its own message rather than in a panel somewhere else.
import React from 'react';
import { AssistantTurn } from 'reifyui';
import { Avatar, MemberAvatar } from '../lib/avatars.jsx';
import { Markdown } from './Markdown.jsx';
import { FileChips } from './Files.jsx';

export function fmtTime(at) {
  if (!at) return '';
  try { return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}
export function dayLabel(at) {
  const d = new Date(at), now = new Date();
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, now)) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (same(d, y)) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}
export function DayDivider({ at }) {
  return <div className="wp-day" role="separator"><span>{dayLabel(at)}</span></div>;
}

export function SystemLine({ text }) {
  return <div className="wp-sys">{text}</div>;
}

const md = (teammates, onMention) => (t) => <Markdown text={t} teammates={teammates} onMention={onMention} />;

/**
 * from: { kind: 'teammate' | 'member', name, avatar }
 * body: text (markdown) — or `turn` ({ blocks, status }) for a teammate's turn with its tools.
 */
export function MessageRow({ from, at, text, turn, files, teammates, onMention, onOpenFile, onName, workingLabel, footer, attachments }) {
  const isBot = from.kind === 'teammate';
  return (
    <div className={`wp-msg${turn?.status === 'running' ? ' is-live' : ''}`}>
      <div className="wp-msg-ava">{isBot ? <Avatar id={from.avatar} size={36} /> : <MemberAvatar name={from.name} size={36} />}</div>
      <div className="wp-msg-body">
        <div className="wp-msg-head">
          <button type="button" className="wp-msg-name" onClick={onName} disabled={!onName}>{from.name}</button>
          {at ? <time className="wp-msg-time" dateTime={new Date(at).toISOString()}>{fmtTime(at)}</time> : null}
        </div>
        {turn ? (
          <AssistantTurn msg={turn} renderMarkdown={md(teammates, onMention)} workingLabel={workingLabel || `${from.name} is working…`} />
        ) : (
          <div className="wbx-md wp-msg-text"><Markdown text={text} teammates={teammates} onMention={onMention} /></div>
        )}
        {attachments && attachments.length ? (
          <div className="wp-attached">{attachments.map((a, i) => <span key={i} className="wp-attached-chip">{a.name}</span>)}</div>
        ) : null}
        <FileChips files={files} onOpen={onOpenFile} />
        {footer}
      </div>
    </div>
  );
}

export function TypingRow({ from, label }) {
  return (
    <div className="wp-msg is-typing" aria-live="polite">
      <div className="wp-msg-ava"><Avatar id={from.avatar} size={36} working /></div>
      <div className="wp-msg-body">
        <div className="wp-msg-head"><span className="wp-msg-name">{from.name}</span></div>
        <div className="wbx-working"><span className="wbx-working-dots"><span /><span /><span /></span><span className="wbx-working-txt">{label || 'is writing…'}</span></div>
      </div>
    </div>
  );
}
