// Landing: the prompt box is the primary entry. Typing a sentence and
// pressing Enter creates a sheet (after an in-app login modal when signed
// out) and lands on its editor page with the sentence as the copilot seed.
// Templates are a searchable card carousel; My Sheets is a table (name +
// last viewed + access + actions, per the wireframe) with a card-grid
// alternate view behind a persisted list/grid toggle. Mirrors the
// ContextualGraph landing (frontend-contextualgraph/src/pages/Landing.jsx);
// no thumbnail plane in v1 — cards show the product glyph.
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp, Check, ChevronLeft, ChevronRight, LayoutGrid, List, Mic, Paperclip,
  Pencil, Search, Shapes, Trash2, X,
} from 'lucide-react';
import { authFetch, ENGINE, isAuthed, SESSION_EVENT } from '../lib/auth';
import {
  subscribe, listTemplates, listSheets, createSheet, renameSheet,
  deleteSheet, getTemplateDetail, lastViewedMap, relativeTime,
  sheetThumbPath, fetchThumbUrl,
} from '../lib/sh';
import { Topbar } from '../components/Topbar';
import { AuthForm } from '../components/AuthForm';
import { Dialog, ConfirmDialog } from '../components/Dialog';
import { SheetGrid } from 'reifyui';
import { ArtThumb, Thumb, ThumbHealer } from '../components/Thumbs';
import { SkeletonTableRows, SkeletonTemplateCards } from '../components/Skeleton';
import { svgDataUri, TEMPLATE_ART } from '../lib/thumb';

function openSheet(id, seed) {
  const q = seed ? `?seed=${encodeURIComponent(seed)}` : '';
  window.location.hash = `#/s/${id}${q}`;
}

// ── Prompt placeholder: typewriter rotation through example sheets ──────
const PROMPT_IDEAS = [
  'A marketing campaign tracker with an AI-written summary per campaign',
  'One competitor per row — research and score each with an agent',
  'A list of companies, enriched with industry, size, and a fit score',
  'Test cases in rows; run each one and record pass/fail + notes',
  'Track my content ideas, drafts, channels, and how each performed',
  'Daily competitor prices scraped into a sheet, flagged if they changed',
];

function useTypewriterPlaceholder(active) {
  const [text, setText] = useState(PROMPT_IDEAS[0]);
  useEffect(() => {
    if (!active) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      setText(PROMPT_IDEAS[0]);
      return undefined;
    }
    let idea = 0;
    let pos = 0;
    let timer;
    const tick = () => {
      const cur = PROMPT_IDEAS[idea];
      if (pos <= cur.length) {
        setText(cur.slice(0, pos));
        pos += 1;
        timer = window.setTimeout(tick, 24);
      } else {
        timer = window.setTimeout(() => {
          idea = (idea + 1) % PROMPT_IDEAS.length;
          pos = 0;
          tick();
        }, 2600);
      }
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [active]);
  return text;
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <label className="searchbox">
      <Search size={14} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value && (
        <button type="button" className="sb-x" aria-label="Clear search" onClick={() => onChange('')}>
          <X size={12} />
        </button>
      )}
    </label>
  );
}

function ViewToggle({ value, onChange }) {
  return (
    <div className="wb-tabs vt" role="group" aria-label="View">
      <button type="button" className={'wb-tab' + (value === 'list' ? ' active' : '')}
              onClick={() => onChange('list')} aria-label="List view">
        <List size={15} />
      </button>
      <button type="button" className={'wb-tab' + (value === 'grid' ? ' active' : '')}
              onClick={() => onChange('grid')} aria-label="Card view">
        <LayoutGrid size={15} />
      </button>
    </div>
  );
}

