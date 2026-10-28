// Where an app keeps its media files: expo-file-system on the phone, OPFS on the web
// (`@app/client-data/web`). Files are stored by name, as fields reference them; ClientData records
// each one's SHA-256 and syncs it (ADR 0001 › Media).
import { sha256Hex } from "@app/contracts";
import { Data } from "effect";

export interface MediaFiles {
  /** The bytes stored under `name`, or null when there are none. */
  read: (name: string) => Promise<Uint8Array | null>;
  /** Stores `bytes` under `name`, replacing what was there. Throws `MediaStorageRefused` when the platform won't store. */
  write: (name: string, bytes: Uint8Array) => Promise<void>;
  /** Lowercase hex SHA-256. */
  sha256: (bytes: Uint8Array) => Promise<string>;
}

/** The device refused to store a file: no permission, no space, or no storage at all. */
export class MediaStorageRefused extends Data.TaggedError("MediaStorageRefused")<{
  message: string;
}> {}

/** Media files in memory, for tests and stories. Set `refuse` to act like a full or locked store. */
export function memoryMediaFiles(): MediaFiles & {
  files: Map<string, Uint8Array>;
  refuse: boolean;
} {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    refuse: false,
    read: async (name) => files.get(name)?.slice() ?? null,
    async write(name, bytes) {
      if (this.refuse) throw new MediaStorageRefused({ message: "Storage refused" });
      files.set(name, bytes.slice());
    },
    sha256: sha256Hex,
  };
}
