import { getRandomBytes } from "expo-crypto";
import { openDatabaseAsync } from "expo-sqlite";
import { openCollectionStore, type CollectionStore } from "./storage.ts";

let store: Promise<CollectionStore> | undefined;
export function collectionStore(): Promise<CollectionStore> {
  store ??= open().catch((error: unknown) => {
    store = undefined;
    throw error;
  });
  return store;
}
async function open() {
  const sqlite = await openDatabaseAsync("collection.db");
  await sqlite.execAsync("PRAGMA journal_mode = WAL;");
  return openCollectionStore(
    async (query, params, method) => {
      if (method === "run") {
        await sqlite.runAsync(query, params);
        return { rows: [] };
      }
      const rows = await sqlite.getAllAsync<Record<string, unknown>>(query, params);
      return { rows: rows.map((row) => Object.values(row)) };
    },
    { now: Date.now, random: () => getRandomBytes(16) },
  );
}
