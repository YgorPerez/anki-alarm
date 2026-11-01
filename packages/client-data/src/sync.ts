// The push/pull engine of ADR 0001. One sync is metadata, a push of the outbox, then pulls from
// the stored cursor until the Worker has nothing more. Core decides every merge. Media files the
// push needs upload first; after the pull, every file the notes use is downloaded.
import {
  alarmFromRecord,
  mediaFromRecord,
  mediaPushPlan,
  mediaReferences,
  importId,
  safeMediaName,
  stampMedia,
  readAlarm,
  parseRecord,
  resolveChange,
  stampAlarm,
  SYNC_PROTOCOL,
  type AlarmRecord,
  type CollectionEnvironment,
  type SyncChange,
  type MediaRecord,
  type Tombstone,
} from "@app/core";
import { MAX_CHANGES, UpdateRequired, type Change, type SyncClient } from "@app/contracts";
import { eq, sql } from "drizzle-orm";
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { Cause, Data, Effect, Exit } from "effect";
import { MediaStorageRefused, type MediaFiles } from "./media.ts";
import {
  alarmEvents,
  alarmRecords,
  alarms,
  cards,
  decks,
  media as mediaTable,
  mediaLocal,
  metadata,
  noteTypes,
  notes,
  outbox,
  presets,
  reviewLog,
  settings,
  tombstones,
} from "./schema.ts";
import { inBatches, query, storageFailed, type StorageFailed } from "./sql.ts";

/** What one sync did, so the app refreshes what changed (theme, alarms, decks). */
export interface SyncResult {
  pushed: number;
  media: MediaSyncResult;
  pulled: number;
  /** The kinds of the pulled changes that changed something here. */
  changed: string[];
}

/** The signed-in account isn't the one this device adopted. Sign in to it, or adopt this one. */
export class AccountMismatch extends Data.TaggedError("AccountMismatch")<{ message: string }> {}
/** A media file name that could leave the media folder, or isn't a name at all. */
export class UnsafeMediaName extends Data.TaggedError("UnsafeMediaName")<{ message: string }> {}

const recordTables = { decks, presets, noteTypes, notes, cards } as const;
type RecordTable = keyof typeof recordTables;
const RECORD_TABLES = ["decks", "presets", "noteTypes", "notes", "cards"] as const;
const isRecordTable = (kind: string): kind is RecordTable => kind in recordTables;
/** Alarms, their deletes and their journal live in anki-alarm.db; everything else in collection.db. */
const inAlarmDb = (change: Change) =>
  change.kind === "alarms" ||
  change.kind === "alarmEvent" ||
  (change.kind === "tombstone" && change.tombstone.kind === "alarms");

/** The contract checks a change's envelope; Core's types describe its records. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const toCore = (change: Change) => change as SyncChange;

/** What one sync did with media files. */
export interface MediaSyncResult {
  /** Files uploaded before the push. */
  uploaded: number;
  /** Changes left in the outbox because a file they use didn't upload. */
  heldBack: number;
  /** Files downloaded after the pull. */
  downloaded: number;
  /** Files the notes use that this device still lacks. */
  missing: number;
  /** The device refused to store a file. Say so; the files stay missing until it stores again. */
  storageRefused: boolean;
}

/** How many media files move at once. */
const MEDIA_CONCURRENCY = 4;
/** A media store failure: a refusal stays one, anything else is a storage failure. */
const mediaFailure = (cause: unknown) =>
  cause instanceof MediaStorageRefused ? cause : storageFailed(cause);

export interface EngineDeps {
  collectionDb: SqliteRemoteDatabase;
  alarmDb: SqliteRemoteDatabase;
  /** Runs a database operation in the service's queue. */
  serial: <A, E>(operation: Effect.Effect<A, E>) => Effect.Effect<A, E>;
  /** Runs `operation` in one transaction on that database. */
  inCollection: <A, E>(operation: Effect.Effect<A, E>) => Effect.Effect<A, E | StorageFailed>;
  inAlarms: <A, E>(operation: Effect.Effect<A, E>) => Effect.Effect<A, E | StorageFailed>;
  env: CollectionEnvironment;
  media: MediaFiles;
}

