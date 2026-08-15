// The kit's own name, in one place.
//
// Four things have to agree about it or the app is subtly broken in ways that do not fail the
// build: the route the console serves this app at, the `base` vite writes into every asset URL,
// the folder Excalidraw resolves its fonts against, and the `kit` field the gateway reports for
// the harness this kit launched (which is how the app finds its own backend at all — a mismatch
// there shows "hasn't been launched yet" forever, on a kit that is running).
//
// So they read it from here. vite.config.js imports this file too, which is the only reason it is
// plain data with no browser in it.
export const KIT_ID = 'video';

/** Where the console serves this app. Vite's `base`, and Excalidraw's asset root. */
export const KIT_BASE = `/kits/${KIT_ID}/`;

// The MCP entry this kit's launch provisions — the media server the gateway hosts. The kit
// declares it in kit.json (`harness.launch.media.id`); the app needs it because every media route
// is addressed by (harness, entry, session). It is a constant rather than something discovered at
// runtime: there is exactly one media server per harness and the kit manifest names it.
export const MEDIA_ENTRY_ID = 'mcp.media';

/** The document in a session's workspace. One session is one video. */
export const SCENE_FILE = 'scene.excalidraw';