// ── Access column: overlapping initials of the people with access ──────────
const AV_COLORS = ['#0E7490', '#7C3AED', '#DB2777', '#D97706', '#059669', '#2563EB'];
function colorFor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}
function initialOf(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

// One authenticated fetch per distinct avatar, shared across every row that
// shows the same person (object URLs live for the page, never revoked).
const avatarUrlCache = new Map(); // path -> Promise<string|null>
function fetchAvatarOnce(path) {
  if (!avatarUrlCache.has(path)) avatarUrlCache.set(path, fetchThumbUrl(path));
  return avatarUrlCache.get(path);
}

function AvatarCircle({ person }) {
  const [url, setUrl] = useState(null);
  const path = '';
  useEffect(() => {
    if (!path) { setUrl(null); return undefined; }
    let dead = false;
    fetchAvatarOnce(path).then((u) => { if (!dead && u) setUrl(u); });
    return () => { dead = true; };
  }, [path]);
  const label = person.name + (person.self ? ' (you)' : '');
  return (
    <span className="acc-av" style={url ? undefined : { background: colorFor(person.id) }} title={label}>
      {url ? <img src={url} alt={label} /> : initialOf(person.name)}
    </span>
  );
}

function AccessStack({ me, assignments }) {
  const people = [];
  if (me?.id) {
    people.push({
      id: String(me.id), name: me.display_name || me.name || me.email || 'You',
      avatar: me.avatar || '', avatar_updated_at: me.avatar_updated_at || '', self: true,
    });
  }
  (Array.isArray(assignments) ? assignments : []).forEach((a) => {
    const g = a.grantee || {};
    if (!g.id || people.some((p) => p.id === String(g.id))) return;
    people.push({
      id: String(g.id), name: g.name || g.email || 'Member',
      avatar: g.avatar || '', avatar_updated_at: g.avatar_updated_at || '',
    });
  });
  if (!people.length) return <span className="gt-last">—</span>;
  const shown = people.slice(0, 5);
  const extra = people.length - shown.length;
  return (
    <span className="acc-stack" aria-label="People with access">
      {shown.map((p) => <AvatarCircle key={p.id} person={p} />)}
      {extra > 0 && <span className="acc-av acc-more">+{extra}</span>}
    </span>
  );
}

// ── Template chips on the prompt bar (multi-select inspiration) ─────────────
const TPL_MAX = 4;
const POP_W = 280;

function usePopoverPlacement(anchorRef, open) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!open) { setPos(null); return undefined; }
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gap = 6;
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(POP_W, vw - margin * 2);
      const spaceBelow = vh - r.bottom - gap - margin;
      const spaceAbove = r.top - gap - margin;
      const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(140, Math.floor(openUp ? spaceAbove : spaceBelow));
      let left = r.left;
      left = Math.max(margin, Math.min(left, vw - width - margin));
      const style = openUp
        ? { left, bottom: Math.round(vh - r.top + gap), width, maxHeight }
        : { left, top: Math.round(r.bottom + gap), width, maxHeight };
      setPos(style);
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRef, open]);
  return pos;
}

function TemplateChips({ templates, selected, onToggle, note }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrapRef = useRef(null);
  const anchorRef = useRef(null);
  const popRef = useRef(null);
  const pos = usePopoverPlacement(anchorRef, open);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const usable = templates.filter((t) => t.id !== 'blank');
  const matches = usable.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()));
  const isOn = (t) => selected.some((x) => x.id === t.id);
  return (
    <>
      {selected.map((t) => (
        <span key={t.id} className="ctx-chip set" title={t.description}>
          <Shapes size={13} />
          {`Template: ${t.name}`}
          <span className="ctx-chip-x" role="button" tabIndex={0}
                aria-label={`Remove template ${t.name}`}
                onClick={() => onToggle(t)}
                onKeyDown={(e) => { if (e.key === 'Enter') onToggle(t); }}>
            <X size={12} />
          </span>
        </span>
      ))}
      <span className="chip-wrap" ref={wrapRef}>
        <button ref={anchorRef} type="button" className="ctx-chip"
                onClick={() => { setOpen((v) => !v); setQ(''); }}>
          <Shapes size={13} />
          {selected.length ? 'Add template' : 'Template'}
        </button>
        {open && pos && (
          <div ref={popRef} className="chip-pop chip-pop-fixed" style={{ position: 'fixed', ...pos }}>
            <input className="input sm" autoFocus placeholder="Search templates"
                   value={q} onChange={(e) => setQ(e.target.value)} />
            {note && <div className="chip-pop-note">{note}</div>}
            <div className="chip-pop-list scroll">
              {matches.map((t) => (
                <button key={t.id} type="button"
                        className={'chip-pop-item' + (isOn(t) ? ' active' : '')}
                        onClick={() => onToggle(t)} title={t.description}>
                  <span className="chip-pop-check">{isOn(t) ? <Check size={13} /> : null}</span>
                  {t.name}
                </button>
              ))}
              {matches.length === 0 && <div className="stat-lbl" style={{ padding: '8px 10px' }}>No templates match.</div>}
            </div>
          </div>
        )}
      </span>
    </>
  );
}

