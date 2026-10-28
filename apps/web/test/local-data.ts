import { DatabaseSync } from "node:sqlite";
import { ClientData, clientDataLayer } from "@app/client-data";
import { Effect } from "effect";
import type { Operation, Result } from "../src/data/protocol.ts";

// Replace only the browser transport/OPFS boundary. Reads and writes still use the real data
// service, migrations and Core rules, against a fresh SQLite database for each test file.
const service = Effect.runPromise(
  ClientData.pipe(
    Effect.provide(
      clientDataLayer({
        connect: () => {
          const db = new DatabaseSync(":memory:");
          return async (sql, params, method) => {
            const statement = db.prepare(sql);
            const bind = params;
            if (method === "run") {
              statement.run(...bind);
              return { rows: [] };
            }
            const rows = statement.all(...bind).map((row) => Object.values(row));
            return { rows: method === "get" ? (rows[0] ?? []) : rows };
          };
        },
        now: Date.now,
        random: () => crypto.getRandomValues(new Uint8Array(16)),
      }),
    ),
  ),
);
export const testWebData = {
  async request(operation: Operation) {
    const data = await service;
    const effect: Effect.Effect<Result, Error> =
      operation.kind === "setTheme" ? data.setTheme(operation.patch) : data[operation.kind];
    return Effect.runPromise(effect);
  },
  subscribe: () => () => {},
  close: () => {},
};
