/// <reference types="node" />
/* oxlint-disable unicorn/no-array-sort, eslint/no-await-in-loop -- Tests sort fresh copies; imports run in order. */
// Export plays the app with node:sqlite, and reads its packages back with Core's own importer and
// the fixtures #49 built with real Anki.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { unzipSync } from "fflate";
import { decompress } from "fzstd";
import { expect, test } from "vite-plus/test";
import {
  Collection,
  readApkg,
  replayCard,
  uuid7,
  writeApkg,
  CardState,
  type CollectionState,
  type LogEntry,
} from "./index.ts";

const NOW = 1_900_000_000_000;
const DAY = 86_400_000;
const seconds = (ms: number) => Math.floor(ms / 1000);
const work = mkdtempSync(join(tmpdir(), "apkg-export-"));
let opened = 0;
const readHost = (zip: Record<string, Uint8Array>) => ({
  entries: Object.keys(zip),
  read: async (entry: string) => zip[entry]!,
  decompressZstd: decompress,
  openSqlite: async (bytes: Uint8Array) => {
    const path = join(work, `${opened++}.db`);
    writeFileSync(path, bytes);
    const db = new DatabaseSync(path, { readOnly: true });
    return {
      all: async (query: string) => db.prepare(query).all() as Record<string, unknown>[],
      close: async () => db.close(),
    };
  },
});
const files: Record<string, Uint8Array> = {
  "gato.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  "miau.mp3": new TextEncoder().encode("fixture audio"),
  "sol.jpg": new Uint8Array([0xff, 0xd8]),
  "unused.jpg": new Uint8Array([1]),
};
const writeHost = {
  createSqlite: async () => {
    const path = join(work, `${opened++}.db`);
    const db = new DatabaseSync(path);
    return {
      run: async (sql: string, params: readonly SQLInputValue[] = []) => {
        db.prepare(sql).run(...params);
      },
      export: async () => {
        db.close();
        return new Uint8Array(readFileSync(path));
      },
    };
  },
  media: async (name: string) => files[name],
};
const environment = (deviceId = "phone-a") => {
  let n = 0;
  return { deviceId, now: () => NOW, random: () => new Uint8Array(16).fill(n++) };
};
const fixture = (name: string) =>
  unzipSync(readFileSync(new URL(`../fixtures/apkg/${name}`, import.meta.url)));

let entries = 0;
type Body = LogEntry extends infer E
  ? E extends LogEntry
    ? Omit<E, "id" | "cardId" | "at">
    : never
  : never;
const entry = (cardId: string, at: number, body: Body): LogEntry => ({
  id: uuid7(at, new Uint8Array(16).fill(entries++)),
  cardId,
  at,
  ...body,
});
const review = (cardId: string, at: number, grade: 1 | 2 | 3 | 4): LogEntry =>
  entry(cardId, at, { kind: "review", grade, durationMs: 4200, origin: "phone" });

/**
 * An Anki deck from legacy2.apkg studied on in the app, and the app's own deck with a subdeck:
 * reviews, a forget, a set due date, an undone review and two answers in the same millisecond.
 */
async function studied() {
  const collection = new Collection(environment());
  const { package: source } = await readApkg(readHost(fixture("legacy2.apkg")));
  const imported = collection.importAnki(source).log;
  const english = collection.createDeck("Inglês");
  const phrasal = collection.createDeck("Inglês::Phrasal verbs");
  const other = collection.createDeck("Outro");
  const sun = collection.addBasicNote(english.id, '<img src="sol.jpg"> sun', "sol");
  const moon = collection.addBasicNote(english.id, "moon", "lua");
  const up = collection.addBasicNote(phrasal.id, "give up", "desistir");
  collection.addBasicNote(other.id, "elsewhere", "noutro lugar");
  collection.addBasicNote(english.id, "new one", "novo");
  const state = collection.snapshot();
  const card = (noteId: string) => state.cards.find((c) => c.fields.noteId.value === noteId)!.id;
  const gato = state.cards.find((c) => c.anki && c.fields.ordinal.value === 0)!;
  const start = NOW - 30 * DAY;
  const undone = review(card(moon.id), start + 3 * DAY, 1);
  const log: LogEntry[] = [
    ...imported,
    review(card(sun.id), start, 3),
    review(card(sun.id), start + DAY, 3),
    review(card(sun.id), start + 5 * DAY, 4),
    review(card(moon.id), start, 2),
    review(card(moon.id), start + 2 * DAY, 3),
    undone,
    entry(card(moon.id), start + 3 * DAY + 1, { kind: "void", targetId: undone.id }),
    entry(card(moon.id), start + 4 * DAY, { kind: "setDueDate", due: NOW + 2 * DAY }),
    review(card(up.id), start, 3),
    review(card(up.id), start + DAY, 3),
    entry(card(up.id), start + 2 * DAY, { kind: "reset" }),
    // Same millisecond as a review of another card: Anki keys revlog rows by time.
    review(card(up.id), start + 4 * DAY, 3),
    review(card(sun.id), start + 4 * DAY, 2),
    review(gato.id, start + 4 * DAY, 3),
  ];
  return { collection, log, english, phrasal, other, source };
}
const deckId = (state: CollectionState, name: string) =>
  state.decks.find((d) => d.fields.name.value === name)!.id;
