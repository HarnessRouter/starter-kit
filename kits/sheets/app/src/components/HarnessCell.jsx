// What an agent cell looks like in the grid.
//
// Mounted through SheetGrid's renderCell slot, inside the cell's own value box, so the row-height
// line clamp and the cell chrome still apply.
//
// Every state here is a state the run genuinely produces. There is no percentage and no estimate:
// the server exposes no queue — past its concurrency limit turns are accepted and block silently,
// indistinguishable over the API from working ones — so a progress bar inside one cell would be
// invented. A spinner is the truth.
import { FileText, Play, Maximize2 } from 'lucide-react';

function Artifacts({ artifacts }) {
  if (!artifacts?.length) return null;
  const shown = artifacts.slice(0, 3);
  return (
    <span className="hcell-files">
      {shown.map((a) => (
        <span key={a.file_id} className="hcell-file" title={a.filename}>
          <FileText size={11} />{a.filename}
        </span>
      ))}
      {artifacts.length > shown.length && (
        <span className="hcell-file more">+{artifacts.length - shown.length}</span>
      )}
    </span>
  );
}

export function HarnessCell({ cell, live, readOnly, onRun, onOpen }) {
  const status = cell?.status;
  const tools = !readOnly && (
    <span className="hcell-tools">
      {onRun && (
        <button className="hcell-btn" title="Run this cell"
                onClick={(e) => { e.stopPropagation(); onRun(); }}><Play size={11} /></button>
      )}
      {onOpen && status && (
        <button className="hcell-btn" title="Open this cell"
                onClick={(e) => { e.stopPropagation(); onOpen(); }}><Maximize2 size={11} /></button>
      )}
    </span>
  );

  if (!status) {
    return <span className="hcell empty">{tools}</span>;
  }
  if (status === 'queued') {
    return <span className="hcell"><span className="hcell-dot queued" title="Waiting to start" />{tools}</span>;
  }
  if (status === 'running') {
    return (
      <span className="hcell">
        <span className="hcell-spin" />
        {/* Live text only when the drawer is open on this cell — that is the one place a turn
            replay is already being polled. Elsewhere we do not invent a progress phrase. */}
        {live ? <span className="hcell-live">{live}</span> : null}
        {tools}
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="hcell failed" title={cell.error || ''}>
        <span className="hcell-dot failed" />
        <span className="hcell-txt">{cell.error || 'This cell failed.'}</span>
        {tools}
      </span>
    );
  }
  if (status === 'skipped') {
    return (
      <span className="hcell skipped" title={cell.error || ''}>
        <span className="hcell-txt">{cell.error || 'Skipped.'}</span>
        {tools}
      </span>
    );
  }
  return (
    <span className="hcell" onClick={(e) => { if (onOpen) { e.stopPropagation(); onOpen(); } }}>
      <span className="hcell-txt">{cell.value}</span>
      <Artifacts artifacts={cell.artifacts} />
      {tools}
    </span>
  );
}
