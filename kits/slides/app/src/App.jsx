// Slides — one deck per conversation.
//
// Two screens. The list is every session on this kit's Harness; opening one is opening its deck.
// There is no deck database: the agent writes deck.json into the session's workspace and this
// reads it back, so the thing on screen and the thing the agent edits are the same file.
import { useCallback, useEffect, useState } from 'react';
import { ask, listDecks, loadDeck, slidesHarness } from './api.js';
import { Slide, Stage } from './Stage.jsx';

function useRoute() {
  const read = () => new URLSearchParams(window.location.search).get('deck') || '';
  const [deck, setDeck] = useState(read);
  useEffect(() => {
    const onPop = () => setDeck(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = (id) => {
    const url = id ? `/kits/slides/?deck=${encodeURIComponent(id)}` : '/kits/slides/';
    window.history.pushState({}, '', url);
    setDeck(id || '');
  };
  return [deck, go];
}

function DeckList({ harness, onOpen }) {
  const [decks, setDecks] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!harness) return;
    listDecks(harness.id).then(setDecks).catch((e) => setErr(String(e.message || e)));
  }, [harness]);

  return (
    <div className="sl-page">
      <header className="sl-head">
        <h1>Slides</h1>
        <button className="sl-btn sl-primary" onClick={() => onOpen('new')}>New deck</button>
      </header>
      {err && <p className="sl-error">{err}</p>}
      {decks === null && !err && <div className="sl-grid">{[0, 1, 2].map((i) => <div key={i} className="sl-card sl-skel" />)}</div>}
      {decks?.length === 0 && (
        <p className="sl-empty">No decks yet. Start one and describe what you need —
          the agent designs the structure before it writes a single slide.</p>
      )}
      {decks?.length > 0 && (
        <div className="sl-grid">
          {decks.map((d) => (
            <button key={d.id} className="sl-card" onClick={() => onOpen(d.id)}>
              <span className="sl-card-thumb"><span className="sl-card-icon">▦</span></span>
              <span className="sl-card-title">{d.title}</span>
              <span className="sl-card-meta">{d.status || 'deck'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DeckView({ harness, deckId, onBack, onSession }) {
  const [deck, setDeck] = useState(null);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sid, setSid] = useState(deckId);

  const refresh = useCallback(async (id) => {
    if (!id) return;
    const d = await loadDeck(id).catch(() => null);
    if (d) setDeck(d);
  }, []);
  useEffect(() => { void refresh(sid); }, [sid, refresh]);

  async function send() {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true); setErr(''); setPrompt('');
    try {
      const res = await ask(harness.id, sid, text);
      const next = res?.metadata?.session_id || res?.session_id || sid;
      if (next && next !== sid) { setSid(next); onSession?.(next); }
      await refresh(next);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  const slides = deck?.slides || [];
  const slide = slides[Math.min(idx, Math.max(0, slides.length - 1))];

  return (
    <div className="sl-deck">
      <header className="sl-head">
        <button className="sl-btn" onClick={onBack}>← All decks</button>
        <h1>{deck?.meta?.title || 'New deck'}</h1>
        <button className="sl-btn" onClick={() => window.print()} disabled={!slides.length}>Print / PDF</button>
      </header>

      <div className="sl-body">
        <aside className="sl-filmstrip">
          {slides.map((s, i) => (
            <button key={s.id || i} className={`sl-thumb ${i === idx ? 'on' : ''}`} onClick={() => setIdx(i)}>
              <span className="sl-thumb-n">{i + 1}</span>
              <span className="sl-thumb-stage"><Slide slide={s} theme={deck?.theme} /></span>
            </button>
          ))}
        </aside>

        <main className="sl-canvas">
          {slide
            ? <Stage slide={slide} theme={deck?.theme} selectedId={selected}
                     onPointerDownEl={(e, el) => { e.stopPropagation(); setSelected(el.id); }} />
            : <div className="sl-blank">
                <p>{busy ? 'Designing…' : 'Describe the deck you want.'}</p>
              </div>}
        </main>

        <aside className="sl-chat">
          {err && <p className="sl-error">{err}</p>}
          <p className="sl-hint">
            Ask for a deck, or for a change to this one. Every edit goes through the agent, which
            rewrites deck.json.
          </p>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder="A 6-slide deck introducing our Q3 results…"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(); }} />
          <button className="sl-btn sl-primary" onClick={() => void send()} disabled={busy || !prompt.trim()}>
            {busy ? 'Working…' : 'Send'}
          </button>
        </aside>
      </div>

      {/* Print view: every slide, one per page. Hidden on screen. */}
      <div className="sl-print">
        {slides.map((s, i) => <div key={s.id || i} className="sl-print-page"><Slide slide={s} theme={deck?.theme} /></div>)}
      </div>
    </div>
  );
}

export default function App() {
  const [deckId, go] = useRoute();
  const [harness, setHarness] = useState(undefined);

  useEffect(() => { slidesHarness().then(setHarness).catch(() => setHarness(null)); }, []);

  if (harness === undefined) return <div className="sl-page"><div className="sl-card sl-skel" /></div>;
  if (harness === null) {
    return (
      <div className="sl-page">
        <p className="sl-empty">This kit has not been launched yet. Open Starter Kits in the
          console and launch Slides — that provisions the Harness this app talks to.</p>
      </div>
    );
  }
  // 'new' is a deck with no session yet: the first message creates the session, and from then on
  // the URL carries its id like any other deck.
  return deckId
    ? <DeckView harness={harness} deckId={deckId === 'new' ? '' : deckId}
                onBack={() => go('')} onSession={(id) => go(id)} />
    : <DeckList harness={harness} onOpen={(id) => go(id)} />;
}
