/// <reference types="node" />
/* oxlint-disable unicorn/no-array-sort, typescript/require-array-sort-compare -- Tests sort fresh copies. */
// The packages in fixtures/apkg come from Anki itself (make_fixtures.py). Unzip, zstd and SQLite
// are the app layer's job, so this test plays the app with fflate, fzstd and node:sqlite.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { unzipSync, zipSync } from "fflate";
import { decompress } from "fzstd";
import { beforeAll, describe, expect, test } from "vite-plus/test";
import {
  Collection,
  readApkg,
  readApkgMedia,
  renderCard,
  replayCard,
  studyQueue,
  parseCollection,
  type AnkiPackage,
  type CollectionState,
} from "./index.ts";

const work = mkdtempSync(join(tmpdir(), "apkg-"));
let opened = 0;
function host(zip: Record<string, Uint8Array>) {
  return {
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
  };
}
const fixture = (name: string) =>
  unzipSync(readFileSync(new URL(`../fixtures/apkg/${name}`, import.meta.url)));
const read = (name: string) => readApkg(host(fixture(name)));
const environment = (deviceId = "phone-a", now = () => 1900000000000) => {
  let n = 0;
  return { deviceId, now, random: () => new Uint8Array(16).fill(n++) };
};
const imported = (state: CollectionState) => ({
  decks: state.decks.map((d) => d.fields.name.value),
  noteTypes: state.noteTypes
    .map((t) => [t.fields.kind.value, t.fields.templates.value.length, t.fields.fieldNames.value])
    .sort((a, b) => String(a).localeCompare(String(b))),
  notes: state.notes.map((n) => n.values.map((v) => v.value)).sort(),
  cards: state.cards.length,
  suspended: state.cards.filter((c) => c.fields.suspended.value).map((c) => c.fields.ordinal.value),
});

