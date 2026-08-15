// Where a clip's bytes come from.
//
// One function, and it is the only place in the app that builds a media URL. Everything else —
// the <video>, the poster, Excalidraw's files map, the download link — asks here.
//
// The address is derived at render time and never stored. Two things would otherwise rot in the
// document: the deployment's own base URL, which changes when a self-hosted install moves, and
// the provider's signed URL, which expires within hours on every model that returns one. What is
// durable is the media id, so that is what the scene holds.
//
// The route is same-origin under the console's API proxy, which means the console session
// authenticates it and the browser attaches that on its own. So the URL works directly in `src`
// — no token to smuggle into a query string, and nothing for a copied link to leak.

import { KIT_BASE } from './kit.js';

/** The console's API proxy — the same base reifyui/harness uses. */
const BASE = '/api/harness/v1';

const enc = encodeURIComponent;

/** The bytes of one piece of media, or '' when we do not have all four parts of its address.
 *
 *  '' rather than a partial URL, deliberately: an <img src=""> renders nothing, and a URL with an
 *  empty segment in it renders a broken image and a 404 in the console that looks like a server
 *  fault rather than a page that asked too early. */
export function mediaUrl({ harnessId, entryId, sessionId, mediaId }) {
  if (!harnessId || !entryId || !sessionId || !mediaId) return '';
  return `${BASE}/harnesses/${enc(harnessId)}/servers/${enc(entryId)}`
    + `/sessions/${enc(sessionId)}/media/${enc(mediaId)}`;
}

/** A `urlFor(mediaId)` bound to one session — what scene.filesForScene and the canvas take. */
export function mediaUrlFor(addr) {
  return (mediaId) => mediaUrl({ ...addr, mediaId });
}

/** The still to show before a clip plays: its own poster if one was rendered, and otherwise
 *  nothing.
 *
 *  Never the clip itself as its own poster — a <video> with `preload="metadata"` paints its first
 *  frame anyway, and pointing `poster` at the video URL downloads the whole file to show one
 *  frame of it. Never a generic placeholder image either: an empty poster is a black box that
 *  fills in, which is what a video that has not been played looks like everywhere else. */
export function posterUrl(addr, clip) {
  return clip?.posterMediaId ? mediaUrl({ ...addr, mediaId: clip.posterMediaId }) : '';
}

/** The `link` an embeddable element needs in order to be rendered at all.
 *
 *  Excalidraw decides whether an embeddable is drawable by running its `link` through
 *  `validateEmbeddable` and caching the answer — an element with no link is silently skipped and
 *  `renderEmbeddable` is never called for it. So a clip's element has to carry one even though
 *  nothing ever follows it: our own renderer replaces the iframe entirely and builds the media URL
 *  from the media id itself.
 *
 *  It is always absolute and always same-origin, which is what `validateEmbeddable` checks. A clip
 *  that has not landed yet has no media to point at, so it points at this video's own page — a
 *  real address, and the one someone would want if they somehow reached it.
 *
 *  This link is put on at load and taken off before every write. It is derived state, and a
 *  document that stored it would be wrong the moment the deployment moved. */
export function embedLink(addr, clip, origin = globalThis.location?.origin || '') {
  const path = clip?.mediaId
    ? mediaUrl({ ...addr, mediaId: clip.mediaId })
    : `${KIT_BASE}#/v/${encodeURIComponent(addr?.sessionId || '')}`;
  return `${origin}${path}`;
}

/** A filename someone would recognise in their downloads folder. */
export function downloadName(title, kind = 'mp4') {
  const stem = String(title || 'video').trim().replace(/[^\w \-.]+/g, '').replace(/\s+/g, '-').slice(0, 60);
  return `${stem || 'video'}.${kind}`;
}
