// Landing: describe a dashboard, start from a template, or reopen one you have.
//
// A dashboard is a session on this kit's Harness, so "My dashboards" is that harness's session
// list and there is nothing else to store. Creating one costs no network call here: the choice
// becomes real on the first turn, which is the only thing that opens a session. That is why
// every path out of this page NAVIGATES — the prompt, the file and the template all ride to
// #/d/new:… and the copilot sends the first message there.
//
// The page is composed from the package's library primitives (Composer, Carousel, Card, Chip,
// SearchField, Modal). The topbar sits OUTSIDE the centred column, so the bar spans the viewport
// instead of being a floating slab inset from both edges.
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Eye, LayoutDashboard, Pencil, Trash2 } from 'lucide-react';
import {
  Card, Carousel, Chip, Composer, IcMic, IcPaperclip, Modal, SearchField,
  bytesLabel, createDictation, useDialog, useTypewriter,
} from 'reifyui';
import { fileToInputBlock } from 'reifyui/harness';
import {
  dashboardHarness, deleteDashboard, lastViewedMap, listDashboards, newDashboardId,
  relativeTime, renameDashboard, stageAttachments,
} from '../lib/dash';
import { datasource, datasourceLabel } from '../lib/query';
import { listTemplates } from '../lib/templates';
import { Topbar } from '../components/Topbar';

// The placeholder cycles through things this product is actually for. They are examples, not
// claims about anyone's data.
const PROMPT_IDEAS = [
  'How is revenue trending this year, and which plans drive it?',
  'A support dashboard: open tickets, first response time, backlog by week',
  'Show signups, activation and churn month by month',
  'Which customers grew and which shrank over the last quarter?',
  'Orders by channel and country, with the running weekly total',
  'A one-screen summary I can show at the Monday meeting',
];

/** A template's shape, drawn from the template's own layout: one block per panel, in the grid
 *  position it will actually occupy.
 *
 *  There is no sample data in it and no invented chart — a preview that showed a plausible line
 *  going up would be showing numbers this dashboard has never seen. The shape is the honest part
 *  and it is also the useful one: it is what the person is choosing between. */
function TemplateArt({ template }) {
  const panels = (template.dashboard?.panels || []).slice(0, 10);
  return (
    <span className="db-tpl-art" aria-hidden="true">
      {panels.map((p) => {
        const l = p.layout || {};
        return (
          <span
            key={p.id}
            className={`db-tpl-cell is-${p.viz?.kind || 'chart'}`}
            style={{
              gridColumn: `${Math.min(12, (l.x || 0) + 1)} / span ${Math.max(1, Math.min(12, l.w || 3))}`,
              gridRow: `${(l.y || 0) + 1} / span ${Math.max(1, l.h || 2)}`,
            }}
          />
        );
      })}
    </span>
  );
}

