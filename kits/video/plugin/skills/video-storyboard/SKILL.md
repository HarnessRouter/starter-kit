---
name: video-storyboard
description: How to make a film that holds together — the submit-and-poll loop, the storyboard you agree before spending anything, how a character stays the same person across shots, what each capability can and cannot do today, and how the timeline becomes one exported video. Use for EVERY video request, before generating anything.
---

# Video storyboard

You are spending someone's money on renders that take four minutes each. Everything
here exists to stop you spending it twice.

## What you are making

Two things, from one conversation:

1. **A canvas** — the shots as cards, laid out so the person can see the film before
   it is a film, drag things around, and draw on it.
2. **One video** — the shots, in an order you and they agreed, assembled and
   downloadable.

The canvas is the working surface. The video is the deliverable.

## The canvas is not a file you write

This is the rule that ruins a session when it is broken, so it is first.

There is a `scene.excalidraw` in your working directory. **It is a projection.**
Writing to it changes nothing a person will ever see; hosted, it is discarded at the
end of the turn, and it may already be one turn out of date when you read it. There is
no file anywhere that you edit to put a clip on the canvas.

The canvas is changed through your tools and only through your tools:

- one tool **describes** the canvas — that is your only read of it;
- one **places** media or text on it;
- others **move**, **arrange** and **remove** what is there.

*How this fails silently:* you write beautiful scene JSON, the tool call succeeds
because writing a file always succeeds, and the person's canvas stays empty while you
report that the storyboard is laid out.

Two more consequences worth holding on to:

- **Removing an element never deletes the media.** The clip stays in the store and can
  be placed again. Tidy the board freely.
- **You never read the canvas by reading the file.** If the describe tool and the file
  ever disagree, the tool is right.

## Your tools are in your tool list

Read it. Use the names you find there, not names from this document — this describes
what exists, and the list is what is loaded right now.

| What you need to do | The tool that does it |
|---|---|
| Find out what can be made today, and what it costs | the capabilities tool — **call this first, always** |
| Make a clip | the video generation tool |
| Make a still | the image generation tool |
| Make a spoken line | the speech tool |
| Ask whether jobs have landed | the job-checking tool |
| See the canvas | the describe tool |
| Put something on the canvas | the place tool |
| Tidy the canvas | the move, arrange and remove tools |
| Say what order the film cuts in | the timeline tool |
| Assemble and export it | the export tool |

There is also a music tool. It exists so the answer to "add a soundtrack" is a stated
fact rather than a missing tool you route around — see *When something is not
available*.

**If a tool this document describes is not in your list, it is not there.** Say which
one is missing and what it means for the plan. Do not substitute a file write, a shell
command, or a different capability.

## The loop, once

```
capabilities  →  storyboard in the conversation  →  WAIT FOR A YES
              →  stills, if the shots need continuity  →  show them
              →  submit EVERY clip  →  place EVERY job  →  arrange
              →  do something else  →  check the jobs
              →  set the timeline  →  export
```

Generation is **submit and poll**. Every generate tool returns a job id straight away
and the render happens in the background. So:

- **Submit all of the shots, then place all of them, then arrange.** A placed job
  appears on the canvas immediately as a card that becomes the clip when it lands, so
  the person watches the film assemble itself.
- **Then stop and do something else** — write the next prompt, set the timeline,
  answer their question. Check the jobs when you have run out of other work.
- **Never submit one clip and wait for it.** Four shots submitted together is four
  minutes. Four shots submitted one at a time is sixteen, and there is nothing to
  watch for fifteen of them.

*How this fails silently:* nothing looks wrong. The film is correct and the person sat
through four times the wait for it, which they will remember and you will not.

### Reading job status

Four statuses, and one of them is a trap:

- `succeeded` — it landed; the card on the canvas is now the clip.
- `running` — still rendering.
- `failed` — read the error and the attempts; it says which models were tried.
- **`unknown` — ask again.** This is a transient empty answer from the provider, not a
  result. It is **never terminal** and it never means the render died.

*How this fails silently:* you read `unknown` as failure, tell the person the shot
failed, and re-render a clip that was about to land — twice the cost, half the trust.

A job outlives your turn. If a render is still going when the conversation moves on,
it still finishes, the canvas still updates, and it is waiting for you next turn.

## Money

Every generation is a real charge, and the mistakes are asymmetric: a wasted clip costs
dollars and four minutes, a wasted still costs cents and seconds.

- **A duration is required on every clip.** There is no default and you may not omit
  it. One of the models bills a fifteen-second clip when nothing says otherwise — about
  six times the price of the six-second one. This is the single most expensive mistake
  available here.
