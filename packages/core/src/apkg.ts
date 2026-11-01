/* oxlint-disable unicorn/no-array-sort -- ES2022/Hermes target; only fresh copies are sorted. */
import { safeMediaName } from "./media.ts";
import { Message } from "./protobuf.ts";

/**
 * What the app gives Core to read an `.apkg`: the zip's entries, zstd and a read-only SQLite
 * opened from bytes. Core decides which entry is the collection, what to decompress and what to
 * query (docs/research/apkg-formats.md).
 */
export interface ApkgHost {
  entries: readonly string[];
  read: (entry: string) => Promise<Uint8Array>;
  decompressZstd: (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>;
  openSqlite: (bytes: Uint8Array) => Promise<AnkiDatabase>;
}
export interface AnkiDatabase {
  all: (query: string) => Promise<Record<string, unknown>[]>;
  close: () => Promise<void>;
}
/**
 * Times are epoch milliseconds. Anki ids stay numbers; field and template ids are int64 strings.
 * `appId` is the app's own id of a record it exported without an Anki identity (apkg-export.ts).
 */
export interface AnkiPackage {
  version: 1 | 2 | 3;
  noteTypes: {
    id: number;
    appId?: string | undefined;
    name: string;
    mtime: number;
    kind: "standard" | "cloze";
    css: string;
    fields: { name: string; id: string }[];
    templates: { name: string; front: string; back: string; id: string }[];
  }[];
  /** Normal decks only, with `::` between levels. Filtered decks are left out. */
  decks: {
    id: number;
    appId?: string | undefined;
    name: string;
    mtime: number;
    presetId: number;
    desiredRetention: number | null;
  }[];
  presets: {
    id: number;
    appId?: string | undefined;
    name: string;
    mtime: number;
    newPerDay: number;
    reviewsPerDay: number;
    desiredRetention: number;
    buryNew?: boolean;
    buryReviews?: boolean;
    buryLearning?: boolean;
    learningSteps: number[];
    /** FSRS-6 weights; absent or empty means the defaults. */
    fsrsParameters?: number[];
  }[];
  notes: {
    id: number;
    appId?: string | undefined;
    guid: string;
    noteTypeId: number;
    mtime: number;
    tags: string[];
    fields: string[];
  }[];
  /** `deckId` is the card's home deck when it sits in a filtered deck. */
  cards: {
    id: number;
    noteId: number;
    deckId: number;
    ordinal: number;
    mtime: number;
    suspended: boolean;
    /** Buried by the user or by sibling burying (queue -3 or -2), until the next study day. */
    buried: boolean;
    flag?: number;
  }[];
  /** Revlog rows as log entries. Cram rows and rows without a grade or schedule change are gone. */
  revlog: ({ id: number; cardId: number; at: number } & (
    | { kind: "review"; grade: 1 | 2 | 3 | 4; durationMs: number }
    | { kind: "reset" }
    | { kind: "setDueDate"; interval: number }
  ))[];
}
export interface ApkgMedia {
  name: string;
  bytes: () => Promise<Uint8Array>;
}

const FILES = { 1: "collection.anki2", 2: "collection.anki21", 3: "collection.anki21b" } as const;

/** Reads the package's collection and lists its media files. */
export async function readApkg(
  host: ApkgHost,
): Promise<{ package: AnkiPackage; media: ApkgMedia[] }> {
  const { version, latest, unpack } = await open(host);
  const database = await host.openSqlite(openable(await unpack(await host.read(FILES[version]))));
  let parsed: AnkiPackage;
  try {
    parsed = { version, ...(await readCollection(database)) };
  } finally {
    await database.close();
  }
  return { package: parsed, media: await readMedia(host, latest, unpack) };
}

/** A host's entries and reader over a package's unzipped files, held in memory. */
export const packageEntries = (
  files: Readonly<Record<string, Uint8Array>>,
): Pick<ApkgHost, "entries" | "read"> => ({
  entries: Object.keys(files),
  read: async (entry) => {
    const content = files[entry];
    if (!content) throw new Error(`Missing package entry ${entry}`);
    return content;
  },
});

/**
 * Lists only the package's media files, without opening its collection: for an export of a deck
 * linked from AnkiDroid, whose API hands out records but not media.
 */
export async function readApkgMedia(host: Omit<ApkgHost, "openSqlite">): Promise<ApkgMedia[]> {
  const { latest, unpack } = await open(host);
  return readMedia(host, latest, unpack);
}

type Unpack = (bytes: Uint8Array) => Promise<Uint8Array>;
async function open(host: Omit<ApkgHost, "openSqlite">) {
  const has = new Set(host.entries);
  const version = has.has("meta")
    ? packageVersion(new Message(await host.read("meta")).number(1))
    : has.has(FILES[2])
      ? 2
      : 1;
  if (!has.has(FILES[version])) throw new Error("Not an Anki package: collection missing");
  const latest = version === 3;
  const unpack: Unpack = async (bytes) => (latest ? host.decompressZstd(bytes) : bytes);
  return { version, latest, unpack };
}
async function readMedia(
  host: Omit<ApkgHost, "openSqlite">,
  latest: boolean,
  unpack: Unpack,
): Promise<ApkgMedia[]> {
  const has = new Set(host.entries);
  const map = has.has("media") ? await unpack(await host.read("media")) : undefined;
  return (map ? mediaEntries(map, latest) : [])
    .filter(({ entry }) => has.has(entry))
    .map(({ entry, name }) => ({ name, bytes: async () => unpack(await host.read(entry)) }));
}

function packageVersion(version: number | undefined): 1 | 2 | 3 {
  if (version === 1 || version === 2 || version === 3) return version;
  throw new Error("This package needs a newer version of the app");
}

/**
 * Bytes that SQLite can open in memory with no Anki code: the WAL marker cleared and Anki's
 * `unicase` collation declared as binary, which only the name indexes used. Same-length edits of
 * the schema text, which SQLite keeps whole in one cell.
 */
function openable(source: Uint8Array) {
  const bytes = source.slice();
  if (bytes.length > 19 && bytes[18] === 2) bytes[18] = bytes[19] = 1;
  const from = new TextEncoder().encode("COLLATE unicase");
  const to = new TextEncoder().encode("COLLATE binary ");
  for (let i = bytes.indexOf(from[0]!); i >= 0 && i <= bytes.length - from.length;) {
    if (from.every((b, j) => bytes[i + j] === b)) bytes.set(to, i);
    i = bytes.indexOf(from[0]!, i + 1);
  }
  return bytes;
}

function mediaEntries(map: Uint8Array, latest: boolean) {
  if (latest)
    return new Message(map).messages(1).map((entry, index) => ({
      entry: String(entry.number(255) ?? index),
      name: mediaName(entry.string(1) ?? ""),
    }));
  const json: unknown = JSON.parse(new TextDecoder().decode(map));
  if (!json || typeof json !== "object") throw new Error("Corrupt media map");
  return Object.entries(json).map(([entry, name]) => ({ entry, name: mediaName(String(name)) }));
}
/** Media names are bare file names, NFC like Anki's. Anything else is a corrupt package. */
function mediaName(name: string) {
  const safe = safeMediaName(name);
  if (safe === undefined) throw new Error(`Unsafe media file name: ${JSON.stringify(name)}`);
  return safe;
}

type Row = Record<string, unknown>;
const text = (value: unknown) => {
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return typeof value === "string" || typeof value === "number" || typeof value === "bigint"
    ? String(value)
    : "";
};
const blob = (value: unknown) =>
  value instanceof Uint8Array ? value : new TextEncoder().encode(text(value));
const int = (value: unknown) => Number(value ?? 0);
/** int64 ids in Anki's JSON lose digits as doubles: read them as strings. */
const json = (source: unknown): unknown =>
  JSON.parse(text(source).replace(/("id"\s*:\s*)(-?\d{16,})/g, '$1"$2"'));
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? Object.fromEntries(Object.entries(value)) : {};
const GRADES = [1, 2, 3, 4] as const;
const byOrd = (a: unknown, b: unknown) => int(record(a).ord) - int(record(b).ord);
const ofType = (rows: Row[], id: number) =>
  rows.filter((r) => int(r.ntid) === id).sort((a, b) => int(a.ord) - int(b.ord));
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const steps = (value: unknown) => list(value).map(Number).filter(Number.isFinite);
const retention = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : fallback;
};
/** FSRS-6 has 21 weights; older parameter sets don't fit the app's scheduler. */
const fsrs6 = (weights: number[]) => (weights.length === 21 ? weights : []);
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
/** The JSON key an exported config record keeps its app id in. Part of the format: never rename. */
export const APP_ID_KEY = "ankiAlarmId";
const appId = (value: unknown) => {
  const id = text(value);
  return UUID.test(id) ? id.toLowerCase() : undefined;
};
/** Schema-15+ config blobs keep unknown schema-11 JSON keys as JSON bytes in field 255. */
const otherAppId = (config: Message) => {
  const other = config.bytes(255);
  if (!other?.length) return undefined;
  try {
    return appId(record(JSON.parse(new TextDecoder().decode(other)))[APP_ID_KEY]);
  } catch {
    return undefined;
  }
};

