/* oxlint-disable eslint/no-await-in-loop -- SQLite transaction writes must stop in order on failure. */
import { Collection, uuid7, type CollectionEnvironment, type CollectionState } from "@app/core";
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
  const read = async (): Promise<CollectionState> => ({
    decks: (await db.select().from(decks)).map((r) => r.body),
    notes: (await db.select().from(notes)).map((r) => r.body),
    cards: (await db.select().from(cards)).map((r) => r.body),
    noteTypes: (await db.select().from(noteTypes)).map((r) => r.body),
    presets: (await db.select().from(presets)).map((r) => r.body),
    tombstones: (await db.select().from(tombstones)).map((r) => r.body),
  });
  let queue: Promise<unknown> = Promise.resolve();
  /** Runs a command and, in the same transaction, `after` with its result. */
  const transact = <A>(
    command: (collection: Collection) => A,
    after: (result: A) => Promise<void> = async () => {},
  ): Promise<{ state: CollectionState; result: A }> => {
    const operation = queue.then(async () => {
      await db.run(sql`BEGIN IMMEDIATE`);
      try {
        const before = await read();
        const collection = new Collection(environment, before);
        const result = command(collection);
        const state = collection.snapshot();
        // Replace the local snapshot atomically. Tombstones are retained in every snapshot.
        // A failed statement must stop subsequent writes before rollback.
        for (const name of tables) {
          // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Ordered SQLite transaction.
          await db.run(sql`DELETE FROM ${sql.identifier(name)}`);
          for (const record of state[name]) {
            // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Ordered SQLite transaction.
            await db.run(
              sql`INSERT INTO ${sql.identifier(name)} (id, body) VALUES (${record.id}, ${JSON.stringify(record)})`,
            );
          }
        }
        for (const name of tables) {
          for (const record of state[name]) {
            if (
              JSON.stringify(before[name].find((r) => r.id === record.id)) !==
              JSON.stringify(record)
            )
              await db.run(
                sql`INSERT INTO outbox (kind, record_id, body) VALUES (${name}, ${record.id}, ${JSON.stringify(record)})`,
              );
          }
        }
        await after(result);
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
  const change = async (command: (collection: Collection) => void) =>
    (await transact(command)).state;
  return { read, change, transact, deviceId: device.value };
}
