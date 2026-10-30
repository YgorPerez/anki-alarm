import { DatabaseSync } from "node:sqlite";
import { Effect, Result } from "effect";
import { expect, test } from "vite-plus/test";
import type { AnkiPackage } from "@app/core";
import { ClientData, clientDataLayer, type ExecuteSql } from "./index.ts";

test("public services persist local changes and outbox together across reopen", async () => {
  let failOutbox = false;
  const databases = new Map<string, DatabaseSync>();
  const connect = (name: string): ExecuteSql => {
    let db = databases.get(name);
    if (!db) {
      db = new DatabaseSync(":memory:");
      databases.set(name, db);
    }
    return async (query, params, method) => {
      if (failOutbox && query.toLowerCase().startsWith('insert into "outbox"'))
        throw new Error("disk full");
      const statement = db.prepare(query);
      if (method === "run") {
        statement.run(...params);
        return { rows: [] };
      }
      statement.setReturnArrays(true);
      return { rows: statement.all(...params) };
    };
  };
  let n = 0;
  const layer = () =>
    clientDataLayer({ connect, now: () => 1000, random: () => new Uint8Array(16).fill(n++) });
  const run = <A>(program: Effect.Effect<A, Error, ClientData>) =>
    Effect.runPromise(program.pipe(Effect.provide(layer())));
  try {
    await run(
      Effect.gen(function* () {
        const data = yield* ClientData;
        yield* data.changeCollection((c) => {
          c.createDeck("Words");
        });
        yield* data.setTheme({ primary: "#7fd4ff" });
      }),
    );
    await run(
      Effect.gen(function* () {
        const data = yield* ClientData;
        expect((yield* data.collection).decks[0]?.fields.name.value).toBe("Words");
        const settings = yield* data.settings;
        expect(settings.fields.primary.value).toBe("#7fd4ff");
        expect(settings.fields.primary.hlc.wallMs).toBe(1000);
        expect((yield* data.pendingChanges).map((x) => x.kind)).toEqual(
          expect.arrayContaining(["decks", "presets", "settings"]),
        );
      }),
    );
    await run(
      Effect.gen(function* () {
        const data = yield* ClientData;
        const before = yield* data.settings;
        const pending = yield* data.pendingChanges;
        failOutbox = true;
        const result = yield* Effect.result(data.setTheme({ secondary: "#ffd166" }));
        expect(Result.isFailure(result)).toBe(true);
        failOutbox = false;
        expect(yield* data.settings).toEqual(before);
        expect(yield* data.pendingChanges).toEqual(pending);
        yield* Effect.all(
          [
            data.setTheme({ secondary: "#ffd166" }),
            data.setTheme({ primary: "#8be3a0" }),
            data.collection,
          ],
          { concurrency: "unbounded" },
        );
        const settings = yield* data.settings;
        expect(settings.fields.primary.value).toBe("#8be3a0");
        expect(settings.fields.secondary.value).toBe("#ffd166");
        expect(settings.fields.primary.hlc.counter).toBeGreaterThan(
          settings.fields.secondary.hlc.counter,
        );
        const alarm = {
          id: "alarm",
          enabled: true,
          label: "Morning",
          rule: { hour: 7, minute: 0, repeatDays: [1] },
          vibrate: true,
          rampSeconds: 30,
          sound: { kind: "file" as const, uri: "content://media/7", title: "rooster.mp3" },
          deckId: "deck",
          need: 5,
          snooze: false,
          snoozeMinutes: 15,
          snoozeCap: 3,
          awakeCheck: true,
          awakeCheckMinutes: 10,
          readAloud: true,
          skip: 1_800_000_000_000,
          quick: false,
        };
        yield* data.saveAlarm(alarm);
        expect(yield* data.alarms).toEqual([alarm]);
        const event = {
          id: "event",
          kind: "ringStarted",
          alarmId: "alarm",
          ringId: "ring",
          wallTime: 1000,
          elapsedRealtime: 10,
        };
        yield* data.ingestEvents([event, event]);
        expect(yield* data.events).toEqual([event]);
        expect((yield* data.pendingChanges).some((c) => c.kind === "alarms")).toBe(true);
      }),
    );
  } finally {
    for (const db of databases.values()) db.close();
  }
});

