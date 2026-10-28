/* oxlint-disable unicorn/require-post-message-target-origin -- Dedicated Workers do not take a target origin. */
/// <reference lib="webworker" />
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { ClientData, clientDataLayer, type SQLiteConnection } from "@app/client-data";
import { opfsMediaFiles } from "@app/client-data/web";
import { ManagedRuntime, type Effect } from "effect";
import type { Operation, Response, Result } from "./protocol.ts";

const open = async () => {
  const sqlite = await sqlite3InitModule();
  const pool = await sqlite.installOpfsSAHPoolVfs({});
  const databases = new Map<string, InstanceType<typeof pool.OpfsSAHPoolDb>>();
  const driver: SQLiteConnection = {
    connect: (name) => {
      let db = databases.get(name);
      if (!db) {
        db = new pool.OpfsSAHPoolDb(`/${name}`);
        databases.set(name, db);
      }
      const connection = db;
      return async (sql, bind, method) => {
        const rows = connection.exec({ sql, bind, rowMode: "array", returnValue: "resultRows" });
        return { rows: method === "get" ? (rows[0] ?? []) : rows };
      };
    },
    now: Date.now,
    random: () => crypto.getRandomValues(new Uint8Array(16)),
  };
  // Card media in OPFS next to the databases (ADR 0006), copied on sync.
  const runtime = ManagedRuntime.make(clientDataLayer(driver, opfsMediaFiles()));
  const data = await runtime.runPromise(ClientData);
  return { runtime, data };
};
const ready = open();
void ready.then(
  () => self.postMessage({ type: "ready" }),
  (error: unknown) => self.postMessage({ type: "failed", error: String(error) }),
);
self.addEventListener(
  "message",
  async ({ data: request }: MessageEvent<{ id: string; operation: Operation }>) => {
    const response: Response = { type: "response", id: request.id };
    try {
      const { runtime, data } = await ready;
      const operation = request.operation;
      const effect: Effect.Effect<Result, Error> =
        operation.kind === "setTheme" ? data.setTheme(operation.patch) : data[operation.kind];
      response.result = await runtime.runPromise(effect);
    } catch (error) {
      response.error = String(error);
    }
    self.postMessage(response);
    if (!response.error && request.operation.kind === "setTheme")
      self.postMessage({ type: "changed" });
  },
);
