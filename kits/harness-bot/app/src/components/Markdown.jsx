// A message's text. Markdown, sanitised by the renderer (no raw HTML), with every @mention of a
// teammate shown as a chip that opens their direct message. Mentions become links in the source
// first — the one markdown construct a sanitiser lets through — and the link renderer draws
// them; every other link opens in a new tab.
import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { handleOf } from '../lib/builder.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `@Nova`, `@NovaLee` -> `[@Nova Lee](#m-<id>)`, longest key first so a prefix never wins. */
export function linkMentions(text, teammates) {
  const keys = [];
  for (const t of teammates || []) for (const k of new Set([handleOf(t.name), t.name])) if (k) keys.push({ k, t });
  if (!keys.length || !String(text || '').includes('@')) return String(text || '');
  keys.sort((a, b) => b.k.length - a.k.length);
  const re = new RegExp(`(^|[^\\p{L}\\p{N}_\\]\\[])@(${keys.map((x) => esc(x.k)).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  return String(text).replace(re, (m, pre, key) => {
    const hit = keys.find((x) => x.k.toLowerCase() === key.toLowerCase());
    return hit ? `${pre}[@${hit.t.name}](#m-${hit.t.id})` : m;
  });
}

export function Markdown({ text, teammates, onMention }) {
  const src = useMemo(() => linkMentions(text, teammates), [text, teammates]);
  const components = useMemo(() => ({
    a: ({ href, children }) => (String(href || '').startsWith('#m-')
      ? <button type="button" className="wp-mention" onClick={() => onMention?.(String(href).slice(3))}>{children}</button>
      : <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>),
  }), [onMention]);
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{src}</ReactMarkdown>;
}
