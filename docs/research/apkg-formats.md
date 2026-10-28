# .apkg formats and how to parse them

Research for ticket #5. Sources are pinned to:

- Anki `26.09.3` (`29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba`), shortened below as **A** =
  `https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba`
- Anki `2.1.49` (`dc80804af6a2dfd6900fb61f30fbe63b9f767311`), the last Python exporter, as **A49**
- Anki manual `91f7485236db2a89d2a8abaed618976caf971de2`, as **M** =
  `https://github.com/ankitects/anki-manual/blob/91f7485236db2a89d2a8abaed618976caf971de2`
- AnkiDroid `v2.25.3` (`d9bf072f814a0c37d30a694192593b31ff2df875`), as **AD** =
  `https://github.com/ankidroid/Anki-Android/blob/d9bf072f814a0c37d30a694192593b31ff2df875`

## Answer

**Read three package shapes.** An `.apkg` is a zip. Which collection file to read follows from
the `meta` entry, or from the file names when `meta` is missing:

| Package          | `meta`                    | Collection file                     | SQLite schema | Media map                          | Compression                            |
| ---------------- | ------------------------- | ----------------------------------- | ------------- | ---------------------------------- | -------------------------------------- |
| Legacy 1         | absent (or `version=1`)   | `collection.anki2`                  | 11            | JSON `{"0":"a.jpg",...}`           | none                                   |
| Legacy 2         | absent (or `version=2`)   | `collection.anki21`                 | 11            | JSON                               | none                                   |
| Latest (2.1.50+) | protobuf, `version=3`     | `collection.anki21b`                | 18            | protobuf `MediaEntries`            | zstd on collection, map and each file  |

Anki desktop and AnkiDroid write Latest by default and Legacy 2 when "Support older Anki versions"
is ticked. Both also put a dummy `collection.anki2` in every package so that old clients show a
"this file requires a newer version" note instead of reading the real one.

**Write Legacy 2:** `meta` (bytes `08 02`), `collection.anki21` at schema 11, a JSON `media` map,
and media files named `0`, `1`, ... with no compression. Current Anki and AnkiDroid read it through
the same Rust importer they use for Latest. It keeps every FSRS field: the deck config JSON holds
`fsrsParams6`/`fsrsParams5`/`fsrsWeights` and `desiredRetention`, the deck JSON holds the per-deck
`desiredRetention`, and `cards.data` holds the memory state. It needs no zstd encoder, no protobuf
encoder and no custom `unicase` SQLite collation. Writing schema 18 needs all three. Scheduling
only survives if the user ticks **Import any learning progress** (and **Import deck presets** for
the options) in Anki's import screen. Both are off by default.

**The split:**

- **App layer** (phone and web, thin): read the file bytes; unzip; zstd-decompress the
  collection, the media map and each media file when the package is Latest; open the collection
  bytes with expo-sqlite (phone) or sql.js (web); run the read-only `SELECT`s Core asks for; hand
  media bytes to storage. On export: create an empty SQLite DB, run the DDL and the row inserts
  Core produces, close it with `journal_mode=DELETE`, then zip it with `meta`, `media` and the
  media files.
- **Core** (no dependencies): detect the package version from the entry names and the `meta`
  bytes; decode `meta`, the protobuf media map and the schema-18 config blobs with a small
  protobuf wire-format reader (varint, length-delimited and fixed32, packed or unpacked); parse
  the schema-11 JSON; turn rows into note types, notes, cards, decks, deck options, media
  references and imported reviews; check media file names. On export: produce the schema-11 DDL,
  the `col` row JSON, the table rows and the media map JSON.

Core needs the protobuf reader anyway. In schema 18 the note types (templates, CSS, cloze flag),
decks and deck options are stored as protobuf blobs, so the media map is not the only protobuf to
decode. Writing the reader in Core keeps one parser for both apps, as the spec asks. It is a small
piece of code.

## 1. The zip container

### `meta`

