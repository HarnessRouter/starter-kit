// Product topbar: wordmark, credits badge (engine billing), avatar menu.
// Adapted from ContextualGraph's — candidate for a further ui-core push-down
// once a third product needs it (the LINKS/brand surface is all that differs).
import { useEffect, useRef, useState } from 'react';
import { BookOpen, Coins, CreditCard, LogOut, User } from 'lucide-react';
import { getSession, fetchBalance, logout, isAuthed, SESSION_EVENT } from '../lib/auth';
import { ShMark } from './ShMark';

export const LINKS = {
  profile: 'https://agentstudio.space/studio/profile',
  docs: 'https://github.com/epsilla-enterprise/AgentStudio',
  billing: 'https://agentstudio.space/studio/billing',
};

export function Wordmark({ size = 18 }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      <ShMark size={size + 2} />
      <span className="wm-text">Sheets</span>
    </span>
  );
}

export function CreditsBadge() {
  const [balance, setBalance] = useState(null);
  useEffect(() => {
    let dead = false;
    async function load() {
      if (!isAuthed()) { setBalance(null); return; }
      try {
        const body = await fetchBalance();
        if (!dead) setBalance(body.balance);
      } catch {
        if (!dead) setBalance(null);
      }
    }
    load();
    window.addEventListener(SESSION_EVENT, load);
    return () => { dead = true; window.removeEventListener(SESSION_EVENT, load); };
  }, []);
  if (balance === null) return null;
  return (
    <span className="credits">
      <Coins size={14} />
      {Math.floor(balance).toLocaleString()} credits
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

  if (!session?.token) return null;
  const member = session.member || {};
  const displayName = member.display_name || member.name || member.email || 'Account';
  const initial = String(displayName).trim().charAt(0).toUpperCase() || 'U';

  return (
    <div className="avmenu-wrap" ref={wrapRef}>
      <button className="av" onClick={() => setOpen((v) => !v)} aria-label="Account menu">{initial}</button>
      {open && (
        <div className="avmenu">
          <div className="who">
            <div className="nm">{displayName}</div>
            {member.email && <div className="em">{member.email}</div>}
          </div>
          <a href={LINKS.profile} target="_blank" rel="noreferrer"><User size={15} />Profile</a>
          <a href={LINKS.docs} target="_blank" rel="noreferrer"><BookOpen size={15} />Documentation</a>
          <a href={LINKS.billing} target="_blank" rel="noreferrer"><CreditCard size={15} />Billing</a>
          <button className="item out" onClick={logout}><LogOut size={15} />Log out</button>
        </div>
      )}
    </div>
  );
}

/** Top-right sign-in affordance for signed-out visitors. */
export function SignInButton({ onSignIn }) {
  const [hasSession, setHasSession] = useState(() => !!getSession()?.token);
  useEffect(() => {
    const sync = () => setHasSession(!!getSession()?.token);
    window.addEventListener(SESSION_EVENT, sync);
    return () => window.removeEventListener(SESSION_EVENT, sync);
  }, []);
  if (hasSession) return null;
  return (
    <button
      type="button"
      className="btn primary signin-btn"
      onClick={() => { if (onSignIn) onSignIn(); else { window.location.hash = '#/login'; } }}
    >
      Sign in
    </button>
  );
}

export function Topbar({ crumb, onSignIn }) {
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
      <CreditsBadge />
      <AvatarMenu />
      <SignInButton onSignIn={onSignIn} />
    </header>
  );
}
