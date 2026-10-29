// `.apkg` import and export in the leader's database Worker, through Core's reader and writer.
import {
  ClientData,
  exportApkg,
  importApkg,
  type ImportSummary,
  type MediaFiles,
} from "@app/client-data";
import { packageEntries, type AnkiDatabase, type WritableDatabase } from "@app/core";
import type sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { Effect } from "effect";
import { unzipSync, zipSync } from "fflate";
import { decompress } from "fzstd";

/** Scratch SQLite databases in memory: one to read a package's collection, one to write one. */
export interface ApkgSqlite {
  open: (bytes: Uint8Array) => Promise<AnkiDatabase>;
  create: () => Promise<WritableDatabase>;
}
export interface ApkgFiles {
  sqlite: ApkgSqlite;
  /** Where the browser keeps card media: the same store `clientDataLayer` writes to. */
  media: MediaFiles;
}
export interface ApkgExport {
  name: string;
  bytes: Uint8Array;
}

/** The shared flow of `@app/client-data`, with the Worker's zip and sqlite-wasm. */
export function apkgOperations(data: ClientData["Service"], files: ApkgFiles) {
  const run = <A, E>(effect: Effect.Effect<A, E, ClientData>) =>
    Effect.runPromise(Effect.provideService(effect, ClientData, data));
  return {
    importApkg: (bytes: Uint8Array): Promise<ImportSummary> =>
      run(
        Effect.suspend(() =>
          importApkg({
            ...packageEntries(unzipSync(bytes)),
            decompressZstd: (compressed) => decompress(compressed),
            openSqlite: files.sqlite.open,
          }),
        ),
      ),
    exportApkg: (deckId: string): Promise<ApkgExport> =>
      run(
        exportApkg(
          deckId,
          {
            createSqlite: files.sqlite.create,
            media: async (name) => (await files.media.read(name)) ?? undefined,
          },
          Date.now(),
        ).pipe(Effect.map(({ name, entries }) => ({ name, bytes: zipSync(entries) }))),
      ),
  };
}

type Sqlite = Awaited<ReturnType<typeof sqlite3InitModule>>;
/** sqlite-wasm's in-memory databases, in the Worker (and in screen tests, on Node). */
export function wasmApkgSqlite(sqlite: Sqlite): ApkgSqlite {
  return {
    open: async (bytes) => {
      const db = new sqlite.oo1.DB(":memory:");
      const pointer = sqlite.wasm.allocFromTypedArray(bytes);
      const { SQLITE_DESERIALIZE_FREEONCLOSE, SQLITE_DESERIALIZE_RESIZEABLE } = sqlite.capi;
      db.checkRc(
        sqlite.capi.sqlite3_deserialize(
          db,
          "main",
          pointer,
          bytes.byteLength,
          bytes.byteLength,
          SQLITE_DESERIALIZE_FREEONCLOSE | SQLITE_DESERIALIZE_RESIZEABLE,
        ),
      );
      return {
        all: async (sql) => db.selectObjects(sql),
        close: async () => {
          db.close();
        },
      };
    },
    create: async () => {
      const db = new sqlite.oo1.DB(":memory:");
      return {
        run: async (sql, params = []) => {
          db.exec(params.length ? { sql, bind: [...params] } : { sql });
        },
        export: async () => {
          const bytes = sqlite.capi.sqlite3_js_db_export(db);
          db.close();
          return bytes;
        },
      };
    },
  };
}
