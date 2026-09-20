// Hash router.
//   #/            a new run: nothing exists until the first message opens a session
//   #/r/{id}      a run (a session on this kit's harness), with its conversation and its frame
//
// The console authenticates the person before this app is served, so there is no sign-in here
// and no token to refresh. See lib/auth.js.
import { useEffect, useState } from 'react';
import { DialogHost } from 'reifyui';
import { GamePage } from './pages/GamePage';
import { PENDING } from './lib/game';

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  if (raw.startsWith('r/')) return { id: decodeURIComponent(raw.slice(2).split('?')[0]) };
  return { id: PENDING };
}

export default function App() {
  const [route, setRoute] = useState(() => ({ ...parseHash(), seq: 0 }));
  useEffect(() => {
    const onHash = () => setRoute((r) => ({ ...parseHash(), seq: r.seq }));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  // A run rewrites the URL to its own id without a navigation, so "New run" cannot rely on a hash
  // change to start over: the page is remounted outright, and the URL put back to the start.
  const newRun = () => {
    window.history.replaceState(null, '', `${window.location.pathname}#/`);
    setRoute((r) => ({ id: PENDING, seq: r.seq + 1 }));
  };
  return <DialogHost><GamePage key={`${route.id}:${route.seq}`} id={route.id} onNewRun={newRun} /></DialogHost>;
}
