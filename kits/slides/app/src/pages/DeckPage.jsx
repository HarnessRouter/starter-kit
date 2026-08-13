// Deck page — the editor, on the CG/Flowness IA (one banner row): wordmark +
// home left, Slideshow + Export center, presence avatars + credits + avatar
// right. Body: LEFT slide rail (live mini-renders, auto-scrolled to the
// active slide), CENTER the EditorCanvas (direct manipulation: drag/resize/
// inline text/delete/nudge), RIGHT the copilot chat. Edits autosave (debounced
// PUT -> rev bump -> realtime publish); undo/redo is a snapshot stack; peers
// and copilot edits arrive over the Yjs channel and render live.
import { useCallback, useEffect, useRef, useState } from 'react';
import { HelpCircle, Home, Maximize2, Download } from 'lucide-react';
import { SlideView, EditorCanvas } from 'reifyui/slides';
import { Presentation } from 'reifyui/slides';
import { PaneResizer, useResizablePane } from 'reifyui';
import { chatHistory, deckStatus, getDeck, saveDeck, markViewed, workspaceFileIndex } from '../lib/sl';
import { authFetch, getSession } from '../lib/auth';
import { useDeckCollab } from '../lib/collab';
import { ChatColumn } from '../components/ChatPanel';
import { AvatarMenu, LINKS, Wordmark } from '../components/Topbar';

