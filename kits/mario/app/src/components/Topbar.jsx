// The app bar: the way back to HarnessRouter, the kit's name, what is playing and how it is
// going, a new run, and who is signed in.
//
// Same bar as the other kits. The model chip is this kit's addition: which System One model is
// playing is the fact about the run, so it is read from the harness rather than written here.
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Cpu, LogOut, RotateCcw } from 'lucide-react';
import { Popover } from 'reifyui';
import { getSession, logout, SESSION_EVENT } from '../lib/auth';
import { CONSOLE_HOME } from '../lib/kit';
import { statusLabel } from '../lib/game';
import { MkMark } from './MkMark';

export const LINKS = {
  docs: 'https://github.com/HarnessRouter/starter-kit/tree/main/kits/mario',
};

export function AvatarMenu() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(getSession);
  const btnRef = useRef(null);

  useEffect(() => {
    const sync = () => setSession(getSession());
    window.addEventListener(SESSION_EVENT, sync);
    return () => window.removeEventListener(SESSION_EVENT, sync);
  }, []);

  const member = session?.member;
  if (!member) return null;
  const displayName = member.display_name || member.name || member.email || 'Account';
  const initial = String(displayName).trim().charAt(0).toUpperCase() || 'U';

  return (
    <>
      <button ref={btnRef} className="av" onClick={() => setOpen((v) => !v)}
              aria-label="Account menu" aria-expanded={open}>{initial}</button>
      <Popover open={open} anchorRef={btnRef} onClose={() => setOpen(false)}
               width={220} minHeight={110} label="Account">
        <div className="mk-who">{displayName}</div>
        <a className="uic-pop-item" href={LINKS.docs} target="_blank" rel="noreferrer">
          <BookOpen size={15} />Documentation
        </a>
        {session.gated && (
          <button type="button" className="uic-pop-item mk-danger" onClick={logout}>
            <LogOut size={15} />Log out
          </button>
        )}
      </Popover>
    </>
  );
}

function StatusChip({ status }) {
  const cls = status === 'running' ? ' is-live' : status === 'completed' ? ' is-ok'
    : status === 'failed' ? ' is-bad' : '';
  return (
    <span className={'mk-chip mk-status' + cls}>
      {status === 'running' && <span className="mk-dot" aria-hidden="true" />}
      {statusLabel(status)}
    </span>
  );
}

export function Topbar({ model, status, running, onNewRun }) {
  return (
    <header className="uic-topbar mk-topbar">
      <a className="mk-back" href={CONSOLE_HOME} title="Back to HarnessRouter">
        <ArrowLeft size={15} aria-hidden="true" /><span className="lbl">HarnessRouter</span>
      </a>
      <span className="mk-sep" aria-hidden="true" />
      <span className="uic-wordmark"><MkMark size={22} /><span className="wm-text">Super Mario</span></span>
      <div className="uic-topbar-spacer" />
      {model && (
        <span className="mk-chip mk-model" title="The System One model playing">
          <Cpu size={13} aria-hidden="true" /><span className="mk-chip-t">{model}</span>
        </span>
      )}
      <StatusChip status={status} />
      <button type="button" className="btn" onClick={onNewRun} disabled={running} title="Start over with a new run">
        <RotateCcw size={14} aria-hidden="true" /><span className="lbl">New run</span>
      </button>
      <AvatarMenu />
    </header>
  );
}
