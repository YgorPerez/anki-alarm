// The web's media files in the origin private file system (ADR 0006), next to the sqlite-wasm
// databases: `media/<name>`, as the phone keeps them. Works in the database Worker, where Safari
// before 26 has only sync access handles, and in a page. When the browser refuses to store (no OPFS,
// private mode, quota), writes fail with `MediaStorageRefused`, so sync can say so.
import { sha256Hex } from "@app/contracts";

import { MediaStorageRefused, type MediaFiles } from "../media.ts";

// The slice of the File System API this needs, so the package stays free of DOM types.
interface OpfsWritable {
  write: (data: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  abort?: () => Promise<void>;
}
interface OpfsSyncAccessHandle {
  truncate: (size: number) => void;
  write: (data: Uint8Array, options: { at: number }) => number;
  flush: () => void;
  close: () => void;
}
interface OpfsFileHandle {
  getFile: () => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>;
  createWritable?: () => Promise<OpfsWritable>;
  createSyncAccessHandle?: () => Promise<OpfsSyncAccessHandle>;
}
export interface OpfsDirectory {
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<OpfsDirectory>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<OpfsFileHandle>;
}

/** The browser's OPFS root, or a refusal when it has none. */
async function opfsRoot(): Promise<OpfsDirectory> {
  // The DOM's StorageManager, read structurally.
  const storage = (globalThis as { navigator?: { storage?: { getDirectory?: () => unknown } } })
    .navigator?.storage;
  if (!storage?.getDirectory)
    throw new MediaStorageRefused({ message: "This browser has no private file system" });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- getDirectory's handle.
  return (await storage.getDirectory()) as OpfsDirectory;
}

/** DOMException names that mean the browser won't store. */
const REFUSALS = new Set([
  "QuotaExceededError",
  "SecurityError",
  "NotAllowedError",
  "InvalidStateError",
  "NoModificationAllowedError",
]);
const refusal = (error: unknown) =>
  error instanceof MediaStorageRefused
    ? error
    : error instanceof Error && REFUSALS.has(error.name)
      ? new MediaStorageRefused({ message: `${error.name}: ${error.message}` })
      : error;

/**
 * Media files under `media/` in OPFS, for `clientDataLayer(driver, opfsMediaFiles())`. `root`
 * replaces the browser's OPFS root, as in tests.
 */
export function opfsMediaFiles(options: { root?: () => Promise<OpfsDirectory> } = {}): MediaFiles {
  let folder: Promise<OpfsDirectory> | undefined;
  const directory = () => {
    folder ??= (options.root ?? opfsRoot)()
      .then((root) => root.getDirectoryHandle("media", { create: true }))
      .catch((error: unknown) => {
        folder = undefined;
        throw refusal(error);
      });
    return folder;
  };
  return {
    async read(name) {
      try {
        const handle = await (await directory()).getFileHandle(name);
        return new Uint8Array(await (await handle.getFile()).arrayBuffer());
      } catch (error) {
        if (error instanceof Error && error.name === "NotFoundError") return null;
        throw refusal(error);
      }
    },
    async write(name, bytes) {
      try {
        const handle = await (await directory()).getFileHandle(name, { create: true });
        if (handle.createWritable) {
          // Written to a swap file and swapped in on close, so a failed write keeps the old file.
          const writable = await handle.createWritable();
          try {
            await writable.write(bytes);
            await writable.close();
          } catch (error) {
            await writable.abort?.().catch(() => {});
            throw error;
          }
          return;
        }
        if (!handle.createSyncAccessHandle)
          throw new MediaStorageRefused({ message: "This browser can't write files" });
        const access = await handle.createSyncAccessHandle();
        try {
          access.truncate(0);
          access.write(bytes, { at: 0 });
          access.flush();
        } finally {
          access.close();
        }
      } catch (error) {
        throw refusal(error);
      }
    },
    sha256: sha256Hex,
  };
}
