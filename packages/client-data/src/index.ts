import { drizzle } from "drizzle-orm/sqlite-proxy";
import { sql } from "drizzle-orm";
import { settings as settingsTable, alarms, alarmEvents, outbox, reviewLog } from "./schema.ts";
export { type ExecuteSql } from "./collection.ts";
import { openCollectionStore, type ExecuteSql } from "./collection.ts";
import { migrationStatements } from "./migrations.ts";
import { Context, Effect, Layer } from "effect";
import {
  uuid7,
  studyQueue,
  type LogEntry,
  type Grade,
  updateThemeSettings,
  parseAlarmSound,
  type Settings,
  type ThemeChoice,
  type Collection,
  type CollectionState,
  type Alarm,
  type AnkiDroidSource,
} from "@app/core";

export interface AlarmEvent {
  id: string;
  kind: string;
  alarmId: string;
  ringId: string | null;
  wallTime: number;
  elapsedRealtime: number;
}
export interface PendingChange {
  database: "collection.db" | "anki-alarm.db";
  sequence: number;
  kind: string;
  recordId: string;
  body: unknown;
}
interface Data {
  collection: Effect.Effect<CollectionState, Error>;
  reviewLog: Effect.Effect<LogEntry[], Error>;
  answerCard: (cardId: string, grade: Grade, durationMs: number) => Effect.Effect<LogEntry, Error>;
  changeCollection: (
    command: (collection: Collection) => void,
  ) => Effect.Effect<CollectionState, Error>;
  /**
   * Imports an AnkiDroid deck as a linked deck owned by this phone, with a snapshot for each
   * reviewed card, in one transaction. Linking again updates it. Resolves with the deck's id.
   */
  linkAnkiDroidDeck: (source: AnkiDroidSource) => Effect.Effect<string, Error>;
  alarms: Effect.Effect<Alarm[], Error>;
  saveAlarm: (alarm: Alarm) => Effect.Effect<void, Error>;
  ingestEvents: (events: readonly AlarmEvent[]) => Effect.Effect<void, Error>;
  events: Effect.Effect<AlarmEvent[], Error>;
  settings: Effect.Effect<Settings, Error>;
  setTheme: (patch: Partial<ThemeChoice>) => Effect.Effect<Settings, Error>;
  pendingChanges: Effect.Effect<PendingChange[], Error>;
}
export class ClientData extends Context.Service<ClientData, Data>()("ClientData") {}
export interface SQLiteConnection {
  connect: (database: "collection.db" | "anki-alarm.db") => ExecuteSql;
  now: () => number;
  random: () => Uint8Array;
}
export class SQLiteDriver extends Context.Service<SQLiteDriver, SQLiteConnection>()(
  "SQLiteDriver",
) {}

const failure = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));
export const ClientDataLive = Layer.effect(
  ClientData,
  Effect.gen(function* () {
    const driver = yield* SQLiteDriver;
    return yield* Effect.tryPromise({ try: () => open(driver), catch: failure });
  }),
);
export const clientDataLayer = (driver: SQLiteConnection) =>
  ClientDataLive.pipe(Layer.provide(Layer.succeed(SQLiteDriver, driver)));

