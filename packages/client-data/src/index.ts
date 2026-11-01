import { drizzle } from "drizzle-orm/sqlite-proxy";
import { eq, sql } from "drizzle-orm";
import { Context, Effect, Layer, Semaphore } from "effect";
import {
  uuid7,
  deckPreset,
  schedulingOptions,
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
  type AlarmEvent,
  stampAlarm,
  alarmTombstone,
  runCommand,
  runStudyAction,
  type StudyAction,
  type UndoStep,
} from "@app/core";
import {
  settings as settingsTable,
  alarms,
  alarmEvents,
  alarmRecords,
  outbox,
  reviewLog,
  tombstones,
} from "./schema.ts";
import { syncEngine, type UnsafeMediaName } from "./sync.ts";
import { memoryMediaFiles, type MediaFiles, type MediaStorageRefused } from "./media.ts";
import {
  ankiDroidEngine,
  type AnkiDroidProvider,
  type WritebackNotRecorded,
  type DeckNotLinked,
  type PullSummary,
  type SyncBackSummary,
  type SyncBackStatus,
  type SyncBackFailure,
} from "./ankidroid.ts";
import { openCollectionStore } from "./collection.ts";
import {
  core,
  inBatches,
  migrate,
  query,
  StorageFailed,
  transaction,
  type CommandRejected,
  type ExecuteSql,
} from "./sql.ts";

export { AccountMismatch, UnsafeMediaName, type MediaSyncResult, type SyncResult } from "./sync.ts";
export { MediaStorageRefused, memoryMediaFiles, type MediaFiles } from "./media.ts";
export {
  WritebackNotRecorded,
  DeckNotLinked,
  type AnkiDroidProvider,
  type PullSummary,
  type SyncBackSummary,
  type SyncBackStatus,
  type SyncBackFailure,
} from "./ankidroid.ts";
export { syncScheduler, type SyncScheduler, type SyncStatus } from "./scheduler.ts";
export {
  accountSync,
  AccountFailed,
  mediaNotice,
  type Account,
  type AccountData,
  type AccountState,
  type AccountSync,
  type AccountUser,
} from "./account.ts";
export { CommandRejected, StorageFailed, type ExecuteSql } from "./sql.ts";
export { ApkgUnreadable, ApkgWriteFailed, DeckMissing, exportApkg, importApkg } from "./apkg.ts";

