import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vite-plus/test";
import { migrationStatements } from "./migrations.ts";

test("numbered migrations preserve existing collection and alarm data across repeated opens", () => {
  for (const database of ["collection.db", "anki-alarm.db"] as const) {
    const db = new DatabaseSync(":memory:");
    const table = database === "collection.db" ? "decks" : "alarms";
    const column = database === "collection.db" ? "body" : "data";
    try {
      db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, ${column} TEXT NOT NULL)`);
      db.prepare(`INSERT INTO ${table} VALUES (?, ?)`).run("existing", '{"name":"kept"}');
      db.exec(migrationStatements(database).join(";"));
      db.exec(migrationStatements(database).join(";"));
      expect(db.prepare(`SELECT ${column} AS value FROM ${table}`).get()).toEqual({
        value: '{"name":"kept"}',
      });
      expect(db.prepare("SELECT id FROM schema_migrations ORDER BY id").all()).toEqual(
        (database === "collection.db" ? [1, 3, 5, 7, 9] : [2, 4, 6, 10]).map((id) => ({ id })),
      );
      const other = database === "collection.db" ? "alarms" : "decks";
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(other),
      ).toBeUndefined();
    } finally {
      db.close();
    }
  }
});
