// The kit's own name, in one place: the route the console serves this app at, the `base` vite
// writes into every asset URL, and the `kit` field the gateway reports for the recruiter Harness
// this kit launched all have to agree, or the app cannot find its own backend. vite.config.js
// imports this file too, which is why it is plain data with no browser in it.
export const KIT_ID = 'workplace';
export const KIT_BASE = `/kits/${KIT_ID}/`;

/** The package every teammate carries. A Harness with it installed IS a teammate; nothing else is. */
export const TEAMMATE_PACKAGE = 'harnessrouter-workplace-teammate';
/** The teammate's profile (face, tagline, greeting), a file inside that package. */
export const TEAMMATE_FILE = 'teammate.json';

/** A group's whole state, in the group session's workspace on the recruiter Harness. */
export const GROUP_FILE = 'group.json';

/** Session titles the app recognises. A direct message is one session per person per teammate. */
export const DM_TITLE = 'Direct message';
export const GROUP_PREFIX = '#';

/** Group mechanics: how far a chain of teammates answering teammates may run from one human message. */
export const MAX_HOPS = 3;
/** The exact reply a teammate gives to stay quiet in a group. */
export const SKIP = '[skip]';
