/* oxlint-disable eslint/no-await-in-loop -- SQLite transactions apply changes in order. */
// The push/pull engine of ADR 0001. One sync is metadata, a push of the outbox, then pulls from
// the stored cursor until the Worker has nothing more. Core decides every merge.
import {
  alarmFromRecord,
  readAlarm,
  parseRecord,
  resolveChange,
  stampAlarm,
  SYNC_PROTOCOL,
  type AlarmRecord,
  type CollectionEnvironment,
  type SyncChange,
  type Tombstone,
} from "@app/core";
import { MAX_CHANGES, UpdateRequired, type Change, type SyncClient } from "@app/contracts";
import { eq, sql } from "drizzle-orm";
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { Data, Effect } from "effect";
import {
  alarmRecords,
  alarms,
  cards,
  decks,
  metadata,
  noteTypes,
  notes,
  outbox,
  presets,
  reviewLog,
  settings,
  tombstones,
} from "./schema.ts";

/** What one sync did, so the app refreshes what changed (theme, alarms, decks). */
export interface SyncResult {
  pushed: number;
  pulled: number;
  /** The kinds of the pulled changes that changed something here. */
  changed: string[];
}

/** The signed-in account isn't the one this device adopted. Sign in to it, or adopt this one. */
export class AccountMismatch extends Data.TaggedError("AccountMismatch")<{ message: string }> {}

const recordTables = { decks, presets, noteTypes, notes, cards } as const;
type RecordTable = keyof typeof recordTables;
const RECORD_TABLES = ["decks", "presets", "noteTypes", "notes", "cards"] as const;
const isRecordTable = (kind: string): kind is RecordTable => kind in recordTables;

/** The contract checks a change's envelope; Core's types describe its records. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const toCore = (change: Change) => change as SyncChange;

export interface EngineDeps {
  collectionDb: SqliteRemoteDatabase;
  alarmDb: SqliteRemoteDatabase;
  /** Runs a database operation in the service's queue. */
  serial: <A>(operation: () => Promise<A>) => Effect.Effect<A, Error>;
  /** Runs `operation` in one transaction on that database. */
  inCollection: <A>(operation: () => Promise<A>) => Promise<A>;
  inAlarms: <A>(operation: () => Promise<A>) => Promise<A>;
  env: CollectionEnvironment;
}

