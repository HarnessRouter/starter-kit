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
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return <DialogHost><GamePage key={route.id} id={route.id} /></DialogHost>;
}
