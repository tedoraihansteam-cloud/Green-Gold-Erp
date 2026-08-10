# Green Gold ERP — Desktop Launcher

A one-click desktop wrapper: opens the ERP in a native window instead of
a browser tab, and can start the backend itself if it isn't already
running.

## What it actually does

1. Tries to connect to `http://localhost:4000` (checks a real
   database-backed endpoint, not just "is the server process up" -
   explained below).
2. If nothing answers, and this app is sitting inside the full project
   (next to `../src/server.js` - true when the whole repo is on one
   machine), it starts the backend itself and waits for it to come up.
3. Once connected, loads the real app. If it still can't connect after
   ~55 seconds, shows a plain-language error screen with troubleshooting
   steps and a Retry button - not a blank window or a stack trace.
4. When you close the window, if this app started the backend, it stops
   it too - no orphaned background process left running.

## Setup

```bash
cd electron
npm install
npm start
```

Requires the backend's database to already be reachable (either running
locally, or via `docker-compose up` in the project root - point
`GGERP_URL` at wherever Docker exposes it if not `localhost:4000`).

## Building an installer

```bash
npm run build
```

Produces an NSIS installer (Windows), DMG (Mac), or AppImage (Linux) in
`electron/dist/`, via electron-builder. This step itself hasn't been run
in the environment this was built in (no way to produce/verify
platform-specific installers without the target OS) - `npm start` has
been tested thoroughly (see below), but packaging into a distributable
installer is untested.

## What was actually tested, and how

This sandbox has no display, so nothing here was eyeballed by a human
clicking around. Instead: a temporary Electron instance was launched
headlessly under Xvfb (a virtual framebuffer), driven through the exact
same connection logic this app uses, and screenshots of the actual
rendered window were captured and inspected - as close to "someone looked
at it" as is possible without a screen. Three scenarios were run end to
end this way:

1. **Backend already running** → connects directly, renders the real
   login screen.
2. **Nothing running, database reachable** → detects the outage, spawns
   the backend itself, waits for it to come up, renders the login screen
   - a genuine cold start.
3. **Nothing running, database unreachable** → correctly shows the
   plain-language error screen instead of a broken app.

Two real bugs were caught and fixed by actually running these scenarios,
not just from reading the code:

- Spawning the backend used `process.execPath`, which inside an Electron
  process points to the Electron binary itself, not plain Node - without
  `ELECTRON_RUN_AS_NODE=1` in the spawned process's environment, this
  would have tried to open a second GUI window instead of running the
  backend as a script.
- The readiness check initially treated *any* HTTP response as "the app
  is ready," but Express responds immediately even when the database call
  inside a handler fails (with a 500) - so it would have reported "ready"
  and let the user into a broken app even with the database genuinely
  down. Fixed to check the actual status code from a database-backed
  endpoint (`/api/org/public-info`), not just "did something answer."

What this process still can't verify: real OS-level packaging (the
installer build), code signing, auto-update, or anything about how the
window actually feels to interact with (resizing, menus, keyboard
shortcuts) - that needs an actual human on an actual desktop.
