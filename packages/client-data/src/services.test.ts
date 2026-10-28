import { DatabaseSync } from "node:sqlite";
import { Effect, Result } from "effect";
import { expect, test } from "vite-plus/test";
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
          sound: null,
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