async function exported(state: CollectionState, log: LogEntry[], name: string) {
  const zip = await writeApkg(writeHost, {
    collection: state,
    log,
    deckId: deckId(state, name),
    now: NOW,
  });
  return { zip, ...(await readApkg(readHost(zip))) };
}
/** Records without their clocks: what a fresh install can compare. */
const plain = (state: CollectionState) =>
  Object.fromEntries(
    (["decks", "presets", "noteTypes", "notes", "cards"] as const).map((kind) => [
      kind,
      state[kind]
        .map((r) => ({
          id: r.id,
          fields: Object.fromEntries(Object.entries(r.fields).map(([k, f]) => [k, f.value])),
          values: "values" in r ? r.values.map((v) => v.value) : undefined,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ]),
  );
/** What replay sees of an entry, whatever its id and origin. */
const history = (log: readonly LogEntry[]) => {
  const voided = new Set(log.flatMap((e) => (e.kind === "void" ? [e.targetId, e.id] : [])));
  return log
    .filter((e) => !voided.has(e.id) && e.kind !== "snapshot")
    .map((e) => ({
      cardId: e.cardId,
      // Anki keys revlog rows by millisecond: an answer that shares one moves by a millisecond.
      second: seconds(e.at),
      kind: e.kind,
      grade: e.kind === "review" ? e.grade : undefined,
      durationMs: e.kind === "review" ? e.durationMs : undefined,
      due: e.kind === "setDueDate" ? e.due : undefined,
    }))
    .sort(
      (a, b) =>
        a.second - b.second || a.cardId.localeCompare(b.cardId) || a.kind.localeCompare(b.kind),
    );
};

test("exporting a deck and importing it back changes no record and adds no review", async () => {
  const { collection, log } = await studied();
  const before = collection.snapshot();
  for (const name of ["Inglês", "Português::Verbos"]) {
    const { package: source } = await exported(before, log, name);
    expect(collection.importAnki(source, log).log).toEqual([]);
    expect(collection.snapshot()).toEqual(before);
  }
});

test("a buried card exports as user-buried and imports buried until the same study day", async () => {
  const { collection, log, english } = await studied();
  const before = collection.snapshot();
  const moon = before.cards.find(
    (c) =>
      c.fields.deckId.value === english.id &&
      before.notes.find((n) => n.id === c.fields.noteId.value)!.values[0]!.value === "moon",
  )!;
  collection.buryCard(moon.id);
  const state = collection.snapshot();
  const { zip, package: source } = await exported(state, log, "Inglês");
  expect(rows(zip, "SELECT queue FROM cards WHERE queue < 0").map((r) => r.queue)).toEqual([-3]);
  const fresh = new Collection(environment("phone-b"));
  fresh.importAnki(source);
  expect(source.cards.filter((c) => c.buried)).toHaveLength(1);
  expect(
    fresh
      .snapshot()
      .cards.filter((c) => c.fields.buriedUntil.value)
      .map((c) => [c.id, c.fields.buriedUntil.value]),
  ).toEqual([[moon.id, new Date(2030, 2, 18, 4).getTime()]]);
  expect(collection.importAnki(source, log).log).toEqual([]);
  expect(collection.snapshot()).toEqual(state);
  const tomorrow = await writeApkg(writeHost, {
    collection: state,
    log,
    deckId: english.id,
    now: new Date(2030, 2, 18, 4).getTime(),
  });
  expect(rows(tomorrow, "SELECT queue FROM cards WHERE queue < 0")).toEqual([]);
});

test("another install gets the same records, history and schedule from the export", async () => {
  const { collection, log } = await studied();
  const state = collection.snapshot();
  const fresh = new Collection(environment("phone-b"));
  const added: LogEntry[] = [];
  for (const name of ["Inglês", "Português::Verbos"])
    added.push(...fresh.importAnki((await exported(state, log, name)).package).log);
  const copy = fresh.snapshot();
  const outro = deckId(state, "Outro");
  const kept = new Set(state.cards.filter((c) => c.fields.deckId.value !== outro).map((c) => c.id));
  const expected = plain({
    ...state,
    decks: state.decks.filter((d) => d.id !== outro),
    cards: state.cards.filter((c) => kept.has(c.id)),
    notes: state.notes.filter((n) =>
      state.cards.some((c) => kept.has(c.id) && c.fields.noteId.value === n.id),
    ),
  });
  expect(plain(copy)).toEqual(expected);
  expect(history(added)).toEqual(history(log));
  for (const card of copy.cards) {
    const preset = (s: CollectionState) => {
      const deck = s.decks.find((d) => d.id === card.fields.deckId.value)!;
      return s.presets.find((p) => p.id === deck.fields.presetId.value)!;
    };
    const there = replayCard(card.id, added, preset(copy), NOW);
    const here = replayCard(card.id, log, preset(state), NOW);
    const schedule = (m: typeof here) => [m.state, seconds(m.due.getTime()), m.stability];
    expect(schedule(there)).toEqual(schedule(here));
  }
});

test("the deck's subdecks come along with the media their notes use, other decks stay out", async () => {
  const { collection, log } = await studied();
  const { package: source, media, zip } = await exported(collection.snapshot(), log, "Inglês");
  expect(source.decks.map((d) => d.name).sort()).toEqual(["Inglês", "Inglês::Phrasal verbs"]);
  expect(source.notes.map((n) => n.fields[0]!).sort((a, b) => a.localeCompare(b))).toEqual([
    '<img src="sol.jpg"> sun',
    "give up",
    "moon",
    "new one",
  ]);
  expect(media.map((m) => m.name)).toEqual(["sol.jpg"]);
  expect(await media[0]!.bytes()).toEqual(files["sol.jpg"]);
  expect(Object.keys(zip).sort((a, b) => a.localeCompare(b))).toEqual([
    "0",
    "collection.anki21",
    "media",
    "meta",
  ]);

  const anki = await exported(collection.snapshot(), log, "Português::Verbos");
  expect(anki.media.map((m) => m.name).sort()).toEqual(["gato.png", "miau.mp3"]);
  expect(anki.package.version).toBe(2);
});

/** The exported collection's rows, straight from SQLite. */
function rows(zip: Record<string, Uint8Array>, query: string) {
  const path = join(work, `${opened++}.db`);
  writeFileSync(path, zip["collection.anki21"]!);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare(query).all();
  } finally {
    db.close();
  }
}

test("the package is Legacy 2 with Anki's scheduling columns, FSRS state and revlog kinds", async () => {
  const { collection, log, english } = await studied();
  const state = collection.snapshot();
  const { zip } = await exported(state, log, "Inglês");
  expect([...zip.meta!]).toEqual([0x08, 0x02]);
  const [col] = rows(zip, "SELECT ver, crt, conf, dconf FROM col");
  expect(col!.ver).toBe(11);
  const conf = JSON.parse(String(col!.conf));
  expect(conf).toMatchObject({ schedVer: 2, rollover: 4 });
  // Presets are added by id with INSERT OR IGNORE: id 1 would keep the target's Default.
  const dconf = JSON.parse(String(col!.dconf));
  expect(Object.keys(dconf)).not.toContain("1");
  const preset = dconf[Object.keys(dconf)[0]!];
  expect(preset).toMatchObject({ desiredRetention: 0.9, maxTaken: 60, autoplay: true });
  expect(preset.fsrsParams6).toHaveLength(21);

  const cards = rows(zip, "SELECT * FROM cards");
  const sun = state.cards.find(
    (c) =>
      c.fields.deckId.value === english.id &&
      state.notes.find((n) => n.id === c.fields.noteId.value)!.values[1]!.value === "sol",
  )!;
  const memory = replayCard(
    sun.id,
    log,
    state.presets.find((p) => !p.anki)!,
    NOW,
  );
  expect(memory.state).toBe(CardState.Review);
  const row = cards.find((c) => c.ivl === memory.scheduled_days && c.type === 2)!;
  expect([row.queue, row.reps, row.lapses]).toEqual([2, memory.reps, memory.lapses]);
  // Review due is a day number from crt, at the 4 am study day boundary.
  const due = new Date(Number(col!.crt) * 1000);
  due.setDate(due.getDate() + Number(row.due));
  expect(due.getTime()).toBe(new Date(memory.due).setHours(4, 0, 0, 0));
  const data = JSON.parse(String(row.data));
  expect(data).toMatchObject({ s: Number(memory.stability.toFixed(4)), dr: 0.9 });
  expect(data.lrt).toBe(Math.floor(memory.last_review!.getTime() / 1000));
  const fresh = cards.filter((c) => c.type === 0);
  expect(fresh.map((c) => [c.queue, c.data])).toEqual([[0, "{}"]]);

  const revlog = rows(zip, "SELECT * FROM revlog ORDER BY id");
  expect(new Set(revlog.map((r) => r.id)).size).toBe(revlog.length);
  const shared = NOW - 26 * DAY;
  expect(revlog.filter((r) => Math.abs(Number(r.id) - shared) <= 1).map((r) => r.id)).toEqual([
    shared,
    shared + 1,
  ]);
  // The undone review and its void are left out; a forget is a manual entry with factor 0 and a
  // set due date one with a factor.
  expect(revlog).toHaveLength(11);
  expect(revlog.filter((r) => r.ease === 0).map((r) => [r.type, r.factor === 0])).toEqual([
    [4, true],
    [4, false],
  ]);
  const graded = revlog.filter((r) => Number(r.ease) > 0);
  expect(graded.every((r) => Number(r.type) <= 2 && r.time === 4200)).toBe(true);
});

test("media are asked for by bare file name only", async () => {
  const collection = new Collection(environment());
  const deck = collection.createDeck("Paths");
  collection.addBasicNote(deck.id, '<img src="../escape.png"> [sound:a/b.mp3]', "[sound:ok.mp3]");
  const asked: string[] = [];
  const zip = await writeApkg(
    {
      ...writeHost,
      media: async (name) => {
        asked.push(name);
        return new Uint8Array([1]);
      },
    },
    { collection: collection.snapshot(), log: [], deckId: deck.id, now: NOW },
  );
  expect(asked).toEqual(["ok.mp3"]);
  expect(new TextDecoder().decode(zip.media)).toBe('{"0":"ok.mp3"}');
});

test("a deck that is not there can't be exported", async () => {
  const { collection, log } = await studied();
  await expect(
    writeApkg(writeHost, { collection: collection.snapshot(), log, deckId: "nope", now: NOW }),
  ).rejects.toThrow("Deck missing");
});

test("what Anki makes of an export comes back as the same records and reviews", async () => {
  // app.apkg is the app's own export; through-anki.apkg is Anki 26.09's Latest export of it after
  // an import with learning progress and presets (fixtures/apkg/make_app_export.mts).
  const collection = new Collection(environment());
  const { package: ours } = await readApkg(readHost(fixture("app.apkg")));
  const { log } = collection.importAnki(ours);
  const mine = collection.snapshot();
  const { package: anki } = await readApkg(readHost(fixture("through-anki.apkg")));
  expect(anki.version).toBe(3);
  expect(collection.importAnki(anki, log).log).toEqual([]);
  const after = collection.snapshot();
  for (const kind of ["decks", "presets", "noteTypes", "notes", "cards"] as const)
    expect(after[kind].map((r) => r.id).sort()).toEqual(mine[kind].map((r) => r.id).sort());
  expect(after.presets[0]!.fields.fsrsParameters.value).toHaveLength(21);
  expect(history(log).map((e) => e.kind)).toEqual([
    "review",
    "review",
    "reset",
    "review",
    "review",
    "setDueDate",
    "review",
  ]);
});
