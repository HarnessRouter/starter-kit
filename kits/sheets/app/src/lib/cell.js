// Running ONE agent cell: build the input, start the turn, wait for it, read the answer.
//
// This is the only file in the kit that knows a cell is a turn. The Runner above it knows the
// rules; the grid below it knows the pixels. Keeping the seam here is what let the rules be
// tested without a server.
//
// Transport: `background: true` plus a poll, NOT a stream. The session id arrives on the
// immediate reply, so nothing is learned by streaming; and a tab that was closed and reopened has
// no stream and needs the polling path anyway — streaming per cell would be a second mechanism
// for the same job. Live text, where it matters, comes from the turn replay in the cell drawer.
import { cancelResponse, containerFileUrl, createResponse, getResponse, patchSession } from 'reifyui/harness';
import { VALUE_MAX, interpolate } from './model.js';

const POLL_MS = 2000;
/** How long a terminal-but-empty response is given to produce its own content.
 *
 *  Measured on a live instance: a turn reports status "completed" — and the session reports
 *  turn_status "done" — about two seconds BEFORE its output items are written. Believing either
 *  signal on its own records "the agent finished without answering" over a turn that answered
 *  perfectly well, which is the worst kind of wrong: it looks like a model failure and it costs a
 *  re-run to disprove. There is no third signal to consult; the record IS the answer, so the only
 *  honest rule is to wait for it, bounded. Costs nothing on the normal path — the loop exits the
 *  instant content appears. */
const SETTLE_MS = 15000;
/** Refuse an attachment larger than the API accepts rather than truncating a file silently. */
const FILE_MAX = 25 * 1024 * 1024;

const now = () => Math.floor(Date.now() / 1000);

