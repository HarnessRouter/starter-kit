// Landing: describe a sheet, start from a template, or reopen one you have.
//
// A sheet is a session on this kit's Harness, so "My sheets" is that harness's session list and
// there is nothing else to store. Creating one costs no network call here: the choice becomes
// real on the first turn, which is the only thing that opens a session. That is why every path
// out of this page NAVIGATES — the prompt, the file and the template all ride to #/s/new:… and
// the copilot sends the first message there.
//
// The page is composed from the package's library primitives (Composer, Carousel, Card, Chip,
// SearchField, Modal). The topbar sits OUTSIDE the centred column, so the bar spans the viewport
// instead of being a floating slab inset from both edges.
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Eye, Pencil, Table2, Trash2 } from 'lucide-react';
import {
  Card, Carousel, Chip, Composer, IcMic, IcPaperclip, Modal, SearchField, SheetGrid,
  bytesLabel, createDictation, useDialog, useTypewriter,
} from 'reifyui';
import { fileToInputBlock } from 'reifyui/harness';
import {
  deleteSheet, lastViewedMap, listSheets, newSheetId, relativeTime, renameSheet, sheetsHarness,
  stageAttachments,
} from '../lib/sh';
import { GRID_TYPES } from '../lib/model';
import { listTemplates } from '../lib/templates';
import { Topbar } from '../components/Topbar';

// The placeholder cycles through things this product is actually for. They are examples, not
// claims about anyone's data.
const PROMPT_IDEAS = [
  'A marketing campaign tracker with an AI-written summary per campaign',
  'One competitor per row — research and score each with an agent',
  'A list of companies, enriched with industry, size, and a fit score',
  'Test cases in rows; run each one and record pass/fail + notes',
  'Track my content ideas, drafts, channels, and how each performed',
  'Daily competitor prices collected into a sheet, flagged if they changed',
];

/** A template's shape, drawn from the template itself: its first columns, and blank rows beneath.
 *  The rows are empty because the template ships none — a preview that invented sample values
 *  would be showing data the sheet will never contain. */
function TemplateArt({ template }) {
  const cols = (template.sheet?.columns || []).slice(0, 4);
  const rows = (template.sheet?.rows || []).slice(0, 3);
  return (
    <span className="sh-tpl-art" aria-hidden="true">
      <span className="sh-tpl-row is-head">
        {cols.map((c) => (
          <span key={c.id} className={'sh-tpl-cell' + (c.type === 'harness' ? ' is-agent' : '')}>
            {c.name}
          </span>
        ))}
      </span>
      {rows.map((r) => (
        <span key={r.id} className="sh-tpl-row">
          {cols.map((c) => (
            <span key={c.id} className={'sh-tpl-cell' + (c.type === 'harness' ? ' is-agent' : '')} />
          ))}
        </span>
      ))}
    </span>
  );
}

