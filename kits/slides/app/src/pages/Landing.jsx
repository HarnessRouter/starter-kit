// Landing — the library page: a prompt box ("What slides should we create today?"), a template
// carousel, and My Slides (table + grid toggle) with live-render thumbnails. Typing a sentence
// creates a deck and lands on its editor with the sentence as the copilot's first message.
//
// The page is COMPOSED from the package's library pieces (Carousel, Card, Chip, SearchField,
// Modal, useTypewriter) rather than owning copies of them. What is left here is what is Slides':
// which templates exist, what a thumbnail is (a real first-slide render), and what happens when
// you press Create.
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Eye, LayoutGrid, List, Mic, Paperclip, Pencil, Presentation as PresIcon, Trash2 } from 'lucide-react';
import { Card, Carousel, Chip, SearchField, bytesLabel, createDictation, useDialog, useTypewriter } from 'reifyui';
import { fileToInputBlock } from 'reifyui/harness';
import { SlideView } from 'reifyui/slides';
import {
  subscribe, listTemplates, listDecks, createDeck, renameDeck, deleteDeck,
  getDeck, lastViewedMap, relativeTime,
} from '../lib/sl';
import { stageOpeningFile } from '../lib/copilot';
import { PROMPT_IDEAS } from '../lib/promptIdeas';
import { Topbar } from '../components/Topbar';
import { TemplatePreviewModal } from '../components/TemplatePreviewModal';
import { SkeletonTableRows, SkeletonTemplateCards } from '../components/Skeleton';

function openDeck(id, seed, template) {
  // `seed` is consumed and stripped on arrival; `template` stays, because it is a property of the
  // deck the person created and they should be able to see which one they picked — including
  // after a reload.
  const q = new URLSearchParams();
  if (seed) q.set('seed', seed);
  if (template && template !== 'blank') q.set('tpl', template);
  const qs = q.toString();
  window.location.hash = `#/d/${id}${qs ? `?${qs}` : ''}`;
}

// Live thumbnail: fetch the deck once, render its first slide on the scaled stage. Accurate, and
// it needs no capture pipeline or blob store.
const _deckCache = new Map();
function DeckThumb({ id }) {
  const [deck, setDeck] = useState(() => _deckCache.get(id) || null);
  useEffect(() => {
    if (_deckCache.has(id)) { setDeck(_deckCache.get(id)); return undefined; }
    let dead = false;
    getDeck(id).then((r) => { if (!dead) { _deckCache.set(id, r.deck); setDeck(r.deck); } }).catch(() => {});
    return () => { dead = true; };
  }, [id]);
  return deck
    ? <SlideView slide={deck.slides?.[0]} theme={deck.theme} />
    : <span className="sl-thumb-ph" />;
}

function TemplateArt({ t }) {
  // Real first-slide render, shrunk — the honest thumbnail. Falls back to a
  // palette card only when a template ships no starter slides (e.g. Blank).
  if (t?.cover) {
    return (
      <span className="sl-tpl-cover" aria-hidden="true">
        <SlideView slide={t.cover} theme={{ palette: t.palette, fonts: t.fonts }} />
      </span>
    );
  }
  const p = t?.palette;
  if (!p) return <PresIcon size={38} strokeWidth={1.2} color="var(--mute-2)" aria-hidden="true" />;
  const head = t?.fonts?.head || 'inherit';
  return (
    <span className="sl-tpl-art" style={{ background: p.bg }} aria-hidden="true">
      <span className="sl-tpl-art-title" style={{ color: p.ink, fontFamily: head }}>{t.name}</span>
      <span className="sl-tpl-art-rule" style={{ background: p.brand }} />
      <span className="sl-tpl-art-row">
        <span className="sl-tpl-art-chip" style={{ background: p.surface }} />
        <span className="sl-tpl-art-chip" style={{ background: p.accent }} />
        <span className="sl-tpl-art-chip" style={{ background: p.brand }} />
      </span>
    </span>
  );
}

function ViewToggle({ value, onChange }) {
  return (
    <div className="wb-tabs vt" role="group" aria-label="View">
      <button type="button" className={'wb-tab' + (value === 'list' ? ' active' : '')} onClick={() => onChange('list')} aria-label="List view"><List size={15} /></button>
      <button type="button" className={'wb-tab' + (value === 'grid' ? ' active' : '')} onClick={() => onChange('grid')} aria-label="Card view"><LayoutGrid size={15} /></button>
    </div>
  );
}