const MIME = {
  md: 'text/markdown', txt: 'text/plain', json: 'application/json', csv: 'text/csv',
  tsv: 'text/tab-separated-values', html: 'text/html', py: 'text/x-python', js: 'text/javascript',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml',
  pdf: 'application/pdf',
};
const mimeOf = (name) => MIME[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';

async function fileAsDataUrl(artifact) {
  const res = await fetch(containerFileUrl(artifact.container_id, artifact.file_id), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not read ${artifact.filename}.`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > FILE_MAX) {
    throw new Error(`${artifact.filename} is too large to attach (${Math.round(buf.byteLength / 1048576)} MB).`);
  }
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return `data:${mimeOf(artifact.filename)};base64,${btoa(bin)}`;
}

/** A directory per source column, so an agent reading three attachments can tell them apart. */
const slug = (s) => String(s || 'in').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'in';

/** The assistant text of a finished response: message items, in order. */
function textOf(response) {
  const parts = [];
  for (const item of response?.output || []) {
    if (item?.type !== 'message') continue;
    for (const c of item.content || []) if (c?.type === 'output_text' && c.text) parts.push(c.text);
  }
  return parts.join('\n').trim();
}

/** The files this turn produced, from the terminal response's citations. */
function artifactsOf(response) {
  const out = [];
  const seen = new Set();
  for (const item of response?.output || []) {
    for (const c of item?.content || []) {
      for (const a of c?.annotations || []) {
        if (a?.type !== 'container_file_citation' || !a.file_id) continue;
        if (seen.has(a.file_id)) continue;
        seen.add(a.file_id);
        // container_id is taken from the annotation rather than assumed equal to the session id:
        // it happens to be in this deployment, and depending on that would be a silent coupling.
        out.push({ filename: a.filename || 'file', container_id: a.container_id, file_id: a.file_id });
      }
    }
  }
  return out;
}

/**
 * Make the dispatcher the Runner injects.
 *
 * `sheetId` and `runId` are only here to build the idempotency key, which is the difference
 * between a retried request replaying its first answer and a second turn starting on a session
 * that is already running one. Two turns on one session destroy that session's workspace.
 */
export function makeCellDispatcher({ sheetId, runId, sheetTitle, columns, onCell }) {
  return async function dispatchCell(task, { signal }) {
    const { column, rowId, colId, rowIndex, values, upstream } = task;
    const cfg = column.harness || {};
    const started_at = now();
    const key = `${rowId}:${colId}`;

    const { text, missing } = interpolate(cfg.prompt, columns, values);
    if (missing.length) {
      // Precise, per row, and it punishes no other row: the hosted product substituted empty
      // here, which sends the model a prompt with a hole in it and gets a confident answer about
      // nothing back.
      return {
        status: 'skipped', run_id: runId, started_at, ended_at: now(), value: null, artifacts: [],
        error: `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} empty in this row.`,
      };
    }

    const content = [];
    for (const u of upstream || []) {
      for (const a of u.cell?.artifacts || []) {
        // eslint-disable-next-line no-await-in-loop
        const file_data = await fileAsDataUrl(a);
        content.push({ type: 'input_file', filename: `in/${slug(u.column.name)}/${a.filename}`, file_data });
      }
    }
    content.push({ type: 'input_text', text });

    const body = {
      input: [{ role: 'user', content }],
      background: true,
      metadata: { harness_id: cfg.harness_id },
      // Framing goes in `instructions`, never in `input`: the gateway captures the user text
      // before prepending this, so the transcript and the console task list show the person's own
      // prompt rather than our scaffolding.
      instructions: [
        `You are filling one cell of a spreadsheet: column "${column.name}", row ${rowIndex + 1} of ${task.rowsTotal}.`,
        'Answer for this row only.',
        'Keep the answer short enough to read in a table cell. If the work produces something long,',
        'write it to a file in your working directory and summarise it in one or two sentences.',
      ].join(' '),
      ...(cfg.timeout_seconds ? { timeout_seconds: cfg.timeout_seconds } : {}),
    };

    let created;
    try {
      created = await createResponse(body, { idempotencyKey: `${sheetId}:${runId}:${rowId}:${colId}` });
    } catch (e) {
      return { status: 'failed', run_id: runId, started_at, ended_at: now(), value: null,
               artifacts: [], error: e?.message || 'The turn could not be started.' };
    }

    const responseId = created?.id || '';
    const sessionId = created?.metadata?.session_id || '';
    // Published before anything else is dispatched: these two ids are what makes a reopened tab
    // able to find out what happened, rather than showing a cell stuck at "running" forever.
    const partial = { status: 'running', run_id: runId, response_id: responseId,
                      session_id: sessionId, started_at, value: null, artifacts: [], error: null };
    onCell?.(key, partial);

    // A cell session titled for its cell makes the console's task list navigable instead of forty
    // rows named after a truncated prompt. One call, and it sets the title as chosen so the
    // per-turn write stops regenerating it.
    if (sessionId) {
      patchSession(sessionId, { title: `${sheetTitle || 'Sheet'} · ${column.name} · row ${rowIndex + 1}` })
        .catch(() => { /* cosmetic; never fail a cell over its own title */ });
    }

    const stop = () => { if (responseId) cancelResponse(responseId).catch(() => {}); };
    signal.addEventListener('abort', stop, { once: true });

    try {
      for (;;) {
        if (signal.aborted) {
          return { ...partial, status: 'failed', ended_at: now(), error: 'Stopped.' };
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, POLL_MS));
        let res;
        try {
          // eslint-disable-next-line no-await-in-loop
          res = await getResponse(responseId);
        } catch {
          continue;   // a transient read failure is not a failed turn; the next poll decides
        }
        const st = res?.status;
        if (st === 'queued' || st === 'in_progress' || st === 'running' || !st) continue;

        let value = textOf(res);
        let artifacts = artifactsOf(res);

        // Terminal, but empty: the record may simply not be written yet (see SETTLE_MS). Give it
        // the grace window before concluding anything, and take whatever turns up.
        if (!value && !artifacts.length) {
          const deadline = Date.now() + SETTLE_MS;
          while (Date.now() < deadline && !signal.aborted) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 1000));
            // eslint-disable-next-line no-await-in-loop
            const again = await getResponse(responseId).catch(() => null);
            if (!again) continue;
            value = textOf(again);
            artifacts = artifactsOf(again);
            if (value || artifacts.length) { res = again; break; }
          }
        }

        const base = { ...partial, ended_at: now(), session_id: res?.metadata?.session_id || sessionId };

        if (st === 'completed') {
          // "completed" means the agent exited cleanly, which is not the same as answering. A turn
          // that produced neither text nor a file did not fill this cell, and saying it did would
          // be a green tick over nothing.
          if (!value && !artifacts.length) {
            return { ...base, status: 'failed', error: 'The agent finished without answering.' };
          }
          return {
            ...base,
            status: 'done',
            value: value.length > VALUE_MAX ? value.slice(0, VALUE_MAX) : value,
            value_truncated: value.length > VALUE_MAX,
            artifacts,
            error: null,
          };
        }
        if (st === 'cancelled') return { ...base, status: 'failed', error: 'Stopped.' };
        return {
          ...base,
          status: 'failed',
          artifacts,
          error: res?.error?.message
            || (st === 'incomplete' ? 'The turn ended without an answer.' : `The turn ${st}.`),
        };
      }
    } finally {
      signal.removeEventListener('abort', stop);
    }
  };
}
