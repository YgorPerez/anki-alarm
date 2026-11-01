import { DEFAULT_FSRS_PARAMETERS } from "@app/core";
// Migration ids are global across the two local databases. Keep published ids stable.
const migrations = [
  {
    id: 1,
    database: "collection.db",
    statements: [
      ...["decks", "notes", "cards", "noteTypes", "presets", "tombstones"].map(
        (name) =>
          `CREATE TABLE IF NOT EXISTS "${name}" (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL)`,
      ),
      "CREATE TABLE IF NOT EXISTS metadata (id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
    ],
  },
  {
    id: 2,
    database: "anki-alarm.db",
    statements: [
      "CREATE TABLE IF NOT EXISTS alarms (id TEXT PRIMARY KEY, data TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS alarm_events (id TEXT PRIMARY KEY, data TEXT NOT NULL)",
    ],
  },
  {
    id: 3,
    database: "collection.db",
    statements: [
      "CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS outbox (sequence INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, record_id TEXT NOT NULL, body TEXT NOT NULL)",
    ],
  },
  {
    id: 4,
    database: "anki-alarm.db",
    statements: [
      "CREATE TABLE IF NOT EXISTS outbox (sequence INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, record_id TEXT NOT NULL, body TEXT NOT NULL)",
    ],
  },
  {
    id: 5,
    database: "collection.db",
    statements: [
      "CREATE TABLE IF NOT EXISTS review_log (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL)",
    ],
  },
  {
    // Each alarm as it syncs, one HLC per property. `alarms` keeps the shape native reads.
    id: 6,
    database: "anki-alarm.db",
    statements: [
      "CREATE TABLE IF NOT EXISTS alarm_records (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL)",
    ],
  },
  {
    // Media records as they sync, and the files this device holds (ADR 0001 › Media).
    id: 7,
    database: "collection.db",
    statements: [
      "CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS media_local (name TEXT PRIMARY KEY NOT NULL, sha256 TEXT NOT NULL)",
    ],
  },
  {
    // This phone's view of AnkiDroid, which doesn't sync: each linked card's `reps` as last seen,
    // and the review log entries already sent back.
    id: 9,
    database: "collection.db",
    statements: [
      "CREATE TABLE IF NOT EXISTS ankidroid_cards (id TEXT PRIMARY KEY NOT NULL, reps INTEGER NOT NULL)",
      "CREATE TABLE IF NOT EXISTS ankidroid_sent (id TEXT PRIMARY KEY NOT NULL)",
    ],
  },
  {
    // Deleted alarms, which sync like the collection's deletes (ADR 0001).
    id: 10,
    database: "anki-alarm.db",
    statements: [
      "CREATE TABLE IF NOT EXISTS tombstones (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL)",
    ],
  },
  {
    // ADR 0008: freeze the inputs used by old replay before a user can edit a preset.
    id: 11,
    database: "collection.db",
    statements: [
      // The Worker froze its copies on its own, and this device's cursor is past them. A device with
      // an account sends and reads everything once, so the merge picks one copy everywhere.
      ...["syncCursor:0", "syncFullUpload:1"].map((meta) => {
        const [id, value] = meta.split(":");
        return `INSERT OR REPLACE INTO metadata (id, value)
        SELECT '${id}', '${value}'
        WHERE EXISTS (SELECT 1 FROM metadata WHERE id = 'syncAccount')
          AND EXISTS (SELECT 1 FROM review_log WHERE json_extract(body, '$.kind') = 'review'
            AND json_extract(body, '$.options') IS NULL)
          AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE id = 11)`;
      }),
      `WITH options AS (
        SELECT c.id AS card_id, json_object(
          'desiredRetention', COALESCE(json_extract(d.body, '$.fields.desiredRetention.value'), json_extract(p.body, '$.fields.desiredRetention.value')),
          'learningSteps', json(json_extract(p.body, '$.fields.learningSteps.value')),
          'fsrsParameters', json(COALESCE(json_extract(p.body, '$.fields.fsrsParameters.value'), '${JSON.stringify(DEFAULT_FSRS_PARAMETERS)}'))
        ) AS body
        FROM cards c
        JOIN decks d ON d.id = json_extract(c.body, '$.fields.deckId.value')
        JOIN presets p ON p.id = json_extract(d.body, '$.fields.presetId.value')
      )
      UPDATE review_log SET body = json_set(body, '$.options', json((
        SELECT body FROM options WHERE card_id = json_extract(review_log.body, '$.cardId')
      )))
      WHERE json_extract(body, '$.kind') = 'review'
        AND json_extract(body, '$.options') IS NULL
        AND json_extract(body, '$.cardId') IN (SELECT card_id FROM options)
        AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE id = 11)`,
      `UPDATE outbox SET body = (SELECT body FROM review_log WHERE id = outbox.record_id)
       WHERE kind = 'reviewLog' AND record_id IN (SELECT id FROM review_log)
         AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE id = 11)`,
    ],
  },
] as const;

// Both initial migrations are additive and safe to replay on databases created before the ledger.
export function migrationStatements(database: "collection.db" | "anki-alarm.db") {
  const statements = [
    "BEGIN IMMEDIATE",
    "CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY NOT NULL)",
  ];
  for (const migration of migrations) {
    if (migration.database !== database) continue;
    statements.push(...migration.statements);
    statements.push(`INSERT OR IGNORE INTO schema_migrations (id) VALUES (${migration.id})`);
  }
  statements.push("COMMIT");
  return statements;
}
