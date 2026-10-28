// Media files in R2 by SHA-256, stored once across all users (ADR 0001 › Media). `media_files` in
// D1 lists what arrived, so "which are missing" is one query. A download needs a media record of
// the account mapping a name to the hash and a note of the account referencing that name; push
// keeps both indexes (store.ts).
import { MAX_MEDIA_BYTES, sha256Hex } from "@app/contracts";
import { and, eq, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

import { mediaFiles, mediaNames, noteMedia } from "./schema.ts";

/** Which of `hashes` R2 holds. */
export async function storedFiles(db: DrizzleD1Database, hashes: readonly string[]) {
  if (hashes.length === 0) return new Set<string>();
  const rows = await db
    .select({ sha256: mediaFiles.sha256 })
    .from(mediaFiles)
    .where(sql`${mediaFiles.sha256} IN (SELECT value FROM json_each(${JSON.stringify(hashes)}))`);
  return new Set(rows.map((row) => row.sha256));
}

export function mediaStore(d1: D1Database, bucket: R2Bucket) {
  const db = drizzle(d1);
  const missing = async (hashes: readonly string[]) => {
    const stored = await storedFiles(db, hashes);
    return [...new Set(hashes)].filter((hash) => !stored.has(hash));
  };
  return {
    /** The hashes R2 doesn't hold yet. */
    missing,
    /** Stores the bytes under their hash, once. Rejects bytes that aren't what they claim. */
    async upload(sha256: string, bytes: Uint8Array): Promise<"stored" | "hash" | "size"> {
      if (bytes.length > MAX_MEDIA_BYTES) return "size";
      if ((await sha256Hex(bytes)) !== sha256) return "hash";
      if ((await missing([sha256])).length === 0) return "stored";
      await bucket.put(sha256, bytes, {
        httpMetadata: { contentType: "application/octet-stream" },
      });
      // Listed only once R2 holds it.
      await db.insert(mediaFiles).values({ sha256, size: bytes.length }).onConflictDoNothing();
      return "stored";
    },
    /** The file, or null when it isn't there or no note of the account references it. */
    async download(userId: string, sha256: string): Promise<Uint8Array | null> {
      const [allowed] = await db
        .select({ name: mediaNames.name })
        .from(mediaNames)
        .innerJoin(
          noteMedia,
          and(eq(noteMedia.userId, mediaNames.userId), eq(noteMedia.name, mediaNames.name)),
        )
        .where(and(eq(mediaNames.userId, userId), eq(mediaNames.sha256, sha256)))
        .limit(1);
      if (!allowed) return null;
      const object = await bucket.get(sha256);
      return object ? new Uint8Array(await object.arrayBuffer()) : null;
    },
  };
}
export type MediaStore = ReturnType<typeof mediaStore>;
