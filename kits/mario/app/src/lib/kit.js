// The kit's own name, in one place: the route the console serves this app at, the `base` vite
// writes into every asset URL, and the `kit` field the gateway reports for the harness this kit
// launched all have to agree, or the app cannot find its own backend.
export const KIT_ID = 'mario';

/** Where the console serves this app. Vite's `base`. */
export const KIT_BASE = `/kits/${KIT_ID}/`;

/** The console this app was opened from; the way back. */
export const CONSOLE_HOME = '/';
export const CONSOLE_KITS = '/kits';

/** The frame the environment writes into the session's workspace, about twenty times a second. */
export const FRAME_FILE = 'frame.jpg';

/** The first message of a run when it is started with the Play button. */
export const DEFAULT_GOAL = 'Play the level: keep running right, jump over enemies, gaps and pipes, and get as far as you can.';
