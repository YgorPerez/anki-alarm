import { Collection, deckPreset, replayCard, type LogEntry } from "@app/core";
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
        (database === "collection.db" ? [1, 3, 5, 7, 9, 11] : [2, 4, 6, 10]).map((id) => ({ id })),
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

test("upgrade freezes legacy review options and queued answers before any preset edit", () => {
  const c = new Collection({
    deviceId: "phone",
    now: () => 1000,
    random: () => new Uint8Array(16),
  });
  const deck = c.createDeck("Words");
  c.addBasicNote(deck.id, "one", "um");
  const state = c.snapshot();
  state.decks[0]!.fields.desiredRetention.value = 0.85;
  const card = state.cards[0]!;
  const preset = deckPreset(state, state.decks[0]!)!;
  const review: LogEntry = {
    id: "legacy",
    cardId: card.id,
    at: 1000,
    kind: "review",
    grade: 4,
    durationMs: 100,
    origin: "phone",
  };
  const before = replayCard(card.id, [review], preset, 1000);
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(migrationStatements("collection.db").join(";"));
    db.exec("DELETE FROM schema_migrations WHERE id = 11");
    for (const table of ["cards", "decks", "presets"] as const)
      for (const record of state[table])
        db.prepare(`INSERT INTO ${table} VALUES (?, ?)`).run(record.id, JSON.stringify(record));
    db.prepare("INSERT INTO review_log VALUES (?, ?)").run(review.id, JSON.stringify(review));
    db.prepare("INSERT INTO outbox (kind, record_id, body) VALUES ('reviewLog', ?, ?)").run(
      review.id,
      JSON.stringify(review),
    );
    db.exec(migrationStatements("collection.db").join(";"));
    const frozen: LogEntry = JSON.parse(
      String(db.prepare("SELECT body FROM review_log").get()!.body),
    );
    expect(frozen).toMatchObject({
      ...review,
      options: { desiredRetention: 0.85, learningSteps: [1, 10] },
    });
    expect(replayCard(card.id, [frozen], preset, 1000)).toEqual(before);
    preset.fields.desiredRetention.value = 0.99;
    expect(replayCard(card.id, [frozen], preset, 1000)).toEqual(before);
    expect(JSON.parse(String(db.prepare("SELECT body FROM outbox").get()!.body))).toEqual(frozen);
    db.exec("UPDATE presets SET body = json_set(body, '$.fields.desiredRetention.value', 0.99)");
    db.exec(migrationStatements("collection.db").join(";"));
    expect(JSON.parse(String(db.prepare("SELECT body FROM review_log").get()!.body))).toEqual(
      frozen,
    );
  } finally {
    db.close();
  }
});
