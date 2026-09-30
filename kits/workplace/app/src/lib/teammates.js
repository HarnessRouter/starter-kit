// Teammates are Harnesses. What makes a Harness a teammate is the teammate package installed on
// it; its face, tagline and greeting are a file inside that package. The app creates one from the
// recruiter's profile on the recruiter's own base and model, installs the package with the profile
// added, and connects every plugin the workspace has connected (the package itself asks for the
// browser). Nothing about a teammate is stored anywhere else.
import { hr, listHarnesses, kitHarness } from 'reifyui/harness';
import { KIT_BASE, KIT_ID, TEAMMATE_PACKAGE, TEAMMATE_FILE } from './kit.js';
import { cleanName, composeSystemPrompt } from './builder.js';
import { avatarOf } from './faces.js';
import { jsonInit } from './api.js';

const profiles = new Map();   // harness id -> Promise<profile>

export function isTeammate(h) {
  return (h?.plugins || []).some((p) => p && p.name === TEAMMATE_PACKAGE && p.enabled !== false);
}

/** The recruiter of the workspace this page is open in. A kit is launched per workspace, so an
 *  instance can hold several recruiters; the kit catalog names the caller's own, and the shared
 *  "first harness with kit = workplace" answered another workspace's (measured 2026-09-30). */
export async function recruiter() {
  try {
    const d = await hr('/kits');
    const k = (d?.kits || []).find((x) => x.id === KIT_ID);
    if (k?.launched && k.harnessId) {
      const h = (await listHarnesses()).find((x) => x.id === k.harnessId);
      if (h) return h;
    }
    if (k && !k.launched) return null;
  } catch { /* fall through to the shared lookup */ }
  return kitHarness();
}

/** Whether a harness belongs to the recruiter's workspace (an unstamped harness is the default's). */
export function sameWorkspace(h, rec) {
  const a = String(h?.workspace || ''), b = String(rec?.workspace || '');
  return a === b || (!a && (b === 'default' || b === '')) || (!b && a === 'default');
}

async function profileOf(hid) {
  if (!profiles.has(hid)) {
    profiles.set(hid, (async () => {
      try {
        const r = await hr(`/harnesses/${encodeURIComponent(hid)}/plugins/${TEAMMATE_PACKAGE}/files`);
        const f = (r?.files || []).find((x) => x.path === TEAMMATE_FILE);
        const p = f ? JSON.parse(f.content) : {};
        return p && typeof p === 'object' ? p : {};
      } catch { return {}; }
    })());
  }
  return profiles.get(hid);
}

function toTeammate(h, p) {
  return {
    id: h.id, name: cleanName(h.name), tagline: String(p.tagline || '').slice(0, 60),
    avatar: avatarOf(p.avatar, h.id), expertise: Array.isArray(p.expertise) ? p.expertise.slice(0, 6) : [],
    greeting: String(p.greeting || ''), createdBy: String(p.createdBy || h.member || ''),
    createdAt: Number(p.createdAt) || Number(h.createdAt) || 0, base: h.base || '', model: h.defaultModel || '',
  };
}

/** Every teammate of this workspace, oldest first. */
export async function listTeammates(rec = null) {
  const hs = (await listHarnesses()).filter((h) => isTeammate(h) && (!rec || sameWorkspace(h, rec)));
  const out = await Promise.all(hs.map(async (h) => toTeammate(h, await profileOf(h.id))));
  return out.sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name));
}

let _pkg = null;
function packageFiles() {
  if (!_pkg) {
    _pkg = fetch(`${KIT_BASE}teammate-plugin.json`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('The teammate package is missing from this build.'))))
      .then((d) => d.files);
    _pkg.catch(() => { _pkg = null; });
  }
  return _pkg;
}

/** The plugins this workspace has connected, by type. */
export async function connectedPlugs() {
  try { const d = await hr('/plugs'); return (d?.plugs || []).filter((p) => p.status === 'connected').map((p) => p.type); } catch { return []; }
}

/** Create the teammate. `onStep` narrates for the person; each step is a real call. */
export async function createTeammate(profile, me, onStep) {
  const rec = await recruiter();
  if (!rec) throw new Error('The workplace has not been launched.');
  onStep?.('Writing the profile');
  const record = { v: 1, avatar: profile.avatar, tagline: profile.tagline, expertise: profile.expertise,
                   greeting: profile.greeting, createdBy: me?.name || '', createdAt: Date.now() };
  const files = [...(await packageFiles()), { path: TEAMMATE_FILE, content: JSON.stringify(record, null, 2) }];
  onStep?.('Setting up the desk');
  const h = await hr('/harnesses', jsonInit('POST', {
    name: profile.name, base: rec.base, default_model: rec.defaultModel || '',
    system_prompt: composeSystemPrompt(profile), plugins: [{ files }], mcp_servers: [],
  }));
  onStep?.('Connecting the workplace plugins');
  const plugs = await connectedPlugs();
  let attached = [];
  if (plugs.length) {
    try { await hr(`/harnesses/${encodeURIComponent(h.id)}/servers/plugs`, jsonInit('POST', { plugs })); attached = plugs; }
    catch { /* the package's own requirement attached the browser; the others are optional here */ }
  }
  profiles.set(h.id, Promise.resolve(record));
  return { teammate: toTeammate(h, record), plugs: attached };
}

export async function removeTeammate(hid) {
  await hr(`/harnesses/${encodeURIComponent(hid)}`, { method: 'DELETE' });
  profiles.delete(hid);
}
