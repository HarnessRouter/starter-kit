// The template library.
//
// Kit data, not app data: it lives at kits/dashboard/templates/ and is staged into public/ at build
// time (see vite.config.js), so there is one copy of it and it is reachable at
// /kits/dashboard/templates.json.
const URL = `${import.meta.env.BASE_URL}templates.json`;

let cache = null;

export async function listTemplates() {
  if (cache) return cache;
  const res = await fetch(URL, { cache: 'no-store' });
  if (!res.ok) return [];
  const body = await res.json().catch(() => null);
  cache = Array.isArray(body?.templates) ? body.templates : [];
  return cache;
}

export async function getTemplate(id) {
  if (!id || id === 'blank') return null;
  return (await listTemplates()).find((t) => t.id === id) || null;
}
