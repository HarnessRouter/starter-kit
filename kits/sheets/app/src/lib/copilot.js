// The copilot's turn — the one place this app streams.
//
// Cells poll (see lib/cell.js) because a reopened tab has no stream and needs the polling path
// anyway. The copilot is the opposite case: one turn, one open panel, and watching the agent
// think is the point. Both are POST /responses; this is the API's two modes used where each is
// right, not an inconsistency.
import { streamTurn as harnessStreamTurn } from 'reifyui/harness';
import { isPending, pendingTemplate } from './sh';
import { getTemplate } from './templates';
import { materialize } from './model';

/**
 * Run one copilot turn.
 *
 * `sheetId` may be a pending id ("new:<template>"), in which case no session exists yet and the
 * turn creates one; handlers.onSession reports it the moment a frame carries it.
 *
 * The template the person picked only exists in the browser, so the FIRST turn is where it
 * becomes real. It travels in `instructions`, not in the message: the gateway records the raw
 * user text for the transcript, so the chat keeps showing the sentence they typed instead of a
 * wall of starting JSON. Scaffolding should be invisible.
 */
export async function runCopilotTurn(sheetId, message, handlers, attachments = []) {
  const pending = isPending(sheetId);
  let instructions = '';
  if (pending) {
    const tpl = await getTemplate(pendingTemplate(sheetId)).catch(() => null);
    if (tpl) {
      instructions = [
        `Start this sheet from the "${tpl.name}" template.`,
        tpl.brief || '',
        '',
        'Write exactly this into ./sheet.json first, then adapt it to what the person asked for:',
        JSON.stringify(materialize(tpl.sheet, tpl.name), null, 2),
      ].filter(Boolean).join('\n');
    }
  }

  const input = attachments.length
    ? [{ role: 'user', content: [...attachments, { type: 'input_text', text: message }] }]
    : message;

  return harnessStreamTurn({
    sessionId: pending ? '' : sheetId,
    input,
    instructions,
    handlers,
  });
}
