// D1's tables, through drizzle. The first four are better-auth's core schema (docs/adr/0007);
// the sync tables follow docs/adr/0001-sync-protocol.md. migrations/ holds the same in SQL.
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`);
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`);

const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

/** Each account's monotonic sequence. `push_id` marks the push that last moved it. */
export const syncAccounts = sqliteTable("sync_accounts", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull().default(0),
  pushId: text("push_id"),
});

/**
 * The winner of each slot (Core's `syncSlot`), keyed by (user id, kind, id). A tombstone takes its
 * record's slot. `sequence` is the account sequence the slot last changed at; pull reads above it.
 */
export const syncRecords = sqliteTable(
  "sync_records",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    id: text("id").notNull(),
    sequence: integer("sequence").notNull(),
    /** The stored change, as JSON. */
    body: text("body").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.kind, table.id] }),
    index("sync_records_sequence_idx").on(table.userId, table.sequence),
  ],
);

/** The media files R2 holds, by SHA-256, for every user (migrations/0002_media.sql). */
export const mediaFiles = sqliteTable("media_files", {
  sha256: text("sha256").primaryKey(),
  size: integer("size").notNull(),
});

/** Each account's media records: the hash a file name holds. */
export const mediaNames = sqliteTable(
  "media_names",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sha256: text("sha256").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.name] }),
    index("media_names_sha256_idx").on(table.userId, table.sha256),
  ],
);

/** The media names each stored note references, so a download can check the account uses it. */
export const noteMedia = sqliteTable(
  "note_media",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    noteId: text("note_id").notNull(),
    name: text("name").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.noteId, table.name] }),
    index("note_media_name_idx").on(table.userId, table.name),
  ],
);

export const schema = { user, session, account, verification, syncAccounts, syncRecords };
