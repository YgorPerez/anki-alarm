import {
  exportApkg as exportPackage,
  importApkg as importPackage,
  type ImportSummary,
} from "@app/client-data";
import {
  packageEntries,
  readApkgMedia,
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
  return {
    ...packageEntries(unzipSync(bytes)),
    decompressZstd: (compressed) => decompress(compressed),
  };
}

/** Unzips the package and opens its collection with expo-sqlite for the shared import. */
function importApkg(bytes: Uint8Array): Promise<ImportSummary> {
  return Effect.runPromise(
    localData((data) =>
      Effect.suspend(() =>
        importPackage(data, {
          ...unzipped(bytes),
          openSqlite: async (database) => {
            const db = await deserializeDatabaseAsync(database);
            return {
              all: (query) => db.getAllAsync<Record<string, unknown>>(query),
              close: () => db.closeAsync(),
            };
          },
        }),
      ),
    ),
  );
}

/**
 * Exports a deck and its subdecks as an `.apkg` into a folder the user picks. Resolves with the
 * file name, or undefined when the user leaves the folder picker.
 */
export async function exportApkg(deckId: string): Promise<string | undefined> {
  const { name, entries } = await Effect.runPromise(
    localData((data) => exportPackage(data, deckId, writeHost(), Date.now())),
  );
  const bytes = zipSync(entries);
  let folder: Directory;
  try {
    folder = await Directory.pickDirectoryAsync();
  } catch {
    return undefined;
  }
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