test("reads legacy alarm sounds through the public service after reopening", async () => {
  const databases = new Map<string, DatabaseSync>();
  const connect = (name: string): ExecuteSql => {
    let db = databases.get(name);
    if (!db) {
      db = new DatabaseSync(":memory:");
      databases.set(name, db);
    }
    return async (query, params, method) => {
      const statement = db.prepare(query);
      if (method === "run") {
        statement.run(...params);
        return { rows: [] };
      }
      statement.setReturnArrays(true);
      return { rows: statement.all(...params) };
    };
  };
  const layer = () =>
    clientDataLayer({ connect, now: () => 1000, random: () => new Uint8Array(16) });
  const read = () =>
    Effect.runPromise(
      Effect.flatMap(ClientData, (data) => data.alarms).pipe(Effect.provide(layer())),
    );
  try {
    await read();
    const old = {
      id: "old",
      label: "Morning",
      enabled: true,
      rule: { hour: 7, minute: 0 },
      sound: null,
      vibrate: true,
      rampSeconds: 30,
    };
    databases
      .get("anki-alarm.db")!
      .prepare("INSERT INTO alarms (id, data) VALUES (?, ?)")
      .run(old.id, JSON.stringify(old));
    expect((await read())[0]).toMatchObject({ sound: { kind: "default" }, deckId: null, need: 3 });
  } finally {
    for (const db of databases.values()) db.close();
  }
});

test("study answers survive reopen and outbox failure rolls back the review", async () => {
  const databases = new Map<string, DatabaseSync>();
  let fail = false;
  let n = 0;
  const connect = (name: string): ExecuteSql => {
    const db = databases.get(name) ?? new DatabaseSync(":memory:");
    databases.set(name, db);
    return async (query, params, method) => {
      if (fail && query.includes('insert into "outbox"')) throw new Error("disk full");
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
            now: () => 1700000000000,
            random: () => new Uint8Array(16).fill(n++),
          }),
        ),
      ),
    );
  try {
    const data = await open();
    const state = await Effect.runPromise(
      data.changeCollection((c) => {
        const d = c.createDeck("Words");
        c.addBasicNote(d.id, "house", "casa");
      }),
    );
    const cardId = state.cards[0]!.id;
    fail = true;
    await expect(Effect.runPromise(data.answerCard(cardId, 3, 1400))).rejects.toThrow(/outbox/);
    expect(await Effect.runPromise(data.reviewLog)).toEqual([]);
    fail = false;
    const review = await Effect.runPromise(data.answerCard(cardId, 3, 1400));
    expect(review).toMatchObject({
      kind: "review",
      cardId,
      grade: 3,
      durationMs: 1400,
      origin: "phone",
      at: 1700000000000,
    });
    expect(review.id).toMatch(/^[\da-f-]{14}7/);
    const reopened = await open();
    expect(await Effect.runPromise(reopened.reviewLog)).toEqual([review]);
    expect(
      (await Effect.runPromise(reopened.pendingChanges))
        .filter((c) => c.kind === "reviewLog")
        .map((c) => c.body),
    ).toEqual([review]);
    // Not due again yet: normal study refuses the card, an alarm session still gets it.
    await expect(Effect.runPromise(reopened.answerCard(cardId, 3, 900))).rejects.toThrow(
      /not available/,
    );
    const alarm = await Effect.runPromise(reopened.answerCard(cardId, 1, 900, "ring-1"));
    expect(alarm).toMatchObject({ kind: "review", origin: "alarm", ringId: "ring-1", grade: 1 });
    await expect(
      Effect.runPromise(reopened.answerCard("deleted", 3, 900, "ring-1")),
    ).rejects.toThrow(/not available/);
    expect((await Effect.runPromise(reopened.reviewLog)).at(-1)).toEqual(alarm);
  } finally {
    for (const db of databases.values()) db.close();
  }
});

const shared = (count: number): AnkiPackage => ({
  version: 3,
  noteTypes: [
    {
      id: 7,
      name: "Basic",
      mtime: 1000,
      kind: "standard",
      css: "",
      fields: [
        { name: "Front", id: "1" },
        { name: "Back", id: "2" },
      ],
      templates: [{ name: "Card 1", front: "{{Front}}", back: "{{Back}}", id: "3" }],
    },
  ],
  decks: [{ id: 20, name: "Shared", mtime: 1000, presetId: 1, desiredRetention: null }],
  presets: [
    {
      id: 1,
      name: "Default",
      mtime: 0,
      newPerDay: 20,
      reviewsPerDay: 200,
      desiredRetention: 0.9,
      learningSteps: [1, 10],
    },
  ],
  notes: Array.from({ length: count }, (_, i) => ({
    id: 100 + i,
    guid: `guid-${i}`,
    noteTypeId: 7,
    mtime: 1700000000000,
    tags: [],
    fields: [`front ${i}`, `back ${i}`],
  })),
  cards: Array.from({ length: count }, (_, i) => ({
    id: 1000 + i,
    noteId: 100 + i,
    deckId: 20,
    ordinal: 0,
    mtime: 1700000000000,
    suspended: false,
  })),
  revlog: [
    {
      id: 1700000000000,
      cardId: 1000,
      at: 1700000000000,
      kind: "review",
      grade: 3,
      durationMs: 900,
    },
  ],
});

