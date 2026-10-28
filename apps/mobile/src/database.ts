import { ClientData, clientDataLayer, type ExecuteSql } from "@app/client-data";
import { Effect } from "effect";
import { getRandomBytes } from "expo-crypto";
import { openDatabaseAsync } from "expo-sqlite";

const connection = (name: string): ExecuteSql => {
  const database = openDatabaseAsync(name).then(async (db) => {
    await db.execAsync("PRAGMA journal_mode = WAL;");
    return db;
  });
  return async (query, params, method) => {
    const db = await database;
    if (method === "run") {
      await db.runAsync(query, params);
      return { rows: [] };
    }
    const rows = await db.getAllAsync<Record<string, unknown>>(query, params);
    return { rows: rows.map((row) => Object.values(row)) };
  };
};
let data: Promise<ClientData["Service"]> | undefined;
function clientData() {
  data ??= Effect.runPromise(
    ClientData.pipe(
      Effect.provide(
        clientDataLayer({
          connect: connection,
          now: Date.now,
          random: () => getRandomBytes(16),
        }),
      ),
    ),
  ).catch((error: unknown) => {
    data = undefined;
    throw error;
  });
  return data;
}
export const localData = <A>(read: (data: ClientData["Service"]) => Effect.Effect<A, Error>) =>
  Effect.tryPromise({ try: () => clientData(), catch: (error) => new Error(String(error)) }).pipe(
    Effect.flatMap(read),
  );