/** Runs a media step; a failure of any kind, defects included, is its result, not the sync's. */
const attempt = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.map(Effect.exit(effect), (exit) =>
    Exit.isSuccess(exit)
      ? { ok: true as const, value: exit.value }
      : { ok: false as const, cause: exit.cause },
  );
export function syncEngine({
  collectionDb,
  alarmDb,
  serial,
  inCollection,
  inAlarms,
  env,
  media,
}: EngineDeps) {
  const readMeta = (id: string) =>
    Effect.map(
      query(() => collectionDb.select().from(metadata).where(eq(metadata.id, id))),
      (rows) => rows[0]?.value,
    );
  const writeMeta = (id: string, value: string) =>
    query(() =>
      collectionDb
        .insert(metadata)
        .values({ id, value })
        .onConflictDoUpdate({ target: metadata.id, set: { value } }),
    );

  /** The record native's `alarms` row is synced as. An alarm from before sync gets stamped now. */
  const alarmRecord = (id: string) =>
    Effect.gen(function* () {
      const [record] = yield* query(() =>
        alarmDb.select().from(alarmRecords).where(eq(alarmRecords.id, id)),
      );
      if (record) return record.body;
      const [alarm] = yield* query(() => alarmDb.select().from(alarms).where(eq(alarms.id, id)));
      // Alarms saved before sounds, decks or N get their defaults.
      const stamped: AlarmRecord | undefined =
        alarm && stampAlarm(undefined, readAlarm(alarm.data), env);
      return stamped;
    });

  /** Everything this device holds, for the first sync into an account. */
  const everything = Effect.gen(function* () {
    const changes: Change[] = [];
    for (const kind of RECORD_TABLES)
      // Records from before the current shape upload as Core reads them now.
      for (const row of yield* query(() => collectionDb.select().from(recordTables[kind])))
        changes.push({ kind, record: parseRecord(kind, row.body) });
    for (const row of yield* query(() => collectionDb.select().from(tombstones)))
      changes.push({ kind: "tombstone", tombstone: row.body });
    for (const row of yield* query(() => collectionDb.select().from(settings)))
      changes.push({ kind: "settings", record: row.body });
    for (const row of yield* query(() => collectionDb.select().from(mediaTable)))
      changes.push({ kind: "media", record: row.body });
    for (const row of yield* query(() => collectionDb.select().from(reviewLog)))
      changes.push({ kind: "reviewLog", entry: row.body });
    for (const row of yield* query(() => alarmDb.select().from(tombstones)))
      changes.push({ kind: "tombstone", tombstone: row.body });
    for (const row of yield* query(() => alarmDb.select({ id: alarms.id }).from(alarms))) {
      const record = yield* alarmRecord(row.id);
      if (record) changes.push({ kind: "alarms", record });
    }
    const events = yield* query(() =>
      alarmDb
        .select()
        .from(alarmEvents)
        .orderBy(sql`rowid`),
    );
    for (const row of events) changes.push({ kind: "alarmEvent", event: row.data });
    return changes;
  });

  const outboxChange = (kind: string, id: string, body: unknown) =>
    Effect.gen(function* () {
      // Outbox bodies are the records their own tables hold.
      // oxlint-disable typescript/no-unsafe-type-assertion
      if (kind === "tombstones")
        return { kind: "tombstone", tombstone: body as Tombstone } satisfies Change;
      if (kind === "reviewLog") return { kind: "reviewLog", entry: body as never } satisfies Change;
      if (kind === "alarmEvent")
        return { kind: "alarmEvent", event: body as never } satisfies Change;
      if (kind === "settings" || kind === "media")
        return { kind, record: body as never } satisfies Change;
      // oxlint-enable typescript/no-unsafe-type-assertion
      if (kind === "alarms") {
        const record = yield* alarmRecord(id);
        return record ? ({ kind, record } satisfies Change) : null;
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return isRecordTable(kind) ? ({ kind, record: body as never } satisfies Change) : null;
    });
  /** The outbox, latest body per record, and the highest sequence read in each database. */
  const queued = Effect.gen(function* () {
    const latest = new Map<string, Change>();
    const marks = { collection: 0, alarms: 0 };
    for (const database of ["collection", "alarms"] as const) {
      const db = database === "collection" ? collectionDb : alarmDb;
      for (const row of yield* query(() => db.select().from(outbox).orderBy(outbox.sequence))) {
        marks[database] = row.sequence;
        const change: Change | null = yield* outboxChange(row.kind, row.recordId, row.body);
        if (change) latest.set(`${row.kind}:${row.recordId}`, change);
      }
    }
    return { changes: [...latest.values()], marks };
  });
  /**
   * Clears what was pushed. Held-back changes (only collection records: notes, their cards and media)
   * stay queued; after a full upload they are queued again, since they came from the tables.
   */
  const acknowledge = (
    marks: { collection: number; alarms: number },
    full: boolean,
    held: readonly Change[],
  ) =>
    serial(
      Effect.gen(function* () {
        const kept = held.flatMap((change) =>
          change.kind === "tombstone" || change.kind === "reviewLog" || change.kind === "alarmEvent"
            ? []
            : [{ kind: change.kind, recordId: change.record.id, body: change.record }],
        );
        const keys = JSON.stringify(kept.map((k) => `${k.kind}:${k.recordId}`));
        yield* inCollection(
          Effect.gen(function* () {
            yield* query(() =>
              collectionDb
                .delete(outbox)
                .where(
                  sql`${outbox.sequence} <= ${marks.collection} AND (${outbox.kind} || ':' || ${outbox.recordId}) NOT IN (SELECT value FROM json_each(${keys}))`,
                ),
            );
            if (full) {
              yield* inBatches(kept, (batch) => collectionDb.insert(outbox).values(batch));
              yield* query(() =>
                collectionDb.delete(metadata).where(eq(metadata.id, "syncFullUpload")),
              );
            }
          }),
        );
        yield* query(() =>
          alarmDb.delete(outbox).where(sql`${outbox.sequence} <= ${marks.alarms}`),
        );
      }),
    );

  /** What a slot holds here, in the shape `resolveChange` compares. */
  const stored = (change: SyncChange) =>
    Effect.gen(function* () {
      if (change.kind === "reviewLog") {
        const [row] = yield* query(() =>
          collectionDb.select().from(reviewLog).where(eq(reviewLog.id, change.entry.id)),
        );
        return row && ({ kind: "reviewLog", entry: row.body } satisfies SyncChange);
      }
      if (change.kind === "alarmEvent") {
        const [row] = yield* query(() =>
          alarmDb.select().from(alarmEvents).where(eq(alarmEvents.id, change.event.id)),
        );
        return row && ({ kind: "alarmEvent", event: row.data } satisfies SyncChange);
      }
      if (change.kind === "settings") {
        const [row] = yield* query(() => collectionDb.select().from(settings));
        return row && ({ kind: "settings", record: row.body } satisfies SyncChange);
      }
      const alarmId =
        change.kind === "alarms"
          ? change.record.id
          : change.kind === "tombstone" && change.tombstone.kind === "alarms"
            ? change.tombstone.id
            : undefined;
      if (alarmId !== undefined) {
        const [deleted] = yield* query(() =>
          alarmDb.select().from(tombstones).where(eq(tombstones.id, alarmId)),
        );
        if (deleted) return { kind: "tombstone", tombstone: deleted.body } satisfies SyncChange;
        const record = yield* alarmRecord(alarmId);
        return record && ({ kind: "alarms", record } satisfies SyncChange);
      }
      if (change.kind === "media") {
        const [row] = yield* query(() =>
          collectionDb.select().from(mediaTable).where(eq(mediaTable.id, change.record.id)),
        );
        return row && ({ kind: "media", record: row.body } satisfies SyncChange);
      }
      const id = change.kind === "tombstone" ? change.tombstone.id : change.record.id;
      const kind = change.kind === "tombstone" ? change.tombstone.kind : change.kind;
      const [tombstone] = yield* query(() =>
        collectionDb.select().from(tombstones).where(eq(tombstones.id, id)),
      );
      if (tombstone?.body.kind === kind)
        return { kind: "tombstone", tombstone: tombstone.body } satisfies SyncChange;
      if (!isRecordTable(kind)) return undefined;
      const table = recordTables[kind];
      const [row] = yield* query(() => collectionDb.select().from(table).where(eq(table.id, id)));
      return row && ({ kind, record: parseRecord(kind, row.body) } satisfies SyncChange);
    });
  const write = (change: SyncChange) =>
    Effect.gen(function* () {
      if (change.kind === "reviewLog") {
        // A stored entry comes back only when its frozen options lost the merge (ADR 0008).
        yield* query(() =>
          collectionDb
            .insert(reviewLog)
            .values({ id: change.entry.id, body: change.entry })
            .onConflictDoUpdate({ target: reviewLog.id, set: { body: change.entry } }),
        );
      } else if (change.kind === "alarmEvent") {
        yield* query(() =>
          alarmDb.insert(alarmEvents).values({ id: change.event.id, data: change.event }),
        );
      } else if (change.kind === "settings") {
        // One settings record per device: merge into it whatever id the account's record has.
        const [local] = yield* query(() => collectionDb.select().from(settings));
        const record = { ...change.record, id: local?.id ?? change.record.id };
        // The merged record keeps the settings fields.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const body = record as never;
        yield* query(() =>
          collectionDb
            .insert(settings)
            .values({ id: record.id, body })
            .onConflictDoUpdate({ target: settings.id, set: { body } }),
        );
      } else if (change.kind === "alarms") {
        // Synced alarm records are written only by stampAlarm and its merges.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const record = change.record as AlarmRecord;
        const alarm = alarmFromRecord(record);
        yield* query(() =>
          alarmDb
            .insert(alarmRecords)
            .values({ id: record.id, body: record })
            .onConflictDoUpdate({ target: alarmRecords.id, set: { body: record } }),
        );
        yield* query(() =>
          alarmDb
            .insert(alarms)
            .values({ id: alarm.id, data: alarm })
            .onConflictDoUpdate({ target: alarms.id, set: { data: alarm } }),
        );
      } else if (change.kind === "media") {
        // Media records are written only by stampMedia and its merges.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const body = change.record as MediaRecord;
        yield* query(() =>
          collectionDb
            .insert(mediaTable)
            .values({ id: body.id, body })
            .onConflictDoUpdate({ target: mediaTable.id, set: { body } }),
        );
      } else if (change.kind === "tombstone" && change.tombstone.kind === "alarms") {
        const { tombstone } = change;
        yield* query(() =>
          alarmDb
            .insert(tombstones)
            .values({ id: tombstone.id, body: tombstone })
            .onConflictDoUpdate({ target: tombstones.id, set: { body: tombstone } }),
        );
        yield* query(() => alarmDb.delete(alarms).where(eq(alarms.id, tombstone.id)));
        yield* query(() => alarmDb.delete(alarmRecords).where(eq(alarmRecords.id, tombstone.id)));
      } else if (change.kind === "tombstone" && isRecordTable(change.tombstone.kind)) {
        const { tombstone } = change;
        const table = recordTables[change.tombstone.kind];
        yield* query(() =>
          collectionDb
            .insert(tombstones)
            .values({ id: tombstone.id, body: tombstone })
            .onConflictDoUpdate({ target: tombstones.id, set: { body: tombstone } }),
        );
        yield* query(() => collectionDb.delete(table).where(eq(table.id, tombstone.id)));
      } else if (change.kind !== "tombstone" && isRecordTable(change.kind)) {
        const table = recordTables[change.kind];
        // The record is of the table's kind.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const body = change.record as never;
        yield* query(() =>
          collectionDb
            .insert(table)
            .values({ id: change.record.id, body })
            .onConflictDoUpdate({ target: table.id, set: { body } }),
        );
      }
    });
  const files = {
    read: (name: string) => Effect.tryPromise({ try: () => media.read(name), catch: mediaFailure }),
    write: (name: string, bytes: Uint8Array) =>
      Effect.tryPromise({ try: () => media.write(name, bytes), catch: mediaFailure }),
    sha256: (bytes: Uint8Array) =>
      Effect.tryPromise({ try: () => media.sha256(bytes), catch: mediaFailure }),
  };

  /** Uploads the files the push's media records point at and the Worker lacks. */
  const uploadMedia = (client: SyncClient, outgoing: readonly Change[]) =>
    Effect.gen(function* () {
      const { uploads } = mediaPushPlan(outgoing.map(toCore), new Set());
      const names = new Map(uploads.map((u) => [u.sha256, u.name]));
      const hashes = [...names.keys()];
      const missing: string[] = [];
      for (let i = 0; i < hashes.length; i += MAX_CHANGES) {
        const page = yield* client.media.missing({
          payload: { hashes: hashes.slice(i, i + MAX_CHANGES) },
        });
        missing.push(...page.missing);
      }
      const failed = new Set<string>();
      let uploaded = 0;
      yield* Effect.forEach(
        missing,
        (sha256) =>
          attempt(
            Effect.gen(function* () {
              const bytes = yield* files.read(names.get(sha256)!);
              // The file changed or went away since it was recorded: the next store re-records it.
              const same = bytes !== null && (yield* files.sha256(bytes)) === sha256;
              yield* same && bytes
                ? client.media.upload({ params: { sha256 }, payload: bytes })
                : Effect.fail("changed");
            }),
          ).pipe(
            Effect.map((result) => {
              if (result.ok) uploaded += 1;
              else failed.add(sha256);
            }),
          ),
        { concurrency: MEDIA_CONCURRENCY, discard: true },
      );
      const plan = mediaPushPlan(outgoing.map(toCore), failed);
      const held = new Set<unknown>(plan.held);
      return {
        uploaded,
        push: outgoing.filter((change) => !held.has(change)),
        held: outgoing.filter((change) => held.has(change)),
      };
    });

  /** The files the notes use whose local copy is absent or isn't the account's version. */
  const wantedMedia = Effect.gen(function* () {
    const used = new Set<string>();
    for (const row of yield* query(() => collectionDb.select().from(notes)))
      for (const name of mediaReferences(parseRecord("notes", row.body).values.map((v) => v.value)))
        used.add(name);
    const local = new Map(
      (yield* query(() => collectionDb.select().from(mediaLocal))).map((row) => [
        row.name,
        row.sha256,
      ]),
    );
    const wanted: { name: string; sha256: string }[] = [];
    for (const row of yield* query(() => collectionDb.select().from(mediaTable))) {
      const file = mediaFromRecord(row.body);
      if (file && used.has(file.name) && local.get(file.name) !== file.sha256)
        wanted.push({ name: file.name, sha256: file.sha256 });
    }
    // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 target; sorts a local array.
    return wanted.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  });
  /** Records that this device holds `sha256` under `name`. */
  const keepLocal = (name: string, sha256: string) =>
    query(() =>
      collectionDb
        .insert(mediaLocal)
        .values({ name, sha256 })
        .onConflictDoUpdate({ target: mediaLocal.name, set: { sha256 } }),
    );

  /** Downloads every file the notes use that this device lacks. Stops when storage is refused. */
  const downloadMedia = (client: SyncClient) =>
    Effect.gen(function* () {
      const wanted = yield* serial(wantedMedia);
      let downloaded = 0;
      let storageRefused = false;
      yield* Effect.forEach(
        wanted,
        (file) =>
          storageRefused
            ? Effect.void
            : attempt(
                Effect.gen(function* () {
                  const bytes = yield* client.media.download({ params: { sha256: file.sha256 } });
                  yield* (yield* files.sha256(bytes)) === file.sha256
                    ? files.write(file.name, bytes)
                    : Effect.fail("corrupt");
                  yield* serial(keepLocal(file.name, file.sha256));
                }),
              ).pipe(
                Effect.map((result) => {
                  if (result.ok) downloaded += 1;
                  else if (Cause.squash(result.cause) instanceof MediaStorageRefused)
                    storageRefused = true;
                }),
              ),
        { concurrency: MEDIA_CONCURRENCY, discard: true },
      );
      return { downloaded, missing: wanted.length - downloaded, storageRefused };
    });

  /**
   * Applies one pulled page and its cursor. Alarms and journal events commit first, in
   * anki-alarm.db: re-applying them is harmless.
   */
  const apply = (page: readonly Change[], cursor: number) =>
    serial(
      Effect.gen(function* () {
        const changed = new Set<string>();
        const resolveAll = (changes: readonly Change[]) =>
          Effect.forEach(
            changes,
            (change) =>
              Effect.gen(function* () {
                const winner = resolveChange(yield* stored(toCore(change)), toCore(change));
                if (!winner) return;
                yield* write(winner);
                changed.add(winner.kind);
                // A delete changes its record's kind too: a pulled alarm delete re-arms alarms.
                if (winner.kind === "tombstone") changed.add(winner.tombstone.kind);
              }),
            { discard: true },
          );
        yield* inAlarms(resolveAll(page.filter(inAlarmDb)));
        yield* inCollection(
          Effect.gen(function* () {
            yield* resolveAll(page.filter((c) => !inAlarmDb(c)));
            yield* writeMeta("syncCursor", String(cursor));
          }),
        );
        return changed;
      }),
    );

  return {
    syncAccount: serial(Effect.map(readMeta("syncAccount"), (account) => account ?? null)),
    /** Makes `userId` this device's account. Local data merges into it on the next sync. */
    adoptAccount: (userId: string) =>
      serial(
        inCollection(
          Effect.gen(function* () {
            yield* writeMeta("syncAccount", userId);
            yield* writeMeta("syncCursor", "0");
            yield* writeMeta("syncFullUpload", "1");
          }),
        ),
      ),
    sync: (client: SyncClient) =>
      Effect.gen(function* () {
        const account = yield* serial(readMeta("syncAccount"));
        const meta = yield* client.metadata.metadata();
        if (meta.syncProtocol !== SYNC_PROTOCOL)
          return yield* new UpdateRequired({ syncProtocol: meta.syncProtocol });
        if (account !== meta.userId)
          return yield* new AccountMismatch({ message: "Signed in to another account" });
        const full = (yield* serial(readMeta("syncFullUpload"))) === "1";
        const { changes, marks } = yield* serial(queued);
        const outgoing = full ? yield* serial(everything) : changes;
        // Files first, so the Worker never holds a record pointing at a missing file.
        const { uploaded, push, held } = yield* uploadMedia(client, outgoing);
        for (let i = 0; i < push.length; i += MAX_CHANGES)
          yield* client.changes.push({ payload: { changes: push.slice(i, i + MAX_CHANGES) } });
        yield* acknowledge(marks, full, held);
        const changed = new Set<string>();
        let pulled = 0;
        let more = true;
        while (more) {
          const cursor = Number((yield* serial(readMeta("syncCursor"))) ?? "0");
          const page = yield* client.changes.pull({ payload: { cursor } });
          for (const kind of yield* apply(page.changes, page.cursor)) changed.add(kind);
          pulled += page.changes.length;
          more = page.more && page.cursor > cursor;
        }
        const downloads = yield* downloadMedia(client);
        if (downloads.downloaded > 0) changed.add("media");
        const result: SyncResult = {
          pushed: push.length,
          pulled,
          changed: [...changed],
          media: { uploaded, heldBack: held.length, ...downloads },
        };
        return result;
      }),
    /** The names of the files the notes use that this device lacks, by name. */
    missingMedia: serial(Effect.map(wantedMedia, (wanted) => wanted.map((file) => file.name))),
    /**
     * Stores media files by name and records their hashes, so sync uploads them. Each file is read,
     * hashed and written one at a time; the records commit together once all are stored.
     */
    writeMediaFiles: (incoming: readonly { name: string; bytes: () => Promise<Uint8Array> }[]) =>
      Effect.forEach(incoming, (file) =>
        Effect.gen(function* () {
          const name = safeMediaName(file.name);
          if (name === undefined)
            return yield* new UnsafeMediaName({
              message: `Unsafe media file name: ${JSON.stringify(file.name)}`,
            });
          const bytes = yield* Effect.tryPromise({ try: file.bytes, catch: mediaFailure });
          const sha256 = yield* files.sha256(bytes);
          yield* files.write(name, bytes);
          return { name, sha256, size: bytes.length };
        }),
      ),
    /** Records stored files: their media records (queued when they changed) and local copies. */
    recordMedia: (written: readonly { name: string; sha256: string; size: number }[]) =>
      inCollection(
        Effect.gen(function* () {
          for (const file of written) {
            const id = importId("media", file.name);
            const [previous] = yield* query(() =>
              collectionDb.select().from(mediaTable).where(eq(mediaTable.id, id)),
            );
            const record = stampMedia(previous?.body, file, env);
            if (record) {
              yield* query(() =>
                collectionDb
                  .insert(mediaTable)
                  .values({ id, body: record })
                  .onConflictDoUpdate({ target: mediaTable.id, set: { body: record } }),
              );
              yield* query(() =>
                collectionDb.insert(outbox).values({ kind: "media", recordId: id, body: record }),
              );
            }
            yield* keepLocal(file.name, file.sha256);
          }
          return written.length;
        }),
      ),
  };
}
