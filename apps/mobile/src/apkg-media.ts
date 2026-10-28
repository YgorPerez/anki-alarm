import { apkgIsCompressed, apkgMedia } from "@app/core";
import { unzipSync } from "fflate";
import { decompress } from "fzstd";

/**
 * The media files in an `.apkg`, such as an export of a linked deck from AnkiDroid, whose API
 * can't hand out media. The whole package is read in memory.
 */
export function apkgMediaFiles(apkg: Uint8Array): { name: string; bytes: Uint8Array }[] {
  const entries = unzipSync(apkg);
  if (!["collection.anki2", "collection.anki21", "collection.anki21b"].some((e) => e in entries))
    throw new Error("Not an .apkg");
  const compressed = apkgIsCompressed(entries["meta"]);
  const open = (bytes: Uint8Array) => (compressed ? decompress(bytes) : bytes);
  const map = entries["media"];
  return apkgMedia(map && open(map), compressed).flatMap(({ entry, name }) => {
    const bytes = entries[entry];
    return bytes ? [{ name, bytes: open(bytes) }] : [];
  });
}
