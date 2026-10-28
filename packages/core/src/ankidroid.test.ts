import { expect, test } from "vite-plus/test";
import {
  Collection,
  ankiDroidAccess,
  cardId,
  importId,
  linkableAnkiDroidDecks,
  replayCard,
  studyQueue,
  type AnkiDroidSource,
} from "./index.ts";

const now = Date.UTC(2026, 9, 28, 12);
const environment = (deviceId = "phone-a") => {
  let n = 0;
  return { deviceId, now: () => now, random: () => new Uint8Array(16).fill(n++) };
};
const options = JSON.stringify({
  id: 1,
  name: "Default",
  new: { perDay: 15, delays: [1, 10] },
  rev: { perDay: 150 },
  desiredRetention: 0.85,
});
const card = (over: Partial<AnkiDroidSource["cards"][number]>) => ({
  id: 9001,
  noteId: 501,
  ord: 0,
  deckId: 1700000000001,
  originalDeckId: 0,
  reps: 0,
  lapses: 0,
  type: 0,
  queue: 0,
  due: 1,
  interval: 0,
  left: 0,
  stability: null,
  difficulty: null,
  lastReviewSecs: null,
  ...over,
});
const source = (): AnkiDroidSource => ({
  deckId: 1700000000001,
  decks: [
    { id: 1, name: "Default", options, filtered: false },
    { id: 1700000000001, name: "Japanese", options, filtered: false },
    { id: 1700000000002, name: "Japanese::Kanji", options, filtered: false },
  ],
  noteTypes: [
    {
      id: 1600000000000,
      name: "Basic (and reversed card)",
      fieldNames: "Front\u001fBack",
      css: ".card{color:red}",
      cloze: false,
      templates: [
        { ord: 1, name: "Card 2", front: "{{Back}}", back: "{{FrontSide}}<hr>{{Front}}" },
        { ord: 0, name: "Card 1", front: "{{Front}}", back: "{{FrontSide}}<hr>{{Back}}" },
      ],
    },
  ],
  notes: [
    {
      id: 501,
      guid: "abc",
      noteTypeId: 1600000000000,
      mod: 1_760_000_000,
      tags: " verb n5 ",
      fields: "食べる\u001feat",
    },
  ],
  cards: [
    card({}),
    card({
      id: 9002,
      ord: 1,
      deckId: 1700000000002,
      reps: 4,
      lapses: 1,
      type: 2,
      queue: 2,
      due: 20000,
      interval: 12,
      stability: 14.5,
      difficulty: 6.2,
      lastReviewSecs: now / 1000 - 2 * 86_400,
    }),
  ],
});

test("AnkiDroid's screens say why linking isn't possible, and from which version it is", () => {
  expect(ankiDroidAccess(null)).toBe("missing");
  expect(ankiDroidAccess({ versionCode: 22303300, permission: "granted" })).toBe("outdated");
  // ABI split builds add 100000000 per ABI to the version code.
  expect(ankiDroidAccess({ versionCode: 322303300, permission: "granted" })).toBe("outdated");
  expect(ankiDroidAccess({ versionCode: 22400300, permission: "denied" })).toBe("permission");
  expect(ankiDroidAccess({ versionCode: 322500300, permission: "granted" })).toBe("ready");
});

test("filtered decks are not offered for linking, and the list is sorted by name", () => {
  const decks = [
    ...source().decks,
    { id: 77, name: "Filtered Deck 1", options: "{}", filtered: true },
  ];
  expect(linkableAnkiDroidDecks(decks).map((d) => d.name)).toEqual([
    "Default",
    "Japanese",
    "Japanese::Kanji",
  ]);
});

