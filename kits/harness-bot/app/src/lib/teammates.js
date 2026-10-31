// Teammates are Harnesses. What makes a Harness a teammate is the teammate package installed on
// it; its face, tagline and greeting are a file inside that package. The app creates one from the
// recruiter's profile on the recruiter's own base and model, installs the package with the profile
// added, and connects every plugin the workspace has connected (the package itself asks for the
// browser). Nothing about a teammate is stored anywhere else.
import { hr, listHarnesses } from 'reifyui/harness';
import { KIT_BASE, KIT_IDS, TEAMMATE_PACKAGE, TEAMMATE_PACKAGES, TEAMMATE_FILE } from './kit.js';
import { cleanName, composeSystemPrompt } from './builder.js';
import { avatarOf } from './faces.js';
import { jsonInit } from './api.js';

const profiles = new Map();   // harness id -> Promise<profile>

/** The teammate package this Harness carries (the current name or an earlier one), or ''. */
export function teammatePackage(h) {
  const p = (h?.plugins || []).find((x) => x && TEAMMATE_PACKAGES.includes(x.name) && x.enabled !== false);
  return p ? p.name : '';
}

export function isTeammate(h) {
  return !!teammatePackage(h);
}

/** The kit's row in the catalog: the launched one under the current id or an earlier one (a
 *  gateway from before the rename lists the kit under its old id), else the first listed. */
export function kitRow(kits) {
  const rows = KIT_IDS.map((id) => (kits || []).find((x) => x && x.id === id)).filter(Boolean);
  return rows.find((x) => x.launched && x.harnessId) || rows[0] || null;
}

/** The recruiter among harnesses, by the `kit` field: the current id first, then an earlier one. */
export function kitHarnessOf(harnesses) {
  for (const id of KIT_IDS) {
    const h = (harnesses || []).find((x) => x && x.kit === id);
    if (h) return h;
  }
  return null;
}

/** The recruiter of the workspace this page is open in. A kit is launched per workspace, so an
 *  instance can hold several recruiters; the kit catalog names the caller's own, and the shared
 *  "first harness with this kit" answered another workspace's (measured 2026-09-30). */
export async function recruiter() {
  try {
    const d = await hr('/kits');
    const k = kitRow(d?.kits);
    if (k?.launched && k.harnessId) {
      const h = (await listHarnesses()).find((x) => x.id === k.harnessId);
      if (h) return h;
    }
    if (k && !k.launched) return null;
  } catch { /* fall through to the shared lookup */ }
  return kitHarnessOf(await listHarnesses());
}

/** Whether a harness belongs to the recruiter's workspace (an unstamped harness is the default's). */
export function sameWorkspace(h, rec) {
  const a = String(h?.workspace || ''), b = String(rec?.workspace || '');
  return a === b || (!a && (b === 'default' || b === '')) || (!b && a === 'default');
}

async function profileOf(hid, pkg) {
  if (!profiles.has(hid)) {
    profiles.set(hid, (async () => {
      try {
        const r = await hr(`/harnesses/${encodeURIComponent(hid)}/plugins/${pkg || TEAMMATE_PACKAGE}/files`);
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
  const out = await Promise.all(hs.map(async (h) => toTeammate(h, await profileOf(h.id, teammatePackage(h)))));
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

/** The plugins this workspace has connected, by type. The browser is what every teammate needs
 *  (the teammate package requires it) and the platform provides it without a credential from the
 *  workspace, so a workspace that has not connected it yet gets it connected here: in a fresh
 *  workspace the whole team was "blocked, no browser" on its first campaign (2026-10-01). */
export async function connectedPlugs() {
  try {
    const d = await hr('/plugs');
    const plugs = d?.plugs || [];
    const browser = plugs.find((p) => p.type === 'browser');
    if (browser && browser.status !== 'connected' && !(browser.secrets_needed || []).length) {
      try { const r = await hr('/plugs/browser', jsonInit('PUT', { enabled: true, config: {} })); if (r?.status === 'connected') browser.status = 'connected'; }
      catch { /* stays as listed; the teammate is created without it */ }
    }
    return plugs.filter((p) => p.status === 'connected').map((p) => p.type);
  } catch { return []; }
}

/** Create the teammate. `onStep` narrates for the person; each step is a real call. */
export async function createTeammate(profile, me, onStep) {
  const rec = await recruiter();
  if (!rec) throw new Error('Harness Bot has not been launched in this workspace.');
  onStep?.('Writing the profile');
  const record = { v: 1, avatar: profile.avatar, tagline: profile.tagline, expertise: profile.expertise,
                   greeting: profile.greeting, createdBy: me?.name || '', createdAt: Date.now() };
  const files = [...(await packageFiles()), { path: TEAMMATE_FILE, content: JSON.stringify(record, null, 2) }];
  onStep?.('Setting up the desk');
  const h = await hr('/harnesses', jsonInit('POST', {
    name: profile.name, base: rec.base, default_model: rec.defaultModel || '',
    system_prompt: composeSystemPrompt(profile), plugins: [{ files }], mcp_servers: [],
  }));
  onStep?.('Connecting the workspace plugins');
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
