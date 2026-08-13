// Sheet page — CG/Flowness banner layout with the shared SheetGrid center +
// copilot chat right. One gp-banner (wordmark + home / Export menu / credits +
// avatar), the grid fills gp-content, the copilot column sits at the right edge.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, HelpCircle, Home } from 'lucide-react';
import { SheetGrid, sheetToDelimited, sheetToAoA } from 'reifyui';
import { PaneResizer, useResizablePane } from 'reifyui';
import { getSession, isAuthed } from '../lib/auth';
import { getSheet, saveSheet, runCell, runColumn, markViewed, putThumbnail, SH_API, fetchThumbUrl } from '../lib/sh';
import { sheetToPngBlob } from '../lib/thumb';
import { useSheetCollab } from '../lib/collab';
import { ChatColumn } from '../components/ChatPanel';
import { AvatarMenu, CreditsBadge, LINKS, Wordmark } from '../components/Topbar';

function ExportMenu({ doc, tab, name }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);
  const download = (sep, ext, mime) => {
    const text = sheetToDelimited(tab, sep);
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = `${(name || 'sheet').replace(/[^\w.-]+/g, '_')}.${ext}`;
    a.click(); URL.revokeObjectURL(url);
    setOpen(false);
  };
  return (
    <div className="sh-export" ref={ref}>
      <button className="pane-btn" onClick={() => setOpen((v) => !v)} title="Export">
        <Download size={16} /> Export
      </button>
      {open && (
        <div className="sh-export-menu">
          <button onClick={() => download(',', 'csv', 'text/csv')}>CSV (.csv)</button>
          <button onClick={() => download('\t', 'tsv', 'text/tab-separated-values')}>TSV (.tsv)</button>
          <button onClick={async () => {
            const XLSX = await import('xlsx');
            const wb = XLSX.utils.book_new();
            for (const t of (doc.tabs || [tab])) {
              const ws = XLSX.utils.aoa_to_sheet(sheetToAoA(t));
              XLSX.utils.book_append_sheet(wb, ws, (t.name || 'Sheet').slice(0, 31));
            }
            XLSX.writeFile(wb, `${(name || 'sheet').replace(/[^\w.-]+/g, '_')}.xlsx`);
            setOpen(false);
          }}>Excel (.xlsx)</button>
        </div>
      )}
    </div>
  );
}

const migrate = (doc) => {
  if (doc && !doc.tabs) {
    return { ...doc, tabs: [{ id: 'tab_legacy', name: 'Sheet 1',
      columns: doc.columns || [], rows: doc.rows || [], cells: doc.cells || {} }] };
  }
  return doc;
};

