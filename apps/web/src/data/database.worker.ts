/* oxlint-disable unicorn/require-post-message-target-origin -- Dedicated Workers do not take a target origin. */
/// <reference lib="webworker" />
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { ClientData, clientDataLayer, type SQLiteConnection } from "@app/client-data";
import { opfsMediaFiles } from "@app/client-data/web";
import { makeSyncClient } from "@app/contracts";
import { Effect, ManagedRuntime } from "effect";

import { SYNC_URL } from "../env.ts";
import { wasmApkgSqlite } from "./apkg.ts";
import { operations } from "./operations.ts";
import { toFailure, type Operation, type Response } from "./protocol.ts";

/** The sync API on its own origin. The browser sends the better-auth session cookie with it. */
const syncClient = () =>
  SYNC_URL
    ? Effect.runPromise(
        makeSyncClient({
          baseUrl: SYNC_URL,
          fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
        }),
      )
    : Promise.reject(new Error("Sync is not configured in this build"));

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
    origin: "web",
  };
  // Card media in OPFS `media/<name>` next to the databases (ADR 0006), copied on sync. The service
  // worker serves them to cards as `/media/<name>`.
  const media = opfsMediaFiles();
  const runtime = ManagedRuntime.make(clientDataLayer(driver, media));
  return operations(await runtime.runPromise(ClientData), syncClient, {
    sqlite: wasmApkgSqlite(sqlite),
    media,
  });
};
const ready = open();
void ready.then(
  () => self.postMessage({ type: "ready" }),
  (error: unknown) => self.postMessage({ type: "failed", error: String(error) }),
);
self.addEventListener(
  "message",
  async ({ data: request }: MessageEvent<{ id: string; operation: Operation }>) => {
    let response: Response;
    let changed = false;
    try {
      const outcome = await (await ready)(request.operation);
      response = { type: "response", id: request.id, ok: true, result: outcome.result };
      changed = outcome.changed;
    } catch (error) {
      response = { type: "response", id: request.id, ok: false, error: toFailure(error) };
    }
    self.postMessage(response);
    if (changed) self.postMessage({ type: "changed" });
  },
);
