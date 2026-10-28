import { drizzle } from "drizzle-orm/sqlite-proxy";
import { sql } from "drizzle-orm";
import {
  settings as settingsTable,
  alarms,
  alarmEvents,
  alarmRecords,
  outbox,
  reviewLog,
} from "./schema.ts";
import { syncEngine } from "./sync.ts";
import {
  ankiDroidEngine,
  type AnkiDroidProvider,
  type PullSummary,
  type SyncBackSummary,
} from "./ankidroid.ts";
export type { AnkiDroidProvider, PullSummary, SyncBackSummary } from "./ankidroid.ts";
export { AccountMismatch, type SyncResult } from "./sync.ts";
export { syncScheduler, type SyncScheduler, type SyncStatus } from "./scheduler.ts";
export { type ExecuteSql } from "./collection.ts";
import { openCollectionStore, type ExecuteSql } from "./collection.ts";
import { migrationStatements } from "./migrations.ts";
import { Context, Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import {
  uuid7,
  studyQueue,
  checkLogEntry,
  dueInDays,
  type LogEntry,
  type Grade,
  updateThemeSettings,
  readAlarm,
  type Settings,
  type ThemeChoice,
  type Collection,
  type CollectionState,
  type Alarm,
  type AnkiPackage,
  type AnkiDroidSource,
  stampAlarm,
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
export interface ImportSummary {
  notes: number;
  cards: number;
  /** Review log entries this import added. */
  entries: number;
}
type Engine = ReturnType<typeof syncEngine>;
interface Data extends Engine {
  /** Calls `listener` after each local write commits, to schedule a sync. Returns unsubscribe. */
  subscribe: (listener: () => void) => () => void;
  collection: Effect.Effect<CollectionState, Error>;
  /**
   * Merges an Anki package into the collection and appends its review log in one transaction.
   * Store the package's media files first. Importing the same package again adds no entries.
   */
  importAnki: (source: AnkiPackage) => Effect.Effect<ImportSummary, Error>;
  reviewLog: Effect.Effect<LogEntry[], Error>;
  /**
   * Appends a review and its outbox record. With a ring id the answer belongs to that ring's alarm
   * session: daily limits and due dates don't hold it back.
   */
  answerCard: (
    cardId: string,
    grade: Grade,
    durationMs: number,
    ringId?: string,
  ) => Effect.Effect<LogEntry, Error>;
  /** Forget: appends a reset. */
  forgetCard: (cardId: string) => Effect.Effect<LogEntry, Error>;
  /** Appends a set due date at the start of the study day `days` from today. */
  setDueDate: (cardId: string, days: number) => Effect.Effect<LogEntry, Error>;
  /** Appends a void for one earlier review, reset or set due date. */
  undo: (entryId: string) => Effect.Effect<LogEntry, Error>;
  changeCollection: (
    command: (collection: Collection) => void,
  ) => Effect.Effect<CollectionState, Error>;
  /**
   * Imports an AnkiDroid deck as a linked deck owned by this phone, with a snapshot for each
   * reviewed card, in one transaction. Linking again updates it. Resolves with the deck's id.
   */
  linkAnkiDroidDeck: (source: AnkiDroidSource) => Effect.Effect<string, Error>;
  /** This phone's id: the `linkedBy` of the decks it linked. */
  deviceId: string;
  /**
   * Sends every review of this phone's linked cards not sent yet, from any origin, to AnkiDroid as
   * answers, in answer-time order. Each answer is checked and recorded before the next goes.
   */
  syncBackAnkiDroid: (provider: AnkiDroidProvider) => Effect.Effect<SyncBackSummary, Error>;
  /** Syncs back, then brings in the linked deck's new notes, edited fields and newer states. */
  pullAnkiDroid: (provider: AnkiDroidProvider, deckId: string) => Effect.Effect<PullSummary, Error>;
  /** Whether sync back runs after each alarm session; on unless turned off. This phone only. */
  autoSyncBack: Effect.Effect<boolean, Error>;
  setAutoSyncBack: (on: boolean) => Effect.Effect<void, Error>;
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
const promised = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({ try: operation, catch: failure });
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
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  /** Runs `operation` after every earlier one. */
  const enqueue = <A>(operation: () => Promise<A>) => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  /** Runs a local write in the queue and tells subscribers once it committed. */
  const local = <A>(operation: () => Promise<A>) =>
    serial(operation).pipe(Effect.tap(() => Effect.sync(notify)));
  const serial = <A>(operation: () => Promise<A>) =>
    Effect.tryPromise({ try: () => enqueue(operation), catch: failure });
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
  /** Appends one entry Core accepts, with its outbox record, in one transaction. */
  const append = (
    build: (state: CollectionState, log: LogEntry[], entry: { id: string; at: number }) => LogEntry,
  ) =>
    local(() =>
      transaction(collectionSql, async () => {
        const state = await store.read();
        const log = await readLog();
        const at = driver.now();
        const entry = build(state, log, { id: uuid7(at, driver.random()), at });
        checkLogEntry(state, log, entry);
        await collectionDb.insert(reviewLog).values({ id: entry.id, body: entry });
        await collectionDb
          .insert(outbox)
          .values({ kind: "reviewLog", recordId: entry.id, body: entry });
        return entry;
      }),
    );
  /** Appends the entries not yet in the log, with their outbox records; inside a transaction. */
  const appendNew = async (log: readonly LogEntry[]) => {
    const known = new Set(
      (await collectionDb.select({ id: reviewLog.id }).from(reviewLog)).map((r) => r.id),
    );
    const added = log.filter((entry) => !known.has(entry.id));
    for (let i = 0; i < added.length; i += 200) {
      const batch = added.slice(i, i + 200);
      await collectionDb.insert(reviewLog).values(batch.map((e) => ({ id: e.id, body: e })));
      await collectionDb
        .insert(outbox)
        .values(batch.map((e) => ({ kind: "reviewLog", recordId: e.id, body: e })));
    }
    return added.length;
  };
  const env = { ...driver, deviceId: store.deviceId };
  const ankiDroid = ankiDroidEngine({
    db: collectionDb,
    deviceId: store.deviceId,
    now: driver.now,
    read: enqueue,
    write: (operation) => enqueue(() => transaction(collectionSql, operation)),
    readCollection: store.read,
    readLog,
    runCollection: store.run,
    appendNew,
    notify,
  });
  const engine = syncEngine({
    collectionDb,
    alarmDb,
    serial,
    inCollection: (operation) => transaction(collectionSql, operation),
    inAlarms: (operation) => transaction(alarmSql, operation),
    env,
  });
  return {
    ...engine,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reviewLog: serial(readLog),
    answerCard: (cardId, grade, durationMs, ringId) =>
      append((state, log, base) => {
        if (![1, 2, 3, 4].includes(grade) || !Number.isFinite(durationMs) || durationMs < 0)
          throw new Error("Invalid answer");
        const card = state.cards.find((c) => c.id === cardId);
        if (
          !card ||
          (ringId === undefined &&
            !studyQueue(state, log, card.fields.deckId.value, base.at).some(
              (c) => c.card.id === cardId,
            ))
        )
          throw new Error("Card is not available for study");
        return {
          ...base,
          kind: "review",
          cardId,
          grade,
          durationMs,
          ...(ringId === undefined
            ? { origin: "phone" as const }
            : { origin: "alarm" as const, ringId }),
        };
      }),
    forgetCard: (cardId) => append((_, __, base) => ({ ...base, kind: "reset", cardId })),
    setDueDate: (cardId, days) =>
      append((_, __, base) => ({
        ...base,
        kind: "setDueDate",
        cardId,
        due: dueInDays(days, base.at),
      })),
    undo: (targetId) =>
      append((_, log, base) => {
        const target = log.find((e) => e.id === targetId);
        if (!target) throw new Error("Nothing to undo");
        return { ...base, kind: "void", cardId: target.cardId, targetId };
      }),
    collection: serial(store.read),
    importAnki: (source) =>
      local(async () => {
        let entries = 0;
        const { result } = await store.run(
          (collection) => collection.importAnki(source),
          async ({ log }) => {
            entries = await appendNew(log);
          },
        );
        return { notes: result.notes, cards: result.cards, entries };
      }),
    deviceId: store.deviceId,
    linkAnkiDroidDeck: (source) => promised(async () => (await ankiDroid.link(source)).deckId),
    syncBackAnkiDroid: (provider) => promised(() => ankiDroid.syncBack(provider)),
    pullAnkiDroid: (provider, deckId) => promised(() => ankiDroid.pull(provider, deckId)),
    autoSyncBack: promised(ankiDroid.autoSyncBack),
    setAutoSyncBack: (on) => promised(() => ankiDroid.setAutoSyncBack(on)),
    changeCollection: (command) => local(() => store.change(command)),
    alarms: serial(async () =>
      (
        await alarmDb
          .select()
          .from(alarms)
          .orderBy(sql`rowid`)
      ).map((row) => readAlarm(row.data)),
    ),
    saveAlarm: (alarm) =>
      local(() =>
        transaction(alarmSql, async () => {
          const [previous] = await alarmDb
            .select()
            .from(alarmRecords)
            .where(eq(alarmRecords.id, alarm.id));
          const record = stampAlarm(previous?.body, alarm, env);
          await alarmDb
            .insert(alarms)
            .values({ id: alarm.id, data: alarm })
            .onConflictDoUpdate({ target: alarms.id, set: { data: alarm } });
          await alarmDb
            .insert(alarmRecords)
            .values({ id: alarm.id, body: record })
            .onConflictDoUpdate({ target: alarmRecords.id, set: { body: record } });
          await alarmDb.insert(outbox).values({ kind: "alarms", recordId: alarm.id, body: record });
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
      local(() =>
        transaction(collectionSql, async () => {
          const settings = updateThemeSettings(await readSettings(), patch, env);
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
