import type { ImportSummary } from "@app/client-data";
import {
  apkgFileName,
  readApkg,
  readApkgMedia,
  writeApkg,
  type ApkgHost,
  type ApkgMedia,
  type ApkgWriteHost,
} from "@app/core";
import { Effect } from "effect";
import { Directory, File } from "expo-file-system";
import { deserializeDatabaseAsync, openDatabaseAsync } from "expo-sqlite";
import { unzipSync, zipSync } from "fflate";
import { decompress } from "fzstd";
import { localData } from "./database.ts";
import { phoneMediaFiles } from "./media.ts";

/** Asks for a package and imports it. Undefined when the user cancels the picker. */
export async function pickAndImportApkg(): Promise<ImportSummary | undefined> {
  const bytes = await pickPackage();
  return bytes && importApkg(bytes);
}

/**
 * Asks for a package and stores only its media, for an export of a deck linked from AnkiDroid,
 * whose API can't hand out media. Returns the number of files, or null when the user cancels.
 */
export async function pickAndImportApkgMedia(): Promise<number | null> {
  const bytes = await pickPackage();
  if (!bytes) return null;
  const media = await readApkgMedia(unzipped(bytes));
  await storeMedia(media);
  return media.length;
}

async function pickPackage(): Promise<Uint8Array | undefined> {
  const picked = await File.pickFileAsync({ mimeTypes: "*/*" });
  return picked.canceled ? undefined : picked.result.bytes();
}

/** The package's zip entries and zstd, held in memory: one unzip path for records and media. */
export function unzipped(bytes: Uint8Array): Omit<ApkgHost, "openSqlite"> {
  const zip = unzipSync(bytes);
  return {
    entries: Object.keys(zip),
    read: async (entry) => {
      const content = zip[entry];
      if (!content) throw new Error(`Missing package entry ${entry}`);
      return content;
    },
    decompressZstd: (compressed) => decompress(compressed),
  };
}

/**
 * Unzips the package, lets Core read it, stores its media files and then merges its records.
 * Media go first, so no imported card points at a missing file.
 */
async function importApkg(bytes: Uint8Array): Promise<ImportSummary> {
  const { package: source, media } = await readApkg({
    ...unzipped(bytes),
    openSqlite: async (database) => {
      const db = await deserializeDatabaseAsync(database);
      return {
        all: (query) => db.getAllAsync<Record<string, unknown>>(query),
        close: () => db.closeAsync(),
      };
    },
  });
  await storeMedia(media);
  return Effect.runPromise(localData((data) => data.importAnki(source)));
}

/**
 * Exports a deck and its subdecks as an `.apkg` into a folder the user picks. Resolves with the
 * file name, or undefined when the user leaves the folder picker.
 */
export async function exportApkg(deckId: string): Promise<string | undefined> {
  const [collection, log] = await Effect.runPromise(
    localData((data) => Effect.all([data.collection, data.reviewLog])),
  );
  const deck = collection.decks.find((d) => d.id === deckId);
  if (!deck) throw new Error("Deck missing");
  const entries = await writeApkg(writeHost(), { collection, log, deckId, now: Date.now() });
  const bytes = zipSync(entries);
  let folder: Directory;
  try {
    folder = await Directory.pickDirectoryAsync();
  } catch {
    return undefined;
  }
  const name = apkgFileName(deck.fields.name.value);
  await folder.createFile(name, "application/octet-stream").write(bytes);
  return name;
}
/** A fresh in-memory SQLite for the collection, and media from the app's media folder. */
function writeHost(): ApkgWriteHost {
  return {
    createSqlite: async () => {
      const db = await openDatabaseAsync(":memory:");
      return {
        run: async (sql, params = []) => {
          await db.runAsync(sql, [...params]);
        },
        export: async () => {
          const bytes = await db.serializeAsync();
          await db.closeAsync();
          return bytes;
        },
      };
    },
    media: async (name) => (await phoneMediaFiles.read(name)) ?? undefined,
  };
}

/**
 * Stores media files by name and records their hashes for sync. ClientData reads, hashes and writes
 * them one at a time, so only one decompressed file is in memory.
 */
const storeMedia = (media: readonly ApkgMedia[]) =>
  Effect.runPromise(localData((data) => data.storeMedia(media)));
