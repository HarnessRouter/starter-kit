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

The state is literal and the numbers in it come from the game: where Mario is, the nearest enemy
ahead and whether it walks toward him, the nearest enemy behind him, the next gap, wall and
question block with distances in tiles, and how far one step reaches. The things below were
measured on the live game and written into the environment rather than left to the model:

- **Jump heights.** Feet above the ground at the apex: a short hold reaches 3.1 tiles, a medium 3.9,
  a long 4.1, standing or at a run. So the state says which hold clears the wall ahead (short for
  2 tiles, medium for 3, long for 4), and when the model's hold is shorter than what lies ahead
  needs, the environment takes the needed one and says so in the result.
- **When to leave the ground.** A decision lands every half second and a jump is a one-tile affair.
  A wall 4 tiles tall is cleared by a long jump from 1.5 to 3 tiles back and from nowhere else; a
  running jump covers about 9 tiles, so a gap is left from its edge at speed; a question block is
  hit by a jump started 1 to 1.5 tiles before it at a run and missed from 2. So `jump_right` keeps
  running until the nearest thing ahead is at its distance, steps back first when there is no room
  for the run-up (and nothing behind), and waits for the landing when asked to jump mid-air.
- **Enemies.** A running jump over the first Goomba hit the block row above it and dropped Mario
  onto it, every life. An enemy walking toward Mario is instead let under a standing jump taken
  when it is about one tile away (six of six tries between 0.8 and 1.2 tiles), and `run_right`
  stops five tiles short of an enemy walking at him so that jump is taken standing. An enemy
  below him, when he stands on a pipe, is waited out rather than jumped onto.

The model decides to jump; the timing is the environment's, the way holding the keys is. Heights
are measured from where Mario stands (his feet on the ground, the level he last stood on in the
air), so a jump does not shrink the wall ahead and a stair step is one tile tall from the step
below it.

On the model's own runs after these changes (Jev 1.13 through OpenRouter, 400 steps): all four
pipes of the first level are cleared, the question blocks pay (10 coins and a score of 17,300 in
one 119-action run), the run moves at about two seconds an action, and the furthest point reached
is about half the level. The level is not won yet: the lives go to the Goomba pair pacing around
the third and fourth pipes, to the landing beyond the 3-tile gap where a Goomba waits, and to a
pair near the middle of the level. Each of those is a state question, not a model question, and
each earlier death class was removed the same way: read the trace, measure the game, write the
fact into the environment.

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