const VIEW_KEY = 'slides.decks.view';

export function LandingPage() {
  const dialog = useDialog();
  const [templates, setTemplates] = useState([]);
  const [decks, setDecks] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');
  const [tpl, setTpl] = useState(null);        // single selected template (chip)
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [view, setViewState] = useState(() => { try { return window.localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'; } catch { return 'list'; } });
  const setView = (v) => { setViewState(v); try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } };
  const [deckQ, setDeckQ] = useState('');
  const [tplQ, setTplQ] = useState('');
  const [tplCat, setTplCat] = useState('All');
  const [previewTpl, setPreviewTpl] = useState(null);   // template open in the eye modal
  // The reference document, already prepared as the block the first turn will carry. Preparing
  // it at pick time is what makes "Create" instant and the failure (too large) immediate.
  const [refFile, setRefFile] = useState(null);
  const [listening, setListening] = useState(false);
  // Built ONCE — a fresh recogniser on every render would stop dictation on every keystroke.
  // Null where the browser has no recogniser, and then there is no microphone at all.
  const [dictation] = useState(() => createDictation());
  const fileRef = useRef(null);
  const placeholder = useTypewriter(PROMPT_IDEAS, { active: prompt === '' });

  useEffect(() => () => dictation?.stop(), [dictation]);

  useEffect(() => { let dead = false; listTemplates().then((t) => { if (!dead) setTemplates(t); }).catch(() => {}); return () => { dead = true; }; }, []);
  useEffect(() => {
    let dead = false;
    subscribe().catch(() => {});
    listDecks().then((d) => { if (!dead) setDecks(d); }).catch(() => { if (!dead) setDecks([]); });
    return () => { dead = true; };
  }, []);

  function toggleDictation() {
    if (!dictation) return;
    if (listening) { dictation.stop(); setListening(false); return; }
    setListening(true);
    dictation.start({
      onText: (text) => setPrompt((cur) => (cur ? `${cur.replace(/\s+$/, '')} ${text}` : text)),
      onEnd: () => setListening(false),
      onError: () => setListening(false),
    });
  }

  async function pickRef(file) {
    setCreateErr('');
    try {
      setRefFile(await fileToInputBlock(file));
    } catch (e) {
      setCreateErr(e?.message || `${file.name} could not be attached.`);
    }
  }

  async function createFromPrompt() {
    const text = prompt.trim();
    if ((!text && !tpl && !refFile) || creating) return;
    if (listening) { dictation?.stop(); setListening(false); }
    setCreating(true); setCreateErr('');
    try {
      const name = text ? (text.length > 48 ? text.slice(0, 48).trim() : text)
        : (refFile ? refFile.name.replace(/\.[^.]+$/, '') : (tpl ? tpl.name : 'Untitled deck'));
      let seed = text || (refFile ? `Build a deck from the attached document ${refFile.name} — use it as the starting point for both content and style.`
        : `Design a ${tpl.name} deck.`);
      // The template brief deliberately does NOT go in the seed. The seed becomes the user's chat
      // message, and pasting a design spec into it means every widget that renders this
      // conversation — the copilot, the console's task view, the trace — shows the person a wall
      // of text they did not write. It travels as `instructions` instead (lib/copilot.js).
      const res = await createDeck(name, tpl ? tpl.id : 'blank');
      // The document rides the turn that creates the deck. There is no session to upload it to
      // until that turn runs, and this is set on EVERY create (null included) so it can never be
      // inherited by the next deck.
      stageOpeningFile(refFile);
      if (refFile && text) seed += `\n\nI attached ${refFile.name} — use it as the starting point for both content and style.`;
      openDeck(res.id, seed, tpl ? tpl.id : '');
    } catch (e) { setCreating(false); setCreateErr(e.message || 'Could not create the deck.'); }
  }

  function chooseTemplate(t) {
    setTpl(t.id === 'blank' ? null : t);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.querySelector('.uic-promptbox-input')?.focus();
  }

  async function commitRename(d) {
    const name = editName.trim(); setEditingId(null);
    if (!name || name === d.name) return;
    setDecks((list) => list.map((x) => (x.id === d.id ? { ...x, name } : x)));
    try { await renameDeck(d.id, name); } catch { setDecks((list) => list.map((x) => (x.id === d.id ? { ...x, name: d.name } : x))); }
  }

  async function askDelete(d) {
    const ok = await dialog.confirm({
      title: 'Delete deck',
      message: <><b>{d.name}</b> will be removed from your workspace. This cannot be undone.</>,
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await deleteDeck(d.id);
      setDecks((list) => list.filter((x) => x.id !== d.id));
    } catch (e) {
      // The old version swallowed this, and the deck reappeared on the next load with no
      // explanation. Say what happened.
      dialog.alert({ title: 'Could not delete', message: e?.message || 'The deck is still there.', variant: 'error' });
    }
  }

  const viewed = lastViewedMap();
  const tplCats = ['All', ...[...new Set(templates.map((t) => t.category).filter((c) => c && c !== 'Basics'))]];
  const tplMatches = templates.filter((t) =>
    (tplCat === 'All' || t.category === tplCat || t.id === 'blank')
    && t.name.toLowerCase().includes(tplQ.trim().toLowerCase()));
  const deckMatches = (decks || [])
    .filter((d) => d.name.toLowerCase().includes(deckQ.trim().toLowerCase()))
    .sort((a, b) => ((viewed[b.id] || 0) - (viewed[a.id] || 0)) || a.name.localeCompare(b.name));

  const renameField = (d) => (
    <input className="input sl-rename" value={editName} autoFocus
           onClick={(e) => e.stopPropagation()} onChange={(e) => setEditName(e.target.value)}
           onBlur={() => commitRename(d)}
           onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitRename(d); if (e.key === 'Escape') setEditingId(null); }} />
  );
  const rowActions = (d) => (
    <>
      <button type="button" className="uic-iconbtn" aria-label={`Rename ${d.name}`}
              onClick={(e) => { e.stopPropagation(); setEditingId(d.id); setEditName(d.name); }}><Pencil size={13} /></button>
      <button type="button" className="uic-iconbtn is-danger" aria-label={`Delete ${d.name}`}
              onClick={(e) => { e.stopPropagation(); askDelete(d); }}><Trash2 size={13} /></button>
    </>
  );

  return (
    <div className="uic-shell">
      <Topbar />
      <main className="uic-page">
        <section className="uic-hero">
          <h1>What slides should we create today?</h1>
          <form className="uic-promptbox" onSubmit={(e) => { e.preventDefault(); createFromPrompt(); }}>
            <textarea className="uic-promptbox-input" value={prompt} onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); createFromPrompt(); } }}
                      placeholder={placeholder} aria-label="Describe the deck you want" rows={3} autoFocus />
            <div className="uic-promptbox-row">
              <input ref={fileRef} type="file" hidden accept=".pdf,.pptx,.docx,.md,.txt,.png,.jpg,.jpeg"
                     onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) pickRef(f); }} />
              <button type="button" className="uic-chat-icon" aria-label="Attach a reference document"
                      title="Attach a document (PDF, PPTX...) — used as the content + style starting point"
                      onClick={() => fileRef.current?.click()}><Paperclip size={16} /></button>
              {refFile && (
                <Chip
                  icon={<Paperclip size={11} />}
                  title={refFile.name}
                  label={<>
                    <span className="uic-chip-t">{refFile.name}</span>
                    <span className="uic-chip-meta">{bytesLabel(refFile.size)}</span>
                  </>}
                  onRemove={() => setRefFile(null)}
                  removeLabel={`Remove ${refFile.name}`}
                />
              )}
              {tpl && (
                <Chip selected label={`Template: ${tpl.name}`} onRemove={() => setTpl(null)}
                      removeLabel={`Remove the ${tpl.name} template`} />
              )}
              <span style={{ flex: 1 }} />
              {/* No control for a capability the browser does not have: where there is no
                  recogniser there is no microphone, never a disabled one. */}
              {dictation && (
                <button type="button" className={'uic-chat-icon' + (listening ? ' is-on' : '')}
                        aria-label={listening ? 'Stop dictating' : 'Dictate'} aria-pressed={listening}
                        onClick={toggleDictation}><Mic size={15} /></button>
              )}
              <button type="submit" className="btn primary" disabled={(!prompt.trim() && !tpl && !refFile) || creating}>{creating ? 'Creating…' : 'Create'}{!creating && <ArrowUp size={14} />}</button>
            </div>
          </form>
          {createErr && <div className="uic-note is-err">{createErr}</div>}
        </section>

        <section className="uic-section">
          <div className="uic-section-h">
            <h2>Use a template</h2>
            {templates.length > 0 && (
              <div className="uic-section-tools">
                <SearchField value={tplQ} onChange={setTplQ} placeholder="Search templates" />
              </div>
            )}
          </div>
          {templates.length > 1 && tplCats.length > 2 && (
            <div className="sl-cats" role="group" aria-label="Template categories">
              {tplCats.map((c) => (
                <Chip key={c} label={c} selected={tplCat === c} onClick={() => setTplCat(c)} />
              ))}
            </div>
          )}
          {templates.length === 0 ? <SkeletonTemplateCards count={4} />
            : tplMatches.length === 0 ? <div className="uic-note">No templates match your search.</div>
            : (
              <Carousel label="templates">
                {tplMatches.map((t) => (
                  <Card
                    key={t.id}
                    art={<TemplateArt t={t} />}
                    title={t.name}
                    selected={tpl?.id === t.id}
                    onClick={() => chooseTemplate(t)}
                    overlay={t.id !== 'blank' ? (
                      <button type="button" className="sl-eye" aria-label={`Preview ${t.name}`}
                              title={`Preview ${t.name}`} onClick={() => setPreviewTpl(t)}>
                        <Eye size={14} />
                      </button>
                    ) : null}
                  />
                ))}
              </Carousel>
            )}
        </section>

        <section className="uic-section">
          <div className="uic-section-h">
            <h2>My slides</h2>
            {decks !== null && decks.length > 0 && (
              <div className="uic-section-tools">
                <SearchField value={deckQ} onChange={setDeckQ} placeholder="Search slides" />
                <ViewToggle value={view} onChange={setView} />
              </div>
            )}
          </div>
          {decks === null ? (
            <div className="uic-table-wrap"><table className="uic-table"><thead><tr><th>Name</th><th className="uic-col-last">Last viewed</th><th className="uic-table-actions" /></tr></thead><tbody><SkeletonTableRows count={4} /></tbody></table></div>
          ) : decks.length === 0 ? (
            <div className="uic-note">No slides yet. Create a deck from the prompt above or pick a template.</div>
          ) : deckMatches.length === 0 ? (
            <div className="uic-note">No slides match your search.</div>
          ) : view === 'grid' ? (
            <div className="uic-cardgrid">
              {deckMatches.map((d) => (
                <Card
                  key={d.id}
                  art={<DeckThumb id={d.id} />}
                  title={editingId === d.id ? renameField(d) : d.name}
                  subtitle={editingId === d.id ? null : relativeTime(viewed[d.id])}
                  // No onClick while the name is being edited: the row must not be a text field
                  // and a link to somewhere else at the same time.
                  onClick={editingId === d.id ? undefined : () => openDeck(d.id)}
                  actions={editingId === d.id ? null : rowActions(d)}
                />
              ))}
            </div>
          ) : (
            <div className="uic-table-wrap"><table className="uic-table">
              <thead><tr><th>Name</th><th className="uic-col-last">Last viewed</th><th className="uic-table-actions" /></tr></thead>
              <tbody>
                {deckMatches.map((d) => (
                  <tr key={d.id} tabIndex={0} onClick={() => { if (editingId !== d.id) openDeck(d.id); }} onKeyDown={(e) => { if (e.key === 'Enter' && editingId !== d.id) openDeck(d.id); }}>
                    <td><span className="uic-table-name"><span className="uic-table-thumb"><DeckThumb id={d.id} /></span>{editingId === d.id ? renameField(d) : <span title={d.name}>{d.name}</span>}</span></td>
                    <td className="uic-table-quiet uic-col-last">{relativeTime(viewed[d.id]) || '—'}</td>
                    <td className="uic-table-actions">{rowActions(d)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </section>
      </main>

      {previewTpl && (
        <TemplatePreviewModal
          template={previewTpl}
          onClose={() => setPreviewTpl(null)}
          onUse={() => { const t = previewTpl; setPreviewTpl(null); chooseTemplate(t); }}
        />
      )}
    </div>
  );
}