export function LandingPage() {
  const [prompt, setPrompt] = useState('');
  const [templates, setTemplates] = useState(null);   // null = loading
  const [boards, setBoards] = useState(null);         // null = loading
  const [launched, setLaunched] = useState(null);     // null = unknown yet
  const [conn, setConn] = useState(undefined);        // undefined = unknown, null = none attached
  const [viewed, setViewed] = useState({});
  const [tpl, setTpl] = useState(null);               // the template chip on the prompt bar
  const [preview, setPreview] = useState(null);       // the template open in the eye modal
  const [staged, setStaged] = useState([]);           // files picked, not yet sent
  const [attachErr, setAttachErr] = useState('');
  const [listening, setListening] = useState(false);
  const [tplQ, setTplQ] = useState('');
  const [boardQ, setBoardQ] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');

  const fileRef = useRef(null);
  const promptRef = useRef(null);
  const dialog = useDialog();
  // Built once — a new recogniser per render would stop dictation on every keystroke. Null where
  // the browser has none, and then there is no microphone at all rather than a dead one.
  const [dictation] = useState(() => createDictation());
  const placeholder = useTypewriter(PROMPT_IDEAS, { active: prompt === '' });

  const reload = () => listDashboards().then(setBoards).catch(() => setBoards([]));

  useEffect(() => {
    setViewed(lastViewedMap());
    listTemplates().then(setTemplates).catch(() => setTemplates([]));
    dashboardHarness().then((h) => {
      setLaunched(!!h);
      // Not launched is a real answer with a real fix, so it is rendered. Catching it into an
      // empty list would show "no dashboards yet" to someone whose actual problem is that
      // nothing is running.
      if (h) { reload(); datasource().then(setConn).catch(() => setConn(null)); }
      else { setBoards([]); setConn(null); }
    }).catch(() => { setLaunched(false); setBoards([]); setConn(null); });
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
  // No database means no dashboard: the agent would have nothing to query and would have to
  // invent something or refuse. Blocking here, with the reason, beats letting someone write a
  // paragraph and then watching a turn fail.
  const startBlocked = launched === false || conn === null || preparing
    || (!prompt.trim() && !tpl && staged.length === 0);

  function start() {
    if (startBlocked) return;
    if (listening) { dictation?.stop(); setListening(false); }
    const text = prompt.trim();
    const id = newDashboardId(tpl?.id || 'blank');
    // The prepared blocks cannot travel in the URL, so they wait in memory under this pending id
    // and the copilot picks them up on the first turn (lib/dash.js).
    stageAttachments(id, staged.map((f) => f.payload));
    // The seed becomes the person's first chat message, so it is a sentence — never the template
    // JSON, which travels as instructions and stays out of the transcript (lib/copilot.js).
    const seed = text
      || (tpl ? tpl.prompt || `Build the ${tpl.name} dashboard.`
        : `Build a dashboard from ${staged.map((f) => f.name).join(', ')}.`);
    window.location.hash = `#/d/${id}?seed=${encodeURIComponent(seed)}`;
  }

  function chooseTemplate(t) {
    setTpl(t);
    setPreview(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    promptRef.current?.focus();
  }

  // ── my dashboards ─────────────────────────────────────────────────────────
  const open = (id) => { window.location.hash = `#/d/${encodeURIComponent(id)}`; };

  async function commitRename(board) {
    const name = editName.trim();
    setEditingId(null);
    if (!name || name === board.name) return;
    setBoards((list) => list.map((x) => (x.id === board.id ? { ...x, name } : x)));
    // Put the old name back if the rename did not stick, rather than leaving the list showing a
    // name the dashboard does not have.
    renameDashboard(board.id, name).catch(() => {
      setBoards((list) => list.map((x) => (x.id === board.id ? { ...x, name: board.name } : x)));
    });
  }

  async function remove(board) {
    const ok = await dialog.confirm({
      title: `Delete “${board.name}”?`,
      message: 'The dashboard and its conversation go with it. Your database is not touched.',
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await deleteDashboard(board.id).catch((e) => dialog.alert({
      variant: 'error', title: 'Could not delete', message: e.message,
    }));
    reload();
  }

  const tplMatches = (templates || []).filter(
    (t) => t.name.toLowerCase().includes(tplQ.trim().toLowerCase()),
  );
  const boardMatches = (boards || [])
    .filter((b) => b.name.toLowerCase().includes(boardQ.trim().toLowerCase()))
    .sort((a, b) => ((viewed[b.id] || 0) - (viewed[a.id] || 0)) || a.name.localeCompare(b.name));

  return (
    <div className="uic-shell">
      <Topbar connection={conn} />
      <main className="uic-page">
        <section className="uic-hero">
          <h1>What should we look at today?</h1>
          <p>
            Describe what you want to understand.
            {conn ? <> The agent reads <strong>{datasourceLabel(conn)}</strong> and builds it.</> : null}
          </p>

          <Composer
            value={prompt}
            onChange={setPrompt}
            onSend={start}
            sendDisabled={startBlocked}
            placeholder={placeholder}
            inputAriaLabel="Describe the dashboard you want"
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
                    icon={<LayoutDashboard size={12} />}
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
                Build <ArrowUp size={14} />
              </button>
            )}
          />
          {attachErr && <div className="uic-note is-err">{attachErr}</div>}
          {launched === false && (
            <div className="uic-note">
              Dashboards hasn’t been launched yet — open Starter Kits and launch it.
            </div>
          )}
          {launched && conn === null && (
            <div className="uic-note is-err">
              No database is connected, so there is nothing to build a dashboard from. Connect one
              in this kit’s settings.
            </div>
          )}
        </section>

        <section className="uic-section">
          <div className="uic-section-h">
            <h2>Start from a template</h2>
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
                const n = (t.dashboard?.panels || []).length;
                return (
                  <Card
                    key={t.id}
                    art={<TemplateArt template={t} />}
                    title={<span title={t.description}>{t.name}</span>}
                    subtitle={`${n} panel${n === 1 ? '' : 's'}`}
                    selected={tpl?.id === t.id}
                    // A card press CHOOSES the template — it does not create anything. The
                    // dashboard is still made by the first turn, from the prompt bar.
                    onClick={() => chooseTemplate(t)}
                    overlay={(
                      <button type="button" className="uic-iconbtn db-eye"
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
            <h2>My dashboards</h2>
            {boardMatches.length > 0 && (
              <div className="uic-section-tools">
                <SearchField value={boardQ} onChange={setBoardQ} placeholder="Search dashboards" />
              </div>
            )}
          </div>
          {boards !== null && boards.length === 0 ? (
            <div className="uic-note">
              {launched === false ? 'Nothing here yet.' : 'No dashboards yet — describe one above.'}
            </div>
          ) : boards !== null && boardMatches.length === 0 ? (
            <div className="uic-note">No dashboards match your search.</div>
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
                  {boards === null
                    ? [0, 1, 2, 3].map((i) => (
                      <tr key={i} className="db-skel-row">
                        <td><span className="uic-skel db-skel" style={{ width: `${60 - i * 6}%` }} /></td>
                        <td className="uic-col-last"><span className="uic-skel db-skel" style={{ width: 64 }} /></td>
                        <td className="uic-table-actions" />
                      </tr>
                    ))
                    : boardMatches.map((b) => (
                      <tr key={b.id} tabIndex={0}
                          onClick={() => { if (editingId !== b.id) open(b.id); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' && editingId !== b.id) open(b.id); }}>
                        <td>
                          <span className="uic-table-name">
                            <span className="db-row-ic" aria-hidden="true"><LayoutDashboard size={15} /></span>
                            {editingId === b.id ? (
                              <input className="input rename-input" value={editName} autoFocus
                                     onClick={(e) => e.stopPropagation()}
                                     onChange={(e) => setEditName(e.target.value)}
                                     onBlur={() => commitRename(b)}
                                     onKeyDown={(e) => {
                                       e.stopPropagation();
                                       if (e.key === 'Enter') commitRename(b);
                                       if (e.key === 'Escape') setEditingId(null);
                                     }} />
                            ) : <span title={b.name}>{b.name}</span>}
                          </span>
                        </td>
                        <td className="uic-table-quiet uic-col-last">
                          {relativeTime(viewed[b.id]) || relativeTime(b.updated_at) || '—'}
                        </td>
                        <td className="uic-table-actions" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="uic-iconbtn" aria-label={`Rename ${b.name}`}
                                  onClick={() => { setEditingId(b.id); setEditName(b.name); }}>
                            <Pencil size={13} />
                          </button>
                          <button type="button" className="uic-iconbtn is-danger" aria-label={`Delete ${b.name}`}
                                  onClick={() => remove(b)}>
                            <Trash2 size={13} />
                          </button>
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
          <div className="db-preview">
            <div className="db-preview-art"><TemplateArt template={preview} /></div>
            <div className="db-preview-side">
              <h4>What it answers</h4>
              <ul>
                {(preview.dashboard?.panels || []).map((p) => (
                  <li key={p.id}>
                    {p.title}
                    {p.caption ? <span className="db-preview-cap"> — {p.caption}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="db-preview-note">
            {/* The honest caveat, and the reason `adapt` exists in every template: a template is
                a shape, not a schema. Saying so here stops the first turn from being a surprise. */}
            A template is a starting shape, not an assumption about your database. The agent reads
            your schema first and maps each panel onto the tables you actually have — or says so
            when something it asks for isn’t there.
          </p>
        </Modal>
      )}
    </div>
  );
}
