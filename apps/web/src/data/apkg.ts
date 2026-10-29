// `.apkg` import and export in the leader's database Worker, through Core's reader and writer.
import type { ClientData, ImportSummary, MediaFiles } from "@app/client-data";
import {
  apkgFileName,
  readApkg,
  writeApkg,
  type AnkiDatabase,
  type WritableDatabase,
} from "@app/core";
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

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

export function apkgOperations(data: ClientData["Service"], files: ApkgFiles) {
  return {
    /** Stores the package's media first, so no imported card points at a missing file. */
    importApkg: async (bytes: Uint8Array): Promise<ImportSummary> => {
      const zip = unzipSync(bytes);
      const { package: source, media } = await readApkg({
        entries: Object.keys(zip),
        read: async (entry) => {
          const content = zip[entry];
          if (!content) throw new Error(`Missing package entry ${entry}`);
          return content;
        },
        decompressZstd: (compressed) => decompress(compressed),
        openSqlite: files.sqlite.open,
      });
      await run(data.storeMedia(media));
      return run(data.importAnki(source));
    },
    /** A deck with its subdecks, scheduling, history and media, as a zipped package. */
    exportApkg: async (deckId: string): Promise<ApkgExport> => {
      const [collection, log] = await run(Effect.all([data.collection, data.reviewLog]));
      const deck = collection.decks.find((d) => d.id === deckId);
      if (!deck) throw new Error("Deck missing");
      const entries = await writeApkg(
        {
          createSqlite: files.sqlite.create,
          media: async (name) => (await files.media.read(name)) ?? undefined,
        },
        { collection, log, deckId, now: Date.now() },
      );
      return { name: apkgFileName(deck.fields.name.value), bytes: zipSync(entries) };
    },
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
