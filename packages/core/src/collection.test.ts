import { expect, test } from "vite-plus/test";
import { uuid7, cardId } from "./index.ts";

test("record ids carry the creation time and UUIDv7 version", () => {
  const id = uuid7(1700000000000, new Uint8Array(16).fill(255));
  expect(id).toBe("018bcfe5-6800-7fff-bfff-ffffffffffff");
});

test("card ids use the note namespace and decimal ordinal (UUIDv5)", () => {
  // Python uuid.uuid5(UUID(note), '0').
  expect(cardId("018bcfe5-6800-7fff-bfff-ffffffffffff", 0)).toBe(
    "87377b9b-4222-51fe-88b6-4cf73ca39cb4",
  );
});

import { Collection } from "./index.ts";
const environment = () => {
  let n = 0;
  return {
    deviceId: "phone-a",
    now: () => 1700000000000,
    random: () => new Uint8Array(16).fill(n++),
  };
};
test("offline Basic notes make a stable card and edits stamp only changed fields", () => {
  const collection = new Collection(environment());
  const deck = collection.createDeck("Português");
  const note = collection.addBasicNote(deck.id, "casa", "house");
  const before = collection.snapshot();
  expect(before.cards).toHaveLength(1);
  expect(before.cards[0]!.id).toBe(cardId(note.id, 0));
  expect(before.presets).toHaveLength(1);
  expect(before.noteTypes[0]!.fields.name.value).toBe("Basic");
  collection.editNote(note.id, ["casa nova", "house"]);
  const edited = collection.snapshot().notes[0]!;
  expect(edited.values[0]!.value).toBe("casa nova");
  expect(edited.values[1]).toEqual(note.values[1]);
  expect(edited.values[0]!.hlc.counter).toBeGreaterThan(note.values[0]!.hlc.counter);
  collection.renameDeck(deck.id, "Vocabulary");
  expect(collection.snapshot().decks[0]!.fields.name.value).toBe("Vocabulary");
  expect(collection.snapshot().cards[0]!.id).toBe(before.cards[0]!.id);
});

test("deleting a deck tombstones its notes and cards and cannot resurrect stale edits", () => {
  const collection = new Collection(environment());
  const deck = collection.createDeck("Vocabulary");
  const note = collection.addBasicNote(deck.id, "casa", "house");
  const stale = collection.snapshot();
  collection.deleteDeck(deck.id);
  const deleted = collection.snapshot();
  expect(deleted.decks).toEqual([]);
  expect(deleted.notes).toEqual([]);
  expect(deleted.cards).toEqual([]);
  expect(deleted.tombstones.map((t) => [t.kind, t.id])).toEqual([
    ["cards", cardId(note.id, 0)],
    ["notes", note.id],
    ["decks", deck.id],
  ]);
  const restored = new Collection(environment(), { ...stale, tombstones: deleted.tombstones });
  expect(restored.snapshot().decks).toEqual([]);
  expect(() => restored.renameDeck(deck.id, "Resurrected")).toThrow("Invalid deck");
  collection.deleteDeck(deck.id);
  expect(collection.snapshot().tombstones).toHaveLength(3);
});

test("clock survives reload and a backwards device clock", () => {
  const collection = new Collection(environment());
  const deck = collection.createDeck("Words");
  const restored = new Collection({ ...environment(), now: () => 1 }, collection.snapshot());
  restored.renameDeck(deck.id, "New words");
  const hlc = restored.snapshot().decks[0]!.fields.name.hlc;
  expect(hlc.wallMs).toBe(deck.fields.name.hlc.wallMs);
  expect(hlc.counter).toBeGreaterThan(deck.fields.name.hlc.counter);
});

test("every created property carries a clock and app records use UUIDv7", () => {
  const c = new Collection(environment());
  const deck = c.createDeck("  Words  ");
  c.addBasicNote(deck.id, "front", "");
  const state = c.snapshot();
  for (const records of [state.decks, state.notes, state.noteTypes, state.presets]) {
    for (const record of records) {
      expect(record.id).toMatch(/^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
      for (const field of Object.values(record.fields)) {
        expect(field.hlc).toEqual({
          wallMs: 1700000000000,
          counter: expect.any(Number),
          deviceId: "phone-a",
        });
      }
    }
  }
  expect(deck.fields.name.value).toBe("Words");
  expect(() => c.createDeck("  ")).toThrow("Deck name is required");
  expect(() => c.addBasicNote("missing", "front", "back")).toThrow("Invalid note");
  expect(c.snapshot()).toEqual(state);
});

import { importId } from "./index.ts";
test("imported records take UUIDv5 ids from their Anki identity", () => {
  // Python: uuid.uuid5(uuid.UUID("6f1f9a42-4c55-5a4e-9b8b-2f6d0a1c7e10"), "<kind>:<identity>").
  expect(importId("note", "abc")).toBe("4ea25c0e-6ade-50fe-93a6-0ccb7e6df163");
  expect(importId("noteType", 1600000000000)).toBe("4a26013f-326c-5a51-b1a5-832cc7c6c0df");
  expect(importId("deck", 1700000000001)).toBe("251484e5-82fc-52c7-a91e-62baf563233f");
  // Anki's Default deck has id 1 in every collection, so it is keyed by name.
  expect(importId("deck", 1, "Default")).toBe("e68befdc-758f-57d8-9c60-1e276eeae6d3");
});
