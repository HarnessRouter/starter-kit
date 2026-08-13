// Landing: describe a sheet, start from a template, or reopen one you have.
//
// A sheet is a session on this kit's Harness, so "My sheets" is that harness's session list and
// there is nothing else to store. Creating one costs no network call here: the choice becomes
// real on the first turn, which is the only thing that opens a session.
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, MoreHorizontal, Sparkles, Table2 } from 'lucide-react';
import { useDialog } from 'reifyui';
import {
  deleteSheet, lastViewedMap, listSheets, newSheetId, relativeTime, renameSheet, sheetsHarness,
} from '../lib/sh';
import { listTemplates } from '../lib/templates';
import { Topbar } from '../components/Topbar';

function openNew(template, seed) {
  const params = new URLSearchParams();
  if (seed) params.set('seed', seed);
  if (template && template !== 'blank') params.set('tpl', template);
  const q = params.toString();
  window.location.hash = `#/s/${newSheetId(template)}${q ? `?${q}` : ''}`;
}

function TemplateCard({ template, onPick }) {
  const agentCols = (template.sheet?.columns || []).filter((c) => c.type === 'harness').length;
  return (
    <button className="tpl-card" onClick={() => onPick(template.id)}>
      <div className="tpl-grid" aria-hidden="true">
        {(template.sheet?.columns || []).slice(0, 4).map((c) => (
          <span key={c.id} className={'tpl-col' + (c.type === 'harness' ? ' agent' : '')}>{c.name}</span>
        ))}
      </div>
      <div className="tpl-name">{template.name}</div>
      <div className="tpl-sub">
        {template.description}
        {agentCols > 0 && (
          <span className="tpl-badge">{agentCols} agent column{agentCols === 1 ? '' : 's'}</span>
        )}
      </div>
    </button>
  );
}

function SheetRow({ sheet, viewed, onRename, onDelete }) {
  const [menu, setMenu] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenu(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menu]);
  return (
    <tr>
      <td>
        <a className="sheet-link" href={`#/s/${encodeURIComponent(sheet.id)}`}>
          <Table2 size={15} /> {sheet.name}
        </a>
      </td>
      <td className="mute">{relativeTime(viewed) || relativeTime(sheet.updated_at) || '—'}</td>
      <td className="row-actions">
        <div className="avmenu-wrap" ref={wrapRef}>
          <button className="pane-btn" aria-label={`Actions for ${sheet.name}`}
                  onClick={() => setMenu((v) => !v)}><MoreHorizontal size={16} /></button>
          {menu && (
            <div className="avmenu">
              <button className="item" onClick={() => { setMenu(false); onRename(sheet); }}>Rename</button>
              <button className="item out" onClick={() => { setMenu(false); onDelete(sheet); }}>Delete</button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

export function LandingPage() {
  const [prompt, setPrompt] = useState('');
  const [templates, setTemplates] = useState([]);
  const [sheets, setSheets] = useState(null);      // null = loading
  const [launched, setLaunched] = useState(null);  // null = unknown yet
  const [viewed, setViewed] = useState({});
  const dialog = useDialog();

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

  const rename = async (sheet) => {
    const name = await dialog.prompt({ title: 'Rename this sheet', defaultValue: sheet.name, confirmLabel: 'Rename' });
    if (!name?.trim()) return;
    await renameSheet(sheet.id, name.trim()).catch(() => {});
    reload();
  };

  const remove = async (sheet) => {
    const ok = await dialog.confirm({
      title: `Delete “${sheet.name}”?`,
      body: 'The sheet and its conversation go with it. This cannot be undone.',
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await deleteSheet(sheet.id).catch((e) => dialog.alert({ variant: 'error', title: 'Could not delete', body: e.message }));
    reload();
  };

  return (
    <div className="land">
      <Topbar />

      <section className="hero">
        <h1>What do you want to work through?</h1>
        <p className="hero-sub">
          Describe the sheet. Columns that run one of your agents on every row are set up here too.
        </p>
        <div className="hero-box">
          <textarea
            className="hero-input" rows={3} value={prompt} autoFocus
            placeholder="Track 20 competitors: name, site, a short brief on each, and how directly they compete."
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && prompt.trim()) openNew('blank', prompt.trim());
            }} />
          <button className="btn primary hero-go" disabled={!prompt.trim() || launched === false}
                  onClick={() => openNew('blank', prompt.trim())}>
            <ArrowUp size={16} /> Start
          </button>
        </div>
      </section>

      {launched === false && (
        <div className="page-note">
          Sheets hasn’t been launched yet — open Starter Kits and launch it.
        </div>
      )}

      {templates.length > 0 && (
        <section className="sec">
          <h2><Sparkles size={16} /> Start from a template</h2>
          <div className="tpl-row scroll">
            {templates.map((t) => <TemplateCard key={t.id} template={t} onPick={(id) => openNew(id, '')} />)}
          </div>
        </section>
      )}

      <section className="sec">
        <h2>My sheets</h2>
        {sheets === null ? (
          <div className="empty-note">Loading…</div>
        ) : sheets.length === 0 ? (
          <div className="empty-note">
            {launched === false ? 'Nothing here yet.' : 'No sheets yet — describe one above.'}
          </div>
        ) : (
          <table className="gtable">
            <thead><tr><th>Name</th><th>Last opened</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {sheets.map((s) => (
                <SheetRow key={s.id} sheet={s} viewed={viewed[s.id]} onRename={rename} onDelete={remove} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
