// Product topbar: wordmark, account menu.
//
// Same bar as the hosted product, minus the two things this build does not have. There is no
// credits badge because there is no billing, and no Sign in button because the console already
// signed you in — the account menu shows who that is and hands log-out back to the console.
import { useEffect, useRef, useState } from 'react';
import { BookOpen, LogOut } from 'lucide-react';
import { getSession, logout, SESSION_EVENT } from '../lib/auth';
import { SlMark } from './SlMark';

export const LINKS = {
  // The kit's own folder, not the repository root — someone asking this app for help wants the
  // Slides README and its skill, not a list of every starter kit.
  docs: 'https://github.com/HarnessRouter/starter-kit/tree/main/kits/slides',
};

export function Wordmark({ size = 18 }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      <SlMark size={size + 2} />
      <span className="wm-text">Slides</span>
    </span>
  );
}

export function AvatarMenu() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(getSession);
  const wrapRef = useRef(null);

  useEffect(() => {
    const sync = () => setSession(getSession());
    window.addEventListener(SESSION_EVENT, sync);
    return () => window.removeEventListener(SESSION_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  // No session yet (or an ungated instance): show nothing rather than a placeholder identity.
  const member = session?.member;
  if (!member) return null;
  const displayName = member.display_name || member.name || member.email || 'Account';
  const initial = String(displayName).trim().charAt(0).toUpperCase() || 'U';

  return (
    <div className="avmenu-wrap" ref={wrapRef}>
      <button className="av" onClick={() => setOpen((v) => !v)} aria-label="Account menu">{initial}</button>
      {open && (
        <div className="avmenu">
          <div className="who">
            <div className="nm">{displayName}</div>
          </div>
          <a href={LINKS.docs} target="_blank" rel="noreferrer"><BookOpen size={15} />Documentation</a>
          {session.gated && <button className="item out" onClick={logout}><LogOut size={15} />Log out</button>}
        </div>
      )}
    </div>
  );
}

export function Topbar({ crumb }) {
  return (
    <header className="topbar">
      <a className="wordmark" href="#/"><Wordmark size={16} /></a>
      {crumb && (
        <>
          <span className="crumb-sep">/</span>
          <span className="crumb-name" title={crumb}>{crumb}</span>
        </>
      )}
      <div className="topbar-spacer" />
      <AvatarMenu />
    </header>
  );
}
