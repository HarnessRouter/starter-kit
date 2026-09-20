# Super Mario kit

A System One model plays a platform game, several decisions a second, and you watch the browser
it plays in.

## How it is put together

- **The harness** is a fork of the `systemone` base (the open-source
  [System One Harness](https://github.com/HarnessRouter/SystemOneHarness)) with this kit's
  instructions and one plugin.
- **The plugin** (`plugin/`) ships an MCP server, `bin/mario-env`, that is the environment: it
  opens the game in a headless Chromium inside the deployment, reads the game's own state each step
  and says it as short literal sentences (where Mario is, whether he is on the ground, the nearest
  enemy, gap and wall with distances in tiles), and acts by holding the keys the game listens to
  (`run_right`, `jump_right`, `jump`, `walk_left`, `wait`, each with a hold length). The model never
  sees a pixel and never writes text; it chooses.
- **The page** (`app/`) shows `frame.jpg`, which the environment writes into the session's
  workspace on every step, so the left pane is the model's own game, not a copy. The right pane
  starts a run, streams every action with the game's reply and the step's latency, and can stop or
  continue it.

The base is general and knows nothing about this game; everything about the game lives in this
kit's plugin, which is what a fork of a base is for.

## Credits

- The game is **Full Screen Mario**, played at [supermarioplay.com](https://supermarioplay.com/game/mario.html?v=1.0.1).
  Mario and its characters belong to Nintendo; this kit plays the page as a person would and ships
  none of the game's files.
- The browser is driven with [Browser Use](https://github.com/browser-use/browser-use) (MIT) over the
  Chrome DevTools Protocol.
- The model is [Jev](https://typesafe.ai) by TypeSafe, a System One model, reached through OpenRouter.

## Running it

Launch the kit from Starter Kits with an OpenRouter key connected. The first launch on a fresh
install adds a Chromium beside the System One base (about a minute). Then press Start.
