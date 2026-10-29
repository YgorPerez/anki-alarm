-- Media (docs/adr/0001-sync-protocol.md › Media). Files live in R2 under their SHA-256, once for
-- every user; `media_files` lists the ones that arrived. Each account's media records map names to
-- hashes (`media_names`), and push keeps the names each note references (`note_media`), so the
-- Worker serves a file only to an account with a note that uses it. Mirrors src/schema.ts.
CREATE TABLE `media_files` (
  `sha256` text PRIMARY KEY NOT NULL,
  `size` integer NOT NULL
);

CREATE TABLE `media_names` (
  `user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE cascade,
  `name` text NOT NULL,
  `sha256` text NOT NULL,
  PRIMARY KEY(`user_id`, `name`)
);
CREATE INDEX `media_names_sha256_idx` ON `media_names` (`user_id`, `sha256`);

CREATE TABLE `note_media` (
  `user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE cascade,
  `note_id` text NOT NULL,
  `name` text NOT NULL,
  PRIMARY KEY(`user_id`, `note_id`, `name`)
);
CREATE INDEX `note_media_name_idx` ON `note_media` (`user_id`, `name`);