- **Never re-render something that already exists.** Place it again. Placing costs
  nothing.
- **Never loop a generation**, and never call a generate tool inside a retry. A retry
  is a decision, and it is the person's, made with the cost in front of them.
- **Stills before clips** — see below.
- The capabilities tool reports cost per unit where the cost is actually measured. Use
  those numbers in the storyboard so the person is agreeing to a price and not only to
  a plan.
- There is a **spend cap per video**. When you hit it the generate tools refuse and say
  so. That is not a bug to work around; it is the point at which you ask.

*How this fails silently:* a plausible film arrives and the bill is four times what the
person expected, because nothing in the conversation ever named a number.

## Get the storyboard agreed before you spend anything

Write the shot list **in the conversation**, as text, and wait for a yes.

Not on the canvas, not in a file — in the message, where they can read it in ten
seconds and change it for free. The full format, with a worked example, is in
`references/storyboard-format.md`. The short version:

```
Six shots, 36 seconds, 16:9. About $1.70 at today's model.

1. (6s) [no character] The product alone in near-darkness, turning a few degrees as a
   single rim light finds its edge.
2. (6s) [no character] Macro on the surface — the one detail that is expensive to get
   right. Slow push in.
…
Style: modern product cinematography, shallow depth of field, real optics.
Palette: cool graphite and off-white, one warm accent.
```

Three things earn their place in that block:

- **A length per shot**, because a length is a price.
- **`Style:` and `Palette:` as two global lines**, repeated verbatim into every prompt
  you send. Six shots described beautifully but separately come back as six films.
- **A `[no character]` or `[character: name]` tag on every shot.** That tag decides how
  the shot is made, and the rule it selects is the next section.

*How this fails silently:* you generate first and describe after. Everything renders,
nothing is wrong with any single shot, and the person discovers on delivery that the
film they wanted was a different film. Now it costs money to change.

## Continuity is a rule, not a hope

**A character who appears in more than one shot must be generated once and reused.**

Make the character as a still. Show it. Get a yes. Then make every shot they are in
*from that image* — the generate tools take an earlier media or job id for exactly
this, and the same applies when you turn a still into a clip.

**Never re-generate a person from text.** The same words produce a different face every
time, and there is no prompt precise enough to fix that.

*How this fails silently:* this is the worst one in the whole kit. Each shot looks
right. The film looks wrong, and it takes a moment to see why — three shots, three
people, and no single frame you can point at. Nobody catches it in review; everybody
catches it on delivery.

If they say "this character" and no image of that character exists, **stop and ask**.
Do not invent a lead and then be stuck with them for the rest of the film.

The details — which shots need it, how to hold a place and a palette steady, what to do
when the tool that accepts an input image is down — are in `references/continuity.md`.

## Stills before clips

For anything with a subject that recurs, generate the frames first, place them, and
show them.

An image is seconds and cents. A clip is minutes and dollars. A wrong still is a
correction; four wrong clips are an afternoon and a bill.

*How this fails silently:* the composition was never in question, so you skipped
straight to clips — and the model's idea of "a plain desk in daylight" turns out to be
four different desks.

Empty shots — landscape, an object, an environment, anything with no recurring subject
— can go straight to a clip. Judgement, not ceremony.

## When something is not available

The chain behind each capability tries several models in order and reports which one
actually ran. When none of them can run, the tool returns a refusal.

**A refusal is an answer. Take it and pass it on.**

- Say which capability is unavailable, in the person's words.
- Say what it means for the plan — which shots cannot be made, what the film becomes
  without them.
- Offer the version you *can* make.
- Say that connecting a provider is theirs to do, not yours.

Three specific substitutions you must never make:

- **Speech is not music.** The speech models here hold a conversation; they cannot
  score anything. If music is unavailable, the film has no soundtrack and you say so.
- **A text-only clip is not an image-to-video clip.** If no model that accepts an input
  image is working, that capability refuses. It does not quietly render from the prompt
  alone — and neither do you, because the result would be a different person in the
  shot and it would look like it worked.
- **A watermarked model is never a default.** One of the video models stamps its
  output. It is only used if the person has said a watermark is acceptable.

*How this fails silently:* a substitution that produces a file. A file makes the tool
call look successful, so nobody checks, and the wrong thing ships.

## Narration, if there is any

The speech models are **conversational**: they answer a prompt rather than reading it.
Asked to say "hello", one of them replied "Hello! It's great to talk with you."

So:

- Wrap every line in an instruction to read it exactly and add nothing.
- **Generate ONE line first and check it.** The job result carries the model's own
  transcript of what it actually said, and whether that matches what you asked for.
  Read it before you generate the other five.
