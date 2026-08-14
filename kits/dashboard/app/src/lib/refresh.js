// Opening a dashboard runs every query it needs. This is that run.
//
// There is no cache and no refresh interval, because there is no version of "how old is this
// number" that is worth the confusion of getting it wrong. A dashboard shows the database at the
// moment it was opened, and the app bar says when that was.
//
// Three things this has to get right:
//
//   - Queries are independent. One that fails must not take the other eleven with it; its panels
//     show its error and the rest of the page is live.
//   - Concurrency is bounded. Twelve panels opening twelve database connections at once is how a
//     dashboard takes a production database down, and the person who built it would have no way
//     to know that is what happened.
//   - A run is abandonable. Navigating away mid-refresh must stop the run rather than let it
//     finish into a page that is gone.
import { queriesToRun } from './dashboard.js';

export const CONCURRENCY = 4;

/** Run the document's queries and report each as it lands.
 *
 *  `run(sql)` is injected so this is testable without a database and so the page can pass its own
 *  cancellation in. `onUpdate(id, state)` fires per query, twice: once as it starts and once when
 *  it settles. State is `{status:'loading'}` → `{status:'ok', result, at}` | `{status:'error',
 *  error, at}`.
 *
 *  Resolves with the whole map when every query has settled. Never rejects: a failed query is a
 *  result, not an exception, and the caller has a page to draw either way. */
export async function refreshAll(doc, run, { concurrency = CONCURRENCY, onUpdate, signal } = {}) {
  const queries = queriesToRun(doc);
  const states = new Map();
  const stopped = () => Boolean(signal?.aborted);

  const set = (id, state) => {
    states.set(id, state);
    if (!stopped()) onUpdate?.(id, state);
  };

  let next = 0;
  async function worker() {
    for (;;) {
      if (stopped()) return;
      const i = next++;
      if (i >= queries.length) return;
      const q = queries[i];
      set(q.id, { status: 'loading' });
      try {
        const result = await run(q.sql, q);
        if (stopped()) return;
        set(q.id, { status: 'ok', result, at: Date.now() });
      } catch (e) {
        if (stopped()) return;
        // The database's own words. "column o.amont does not exist" is what fixes the panel;
        // "Something went wrong" is what makes someone rebuild the dashboard from scratch.
        set(q.id, { status: 'error', error: e?.message || 'This query failed.', at: Date.now() });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, queries.length || 1)) }, worker),
  );
  return states;
}

/** What one panel shows, given the query states. Panels share queries, so this is a lookup and
 *  not a per-panel run — three stats over one SELECT cost one round trip and show one error
 *  between them if it fails. */
export function panelState(panel, states) {
  if (!panel.viz.kind) return { status: 'error', error: 'This panel doesn’t say what to draw.' };
  if (!panel.query) return { status: 'error', error: 'This panel isn’t connected to a query.' };
  if (panel.missingQuery) {
    return { status: 'error', error: `This panel reads a query called “${panel.query}”, which isn’t in this dashboard.` };
  }
  return states.get(panel.query) || { status: 'loading' };
}

/** "just now" / "2 min ago" — for the one line that says how old the whole page is. Coarse on
 *  purpose: a second-by-second counter invites the belief that the number updates, and it does
 *  not. */
export function freshness(at, now = Date.now()) {
  if (!at) return '';
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m || 1} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(at).toLocaleString();
}
