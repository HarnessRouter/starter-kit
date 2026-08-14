// The Run control: what to run, how many at a time, and what is happening now.
//
// Everything it claims is counted from the plan. `7/12 · 1 failed` is the real settled count over
// the real planned count; there is no ETA and no percentage inside a cell, because the server
// exposes no queue to measure and a wrong estimate is worse than none.
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Play, Square } from 'lucide-react';
import { CONCURRENCY_CHOICES } from '../lib/run';

export function RunControl({ running, progress, concurrency, onConcurrency, onRun, onStop, disabled }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // mousedown with a containment check, from the first line. A `click` listener attached in the
  // effect that opens the menu fires during that very click — React 18 flushes it synchronously —
  // and the menu closes before it paints. That is a whole evening's bug in one line of setup.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  if (running) {
    const { planned = 0, settled = 0, failed = 0 } = progress || {};
    const pct = planned ? Math.round((settled / planned) * 100) : 0;
    return (
      <div className="run-wrap">
        <button className="btn run-stop" onClick={onStop} title="Stop this run">
          <Square size={13} /> Stop
        </button>
        <span className="run-count">
          {settled}/{planned}
          {failed > 0 && <span className="run-failed"> · {failed} failed</span>}
        </span>
        <span className="run-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
      </div>
    );
  }

  return (
    <div className="run-wrap" ref={wrapRef}>
      <button className="btn primary run-go" disabled={disabled} onClick={() => onRun('all')}
              title="Run every agent column">
        <Play size={13} /> Run
      </button>
      <button className="btn primary run-caret" disabled={disabled}
              onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
              aria-label="Run options"><ChevronDown size={13} /></button>

      {/* One thing: how many at a time. The scope options that were here — whole sheet, only
          unrun, retry failed — asked a question before the person had a reason to answer it, and
          the button already means "the whole sheet". */}
      {open && (
        <div className="run-menu" onClick={(e) => e.stopPropagation()}>
          <div className="run-menu-lbl">At a time</div>
          <div className="run-conc-row">
            {CONCURRENCY_CHOICES.map((n) => (
              <button key={n} className={'run-conc-btn' + (n === concurrency ? ' on' : '')}
                      onClick={() => { onConcurrency(n); setOpen(false); }}>{n}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

