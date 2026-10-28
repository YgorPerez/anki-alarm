import { DatabaseSync } from "node:sqlite";
import { ClientData, clientDataLayer } from "@app/client-data";
import { Effect } from "effect";

/**
 * A device's real data service over Node's SQLite, in memory: the web tab's database in screen
 * tests, or the phone that syncs with it in screen tests and journeys.
 */
export const openDevice = (origin: "phone" | "web") =>
  Effect.runPromise(
    ClientData.pipe(
      Effect.provide(
        clientDataLayer({
          connect: () => {
            const db = new DatabaseSync(":memory:");
            return async (sql, params, method) => {
              const statement = db.prepare(sql);
              if (method === "run") {
                statement.run(...params);
                return { rows: [] };
              }
              const rows = statement.all(...params).map((row) => Object.values(row));
              return { rows: method === "get" ? (rows[0] ?? []) : rows };
            };
          },
          now: Date.now,
          random: () => crypto.getRandomValues(new Uint8Array(16)),
          origin,
        }),
      ),
    ),
  );
