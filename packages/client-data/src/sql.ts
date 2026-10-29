// What every part of ClientData does with SQLite, in Effect: run a statement, run a transaction,
// migrate, and batch rows. Failures are typed: `StorageFailed` for the database, `CommandRejected`
// for what Core refused.
import { Data, Effect } from "effect";

import { migrationStatements } from "./migrations.ts";

/** SQL transport shared by expo-sqlite on device, sqlite-wasm on the web and SQLite in tests. */
export type ExecuteSql = (
  query: string,
  params: (string | number | null)[],
  method: "run" | "all" | "get" | "values",
) => Promise<{ rows: unknown[] }>;

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** A SQLite statement or transaction failed, or the stored data couldn't be read. */
export class StorageFailed extends Data.TaggedError("StorageFailed")<{
  message: string;
  cause?: unknown;
}> {}
/** Core refused the command or entry. The message is Core's. */
export class CommandRejected extends Data.TaggedError("CommandRejected")<{
  message: string;
  cause?: unknown;
}> {}

export const storageFailed = (cause: unknown) =>
  new StorageFailed({ message: messageOf(cause), cause });
const commandRejected = (cause: unknown) =>
  new CommandRejected({ message: messageOf(cause), cause });

/** One database call (a drizzle query or a raw statement). */
export const query = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: storageFailed });
/** One Core call: what it throws is a refusal, not a crash. */
export const core = <A>(run: () => A) => Effect.try({ try: run, catch: commandRejected });

/**
 * Runs `body` in one SQLite transaction: it commits when `body` succeeds and rolls back on any
 * failure or interruption. A failed statement stops the statements after it.
 */
export const transaction = <A, E, R>(execute: ExecuteSql, body: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    yield* query(() => execute("BEGIN IMMEDIATE", [], "run"));
    const result = yield* body;
    yield* query(() => execute("COMMIT", [], "run"));
    return result;
  }).pipe(Effect.onError(() => Effect.ignore(query(() => execute("ROLLBACK", [], "run")))));

/** Brings one database to the current schema: its migration statements, in order. */
export const migrate = (execute: ExecuteSql, database: "collection.db" | "anki-alarm.db") =>
  Effect.forEach(migrationStatements(database), (statement) =>
    query(() => execute(statement, [], "run")),
  ).pipe(
    Effect.onError(() => Effect.ignore(query(() => execute("ROLLBACK", [], "run")))),
    Effect.asVoid,
  );

/** Rows per statement: two or three parameters each stays under SQLite's oldest 999 limit. */
const BATCH = 200;
export function chunks<T>(items: readonly T[], size = BATCH): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}
/** Runs `write` for each batch of `items`, one after another. */
export const inBatches = <T, A>(items: readonly T[], write: (batch: T[]) => Promise<A>) =>
  Effect.forEach(chunks(items), (batch) => query(() => write(batch)), { discard: true });