describe.each([
  ["legacy1.apkg", 1, 0.9, null],
  ["legacy2.apkg", 2, 0.85, 0.8],
  ["latest.apkg", 3, 0.85, 0.8],
] as const)("%s", (file, version, retention, override) => {
  test("brings note types, notes, cards, decks, preset and media", async () => {
    const { package: source, media } = await read(file);
    expect(source.version).toBe(version);
    const collection = new Collection(environment());
    expect(collection.importAnki(source)).toMatchObject({ notes: 3, cards: 5 });
    const state = collection.snapshot();
    expect(imported(state)).toEqual({
      decks: ["Português::Verbos"],
      noteTypes: [
        ["cloze", 1, ["Text", "Back Extra"]],
        ["standard", 1, ["Front", "Back"]],
        ["standard", 2, ["Front", "Back"]],
      ],
      notes: [
        ['<img src="gato.png"> gato', "cat [sound:miau.mp3]"],
        ["casa", "house"],
        ["{{c1::Brasília}} é a capital do {{c2::Brasil::país}}", ""],
      ],
      cards: 5,
      suspended: [1],
    });
    expect(state.presets.map((p) => [p.fields.name.value, p.fields.newPerDay.value])).toEqual([
      ["Fixture preset", 7],
    ]);
    const preset = state.presets[0]!.fields;
    expect([preset.reviewsPerDay.value, preset.learningSteps.value]).toEqual([70, [2, 15]]);
    expect(preset.desiredRetention.value).toBe(retention);
    expect(state.decks[0]!.fields.desiredRetention.value).toBe(override);
    expect(state.notes.find((n) => n.values[0]!.value === "casa")!.fields.tags.value).toEqual([]);
    expect(
      state.notes.find((n) => n.values[1]!.value.startsWith("cat"))!.fields.tags.value,
    ).toEqual(["animal"]);
    const files = await Promise.all(media.map(async (m) => [m.name, await m.bytes()] as const));
    expect(files.map(([name]) => name).sort()).toEqual(["gato.png", "miau.mp3"]);
    const bytes = new Map(files);
    expect(bytes.get("gato.png")!.slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(new TextDecoder().decode(bytes.get("miau.mp3"))).toContain("fixture audio");
  });

  test("turns the revlog into reviews, a reset and set due dates and skips cramming", async () => {
    const { package: source } = await read(file);
    const { log } = new Collection(environment()).importAnki(source);
    expect(
      log.map((e) => (e.kind === "review" ? [e.kind, e.grade, e.durationMs] : [e.kind])),
    ).toEqual([
      // The first is a v1 learning "Good" (ease 2) in the Legacy 1 package.
      ["review", 3, 1200],
      ["review", 3, 3400],
      ["review", 1, 5000],
      ["reset"],
      ["setDueDate"],
      ["setDueDate"],
    ]);
    expect(new Set(log.map((e) => e.cardId)).size).toBe(1);
    expect(log.every((e) => e.kind !== "review" || e.origin === "import")).toBe(true);
    const due = log.filter((e) => e.kind === "setDueDate").map((e) => e.due - e.at);
    expect(due[0]).toBeGreaterThan(4 * 86_400_000);
    expect(due[0]).toBeLessThanOrEqual(5 * 86_400_000);
    expect(due[1]).toBeGreaterThan(9 * 86_400_000);
  });
});

test("the same package gives the same ids on any device and re-importing duplicates nothing", async () => {
  const { package: source } = await read("latest.apkg");
  const a = new Collection(environment("phone-a"));
  const first = a.importAnki(source).log;
  const once = a.snapshot();
  const again = a.importAnki(source).log;
  expect(a.snapshot()).toEqual(once);
  expect(again.map((e) => e.id)).toEqual(first.map((e) => e.id));
  const b = new Collection(environment("phone-b"));
  const other = b.importAnki(source).log;
  expect(other.map((e) => e.id)).toEqual(first.map((e) => e.id));
  const elsewhere = b.snapshot();
  for (const kind of ["decks", "presets", "noteTypes", "notes", "cards"] as const) {
    const ids = elsewhere[kind].map((r) => r.id);
    expect(ids.sort()).toEqual(once[kind].map((r) => r.id).sort());
  }
  expect(once.notes.every((n) => /^[\da-f-]{36}$/.test(n.id) && n.id[14] === "5")).toBe(true);
});

test("re-import keeps newer local edits, takes newer Anki edits per field, and never resurrects", async () => {
  const { package: source } = await read("legacy2.apkg");
  const local = new Collection(environment());
  local.importAnki(source);
  const note = local.snapshot().notes.find((n) => n.values[0]!.value === "casa")!;
  local.editNote(note.id, ["casa", "home"]);
  local.importAnki(source);
  expect(
    local
      .snapshot()
      .notes.find((n) => n.id === note.id)!
      .values.map((v) => v.value),
  ).toEqual(["casa", "home"]);
  const later = 1950000000000;
  const fixed: AnkiPackage = {
    ...source,
    // oxlint-disable-next-line oxc/no-map-spread -- The package itself must stay unchanged.
    notes: source.notes.map((n) =>
      n.fields[0] === "casa" ? { ...n, mtime: later, fields: ["lar", "home"] } : n,
    ),
  };
  local.importAnki(fixed);
  const updated = local.snapshot().notes.find((n) => n.id === note.id)!;
  expect(updated.values.map((v) => v.value)).toEqual(["lar", "home"]);
  expect(updated.values[0]!.hlc.wallMs).toBe(later);
  // "home" was already the value: its local clock stays.
  expect(updated.values[1]!.hlc.deviceId).toBe("phone-a");

  const deck = local.snapshot().decks[0]!;
  local.deleteDeck(deck.id);
  local.importAnki(fixed);
  expect(local.snapshot().decks).toEqual([]);
  expect(local.snapshot().cards).toEqual([]);
});

test("imported reviews replay with the deck's preset and suspended cards stay out of study", async () => {
  const { package: source } = await read("latest.apkg");
  const collection = new Collection(environment());
  const { log } = collection.importAnki(source);
  const state = collection.snapshot();
  const deckId = state.decks[0]!.id;
  const queue = studyQueue(state, log, deckId, 1900000000000).map((c) => c.card.id);
  expect(queue).toHaveLength(4);
  const suspended = state.cards.find((c) => c.fields.suspended.value)!;
  expect(queue).not.toContain(suspended.id);
  // After the last reset only set due dates follow: the card is new with a due date.
  const memory = replayCard(log[0]!.cardId, log, state.presets[0]!, 1900000000000);
  expect(memory.reps).toBe(0);
});

const localMedia = (name: string) => `file:///data/media/${encodeURIComponent(name)}`;
describe("rendering imported cards", () => {
  let state: CollectionState;
  beforeAll(async () => {
    const collection = new Collection(environment());
    collection.importAnki((await read("latest.apkg")).package);
    state = collection.snapshot();
  });
  const side = (first: string, ordinal: number, shown: "front" | "back") => {
    const note = state.notes.find((n) => n.values[0]!.value.includes(first))!;
    const type = state.noteTypes.find((t) => t.id === note.fields.noteTypeId.value)!;
    return renderCard({ note, type, ordinal, side: shown, dark: false, media: localMedia });
  };
  test("cloze cards ask their own number and show the others", () => {
    expect(side("Brasília", 0, "front")).toContain(
      '<span class="cloze" data-ordinal="1">[...]</span> é a capital do <span class="cloze-inactive" data-ordinal="2">Brasil</span>',
    );
    expect(side("Brasília", 1, "front")).toContain(
      '<span class="cloze" data-ordinal="2">[país]</span>',
    );
    expect(side("Brasília", 1, "back")).toContain(
      '<span class="cloze" data-ordinal="2">Brasil</span>',
    );
    expect(side("Brasília", 1, "back")).toContain(".nightMode .cloze");
  });
  test("each template of a multi-template note type makes its own card", () => {
    expect(side("casa", 1, "front")).toContain("house");
    expect(side("casa", 1, "front")).not.toContain("casa");
    expect(side("casa", 1, "back")).toContain("house\n\n<hr id=answer>\n\ncasa");
    expect(side("casa", 0, "front")).not.toContain("house");
  });
  test("media load from local files and sounds get a player", () => {
    expect(side("gato", 0, "front")).toContain('<img src="file:///data/media/gato.png">');
    expect(side("gato", 0, "back")).toContain(
      '<audio controls preload="none" src="file:///data/media/miau.mp3"></audio>',
    );
    expect(side("gato", 0, "front")).not.toContain("[sound:");
  });
});

test("Anki template syntax: sections, filters, special fields and unclosed clozes", () => {
  const source: AnkiPackage = {
    version: 2,
    noteTypes: [
      {
        id: 10,
        name: "Vocab",
        mtime: 1000,
        kind: "standard",
        css: "",
        fields: ["Word", "Extra", "Reading"].map((name) => ({ name, id: "" })),
        templates: [
          {
            name: "Recognition",
            front:
              "{{Word}}{{#Extra}}<i>{{Extra}}</i>{{/Extra}}{{^Extra}}no extra{{/Extra}}{{type:Word}}",
            back: "{{FrontSide}}|{{text:Word}}|{{furigana:Reading}}|{{hint:Reading}}|{{Tags}}|{{Deck}}|{{Card}}|{{Type}}|{{Missing}}",
            id: "",
          },
        ],
      },
    ],
    decks: [{ id: 1, name: "Default", mtime: 1000, presetId: 1, desiredRetention: null }],
    presets: [],
    notes: [
      {
        id: 5,
        guid: "g",
        noteTypeId: 10,
        mtime: 1000,
        tags: ["a", "b"],
        fields: ["<b>gato</b>", " <br> ", "猫[ねこ]"],
      },
    ],
    cards: [
      { id: 6, noteId: 5, deckId: 1, ordinal: 0, mtime: 1000, suspended: false, buried: false },
    ],
    revlog: [],
  };
  const collection = new Collection(environment());
  collection.importAnki(source);
  const state = collection.snapshot();
  expect(state.decks[0]!.fields.presetId.value).toBe(state.presets[0]!.id);
  const input = { note: state.notes[0]!, type: state.noteTypes[0]!, ordinal: 0, dark: false };
  const body = (side: "front" | "back") =>
    /<body[^>]*>([\s\S]*)<\/body>/.exec(renderCard({ ...input, side, deckName: "A::B" }))![1];
  expect(body("front")).toBe("<b>gato</b>no extra");
  expect(body("back")).toBe(
    '<b>gato</b>no extra|gato|<ruby><rb>猫</rb><rt>ねこ</rt></ruby>|<details class="hint"><summary>Reading</summary>猫[ねこ]</details>|a b|A::B|Recognition|Vocab|',
  );
  const unclosed = { ...input.note, values: [{ ...input.note.values[0]!, value: "{{c1::open" }] };
  const cloze = {
    ...input.type,
    fields: { ...input.type.fields, kind: { ...input.type.fields.kind, value: "cloze" as const } },
  };
  cloze.fields.templates = {
    ...cloze.fields.templates,
    value: [{ name: "Cloze", front: "{{cloze:Word}}", back: "" }],
  };
  expect(renderCard({ ...input, note: unclosed, type: cloze, side: "front" })).toContain(
    "{{c1::open</body>",
  );
});

test("packages that need a newer app or carry unsafe media names are refused", async () => {
  const latest = fixture("latest.apkg");
  await expect(readApkg(host({ ...latest, meta: new Uint8Array([8, 4]) }))).rejects.toThrow(
    "newer version",
  );
  const legacy = fixture("legacy2.apkg");
  const media = new TextEncoder().encode(JSON.stringify({ 0: "../escape.mp3" }));
  await expect(readApkg(host({ ...legacy, media }))).rejects.toThrow("Unsafe media file name");
  await expect(readApkg(host({ media }))).rejects.toThrow("collection missing");
  // Old AnkiDroid packages had no media map.
  const { media: none } = await readApkg(
    host(unzipSync(zipSync({ ...legacy, media: undefined! }))),
  );
  expect(none).toEqual([]);
});

test("Basic notes stored before note fields had their own list are upgraded", () => {
  const hlc = { wallMs: 1, counter: 0, deviceId: "old" };
  // The pre-#49 shape no longer type-checks: that is what is being upgraded.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const old = {
    decks: [{ id: "d", fields: { name: { value: "Old", hlc }, presetId: { value: "p", hlc } } }],
    presets: [],
    noteTypes: [
      {
        id: "t",
        fields: {
          name: { value: "Basic", hlc },
          fieldNames: { value: ["Front", "Back"], hlc },
          frontTemplate: { value: "{{Front}}", hlc },
          backTemplate: { value: "{{Back}}", hlc },
          css: { value: "", hlc },
        },
      },
    ],
    notes: [
      {
        id: "n",
        fields: {
          deckId: { value: "d", hlc },
          noteTypeId: { value: "t", hlc },
          front: { value: "a", hlc },
          back: { value: "b", hlc },
        },
      },
    ],
    cards: [
      {
        id: "c",
        fields: {
          noteId: { value: "n", hlc },
          deckId: { value: "d", hlc },
          ordinal: { value: 0, hlc },
        },
      },
    ],
    tombstones: [],
  } as unknown as CollectionState;
  const state = parseCollection(old);
  expect(state.notes[0]!.values.map((v) => v.value)).toEqual(["a", "b"]);
  expect(state.notes[0]!.fields).not.toHaveProperty("front");
  expect(state.noteTypes[0]!.fields.templates.value).toEqual([
    { name: "Card 1", front: "{{Front}}", back: "{{Back}}" },
  ]);
  expect(state.cards[0]!.fields.suspended.value).toBe(false);
  expect(state.decks[0]!.fields.desiredRetention.value).toBeNull();
  const type = state.noteTypes[0]!;
  expect(
    renderCard({ note: state.notes[0]!, type, ordinal: 0, side: "back", dark: false }),
  ).toContain('<body class="card card1">b</body>');
});

