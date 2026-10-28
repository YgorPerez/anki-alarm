import { migrationStatements } from "./migrations.ts";
import { decodeAlarm, decodeEvent } from "./alarm-codec.ts";
import { openDatabaseSync } from "expo-sqlite";
import type { AlarmRepository } from "./alarms.ts";

export function sqliteAlarmRepository(): AlarmRepository {
  const db = openDatabaseSync("anki-alarm.db");
  db.execSync("PRAGMA journal_mode = WAL;");
  try {
    db.execSync(migrationStatements("anki-alarm.db").join(";"));
  } catch (error) {
    db.execSync("ROLLBACK");
    throw error;
  }
  return {
    list: () =>
      db
        .getAllSync<{ data: string }>("SELECT data FROM alarms ORDER BY rowid")
        .map((row) => decodeAlarm(row.data)),
    save: (alarm) => {
      db.runSync(
        "INSERT OR REPLACE INTO alarms (id, data) VALUES (?, ?)",
        alarm.id,
        JSON.stringify(alarm),
      );
    },
    ingest: (events) =>
      db.withTransactionSync(() => {
        for (const event of events)
          db.runSync(
            "INSERT OR IGNORE INTO alarm_events (id, data) VALUES (?, ?)",
            event.id,
            JSON.stringify(event),
          );
      }),
    events: () =>
      db
        .getAllSync<{ data: string }>("SELECT data FROM alarm_events ORDER BY rowid")
        .map((row) => decodeEvent(row.data)),
  };
}