async function readCollection(db: AnkiDatabase): Promise<Omit<AnkiPackage, "version">> {
  const tables = new Set(
    (await db.all("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => text(r.name)),
  );
  const config = tables.has("notetypes") ? await readTables(db) : await readJson(db);
  const notes = (await db.all("SELECT id, guid, mid, mod, tags, flds FROM notes")).map((r) => ({
    id: int(r.id),
    // The app exports its own notes with their id as the guid.
    appId: appId(r.guid),
    guid: text(r.guid),
    noteTypeId: int(r.mid),
    mtime: int(r.mod) * 1000,
    tags: text(r.tags).split(/\s+/).filter(Boolean),
    fields: text(r.flds).split("\x1f"),
  }));
  const cards = (await db.all("SELECT id, nid, did, odid, ord, mod, queue, flags FROM cards")).map(
    (r) => ({
      id: int(r.id),
      noteId: int(r.nid),
      deckId: int(r.odid) || int(r.did),
      ordinal: int(r.ord),
      mtime: int(r.mod) * 1000,
      suspended: int(r.queue) === -1,
      buried: int(r.queue) === -2 || int(r.queue) === -3,
      flag: int(r.flags) & 7,
    }),
  );
  const revlog: AnkiPackage["revlog"] = [];
  for (const r of await db.all("SELECT id, cid, ease, ivl, factor, time, type FROM revlog")) {
    const [ease, type, factor] = [int(r.ease), int(r.type), int(r.factor)];
    const base = { id: int(r.id), cardId: int(r.cid), at: int(r.id) };
    if (type === 3 && factor === 0) continue; // cramming
    if (ease === 0) {
      if (type === 4 && factor === 0) revlog.push({ ...base, kind: "reset" });
      else if (type === 4 || type === 5)
        revlog.push({ ...base, kind: "setDueDate", interval: int(r.ivl) });
    } else {
      // The v1 scheduler's learning buttons: Anki's v2 upgrade moves 2 and 3 up one.
      const v1 =
        config.schedulerVersion === 1 && (type === 0 || type === 2) && ease < 4 && ease > 1;
      const grade = GRADES.find((g) => g === (v1 ? ease + 1 : ease));
      if (grade) revlog.push({ ...base, kind: "review", grade, durationMs: int(r.time) });
    }
  }
  return {
    noteTypes: config.noteTypes,
    decks: config.decks,
    presets: config.presets,
    notes,
    cards,
    revlog,
  };
}

type Config = Pick<AnkiPackage, "noteTypes" | "decks" | "presets"> & { schedulerVersion: number };

/** Schema 11: note types, decks and presets are JSON in the `col` row. */
async function readJson(db: AnkiDatabase): Promise<Config> {
  const [col] = await db.all("SELECT conf, models, decks, dconf FROM col");
  if (!col) throw new Error("Corrupt collection");
  return {
    schedulerVersion: int(record(json(col.conf)).schedVer) || 1,
    noteTypes: Object.values(record(json(col.models))).map((model) => {
      const m = record(model);
      return {
        id: int(m.id),
        appId: appId(m[APP_ID_KEY]),
        name: text(m.name),
        mtime: int(m.mod) * 1000,
        kind: int(m.type) === 1 ? "cloze" : "standard",
        css: text(m.css),
        fields: list(m.flds)
          .slice()
          .sort(byOrd)
          .map((f) => ({ name: text(record(f).name), id: text(record(f).id ?? "") })),
        templates: list(m.tmpls)
          .slice()
          .sort(byOrd)
          .map((value) => {
            const t = record(value);
            return {
              name: text(t.name),
              front: text(t.qfmt),
              back: text(t.afmt),
              id: text(t.id ?? ""),
            };
          }),
      };
    }),
    decks: Object.values(record(json(col.decks)))
      .map(record)
      .filter((d) => !int(d.dyn))
      .map((d) => ({
        id: int(d.id),
        appId: appId(d[APP_ID_KEY]),
        name: text(d.name),
        mtime: int(d.mod) * 1000,
        presetId: int(d.conf) || 1,
        desiredRetention:
          d.desiredRetention == null ? null : retention(int(d.desiredRetention) / 100, 0.9),
      })),
    presets: Object.values(record(json(col.dconf)))
      .map(record)
      .map((c) => ({
        id: int(c.id),
        appId: appId(c[APP_ID_KEY]),
        name: text(c.name),
        mtime: int(c.mod) * 1000,
        newPerDay: int(record(c.new).perDay),
        reviewsPerDay: int(record(c.rev).perDay),
        desiredRetention: retention(c.desiredRetention, 0.9),
        buryNew: record(c.new).bury === true,
        buryReviews: record(c.rev).bury === true,
        buryLearning: c.buryInterdayLearning === true,
        learningSteps: steps(record(c.new).delays),
        fsrsParameters: fsrs6(steps(c.fsrsParams6)),
      })),
  };
}

/** Schema 15+: tables whose `config` columns are protobuf. */
async function readTables(db: AnkiDatabase): Promise<Config> {
  const fields = await db.all("SELECT ntid, ord, name, config FROM fields");
  const templates = await db.all("SELECT ntid, ord, name, config FROM templates");
  const [schedVer] = await db.all("SELECT val FROM config WHERE KEY = 'schedVer'");
  return {
    schedulerVersion: schedVer ? Number(text(schedVer.val)) || 2 : 2,
    noteTypes: (await db.all("SELECT id, name, mtime_secs, config FROM notetypes")).map((r) => {
      const config = new Message(blob(r.config));
      return {
        id: int(r.id),
        appId: otherAppId(config),
        name: text(r.name),
        mtime: int(r.mtime_secs) * 1000,
        kind: config.number(1) === 1 ? "cloze" : "standard",
        css: config.string(3) ?? "",
        fields: ofType(fields, int(r.id)).map((f) => ({
          name: text(f.name),
          id: new Message(blob(f.config)).int64(9) ?? "",
        })),
        templates: ofType(templates, int(r.id)).map((t) => {
          const c = new Message(blob(t.config));
          return {
            name: text(t.name),
            front: c.string(1) ?? "",
            back: c.string(2) ?? "",
            id: c.int64(8) ?? "",
          };
        }),
      };
    }),
    decks: (await db.all("SELECT id, name, mtime_secs, common, kind FROM decks")).flatMap((r) => {
      const normal = new Message(blob(r.kind)).message(1);
      if (!normal) return [];
      const override = normal.float(10);
      return [
        {
          id: int(r.id),
          appId: otherAppId(new Message(blob(r.common))),
          name: text(r.name).split("\x1f").join("::"),
          mtime: int(r.mtime_secs) * 1000,
          presetId: normal.number(1) || 1,
          desiredRetention: override === undefined ? null : retention(override, 0.9),
        },
      ];
    }),
    presets: (await db.all("SELECT id, name, mtime_secs, config FROM deck_config")).map((r) => {
      const c = new Message(blob(r.config));
      return {
        id: int(r.id),
        appId: otherAppId(c),
        name: text(r.name),
        mtime: int(r.mtime_secs) * 1000,
        newPerDay: c.number(9) ?? 0,
        reviewsPerDay: c.number(10) ?? 0,
        desiredRetention: retention(c.float(37), 0.9),
        buryNew: c.number(27) === 1,
        buryReviews: c.number(28) === 1,
        buryLearning: c.number(29) === 1,
        learningSteps: c.floats(1),
        fsrsParameters: fsrs6(c.floats(6)),
      };
    }),
  };
}
