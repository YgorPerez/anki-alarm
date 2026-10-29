import { describe, expect, test } from "vite-plus/test";
import { MediaStorageRefused } from "../index.ts";
import { opfsMediaFiles, type OpfsDirectory } from "./index.ts";

const fail = (name: string) => new DOMException("refused", name);

/** An in-memory OPFS directory tree. `writable: false` acts like Safari's Worker (sync handles only). */
function fakeOpfs(options: { writable?: boolean; quota?: number } = {}) {
  const files = new Map<string, Uint8Array>();
  const used = () => [...files.values()].reduce((sum, f) => sum + f.length, 0);
  const directory = (path: string): OpfsDirectory => ({
    getDirectoryHandle: async (name) => directory(`${path}${name}/`),
    getFileHandle: async (name, { create = false } = {}) => {
      const key = `${path}${name}`;
      if (!files.has(key)) {
        if (!create) throw fail("NotFoundError");
        files.set(key, new Uint8Array());
      }
      const store = (bytes: Uint8Array) => {
        if (
          options.quota !== undefined &&
          used() - files.get(key)!.length + bytes.length > options.quota
        )
          throw fail("QuotaExceededError");
        files.set(key, bytes);
      };
      return {
        getFile: async () => ({ arrayBuffer: async () => files.get(key)!.slice().buffer }),
        ...(options.writable === false
          ? {
              createSyncAccessHandle: async () => {
                let content = files.get(key)!.slice();
                return {
                  truncate: (size: number) => void (content = content.slice(0, size)),
                  write: (data: Uint8Array, { at }: { at: number }) => {
                    const next = new Uint8Array(Math.max(content.length, at + data.length));
                    next.set(content);
                    next.set(data, at);
                    content = next;
                    return data.length;
                  },
                  flush: () => store(content),
                  close: () => {},
                };
              },
            }
          : {
              createWritable: async () => {
                let pending = new Uint8Array();
                return {
                  write: async (data: Uint8Array) => void (pending = data.slice()),
                  close: async () => store(pending),
                  abort: async () => {},
                };
              },
            }),
      };
    },
  });
  return { files, root: async () => directory("/") };
}

const text = (value: string) => new TextEncoder().encode(value);

describe("opfsMediaFiles", () => {
  test("keeps each file under media/ by name, and reads back what it wrote", async () => {
    const opfs = fakeOpfs();
    const media = opfsMediaFiles({ root: opfs.root });
    expect(await media.read("casa.jpg")).toBeNull();
    await media.write("casa.jpg", text("a picture"));
    expect(opfs.files.get("/media/casa.jpg")).toEqual(text("a picture"));
    expect(await media.read("casa.jpg")).toEqual(text("a picture"));
    expect(await media.sha256(text("a picture"))).toBe(
      "92b2fa58028958317e408bd84ecfa70f5ee35b121991dbc232c49d166353708b",
    );
  });

  test("replaces a longer file whole through a sync access handle", async () => {
    const opfs = fakeOpfs({ writable: false });
    const media = opfsMediaFiles({ root: opfs.root });
    await media.write("casa.jpg", text("a long picture"));
    await media.write("casa.jpg", text("short"));
    expect(await media.read("casa.jpg")).toEqual(text("short"));
  });

  test("a full or missing store is a refusal, so sync can say so", async () => {
    const media = opfsMediaFiles({ root: fakeOpfs({ quota: 4 }).root });
    await expect(media.write("casa.jpg", text("a picture"))).rejects.toBeInstanceOf(
      MediaStorageRefused,
    );
    const denied = opfsMediaFiles({
      root: async () => {
        throw new DOMException("denied", "SecurityError");
      },
    });
    await expect(denied.write("casa.jpg", text("x"))).rejects.toBeInstanceOf(MediaStorageRefused);
    // No OPFS at all (Node has no navigator.storage).
    await expect(opfsMediaFiles().write("casa.jpg", text("x"))).rejects.toBeInstanceOf(
      MediaStorageRefused,
    );
  });
});