/* oxlint-disable eslint/no-await-in-loop -- SQLite transactions execute statements in order. */
async function open(driver: SQLiteConnection): Promise<Data> {
  const collectionSql = driver.connect("collection.db");
  const alarmSql = driver.connect("anki-alarm.db");
  const store = await openCollectionStore(collectionSql, driver);
  try {
    for (const statement of migrationStatements("anki-alarm.db"))
      await alarmSql(statement, [], "run");
  } catch (error) {
    await alarmSql("ROLLBACK", [], "run");
    throw error;
  }
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <A>(operation: () => Promise<A>) =>
    Effect.tryPromise({
      try: () => {
        const result = queue.then(operation);
        queue = result.catch(() => {});
        return result;
      },
      catch: failure,
    });
  const collectionDb = drizzle(collectionSql);
  const alarmDb = drizzle(alarmSql);
  const readSettings = async () => (await collectionDb.select().from(settingsTable))[0]?.body;
  if (!(await readSettings())) {
    const initial = updateThemeSettings(undefined, {}, { ...driver, deviceId: store.deviceId });
    await transaction(collectionSql, async () => {
      await collectionDb.insert(settingsTable).values({ id: initial.id, body: initial });
      await collectionDb
        .insert(outbox)
        .values({ kind: "settings", recordId: initial.id, body: initial });
    });
  }
  const readLog = async () => (await collectionDb.select().from(reviewLog)).map((r) => r.body);
  return {
    reviewLog: serial(readLog),
    answerCard: (cardId, grade, durationMs) =>
      serial(() =>
        transaction(collectionSql, async () => {
          if (![1, 2, 3, 4].includes(grade) || !Number.isFinite(durationMs) || durationMs < 0)
            throw new Error("Invalid answer");
          const state = await store.read();
          const card = state.cards.find((c) => c.id === cardId);
          const at = driver.now();
          if (
            !card ||
            !studyQueue(state, await readLog(), card.fields.deckId.value, at).some(
              (c) => c.card.id === cardId,
            )
          )
            throw new Error("Card is not available for study");
          const entry: LogEntry = {
            kind: "review",
            id: uuid7(at, driver.random()),
            cardId,
            at,
            grade,
            durationMs,
            origin: "phone",
          };
          await collectionDb.insert(reviewLog).values({ id: entry.id, body: entry });
          await collectionDb
            .insert(outbox)
            .values({ kind: "reviewLog", recordId: entry.id, body: entry });
          return entry;
        }),
      ),
    collection: serial(store.read),
    linkAnkiDroidDeck: (source) =>
      serial(async () => {
        const { result } = await store.transact(
          (c) => c.linkAnkiDroid(source),
          async ({ snapshots }) => {
            const known = new Set((await readLog()).map((e) => e.id));
            for (const entry of snapshots) {
              if (known.has(entry.id)) continue;
              await collectionDb.insert(reviewLog).values({ id: entry.id, body: entry });
              await collectionDb
                .insert(outbox)
                .values({ kind: "reviewLog", recordId: entry.id, body: entry });
            }
          },
        );
        return result.deckId;
      }),
    changeCollection: (command) => serial(() => store.change(command)),
    alarms: serial(async () =>
      (
        await alarmDb
          .select()
          .from(alarms)
          .orderBy(sql`rowid`)
      ).map((row) => {
        row.data.sound = parseAlarmSound(row.data.sound);
        return row.data;
      }),
    ),
    saveAlarm: (alarm) =>
      serial(() =>
        transaction(alarmSql, async () => {
          await alarmDb
            .insert(alarms)
            .values({ id: alarm.id, data: alarm })
            .onConflictDoUpdate({ target: alarms.id, set: { data: alarm } });
          await alarmDb.insert(outbox).values({ kind: "alarms", recordId: alarm.id, body: alarm });
        }),
      ),
    ingestEvents: (events) =>
      serial(() =>
        transaction(alarmSql, async () => {
          for (const event of events)
            await alarmDb
              .insert(alarmEvents)
              .values({ id: event.id, data: event })
              .onConflictDoNothing();
        }),
      ),
    events: serial(async () =>
      (
        await alarmDb
          .select()
          .from(alarmEvents)
          .orderBy(sql`rowid`)
      ).map((row) => row.data),
    ),
    settings: serial(async () => {
      const settings = await readSettings();
      if (!settings) throw new Error("Settings missing");
      return settings;
    }),
    setTheme: (patch) =>
      serial(() =>
        transaction(collectionSql, async () => {
          const settings = updateThemeSettings(await readSettings(), patch, {
            ...driver,
            deviceId: store.deviceId,
          });
          await collectionDb
            .insert(settingsTable)
            .values({ id: settings.id, body: settings })
            .onConflictDoUpdate({ target: settingsTable.id, set: { body: settings } });
          await collectionDb
            .insert(outbox)
            .values({ kind: "settings", recordId: settings.id, body: settings });
          return settings;
        }),
      ),
    pendingChanges: serial(async () => {
      const changes: PendingChange[] = [];
      for (const database of ["collection.db", "anki-alarm.db"] as const) {
        const db = database === "collection.db" ? collectionDb : alarmDb;
        for (const row of await db.select().from(outbox).orderBy(outbox.sequence))
          changes.push({ database, ...row });
      }
      return changes;
    }),
  };
}

const transaction = async <A>(execute: ExecuteSql, operation: () => Promise<A>) => {
  await execute("BEGIN IMMEDIATE", [], "run");
  try {
    const result = await operation();
    await execute("COMMIT", [], "run");
    return result;
  } catch (error) {
    await execute("ROLLBACK", [], "run");
    throw error;
  }
};
