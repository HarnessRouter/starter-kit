# Super Mario kit

A System One model plays a platform game, several decisions a second, and you watch the browser
it plays in.

## How it is put together

- **The harness** is a fork of the `systemone` base (the open-source
  [System One Harness](https://github.com/HarnessRouter/SystemOneHarness)) with this kit's
  instructions and one plugin. The base is general and knows nothing about this game; everything
  about the game lives in the plugin, which is what a fork of a base is for.
- **The plugin** (`plugin/`) ships an MCP server, `bin/mario-env`, that is the environment: it
  opens the game in a headless Chromium inside the deployment, reads the game's own state each step
  and says it as short literal sentences (where Mario is, whether he is on the ground, the nearest
  enemy, gap and wall with distances in tiles, and which hold clears the wall), and acts by holding
  the keys the game listens to (`run_right`, `jump_right`, `jump`, `walk_left`, `wait`, each with a
  hold length). The model never sees a pixel and never writes text; it chooses.
- **The page** (`app/`) is the same shape as the other kits: the stage on the left streams the
  browser the model is playing in, and the conversation on the right is the run itself, every
  decision with the game's reply, in the shared chat column the other kits mount. Play starts a
  run with the default goal; the composer takes any other. The app bar has the way back to
  HarnessRouter.

### The frame

The environment turns on the browser's own screencast and writes every third frame the game
draws to `frame.jpg` in the session's workspace, about twenty a second at 7 KB each. The page reads
that file through the session's live workspace, a few requests in flight at a time, shows a frame
once it has decoded and drops any that arrives after a newer one. The rate the page shows is the
rate of frames it actually displayed.

### What is measured, not tuned

The state is literal and the numbers in it come from the game: where Mario is and whether he is
on the ground, the ground ahead as a profile (the next gap, the next drop and what follows it, the
next step or wall and its height), the nearest enemy ahead and whether it walks toward him, the
nearest enemy behind him, the block rows overhead, the next question block, how far one decision
carries him at the loop's own measured pace, and a closing line beginning "Now:" that says what the
measured facts call for at this moment. The environment executes key states and times nothing:
an action sets the keys and returns, the keys stay set until the next action, and the model
chooses every step. Two things about the keys are the input layer's, the way a thumb plays:

- **A jump means a press.** `jump_right` or `jump` on the ground with the jump key still held from
  the last jump lets it go and presses it again; the game wants the release.
- **A jump held in the air goes again on landing.** `jump_right` chosen while Mario is in the air
  keeps the key down and presses it the moment he lands (any later action cancels it), so hops
  chain the way they do under a held button. Recorded nine times in a row before this: the jump
  over the fourth pipe comes down a tile before the first gap, and no decision could arrive in
  time; the hop is now chosen in the air.

The facts the "Now:" line and the kit's instructions carry were measured on the live game, not
tuned: a running jump started 1.5 to 4 tiles before the first Goomba survives, 5 to 9 tiles hits
the block row and drops onto it, so when that window cannot be hit at the loop's pace the stop and
the standing jump (1 to 2.5 tiles, eight of eight) take over; a 4-tile pipe is cleared only at a
full run with the jump held long, taken 2 to 3 tiles before it; a gap or a drop is left from its
edge; a one-tile step is a hop and a stair is a hop per step; the ground is read from Mario's level
rather than his feet, so the floor is still there when he is below its top (read from his feet it
vanished, and three lives went to a "gap 12 tiles wide"); and the nearest thing ahead decides (a
gap five tiles on outranked the one-tile step he was pressed against for 284 decisions, until the
clock ran out). Each of these came from a recording: a copy of every frame the page shows, cut into
a contact sheet around each death, read, then measured with a probe before the environment changed.

A player that obeys the state's own "Now:" line with a model-like delay of 0.2 s is the
environment's test bench, apart from any model: on the level's current environment it clears 1-1
in 50 game seconds with one death (2026-09-20). The model's own runs are recorded the same way.

### Launching again after an update

A launch captures the kit's package onto the harness. A kit updated afterwards (a new image)
leaves the harness on the old package until something launches it again, so the page compares
the package version it was built with against the harness and relaunches it in place when they
differ. The base declares no built-in tools: its actions are the environment's, so the harness
settings list none.

## Credits

- The game is **Full Screen Mario**, played at [supermarioplay.com](https://supermarioplay.com/game/mario.html?v=1.0.1).
  Mario and its characters belong to Nintendo; this kit plays the page as a person would and ships
  none of the game's files.
- The browser is driven with [Browser Use](https://github.com/browser-use/browser-use) (MIT) over the
  Chrome DevTools Protocol.
- The model is [Jev](https://typesafe.ai) by TypeSafe, a System One model, reached through OpenRouter.

## Running it

Launch the kit from Starter Kits with an OpenRouter key connected. The first launch on a fresh
install adds a Chromium beside the System One base (about a minute). Then press Play.

## Developing the page

```
cd kits/mario/app
npm install
npm run dev        # against a console at the same origin, or set a proxy for /api and /kits
npm run build      # what the image serves at /kits/mario
```
