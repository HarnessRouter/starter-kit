// My Workplace: the room list on the left, the conversation in the middle, what the teammate is
// doing and making on the right. This file is the shell and the store; every screen reads the
// store through useWorkplace() and asks it to refresh what it changed.
//
// Boot: the recruiter Harness (launched from Starter Kits; null means "launch it first") and the
// person (from the console). Then, on a timer while the tab is visible: ONE session list for the
// whole workspace, which is what the sidebar's direct messages, groups, presence and unread all
// derive from; the teammates every half minute; a group's document when its row needs a name.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DialogHost } from 'reifyui';
import { configureKit } from 'reifyui/harness';
import { KIT_BASE, KIT_ID } from './lib/kit.js';
import { whoami } from './lib/auth.js';
import { isLive, listCards } from './lib/api.js';
import { listTeammates, recruiter } from './lib/teammates.js';
import { findGroups, readGroup } from './lib/groups.js';
import { newId } from './lib/groupdoc.js';
import Sidebar from './components/Sidebar.jsx';
import DmView from './components/DmView.jsx';
import GroupView from './components/GroupView.jsx';
import NewTeammate from './components/NewTeammate.jsx';
import ArtifactsPage from './components/ArtifactsPage.jsx';
import NewGroup from './components/NewGroup.jsx';
import { Splash } from './components/Splash.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';

configureKit({ kitId: KIT_ID });

const CARDS_MS = 6000;
const TEAMMATES_MS = 10000;   // a teammate hired in another window shows here within ten seconds
const DOCS_MS = 20000;
export const TAB_ID = newId('tab');

const Ctx = createContext(null);
export const useWorkplace = () => useContext(Ctx);