export type { AlarmEvent } from "@app/core";
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
/** A write Core checks: the database can fail, and Core can refuse it. */
type Rejectable = StorageFailed | CommandRejected;
type Engine = Omit<ReturnType<typeof syncEngine>, "writeMediaFiles" | "recordMedia">;
interface Data extends Engine {
  /**
   * Stores media files under their names, before the records that use them, and records each one's
   * SHA-256 so sync uploads it. The same bytes again queue nothing. Fails with
   * `MediaStorageRefused` when the device won't store, and `UnsafeMediaName` on an unsafe name.
   */
  storeMedia: (
    files: readonly { name: string; bytes: () => Promise<Uint8Array> }[],
  ) => Effect.Effect<number, MediaStorageRefused | UnsafeMediaName | StorageFailed>;
  /** Calls `listener` after each local write commits, to schedule a sync. Returns unsubscribe. */
  subscribe: (listener: () => void) => () => void;
  collection: Effect.Effect<CollectionState, StorageFailed>;
  /**
   * Merges an Anki package into the collection and appends its review log in one transaction.
   * Store the package's media files first. Importing the same package again adds no entries, and
   * neither does importing an export of the app's own reviews.
   */
  importAnki: (source: AnkiPackage) => Effect.Effect<ImportSummary, Rejectable>;
  reviewLog: Effect.Effect<LogEntry[], StorageFailed>;
  /**
   * Appends a review and its outbox record. With a ring id the answer belongs to that ring's alarm
   * session: daily limits and due dates don't hold it back.
   */
  answerCard: (
    cardId: string,
    grade: Grade,
    durationMs: number,
    ringId?: string,
  ) => Effect.Effect<LogEntry, Rejectable>;
  /** Forget: appends a reset. */
  forgetCard: (cardId: string) => Effect.Effect<LogEntry, Rejectable>;
  /** Appends a set due date at the start of the study day `days` from today. */
  setDueDate: (cardId: string, days: number) => Effect.Effect<LogEntry, Rejectable>;
  /** Appends a void for one earlier review, reset or set due date. */
  undo: (entryId: string) => Effect.Effect<LogEntry, Rejectable>;
  changeCollection: (
    command: (collection: Collection) => void,
  ) => Effect.Effect<CollectionState, Rejectable>;
  /** Takes a card-menu action (suspend, bury, flag, mark); resolves with the step that undoes it. */
  studyAction: (action: StudyAction) => Effect.Effect<UndoStep, Rejectable>;
  /** Reverses one study step as a normal edit that syncs: a void, or the step's command. */
  undoStudy: (step: UndoStep) => Effect.Effect<void, Rejectable>;
  /**
   * Imports an AnkiDroid deck as a linked deck owned by this phone, with a snapshot for each
   * reviewed card, in one transaction. Linking again updates it. Resolves with the deck's id.
   */
  linkAnkiDroidDeck: (source: AnkiDroidSource) => Effect.Effect<string, Rejectable>;
  /** Earlier answers awaiting the user's choice, including a linked deck's subdecks. */
  ankiDroidLinkOffer: (deckId: string) => Effect.Effect<number, StorageFailed>;
  /** Accept releases these answers for sync back; decline records them as sent locally. */
  resolveAnkiDroidLinkOffer: (deckId: string, send: boolean) => Effect.Effect<void, StorageFailed>;
  /** This phone's id: the `linkedBy` of the decks it linked. */
  deviceId: string;
  /**
   * Sends every review of this phone's linked cards not sent yet, from any origin, to AnkiDroid as
   * answers, in answer-time order. Each answer is checked and recorded before the next goes.
   */
  syncBackAnkiDroid: (
    provider: AnkiDroidProvider,
  ) => Effect.Effect<SyncBackSummary, StorageFailed | WritebackNotRecorded | Error>;
  ankiDroidSyncBackStatus: Effect.Effect<SyncBackStatus, StorageFailed>;
  setAnkiDroidSyncBackFailure: (
    failure: SyncBackFailure | null,
  ) => Effect.Effect<void, StorageFailed>;
  /** Syncs back, then brings in the linked deck's new notes, edited fields and newer states. */
  pullAnkiDroid: (
    provider: AnkiDroidProvider,
    deckId: string,
  ) => Effect.Effect<PullSummary, Rejectable | WritebackNotRecorded | DeckNotLinked | Error>;
  /** Whether sync back runs automatically; on unless turned off. This phone only. */
  autoSyncBack: Effect.Effect<boolean, StorageFailed>;
  setAutoSyncBack: (on: boolean) => Effect.Effect<void, StorageFailed>;
  alarms: Effect.Effect<Alarm[], StorageFailed>;
  saveAlarm: (alarm: Alarm) => Effect.Effect<void, StorageFailed>;
  /** Deletes an alarm with a tombstone that syncs: no edit from another device brings it back. */
  deleteAlarm: (alarmId: string) => Effect.Effect<void, StorageFailed>;
  /**
   * Stores native's journal events not stored yet, each queued to sync (append-only, like
   * reviews). Draining the same events again changes nothing.
   */
  ingestEvents: (events: readonly AlarmEvent[]) => Effect.Effect<void, StorageFailed>;
  events: Effect.Effect<AlarmEvent[], StorageFailed>;
  settings: Effect.Effect<Settings, StorageFailed>;
  setTheme: (patch: Partial<ThemeChoice>) => Effect.Effect<Settings, StorageFailed>;
  pendingChanges: Effect.Effect<PendingChange[], StorageFailed>;
}
export class ClientData extends Context.Service<ClientData, Data>()("ClientData") {}
export interface SQLiteConnection {
  connect: (database: "collection.db" | "anki-alarm.db") => ExecuteSql;
  now: () => number;
  random: () => Uint8Array;
  /** Where this app's answers come from: the review's origin outside an alarm (default phone). */
  origin?: "phone" | "web";
}
export class SQLiteDriver extends Context.Service<SQLiteDriver, SQLiteConnection>()(
  "SQLiteDriver",
) {}
/** Where the app keeps media files. */
export class MediaDriver extends Context.Service<MediaDriver, MediaFiles>()("MediaDriver") {}