test("linking keeps AnkiDroid's ids, records the phone, and imports subdecks, notes and cards", () => {
  const c = new Collection(environment());
  const { deckId } = c.linkAnkiDroid(source());
  const state = c.snapshot();
  expect(deckId).toBe(importId("deck", 1700000000001));
  expect(state.decks.map((d) => [d.fields.name.value, d.fields.linkedBy?.value, d.anki])).toEqual([
    ["Japanese", "phone-a", { id: 1700000000001 }],
    ["Japanese::Kanji", "phone-a", { id: 1700000000002 }],
  ]);
  const preset = state.presets[0]!;
  expect(preset.id).toBe(importId("preset", 1, "Default"));
  expect(preset.fields.newPerDay.value).toBe(15);
  expect(preset.fields.reviewsPerDay.value).toBe(150);
  expect(preset.fields.desiredRetention.value).toBe(0.85);
  expect(preset.fields.learningSteps.value).toEqual([1, 10]);
  const type = state.noteTypes[0]!;
  expect(type.id).toBe(importId("noteType", 1600000000000));
  expect(type.anki).toEqual({ id: 1600000000000 });
  expect(type.fields.fieldNames.value).toEqual(["Front", "Back"]);
  expect(type.fields.templates.value.map((t) => t.name)).toEqual(["Card 1", "Card 2"]);
  const note = state.notes[0]!;
  expect(note.id).toBe(importId("note", "abc"));
  expect(note.anki).toEqual({ id: 501, guid: "abc" });
  expect(note.values.map((v) => v.value)).toEqual(["食べる", "eat"]);
  expect(note.fields.tags.value).toEqual(["verb", "n5"]);
  expect(state.cards[0]!.fields.deckId.value).toBe(deckId);
  expect(state.cards.map((x) => [x.id, x.fields.ordinal.value, x.anki])).toEqual([
    [cardId(note.id, 0), 0, { id: 9001 }],
    [cardId(note.id, 1), 1, { id: 9002 }],
  ]);
  expect(state.cards[1]!.fields.deckId.value).toBe(importId("deck", 1700000000002));
});

test("reviewed cards start from a snapshot of AnkiDroid's state, timed at its last review", () => {
  const c = new Collection(environment());
  const { snapshots } = c.linkAnkiDroid(source());
  const state = c.snapshot();
  const reviewed = state.cards[1]!;
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]).toMatchObject({
    kind: "snapshot",
    cardId: reviewed.id,
    at: now - 2 * 86_400_000,
    state: { stability: 14.5, difficulty: 6.2, reps: 4, lapses: 1, scheduled_days: 12 },
  });
  const memory = replayCard(reviewed.id, snapshots, state.presets[0]!, now);
  expect(memory.due.getTime()).toBe(now + 10 * 86_400_000);
  expect(memory.stability).toBe(14.5);
  // The new card is studied; the review card isn't due for ten days.
  const queue = studyQueue(state, snapshots, importId("deck", 1700000000002), now);
  expect(queue).toEqual([]);
});

test("relinking the same deck gives the same records and snapshots, and keeps newer local edits", () => {
  const first = new Collection(environment());
  const once = first.linkAnkiDroid(source());
  const noteId = first.snapshot().notes[0]!.id;
  first.editNote(noteId, ["食べる", "to eat"]);
  const again = first.linkAnkiDroid(source());
  expect(again.snapshots.map((s) => s.id)).toEqual(once.snapshots.map((s) => s.id));
  const state = first.snapshot();
  expect(state.notes).toHaveLength(1);
  expect(state.cards).toHaveLength(2);
  expect(state.notes[0]!.values[1]!.value).toBe("to eat");

  // A field edited in AnkiDroid after our last change to it comes in.
  const edited = source();
  edited.notes[0]!.mod = now / 1000 + 60;
  edited.notes[0]!.fields = "食べる\u001fto eat (food)";
  const later = new Collection({ ...environment(), now: () => now + 120_000 }, state);
  later.linkAnkiDroid(edited);
  expect(later.snapshot().notes[0]!.values[1]!.value).toBe("to eat (food)");

  // Another phone that links it becomes the one that pulls.
  const other = new Collection(environment("phone-b"), later.snapshot());
  other.linkAnkiDroid(source());
  expect(other.snapshot().decks.every((d) => d.fields.linkedBy?.value === "phone-b")).toBe(true);
});

test("a linked deck the user deleted is not brought back", () => {
  const c = new Collection(environment());
  const { deckId } = c.linkAnkiDroid(source());
  c.deleteDeck(deckId);
  expect(() => c.linkAnkiDroid(source())).toThrow("Linked deck was deleted");
});

test("Basic records stored before imported note types load in the current shape", () => {
  const hlc = { wallMs: 5, counter: 0, deviceId: "phone-a" };
  // Stored JSON from before this shape, read back as SQLite returns it; the constructor upgrades it.
  const stored = JSON.stringify({
    decks: [],
    presets: [],
    cards: [],
    tombstones: [],
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
          front: { value: "casa", hlc },
          back: { value: "house", hlc },
        },
      },
    ],
  });
  const c = new Collection(environment(), JSON.parse(stored));
  const state = c.snapshot();
  expect(state.notes[0]!.values.map((v) => v.value)).toEqual(["casa", "house"]);
  expect(state.notes[0]!.fields.tags.value).toEqual([]);
  expect(state.noteTypes[0]!.fields.templates.value).toEqual([
    { name: "Card 1", front: "{{Front}}", back: "{{Back}}" },
  ]);
  expect(state.noteTypes[0]!.fields.kind.value).toBe("standard");
});