export function syncEngine({
  collectionDb,
  alarmDb,
  serial,
  inCollection,
  inAlarms,
  env,
}: EngineDeps) {
  const readMeta = async (id: string) =>
    (await collectionDb.select().from(metadata).where(eq(metadata.id, id)))[0]?.value;
  const writeMeta = (id: string, value: string) =>
    collectionDb
      .insert(metadata)
      .values({ id, value })
      .onConflictDoUpdate({ target: metadata.id, set: { value } });

  /** The record native's `alarms` row is synced as. An alarm from before sync gets stamped now. */
  const alarmRecord = async (id: string): Promise<AlarmRecord | undefined> => {
    const record = (await alarmDb.select().from(alarmRecords).where(eq(alarmRecords.id, id)))[0];
    if (record) return record.body;
    const alarm = (await alarmDb.select().from(alarms).where(eq(alarms.id, id)))[0];
    return (
      alarm &&
      // Alarms saved before sounds, decks or N get their defaults.
      stampAlarm(undefined, readAlarm(alarm.data), env)
    );
  };

  /** Everything this device holds, for the first sync into an account. */
  const everything = async (): Promise<Change[]> => {
    const changes: Change[] = [];
    for (const kind of RECORD_TABLES)
      // Records from before the current shape upload as Core reads them now.
      for (const row of await collectionDb.select().from(recordTables[kind]))
        changes.push({ kind, record: parseRecord(kind, row.body) });
    for (const row of await collectionDb.select().from(tombstones))
      changes.push({ kind: "tombstone", tombstone: row.body });
    for (const row of await collectionDb.select().from(settings))
      changes.push({ kind: "settings", record: row.body });
    for (const row of await collectionDb.select().from(reviewLog))
      changes.push({ kind: "reviewLog", entry: row.body });
    for (const row of await alarmDb.select({ id: alarms.id }).from(alarms)) {
      const record = await alarmRecord(row.id);
      if (record) changes.push({ kind: "alarms", record });
    }
    return changes;
  };

  /** The outbox, latest body per record, and the highest sequence read in each database. */
  const queued = async () => {
    const latest = new Map<string, Change>();
    const marks = { collection: 0, alarms: 0 };
    for (const database of ["collection", "alarms"] as const) {
      const db = database === "collection" ? collectionDb : alarmDb;
      for (const row of await db.select().from(outbox).orderBy(outbox.sequence)) {
        marks[database] = row.sequence;
        const change = await outboxChange(row.kind, row.recordId, row.body);
        if (change) latest.set(`${row.kind}:${row.recordId}`, change);
      }
    }
    return { changes: [...latest.values()], marks };
  };
  const outboxChange = async (kind: string, id: string, body: unknown): Promise<Change | null> => {
    // Outbox bodies are the records their own tables hold.
    // oxlint-disable typescript/no-unsafe-type-assertion
    if (kind === "tombstones") return { kind: "tombstone", tombstone: body as Tombstone };
    if (kind === "reviewLog") return { kind: "reviewLog", entry: body as never };
    if (kind === "settings") return { kind, record: body as never };
    // oxlint-enable typescript/no-unsafe-type-assertion
    if (kind === "alarms") {
      const record = await alarmRecord(id);
      return record ? { kind, record } : null;
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return isRecordTable(kind) ? { kind, record: body as never } : null;
  };
  const acknowledge = (marks: { collection: number; alarms: number }, full: boolean) =>
    serial(async () => {
      await inCollection(async () => {
        await collectionDb.delete(outbox).where(sql`${outbox.sequence} <= ${marks.collection}`);
        if (full) await collectionDb.delete(metadata).where(eq(metadata.id, "syncFullUpload"));
      });
      await alarmDb.delete(outbox).where(sql`${outbox.sequence} <= ${marks.alarms}`);
    });

  /** What a slot holds here, in the shape `resolveChange` compares. */
  const stored = async (change: SyncChange): Promise<SyncChange | undefined> => {
    if (change.kind === "reviewLog") {
      const row = (
        await collectionDb.select().from(reviewLog).where(eq(reviewLog.id, change.entry.id))
      )[0];
      return row && { kind: "reviewLog", entry: row.body };
    }
    if (change.kind === "settings") {
      const row = (await collectionDb.select().from(settings))[0];
      return row && { kind: "settings", record: row.body };
    }
    if (change.kind === "alarms") {
      const record = await alarmRecord(change.record.id);
      return record && { kind: "alarms", record };
    }
    const id = change.kind === "tombstone" ? change.tombstone.id : change.record.id;
    const kind = change.kind === "tombstone" ? change.tombstone.kind : change.kind;
    const tombstone = (
      await collectionDb.select().from(tombstones).where(eq(tombstones.id, id))
    )[0];
    if (tombstone?.body.kind === kind) return { kind: "tombstone", tombstone: tombstone.body };
    if (!isRecordTable(kind)) return undefined;
    const table = recordTables[kind];
    const row = (await collectionDb.select().from(table).where(eq(table.id, id)))[0];
    return row && { kind, record: parseRecord(kind, row.body) };
  };
  const write = async (change: SyncChange) => {
    if (change.kind === "reviewLog") {
      await collectionDb.insert(reviewLog).values({ id: change.entry.id, body: change.entry });
    } else if (change.kind === "settings") {
      // One settings record per device: merge into it whatever id the account's record has.
      const local = (await collectionDb.select().from(settings))[0];
      const record = { ...change.record, id: local?.id ?? change.record.id };
      // The merged record keeps the settings fields.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const body = record as never;
      await collectionDb
        .insert(settings)
        .values({ id: record.id, body })
        .onConflictDoUpdate({ target: settings.id, set: { body } });
    } else if (change.kind === "alarms") {
      // Synced alarm records are written only by stampAlarm and its merges.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const record = change.record as AlarmRecord;
      const alarm = alarmFromRecord(record);
      await alarmDb
        .insert(alarmRecords)
        .values({ id: record.id, body: record })
        .onConflictDoUpdate({ target: alarmRecords.id, set: { body: record } });
      await alarmDb
        .insert(alarms)
        .values({ id: alarm.id, data: alarm })
        .onConflictDoUpdate({ target: alarms.id, set: { data: alarm } });
    } else if (change.kind === "tombstone") {
      const { tombstone } = change;
      await collectionDb
        .insert(tombstones)
        .values({ id: tombstone.id, body: tombstone })
        .onConflictDoUpdate({ target: tombstones.id, set: { body: tombstone } });
      const table = recordTables[tombstone.kind];
      await collectionDb.delete(table).where(eq(table.id, tombstone.id));
    } else if (isRecordTable(change.kind)) {
      const table = recordTables[change.kind];
      // The record is of the table's kind.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const body = change.record as never;
      await collectionDb
        .insert(table)
        .values({ id: change.record.id, body })
        .onConflictDoUpdate({ target: table.id, set: { body } });
    }
  };
  /** Applies one pulled page and its cursor. Alarms commit first: re-applying them is harmless. */
  const apply = (page: readonly Change[], cursor: number) =>
    serial(async () => {
      const changed = new Set<string>();
      const resolveAll = async (changes: readonly Change[]) => {
        for (const change of changes) {
          const winner = resolveChange(await stored(toCore(change)), toCore(change));
          if (!winner) continue;
          await write(winner);
          changed.add(winner.kind);
        }
      };
      await inAlarms(() => resolveAll(page.filter((c) => c.kind === "alarms")));
      await inCollection(async () => {
        await resolveAll(page.filter((c) => c.kind !== "alarms"));
        await writeMeta("syncCursor", String(cursor));
      });
      return changed;
    });

  return {
    syncAccount: serial(async () => (await readMeta("syncAccount")) ?? null),
    /** Makes `userId` this device's account. Local data merges into it on the next sync. */
    adoptAccount: (userId: string) =>
      serial(() =>
        inCollection(async () => {
          await writeMeta("syncAccount", userId);
          await writeMeta("syncCursor", "0");
          await writeMeta("syncFullUpload", "1");
        }),
      ),
    sync: (client: SyncClient) =>
      Effect.gen(function* () {
        const account = yield* serial(() => readMeta("syncAccount"));
        const meta = yield* client.metadata.metadata();
        if (meta.syncProtocol !== SYNC_PROTOCOL)
          return yield* new UpdateRequired({ syncProtocol: meta.syncProtocol });
        if (account !== meta.userId)
          return yield* new AccountMismatch({ message: "Signed in to another account" });
        const full = yield* serial(async () => (await readMeta("syncFullUpload")) === "1");
        const { changes, marks } = yield* serial(queued);
        const outgoing = full ? yield* serial(everything) : changes;
        for (let i = 0; i < outgoing.length; i += MAX_CHANGES)
          yield* client.changes.push({ payload: { changes: outgoing.slice(i, i + MAX_CHANGES) } });
        yield* acknowledge(marks, full);
        const changed = new Set<string>();
        let pulled = 0;
        let more = true;
        while (more) {
          const cursor = Number(yield* serial(async () => (await readMeta("syncCursor")) ?? "0"));
          const page = yield* client.changes.pull({ payload: { cursor } });
          for (const kind of yield* apply(page.changes, page.cursor)) changed.add(kind);
          pulled += page.changes.length;
          more = page.more && page.cursor > cursor;
        }
        const result: SyncResult = { pushed: outgoing.length, pulled, changed: [...changed] };
        return result;
      }),
  };
}