// Template card art: deterministic SVG data URIs from each template's
// mini-DSL (lib/thumb.js), rendered by the SAME renderer real sheet
// thumbnails use. Blank has no art — its placeholder glyph is honest.
const TEMPLATE_ART_URIS = Object.fromEntries(
  Object.entries(TEMPLATE_ART).map(([id, dsl]) => [id, svgDataUri(dsl, { width: 472, height: 265 })]),
);

const SHEET_VIEW_KEY = 'sheets.sheets.view';

export function LandingPage() {
  const [authed, setAuthed] = useState(isAuthed);
  const [templates, setTemplates] = useState([]);
  const [sheets, setSheets] = useState(null); // null = loading
  const [prompt, setPrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginSubtitle, setLoginSubtitle] = useState('Sign in to create your sheet.');
  const [tplChips, setTplChips] = useState([]);
  const [previewTpl, setPreviewTpl] = useState(null);   // template being previewed (read-only popup)
  const [tplNote, setTplNote] = useState('');
  const tplNoteTimer = useRef(null);
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [view, setViewState] = useState(() => {
    try { return window.localStorage.getItem(SHEET_VIEW_KEY) === 'grid' ? 'grid' : 'list'; } catch { return 'list'; }
  });
  const setView = (v) => {
    setViewState(v);
    try { window.localStorage.setItem(SHEET_VIEW_KEY, v); } catch { /* private mode */ }
  };
  const [sheetQ, setWfQ] = useState('');
  const [tplQ, setTplQ] = useState('');
  const [me, setMe] = useState(null);
  const [access, setAccess] = useState({});
  const [healQueue, setHealQueue] = useState([]);      // sheets missing a thumbnail
  const [thumbRefresh, setThumbRefresh] = useState({}); // sheet id -> bump count
  const healTriedRef = useRef(new Set());
  const pendingRef = useRef(null);
  const carRef = useRef(null);
  const placeholder = useTypewriterPlaceholder(prompt === '');

  useEffect(() => {
    const sync = () => setAuthed(isAuthed());
    window.addEventListener(SESSION_EVENT, sync);
    return () => window.removeEventListener(SESSION_EVENT, sync);
  }, []);

  // Templates are public showcase content — load for everyone.
  useEffect(() => {
    let dead = false;
    listTemplates().then((t) => { if (!dead) setTemplates(t); }).catch(() => {});
    return () => { dead = true; };
  }, []);

  // My Sheets is the only signed-in-only data. Subscribe (idempotent) + load.
  useEffect(() => {
    if (!authed) { setSheets(null); return undefined; }
    let dead = false;
    subscribe().catch(() => { /* idempotent, retried next load */ });
    listSheets().then((w) => { if (!dead) setSheets(w); }).catch(() => { if (!dead) setSheets([]); });
    return () => { dead = true; };
  }, [authed]);

  // Viewer profile for the Access column.
  useEffect(() => {
    if (!authed) { setMe(null); return undefined; }
    let dead = false;
    authFetch(`${ENGINE}/v1/auth/me`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (!dead && b?.member) setMe(b.member); })
      .catch(() => {});
    return () => { dead = true; };
  }, [authed]);

  // Access column data: the engine share list, one call per sheet.
  useEffect(() => {
    if (!authed || view !== 'list' || !sheets?.length) return undefined;
    let dead = false;
    sheets.forEach((w) => {
      if (access[w.id] !== undefined) return;
      authFetch(`${ENGINE}/v1/resources/${encodeURIComponent(w.id)}/access`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => {
          if (dead) return;
          setAccess((m) => ({ ...m, [w.id]: b ? (b.assignments || []) : null }));
        })
        .catch(() => { if (!dead) setAccess((m) => ({ ...m, [w.id]: null })); });
    });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, view, sheets]);

  // ── Thumbnail self-heal: a card that 404s queues a real render ──────────
  const reportThumbMiss = (id) => {
    if (healTriedRef.current.has(id)) return;
    healTriedRef.current.add(id);
    setHealQueue((q) => [...q, id]);
  };
  const onHealDone = (id, ok) => {
    setHealQueue((q) => q.filter((x) => x !== id));
    if (ok) setThumbRefresh((m) => ({ ...m, [id]: (m[id] || 0) + 1 }));
  };

  function toggleTpl(t) {
    setTplChips((list) => {
      if (list.some((x) => x.id === t.id)) return list.filter((x) => x.id !== t.id);
      if (list.length >= TPL_MAX) {
        setTplNote(`Up to ${TPL_MAX} templates can be combined. Remove one to add another.`);
        window.clearTimeout(tplNoteTimer.current);
        tplNoteTimer.current = window.setTimeout(() => setTplNote(''), 4000);
        return list;
      }
      return [...list, t];
    });
  }

  function withAuth(action) {
    if (isAuthed()) action();
    else { pendingRef.current = action; setLoginSubtitle('Sign in to create your sheet.'); setLoginOpen(true); }
  }

  async function createFromPrompt() {
    const text = prompt.trim();
    if ((!text && tplChips.length === 0) || creating) return;
    withAuth(async () => {
      setCreating(true);
      setCreateErr('');
      try {
        const name = text
          ? (text.length > 40 ? text.slice(0, 40).trim() : text)
          : tplChips.map((t) => t.name).join(' + ');
        // Blank-first creation: chosen templates ride along as reference
        // context in the copilot seed, never a hard apply.
        let seed = text
          || `Design this sheet drawing inspiration from ${tplChips.length === 1
            ? `the reference example "${tplChips[0].name}"`
            : `these reference examples: ${tplChips.map((t) => `"${t.name}"`).join(', ')}`}.`;
        if (tplChips.length >= 1) {
          const dets = await Promise.all(tplChips.map((t) => getTemplateDetail(t.id)));
          seed += '\n\nReference examples are INSPIRATION, my request is the spec: borrow what fits, '
            + 'model everything my request needs even where no example covers it, and freely drop or '
            + 'reshape anything that does not serve the request.';
          dets.forEach((det, i) => {
            seed += `\n\nReference example ${i + 1} of ${dets.length} (${tplChips[i].name}):\n${det.context}`;
          });
        }
        const res = await createSheet(name, 'blank');
        openSheet(res.id, seed);
      } catch (e) {
        setCreating(false);
        setCreateErr(e.message || 'Could not create the sheet. Please try again.');
      }
    });
  }

  async function commitRename(w) {
    const name = editName.trim();
    setEditingId(null);
    if (!name || name === w.name) return;
    setSheets((list) => list.map((x) => (x.id === w.id ? { ...x, name } : x)));
    try {
      await renameSheet(w.id, name);
    } catch {
      setSheets((list) => list.map((x) => (x.id === w.id ? { ...x, name: w.name } : x)));
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await deleteSheet(deleting.id);
      setSheets((list) => list.filter((x) => x.id !== deleting.id));
      setDeleting(null);
    } catch { /* keep the dialog open; user can retry or cancel */ } finally {
      setDeleteBusy(false);
    }
  }

  function scrollCarousel(dir) {
    carRef.current?.scrollBy({ left: dir * 560, behavior: 'smooth' });
  }

  const viewed = lastViewedMap();
  const tplMatches = templates.filter(
    (t) => t.name.toLowerCase().includes(tplQ.trim().toLowerCase()),
  );
  const sheetMatches = (sheets || [])
    .filter((w) => w.name.toLowerCase().includes(sheetQ.trim().toLowerCase()))
    .sort((a, b) => ((viewed[b.id] || 0) - (viewed[a.id] || 0)) || a.name.localeCompare(b.name));

  const renameField = (w) => (
    <input
      className="input rename-input"
      value={editName}
      autoFocus
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setEditName(e.target.value)}
      onBlur={() => commitRename(w)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commitRename(w);
        if (e.key === 'Escape') setEditingId(null);
      }}
    />
  );

  const rowActions = (w) => (
    <span className="gcard-actions" onClick={(e) => e.stopPropagation()}>
      <button className="iconbtn" aria-label={`Rename ${w.name}`}
              onClick={() => { setEditingId(w.id); setEditName(w.name); }}>
        <Pencil size={13} />
      </button>
      <button className="iconbtn danger" aria-label={`Delete ${w.name}`}
              onClick={() => setDeleting(w)}>
        <Trash2 size={13} />
      </button>
    </span>
  );

  return (
    <div className="shell">
      <Topbar onSignIn={() => { setLoginSubtitle('Sign in to continue.'); pendingRef.current = null; setLoginOpen(true); }} />
      <main className="landing">
        <section className="hero">
          <h1>What sheets should we create today?</h1>
          <form className="promptbox" onSubmit={(e) => { e.preventDefault(); createFromPrompt(); }}>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); createFromPrompt(); }
              }}
              placeholder={placeholder}
              rows={3}
              autoFocus
            />
            <div className="pb-row">
              <span title="Attachments are coming soon">
                <button type="button" className="cmp-icon" disabled aria-label="Add an attachment"><Paperclip size={16} /></button>
              </span>
              <TemplateChips templates={templates} selected={tplChips} onToggle={toggleTpl} note={tplNote} />
              <span style={{ flex: 1 }} />
              <span title="Voice input is coming soon">
                <button type="button" className="cmp-icon" disabled aria-label="Voice input"><Mic size={15} /></button>
              </span>
              <button type="submit" className="btn primary" disabled={(!prompt.trim() && tplChips.length === 0) || creating}>
                {creating ? 'Creating...' : 'Create'}
                {!creating && <ArrowUp size={14} />}
              </button>
            </div>
          </form>
          {tplNote && <div className="hint" style={{ marginTop: 8 }}>{tplNote}</div>}
          {createErr && <div className="auth-err" style={{ marginTop: 10 }}>{createErr}</div>}
        </section>

        <section className="section">
          <div className="section-h">
            <h2>Use a template</h2>
            {templates.length > 0 && (
              <div className="section-tools">
                <SearchBox value={tplQ} onChange={setTplQ} placeholder="Search templates" />
              </div>
            )}
          </div>
          {templates.length === 0 ? (
            <SkeletonTemplateCards count={4} />
          ) : tplMatches.length === 0 ? (
            <div className="card empty-note">No templates match your search.</div>
          ) : (
            <div className="carousel-wrap">
              <button className="car-btn left" onClick={() => scrollCarousel(-1)} aria-label="Scroll templates left">
                <ChevronLeft size={16} />
              </button>
              <div className="carousel" ref={carRef}>
                {tplMatches.map((t) => (
                  <button
                    key={t.id}
                    className="gcard tpl"
                    title={t.description}
                    onClick={() => {
                      if (t.id === 'blank') {
                        setTplChips([]);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                        document.querySelector('.promptbox textarea')?.focus();
                      } else setPreviewTpl(t);
                    }}
                  >
                    <ArtThumb uri={t.sheet ? svgDataUri(t.sheet.tabs ? t.sheet.tabs[0] : t.sheet, { width: 472, height: 265 }) : TEMPLATE_ART_URIS[t.id]} alt={t.name} />
                    <span className="gcard-foot"><span className="gcard-name">{t.name}</span></span>
                  </button>
                ))}
              </div>
              <button className="car-btn right" onClick={() => scrollCarousel(1)} aria-label="Scroll templates right">
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </section>

        {authed && (
          <section className="section">
            <div className="section-h">
              <h2>My sheets</h2>
              {sheets !== null && sheets.length > 0 && (
                <div className="section-tools">
                  <SearchBox value={sheetQ} onChange={setWfQ} placeholder="Search sheets" />
                  <ViewToggle value={view} onChange={setView} />
                </div>
              )}
            </div>
            {sheets === null ? (
              <div className="gtable-wrap">
                <table className="gtable">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th className="col-last">Last viewed</th>
                      <th className="col-access">Access</th>
                      <th className="gt-actions" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    <SkeletonTableRows count={4} />
                  </tbody>
                </table>
              </div>
            ) : sheets.length === 0 ? (
              <div className="card empty-note">No sheets yet. Create one from the prompt above or pick a template.</div>
            ) : sheetMatches.length === 0 ? (
              <div className="card empty-note">No sheets match your search.</div>
            ) : view === 'grid' ? (
              <div className="ggrid">
                {sheetMatches.map((w) => (
                  <div key={w.id} className="gcard mine" role="button" tabIndex={0}
                       onClick={() => { if (editingId !== w.id) openSheet(w.id); }}
                       onKeyDown={(e) => { if (e.key === 'Enter' && editingId !== w.id) openSheet(w.id); }}>
                    <Thumb path={sheetThumbPath(w.id)} alt={w.name}
                           refreshKey={thumbRefresh[w.id] || 0}
                           onMiss={() => reportThumbMiss(w.id)} />
                    <span className="gcard-foot">
                      {editingId === w.id ? renameField(w) : (
                        <>
                          <span className="gcard-name" title={w.name}>{w.name}</span>
                          {relativeTime(viewed[w.id]) && <span className="gcard-sub">{relativeTime(viewed[w.id])}</span>}
                          {rowActions(w)}
                        </>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="gtable-wrap">
                <table className="gtable">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th className="col-last">Last viewed</th>
                      <th className="col-access">Access</th>
                      <th className="gt-actions" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {sheetMatches.map((w) => (
                      <tr key={w.id} tabIndex={0}
                          onClick={() => { if (editingId !== w.id) openSheet(w.id); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' && editingId !== w.id) openSheet(w.id); }}>
                        <td>
                          <span className="gt-name">
                            <span className="gt-thumb">
                              <Thumb path={sheetThumbPath(w.id)} alt=""
                                     refreshKey={thumbRefresh[w.id] || 0}
                                     onMiss={() => reportThumbMiss(w.id)} />
                            </span>
                            {editingId === w.id ? renameField(w)
                              : <span className="gcard-name" title={w.name}>{w.name}</span>}
                          </span>
                        </td>
                        <td className="gt-last col-last">{relativeTime(viewed[w.id]) || '—'}</td>
                        <td className="col-access"><AccessStack me={me} assignments={access[w.id]} /></td>
                        <td className="gt-actions">{rowActions(w)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>

      {previewTpl && (
        <Dialog onClose={() => setPreviewTpl(null)} width={860}>
          <div className="tpl-preview">
            <div className="tpl-preview-h">
              <div>
                <h3>{previewTpl.name}</h3>
                <p className="tpl-preview-desc">{previewTpl.description}</p>
              </div>
              <div className="tpl-preview-actions">
                <button className="btn" disabled={creating}
                        onClick={() => { toggleTpl(previewTpl); setPreviewTpl(null);
                                         window.scrollTo({ top: 0, behavior: 'smooth' });
                                         document.querySelector('.promptbox textarea')?.focus(); }}>
                  Add as reference
                </button>
                <button className="btn primary" disabled={creating}
                        onClick={() => withAuth(async () => {
                          setCreating(true);
                          try {
                            const res = await createSheet(previewTpl.name, previewTpl.id);
                            openSheet(res.id);
                          } catch (e) {
                            setCreateErr(e.message || 'Could not create the sheet.');
                            setPreviewTpl(null);
                          } finally { setCreating(false); }
                        })}>
                  {creating ? 'Creating…' : 'Use this template'}
                </button>
              </div>
            </div>
            <div className="tpl-preview-grid">
              {previewTpl.sheet
                ? <SheetGrid sheet={previewTpl.sheet.tabs ? previewTpl.sheet.tabs[0] : previewTpl.sheet} readOnly />
                : <div className="empty-note">No preview available.</div>}
            </div>
            <p className="tpl-preview-note">Sample data — your sheet starts from this and the copilot adapts it to your real data.</p>
          </div>
        </Dialog>
      )}

      {/* One at a time: a full render+upload per missing thumbnail. */}
      {healQueue.length > 0 && (
        <ThumbHealer
          key={healQueue[0]}
          sheetId={healQueue[0]}
          onDone={(ok) => onHealDone(healQueue[0], ok)}
        />
      )}

      {loginOpen && (
        <Dialog onClose={() => { setLoginOpen(false); pendingRef.current = null; }} width={400}>
          <AuthForm
            subtitle={loginSubtitle}
            onDone={() => {
              setLoginOpen(false);
              setAuthed(true);
              const run = pendingRef.current;
              pendingRef.current = null;
              if (run) run();
            }}
          />
        </Dialog>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete sheet"
          body={(
            <>
              <b>{deleting.name}</b> will be removed from your workspace. This cannot be undone.
            </>
          )}
          busy={deleteBusy}
          onConfirm={confirmDelete}
          onClose={() => { if (!deleteBusy) setDeleting(null); }}
        />
      )}
    </div>
  );
}
