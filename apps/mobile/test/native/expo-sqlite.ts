/// <reference types="node" />
// expo-sqlite's async API over Node's SQLite, in memory: the screens' storage code runs as on the
// phone, against a fresh database per test file. Opening a name again reaches the same database,
// as on the phone, so a test can seed records the app can't create yet (an imported note type).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const wrap = (sqlite: DatabaseSync) => ({
  execAsync: async (source: string) => sqlite.exec(source),
  runAsync: async (source: string, params: SQLInputValue[]) =>
    sqlite.prepare(source).run(...params),
  getAllAsync: async (source: string, params: SQLInputValue[] = []) =>
    sqlite.prepare(source).all(...params),
  closeAsync: async () => sqlite.close(),
});
const databases = new Map<string, DatabaseSync>();
export async function openDatabaseAsync(name: string) {
  const sqlite = databases.get(name) ?? new DatabaseSync(":memory:");
  databases.set(name, sqlite);
  return wrap(sqlite);
}
const work = mkdtempSync(join(tmpdir(), "expo-sqlite-"));
let serialized = 0;
/** An in-memory copy of a database file's bytes, as SQLite's deserialize gives. */
export async function deserializeDatabaseAsync(bytes: Uint8Array) {
  const path = join(work, `${serialized++}.db`);
  writeFileSync(path, bytes);
  return wrap(new DatabaseSync(path));
}
