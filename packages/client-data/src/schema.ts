import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import type {
  Deck,
  StoredCollection,
  Card,
  NoteType,
  Tombstone,
  Settings,
  Alarm,
  LogEntry,
} from "@app/core";
import type { AlarmEvent } from "./index.ts";
// JSON bodies preserve each field's independent HLC. Ids remain indexed SQLite keys.
export const decks = sqliteTable("decks", {
  id: text().primaryKey(),
  body: text({ mode: "json" }).$type<Deck>().notNull(),
});
export const notes = sqliteTable("notes", {
  id: text().primaryKey(),
  body: text({ mode: "json" }).$type<StoredCollection["notes"][number]>().notNull(),
});
export const cards = sqliteTable("cards", {
  id: text().primaryKey(),
  body: text({ mode: "json" }).$type<Card>().notNull(),
});
export const noteTypes = sqliteTable("noteTypes", {
  id: text().primaryKey(),
  body: text({ mode: "json" }).$type<NoteType>().notNull(),
});
export const presets = sqliteTable("presets", {
  id: text().primaryKey(),
  body: text({ mode: "json" }).$type<StoredCollection["presets"][number]>().notNull(),
});
export const tombstones = sqliteTable("tombstones", {
  id: text().primaryKey(),
  body: text({ mode: "json" }).$type<Tombstone>().notNull(),
});
export const metadata = sqliteTable("metadata", {
  id: text().primaryKey(),
  value: text().notNull(),
});

export const settings = sqliteTable("settings", {
  id: text().primaryKey(),
  body: text({ mode: "json" }).$type<Settings>().notNull(),
});
export const alarms = sqliteTable("alarms", {
  id: text().primaryKey(),
  data: text({ mode: "json" }).$type<Alarm>().notNull(),
});
export const alarmEvents = sqliteTable("alarm_events", {
  id: text().primaryKey(),
  data: text({ mode: "json" }).$type<AlarmEvent>().notNull(),
});
export const outbox = sqliteTable("outbox", {
  sequence: integer().primaryKey({ autoIncrement: true }),
  kind: text().notNull(),
  recordId: text("record_id").notNull(),
  body: text({ mode: "json" }).$type<unknown>().notNull(),
});

export const reviewLog = sqliteTable("review_log", {
  id: text().primaryKey(),
  body: text({ mode: "json" }).$type<LogEntry>().notNull(),
});
