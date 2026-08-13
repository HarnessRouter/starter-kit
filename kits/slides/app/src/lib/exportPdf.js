// PDF export: the browser's own print pipeline, pointed at a fixed print surface.
//
// There is no export service in this deployment, and this is not a compromise — printing #/print
// renders the deck through the SAME components the canvas uses, so text stays selectable vector
// and charts stay vector (the chart element already renders SVG). Any library that rasterises the
// slide would be larger, slower and worse.
//
// The honest cost, stated in the UI rather than hidden: this opens the system print dialog. We
// cannot name the file or choose the destination, so the menu says "Print to PDF…", not
// "download".
const KEY = 'slides.print.';
const STALE_MS = 5 * 60 * 1000;

/** Hand the LIVE deck to the print tab.
 *
 *  Deliberately not "let the print tab load it by id": autosave is debounced and is refused with
 *  409 while a turn is running, so the file on disk is not always what the person is looking at.
 *  Printing something other than what is on screen would be its own bug.
 *
 *  Must run inside the click. Opening the tab after an await loses user activation and the
 *  browser blocks it as a popup.
 */
export function openPrintView(id, deck) {
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith(KEY) && Date.now() - Number(k.slice(KEY.length)) > STALE_MS) {
      localStorage.removeItem(k);   // a handoff nobody collected (tab closed, print cancelled)
    }
  }

  const key = KEY + Date.now();
  try {
    localStorage.setItem(key, JSON.stringify({ id, deck }));
  } catch {
    throw new Error('This deck is too large to hand to the print view.');
  }

  const url = `${window.location.pathname}#/print?h=${encodeURIComponent(key)}`
            + `&deck=${encodeURIComponent(id || '')}`;
  const tab = window.open(url, '_blank');
  if (!tab) {
    localStorage.removeItem(key);
    throw new Error('Your browser blocked the print tab. Allow pop-ups for this page, then try Export again.');
  }
}
