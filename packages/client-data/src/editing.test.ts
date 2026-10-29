import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { studyQueue } from "@app/core";
import { expect, test } from "vite-plus/test";
import { ClientData, clientDataLayer, type ExecuteSql } from "./index.ts";

function harness(start = new Date(2026, 9, 28, 12).getTime()) {
  const databases = new Map<string, DatabaseSync>();
  const clock = { now: start };
  let n = 0;
  const connect = (name: string): ExecuteSql => {
    const db = databases.get(name) ?? new DatabaseSync(":memory:");
    databases.set(name, db);
    return async (query, params, method) => {
      const stmt = db.prepare(query);
      if (method === "run") {
        stmt.run(...params);
        return { rows: [] };
      }
      stmt.setReturnArrays(true);
      return { rows: stmt.all(...params) };
    };
  };
  const open = () =>
    Effect.runPromise(
      ClientData.pipe(
        Effect.provide(
          clientDataLayer({
            connect,
            now: () => clock.now,
            random: () => new Uint8Array(16).fill(n++),
          }),
        ),
      ),
    );
  return { connect, open, clock, close: () => databases.forEach((db) => db.close()) };
}
const run = Effect.runPromise;

test("Forget, Set due date and Undo append log entries with their outbox records", async () => {
  const h = harness();
  try {
    const data = await h.open();
    const state = await run(
      data.changeCollection((c) => {
        const d = c.createDeck("Words");
        c.addBasicNote(d.id, "house", "casa");
      }),
    );
    const deckId = state.decks[0]!.id;
    const cardId = state.cards[0]!.id;
    const queue = async () =>
      studyQueue(await run(data.collection), await run(data.reviewLog), deckId, h.clock.now);

    await expect(run(data.setDueDate(cardId, 1))).rejects.toThrow("studied card");
    const answer = await run(data.answerCard(cardId, 4, 900));
    expect(await queue()).toEqual([]);
    const moved = await run(data.setDueDate(cardId, 0));
    expect(moved).toMatchObject({
      kind: "setDueDate",
      cardId,
      due: new Date(2026, 9, 28, 4).getTime(),
    });
    expect((await queue()).map((c) => c.card.id)).toEqual([cardId]);

    const undone = await run(data.undo(moved.id));
    expect(undone).toMatchObject({ kind: "void", cardId, targetId: moved.id });
    expect(await queue()).toEqual([]);
    await expect(run(data.undo(moved.id))).rejects.toThrow("Nothing to undo");

    const reset = await run(data.forgetCard(cardId));
    expect(reset).toMatchObject({ kind: "reset", cardId });
    expect((await queue())[0]?.memory.reps).toBe(0);
    await run(data.undo(reset.id));
    await run(data.undo(answer.id));
    expect((await queue())[0]?.memory.reps).toBe(0);
    await expect(run(data.forgetCard("missing"))).rejects.toThrow("Card missing");

    const log = await run(data.reviewLog);
    expect(log.map((e) => e.kind)).toEqual([
      "review",
      "setDueDate",
      "void",
      "reset",
      "void",
      "void",
    ]);
    const reopened = await h.open();
    expect(
      (await run(reopened.pendingChanges)).filter((c) => c.kind === "reviewLog").map((c) => c.body),
    ).toEqual(log);
  } finally {
    h.close();
  }
});

test("set due date counts days from the study day and sets nothing in the past", async () => {
  const h = harness(new Date(2026, 9, 29, 2).getTime());
  try {
    const data = await h.open();
    const state = await run(
      data.changeCollection((c) => {
        c.addBasicNote(c.createDeck("Words").id, "house", "casa");
      }),
    );
    const cardId = state.cards[0]!.id;
    await run(data.answerCard(cardId, 4, 900));
    // 2am still belongs to the 28th's study day.
    expect(await run(data.setDueDate(cardId, 2))).toMatchObject({
      due: new Date(2026, 9, 30, 4).getTime(),
    });
    await expect(run(data.setDueDate(cardId, -1))).rejects.toThrow("Invalid due date");
    expect((await run(data.reviewLog)).filter((e) => e.kind === "setDueDate")).toHaveLength(1);
  } finally {
    h.close();
  }
});

test("notes and presets saved by earlier versions open in the current shape", async () => {
  const h = harness();
  try {
    const sql = h.connect("collection.db");
    const hlc = { wallMs: 1, counter: 0, deviceId: "old" };
    const field = <T>(value: T) => ({ value, hlc });
    await Promise.all(
      ["decks", "notes", "cards", "noteTypes", "presets", "tombstones"].map((name) =>
        sql(`CREATE TABLE "${name}" (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL)`, [], "run"),
      ),
    );
    const insert = (table: string, body: { id: string; fields: object }) =>
      sql(
        `INSERT INTO "${table}" (id, body) VALUES (?, ?)`,
        [body.id, JSON.stringify(body)],
        "run",
      );
    await insert("presets", {
      id: "p",
      fields: {
        name: field("Default"),
        newPerDay: field(20),
        reviewsPerDay: field(200),
        desiredRetention: field(0.9),
        learningSteps: field([1, 10]),
      },
    });
    await insert("notes", {
      id: "n",
      fields: {
        deckId: field("d"),
        noteTypeId: field("t"),
        front: field("casa"),
        back: field("house"),
      },
    });
    const data = await h.open();
    const state = await run(data.collection);
    expect(state.notes[0]!.values.map((v) => v.value)).toEqual(["casa", "house"]);
    expect(state.presets[0]!.fields.fsrsParameters.value).toHaveLength(21);
    expect((await run(data.pendingChanges)).filter((c) => c.kind === "notes")).toEqual([]);
  } finally {
    h.close();
  }
});