// Images the agent made live in the session workspace, so a deck's `src` is a path there rather
// than a URL. Resolve it against the session's file list; until that arrives, leave the path
// untouched so nothing renders a broken image with a guessed URL.
function useSrcResolver(id) {
  const [index, setIndex] = useState(null);
  useEffect(() => {
    if (!id || String(id).startsWith('new:')) { setIndex(null); return undefined; }
    let dead = false;
    workspaceFileIndex(id).then((m) => { if (!dead) setIndex(m); }).catch(() => {});
    return () => { dead = true; };
  }, [id]);
  return useCallback((src) => {
    if (!src) return src;
    if (/^(https?:|data:|blob:)/.test(src)) return src;
    return index?.[src.replace(/^\.?\//, '')] || src;
  }, [index]);
}

async function downloadExport(id, title, kind, setBusy) {
  setBusy(kind);
  try {
    const res = await authFetch(`${SL_API}/v1/sl/decks/${encodeURIComponent(id)}/export.${kind}`);
    if (!res.ok) throw new Error(`export failed (${res.status})`);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(title || 'slides').replace(/[\\/:*?"<>|]+/g, ' ').trim()}.${kind}`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    console.error(e);
  } finally { setBusy(''); }
}

export function DeckPage({ id, seed }) {
  const [deck, setDeckState] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(0);
  const [selEl, setSelEl] = useState(null);
  const [presenting, setPresenting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saveState, setSaveState] = useState('');       // '' | 'saving' | 'saved' | 'error'
  const [copilotBusy, setCopilotBusy] = useState(false);
  const chatPane = useResizablePane({ initial: 380, min: 300, maxFraction: 0.6, fromRight: true, storageKey: 'slides.chat.w' });
  const resolveSrc = useSrcResolver(id);
  const railRef = useRef(null);

  const revRef = useRef(0);
  const dirtyRef = useRef(false);
  const saveTimer = useRef(null);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const deckRef = useRef(null);
  deckRef.current = deck;
  const selRef = useRef(0);
  selRef.current = sel;

  const me = getSession()?.member || { id: 'me', name: 'You' };
  const collab = useDeckCollab({
    resourceId: id, me, revRef, dirtyRef,
    onRemoteDeck: (remote) => { setDeckState(remote); },
    onCopilot: setCopilotBusy,
  });

  const [noDeck, setNoDeck] = useState(null);

  const adoptSession = useCallback((sid) => {
    if (!sid || sid === id) return;
    const [, query = ''] = (window.location.hash || '').split('?');
    window.history.replaceState({}, '', `#/d/${sid}${query ? `?${query}` : ''}`);
    // App keys DeckPage on the id, so dispatching the change remounts it against the real session.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, [id]);

  // "No deck" is three different situations and they must not look alike. The deck only exists
  // once a turn has written deck.json AND checkpointed, so a turn that is still going, and a turn
  // that died having written nothing, both arrive here as `deck: null`. Reporting both as
  // "Loading deck…" is how this page sat pretending to load a deck that was never coming.
  const load = useCallback(() => getDeck(id)
    .then(async (r) => {
      revRef.current = Number(r.deck?.meta?.rev || 0);
      setDeckState(r.deck);
      if (r.deck) { setNoDeck(null); return; }
      const st = await deckStatus(id).catch(() => '');
      if (['running', 'starting'].includes(st)) {
        setNoDeck({ working: true, text: 'Designing your deck…' });
        return;
      }
      // Finished without producing one: the turn's own last words are the only honest
      // explanation we have, so show them rather than a generic failure.
      const { turns } = await chatHistory(id).catch(() => ({ turns: [] }));
      const last = turns[turns.length - 1];
      setNoDeck({
        working: false,
        text: last?.status && last.status !== 'completed'
          ? `The last turn ended as "${last.status}" without writing a deck.`
          : 'No deck was written for this conversation yet.',
        detail: String(last?.assistant || '').slice(0, 400),
      });
    })
    .catch((e) => setErr(e.message || 'Could not open this deck.')), [id]);

  useEffect(() => {
    markViewed(id);
    load();
  }, [id, load]);

  // ── mutations: apply locally, push undo, schedule autosave ────────────────
  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    setSaveState('saving');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const d = deckRef.current;
      if (!d) return;
      try {
        const r = await saveDeck(id, d);
        revRef.current = Number(r.rev || revRef.current + 1);
        // keep local meta.rev in step so our own publish doesn't bounce back
        setDeckState((cur) => (cur ? { ...cur, meta: { ...cur.meta, rev: revRef.current } } : cur));
        dirtyRef.current = false;
        setSaveState('saved');
        window.setTimeout(() => setSaveState((v) => (v === 'saved' ? '' : v)), 1800);
      } catch {
        setSaveState('error');
      }
    }, 900);
  }, [id]);

  const mutate = useCallback((fn) => {
    setDeckState((cur) => {
      if (!cur) return cur;
      undoStack.current.push(JSON.stringify(cur));
      if (undoStack.current.length > 60) undoStack.current.shift();
      redoStack.current = [];
      return fn(structuredClone(cur));
    });
    scheduleSave();
  }, [scheduleSave]);

  const patchElement = useCallback((elementId, patch) => {
    mutate((d) => {
      const s = d.slides[selRef.current];
      const el = (s?.elements || []).find((x) => x.id === elementId);
      if (el) Object.entries(patch).forEach(([k, v]) => { el[k] = v; });
      return d;
    });
  }, [mutate]);

  const deleteElement = useCallback((elementId) => {
    mutate((d) => {
      const s = d.slides[selRef.current];
      if (s) s.elements = (s.elements || []).filter((x) => x.id !== elementId);
      return d;
    });
    setSelEl(null);
  }, [mutate]);

  // undo / redo (Cmd/Ctrl+Z, Shift for redo)
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        const from = e.shiftKey ? redoStack.current : undoStack.current;
        const to = e.shiftKey ? undoStack.current : redoStack.current;
        const snap = from.pop();
        if (snap && deckRef.current) {
          to.push(JSON.stringify(deckRef.current));
          setDeckState(JSON.parse(snap));
          scheduleSave();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scheduleSave]);

  // Up/Down switch slides — only when no element is selected (the editor owns
  // arrows for nudging while one is).
  useEffect(() => {
    const onKey = (e) => {
      if (presenting || selEl) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); setSel((v) => Math.min(v + 1, Math.max(0, (deckRef.current?.slides?.length || 1) - 1))); }
      else if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); setSel((v) => Math.max(0, v - 1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenting, selEl]);

  // Devil in the details: keep the active slide's thumb inside the rail.
  useEffect(() => {
    const item = railRef.current?.querySelectorAll('.sl-rail-item')?.[sel];
    item?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [sel]);

  // selection presence for peers
  useEffect(() => {
    const slide = deckRef.current?.slides?.[sel];
    collab.setSelection(slide ? { slideId: slide.id, elId: selEl } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, selEl]);

  if (err) {
    return (
      <div className="gp-root"><div className="gp-main">
        <DeckBanner deck={deck} onPresent={() => {}} onExport={() => {}} peers={[]} />
        <div className="page-note">{err}</div>
      </div></div>
    );
  }

  const slides = deck?.slides || [];
  const slide = slides[Math.min(sel, Math.max(0, slides.length - 1))];

  return (
    <div className="gp-root">
      <div className="gp-main">
        <DeckBanner deck={deck}
                    onPresent={() => slides.length && setPresenting(true)}
                    onExport={(kind) => deck && !exporting && downloadExport(id, deck.meta?.title, kind, setExporting)}
                    exporting={exporting} peers={collab.peers} live={collab.live}
                    saveState={saveState} copilotBusy={copilotBusy} />
        <div className="sl-body">
          <aside className="sl-rail scroll" ref={railRef}>
            {slides.map((s, i) => (
              <button key={s.id} className={'sl-rail-item' + (i === sel ? ' active' : '')}
                      onClick={() => { setSel(i); setSelEl(null); }}>
                <span className="sl-rail-num">{i + 1}</span>
                <span className="sl-rail-thumb">
                  <SlideView slide={s} theme={deck.theme} resolveSrc={resolveSrc} />
                </span>
              </button>
            ))}
            {!slides.length && deck && <div className="empty-note" style={{ padding: 16 }}>No slides yet.</div>}
          </aside>
          <div className="sl-canvas">
            {slide ? (
              <EditorCanvas
                slide={slide} theme={deck.theme} resolveSrc={resolveSrc}
                selectedId={selEl} onSelect={setSelEl}
                onPatchElement={patchElement}
                onDeleteElement={deleteElement}
                onDragState={(elId, frame) => collab.setDrag(elId, frame, slide.id)}
                peers={collab.peers}
              />
            ) : (
              <div className="empty-note" style={{ paddingTop: 80 }}>
                {deck ? 'This deck has no slides.'
                  : noDeck ? (
                    <>
                      <div>{noDeck.text}</div>
                      {noDeck.detail && <pre className="deck-empty-detail">{noDeck.detail}</pre>}
                      {!noDeck.working && (
                        <div style={{ marginTop: 14 }}>
                          Ask the copilot again on the right — the conversation is still here.
                        </div>
                      )}
                    </>
                  ) : 'Loading deck…'}
              </div>
            )}
          </div>
        </div>
      </div>

      <PaneResizer pane={chatPane} />
      <ChatColumn
        deckId={id}
        seed={seed}
        title={deck?.meta?.title || 'Copilot'}
        copilotBuilding={copilotBusy}
        collapsed={false}
        onToggle={() => {}}
        onDeckMaybeChanged={load}
        onSessionStarted={adoptSession}
        width={chatPane.width}
      />

      {presenting && (
        <Presentation deck={deck} resolveSrc={resolveSrc} startIndex={sel} onExit={() => setPresenting(false)} />
      )}
    </div>
  );
}

function DeckBanner({ deck, onPresent, onExport, exporting, peers = [], live, saveState, copilotBusy }) {
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);
  return (
    <header className="gp-banner">
      <a className="wordmark" href="#/"><Wordmark size={15} /></a>
      <a className="pane-btn gp-home" href="#/" title="Home" aria-label="Home"><Home size={16} /></a>
      <div className="sl-banner-actions">
        <button className="btn" onClick={onPresent} title="Present fullscreen">
          <Maximize2 size={15} /> Slideshow
        </button>
        <div className="sl-export-wrap">
          <button className="btn" disabled={!!exporting}
                  onClick={(e) => { e.stopPropagation(); setMenu((v) => !v); }}
                  title="Export this deck">
            <Download size={15} /> {exporting === 'pdf' ? 'Exporting PDF…' : exporting === 'pptx' ? 'Exporting PPTX…' : 'Export'}
          </button>
          {menu && !exporting && (
            <div className="sl-export-menu" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { setMenu(false); onExport('pdf'); }}>PDF document (.pdf)</button>
              <button onClick={() => { setMenu(false); onExport('pptx'); }}>PowerPoint (.pptx)</button>
            </div>
          )}
        </div>
        {saveState && (
          <span className={'sl-save-chip ' + saveState}>
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save failed — retrying on next edit'}
          </span>
        )}
        {copilotBusy && <span className="sl-save-chip copilot"><span className="pulse" /> Copilot is editing…</span>}
      </div>
      <div className="gp-banner-right">
        {live && peers.length > 0 && (
          <span className="sl-peer-stack" title={peers.map((p) => p.name).join(', ')}>
            {peers.slice(0, 4).map((p) => (
              <span key={p.key} className="sl-peer-av" style={{ background: p.color }}>
                {String(p.name || '?').trim().charAt(0).toUpperCase()}
              </span>
            ))}
          </span>
        )}
        <a className="pane-btn gp-help" href={LINKS.docs} target="_blank" rel="noreferrer" title="Documentation"><HelpCircle size={16} /></a>
        <AvatarMenu />
      </div>
    </header>
  );
}
