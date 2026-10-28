/* oxlint-disable eslint/no-await-in-loop -- SQLite transaction writes must stop in order on failure. */
import {
  Collection,
  upgradeCollection,
  uuid7,
  type CollectionEnvironment,
  type CollectionState,
} from "@app/core";
import { migrationStatements } from "./migrations.ts";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/sqlite-proxy";

import { decks, notes, cards, noteTypes, presets, tombstones, metadata } from "./schema.ts";
const tables = ["decks", "notes", "cards", "noteTypes", "presets", "tombstones"] as const;

/** SQL transport shared by expo-sqlite on device and real SQLite in integration tests. */
export type ExecuteSql = (
  query: string,
  params: (string | number | null)[],
  method: "run" | "all" | "get" | "values",
) => Promise<{ rows: unknown[] }>;
export async function openCollectionStore(
  execute: ExecuteSql,
  env: Omit<CollectionEnvironment, "deviceId">,
) {
  const db = drizzle(execute);
  try {
    for (const statement of migrationStatements("collection.db")) {
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Migrations must run in order.
      // react-doctor-disable-next-line react-doctor/raw-sql-injection-risk -- Statements come only from the static migration registry, never user input.
      await db.run(sql.raw(statement));
    }
  } catch (error) {
    await db.run(sql`ROLLBACK`);
    throw error;
  }
  await db
    .insert(metadata)
    .values({ id: "deviceId", value: uuid7(env.now(), env.random()) })
    .onConflictDoNothing();
  const [device] = await db
    .select()
    .from(metadata)
    .where(sql`id = 'deviceId'`);
  if (!device) throw new Error("Device identity missing");
  const environment = { ...env, deviceId: device.value };
  const read = async (): Promise<CollectionState> =>
    upgradeCollection({
      decks: (await db.select().from(decks)).map((r) => r.body),
      notes: (await db.select().from(notes)).map((r) => r.body),
      cards: (await db.select().from(cards)).map((r) => r.body),
      noteTypes: (await db.select().from(noteTypes)).map((r) => r.body),
      presets: (await db.select().from(presets)).map((r) => r.body),
      tombstones: (await db.select().from(tombstones)).map((r) => r.body),
    });
  let queue: Promise<unknown> = Promise.resolve();
  /**
   * Runs a Core command and writes only the records it changed, with their outbox entries, in one
   * transaction. `within` adds writes of its own to the same transaction.
   */
  const run = <R>(
    command: (collection: Collection) => R,
    within: (result: R) => Promise<void> = async () => {},
  ): Promise<{ state: CollectionState; result: R }> => {
    const operation = queue.then(async () => {
      await db.run(sql`BEGIN IMMEDIATE`);
      try {
        const before = await read();
        const collection = new Collection(environment, before);
        const result = command(collection);
        const state = collection.snapshot();
        // A failed statement must stop subsequent writes before rollback.
        for (const name of tables) {
          const previous = new Map(before[name].map((r) => [r.id, JSON.stringify(r)]));
          const changed: { id: string; body: string }[] = [];
          for (const record of state[name]) {
            const body = JSON.stringify(record);
            if (previous.get(record.id) !== body) changed.push({ id: record.id, body });
            previous.delete(record.id);
          }
          for (const ids of chunks([...previous.keys()], BATCH))
            // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Ordered SQLite transaction.
            await db.run(
              sql`DELETE FROM ${sql.identifier(name)} WHERE id IN (${sql.join(
                ids.map((id) => sql`${id}`),
                sql`, `,
              )})`,
            );
          for (const rows of chunks(changed, BATCH)) {
            const values = sql.join(
              rows.map((r) => sql`(${r.id}, ${r.body})`),
              sql`, `,
            );
            // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Ordered SQLite transaction.
            await db.run(
              sql`INSERT INTO ${sql.identifier(name)} (id, body) VALUES ${values} ON CONFLICT (id) DO UPDATE SET body = excluded.body`,
            );
            const queued = sql.join(
              rows.map((r) => sql`(${name}, ${r.id}, ${r.body})`),
              sql`, `,
            );
            // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Ordered SQLite transaction.
            await db.run(sql`INSERT INTO outbox (kind, record_id, body) VALUES ${queued}`);
          }
        }
        await within(result);
        await db.run(sql`COMMIT`);
        return { state, result };
      } catch (error) {
        await db.run(sql`ROLLBACK`);
        throw error;
      }
    });
    queue = operation.catch(() => {});
    return operation;
  };
  const change = async (command: (collection: Collection) => void) => (await run(command)).state;
  return { read, change, run, deviceId: device.value };
}

/** Rows per statement: two or three parameters each stays under SQLite's oldest 999 limit. */
const BATCH = 200;
function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}
