import {
  Collection,
  parseCollection,
  uuid7,
  type CollectionEnvironment,
  type CollectionState,
} from "@app/core";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { Effect, Semaphore } from "effect";

import { decks, notes, cards, noteTypes, presets, tombstones, metadata } from "./schema.ts";
import {
  chunks,
  core,
  migrate,
  query,
  StorageFailed,
  storageFailed,
  transaction,
  type ExecuteSql,
} from "./sql.ts";

export type { ExecuteSql } from "./sql.ts";
const tables = ["decks", "notes", "cards", "noteTypes", "presets", "tombstones"] as const;
/** The `body` column of every row. */
const bodies = <T>(rows: () => Promise<{ body: T }[]>) =>
  Effect.map(query(rows), (list) => list.map((r) => r.body));

/** collection.db: the records Core's commands change, each change queued to sync. */
export const openCollectionStore = (
  execute: ExecuteSql,
  env: Omit<CollectionEnvironment, "deviceId">,
) =>
  Effect.gen(function* () {
    const db = drizzle(execute);
    yield* migrate(execute, "collection.db");
    yield* query(() =>
      db
        .insert(metadata)
        .values({ id: "deviceId", value: uuid7(env.now(), env.random()) })
        .onConflictDoNothing(),
    );
    const [device] = yield* query(() =>
      db
        .select()
        .from(metadata)
        .where(sql`id = 'deviceId'`),
    );
    if (!device) return yield* new StorageFailed({ message: "Device identity missing" });
    const environment = { ...env, deviceId: device.value };
    const read = Effect.gen(function* () {
      const raw = {
        decks: yield* bodies(() => db.select().from(decks)),
        notes: yield* bodies(() => db.select().from(notes)),
        cards: yield* bodies(() => db.select().from(cards)),
        noteTypes: yield* bodies(() => db.select().from(noteTypes)),
        presets: yield* bodies(() => db.select().from(presets)),
        tombstones: yield* bodies(() => db.select().from(tombstones)),
      };
      return yield* Effect.try({ try: () => parseCollection(raw), catch: storageFailed });
    });
    // One command at a time: each reads the state the one before it committed.
    const lock = Semaphore.makeUnsafe(1);
    /**
     * Runs a Core command and writes only the records it changed, with their outbox entries, in one
     * transaction. `within` adds writes of its own to the same transaction.
     */
    const run = <R, E = never>(
      command: (collection: Collection) => R,
      within: (result: R) => Effect.Effect<void, E> = () => Effect.void,
    ) =>
      lock.withPermit(
        transaction(
          execute,
          Effect.gen(function* () {
            const before = yield* read;
            const collection = new Collection(environment, before);
            const result = yield* core(() => command(collection));
            const state: CollectionState = collection.snapshot();
            for (const name of tables) yield* writeChanged(name, before[name], state[name]);
            yield* within(result);
            return { state, result };
          }),
        ),
      );
    /** Deletes the records gone since `before` and upserts and queues the ones that changed. */
    const writeChanged = (
      name: (typeof tables)[number],
      before: readonly { id: string }[],
      after: readonly { id: string }[],
    ) =>
      Effect.gen(function* () {
        const previous = new Map(before.map((r) => [r.id, JSON.stringify(r)]));
        const changed: { id: string; body: string }[] = [];
        for (const record of after) {
          const body = JSON.stringify(record);
          if (previous.get(record.id) !== body) changed.push({ id: record.id, body });
          previous.delete(record.id);
        }
        for (const ids of chunks([...previous.keys()]))
          yield* query(() =>
            db.run(
              sql`DELETE FROM ${sql.identifier(name)} WHERE id IN (${sql.join(
                ids.map((id) => sql`${id}`),
                sql`, `,
              )})`,
            ),
          );
        for (const rows of chunks(changed)) {
          const values = sql.join(
            rows.map((r) => sql`(${r.id}, ${r.body})`),
            sql`, `,
          );
          yield* query(() =>
            db.run(
              sql`INSERT INTO ${sql.identifier(name)} (id, body) VALUES ${values} ON CONFLICT (id) DO UPDATE SET body = excluded.body`,
            ),
          );
          const queued = sql.join(
            rows.map((r) => sql`(${name}, ${r.id}, ${r.body})`),
            sql`, `,
          );
          yield* query(() =>
            db.run(sql`INSERT INTO outbox (kind, record_id, body) VALUES ${queued}`),
          );
        }
      });
    const change = (command: (collection: Collection) => void) =>
      Effect.map(run(command), ({ state }) => state);
    return { read, change, run, deviceId: device.value };
  });
