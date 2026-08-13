// Landing — the CG/Flowness information architecture (per the wireframe):
// a prompt box ("What slides should we create today?"), a template carousel,
// and My Slides (table + grid toggle) with live-render thumbnails. Typing a
// sentence creates a deck (after an in-app login modal when signed out) and
// lands on its editor with the sentence as the copilot seed.
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp, ChevronLeft, ChevronRight, Eye, LayoutGrid, List, Mic, Paperclip,
  Pencil, Presentation as PresIcon, Search, Trash2, X,
} from 'lucide-react';
import { SlideView } from 'reifyui/slides';
import {
  subscribe, listTemplates, listDecks, createDeck, renameDeck, deleteDeck,
  getDeck, lastViewedMap, relativeTime, uploadRef,
} from '../lib/sl';
import { PROMPT_IDEAS } from '../lib/promptIdeas';
import { Topbar } from '../components/Topbar';
import { Dialog, ConfirmDialog } from '../components/Dialog';
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

function useTypewriter(active) {
  const [text, setText] = useState(PROMPT_IDEAS[0]);
  const ideasRef = useRef(null);
  if (!ideasRef.current) {
    ideasRef.current = [...PROMPT_IDEAS].sort(() => Math.random() - 0.5);
  }
  useEffect(() => {
    if (!active) return undefined;
    const IDEAS = ideasRef.current;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) { setText(IDEAS[0]); return undefined; }
    let idea = 0, pos = 0, timer;
    const tick = () => {
      const cur = IDEAS[idea];
      if (pos <= cur.length) { setText(cur.slice(0, pos)); pos += 1; timer = window.setTimeout(tick, 26); }
      else { timer = window.setTimeout(() => { idea = (idea + 1) % IDEAS.length; pos = 0; tick(); }, 2600); }
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [active]);
  return text;
}

// Live thumbnail: fetch the deck once, render its first slide on the scaled
// stage. Accurate + no capture pipeline (real thumbnails via blob come later).
const _deckCache = new Map();
function DeckThumb({ id }) {
  const [deck, setDeck] = useState(() => _deckCache.get(id) || null);
  useEffect(() => {
    if (_deckCache.has(id)) { setDeck(_deckCache.get(id)); return undefined; }
    let dead = false;
    getDeck(id).then((r) => { if (!dead) { _deckCache.set(id, r.deck); setDeck(r.deck); } }).catch(() => {});
    return () => { dead = true; };
  }, [id]);
  return (
    <span className="thumb">
      {deck ? <SlideView slide={deck.slides?.[0]} theme={deck.theme} /> : <span className="thumb-ph2" />}
    </span>
  );
}

function TemplateArt({ t }) {
  // Real first-slide render, shrunk — the honest thumbnail. Falls back to a
  // palette card only when a template ships no starter slides (e.g. Blank).
  if (t?.cover) {
    return (
      <span className="thumb tpl-cover" aria-hidden="true">
        <SlideView slide={t.cover} theme={{ palette: t.palette, fonts: t.fonts }} />
      </span>
    );
  }
  const p = t?.palette;
  if (!p) {
    return <span className="thumb"><PresIcon size={38} strokeWidth={1.2} color="var(--mute-2)" aria-hidden="true" /></span>;
  }
  const head = t?.fonts?.head || 'inherit';
  return (
    <span className="thumb tpl-art" style={{ background: p.bg }} aria-hidden="true">
      <span className="tpl-art-title" style={{ color: p.ink, fontFamily: head }}>{t.name}</span>
      <span className="tpl-art-rule" style={{ background: p.brand }} />
      <span className="tpl-art-row">
        <span className="tpl-art-chip" style={{ background: p.surface }} />
        <span className="tpl-art-chip" style={{ background: p.accent }} />
        <span className="tpl-art-chip" style={{ background: p.brand }} />
      </span>
    </span>
  );
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <label className="searchbox">
      <Search size={14} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && <button type="button" className="sb-x" aria-label="Clear" onClick={() => onChange('')}><X size={12} /></button>}
    </label>
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

const AV_COLORS = ['#4F46E5', '#7C3AED', '#DB2777', '#D97706', '#059669', '#2563EB'];
function colorFor(id) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; }
function initialOf(n) { return String(n || '?').trim().charAt(0).toUpperCase() || '?'; }
function AccessStack({ me }) {
  if (!me?.id) return <span className="gt-last">—</span>;
  const name = me.display_name || me.name || me.email || 'You';
  return <span className="acc-stack"><span className="acc-av" style={{ background: colorFor(me.id) }} title={`${name} (you)`}>{initialOf(name)}</span></span>;
}

