// The Run control: what to run, how many at a time, and what is happening now.
//
// Everything it claims is counted from the plan. `7/12 · 1 failed` is the real settled count over
// the real planned count; there is no ETA and no percentage inside a cell, because the server
// exposes no queue to measure and a wrong estimate is worse than none.
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Play, Square } from 'lucide-react';
import { CONCURRENCY_CHOICES } from '../lib/run';

export function RunControl({ running, progress, concurrency, onConcurrency, onRun, onStop, disabled, lastRun }) {
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
      <div className="run-wrap running">
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
        <Play size={13} /> Run <span className="run-conc">{concurrency}</span>
      </button>
      <button className="btn primary run-caret" disabled={disabled}
              onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
              aria-label="Run options"><ChevronDown size={13} /></button>

      {open && (
        <div className="run-menu" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { setOpen(false); onRun('all'); }}>Run the whole sheet</button>
          <button onClick={() => { setOpen(false); onRun('unrun'); }}>Run cells that haven’t run</button>
          <button onClick={() => { setOpen(false); onRun('failed'); }}>Retry failed cells</button>

          <div className="run-menu-sep" />
          <div className="run-menu-lbl">At a time</div>
          <div className="run-conc-row">
            {CONCURRENCY_CHOICES.map((n) => (
              <button key={n} className={'run-conc-btn' + (n === concurrency ? ' on' : '')}
                      onClick={() => onConcurrency(n)}>{n}</button>
            ))}
          </div>
          <p className="run-menu-note">
            Higher is not always faster — the server runs as many as the machine allows and holds
            the rest.
          </p>
          <p className="run-menu-note">
            The run happens in this tab. If you close it, cells already started will finish;
            nothing new starts.
          </p>
        </div>
      )}

      {lastRun && <span className="run-last">{lastRun}</span>}
    </div>
  );
}

/** "11 done, 1 failed · 2m 37s" — from the run record, or nothing when there is no run. */
export function lastRunSummary(run) {
  if (!run || run.status === 'running') return '';
  const bits = [];
  if (run.done) bits.push(`${run.done} done`);
  if (run.failed) bits.push(`${run.failed} failed`);
  if (run.skipped) bits.push(`${run.skipped} skipped`);
  if (!bits.length) return '';
  let when = '';
  if (run.started_at && run.ended_at) {
    const s = Math.max(0, run.ended_at - run.started_at);
    when = s < 60 ? ` · ${s}s` : ` · ${Math.floor(s / 60)}m ${s % 60}s`;
  }
  const prefix = run.status === 'cancelled' ? 'Stopped: '
    : run.status === 'abandoned' ? 'Interrupted: ' : 'Last run: ';
  return prefix + bits.join(', ') + when;
}