export const ClientDataLive = Layer.effect(
  ClientData,
  Effect.gen(function* () {
    const driver = yield* SQLiteDriver;
    const media = yield* MediaDriver;
    return yield* open(driver, media);
  }),
);
/** The service over the app's SQLite and media files. Tests may leave media in memory. */
export const clientDataLayer = (driver: SQLiteConnection, media: MediaFiles = memoryMediaFiles()) =>
  ClientDataLive.pipe(
    Layer.provide([Layer.succeed(SQLiteDriver, driver), Layer.succeed(MediaDriver, media)]),
  );

const open = (driver: SQLiteConnection, media: MediaFiles) =>
  Effect.gen(function* () {
    const collectionSql = driver.connect("collection.db");
    const alarmSql = driver.connect("anki-alarm.db");
    const store = yield* openCollectionStore(collectionSql, driver);
    yield* migrate(alarmSql, "anki-alarm.db");
    const listeners = new Set<() => void>();
    const notify = () => {
      for (const listener of listeners) listener();
    };
    // Local operations run one at a time, in the order they were asked for.
    const lock = Semaphore.makeUnsafe(1);
    const serial = <A, E>(operation: Effect.Effect<A, E>) => lock.withPermit(operation);
    /** Runs a local write in the queue and tells subscribers once it committed. */
    const local = <A, E>(operation: Effect.Effect<A, E>) =>
      serial(operation).pipe(Effect.tap(() => Effect.sync(notify)));
    const inCollection = <A, E>(operation: Effect.Effect<A, E>) =>
      transaction(collectionSql, operation);
    const inAlarms = <A, E>(operation: Effect.Effect<A, E>) => transaction(alarmSql, operation);
    const collectionDb = drizzle(collectionSql);
    const alarmDb = drizzle(alarmSql);
    const env = { ...driver, deviceId: store.deviceId };
    const readSettings = Effect.map(
      query(() => collectionDb.select().from(settingsTable)),
      (rows) => rows[0]?.body,
    );
    if (!(yield* readSettings)) {
      const initial = updateThemeSettings(undefined, {}, env);
      yield* inCollection(
        Effect.gen(function* () {
          yield* query(() =>
            collectionDb.insert(settingsTable).values({ id: initial.id, body: initial }),
          );
          yield* query(() =>
            collectionDb
              .insert(outbox)
              .values({ kind: "settings", recordId: initial.id, body: initial }),
          );
        }),
      );
    }
    const readLog = Effect.map(
      query(() => collectionDb.select().from(reviewLog)),
      (rows) => rows.map((r) => r.body),
    );
    /** Appends one entry Core accepts, with its outbox record, in one transaction. */
    const append = (
      build: (
        state: CollectionState,
        log: LogEntry[],
        entry: { id: string; at: number },
      ) => LogEntry,
    ) =>
      local(
        inCollection(
          Effect.gen(function* () {
            const state = yield* store.read;
            const log = yield* readLog;
            const at = driver.now();
            const entry = yield* core(() => {
              const built = build(state, log, { id: uuid7(at, driver.random()), at });
              checkLogEntry(state, log, built);
              return built;
            });
            yield* query(() =>
              collectionDb.insert(reviewLog).values({ id: entry.id, body: entry }),
            );
            yield* query(() =>
              collectionDb
                .insert(outbox)
                .values({ kind: "reviewLog", recordId: entry.id, body: entry }),
            );
            return entry;
          }),
        ),
      );
    /** Appends the entries not yet in the log, with their outbox records; inside a transaction. */
    const appendNew = (log: readonly LogEntry[]) =>
      Effect.gen(function* () {
        const known = new Set(
          (yield* query(() => collectionDb.select({ id: reviewLog.id }).from(reviewLog))).map(
            (r) => r.id,
          ),
        );
        const added = log.filter((entry) => !known.has(entry.id));
        yield* inBatches(added, async (batch) => {
          await collectionDb.insert(reviewLog).values(batch.map((e) => ({ id: e.id, body: e })));
          await collectionDb
            .insert(outbox)
            .values(batch.map((e) => ({ kind: "reviewLog", recordId: e.id, body: e })));
        });
        return added.length;
      });
    const ankiDroid = ankiDroidEngine({
      db: collectionDb,
      deviceId: store.deviceId,
      now: driver.now,
      read: serial,
      write: (operation) => serial(inCollection(operation)),
      readCollection: store.read,
      readLog,
      runCollection: store.run,
      appendNew,
      notify,
    });
    const { writeMediaFiles, recordMedia, ...engine } = syncEngine({
      collectionDb,
      alarmDb,
      serial,
      inCollection,
      inAlarms,
      env,
      media,
    });
    /** The alarm's synced record; an alarm from before sync has none yet and is stamped now. */
    const alarmRecordOf = (alarmId: string) =>
      Effect.gen(function* () {
        const [record] = yield* query(() =>
          alarmDb.select().from(alarmRecords).where(eq(alarmRecords.id, alarmId)),
        );
        if (record) return record.body;
        const [row] = yield* query(() =>
          alarmDb.select().from(alarms).where(eq(alarms.id, alarmId)),
        );
        return row && stampAlarm(undefined, readAlarm(row.data), env);
      });
    const isDeleted = (alarmId: string) =>
      Effect.map(
        query(() => alarmDb.select().from(tombstones).where(eq(tombstones.id, alarmId))),
        (rows) => rows.length > 0,
      );
    const data: Data = {
      ...engine,
      storeMedia: (files) =>
        writeMediaFiles(files).pipe(Effect.flatMap((stored) => local(recordMedia(stored)))),
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
          const deck = state.decks.find((d) => d.id === card.fields.deckId.value);
          const preset = deck && deckPreset(state, deck);
          if (!preset) throw new Error("Deck preset missing");
          return {
            ...base,
            options: schedulingOptions(preset, base.at),
            kind: "review",
            cardId,
            grade,
            durationMs,
            ...(ringId === undefined
              ? { origin: driver.origin ?? "phone" }
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
        local(
          Effect.gen(function* () {
            let entries = 0;
            // Local writes run one at a time: the log can't change before the import commits.
            const known = yield* readLog;
            const { result } = yield* store.run(
              (collection) => collection.importAnki(source, known),
              ({ log }) =>
                Effect.map(appendNew(log), (added) => {
                  entries = added;
                }),
            );
            const summary: ImportSummary = { notes: result.notes, cards: result.cards, entries };
            return summary;
          }),
        ),
      deviceId: store.deviceId,
      linkAnkiDroidDeck: (source) => Effect.map(ankiDroid.link(source), (link) => link.deckId),
      ankiDroidLinkOffer: ankiDroid.offer,
      resolveAnkiDroidLinkOffer: ankiDroid.resolveOffer,
      syncBackAnkiDroid: ankiDroid.syncBack,
      ankiDroidSyncBackStatus: ankiDroid.status,
      setAnkiDroidSyncBackFailure: ankiDroid.setFailure,
      pullAnkiDroid: ankiDroid.pull,
      autoSyncBack: ankiDroid.autoSyncBack,
      setAutoSyncBack: ankiDroid.setAutoSyncBack,
      changeCollection: (command) => local(store.change(command)),
      studyAction: (action) =>
        local(
          Effect.map(
            store.run((c) => runStudyAction(c, action)),
            ({ result }) => result,
          ),
        ),
      undoStudy: (step) =>
        step.kind === "void"
          ? Effect.asVoid(data.undo(step.entryId))
          : Effect.asVoid(local(store.change((c) => void runCommand(c, step.command)))),
      alarms: serial(
        Effect.map(
          query(() =>
            alarmDb
              .select()
              .from(alarms)
              .orderBy(sql`rowid`),
          ),
          (rows) => rows.map((row) => readAlarm(row.data)),
        ),
      ),
      saveAlarm: (alarm) =>
        local(
          inAlarms(
            Effect.gen(function* () {
              // A deleted alarm stays deleted: an editor still open on it saves nothing.
              if (yield* isDeleted(alarm.id)) return;
              const [previous] = yield* query(() =>
                alarmDb.select().from(alarmRecords).where(eq(alarmRecords.id, alarm.id)),
              );
              const record = stampAlarm(previous?.body, alarm, env);
              yield* query(() =>
                alarmDb
                  .insert(alarms)
                  .values({ id: alarm.id, data: alarm })
                  .onConflictDoUpdate({ target: alarms.id, set: { data: alarm } }),
              );
              yield* query(() =>
                alarmDb
                  .insert(alarmRecords)
                  .values({ id: alarm.id, body: record })
                  .onConflictDoUpdate({ target: alarmRecords.id, set: { body: record } }),
              );
              yield* query(() =>
                alarmDb.insert(outbox).values({ kind: "alarms", recordId: alarm.id, body: record }),
              );
            }),
          ),
        ),
      deleteAlarm: (alarmId) =>
        local(
          inAlarms(
            Effect.gen(function* () {
              if (yield* isDeleted(alarmId)) return;
              const previous = yield* alarmRecordOf(alarmId);
              if (!previous) return;
              const tombstone = alarmTombstone(previous, env);
              yield* query(() =>
                alarmDb.insert(tombstones).values({ id: alarmId, body: tombstone }),
              );
              yield* query(() => alarmDb.delete(alarms).where(eq(alarms.id, alarmId)));
              yield* query(() => alarmDb.delete(alarmRecords).where(eq(alarmRecords.id, alarmId)));
              yield* query(() =>
                alarmDb
                  .insert(outbox)
                  .values({ kind: "tombstones", recordId: alarmId, body: tombstone }),
              );
            }),
          ),
        ),
      ingestEvents: (events) =>
        serial(
          inAlarms(
            Effect.gen(function* () {
              const known = new Set(
                (yield* query(() => alarmDb.select({ id: alarmEvents.id }).from(alarmEvents))).map(
                  (r) => r.id,
                ),
              );
              let added = 0;
              for (const event of events) {
                if (known.has(event.id)) continue;
                known.add(event.id);
                added += 1;
                yield* query(() =>
                  alarmDb.insert(alarmEvents).values({ id: event.id, data: event }),
                );
                yield* query(() =>
                  alarmDb
                    .insert(outbox)
                    .values({ kind: "alarmEvent", recordId: event.id, body: event }),
                );
              }
              return added;
            }),
          ),
        ).pipe(
          // New events are a local write: the sync scheduler hears them.
          Effect.flatMap((added) => Effect.sync(() => (added > 0 ? notify() : undefined))),
        ),
      events: serial(
        Effect.map(
          query(() =>
            alarmDb
              .select()
              .from(alarmEvents)
              .orderBy(sql`rowid`),
          ),
          (rows) => rows.map((row) => row.data),
        ),
      ),
      settings: serial(
        Effect.flatMap(readSettings, (settings) =>
          settings ? Effect.succeed(settings) : new StorageFailed({ message: "Settings missing" }),
        ),
      ),
      setTheme: (patch) =>
        local(
          inCollection(
            Effect.gen(function* () {
              const settings = updateThemeSettings(yield* readSettings, patch, env);
              yield* query(() =>
                collectionDb
                  .insert(settingsTable)
                  .values({ id: settings.id, body: settings })
                  .onConflictDoUpdate({ target: settingsTable.id, set: { body: settings } }),
              );
              yield* query(() =>
                collectionDb
                  .insert(outbox)
                  .values({ kind: "settings", recordId: settings.id, body: settings }),
              );
              return settings;
            }),
          ),
        ),
      pendingChanges: serial(
        Effect.gen(function* () {
          const changes: PendingChange[] = [];
          for (const database of ["collection.db", "anki-alarm.db"] as const) {
            const db = database === "collection.db" ? collectionDb : alarmDb;
            for (const row of yield* query(() => db.select().from(outbox).orderBy(outbox.sequence)))
              changes.push({ database, ...row });
          }
          return changes;
        }),
      ),
    };
    return data;
  });