const VIEW_KEY = 'slides.decks.view';

export function LandingPage() {
  const [templates, setTemplates] = useState([]);
  const [decks, setDecks] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');
  const [tpl, setTpl] = useState(null);        // single selected template (chip)
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [view, setViewState] = useState(() => { try { return window.localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'; } catch { return 'list'; } });
  const setView = (v) => { setViewState(v); try { window.localStorage.setItem(VIEW_KEY, v); } catch {} };
  const [deckQ, setDeckQ] = useState('');
  const [tplQ, setTplQ] = useState('');
  const [tplCat, setTplCat] = useState('All');
  const [previewTpl, setPreviewTpl] = useState(null);   // template open in the eye modal
  const [me, setMe] = useState(null);
  const fileInputRef = useRef(null);
  const [refFile, setRefFile] = useState(null);   // document to seed the deck from
  const carRef = useRef(null);
  const placeholder = useTypewriter(prompt === '');

  useEffect(() => { let dead = false; listTemplates().then((t) => { if (!dead) setTemplates(t); }).catch(() => {}); return () => { dead = true; }; }, []);
  useEffect(() => {
    let dead = false;
    subscribe().catch(() => {});
    listDecks().then((d) => { if (!dead) setDecks(d); }).catch(() => { if (!dead) setDecks([]); });
    import('../lib/auth').then(({ getSession }) => { if (!dead) setMe(getSession()?.member || null); });
    return () => { dead = true; };
  }, []);

  function withAuth(action) {
    action();
  }

  async function createFromPrompt() {
    const text = prompt.trim();
    if ((!text && !tpl && !refFile) || creating) return;
    withAuth(async () => {
      setCreating(true); setCreateErr('');
      try {
        const name = text ? (text.length > 48 ? text.slice(0, 48).trim() : text)
          : (refFile ? refFile.name.replace(/\.[^.]+$/, '') : (tpl ? tpl.name : 'Untitled deck'));
        let seed = text || (refFile ? `Build a deck from the attached document ${refFile.name} — use it as the starting point for both content and style.`
          : `Design a ${tpl.name} deck.`);
        // The template brief deliberately does NOT go in the seed. The seed becomes the user's
        // chat message, and pasting a design spec into it means every widget that renders this
        // conversation — this copilot, the console's task view, the trace — shows the person a
        // wall of text they did not write. It travels as `instructions` instead (lib/copilot.js),
        // which the gateway keeps out of the recorded user text.
        const res = await createDeck(name, tpl ? tpl.id : 'blank');
        if (refFile) {
          await uploadRef(res.id, refFile);
          if (text) seed += `\n\nI attached ${refFile.name} — use it as the starting point for both content and style.`;
        }
        openDeck(res.id, seed, tpl ? tpl.id : '');
      } catch (e) { setCreating(false); setCreateErr(e.message || 'Could not create the deck.'); }
    });
  }

  async function commitRename(d) {
    const name = editName.trim(); setEditingId(null);
    if (!name || name === d.name) return;
    setDecks((list) => list.map((x) => (x.id === d.id ? { ...x, name } : x)));
    try { await renameDeck(d.id, name); } catch { setDecks((list) => list.map((x) => (x.id === d.id ? { ...x, name: d.name } : x))); }
  }
  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try { await deleteDeck(deleting.id); setDecks((list) => list.filter((x) => x.id !== deleting.id)); setDeleting(null); }
    catch {} finally { setDeleteBusy(false); }
  }
  function scrollCar(dir) { carRef.current?.scrollBy({ left: dir * 560, behavior: 'smooth' }); }

  const viewed = lastViewedMap();
  const tplCats = ['All', ...[...new Set(templates.map((t) => t.category).filter((c) => c && c !== 'Basics'))]];
  const tplMatches = templates.filter((t) =>
    (tplCat === 'All' || t.category === tplCat || t.id === 'blank')
    && t.name.toLowerCase().includes(tplQ.trim().toLowerCase()));
  const deckMatches = (decks || [])
    .filter((d) => d.name.toLowerCase().includes(deckQ.trim().toLowerCase()))
    .sort((a, b) => ((viewed[b.id] || 0) - (viewed[a.id] || 0)) || a.name.localeCompare(b.name));

  const renameField = (d) => (
    <input className="input rename-input" value={editName} autoFocus
           onClick={(e) => e.stopPropagation()} onChange={(e) => setEditName(e.target.value)}
           onBlur={() => commitRename(d)}
           onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitRename(d); if (e.key === 'Escape') setEditingId(null); }} />
  );
  const rowActions = (d) => (
    <span className="gcard-actions" onClick={(e) => e.stopPropagation()}>
      <button className="iconbtn" aria-label={`Rename ${d.name}`} onClick={() => { setEditingId(d.id); setEditName(d.name); }}><Pencil size={13} /></button>
      <button className="iconbtn danger" aria-label={`Delete ${d.name}`} onClick={() => setDeleting(d)}><Trash2 size={13} /></button>
    </span>
  );

  return (
    <div className="shell">
      <Topbar />
      <main className="landing">
        <section className="hero">
          <h1>What slides should we create today?</h1>
          <form className="promptbox" onSubmit={(e) => { e.preventDefault(); createFromPrompt(); }}>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); createFromPrompt(); } }}
                      placeholder={placeholder} rows={3} autoFocus />
            <div className="pb-row">
              <input ref={fileInputRef} type="file" hidden accept=".pdf,.pptx,.docx,.md,.txt" onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) setRefFile(f); }} />
              <button type="button" className="cmp-icon" aria-label="Attach a reference document"
                      title="Attach a document (PDF, PPTX...) — used as the content + style starting point"
                      onClick={() => fileInputRef.current?.click()}><Paperclip size={16} /></button>
              {refFile && <span className="ctx-chip set" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={refFile.name}>{refFile.name}<span className="ctx-chip-x" role="button" tabIndex={0} aria-label="Remove document" onClick={() => setRefFile(null)} onKeyDown={(e) => { if (e.key === 'Enter') setRefFile(null); }}><X size={12} /></span></span>}
              {tpl && <span className="ctx-chip set">{`Template: ${tpl.name}`}<span className="ctx-chip-x" role="button" tabIndex={0} aria-label="Remove template" onClick={() => setTpl(null)} onKeyDown={(e) => { if (e.key === 'Enter') setTpl(null); }}><X size={12} /></span></span>}
              <span style={{ flex: 1 }} />
              <span title="Voice input is coming soon"><button type="button" className="cmp-icon" disabled aria-label="Voice"><Mic size={15} /></button></span>
              <button type="submit" className="btn primary" disabled={(!prompt.trim() && !tpl && !refFile) || creating}>{creating ? 'Creating…' : 'Create'}{!creating && <ArrowUp size={14} />}</button>
            </div>
          </form>
          {createErr && <div className="auth-err" style={{ marginTop: 10 }}>{createErr}</div>}
        </section>

        <section className="section">
          <div className="section-h">
            <h2>Use a template</h2>
            {templates.length > 0 && <div className="section-tools"><SearchBox value={tplQ} onChange={setTplQ} placeholder="Search templates" /></div>}
          </div>
          {templates.length > 1 && tplCats.length > 2 && (
            <div className="tpl-cats" role="group" aria-label="Template categories">
              {tplCats.map((c) => (
                <button key={c} type="button" className={'tpl-cat' + (tplCat === c ? ' active' : '')}
                        onClick={() => setTplCat(c)}>{c}</button>
              ))}
            </div>
          )}
          {templates.length === 0 ? <SkeletonTemplateCards count={4} />
            : tplMatches.length === 0 ? <div className="card empty-note">No templates match your search.</div>
            : (
              <div className="carousel-wrap">
                <button className="car-btn left" onClick={() => scrollCar(-1)} aria-label="Scroll left"><ChevronLeft size={16} /></button>
                <div className="carousel" ref={carRef}>
                  {tplMatches.map((t) => (
                    <button key={t.id} className={'gcard tpl' + (tpl?.id === t.id ? ' sel' : '')} title={t.description}
                            onClick={() => { setTpl(t.id === 'blank' ? null : t); window.scrollTo({ top: 0, behavior: 'smooth' }); document.querySelector('.promptbox textarea')?.focus(); }}>
                      <TemplateArt t={t} />
                      {t.id !== 'blank' && (
                        <span className="gcard-eye" role="button" tabIndex={0}
                              aria-label={`Preview ${t.name}`} title={`Preview ${t.name}`}
                              onClick={(e) => { e.stopPropagation(); setPreviewTpl(t); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setPreviewTpl(t); } }}>
                          <Eye size={14} />
                        </span>
                      )}
                      <span className="gcard-foot"><span className="gcard-name">{t.name}</span></span>
                    </button>
                  ))}
                </div>
                <button className="car-btn right" onClick={() => scrollCar(1)} aria-label="Scroll right"><ChevronRight size={16} /></button>
              </div>
            )}
        </section>

        <section className="section">
            <div className="section-h">
              <h2>My slides</h2>
              {decks !== null && decks.length > 0 && (
                <div className="section-tools"><SearchBox value={deckQ} onChange={setDeckQ} placeholder="Search slides" /><ViewToggle value={view} onChange={setView} /></div>
              )}
            </div>
            {decks === null ? (
              <div className="gtable-wrap"><table className="gtable"><thead><tr><th>Name</th><th className="col-last">Last viewed</th><th className="col-access">Access</th><th className="gt-actions" /></tr></thead><tbody><SkeletonTableRows count={4} /></tbody></table></div>
            ) : decks.length === 0 ? (
              <div className="card empty-note">No slides yet. Create a deck from the prompt above or pick a template.</div>
            ) : deckMatches.length === 0 ? (
              <div className="card empty-note">No slides match your search.</div>
            ) : view === 'grid' ? (
              <div className="ggrid">
                {deckMatches.map((d) => (
                  <div key={d.id} className="gcard mine" role="button" tabIndex={0}
                       onClick={() => { if (editingId !== d.id) openDeck(d.id); }}
                       onKeyDown={(e) => { if (e.key === 'Enter' && editingId !== d.id) openDeck(d.id); }}>
                    <DeckThumb id={d.id} />
                    <span className="gcard-foot">
                      {editingId === d.id ? renameField(d) : (<><span className="gcard-name" title={d.name}>{d.name}</span>{relativeTime(viewed[d.id]) && <span className="gcard-sub">{relativeTime(viewed[d.id])}</span>}{rowActions(d)}</>)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="gtable-wrap"><table className="gtable">
                <thead><tr><th>Name</th><th className="col-last">Last viewed</th><th className="col-access">Access</th><th className="gt-actions" /></tr></thead>
                <tbody>
                  {deckMatches.map((d) => (
                    <tr key={d.id} tabIndex={0} onClick={() => { if (editingId !== d.id) openDeck(d.id); }} onKeyDown={(e) => { if (e.key === 'Enter' && editingId !== d.id) openDeck(d.id); }}>
                      <td><span className="gt-name"><span className="gt-thumb"><DeckThumb id={d.id} /></span>{editingId === d.id ? renameField(d) : <span className="gcard-name" title={d.name}>{d.name}</span>}</span></td>
                      <td className="gt-last col-last">{relativeTime(viewed[d.id]) || '—'}</td>
                      <td className="col-access"><AccessStack me={me} /></td>
                      <td className="gt-actions">{rowActions(d)}</td>
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
          onUse={() => {
            const t = previewTpl;
            setPreviewTpl(null);
            setTpl(t);
            window.scrollTo({ top: 0, behavior: 'smooth' });
            document.querySelector('.promptbox textarea')?.focus();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog title="Delete deck" body={<><b>{deleting.name}</b> will be removed from your workspace. This cannot be undone.</>}
                       busy={deleteBusy} onConfirm={confirmDelete} onClose={() => { if (!deleteBusy) setDeleting(null); }} />
      )}
    </div>
  );
}
