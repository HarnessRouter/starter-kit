# Continuity

The failure this file exists to prevent: **every shot is right and the film is wrong.**

Nobody catches it in review, because review looks at shots. Everybody catches it on
delivery, because delivery is watching it end to end. By then it has been paid for.

## The rule

**Anything that appears in more than one shot is generated once and reused.**

A face, a product, a room, a jacket. Generate it as a still, show it, get a yes, and
make every shot it appears in *from that image*.

The generate tools take an earlier media or job id for this — an image made from an
image, and a clip made from an image. Read your tool list for the exact parameter; the
capabilities tool says which model is serving that today and whether it is available at
all.

## Why text will not do it

A person described in words is a *distribution*, not a person. "A woman in her thirties
with dark hair, warm expression, grey jacket" matches millions of faces, and the model
draws a different one from that set every time you ask. There is no prompt precise
enough to collapse it. Adding detail narrows the distribution and never closes it.

This is why the rule is mechanical rather than a matter of care. Care produces "I wrote
a very detailed description and used it consistently", which does not work.

## The order of operations

```
1. character still            → place it, show it, WAIT for a yes
2. every [character: …] shot  → image FROM that still, then clip FROM that image
3. every [no character] shot  → straight to a clip, from text
```

Two things about step 1:

- **It is one image, and it is cheap.** Seconds and cents against four minutes and
  dollars for a clip. There is no version of this where generating the character first
  is not worth it.
- **If the person said "this character" and no image exists, stop and ask.** Do not
  invent a lead. Once four shots have been made with an invented face, changing it costs
  four renders.

## Which shots need it

Read the cast tag on each shot in the storyboard.

| Tag | How the shot is made |
|---|---|
| `[character: Mara]` | from Mara's image — always, no exceptions |
| `[no character]` | from text |

A shot with a hand in it is a character shot if that hand belongs to someone who is
also seen later. A shot of the product is a character shot if the product must look
like the same product — which it must.

## When the image-input capability is down

Only some of the video models accept an input image, and on a bad day none of them do.
When that happens the tool **refuses**. It does not fall back to text.

That refusal is correct and you must not route around it, because a text-only render of
a `[character: …]` shot produces a different person and *looks like it worked*. There is
no error, no warning, and no way for the person to know without watching for it.

What to do instead:

- Say the capability is down and which shots depend on it.
- Offer the film without those shots, or offer to hold them until it is back — the jobs
  and the canvas survive the conversation, so "we will finish it later" is a real
  option here.
- Ask them to connect a provider that can do it, if they want it today. That is theirs
  to do; you cannot connect one.

## The other four continuities

Character is the one that ruins films, but these ruin shots:

**Style.** The `Style:` line from the storyboard is appended verbatim to every prompt.
Not paraphrased per shot. Six well-written but independent prompts return six films.

**Palette.** Same treatment, same line, every prompt. Colour drift between adjacent
shots reads as a mistake even to people who cannot say what changed.

**Light.** Say where the light comes from and keep it there — "window light from the
left" in shot 3 and shot 5, or the person appears to have moved rooms. If two shots are
deliberately the same frame at different times (the explainer template does this), keep
the angle and the light *identical* and let only the subject change; that repetition is
the whole argument of the film.

**Aspect.** One aspect for the whole film, decided before the first generation. A stray
shot in the wrong aspect is letterboxed into black bars, and the model will happily
return a wide frame for a vertical film if nothing in the prompt says otherwise. Say
"vertical", "portrait framing", "subject in the middle third" in every prompt for a
vertical film, and check the first clip's real dimensions when it lands.

## Checking it

The validator warns when a shot's real dimensions do not match the timeline's aspect,
which catches the fourth one. It cannot see a face.

So look at the board before you call it done. Place the shots in cut order, arrange
them, and read across:

- Is the person in shot 2 the person in shot 5?
- Does the light come from the same side?
- Do two adjacent shots sit next to each other without one of them looking like it came
  from a different production?

If a shot fails that, it is one re-render, not a re-write — generate that shot again
from the character still and place the new job in the same position.
