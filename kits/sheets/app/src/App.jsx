// Hash router.
//   #/            landing (prompt, templates, my sheets)
//   #/s/{id}      the sheet (?seed=<first copilot message>, consumed once on arrival)
//
// The hosted product also routes #/login and keeps a sliding JWT alive here. This build has
// neither: the console authenticates the person before this app is ever served, so there is no
// sign-in screen to route to and no token to refresh. See lib/auth.js.
import { useEffect, useState } from 'react';
import { DialogHost } from 'reifyui';
import { LandingPage } from './pages/Landing';
import { SheetPage } from './pages/SheetPage';

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  if (path.startsWith('s/')) {
    // The template a NEW sheet starts from rides in the id itself ("new:<template>"), so
    // there is no second place for it to be carried and no way for the two to disagree.
    return { page: 'sheet', id: decodeURIComponent(path.slice(2)), seed: params.get('seed') || '' };
  }
  return { page: 'landing' };
}

export default function App() {
  const [route, setRoute] = useState(parseHash);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <DialogHost>
      {route.page === 'sheet'
        ? <SheetPage key={route.id} id={route.id} seed={route.seed} />
        : <LandingPage />}
    </DialogHost>
  );
}