const utf8 = (s: string) => [...new TextEncoder().encode(s)];
/** A protobuf MediaEntry: name = 1, size = 2, sha1 = 3, legacy_zip_filename = 255. */
const mediaEntry = (name: string, legacy?: number) => {
  const bytes = [0x0a, utf8(name).length, ...utf8(name), 0x10, 0x05, 0x1a, 0x01, 0xff];
  if (legacy !== undefined) bytes.push(0xf8, 0x0f, legacy);
  return [0x0a, bytes.length, ...bytes];
};
test("media alone are read without the collection, in protobuf order for Latest", async () => {
  const files = {
    meta: new Uint8Array([0x08, 0x03]),
    "collection.anki21b": new Uint8Array(),
    media: new Uint8Array([...mediaEntry("cat.jpg"), ...mediaEntry("café.png", 7)]),
    "0": new Uint8Array([1]),
    "7": new Uint8Array([2]),
  };
  const media = await readApkgMedia({ ...host(files), decompressZstd: (bytes) => bytes });
  expect(media.map((m) => m.name)).toEqual(["cat.jpg", "café.png".normalize("NFC")]);
  expect(await media[1]!.bytes()).toEqual(new Uint8Array([2]));
  await expect(readApkgMedia(host({ "notes.txt": new Uint8Array() }))).rejects.toThrow(
    "collection missing",
  );
});
