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
