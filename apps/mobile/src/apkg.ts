/* oxlint-disable eslint/no-await-in-loop -- Media files are written one at a time. */
import type { ImportSummary } from "@app/client-data";
import { readApkg } from "@app/core";
import { Effect } from "effect";
import { Directory, File, Paths } from "expo-file-system";
import { deserializeDatabaseAsync } from "expo-sqlite";
import { unzipSync } from "fflate";
import { decompress } from "fzstd";
import { localData } from "./database.ts";

/** Card media, by Anki file name. Cards load them from here. */
const mediaDirectory = () => new Directory(Paths.document, "media");
export function mediaUrl(name: string) {
  const base = mediaDirectory().uri;
  return `${base.endsWith("/") ? base : `${base}/`}${encodeURIComponent(name)}`;
}
export const mediaBaseUrl = () => mediaUrl("");

/** Asks for a package and imports it. Undefined when the user cancels the picker. */
export async function pickAndImportApkg(): Promise<ImportSummary | undefined> {
  const picked = await File.pickFileAsync({ mimeTypes: "*/*" });
  if (picked.canceled) return undefined;
  return importApkg(await picked.result.bytes());
}

/**
 * Unzips the package, lets Core read it, stores its media files and then merges its records.
 * Media go first, so no imported card points at a missing file.
 */
async function importApkg(bytes: Uint8Array): Promise<ImportSummary> {
  const zip = unzipSync(bytes);
  const { package: source, media } = await readApkg({
    entries: Object.keys(zip),
    read: async (entry) => {
      const content = zip[entry];
      if (!content) throw new Error(`Missing package entry ${entry}`);
      return content;
    },
    decompressZstd: (compressed) => decompress(compressed),
    openSqlite: async (database) => {
      const db = await deserializeDatabaseAsync(database);
      return {
        all: (query) => db.getAllAsync<Record<string, unknown>>(query),
        close: () => db.closeAsync(),
      };
    },
  });
  const directory = mediaDirectory();
  directory.create({ intermediates: true, idempotent: true });
  for (const file of media) {
    const target = new File(directory, file.name);
    // Sequential: each file is decompressed in memory only while it is written.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- One file in memory at a time.
    await target.write(await file.bytes());
  }
  return Effect.runPromise(localData((data) => data.importAnki(source)));
}
