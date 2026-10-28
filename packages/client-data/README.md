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

Sync transport, server cursors, outbox acknowledgement and initial upload of records that predate
the outbox belong to #52. Alarm records retain #40's shape; sync must add per-property HLCs before
merging alarms. Native journal events remain device-local and are not queued as alarm edits.
A collection command still reads the whole collection into Core, but only the records it changed
are written, in batches, with their outbox entries. `importAnki` merges an Anki package that Core
has read and appends its review log in the same transaction; the app stores the media files
first. Reads pass stored records through Core's `upgradeCollection`, so Basic notes saved before
#49 (with `front` and `back` properties) come back in the current shape. The package contains no
Expo or React Native imports.
