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

The state is literal and the numbers in it come from the game. Two things were measured on the live
game and are written into the environment rather than left to the model:

- **Jump heights.** Feet above the ground at the apex: a short hold reaches 3.1 tiles, a medium 3.9,
  a long 4.1, standing or at a run. So the state says which hold clears the wall ahead: short for
  2 tiles, medium for 3, long for 4.
- **When to leave the ground.** A decision lands every half second and a jump is a one-tile affair.
  A wall 4 tiles tall is cleared by a long jump from 1.5 to 3 tiles back and from nowhere else:
  from against it the apex is level with the top, and at a run from 4 tiles back the jump peaks
  early and hits the side. A running jump covers about 9 tiles, so an enemy jumped from 4 tiles is
  landed well past, and one jumped from 2 at a run is hit on take-off. The `jump_right` macro
  therefore keeps running until the nearest thing ahead is at its distance, steps back first when
  pressed against a tall wall, and waits for the landing when asked to jump mid-air. The model
  decides to jump; the timing is the environment's, the way holding the keys is.

On the model's own runs after these changes (Jev 1.13 through OpenRouter, 120 steps), all four
pipes of the first level are cleared, three times in a row across restarts; before them a run
stood against the first tall pipe for forty steps because the detector had dropped a pipe Mario
overlapped by a tenth of a tile.

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
