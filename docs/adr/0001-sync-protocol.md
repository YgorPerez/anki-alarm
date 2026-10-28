# Sync protocol

The phone, the web and the Worker sync by push and pull against a per-user server sequence. Notes
and settings merge field by field, last-write-wins by hybrid logical clock (HLC). Reviews are
append-only and never conflict. We chose this over timestamps and whole-record LWW because phone
clocks are often wrong, the phone works offline for long stretches, and two devices editing
different fields of the same note should both keep their edit. Decided in #29.

## Ids

- Every record has a UUIDv7 primary key. Anki and AnkiDroid ids and the note guid are kept as plain
  columns, for linking, matching and export.
- A card's id is UUIDv5(note id, ordinal), so two devices that add the same template or cloze number
  offline produce the same card instead of a duplicate.
- Imported records take UUIDv5 ids from their Anki identity: note from guid, note type from Anki
  note type id, deck from Anki deck id, imported review from revlog id. Anki's "Default" deck has
  id 1 in every collection, so it takes its id from the deck name instead. The same `.apkg` imported
  on two devices gives the same ids, so merging is a plain union with no folding of duplicates, and
  re-importing never duplicates reviews. Records created in the app stay UUIDv7.
- D1 keys every table by (user id, id). Two users importing the same shared deck get the same ids
  without clashing.

## Cursor

The user row in D1 holds a monotonic sequence. Every write the Worker accepts gets the next number.
A client stores the highest number it has pulled and asks for everything above it. This doesn't
depend on any clock and can't skip a write that commits late. One sync is push, then pull.

## Conflicts

- Each note field, and each property of decks, deck options, note types and alarms, carries its own
  HLC (wall ms, counter, device id). The newer HLC wins, and the device id breaks ties.
- The Worker resolves on push with the same Core merge function the clients use, stores the winner
  with a new sequence number, and pull returns merged rows. The server is the single source of truth.
- Reviews never conflict. Undo appends a **void** that points at the review, and replay skips voided
  reviews. Nothing in the log is ever edited or removed.

## Deletes

- A delete writes a tombstone (id, kind, sequence, HLC). Tombstones are kept forever: they are tiny,
  and a phone offline for months still learns every delete without a "too stale, resync" path.
- A delete beats any edit, even one with a newer HLC. A deleted record never comes back.
- A deleted card's reviews stay in the log, as Anki keeps revlog, so history and wake-up stats don't
  change after a delete.

## Media

- Files live in R2, keyed by SHA-256, stored once across all users. The Worker serves a file only to
  a user who has a note referencing it.
- A client uploads missing files before it pushes the records that reference them, so the server
  never holds a record pointing at a missing file. A failed upload holds back only those records.
- Nothing is garbage-collected in the first release.

## Imports and linked decks

- Re-importing an `.apkg` finds existing notes by their guid-derived id. Per field, the newer of the
  local HLC and the note's Anki mod time wins, so shared-deck fixes arrive and newer local edits
  stay.
- A linked deck records the phone that linked it. Only that phone pulls from AnkiDroid and syncs
  back. Everywhere else it is a normal deck. Sync back sends every review since its last run, from
  any origin, so web reviews reach AnkiDroid too.

## Accounts and timing

- The first sign-in on a phone with local data merges: push local, pull the account. Sign-out keeps
  local data and the app keeps working offline. Signing in to a different account than last time
  asks first: merge into it, or cancel.
- A signed-in client syncs on app open and resume, a few seconds after local writes (debounced),
  after each alarm session and on pull-to-refresh. The web also syncs on window focus. The phone does
  no background sync.

## Considered options

- **Anki int64 ids as primary keys.** Easy export, but devices can mint colliding ids, and the code
  would carry two id kinds.
- **Timestamp cursor, wall-clock LWW.** Simpler, but skewed or late-arriving clocks skip writes or
  pick the wrong winner without anyone noticing.
- **Folding duplicate imports by guid at merge.** It needs re-pointing cards and reviews. Deterministic
  import ids make it unnecessary.
- **Pruning tombstones after 90 days.** Bounded storage, at the cost of a full-resync path. Not worth
  it at friends scale.
