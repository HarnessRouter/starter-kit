// Hash router + session keeper.
//   #/            landing (prompt, templates, my sheets)
//   #/login       standalone sign in
//   #/s/{id}      sheet page (optionally ?seed=<first copilot message>)
import { useEffect, useState } from 'react';
import { isAuthed, refreshToken } from './lib/auth';
import { LandingPage } from './pages/Landing';
import { LoginPage } from './pages/Login';
import { SheetPage } from './pages/SheetPage';

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  if (path === 'login') return { page: 'login' };
  if (path.startsWith('s/')) {
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

  // Sliding session: refresh on mount, on tab focus, and every 6 hours, so an
  // active user never lapses. A dead token fails closed into #/login.
  useEffect(() => {
    if (isAuthed()) refreshToken();
    const onFocus = () => { if (isAuthed() && document.visibilityState !== 'hidden') refreshToken(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    const iv = window.setInterval(() => { if (isAuthed()) refreshToken(); }, 6 * 60 * 60 * 1000);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      window.clearInterval(iv);
    };
  }, []);

  if (route.page === 'login') return <LoginPage />;
  if (route.page === 'sheet') return <SheetPage key={route.id} id={route.id} seed={route.seed} />;
  return <LandingPage />;
}