export function LandingPage() {
  const [prompt, setPrompt] = useState('');
  const [templates, setTemplates] = useState(null);   // null = loading
  const [sheets, setSheets] = useState(null);         // null = loading
  const [launched, setLaunched] = useState(null);     // null = unknown yet
  const [viewed, setViewed] = useState({});
  const [tpl, setTpl] = useState(null);               // the template chip on the prompt bar
  const [preview, setPreview] = useState(null);       // the template open in the eye modal
  const [staged, setStaged] = useState([]);           // files picked, not yet sent
  const [attachErr, setAttachErr] = useState('');
  const [listening, setListening] = useState(false);
  const [tplQ, setTplQ] = useState('');
  const [sheetQ, setSheetQ] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');

  const fileRef = useRef(null);
  const promptRef = useRef(null);
  const dialog = useDialog();
  // Built once — a new recogniser per render would stop dictation on every keystroke. Null where
  // the browser has none, and then there is no microphone at all rather than a dead one.
  const [dictation] = useState(() => createDictation());
  const placeholder = useTypewriter(PROMPT_IDEAS, { active: prompt === '' });

  const reload = () => listSheets().then(setSheets).catch(() => setSheets([]));

  useEffect(() => {
    setViewed(lastViewedMap());
    listTemplates().then(setTemplates).catch(() => setTemplates([]));
    sheetsHarness().then((h) => {
      setLaunched(!!h);
      // Not launched is a real answer with a real fix, so it is rendered. Catching it into an
      // empty list would show "no sheets yet" to someone whose actual problem is that nothing is
      // running.
      if (h) reload(); else setSheets([]);
    }).catch(() => { setLaunched(false); setSheets([]); });
  }, []);

  // Leaving the page must release the microphone.
  useEffect(() => () => dictation?.stop(), [dictation]);

  // ── the prompt bar ────────────────────────────────────────────────────────
  function pick(list) {
    setAttachErr('');
    for (const file of list) {
      // The chip appears immediately and resolves in place: reading 25 MB into a data URL is a
      // real wait, and a picker that looks inert is how the same file gets picked twice.
      const entry = { name: file.name, size: file.size, pending: true };
      setStaged((cur) => [...cur, entry]);
      fileToInputBlock(file).then((ready) => {
        setStaged((cur) => cur.map((s) => (s === entry ? { ...entry, ...ready, pending: false } : s)));
      }).catch((e) => {
        setStaged((cur) => cur.filter((s) => s !== entry));
        setAttachErr(e?.message || `${file.name} could not be attached.`);
      });
    }
  }

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

  const preparing = staged.some((f) => f.pending);
  const startBlocked = launched === false || preparing
    || (!prompt.trim() && !tpl && staged.length === 0);

  function start() {
    if (startBlocked) return;
    if (listening) { dictation?.stop(); setListening(false); }
    const text = prompt.trim();
    const id = newSheetId(tpl?.id || 'blank');
    // The prepared blocks cannot travel in the URL, so they wait in memory under this pending id
    // and the copilot picks them up on the first turn (lib/sh.js).
    stageAttachments(id, staged.map((f) => f.payload));
    // The seed becomes the person's first chat message, so it is a sentence — never the template
    // JSON, which travels as instructions and stays out of the transcript (lib/copilot.js).
    const seed = text
      || (tpl ? `Start a sheet from the ${tpl.name} template.`
        : `Build a sheet from ${staged.map((f) => f.name).join(', ')}.`);
    window.location.hash = `#/s/${id}?seed=${encodeURIComponent(seed)}`;
  }

  function chooseTemplate(t) {
    setTpl(t);
    setPreview(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    promptRef.current?.focus();
  }

  // ── my sheets ─────────────────────────────────────────────────────────────
  const openSheet = (id) => { window.location.hash = `#/s/${encodeURIComponent(id)}`; };

  async function commitRename(sheet) {
    const name = editName.trim();
    setEditingId(null);
    if (!name || name === sheet.name) return;
    setSheets((list) => list.map((x) => (x.id === sheet.id ? { ...x, name } : x)));
    // Put the old name back if the rename did not stick, rather than leaving the list showing a
    // name the sheet does not have.
    renameSheet(sheet.id, name).catch(() => {
      setSheets((list) => list.map((x) => (x.id === sheet.id ? { ...x, name: sheet.name } : x)));
    });
  }

  async function remove(sheet) {
    const ok = await dialog.confirm({
      title: `Delete “${sheet.name}”?`,
      message: 'The sheet and its conversation go with it. This cannot be undone.',
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await deleteSheet(sheet.id).catch((e) => dialog.alert({
      variant: 'error', title: 'Could not delete', message: e.message,
    }));
    reload();
  }

  const tplMatches = (templates || []).filter(
    (t) => t.name.toLowerCase().includes(tplQ.trim().toLowerCase()),
  );
  const sheetMatches = (sheets || [])
    .filter((s) => s.name.toLowerCase().includes(sheetQ.trim().toLowerCase()))
    .sort((a, b) => ((viewed[b.id] || 0) - (viewed[a.id] || 0)) || a.name.localeCompare(b.name));

  const rowActions = (s) => (
    <>
      <button type="button" className="uic-iconbtn" aria-label={`Rename ${s.name}`}
              onClick={() => { setEditingId(s.id); setEditName(s.name); }}>
        <Pencil size={13} />
      </button>
      <button type="button" className="uic-iconbtn is-danger" aria-label={`Delete ${s.name}`}
              onClick={() => remove(s)}>
        <Trash2 size={13} />
      </button>
    </>
  );

  return (
    <div className="uic-shell">
      <Topbar />
      <main className="uic-page">
        <section className="uic-hero">
          <h1>What sheets should we create today?</h1>
          <p>Describe the sheet. Columns that run one of your agents on every row are set up here too.</p>

          <Composer
            value={prompt}
            onChange={setPrompt}
            onSend={start}
            sendDisabled={startBlocked}
            placeholder={placeholder}
            inputAriaLabel="Describe the sheet you want"
            rows={3}
            autoGrow={false}
            autoFocus
            inputRef={promptRef}
            classNames={{ root: 'uic-promptbox', input: 'uic-promptbox-input', row: 'uic-promptbox-row' }}
            accessoriesLeft={(
              <>
                <input ref={fileRef} type="file" hidden multiple
                       onChange={(e) => { pick([...e.target.files]); e.target.value = ''; }} />
                <button type="button" className="uic-chat-icon" aria-label="Attach a file"
                        title="Attach a file — the agent gets it with your first message"
                        onClick={() => fileRef.current?.click()}>
                  <IcPaperclip />
                </button>
                {staged.map((f, i) => (
                  <Chip
                    key={`${f.name}-${i}`}
                    icon={<IcPaperclip size={11} />}
                    title={f.name}
                    label={<>
                      <span className="uic-chip-t">{f.name}</span>
                      <span className="uic-chip-meta">{f.pending ? '…' : bytesLabel(f.size)}</span>
                    </>}
                    onRemove={() => setStaged((c) => c.filter((_, j) => j !== i))}
                    removeLabel={`Remove ${f.name}`}
                  />
                ))}
                {tpl && (
                  <Chip
                    selected
                    icon={<Table2 size={12} />}
                    title={tpl.description}
                    label={`Template: ${tpl.name}`}
                    onRemove={() => setTpl(null)}
                    removeLabel={`Remove template ${tpl.name}`}
                  />
                )}
              </>
            )}
            accessoriesRight={dictation ? (
              <button type="button" className={'uic-chat-icon' + (listening ? ' is-on' : '')}
                      aria-label={listening ? 'Stop dictating' : 'Dictate'} aria-pressed={listening}
                      onClick={toggleDictation}>
                <IcMic />
              </button>
            ) : null}
            renderSend={() => (
              <button type="button" className="btn primary" onClick={start} disabled={startBlocked}>
                Create <ArrowUp size={14} />
              </button>
            )}
          />
          {attachErr && <div className="uic-note is-err">{attachErr}</div>}
          {launched === false && (
            <div className="uic-note">
              Sheets hasn’t been launched yet — open Starter Kits and launch it.
            </div>
          )}
        </section>

        <section className="uic-section">
          <div className="uic-section-h">
            <h2>Use a template</h2>
            {tplMatches.length > 0 && (
              <div className="uic-section-tools">
                <SearchField value={tplQ} onChange={setTplQ} placeholder="Search templates" />
              </div>
            )}
          </div>
          {templates === null ? (
            <div className="uic-note">Loading…</div>
          ) : templates.length === 0 ? (
            <div className="uic-note">No templates are installed with this kit.</div>
          ) : tplMatches.length === 0 ? (
            <div className="uic-note">No templates match your search.</div>
          ) : (
            <Carousel label="templates">
              {tplMatches.map((t) => {
                const agents = (t.sheet?.columns || []).filter((c) => c.type === 'harness').length;
                return (
                  <Card
                    key={t.id}
                    art={<TemplateArt template={t} />}
                    title={<span title={t.description}>{t.name}</span>}
                    subtitle={agents > 0 ? `${agents} agent${agents === 1 ? '' : 's'}` : undefined}
                    selected={tpl?.id === t.id}
                    // A card press CHOOSES the template — it does not create anything. The sheet
                    // is still made by the first turn, from the prompt bar.
                    onClick={() => chooseTemplate(t)}
                    overlay={(
                      <button type="button" className="uic-iconbtn sh-eye"
                              aria-label={`Preview ${t.name}`} title={`Preview ${t.name}`}
                              onClick={() => setPreview(t)}>
                        <Eye size={14} />
                      </button>
                    )}
                  />
                );
              })}
            </Carousel>
          )}
        </section>

        <section className="uic-section">
          <div className="uic-section-h">
            <h2>My sheets</h2>
            {sheetMatches.length > 0 && (
              <div className="uic-section-tools">
                <SearchField value={sheetQ} onChange={setSheetQ} placeholder="Search sheets" />
              </div>
            )}
          </div>
          {sheets !== null && sheets.length === 0 ? (
            <div className="uic-note">
              {launched === false ? 'Nothing here yet.' : 'No sheets yet — describe one above.'}
            </div>
          ) : sheets !== null && sheetMatches.length === 0 ? (
            <div className="uic-note">No sheets match your search.</div>
          ) : (
            <div className="uic-table-wrap">
              <table className="uic-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="uic-col-last">Last opened</th>
                    <th className="uic-table-actions" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {sheets === null
                    ? [0, 1, 2, 3].map((i) => (
                      <tr key={i} className="sh-skel-row">
                        <td><span className="uic-skel sh-skel" style={{ width: `${60 - i * 6}%` }} /></td>
                        <td className="uic-col-last"><span className="uic-skel sh-skel" style={{ width: 64 }} /></td>
                        <td className="uic-table-actions" />
                      </tr>
                    ))
                    : sheetMatches.map((s) => (
                      <tr key={s.id} tabIndex={0}
                          onClick={() => { if (editingId !== s.id) openSheet(s.id); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' && editingId !== s.id) openSheet(s.id); }}>
                        <td>
                          <span className="uic-table-name">
                            <span className="sh-row-ic" aria-hidden="true"><Table2 size={15} /></span>
                            {editingId === s.id ? (
                              <input className="input rename-input" value={editName} autoFocus
                                     onClick={(e) => e.stopPropagation()}
                                     onChange={(e) => setEditName(e.target.value)}
                                     onBlur={() => commitRename(s)}
                                     onKeyDown={(e) => {
                                       e.stopPropagation();
                                       if (e.key === 'Enter') commitRename(s);
                                       if (e.key === 'Escape') setEditingId(null);
                                     }} />
                            ) : <span title={s.name}>{s.name}</span>}
                          </span>
                        </td>
                        <td className="uic-table-quiet uic-col-last">
                          {relativeTime(viewed[s.id]) || relativeTime(s.updated_at) || '—'}
                        </td>
                        <td className="uic-table-actions" onClick={(e) => e.stopPropagation()}>
                          {rowActions(s)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {preview && (
        <Modal
          open
          onClose={() => setPreview(null)}
          size="lg"
          title={preview.name}
          description={preview.description}
          actions={(
            <button type="button" className="btn primary" onClick={() => chooseTemplate(preview)}>
              Use this template
            </button>
          )}
        >
          <div className="sh-preview">
            <div className="sh-preview-grid">
              <SheetGrid sheet={preview.sheet} readOnly columnTypes={GRID_TYPES} />
            </div>
            <p className="sh-preview-note">
              The columns this template starts with. Your sheet begins here, and the copilot
              adapts it to what you ask for.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
