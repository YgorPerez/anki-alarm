/* oxlint-disable eslint/no-await-in-loop -- SQLite transaction writes must stop in order on failure. */
import {
  Collection,
  uuid7,
  type CollectionEnvironment,
  type CollectionState,
  type Deck,
  type Note,
  type Card,
  type NoteType,
  type Preset,
  type Tombstone,
} from "@app/core";
import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/sqlite-proxy";

// JSON bodies preserve each field's independent HLC. Ids remain indexed SQLite keys.
const decks = sqliteTable("decks", {
  id: text().primaryKey(),
  body: text({ mode: "json" }).$type<Deck>().notNull(),
});
const notes = sqliteTable("notes", {
  id: text().primaryKey(),
  body: text({ mode: "json" }).$type<Note>().notNull(),
});
const cards = sqliteTable("cards", {
  id: text().primaryKey(),
  body: text({ mode: "json" }).$type<Card>().notNull(),
});
const noteTypes = sqliteTable("noteTypes", {
  id: text().primaryKey(),
  body: text({ mode: "json" }).$type<NoteType>().notNull(),
});
const presets = sqliteTable("presets", {
  id: text().primaryKey(),
  body: text({ mode: "json" }).$type<Preset>().notNull(),
});
const tombstones = sqliteTable("tombstones", {
  id: text().primaryKey(),
  body: text({ mode: "json" }).$type<Tombstone>().notNull(),
});
const metadata = sqliteTable("metadata", { id: text().primaryKey(), value: text().notNull() });
const tables = ["decks", "notes", "cards", "noteTypes", "presets", "tombstones"] as const;

/** SQL transport shared by expo-sqlite on device and real SQLite in integration tests. */
export type ExecuteSql = (
  query: string,
  params: (string | number | null)[],
  method: "run" | "all" | "get" | "values",
) => Promise<{ rows: unknown[] }>;
export type CollectionStore = Awaited<ReturnType<typeof openCollectionStore>>;
export async function openCollectionStore(
  execute: ExecuteSql,
  env: Omit<CollectionEnvironment, "deviceId">,
) {
  const db = drizzle(execute);
  // Additive v1 migration; never drops a user's database on startup.
  await Promise.all(
    tables.map((name) =>
      db.run(
        sql`CREATE TABLE IF NOT EXISTS ${sql.identifier(name)} (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL)`,
      ),
    ),
  );
  await db.run(
    sql`CREATE TABLE IF NOT EXISTS metadata (id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`,
  );
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
  const change = (command: (collection: Collection) => void): Promise<CollectionState> => {
    const operation = queue.then(async () => {
      await db.run(sql`BEGIN IMMEDIATE`);
      try {
        const collection = new Collection(environment, await read());
        command(collection);
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
        await db.run(sql`COMMIT`);
        return state;
      } catch (error) {
        await db.run(sql`ROLLBACK`);
        throw error;
      }
    });
    queue = operation.catch(() => {});
    return operation;
  };
  return { read, change };
}