// ── routing: /kits/workplace/<kind>/<id> ───────────────────────────────────
export function readRoute() {
  const p = window.location.pathname;
  const rel = p.startsWith(KIT_BASE) ? p.slice(KIT_BASE.length) : '';
  const [kind, id] = rel.split('/').filter(Boolean);
  return { kind: kind || 'home', id: id ? decodeURIComponent(id) : '' };
}
export function navigate(path, replace = false) {
  const url = KIT_BASE + String(path || '').replace(/^\//, '');
  if (replace) window.history.replaceState(null, '', url); else window.history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const on = () => setRoute(readRoute());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return route;
}

/** A timer that runs only while the tab is visible and re-runs the moment it becomes visible. */
function useVisibleInterval(fn, ms, deps) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let id = 0;
    const tick = () => { if (!document.hidden) ref.current(); };
    const arm = () => { window.clearInterval(id); id = window.setInterval(tick, ms); };
    const onVis = () => { if (!document.hidden) { tick(); arm(); } };
    tick(); arm();
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

// ── what a person has seen, per person, in this browser ─────────────────────
function seenKey(me) { return `wp.seen.${me?.id || 'nobody'}`; }
function readSeen(me) { try { return JSON.parse(localStorage.getItem(seenKey(me)) || '{}') || {}; } catch { return {}; } }

export default function App() {
  return <DialogHost><Workplace /></DialogHost>;
}

function Workplace() {
  const route = useRoute();
  const [rec, setRec] = useState(undefined);        // recruiter Harness; null = not launched
  const [me, setMe] = useState(undefined);          // null = the console did not say
  const [bootErr, setBootErr] = useState('');
  const [teammates, setTeammates] = useState(null); // null = loading
  const [cards, setCards] = useState([]);
  const [docs, setDocs] = useState({});             // group session id -> document
  const docsAt = useRef({});
  const [liveLocal, setLiveLocal] = useState({});   // teammate id -> true while this tab runs its turn
  const [seen, setSeen] = useState({});
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([recruiter(), whoami()]).then(([h, who]) => {
      if (!alive) return;
      setRec(h); setMe(who); setSeen(readSeen(who));
    }).catch((e) => { if (alive) setBootErr(e?.message || 'The workplace could not load.'); });
    return () => { alive = false; };
  }, []);

  const refreshTeammates = useCallback(async () => {
    if (!rec) return;
    try { setTeammates(await listTeammates(rec)); } catch { setTeammates((t) => t || []); }
  }, [rec]);
  const harnessIds = useMemo(() => [rec?.id, ...(teammates || []).map((t) => t.id)].filter(Boolean), [rec, teammates]);
  const refreshCards = useCallback(async () => {
    if (!me || !harnessIds.length) return;
    try { setCards(await listCards(me, harnessIds)); } catch { /* keep the last list */ }
  }, [me, harnessIds]);

  const ready = !!rec && !!me;
  useVisibleInterval(() => { if (ready) refreshTeammates(); }, TEAMMATES_MS, [ready, refreshTeammates]);
  useVisibleInterval(() => { if (ready && teammates) refreshCards(); }, CARDS_MS, [ready, teammates !== null, refreshCards]);

  // A group's name and members come from its document; the sidebar needs them for every group.
  const groupCards = useMemo(() => (rec ? findGroups(cards, rec.id) : []), [cards, rec]);
  useEffect(() => {
    const now = Date.now();
    for (const c of groupCards) {
      if (now - (docsAt.current[c.id] || 0) < DOCS_MS) continue;
      docsAt.current[c.id] = now;
      readGroup(c.id).then((d) => { if (d) setDocs((m) => ({ ...m, [c.id]: d })); }).catch(() => {});
    }
  }, [groupCards, cards]);
  const setDoc = useCallback((sid, doc) => {
    docsAt.current[sid] = Date.now();
    setDocs((m) => ({ ...m, [sid]: doc }));
  }, []);

  const markLive = useCallback((hid, on) => {
    setLiveLocal((m) => { const n = { ...m }; if (on) n[hid] = true; else delete n[hid]; return n; });
  }, []);
  const working = useMemo(() => {
    const s = new Set(Object.keys(liveLocal));
    for (const c of cards) if (isLive(c) && c.harness_id) s.add(c.harness_id);
    return s;
  }, [cards, liveLocal]);

  const markSeen = useCallback((key, marker) => {
    setSeen((s) => {
      if (s[key] === marker) return s;
      const n = { ...s, [key]: marker };
      try { localStorage.setItem(seenKey(me), JSON.stringify(n)); } catch { /* a private window */ }
      return n;
    });
  }, [me]);
  const unread = useCallback((key, marker) => !!marker && seen[key] !== undefined && seen[key] !== marker, [seen]);

  const value = useMemo(() => ({
    route, navigate, rec, me, teammates, refreshTeammates, cards, refreshCards, groupCards, docs, setDoc,
    working, markLive, markSeen, unread, openDrawer: () => setDrawer(true), closeDrawer: () => setDrawer(false), tabId: TAB_ID,
  }), [route, rec, me, teammates, refreshTeammates, cards, refreshCards, groupCards, docs, setDoc, working, markLive, markSeen, unread]);

  useEffect(() => { setDrawer(false); }, [route.kind, route.id]);

  if (bootErr) return <Splash kind="error" text={bootErr} />;
  if (rec === undefined || me === undefined) return <Splash kind="loading" />;
  if (rec === null) return <Splash kind="unlaunched" />;
  if (me === null) return <Splash kind="noidentity" />;

  let view = null;
  if (teammates === null) view = <Splash kind="loading" inline />;
  else if (route.kind === 'new') view = <NewTeammate />;
  else if (route.kind === 'artifacts') view = <ArtifactsPage />;
  else if (route.kind === 'dm') {
    const t = teammates.find((x) => x.id === route.id);
    view = t ? <DmView key={t.id} teammate={t} /> : <Splash kind="missing" text="That teammate is no longer in the workplace." inline />;
  } else if (route.kind === 'group') {
    view = groupCards.some((c) => c.id === route.id) || docs[route.id]
      ? <GroupView key={route.id} sid={route.id} />
      : <Splash kind="missing" text="That group is gone, or has not opened yet." inline />;
  } else if (!teammates.length) view = <NewTeammate first />;
  else view = <Splash kind="pick" inline />;

  return (
    <Ctx.Provider value={value}>
      <div className={`wp-root${drawer ? ' is-drawer' : ''}`}>
        <Sidebar open={drawer} />
        {drawer && <button className="wp-backdrop" aria-label="Close the room list" onClick={() => setDrawer(false)} />}
        <main className="wp-main"><ErrorBoundary key={`${route.kind}/${route.id}`} label="This room">{view}</ErrorBoundary></main>
        <NewGroup />
      </div>
    </Ctx.Provider>
  );
}
