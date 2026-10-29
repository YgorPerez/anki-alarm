-- better-auth's core tables (docs/adr/0007-better-auth.md) and the sync tables
-- (docs/adr/0001-sync-protocol.md). Mirrors src/schema.ts. Apply with
-- `wrangler d1 migrations apply app-sync --local` (or `--remote`).
CREATE TABLE `user` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `email` text NOT NULL,
  `email_verified` integer DEFAULT false NOT NULL,
  `image` text,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);

CREATE TABLE `session` (
  `id` text PRIMARY KEY NOT NULL,
  `expires_at` integer NOT NULL,
  `token` text NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `ip_address` text,
  `user_agent` text,
  `user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);

CREATE TABLE `account` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE cascade,
  `access_token` text,
  `refresh_token` text,
  `id_token` text,
  `access_token_expires_at` integer,
  `refresh_token_expires_at` integer,
  `scope` text,
  `password` text,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);

CREATE TABLE `verification` (
  `id` text PRIMARY KEY NOT NULL,
  `identifier` text NOT NULL,
  `value` text NOT NULL,
  `expires_at` integer NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);

CREATE TABLE `sync_accounts` (
  `user_id` text PRIMARY KEY NOT NULL REFERENCES `user`(`id`) ON DELETE cascade,
  `sequence` integer DEFAULT 0 NOT NULL,
  `push_id` text
);

CREATE TABLE `sync_records` (
  `user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE cascade,
  `kind` text NOT NULL,
  `id` text NOT NULL,
  `sequence` integer NOT NULL,
  `body` text NOT NULL,
  PRIMARY KEY(`user_id`, `kind`, `id`)
);
CREATE INDEX `sync_records_sequence_idx` ON `sync_records` (`user_id`, `sequence`);
