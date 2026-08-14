// What an agent cell looks like in the grid.
//
// Mounted through SheetGrid's renderCell slot, inside the cell's own value box, so the row-height
// line clamp and the cell chrome still apply.
//
// Every state here is a state the run genuinely produces. There is no percentage and no estimate:
// the server exposes no queue — past its concurrency limit turns are accepted and block silently,
// indistinguishable over the API from working ones — so a progress bar inside one cell would be
// invented. A spinner is the truth.
import { Play } from 'lucide-react';
import { FileCard } from 'reifyui';
import { containerFileUrl } from 'reifyui/harness';

/** The files a cell produced, as the same card the chat draws — type glyph, name, download,
 *  preview. They were a row of green text chips: no glyph, no download, and no way to look inside
 *  without opening the whole cell. */
function Artifacts({ artifacts, onPreview }) {
  if (!artifacts?.length) return null;
  return (
    <span className="hcell-files">
      {artifacts.map((a) => (
        <FileCard
          key={a.file_id}
          name={a.filename}
          bytes={a.bytes}
          onPreview={onPreview ? () => onPreview(a) : undefined}
          onDownload={() => {
            const el = document.createElement('a');
            el.href = containerFileUrl(a.container_id, a.file_id);
            el.download = a.filename;
            document.body.appendChild(el); el.click(); el.remove();
          }}
        />
      ))}
    </span>
  );
}

export function HarnessCell({ cell, live, readOnly, onRun, onPreviewFile }) {
  const status = cell?.status;
  // One action, the same shape as the column header's, appearing on hover. There was a second —
  // open this cell — beside it; the cell shows its answer in full and its files as cards, so it
  // opened a panel to repeat what was already on screen.
  const tools = !readOnly && onRun && (
    <span className="hcell-tools">
      <button className="hcell-run" title="Run this cell"
              onClick={(e) => { e.stopPropagation(); onRun(); }}>
        <Play size={11} /> Run
      </button>
    </span>
  );

  if (!status) {
    return <span className="hcell">{tools}</span>;
  }
  if (status === 'queued') {
    return <span className="hcell"><span className="hcell-dot queued" title="Waiting to start" />{tools}</span>;
  }
  if (status === 'running') {
    return (
      <span className="hcell">
        <span className="hcell-spin" />
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
    <span className="hcell">
      <span className="hcell-txt">{cell.value}</span>
      <Artifacts artifacts={cell.artifacts} onPreview={onPreviewFile} />
      {tools}
    </span>
  );
}
