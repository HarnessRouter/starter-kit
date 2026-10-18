# Remote mode (for kit maintainers)

A kit app normally runs inside the HarnessRouter console at `/kits/<kit>`. There the console signs
people in, and its `/api/harness` proxy adds the key. Remote mode runs the same built app on its
owner's own hosting. Three server pieces stand in for the console:

| Piece | File in the kit app | What it does |
|---|---|---|
| The gate | `middleware.js` | Serves nothing but the sign-in page without the kit's password |
| Sign-in | `api/kit/login.js`, `logout.js`, `session.js` | Password in, a 12-hour signed cookie out; the session answer the app already asks the console for |
| The route | `api/harness/[...path].js` | Forwards only the kit's allowlist to HarnessRouter, adds the key, and pins the kit's Harness |

All of them call `core.js`. The app's own code does not change: `vercel.json` maps the paths the app
already uses.

## Files

- `core.js`: the gate, sign-in and the route, on Web standard Request/Response and WebCrypto.
- `setup.mjs`: the owner's one-time setup. It checks the key, requires spending caps, and generates
  the password and the cookie secret.
- `check-bundle.mjs`: run after the build. It refuses output that carries a secret.
- `dev-server.mjs`: the same behaviour on your own machine.
- `sync.mjs`: copies the files above into every kit app that has an `app/remote/allow.js`. Each app
  deploys from its own folder, so each app carries a copy. `npm test` fails when a copy is stale.
- `core.test.mjs`: the tests (`npm run test:remote`).

## Adding remote mode to a kit

1. List every call the app makes in `kits/<kit>/app/remote/allow.js`: the method and the path after
   `/api/harness/v1`. Anything not listed answers 404 in remote mode.
2. Copy `middleware.js`, `api/` and `vercel.json` from the Slides app, and change the kit's path in
   `vercel.json`.
3. Run `node remote/sync.mjs`, then add `@vercel/functions` and the three `remote:*` scripts to the
   app's `package.json`.
4. Build the app, run `npm run remote:dev` against a HarnessRouter instance, and use it in a browser:
   sign in, run a task, and read its result.
