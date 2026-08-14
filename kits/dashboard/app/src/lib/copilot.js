// The copilot's turn — the one place this app streams.
//
// Panels do not stream: they are SQL the app replays against the database, which is a request and
// a response (lib/query.js). The copilot is the opposite case — one turn, one open panel, and
// watching the agent read the schema and try queries is the point, because that is where a person
// catches it charting the wrong column.
import { streamTurn as harnessStreamTurn } from 'reifyui/harness';
import { isPending, pendingTemplate } from './dash';
import { getTemplate } from './templates';

/**
 * Run one copilot turn.
 *
 * `boardId` may be a pending id ("new:<template>"), in which case no session exists yet and the
 * turn creates one; handlers.onSession reports it the moment a frame carries it.
 *
 * The template the person picked only exists in the browser, so the FIRST turn is where it
 * becomes real. It travels in `instructions`, not in the message: the gateway records the raw
 * user text for the transcript, so the chat keeps showing the sentence they typed instead of a
 * wall of starting JSON. Scaffolding should be invisible.
 *
 * What a dashboard template carries that a document template does not is `assumes` and `adapt` —
 * the schema it was drawn against, and what to do because the person's schema is not that one.
 * Sending the panels without those is how a template becomes eight panels of
 * `relation "subscriptions" does not exist`.
 */
export async function runCopilotTurn(boardId, message, handlers, attachments = []) {
  const pending = isPending(boardId);
  let instructions = '';
  if (pending) {
    const tpl = await getTemplate(pendingTemplate(boardId)).catch(() => null);
    if (tpl) {
      const assumes = Object.entries(tpl.assumes || {})
        .map(([table, cols]) => `  ${table}: ${cols}`).join('\n');
      instructions = [
        `Start this dashboard from the "${tpl.name}" template.`,
        '',
        'READ THE SCHEMA FIRST. This template was drawn against a database that is almost',
        'certainly not the one you are connected to:',
        assumes,
        '',
        tpl.adapt || '',
        '',
        'Map every panel onto the tables that actually exist, run each query before you keep it,',
        'and drop any panel the real schema cannot answer — telling the person which one and why.',
        `The template is written for ${tpl.dialect || 'postgres'}; translate the SQL if the`,
        'connected engine is a different one.',
        '',
        'The shape to start from, before adapting:',
        JSON.stringify(tpl.dashboard, null, 2),
      ].filter((l) => l !== null).join('\n');
    }
  }

  const input = attachments.length
    ? [{ role: 'user', content: [...attachments, { type: 'input_text', text: message }] }]
    : message;

  return harnessStreamTurn({
    sessionId: pending ? '' : boardId,
    input,
    instructions,
    handlers,
  });
}
