import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { Collection, deckPreset, replayCard, type LogEntry } from "@app/core";
import { expect, test } from "vite-plus/test";

test("server upgrade freezes legacy history for devices that first sync after a preset edit", async () => {
  const migration = await readFile(
    new URL("../migrations/0003_review_options.sql", import.meta.url).pathname,
    "utf8",
  );
  const c = new Collection({
    deviceId: "phone",
    now: () => 1000,
    random: () => new Uint8Array(16),
  });
  const deck = c.createDeck("Words");
  c.addBasicNote(deck.id, "one", "um");
  const state = c.snapshot();
  const card = state.cards[0]!;
  const preset = deckPreset(state, state.decks[0]!)!;
  const entry: LogEntry = {
    kind: "review",
    id: "r",
    cardId: card.id,
    at: 1000,
    grade: 4,
    durationMs: 1,
    origin: "phone",
  };
  const before = replayCard(card.id, [entry], preset, 1000);
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE sync_records (user_id TEXT, kind TEXT, id TEXT, body TEXT)");
    for (const user of ["one", "two"]) {
      for (const kind of ["cards", "decks", "presets"] as const) {
        for (const record of state[kind]) {
          const copy = structuredClone(record);
          if (user === "two" && "desiredRetention" in copy.fields)
            copy.fields.desiredRetention.value = 0.99;
          db.prepare("INSERT INTO sync_records VALUES (?, ?, ?, ?)").run(
            user,
            kind,
            record.id,
            JSON.stringify({ kind, record: copy }),
          );
        }
      }
      db.prepare("INSERT INTO sync_records VALUES (?, 'reviewLog', ?, ?)").run(
        user,
        entry.id,
        JSON.stringify({ kind: "reviewLog", entry }),
      );
    }
    db.exec(migration);
    const read = (user: string): LogEntry =>
      JSON.parse(
        String(
          db
            .prepare("SELECT body FROM sync_records WHERE user_id = ? AND kind = 'reviewLog'")
            .get(user)!.body,
        ),
      ).entry;
    expect(read("one")).toMatchObject({
      ...entry,
      options: { desiredRetention: 0.9, learningSteps: [1, 10] },
    });
    expect(read("two")).toMatchObject({ options: { desiredRetention: 0.99 } });
    preset.fields.desiredRetention.value = 0.99;
    expect(replayCard(card.id, [read("one")], preset, 1000)).toEqual(before);
  } finally {
    db.close();
  }
});
