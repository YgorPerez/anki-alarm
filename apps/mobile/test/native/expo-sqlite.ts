/// <reference types="node" />
// expo-sqlite's async API over Node's SQLite, in memory: the screens' storage code runs as on the
// phone, against a fresh database per test file. Opening a name again reaches the same database,
// as on the phone, so a test can seed records the app can't create yet (an imported note type).
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const databases = new Map<string, DatabaseSync>();
export async function openDatabaseAsync(name: string) {
  const sqlite = databases.get(name) ?? new DatabaseSync(":memory:");
  databases.set(name, sqlite);
  return {
    execAsync: async (source: string) => sqlite.exec(source),
    runAsync: async (source: string, params: SQLInputValue[]) =>
      sqlite.prepare(source).run(...params),
    getAllAsync: async (source: string, params: SQLInputValue[]) =>
      sqlite.prepare(source).all(...params),
  };
}
