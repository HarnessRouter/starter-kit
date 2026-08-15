// Product topbar: wordmark, what can actually be made, account menu.
//
// Same bar as the other kits, minus the two things this build does not have. There is no credits
// badge because there is no billing, and no Sign in button because the console already signed you
// in — the account menu shows who that is and hands log-out back to the console.
//
// The capability chip is this kit's addition and it earns its place: four video models are listed
// upstream and on a given night some of them are broken, so which one is running is a live fact
// rather than a property of the product. It names the model, because that is the thing about to
// cost money. It shows nothing at all until the answer arrives — a chip that reads "no model
// connected" for half a second, on a working deployment, is worse than no chip.
import { useEffect, useRef, useState } from 'react';
import { BookOpen, Clapperboard, LogOut } from 'lucide-react';
import { Popover } from 'reifyui';
import { getSession, logout, SESSION_EVENT } from '../lib/auth';
import { canMakeVideo, connectedSummary } from '../lib/capabilities';
import { VdMark } from './VdMark';

export const LINKS = {
  // The kit's own folder, not the repository root — someone asking this app for help wants the
  // Videos README and its skill, not a list of every starter kit.
  docs: 'https://github.com/HarnessRouter/starter-kit/tree/main/kits/video',
};

export function Wordmark({ size = 18 }) {
  return (
    <span className="uic-wordmark" style={{ fontSize: size }}>
      <VdMark size={size + 2} />
      <span className="wm-text">Videos</span>
    </span>
  );
}

/** Which model a clip would be rendered by. `null` caps means not asked yet, which renders
 *  nothing. */
export function CapabilityChip({ caps }) {
  const can = canMakeVideo(caps);
  if (can === null) return null;
  const model = connectedSummary(caps);
  const label = can ? model : 'No video model connected';
  return (
    <span className={'vd-cap' + (can ? '' : ' is-none')} title={can ? `Clips render on ${model}` : label}>
      <Clapperboard size={13} aria-hidden="true" />
      <span className="vd-cap-t">{label}</span>
    </span>
  );
}

export function AvatarMenu() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(getSession);
  const btnRef = useRef(null);

  useEffect(() => {
    const sync = () => setSession(getSession());
    window.addEventListener(SESSION_EVENT, sync);
    return () => window.removeEventListener(SESSION_EVENT, sync);
  }, []);

  // No session yet (or an ungated instance): show nothing rather than a placeholder identity.
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
        <div className="vd-who">{displayName}</div>
        <a className="uic-pop-item" href={LINKS.docs} target="_blank" rel="noreferrer">
          <BookOpen size={15} />Documentation
        </a>
        {session.gated && (
          <button type="button" className="uic-pop-item vd-danger" onClick={logout}>
            <LogOut size={15} />Log out
          </button>
        )}
      </Popover>
    </>
  );
}

export function Topbar({ caps, children }) {
  return (
    <header className="uic-topbar">
      <a className="uic-wordmark" href="#/"><Wordmark size={16} /></a>
      <div className="uic-topbar-spacer" />
      {children}
      <CapabilityChip caps={caps} />
      <AvatarMenu />
    </header>
  );
}
