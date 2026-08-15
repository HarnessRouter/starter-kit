// What this deployment can make, as the app reads it.
//
// The server answers with one row per capability — text_to_video, text_to_image, text_to_speech,
// text_to_music, export — saying whether it is available, which model it currently resolves to,
// and which candidates were skipped and why. Models come and go and some of them are broken on any
// given day, so this is a live answer rather than a fact about the product.
//
// The app uses it for exactly two decisions, and both are about not wasting someone's time:
// whether the prompt box can start anything at all, and whether the Export button does anything.
// It renders the server's own reasons verbatim — "the provider rejects this model id" is a
// sentence somebody can act on, and this app has no better one to invent.

const VIDEO = 'text_to_video';
const EXPORT = 'export';

/** `{ capabilities: [...] }` → what the app asks it. Every field is the server's; nothing here
 *  fills a gap with a guess. `null` in, and everything is unknown rather than false — a page that
 *  has not asked yet must not say "no model is connected". */
export function parseCapabilities(raw) {
  if (!raw || !Array.isArray(raw.capabilities)) return null;
  const byName = new Map();
  for (const c of raw.capabilities) {
    if (!c || typeof c.name !== 'string') continue;
    byName.set(c.name, {
      name: c.name,
      available: c.available === true,
      model: c.model || null,
      usdPerUnit: Number.isFinite(c.estimated_usd_per_unit) ? c.estimated_usd_per_unit : null,
      limits: c.limits && typeof c.limits === 'object' ? c.limits : {},
      reason: c.reason || '',
      skipped: Array.isArray(c.skipped)
        ? c.skipped.map((s) => ({ model: s?.model || '', reason: s?.reason || '' }))
        : [],
    });
  }
  return { byName, list: [...byName.values()] };
}

export const capability = (caps, name) => caps?.byName.get(name) || null;

/** Can this deployment make a video right now? `null` while unknown — the difference between
 *  "not asked yet" and "no" is the difference between a quiet prompt box and a red banner. */
export function canMakeVideo(caps) {
  if (!caps) return null;
  return capability(caps, VIDEO)?.available === true;
}

/** Why not, in the server's words, with the chain it walked.
 *
 *  The skipped list is the part that turns "unavailable" from a product fault into a fact: four
 *  models are listed for video and on a bad night two of them are broken upstream. */
export function videoUnavailableReason(caps) {
  const c = capability(caps, VIDEO);
  if (!c || c.available) return '';
  const head = c.reason || 'No video model is connected.';
  if (!c.skipped.length) return head;
  return `${head} Tried ${c.skipped.map((s) => `${s.model} (${s.reason})`).join(', ')}.`;
}

/** Assembling clips into one film needs tools on the server, not a provider. A deployment built
 *  without them says so, and the Export button carries that sentence rather than failing on
 *  press. */
export function exportAvailability(caps) {
  const c = capability(caps, EXPORT);
  if (!caps) return { available: null, reason: '' };
  if (!c) return { available: false, reason: 'This deployment cannot assemble video.' };
  return {
    available: c.available,
    reason: c.available ? '' : c.reason || 'This deployment cannot assemble video.',
  };
}

/** One line naming what is actually connected, for the landing's subtitle.
 *
 *  Names the model that would run, because that is a real thing the person is about to spend money
 *  on. '' when nothing is connected — the banner underneath says that instead, once, rather than
 *  the page saying it twice in two voices. */
export function connectedSummary(caps) {
  const video = capability(caps, VIDEO);
  if (!video?.available || !video.model) return '';
  return video.model;
}
