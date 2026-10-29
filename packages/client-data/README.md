# Client data

Provide `SQLiteDriver` to `ClientDataLive`, or use `clientDataLayer(driver)`. Keep one resulting
`ClientData` service for the app's lifetime. The driver returns positional rows, as drizzle's
SQLite proxy expects. The app owns its connections and closes them when it shuts down.

The service serializes reads and writes. Collection commands call Core; settings commands use
Core's per-field HLCs. Each local mutation and its outbox entry commit in the same transaction.
Native alarm journal ingest is idempotent; acknowledge native events only after it succeeds.
TanStack Query reads these services; invalidate the corresponding query after a successful write.
Use `networkMode: "always"` for local reads. Do not persist the Query cache.

The existing `collection.db` and `anki-alarm.db` files and numbered migrations are preserved.
`pendingChanges` identifies entries by `(database, sequence)`; a sequence is local to its file,
not the server's sync cursor. Collection entries contain only changed records, including permanent
tombstones. The first settings record has a UUIDv7 id and one HLC per theme color.

Native journal events remain device-local and are not queued as alarm edits. A collection command
still reads the whole collection into Core, but only the records it changed are written, in
batches, with their outbox entries. `importAnki` merges an Anki package that Core has read and
appends its review log in the same transaction; the app stores the media files first.
`linkAnkiDroidDeck` does the same for a deck read from AnkiDroid and its snapshots. Reads pass
stored records through Core's `parseCollection`, so records saved by earlier versions (Basic notes
with `front` and `back`, single-template note types, presets without FSRS weights) come back in the
current shape. The package contains no Expo or React Native imports.

## Sync

`sync(client)` runs one sync with the contract's derived client: metadata (protocol and account
check), a push of the outbox (latest body per record, in batches of `MAX_CHANGES`), then pulls from
the stored cursor until the Worker reports no more. Pushed outbox entries are deleted only after
every batch was accepted, so a failed push is retried whole; the Worker's merge makes that
harmless. Each pulled page commits with its cursor; alarm changes commit first in `anki-alarm.db`.
Pulled changes are merged with Core's `resolveChange` and never re-enter the outbox.

`adoptAccount(userId)` makes an account this device's (first sign-in, or the user agreed to merge
into a different one): it resets the cursor and queues a full upload of every local record, which
covers records from before the outbox. Use Core's `signInPlan(syncAccount, userId)` to decide
whether to ask first. `sync` fails with `UpdateRequired` on a protocol mismatch and with
`AccountMismatch` when the session isn't the adopted account; it pushes nothing in both cases.
`subscribe` fires after each committed local write, for a debounced sync. Settings merge into the
device's single settings record whatever id the account's record has. Alarms sync as
`alarm_records` (one HLC per property); `alarms` keeps the shape native reads.
Native journal events stay device-local and never sync.

## Media

Pass the app's media files as the second argument: `clientDataLayer(driver, media)`. The phone
gives its `Paths.document/media` folder (`apps/mobile/src/media.ts`), the web gives OPFS through
`opfsMediaFiles()` from `@app/client-data/web`; without one, files stay in memory (tests). Files
are kept by name, as fields reference them. `storeMedia(files)` writes each file and records its
SHA-256 in a media record (synced, one slot per name, from Core's `stampMedia`) and in the local
`media_local` table; store media before the records that use it. The same bytes again queue
nothing.

Each sync asks the Worker which of the pushed media records' files it lacks, uploads those, and
then pushes. When an upload fails, Core's `mediaPushPlan` holds back that media record, the notes
that reference its name and their cards: they stay in the outbox (after a full upload they are
queued again) and the rest is pushed. After the pull, every file a note references whose local
copy is absent or stale is downloaded and checked against its hash. `SyncResult.media` says how
many files moved, how many changes were held back, how many files are still missing, and whether
the device refused storage (`MediaStorageRefused`: the web's OPFS full, private or absent, the
phone's disk full), which the UI should say. `missingMedia` lists the files still missing. Nothing
is garbage-collected.