- If it will not read verbatim, say so and offer captions instead. An improvised
  voiceover under someone's explainer is worse than silence.

*How this fails silently:* the audio exists, it is fluent, it is in the right voice, and
it says something the person never wrote. It sounds fine until they listen to it.

## Laying the board out

Use the arrange tool. Do not compute coordinates by hand.

- Arrange after every batch you place. The storyboard layout gives one frame per shot,
  the caption under the clip, in timeline order.
- Place a job the moment you submit it, so the board fills up while the renders run.
- Give every clip a shot label. It is what the person reads on the card and what groups
  the clip with its caption.

*How this fails silently:* hand-placed cards overlap. The one underneath cannot be
clicked, and from your side everything reported success.

## Pick the aspect ratio first

One aspect for the whole film, chosen before the first generation, and set on the
timeline as well.

Mixed aspects are **letterboxed** — black bars the person did not ask for, on the shots
that do not match. The export normalises to the timeline's declared resolution rather
than to whatever the first clip happened to be, so a single stray 9:16 shot does not
distort the film; it just sits in a box in the middle of it.

For vertical, say so in **every** prompt — "vertical", "portrait framing", "subject in
the middle third". A model with no instruction returns a wide frame. Check the first
clip's dimensions when it lands, before generating the rest.

## The timeline, and the export

The timeline is the cut. It is a list of shots, in order, with an in and out point each,
plus any audio with a start time and a level.

- **The array order IS the cut order.** It is never inferred from where cards sit on the
  canvas, because dragging a card to tidy the board would then silently re-cut the film.
- Trim with in and out points inside the clip's real length. A cut past the end of a
  file makes the film come out short.
- Audio gets a start time in seconds from the beginning of the film, and a level in dB.
  Music under a voice sits around -12 to -18.
- Set the frame rate and the resolution explicitly.

Then export. What to expect:

- It **refuses while any shot is still rendering.** Wait; the job finishes whether or
  not anyone is watching.
- It reports progress as a real count of shots finished. There is no ETA, because
  nobody can honestly give one.
- It checks the assembled duration against the plan and **fails if they disagree**,
  naming both numbers. If that happens, something rendered at a length you did not ask
  for — find out which shot before re-exporting.
- On a deployment without the video tooling installed, export says so plainly and the
  clips are all still downloadable individually. That is not something you can fix from
  here.

## Templates

`templates/templates.json` holds five worked storyboards — a product launch, an
explainer with narration, a vertical teaser, a five-shot story, and a how-to. There is
no blank one, because a blank template is the absence of one: someone who already knows
what they want just says it.

They are made **entirely of placeholders**: dashed cards carrying the shot's intended
prompt, its length and its cast tag, with nothing generated and nothing spent. Each
carries `assumes` (what the storyboard was written for) and `adapt` (what usually
differs, and what to do about it). If a template started this video, both arrive with
your first instructions. **Read `adapt` before the first generation, not after.**

Adopting a template means: read each placeholder's prompt, rewrite it for what this
person actually asked for, generate the shot, place the job in that position, and
remove the placeholder. A placeholder is never a clip and never becomes one on its own.

Every shot in every template is six seconds, because six is the cheapest length the
working video models render and one of them renders only six and ten. That is a fact
about today, not a house style — the capabilities tool is what is true now.

## Review pass (mandatory)

From your working directory, before you tell the person it is done:

```
python3 "$(ls .claude/skills/video_storyboard/validate_scene.py \
              .harness/skills/video_storyboard/validate_scene.py 2>/dev/null | head -1)" \
        scene.excalidraw --expect-seconds <the total the storyboard promised>
```

Both paths are real — which one exists depends on which backend you are running on. The
directory is `video_storyboard`, with an underscore.

It reads the projection of the canvas and prints anything that will render wrong or
refuse to export: a shot still rendering, a shot that points at nothing, a trim past the
end of a clip, media stacked on media, a stored URL that will expire, a total that does
not match the plan. **Fix and re-run until it exits clean.**

Two things it cannot do, which are yours:

- **It cannot ask whether a job is real.** Only the job-checking tool knows that.
- **It may be reading a scene one turn old.** The describe tool is the authority; this
  is the lint. If the two disagree, the tool is right and the validator is the bug.

Then read the board as the person opening it:

- Does shot one make them want shot two?
- Is the same character the same person in every shot they are in?
- Does the total length match what you promised, and did anything get quietly dropped?
- Is there anything on this board you charged for and did not use?

Finish by telling them, in one line, what the film is, what it cost, and anything you
could not make and why.
