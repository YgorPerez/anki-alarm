# Shared client data and an offline web

The phone and the web keep their data in a local SQLite database with the same drizzle schema, and
sync through the same outbox and push/pull engine, in `packages/client-data`. The web studies and
edits offline like the phone. We chose this over a web that reads a persisted TanStack Query cache
and queues writes in IndexedDB, because that is a second source of truth to keep in step with the
first, and the sync engine would be written twice. Decided in the 2026-10-28 stack grilling.

## The package

- `packages/client-data` holds the drizzle schema and migrations, the outbox, and the push/pull
  engine of ADR 0001, as Effect services. The rules stay in Core: merge, replay, card picking.
- The SQLite driver is a layer the app provides: expo-sqlite on the phone, sqlite-wasm on the web.
- It talks to the Worker through the client derived from `packages/contracts` (Effect HttpApi).
- TanStack Query reads from local SQLite in both apps. There is no persisted Query cache and no
  IndexedDB queue.

## The web

- sqlite-wasm runs in a Web Worker on OPFS (the `opfs-sahpool` VFS, which needs no cross-origin
  isolation headers).
- OPFS takes one connection at a time. With several tabs open, Web Locks elect one leader tab that
  owns the database; the others send their queries to it over a BroadcastChannel. When the leader
  closes, another tab takes the lock and opens the database.
- Media of every deck is copied to OPFS on sync, as on the phone, so an offline session shows every
  card. When the browser refuses storage, the UI says so.
- Serwist caches the app shell so the web opens offline. It never caches the sync API.

## Considered options

- **Persisted Query cache plus an IndexedDB outbox.** Lighter on the web, but two stores to keep in
  step, and Core's replay needs the whole log locally anyway.
- **Media on demand.** Less storage, but a card never seen online shows broken media offline.
- **One tab only.** Much simpler, but a second tab would show "open in another tab".
