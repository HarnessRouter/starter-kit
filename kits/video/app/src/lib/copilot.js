// The copilot's turn — the one place this app streams.
//
// Everything else the page does is a request and a response: the canvas is a document with a
// revision, jobs are polled, media is bytes. The conversation is the opposite case — one turn, one
// open panel — and watching the agent plan the shots is the point, because that is where a person
// catches it about to spend four dollars on the wrong film.
import { streamTurn as harnessStreamTurn } from 'reifyui/harness';
import { isPending, pendingTemplate } from './video.js';
import { getTemplate, templateNarration, templateShots } from './templates.js';

/**
 * Run one copilot turn.
 *
 * `videoId` may be a pending id ("new:<template>"), in which case no session exists yet and the
 * turn creates one; handlers.onSession reports it the moment a frame carries it.
 *
 * The template the person picked only exists in the browser, so the FIRST turn is where it becomes
 * real. It travels in `instructions`, not in the message: the gateway records the raw user text
 * for the transcript, so the chat keeps showing the sentence they typed instead of a wall of
 * starting JSON. Scaffolding should be invisible.
 *
 * What is sent is the shot PLAN, in words — never the template's scene JSON. The agent does not
 * write the canvas; it places clips on it through tools, and handing it a scene document is an
 * invitation to hand one back. `assumes` and `adapt` come with it for the same reason the
 * dashboard kit sends them: a template was written for something, the person asked for something
 * else, and a template applied without that reconciliation is six shots of the wrong film.
 */
export async function runCopilotTurn(videoId, message, handlers, attachments = []) {
  const pending = isPending(videoId);
  let instructions = '';
  if (pending) {
    const tpl = await getTemplate(pendingTemplate(videoId)).catch(() => null);
    if (tpl) instructions = templateInstructions(tpl);
  }

  const input = attachments.length
    ? [{ role: 'user', content: [...attachments, { type: 'input_text', text: message }] }]
    : message;

  return harnessStreamTurn({
    sessionId: pending ? '' : videoId,
    input,
    instructions,
    handlers,
  });
}

/** The template, as instructions.
 *
 *  Deliberately prose and deliberately partial. It says what the film is for and how long each
 *  shot runs, because a duration is required on every generation and getting it from the template
 *  is how the first turn avoids asking. It does not say what the pictures are — the person's own
 *  sentence does that, and a template that overrode it would make every video the same video. */
export function templateInstructions(tpl) {
  const shots = templateShots(tpl);
  const lines = [
    `Start this video from the "${tpl.name}" template.`,
    '',
    `It is written for ${tpl.aspect || '16:9'}${shots.length ? ` and ${shots.length} shots` : ''}.`,
  ];

  const assumes = assumptionLines(tpl.assumes);
  if (assumes.length) {
    lines.push('',
      'WHAT IT ASSUMES, which is probably not what the person just asked for:',
      ...assumes);
  }
  if (tpl.adapt) lines.push('', tpl.adapt);

  // The reference frame is put on the canvas as this video is created, so it is describe_canvas
  // that carries the media id rather than this text — an id in prose is an id to be mistyped,
  // and it does not exist yet at the moment these instructions are written.
  if (tpl.reference?.src) {
    lines.push('',
      'A REFERENCE FRAME for this look is placed on the canvas as this video starts — it is the '
      + 'picture on the template card, and it is the look being aimed at rather than a shot of '
      + "the person's own subject. Read the canvas before you plan. Unless they ask for "
      + 'something else, render the opening shot FROM it with from_image so the film starts on '
      + 'that look, and say that is what you did.');
  }

  if (shots.length) {
    lines.push('', 'The shape to start from, before adapting it to what they asked for:');
    for (const [i, s] of shots.entries()) {
      const len = Number.isFinite(s.seconds) ? `${s.seconds}s` : 'length up to you';
      const cast = s.cast ? ` ${s.cast}` : '';
      lines.push(`  ${i + 1}. ${s.name} (${len})${cast}${s.prompt ? ` — ${s.prompt}` : ''}`);
    }
  }

  // A voice line runs UNDER a shot rather than being one. Listing it as a shot is how an
  // eight-line explainer becomes a forty-eight-second film instead of a twenty-four-second one.
  const narration = templateNarration(tpl);
  if (narration.length) {
    lines.push('', 'Narration, one line under each shot:');
    for (const n of narration) lines.push(`  ${n.name}${n.prompt ? ` — ${n.prompt}` : ''}`);
  }

  lines.push('',
    'Rewrite this plan in their subject before you generate anything, put the shot list in the',
    'conversation with a length for each shot, and wait for a yes. Then build the canvas with your',
    'own tools. Do not write a canvas file.');
  return lines.join('\n');
}

/** `assumes` is a map of named assumptions — subject, character, length, aspect. Rendering it as
 *  one string per name keeps each one readable and keeps the object from arriving as
 *  "[object Object]", which is what a template's most load-bearing paragraph became the first time
 *  this was written for a plain string. */
function assumptionLines(assumes) {
  if (!assumes) return [];
  if (typeof assumes === 'string') return [`  ${assumes}`];
  if (typeof assumes !== 'object') return [];
  return Object.entries(assumes)
    .filter(([k]) => !k.startsWith('$'))
    .map(([k, v]) => `  ${k}: ${v}`);
}
