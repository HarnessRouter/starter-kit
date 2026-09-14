# The storyboard format

Read this before you write the shot list. It is the cheapest artefact in the whole job
— text in a message — and it is the only place a change is free.

## Where it goes

**In the conversation.** Not on the canvas, not in a file. The person reads it in ten
seconds and says yes, no, or "make shot three longer". Then you spend money.

## The shape

```
<N> shots, <total> seconds, <aspect>. About $<cost> at today's model.

1. (6s) [no character] <what is in frame> — <the action> — <the mood>
2. (6s) [character: Mara] <what is in frame> — <the action> — <the mood>
…

Style: <one line, repeated verbatim into every prompt>
Palette: <one line, repeated verbatim into every prompt>
```

Five parts, and each one is load-bearing.

### The header line

Shot count, total length, aspect, and a cost. The cost comes from the capabilities
tool, which reports a measured price per unit for the models where a price was actually
measured. Where it was not measured, say nothing rather than guessing — a made-up
estimate is worse than no estimate the moment it is wrong.

### A length on every shot

A length is a price. It is also required by the tool: there is no default duration and
one of the models bills fifteen seconds when nothing says otherwise.

Check the capabilities tool before promising a length. Today's models are not the same
as last week's, and at least one of them renders **only** 6 s and 10 s — a storyboard
full of 8-second shots is a storyboard that cannot be made.

Six seconds is the useful default: it is the cheapest length every working model
renders, and it is long enough for one action.

### A cast tag on every shot

`[no character]` or `[character: <name>]`. Nothing else.

This tag is not decoration — it selects how the shot is made. A `[character: …]` shot
is generated *from that character's image*, and a `[no character]` shot is generated
from text. Getting it wrong is the continuity failure described in
`continuity.md`, and it is invisible until the whole film is watched end to end.

If two shots name the same character, they must be the same person. If they name
different characters, you now have two characters to establish and thirty seconds is
probably not enough for both — say so.

### What is in frame, the action, the mood

One shot, not a script. A shot is one thing happening from one camera position.

Good:

> (6s) [no character] A hand lifts the product from a plain desk in daylight, window
> light from the left. The hand is the only part of the person in frame.

Bad:

> (6s) The product is revealed, then the user picks it up and starts using it while
> the camera circles, and then we see the logo.

The second one is four shots. A model given four shots' worth of instruction in six
seconds returns a smeared version of one of them.

Say what the camera does, or say that it does nothing. "Static", "slow push in", "held
still" are all instructions; the absence of any is not.

### Style and Palette, as two global lines

Two lines at the bottom, and both are appended **verbatim** to every image and clip
prompt you send.

```
Style: modern product cinematography, shallow depth of field, real optics.
Palette: cool graphite and off-white, one warm accent.
```

*How this fails silently:* six shots each described beautifully, each generated from its
own paragraph, come back as six films. Nothing is wrong with any of them. Nothing cuts
together either. Style drift is not visible shot by shot, which is exactly why it needs
a mechanical fix rather than care.

## A worked example

> Six shots, 36 seconds, 16:9. About $1.70 at today's model.
>
> 1. (6s) [no character] The kettle alone in near-darkness, turning a few degrees as a
>    single rim light finds its edge. Nothing else in frame. Slow, deliberate.
> 2. (6s) [no character] Macro on the brushed steel seam where the handle meets the
>    body. Very slow push in, shallow focus.
> 3. (6s) [character: Mara] Mara lifts it from a plain kitchen counter in morning
>    light, window to the left. Three-quarter back, her face not yet visible.
> 4. (6s) [no character] Water hitting the base, steam starting. Straight on, static,
>    no camera move.
> 5. (6s) [character: Mara] Mara looks up from the counter, pleased rather than
>    delighted. Background thrown out of focus. Held still.
> 6. (6s) [no character] The kettle centred on a plain field as light spreads behind
>    it, then stillness. Room at the centre for the logo to be added afterwards.
>
> Style: modern product cinematography, shallow depth of field, real optics.
> Palette: cool graphite and off-white, one warm morning accent.
>
> Shots 3 and 5 are the same person, so I will generate Mara once and show you before
> anything else is made. Shot 6 leaves space for your mark rather than generating one —
> a model asked for a specific logo produces something close enough to be embarrassing.

Notice what that last paragraph does. It tells them what is about to be spent, in what
order, and it names the one thing the tool cannot do before they find out on delivery.

## After the yes

The storyboard is now the plan of record. Two things follow from that:

- **The total in the header is what you check the export against.** The validator takes
  it as `--expect-seconds`, and the export refuses if the assembled film drifts more
  than half a second from it. If a shot came back at a length you did not ask for, that
  is where it surfaces.
- **A change to the plan is a change to the conversation.** If a shot turns out to be
  impossible — the capability is down, the model will not render that length — say so
  and re-agree it. Do not silently substitute a different shot, because the storyboard
  is the thing they said yes to.