test("an Anki import commits records, reviews and outbox together and adds nothing again", async () => {
  const databases = new Map<string, DatabaseSync>();
  let fail = false;
  let n = 0;
  const connect = (name: string): ExecuteSql => {
    const db = databases.get(name) ?? new DatabaseSync(":memory:");
    databases.set(name, db);
    return async (query, params, method) => {
      if (fail && query.includes('insert into "review_log"')) throw new Error("disk full");
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
            now: () => 1800000000000,
            random: () => new Uint8Array(16).fill(n++),
          }),
        ),
      ),
    );
  // More notes than one batched statement holds.
  const source = shared(450);
  try {
    const data = await open();
    const before = await Effect.runPromise(data.pendingChanges);
    fail = true;
    await expect(Effect.runPromise(data.importAnki(source))).rejects.toThrow(/review_log/);
    expect((await Effect.runPromise(data.collection)).notes).toEqual([]);
    expect(await Effect.runPromise(data.pendingChanges)).toEqual(before);
    fail = false;
    expect(await Effect.runPromise(data.importAnki(source))).toEqual({
      notes: 450,
      cards: 450,
      entries: 1,
    });
    const pending = await Effect.runPromise(data.pendingChanges);
    expect(pending.filter((c) => c.kind === "notes")).toHaveLength(450);
    expect(pending.filter((c) => c.kind === "reviewLog")).toHaveLength(1);
    const reopened = await open();
    expect(await Effect.runPromise(reopened.importAnki(source))).toEqual({
      notes: 450,
      cards: 450,
      entries: 0,
    });
    expect(await Effect.runPromise(reopened.pendingChanges)).toEqual(pending);
    const state = await Effect.runPromise(reopened.collection);
    expect(state.decks.map((d) => d.fields.name.value)).toEqual(["Shared"]);
    expect(state.cards).toHaveLength(450);
    const first = state.cards.find((c) => c.anki?.id === 1000)!;
    expect(await Effect.runPromise(reopened.reviewLog)).toMatchObject([
      { kind: "review", origin: "import", grade: 3, cardId: first.id },
    ]);
  } finally {
    for (const db of databases.values()) db.close();
  }
});

import fixture from "../../core/fixtures/ankidroid-deck.json" with { type: "json" };
test("linking an AnkiDroid deck stores it with its snapshots in one transaction, once", async () => {
  const databases = new Map<string, DatabaseSync>();
  let fail = false;
  let n = 0;
  const connect = (name: string): ExecuteSql => {
    const db = databases.get(name) ?? new DatabaseSync(":memory:");
    databases.set(name, db);
    return async (query, params, method) => {
      if (fail && query.includes('insert into "review_log"')) throw new Error("disk full");
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
            now: () => 1770000000000,
            random: () => new Uint8Array(16).fill(n++),
          }),
        ),
      ),
    );
  try {
    const data = await open();
    fail = true;
    await expect(Effect.runPromise(data.linkAnkiDroidDeck(fixture.source))).rejects.toThrow(
      "Failed query",
    );
    expect((await Effect.runPromise(data.collection)).decks).toEqual([]);
    fail = false;
    const deckId = await Effect.runPromise(data.linkAnkiDroidDeck(fixture.source));
    await Effect.runPromise(data.linkAnkiDroidDeck(fixture.source));
    const reopened = await open();
    const state = await Effect.runPromise(reopened.collection);
    const deviceId = state.decks[0]!.fields.name.hlc.deviceId;
    expect(state.decks.map((d) => [d.id, d.fields.linkedBy?.value])).toEqual([[deckId, deviceId]]);
    expect(state.cards.map((c) => c.anki?.id)).toEqual([9001, 9002]);
    const log = await Effect.runPromise(reopened.reviewLog);
    expect(log).toEqual([expect.objectContaining({ kind: "snapshot", at: 1760000000000 })]);
    const pending = await Effect.runPromise(reopened.pendingChanges);
    expect(pending.filter((c) => c.kind === "reviewLog").map((c) => c.recordId)).toEqual([
      log[0]!.id,
    ]);
  } finally {
    for (const db of databases.values()) db.close();
  }
});
