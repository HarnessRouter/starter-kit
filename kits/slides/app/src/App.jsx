// Hash router.
//   #/            landing (prompt, templates, my slides)
//   #/d/{id}      deck page (?seed=<first copilot message>, ?tpl=<template the deck came from>)
//   #/print       print view
//
// The hosted product also routes #/login and keeps a sliding JWT alive here. This build has
// neither: the console authenticates the person before this app is ever served, so there is no
// sign-in screen to route to and no token to refresh. See lib/auth.js.
import { useEffect, useState } from 'react';
import { LandingPage } from './pages/Landing';
import { DeckPage } from './pages/DeckPage';
import { PrintPage } from './pages/PrintPage';

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  if (path === 'print') return { page: 'print' };
  if (path.startsWith('d/')) {
    return { page: 'deck', id: decodeURIComponent(path.slice(2)),
             seed: params.get('seed') || '', template: params.get('tpl') || '' };
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

  if (route.page === 'print') return <PrintPage />;
  if (route.page === 'deck') {
    return <DeckPage key={route.id} id={route.id} seed={route.seed} template={route.template} />;
  }
  return <LandingPage />;
}
