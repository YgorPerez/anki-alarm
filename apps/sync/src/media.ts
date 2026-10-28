// Media files in R2 by SHA-256, stored once across all users (ADR 0001 › Media). `media_files` in
// D1 lists what arrived, so "which are missing" is one query. A download needs a media record of
// the account mapping a name to the hash and a note of the account referencing that name; push
// keeps both indexes (store.ts).
import { MAX_MEDIA_BYTES, sha256Hex } from "@app/contracts";
import { drizzle } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";

import { mediaFiles } from "./schema.ts";

export function mediaStore(d1: D1Database, bucket: R2Bucket) {
  const db = drizzle(d1);
  return {
    /** The hashes R2 doesn't hold yet. */
    async missing(hashes: readonly string[]) {
      if (hashes.length === 0) return [];
      const stored = new Set(
        (
          await db
            .select({ sha256: mediaFiles.sha256 })
            .from(mediaFiles)
            .where(
              sql`${mediaFiles.sha256} IN (SELECT value FROM json_each(${JSON.stringify(hashes)}))`,
            )
        ).map((row) => row.sha256),
      );
      return [...new Set(hashes)].filter((hash) => !stored.has(hash));
    },
    /** Stores the bytes under their hash, once. Rejects bytes that aren't what they claim. */
    async upload(sha256: string, bytes: Uint8Array): Promise<"stored" | "hash" | "size"> {
      if (bytes.length > MAX_MEDIA_BYTES) return "size";
      if ((await sha256Hex(bytes)) !== sha256) return "hash";
      if ((await this.missing([sha256])).length === 0) return "stored";
      await bucket.put(sha256, bytes, {
        httpMetadata: { contentType: "application/octet-stream" },
      });
      // Listed only once R2 holds it.
      await db.insert(mediaFiles).values({ sha256, size: bytes.length }).onConflictDoNothing();
      return "stored";
    },
    /** The file, or null when it isn't there or no note of the account references it. */
    async download(userId: string, sha256: string): Promise<Uint8Array | null> {
      const allowed = await d1
        .prepare(
          `SELECT 1 FROM media_names m
          JOIN note_media n ON n.user_id = m.user_id AND n.name = m.name
          WHERE m.user_id = ?1 AND m.sha256 = ?2 LIMIT 1`,
        )
        .bind(userId, sha256)
        .first();
      if (!allowed) return null;
      const object = await bucket.get(sha256);
      return object ? new Uint8Array(await object.arrayBuffer()) : null;
    },
  };
}
export type MediaStore = ReturnType<typeof mediaStore>;
