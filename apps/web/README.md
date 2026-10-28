# Web storage and offline shell

Run `pnpm --filter @app/web dev` for development. Service workers are production-only. Build with
`pnpm --filter @app/web build`, which builds Start first and then Serwist, and preview with
`pnpm --filter @app/web preview`. Deploy through the package's `deploy` script so the service worker
is included. HTTPS or localhost is required for Web Locks, OPFS and service workers.

`src/data/database.worker.ts` installs SQLite's `opfs-sahpool` VFS and supplies `SQLiteConnection` to
`@app/client-data`. It keeps both database connections and one Effect service alive in that Worker.
The tab holding `anki-alarm:database:v1` owns the Worker. Followers send repository operations through
`anki-alarm:data:v1` on BroadcastChannel. Send whole commands, never individual SQL statements:
client-data's queue must own each transaction from beginning to end. New editor/sync operations
should extend the command union in `protocol.ts` and execute against this same service instance.

Operations are typed in `protocol.ts` (`Operations`: arguments and result) and run by
`operations.ts`, which the Worker and the screen tests share. A committed write, or a sync that
changed something, invalidates local queries in every tab. The Query cache is disposable and
uses `networkMode: "always"`. SQLite settings and their outbox records are the source of truth.
The previous localStorage theme migrates on first use; `theme-css` remains only a first-paint cache.
Closing or navigating away terminates the Worker before releasing the lock. A restored back/forward
cache page reloads to join the election again. A request interrupted by a leader crash fails after
20 seconds; mutations are never replayed automatically, because they may have committed.

Serwist precaches all emitted JS, CSS, WASM and fonts, plus the UI routes (`/`, `/settings/theme`,
`/study`) in Portuguese and English. Study takes its deck as `?deck=`, so one shell serves every
deck. Card media load from `/media/<name>`, which the service worker answers from OPFS `media/`
(filled by media sync, #53). Add new UI routes to both the shell entries in `vite.sw.config.ts` and the navigation
allowlist in `src/sw.ts`. API/authentication URLs and cross-origin responses have no runtime cache.
No in-memory database fallback hides a storage failure: the page shows a translated error instead.
Browser eviction or clearing site data removes local data.

## Sign-in and sync

`src/auth.ts` is better-auth's client against the sync Worker (`VITE_SYNC_URL`, see `src/env.ts`)
with `credentials: "include"`: Google's redirect, and the session cookie on the Worker's origin.
`src/sync.ts` runs client-data's `accountSync` (the phone's rules: first account merges, another
asks, sign-out keeps data) in each tab, on load, on window focus (throttled with Pacer), when the
browser comes back online and a few seconds after the tab's own writes. The sync itself is the
`sync` operation: the leader's Worker runs it with its own fetch, one at a time for all tabs.
Offline, the last signed-in user is shown from localStorage and sync reports no connection.

Install Chromium once with `pnpm --filter @app/web exec playwright install chromium`, then run
`pnpm --filter @app/web test:e2e`. These journeys build and serve the actual Cloudflare output,
exercise persistent SQLite without cross-origin isolation, share settings between tabs, close the
leader, reload offline with localStorage cleared, and verify that API responses stay uncached. They
also start the sync Worker in `wrangler dev` with dev sign-in, and a simulated phone (client-data on
Node's SQLite, `e2e/phone.ts`) for study, offline study and two-account journeys.
