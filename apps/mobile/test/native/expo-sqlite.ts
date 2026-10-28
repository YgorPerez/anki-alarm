/// <reference types="node" />
// expo-sqlite's async API over Node's SQLite, in memory: the screens' storage code runs as on the
// phone, against a fresh database per test file.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export async function openDatabaseAsync(_name: string) {
  const sqlite = new DatabaseSync(":memory:");
  return {
    execAsync: async (source: string) => sqlite.exec(source),
    runAsync: async (source: string, params: SQLInputValue[]) =>
      sqlite.prepare(source).run(...params),
    getAllAsync: async (source: string, params: SQLInputValue[]) =>
      sqlite.prepare(source).all(...params),
  };
}
