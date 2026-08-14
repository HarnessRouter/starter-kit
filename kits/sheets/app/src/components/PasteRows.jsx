// Getting data into a sheet without spending a turn on it.
//
// A dialog rather than an in-grid paste, and deliberately: SheetGrid has no selection model at
// all — no anchor cell, no keyboard navigation — so a paste would have nowhere to land. Here the
// person sees exactly what was parsed, which columns it maps onto, and what will be created,
// before anything changes.
import { useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { applyImport, parseDelimited, planImport } from '../lib/paste';

const PREVIEW_ROWS = 6;

export function PasteRows({ sheet, onApply, onClose }) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState('append');
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);

  const parsed = useMemo(() => (text.trim() ? parseDelimited(text) : null), [text]);
  const [mapping, setMapping] = useState(null);
  const plan = useMemo(() => (parsed ? planImport(sheet, parsed) : null), [sheet, parsed]);
  const effective = mapping && mapping.length === (parsed?.header.length || 0) ? mapping : plan?.mapping;

  const readFile = (file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => { setText(String(r.result || '')); setMapping(null); };
    r.readAsText(file);
  };

  const setTarget = (i, colId) => {
    const next = (effective || []).map((m, j) => (j === i
      ? { ...m, colId: colId || null, newName: colId ? '' : (m.newName || m.header) }
      : m));
    setMapping(next);
  };

  const newCount = (effective || []).filter((m) => !m.colId).length;

  return (
    <div className="dlg-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dlg pr" role="dialog" aria-modal="true" aria-label="Paste rows">
        <h3>Paste rows</h3>

        {!parsed ? (
          <div className={'pr-drop' + (drag ? ' over' : '')}
               onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
               onDragLeave={() => setDrag(false)}
               onDrop={(e) => { e.preventDefault(); setDrag(false); readFile(e.dataTransfer.files?.[0]); }}>
            <textarea className="input pr-text" autoFocus rows={8}
                      placeholder={'Paste rows from a spreadsheet, or drop a .csv / .tsv file here.'}
                      value={text} onChange={(e) => { setText(e.target.value); setMapping(null); }} />
            <div className="pr-or">
              <button className="btn" onClick={() => fileRef.current?.click()}>
                <Upload size={14} /> Choose a file
              </button>
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/*" hidden
                     onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
          </div>
        ) : (
          <>
            <div className="pr-sum">
              {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'} ·
              {' '}{parsed.header.length} column{parsed.header.length === 1 ? '' : 's'}
              {newCount > 0 && <> · {newCount} new column{newCount === 1 ? '' : 's'} will be created</>}
              <button className="linkish" onClick={() => { setText(''); setMapping(null); }}>Start over</button>
            </div>

            <div className="pr-table-wrap scroll">
              <table className="pr-table">
                <thead>
                  <tr>
                    {(effective || []).map((m, i) => (
                      <th key={i}>
                        <div className="pr-head">{m.header || `Column ${i + 1}`}</div>
                        <select className="input sm" value={m.colId || ''}
                                onChange={(e) => setTarget(i, e.target.value)}>
                          <option value="">Create “{m.newName || m.header || `Column ${i + 1}`}”</option>
                          {(sheet.columns || []).filter((c) => c.type !== 'harness').map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                    <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              {parsed.rows.length > PREVIEW_ROWS && (
                <div className="pr-more">and {parsed.rows.length - PREVIEW_ROWS} more</div>
              )}
            </div>

            <div className="pr-mode">
              <label>
                <input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} />
                Add these below the existing rows
              </label>
              <label>
                <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                Replace the rows that are here now
              </label>
            </div>
            {mode === 'replace' && (
              <p className="pr-warn">
                The existing rows and their results go. The columns and their settings stay.
              </p>
            )}
          </>
        )}

        <div className="foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!parsed?.rows.length}
                  onClick={() => onApply(applyImport(sheet, parsed, effective, mode))}>
            {parsed ? `${mode === 'replace' ? 'Replace with' : 'Add'} ${parsed.rows.length} row${parsed.rows.length === 1 ? '' : 's'}` : 'Add rows'}
          </button>
        </div>
      </div>
    </div>
  );
}