`meta` is a protobuf `PackageMetadata { Version version = 1 }`, with `LEGACY_1 = 1`,
`LEGACY_2 = 2` and `LATEST = 3`. LATEST "implies MediaEntry media map, and zstd compression"
([A/proto/anki/import_export.proto#L103-L116](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/proto/anki/import_export.proto#L103-L116)).

Reading ([A/rslib/src/import_export/package/meta.rs#L71-L95](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/meta.rs#L71-L95)):

- If `meta` exists, decode it. `VERSION_UNKNOWN` (0, which includes a future version this build
  doesn't know) fails with "too new".
- If `meta` is missing: Legacy 2 when `collection.anki21` exists, otherwise Legacy 1.

Version to file name and schema
([meta.rs#L23-L42](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/meta.rs#L23-L42)):
Legacy 1 is `collection.anki2`, Legacy 2 is `collection.anki21`, Latest is `collection.anki21b`.
Legacy packages are at schema 11 and Latest at schema 18. zstd is used if and only if the package
is not legacy, and the media map is a JSON hashmap if and only if it is legacy
([meta.rs#L107-L125](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/meta.rs#L107-L125)).

The rslib exporter always writes `meta`, legacy packages included: Legacy 2 from `new_legacy()`,
Latest from `new()`
([meta.rs#L56-L67](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/meta.rs#L56-L67),
[A/rslib/src/import_export/package/apkg/export.rs#L39-L43](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/apkg/export.rs#L39-L43)).
The encoded bytes are `08 01`, `08 02` or `08 03` (field 1, varint).

### Entry layout as written by Anki today

`export_collection` writes, in order
([A/rslib/src/import_export/package/colpkg/export.rs#L125-L147](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/colpkg/export.rs#L125-L147)):

1. `meta`, stored (no zip compression).
2. The collection. Latest: zstd-compressed and stored. Legacy: zip's default (deflate)
   ([#L157-L171](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/colpkg/export.rs#L157-L171)).
3. A dummy `collection.anki2` at schema 11 with one note saying the file needs a newer Anki
   ([#L173-L204](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/colpkg/export.rs#L173-L204)).
   Legacy 2 packages get it too: the code doesn't branch on the version here. A reader must not
   take `collection.anki2` as the real collection when `meta` or `collection.anki21` points
   elsewhere.
4. Media files named `0`, `1`, `2`, ... (the enumeration index), stored. In Latest each one is a
   zstd frame. Size and SHA-1 are those of the uncompressed bytes
   ([#L261-L281](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/colpkg/export.rs#L261-L281),
   [A/rslib/src/import_export/package/media.rs#L325-L349](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/media.rs#L325-L349)).
5. `media`, the media map, stored. In Latest the map is also zstd-compressed
   ([#L230-L259](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/colpkg/export.rs#L230-L259)).

The 2.1.49 Python exporter (the source of many shared decks still around) wrote
`collection.anki2` alone when the scheduler was v1 or scheduling was excluded. With the v2
scheduler and scheduling included, it wrote the dummy `collection.anki2` plus `collection.anki21`.
It wrote a JSON `media` map and raw media files named by index, with no `meta`
([A49/pylib/anki/exporting.py#L339-L387](https://github.com/ankitects/anki/blob/dc80804af6a2dfd6900fb61f30fbe63b9f767311/pylib/anki/exporting.py#L339-L387),
dummy at [#L394-L406](https://github.com/ankitects/anki/blob/dc80804af6a2dfd6900fb61f30fbe63b9f767311/pylib/anki/exporting.py#L394-L406)).
Today's `pylib` exporter is only a shim over the Rust one with `legacy=True`
([A/pylib/anki/exporting.py#L11-L28](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/pylib/anki/exporting.py#L11-L28)).

AnkiDroid exports through the same Rust backend, with a legacy checkbox
([AD/AnkiDroid/src/main/java/com/ichi2/anki/BackendExporting.kt#L15-L30](https://github.com/ankidroid/Anki-Android/blob/d9bf072f814a0c37d30a694192593b31ff2df875/AnkiDroid/src/main/java/com/ichi2/anki/BackendExporting.kt#L15-L30)).
It imports through the backend too, from Anki's shared import page
([AD/.../BackendImporting.kt#L19-L23](https://github.com/ankidroid/Anki-Android/blob/d9bf072f814a0c37d30a694192593b31ff2df875/AnkiDroid/src/main/java/com/ichi2/anki/BackendImporting.kt#L19-L23),
[AD/.../pages/PostRequestHandler.kt#L149](https://github.com/ankidroid/Anki-Android/blob/d9bf072f814a0c37d30a694192593b31ff2df875/AnkiDroid/src/main/java/com/ichi2/anki/pages/PostRequestHandler.kt#L149)).
On formats, AnkiDroid behaves like desktop.

### Media map

- **Legacy**: JSON object from the zip entry name to the file name, e.g. `{"0":"cat.jpg"}`. Keys
  are parsed as integers. The name is checked for safety and NFC-normalized
  ([media.rs#L81-L93](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/media.rs#L81-L93),
  [#L144-L165](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/media.rs#L144-L165)).
  Indices can have gaps
  ([import_export.proto#L124-L127](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/proto/anki/import_export.proto#L124-L127)).
- **Latest**: `MediaEntries { repeated MediaEntry entries = 1 }` with
  `MediaEntry { string name = 1; uint32 size = 2; bytes sha1 = 3; optional uint32 legacy_zip_filename = 255 }`
  ([import_export.proto#L118-L131](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/proto/anki/import_export.proto#L118-L131)).
  An entry's position in the list is its zip entry name. The SHA-1 must be 20 bytes and the name
  must already be safe and normalized, or the import fails as corrupt
  ([media.rs#L64-L79](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/media.rs#L64-L79),
  [#L185-L193](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/media.rs#L185-L193)).
- A missing `media` entry is read as an empty map, because old AnkiDroid builds wrote packages
  without one
  ([media.rs#L167-L183](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/media.rs#L167-L183)).
- Media files are zstd-decoded on import when the package is Latest
  ([media.rs#L123-L141](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/media.rs#L123-L141)).

## 2. Schema versions in the wild

- Anki opens schema 11 to 18, rejects 12 and 13 (pre-release layouts) and refuses anything newer
  ([A/rslib/src/storage/upgrades/mod.rs#L4-L9](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/upgrades/mod.rs#L4-L9),
  [A/rslib/src/storage/sqlite.rs#L485-L497](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/sqlite.rs#L485-L497)).
  The version is `col.ver`.
- Every export is downgraded to the version its package type declares: schema 11 for legacy, 18
  for Latest
  ([apkg/export.rs#L88-L96](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/apkg/export.rs#L88-L96),
  [upgrades/mod.rs#L52-L75](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/upgrades/mod.rs#L52-L75)).
  Expect 11 inside `.anki2`/`.anki21` and 18 inside `.anki21b`.
- What changed from 11 to 18:
  - 14 adds `deck_config`, `config` and `tags` tables
    ([schema14_upgrade.sql](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/upgrades/schema14_upgrade.sql#L1-L19)).
  - 15 adds `fields`, `templates`, `notetypes` and `decks`
    ([schema15_upgrade.sql](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/upgrades/schema15_upgrade.sql#L1-L43)).
  - 16 rewrites deck configs, 17 rebuilds `tags`, and 18 rebuilds `graves`
    ([upgrades/mod.rs#L31-L42](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/upgrades/mod.rs#L31-L42)).
  - `notes`, `cards` and `revlog` keep the schema-11 columns throughout
    ([A/rslib/src/storage/schema11.sql#L16-L61](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/schema11.sql#L16-L61)).
  - From 14 or 15 on, the matching `col` JSON columns (`conf`, `models`, `decks`, `dconf`, `tags`)
    are emptied to `''`
    ([A/rslib/src/storage/notetype/mod.rs#L372](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/notetype/mod.rs#L372),
    [config/mod.rs#L106-L118](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/config/mod.rs#L106-L118)).
- **Rule for Core**: if a `notetypes` table exists, read the tables (schema 15+). Otherwise read
  the `col` JSON (schema 11).
- The scheduler version is the `schedVer` config key: in `col.conf` JSON at schema 11, in the
  `config` table later
  ([A/rslib/src/config/mod.rs#L72-L73](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/config/mod.rs#L72-L73)).
  Old Anki 2.0 and v1-scheduler decks have `schedVer` 1 or no key. Anki upgrades such a package
  to v2 on import when it includes scheduling
  ([apkg/import/mod.rs#L160-L176](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/apkg/import/mod.rs#L160-L176)).
  The revlog part of that upgrade is `ease = ease + 1 WHERE ease IN (2,3) AND type IN (0,2)`
  ([A/rslib/src/storage/revlog/v2_upgrade.sql](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/revlog/v2_upgrade.sql#L1-L4)).
  Core must apply the same remap before turning v1 revlog rows into grades.

### SQLite traps when opening the collection outside Anki

- **`unicase` collation.** Anki registers a custom `unicase` collation
  ([sqlite.rs#L87](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/sqlite.rs#L87)).
  The schema-14+ tables use it: `deck_config.name`, `tags.tag`, `fields.name`, `templates.name`,
  `notetypes.name` and `decks.name`, with unique indexes on several
  ([schema15_upgrade.sql#L1-L37](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/upgrades/schema15_upgrade.sql#L1-L37)).
  I checked SQLite's behaviour on a synthetic DB with the system SQLite (3.45.1), not on a real
  package: without the collation registered, a plain `SELECT *` works, but `ORDER BY name`,
  `WHERE name = ?` and any `INSERT` into those tables fail with
  `no such collation sequence: unicase`. Reads must therefore filter and sort in Core, never in
  SQL on those columns. Writing schema 18 would need the collation registered.
- **WAL header.** Anki opens collections with `journal_mode=wal`. On close it switches back to
  `delete` only for schema 11
  ([sqlite.rs#L64-L68](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/sqlite.rs#L64-L68),
  [#L549-L557](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/sqlite.rs#L549-L557),
  [A/rslib/src/storage/mod.rs#L31-L35](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/mod.rs#L31-L35)).
  A `.anki21b` file therefore probably carries the WAL marker in header bytes 18–19 (value 2,
  [SQLite file format §1.3.3](https://www.sqlite.org/fileformat2.html#file_format_version_numbers)).
  Whether sql.js can open such a buffer is listed under "Needs checking".

## 3. Where each piece of data lives

### Notes, cards, revlog (same in both schemas)

`notes`, `cards` and `revlog` columns:
[schema11.sql#L16-L61](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/schema11.sql#L16-L61).

- **`notes.flds`** holds the field values joined by `\x1f`
  ([A/rslib/src/storage/note/mod.rs#L19-L23](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/note/mod.rs#L19-L23)).
  `guid` is how Anki matches notes across imports. `sfld` and `csum` are recomputed by Anki on
  import (`prepare_for_update`,
  [apkg/import/notes.rs#L430-L438](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/apkg/import/notes.rs#L430-L438)).
  `csum` is the first 4 bytes of the SHA-1 of the stripped first field, big-endian
  ([A/rslib/src/notes/mod.rs#L321-L326](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/notes/mod.rs#L321-L326)).
- **`cards`**:
  - `type`: 0 new, 1 learn, 2 review, 3 relearn.
  - `queue`: 0 new, 1 learn, 2 review, 3 day-learn, 4 preview, -1 suspended, -2 sched-buried,
    -3 user-buried
    ([A/rslib/src/card/mod.rs#L44-L68](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/card/mod.rs#L44-L68)).
  - `due` depends on the queue: a new-card position, a unix timestamp for learn, or a day number
    counted from the collection's creation day (`col.crt`) for review and day-learn.
- **Per-card FSRS memory state** is stored, as JSON in `cards.data`: `s` (stability, 4 decimals),
  `d` (difficulty, 3 decimals), `dr` (desired retention), `decay`, `lrt` (last review time in
  seconds), `pos` (original new position) and `cd` (custom data)
  ([A/rslib/src/storage/card/data.rs#L18-L62](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/card/data.rs#L18-L62),
  rounding at
  [#L93-L107](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/card/data.rs#L93-L107)).
  The memory state is optional. When FSRS is on and a non-new card has none, Anki rebuilds it
  from the card's revlog the next time it is answered
  ([A/rslib/src/scheduler/answering/mod.rs#L486-L502](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/scheduler/answering/mod.rs#L486-L502)).
- **`revlog`** ([A/rslib/src/revlog/mod.rs#L36-L76](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/revlog/mod.rs#L36-L76)):
  - `id`: the answer time in epoch milliseconds
    ([#L17-L22](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/revlog/mod.rs#L17-L22)).
  - `cid`: the card id.
  - `ease`: 1–4, or 0 for a manual entry.
  - `ivl`/`lastIvl`: days when positive, seconds when negative.
  - `factor`: the SM-2 ease ×10; under FSRS, difficulty mapped to 100–1100.
  - `time`: milliseconds taken.
  - `type`: 0 learn, 1 review, 2 relearn, 3 filtered, 4 manual, 5 rescheduled.
- **Revlog entries that are not grades.** Anki's own FSRS replay skips some entries
  ([A/rslib/src/scheduler/fsrs/params.rs#L401-L470](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/scheduler/fsrs/params.rs#L401-L470),
  predicates at
  [revlog/mod.rs#L103-L131](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/revlog/mod.rs#L103-L131)):
  - `type=3 AND factor=0` is cramming. It is ignored.
  - `type=4 AND factor=0` is a reset ("Forget"). History before it is discarded.
  - `ease=0` entries carry no rating.
  - Histories cut off by `ignore_revlogs_before_date` start from the first interday grade.

  Core's replay must follow these rules, or imported memory states won't match Anki's.

### Note types

- **Schema 11**: `col.models` is a JSON object keyed by id. Each value is a `NotetypeSchema11`
  ([A/rslib/src/notetype/schema11.rs#L38-L71](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/notetype/schema11.rs#L38-L71)):
  - `type` (0 standard, 1 cloze), `sortf`, `css`, `latexPre`/`latexPost`, `req`.
  - `flds[]` with `name`, `ord`, `font`, `size`, `rtl`, `sticky`, `id`, ...
    ([#L233-L268](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/notetype/schema11.rs#L233-L268)).
  - `tmpls[]` with `name`, `ord`, `qfmt`, `afmt`, `bqfmt`, `bafmt`, `did`, `id`
    ([#L353-L373](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/notetype/schema11.rs#L353-L373)).
- **Schema 15+**: rows in `notetypes(id, name, mtime_secs, usn, config)`,
  `fields(ntid, ord, name, config)` and `templates(ntid, ord, name, mtime_secs, usn, config)`.
  Each `config` is a protobuf blob: `Notetype.Config`, `Notetype.Field.Config` and
  `Notetype.Template.Config`
  ([A/proto/anki/notetypes.proto#L47-L125](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/proto/anki/notetypes.proto#L47-L125);
  decoded at
  [storage/notetype/mod.rs#L26](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/notetype/mod.rs#L26),
  [#L72](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/notetype/mod.rs#L72),
  [#L86](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/notetype/mod.rs#L86)).
  Fields Core needs:
  - `Config.kind = 1` (0 normal, 1 cloze), `sort_field_idx = 2`, `css = 3`.
  - Template `q_format = 1` and `a_format = 2`.
  - Field and template `id`: field 9 and field 8 of their configs. Anki 2.1.67+ uses them to
    merge note types ([M/src/importing/packaged-decks.md#L45-L49](https://github.com/ankitects/anki-manual/blob/91f7485236db2a89d2a8abaed618976caf971de2/src/importing/packaged-decks.md#L45-L49)).

### Decks

- **Schema 11**: `col.decks` JSON keyed by id. Names use `::` between levels. A normal deck has
  `conf` (its preset id) and an optional `desiredRetention`. That value is an **integer percent**
  (e.g. `90`), converted to and from a 0–1 float
  ([A/rslib/src/decks/schema11.rs#L118-L140](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/decks/schema11.rs#L118-L140),
  [#L331](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/decks/schema11.rs#L331),
  [#L373](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/decks/schema11.rs#L373)).
  `dyn: 1` marks a filtered deck.
- **Schema 15+**: `decks(id, name, mtime_secs, usn, common, kind)`. `name` uses `\x1f` between
  levels ([A/rslib/src/decks/name.rs#L14-L26](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/decks/name.rs#L14-L26)).
  `common` is a protobuf `Deck.Common` and `kind` a `Deck.KindContainer` (`normal = 1` or
  `filtered = 2`)
  ([A/rslib/src/storage/deck/mod.rs#L25-L26](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/deck/mod.rs#L25-L26)).
  `Deck.Normal` has `config_id = 1`, review and new limits, and
  `optional float desired_retention = 10` (the per-deck override)
  ([A/proto/anki/decks.proto#L72-L91](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/proto/anki/decks.proto#L72-L91),
  container at
  [#L127-L132](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/proto/anki/decks.proto#L127-L132)).
- The deck's desired retention, when set, overrides the preset's
  ([A/rslib/src/decks/mod.rs#L96-L101](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/decks/mod.rs#L96-L101)).

### Deck options (Anki "presets")

Presets are shared: many decks can point to one preset.

- **Schema 11**: `col.dconf` JSON keyed by id, each value a `DeckConfSchema11`
  ([A/rslib/src/deckconfig/schema11.rs#L31-L104](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/deckconfig/schema11.rs#L31-L104)):
  - `new.delays` (learning steps in minutes) and `new.perDay`.
  - `rev.perDay`, `lapse.delays` (relearning steps), `rev.maxIvl`, ...
  - FSRS: `fsrsWeights` (FSRS 4.x), `fsrsParams5`, `fsrsParams6`, `desiredRetention` (a 0–1
    float), `ignoreRevlogsBeforeDate`, `sm2Retention` (historical retention) and `weightSearch`
    ([#L72-L100](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/deckconfig/schema11.rs#L72-L100)).

  The schema-11 downgrade keeps all of them
  ([#L406-L515](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/deckconfig/schema11.rs#L406-L515)).
  Default `desiredRetention` is 0.9
  ([#L280-L320](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/deckconfig/schema11.rs#L280-L320)).
- **Schema 14+**: `deck_config(id, name, mtime_secs, usn, config)`. `config` is a protobuf
  `DeckConfig.Config`
  ([A/proto/anki/deck_config.proto#L59-L204](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/proto/anki/deck_config.proto#L59-L204),
  written at
  [A/rslib/src/storage/deckconfig/mod.rs#L92-L104](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/deckconfig/mod.rs#L92-L104)).
  Fields:
  - `learn_steps = 1` and `relearn_steps = 2`.
  - `fsrs_params_4 = 3`, `fsrs_params_5 = 5` and `fsrs_params_6 = 6`, all repeated floats.
  - `new_per_day = 9` and `reviews_per_day = 10`.
  - `desired_retention = 37`, `historical_retention = 40` and `ignore_revlogs_before_date = 46`
    ([#L132-L194](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/proto/anki/deck_config.proto#L132-L194)).
- **Which params Anki uses**: params 6 if non-empty, else 5, else 4
  ([A/rslib/src/deckconfig/mod.rs#L112-L120](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/deckconfig/mod.rs#L112-L120)).
  Empty means "defaults".
- **Not in the package**: the collection-wide "FSRS on/off" toggle (`BoolKey::Fsrs`,
  [A/rslib/src/config/bool.rs#L40](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/config/bool.rs#L40)).
  The exporter gathers decks, notes, cards, note types, revlog and deck configs, never collection
  config
  ([A/rslib/src/import_export/gather.rs#L35-L70](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/gather.rs#L35-L70)).
  Whether the importing Anki uses FSRS is up to that user's own setting.

### Day numbering (needed to read and write review `due`)

- A review card's `due` is a day number counted from `col.crt`. The day count uses the creation
  offset and the rollover hour, default 4
  ([A/rslib/src/scheduler/mod.rs#L58-L84](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/scheduler/mod.rs#L58-L84),
  [A/rslib/src/scheduler/timing.rs#L27-L55](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/scheduler/timing.rs#L27-L55)).
- At schema 11, `rollover`, `creationOffset` and `schedVer` sit in `col.conf`. A fresh schema-11
  `conf` looks like
  [A/rslib/src/config/schema11.rs#L10-L28](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/config/schema11.rs#L10-L28).
- On import, Anki shifts review `due` by the difference between the source collection's "today"
  and the target's
  ([A/rslib/src/import_export/package/apkg/import/cards.rs#L67-L72](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/apkg/import/cards.rs#L67-L72),
  [#L177-L197](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/apkg/import/cards.rs#L177-L197)).
- So Core turns `due` into a date with `crt` and the source's rollover on import. On export it
  writes `crt`, `rollover` and `creationOffset` that agree with the day numbers it writes.

## 4. Import into the app: rows to model

What Core does with the rows the app layer hands over:

- **Note types**: kind, fields in `ord` order, templates (front/back), CSS and sort field. Keep
  Anki's notetype id and field/template ids.
- **Notes**: `guid`, `mid`, `mod`, tags (space-separated in `notes.tags`), fields split on
  `\x1f`. Keep the Anki note id and guid.
- **Cards**: `nid`, `ord` (template index, or cloze number − 1), `did`, `odid` (the home deck if
  the card sits in a filtered deck), and suspended/buried from `queue`. Keep the Anki card id.
  Scheduling columns and `data` are not truth in our model. They serve as a cross-check against
  replay; see "Needs checking".
- **Decks**: names split on `::` (schema 11) or `\x1f` (schema 15+). Filtered decks become their
  cards' home decks, as Anki does when filtered decks can't be kept
  ([gather.rs#L108-L141](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/gather.rs#L108-L141)).
- **Deck options**: from the deck's preset, plus the deck's own `desired_retention` override.
  Params are picked 6 → 5 → 4. Learning steps come from `new.delays`/`learn_steps`, in minutes.
- **Revlog → imported reviews**:
  - Answer time from `id`; grade from `ease` (after the v1 remap); time taken from `time`.
  - Cramming entries are skipped.
  - Resets (`type=4, factor=0`) and other `ease=0` entries are not grades. The model has to
    represent them or drop the history before them; see spec changes.
  - `id` is unique per collection, so `(source, card id, revlog id)` gives a stable key for
    re-imports.
- **Media**: map entry index → file name. Check the name like Anki does: reject unsafe names and
  NFC-normalize. A field references media by file name.

## 5. Export from the app: what to write

Format: Legacy 2.

- **Zip entries**:
  - `meta` = `08 02`.
  - `collection.anki21`.
  - `media` = JSON `{"0":"name.ext",...}`.
  - `0..n` = raw media bytes.

  Deflate or store both work: the reader uses zip's own decompression for legacy
  ([meta.rs#L119-L125](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/meta.rs#L119-L125)).
  The dummy `collection.anki2` is optional for current clients, because `meta` (or
  `collection.anki21`) decides the file read
  ([meta.rs#L71-L95](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/meta.rs#L71-L95)).
- **`collection.anki21`**:
  - The DDL of
    [schema11.sql](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/schema11.sql#L1-L78):
    tables `col`, `notes`, `cards`, `revlog`, `graves`, and the indexes.
  - Exactly one `col` row with `ver = 11`, `crt`, `mod`, `scm`, and JSON in `conf`, `models`,
    `decks`, `dconf`, `tags`.
  - Journal mode `DELETE` at close, as Anki does for schema 11.
- **Anki upgrades the file to schema 18 when it opens it** (`CollectionBuilder::build` in
  [apkg/import/mod.rs#L127-L146](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/apkg/import/mod.rs#L127-L146)).
  That upgrade deserializes `dconf`, `models` and `decks` with serde, so the JSON has to satisfy
  the Rust structs. Fields without `#[serde(default)]` are required, e.g. `maxTaken`,
  `autoplay`, `new.initialFactor`, `new.ints`, `rev.ease4`, `rev.ivlFct`, `rev.maxIvl`,
  `lapse.leechFails`, `lapse.minInt`, `lapse.mult`
  ([deckconfig/schema11.rs#L31-L237](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/deckconfig/schema11.rs#L31-L237)),
  and `sortf`, `tmpls` and `flds` on note types
  ([notetype/schema11.rs#L38-L71](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/notetype/schema11.rs#L38-L71)).
- **What keeps scheduling intact**:
  - **Cards**: `type`, `queue`, `due` (day number from `crt` for review), `ivl`, `factor`
    (2500 is a sane SM-2 value for users with FSRS off), `reps`, `lapses`, `left`, `odue=0`,
    `odid=0`.
  - **`cards.data`**: `{"s":…,"d":…,"dr":…,"lrt":…}` from Core's replay. If it is left out, Anki
    rebuilds the state from the revlog on the next answer
    ([answering/mod.rs#L486-L502](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/scheduler/answering/mod.rs#L486-L502)).
  - **`revlog`**: one row per review. Ids are unique: Anki's importer uses `INSERT OR IGNORE` on
    `id`, so two reviews in the same millisecond lose one
    ([cards.rs#L110-L119](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/apkg/import/cards.rs#L110-L119),
    [A/rslib/src/storage/revlog/add.sql](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/revlog/add.sql#L1-L34)).
    Bump colliding ids by 1 ms.
  - **`col.conf`**: `schedVer: 2`, `rollover`, `creationOffset`.
  - **Deck options**: one `dconf` preset per deck options set, with `fsrsParams6` and
    `desiredRetention`. Give it a fresh unique id, never 1: presets are inserted with
    `INSERT OR IGNORE` on id, so a clash silently keeps the target's preset
    ([apkg/import/decks.rs#L44-L50](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/apkg/import/decks.rs#L44-L50),
    [A/rslib/src/storage/deckconfig/add_if_unique.sql](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/storage/deckconfig/add_if_unique.sql#L1-L3)).
- **Import options the user must pick in Anki** (`ImportAnkiPackageOptions`,
  [import_export.proto#L50-L62](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/proto/anki/import_export.proto#L50-L62)):
  - `with_scheduling` ("Import any learning progress"). When off, Anki resets every card to new,
    drops the revlog and strips the `leech`/`marked` tags
    ([gather.rs#L53-L60](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/gather.rs#L53-L60),
    [M/src/importing/packaged-decks.md#L8-L20](https://github.com/ankitects/anki-manual/blob/91f7485236db2a89d2a8abaed618976caf971de2/src/importing/packaged-decks.md#L8-L20)).
  - `with_deck_configs` ("Import deck presets"). When off, decks point to preset 1
    ([gather.rs#L62-L67](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/gather.rs#L62-L67),
    [#L108-L131](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/gather.rs#L108-L131)).
  - Both default to false in a fresh collection, and Anki remembers the last choice
    ([A/rslib/src/import_export/service.rs#L23-L25](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/service.rs#L23-L25),
    [#L195-L203](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/service.rs#L195-L203),
    [apkg/import/mod.rs#L61-L66](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/apkg/import/mod.rs#L61-L66)).
- **Limit: existing cards are never updated.** If the target already has a note with the same
  guid, Anki may update its fields (newer `mod` wins by default). But a card whose (note,
  template) already exists is skipped ("TODO: could update existing card"), and the revlog of
  skipped cards is dropped
  ([cards.rs#L100-L119](https://github.com/ankitects/anki/blob/29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba/rslib/src/import_export/package/apkg/import/cards.rs#L100-L119)).
  An export carries scheduling into a profile that doesn't yet have those notes. It cannot push
  new reviews into a collection that already has them.

## 6. Needs checking with a real file

1. Whether sql.js opens a `.anki21b` buffer with the WAL marker in header bytes 18–19. If it
   doesn't, check whether rewriting those two bytes to `1` fixes it. Also whether expo-sqlite
   handles the same file when it is written to disk without a `-wal` file.
2. Read-only queries against a real schema-18 file in sql.js and expo-sqlite, with no `unicase`
   collation registered. Expected: `SELECT *` works and anything sorting or filtering on the name
   columns fails.
3. A Legacy 2 package written by our exporter, imported into current Anki desktop and AnkiDroid
   with both options ticked. Check that the serde upgrade accepts our `col` JSON, that review
   `due` dates land on the same calendar day (crt/rollover/offset handling, including a time-zone
   difference), and that FSRS params, desired retention and `cards.data` survive.
4. The same import with no `meta` entry and no dummy `collection.anki2`, to confirm both are
   optional.
5. Whether replaying an imported revlog through ts-fsrs, with the same params and the filtering
   rules above, gives the `s`/`d` stored in `cards.data` (within Anki's rounding). This decides
   whether `cards.data` can be ignored on import.
6. Real shared decks from AnkiWeb, to see which shapes turn up: Legacy 1 with `schedVer` 1,
   Legacy 2 from 2.1.x, Latest. Also packages from old AnkiDroid (pre-backend exporter): media
   map missing or empty, odd field types in the JSON (Anki parses several fields leniently with
   `default_on_invalid` and `deserialize_number_from_string`, which hints that such files exist).
7. Packages over a few hundred MB (media-heavy decks): memory use of unzip plus zstd plus the
   sql.js in-memory DB on the web.

## Spec changes this implies

- **Import and export**: export writes the legacy `.apkg` (`collection.anki21`, schema 11), not
  `anki21b`. The export screen tells the user to tick "Import any learning progress" and "Import
  deck presets" in Anki. Also state the limit: re-importing into an Anki profile that already has
  those notes doesn't update their scheduling or history.
- **Data model, identity**: keep Anki's ids on imported objects: note `guid` and id, card id,
  notetype id plus field/template ids, deck id, preset id, note `mod`. Generate them (int64
  ms-style ids, random guid) for objects made in the app, so export and re-import stay stable.
- **Review log**: an imported revlog has non-grade events: resets ("Forget"), set-due-date and
  rescheduled entries, and cramming. The review shape (grade required) can't hold them. Either
  add a reset event to the log or drop the history before a reset at import time, and skip
  cramming. Also derive imported review ids deterministically from the revlog id, so importing
  the same file twice doesn't duplicate reviews.
- **Scheduling**: replay needs a defined day boundary. Anki uses a rollover hour (default 4 am)
  and the deck's `ignore_revlogs_before_date`. The spec should pick the rollover rule. It should
  also say whether imported FSRS params (`fsrs_params_6`, or 5/4) are used or replaced by
  ts-fsrs defaults, since the spec currently says defaults only.
- **Deck options**: Anki's options are shared presets plus a per-deck desired-retention
  override. The spec says "a deck has deck options". Decide whether the app keeps shared presets
  or copies a preset into each deck at import.
- **`packages/core` scope**: add "a minimal protobuf wire-format reader" to Core's list. It is
  needed for `meta`, the media map and the schema-18 config blobs. zstd, zip and SQLite stay in
  the app layer.