export function SheetPage({ id, seed }) {
  const [meta, setMeta] = useState(null);      // { sheet_id, name }
  const [sheet, setSheet] = useState(null);    // the document JSON {meta, tabs}
  const [tabId, setTabId] = useState(null);    // active tab id (null = first)
  const [renamingTab, setRenamingTab] = useState(null);
  const [err, setErr] = useState('');
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const chatPane = useResizablePane({
    initial: 380, min: 300, maxFraction: 0.6, fromRight: true, storageKey: 'sheets.chat.w',
  });

  const collab = useSheetCollab(id);

  useEffect(() => {
    if (!isAuthed()) { window.location.hash = '#/login'; return undefined; }
    let dead = false;
    markViewed(id);
    getSheet(id)
      .then((r) => { if (!dead) { setSheet(migrate(r.sheet)); setMeta({ sheet_id: r.sheet_id, name: r.sheet?.meta?.title || 'Untitled' }); } })
      .catch((e) => { if (!dead) setErr(e.message || 'Could not open this sheet.'); });
    return () => { dead = true; };
  }, [id]);

  // Live truth from collab (copilot builds / peers' saves) rebases the grid.
  useEffect(() => {
    if (collab.liveSheet) {
      setSheet(migrate(collab.liveSheet));
      setMeta((m) => (m ? { ...m, name: collab.liveSheet?.meta?.title || m.name } : m));
    }
  }, [collab.liveSheet]);

  const tabs = sheet?.tabs || [];
  const tab = tabs.find((t) => t.id === tabId) || tabs[0] || null;

  const saveDoc = (next) => {
    setSheet(next);                       // optimistic
    saveSheet(id, next).catch((e) => setErr(e.message || 'save failed'));
  };
  // SheetGrid edits ONE tab; reassemble the document around it.
  const onChange = (nextTab) => {
    if (!sheet || !tab) return;
    saveDoc({ ...sheet, tabs: tabs.map((t) => (t.id === tab.id ? nextTab : t)) });
  };
  const addTab = () => {
    const t = { id: `tab_${Math.random().toString(36).slice(2, 10)}`,
                name: `Sheet ${tabs.length + 1}`, columns: [], rows: [], cells: {} };
    saveDoc({ ...sheet, tabs: [...tabs, t] });
    setTabId(t.id);
  };
  const renameTab = (tid, name) => {
    saveDoc({ ...sheet, tabs: tabs.map((t) => (t.id === tid ? { ...t, name } : t)) });
  };
  const deleteTab = (tid) => {
    if (tabs.length <= 1) return;
    const next = tabs.filter((t) => t.id !== tid);
    saveDoc({ ...sheet, tabs: next });
    if (tab?.id === tid) setTabId(next[0].id);
  };

  // Mark a computed cell/column running locally, then run + let the saved
  // truth (returned + republished) settle the final value.
  const markStatus = (patch) => setSheet((s) => {
    if (!s || !tab) return s;
    const n = JSON.parse(JSON.stringify(s));
    const t = n.tabs.find((x) => x.id === tab.id); if (!t) return s;
    t.cells = t.cells || {};
    patch(t); return n;
  });
  const onRunCell = async (rowId, colId) => {
    const col = tab.columns.find((c) => c.id === colId);
    markStatus((t) => { t.cells[`${rowId}:${colId}`] = { ...(t.cells[`${rowId}:${colId}`] || {}), status: 'running' }; });
    try {
      const { cell } = await runCell(id, rowId, col.name, tab.id);
      markStatus((t) => { t.cells[`${rowId}:${colId}`] = cell; });
    } catch (e) {
      markStatus((t) => { t.cells[`${rowId}:${colId}`] = { status: 'failed', error: String(e.message || e) }; });
    }
  };
  const onRunColumn = async (colId) => {
    const col = tab.columns.find((c) => c.id === colId);
    for (const r of tab.rows) {
      markStatus((t) => { t.cells[`${r.id}:${colId}`] = { ...(t.cells[`${r.id}:${colId}`] || {}), status: 'running' }; });
    }
    try {
      await runColumn(id, col.name, tab.id);
      const fresh = await getSheet(id);      // pull the filled truth
      setSheet(migrate(fresh.sheet));
    } catch (e) { setErr(e.message || 'run failed'); }
  };

  // Thumbnail: debounce a mini-grid PNG capture after the sheet settles, so
  // the landing card always reflects the latest grid (CG pattern).
  useEffect(() => {
    const first = sheet?.tabs?.[0];
    if (!first || !first.columns?.length) return undefined;
    const t = window.setTimeout(async () => {
      try {
        const png = await sheetToPngBlob(first);
        if (png) await putThumbnail(id, png);
      } catch { /* best-effort */ }
    }, 1500);
    return () => window.clearTimeout(t);
  }, [id, sheet]);

  // Resource plumbing: authed blob fetch for inline images; ref chips open
  // the referenced artifact in its own product (nested sheets stay in-app).
  const fetchBlobUrl = (path) => fetchThumbUrl(path);
  const onOpenResource = (ref) => {
    if (ref.kind === 'sheet' && ref.id) { window.location.hash = `#/s/${ref.id}`; return; }
    const bases = { slides: 'https://slides.wrapper.work/#/d/', workflow: 'https://app.flowness.ai/#/w/', graph: 'https://app.contextualgraph.ai/#/g/' };
    const url = ref.url && /^https?:/i.test(ref.url) ? ref.url
      : ref.id && bases[ref.kind] ? `${bases[ref.kind]}${encodeURIComponent(ref.id)}` : null;
    if (url) window.open(url, '_blank', 'noreferrer');
  };

  // Presence: outline the cells other humans are editing (this tab only) and
  // show their avatars in the banner — the CG/Flowness pattern on awareness.
  const peerMarks = useMemo(() => {
    const marks = {};
    for (const p of collab.peers) {
      if (p.cell && (!p.tab || !tab || p.tab === tab.id)) marks[p.cell] = { name: p.name, color: p.color };
    }
    return marks;
  }, [collab.peers, tab?.id]);
  const onActiveCell = (cellKey) => collab.setActiveCell(tab?.id || null, cellKey);

  const grid = useMemo(() => tab && (
    <SheetGrid sheet={tab} onChange={onChange} onRunCell={onRunCell} onRunColumn={onRunColumn}
               fetchBlobUrl={fetchBlobUrl} onOpenResource={onOpenResource}
               peerMarks={peerMarks} onActiveCell={onActiveCell} />
  ), [sheet, tab, peerMarks]);

  return (
    <div className="gp-root">
      <div className="gp-main">
        <header className="gp-banner">
          <a className="wordmark" href="#/"><Wordmark size={15} /></a>
          <a className="pane-btn gp-home" href="#/" title="Home" aria-label="Home"><Home size={16} /></a>
          <span className="crumb-sep">/</span>
          <span className="crumb-name" title={meta?.name}>{meta?.name || 'Sheet'}</span>
          <div className="gp-banner-right">
            {sheet && tab && <ExportMenu doc={sheet} tab={tab} name={meta?.name} />}
            <CreditsBadge />
            <a className="pane-btn gp-help" href={LINKS.docs} target="_blank" rel="noreferrer" title="Documentation"><HelpCircle size={16} /></a>
            <span className="sh-people">
              {collab.peers.slice(0, 4).map((p) => (
                <span key={p.id} className="av sh-peer-dot" style={{ background: p.color }} title={p.name}>
                  {(p.name || '?').trim().slice(0, 1)}
                </span>
              ))}
              <AvatarMenu />
            </span>
          </div>
        </header>
        <div className="gp-content sh-content">
          {err ? <div className="page-note">{err}</div>
            : !sheet ? <div className="empty-note" style={{ paddingTop: 80 }}>Loading sheet…</div>
              : grid}
        </div>
        {sheet && tabs.length > 0 && (
          <div className="shg-tabs">
            <button className="shg-tab-add" onClick={addTab} title="Add sheet">+</button>
            {tabs.map((t) => (
              <button key={t.id} className={'shg-tab' + ((tab?.id === t.id) ? ' active' : '')}
                      onClick={() => setTabId(t.id)}
                      onDoubleClick={() => setRenamingTab(t.id)}>
                {renamingTab === t.id ? (
                  <input className="shg-tab-name-input" defaultValue={t.name} autoFocus
                         onClick={(e) => e.stopPropagation()}
                         onBlur={(e) => { setRenamingTab(null); const v = e.target.value.trim(); if (v && v !== t.name) renameTab(t.id, v); }}
                         onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setRenamingTab(null); }} />
                ) : (
                  <>
                    {t.name}
                    {tabs.length > 1 && (
                      <span className="shg-tab-del" title="Delete sheet"
                            onClick={(e) => { e.stopPropagation(); deleteTab(t.id); }}>×</span>
                    )}
                  </>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      {!chatCollapsed && <PaneResizer pane={chatPane} />}
      <ChatColumn
        sheetId={id}
        seed={seed}
        title={meta?.name || 'Copilot'}
        copilotBuilding={collab.copilotBuilding}
        collapsed={chatCollapsed}
        onToggle={() => setChatCollapsed((v) => !v)}
        width={chatPane.width}
      />
    </div>
  );
}
