import { expect, test } from "vite-plus/test";
import { Collection, browseCards, parseRecord } from "./index.ts";

test("flags belong to cards and marking belongs to the note; setters return values for undo", () => {
  let id = 0;
  const c = new Collection({
    deviceId: "phone",
    now: () => 1700000000000,
    random: () => new Uint8Array(16).fill(id++),
  });
  const deck = c.createDeck("Words");
  const note = c.addBasicNote(deck.id, "front", "back");
  const card = c.snapshot().cards[0]!;
  expect(c.setCardFlag(card.id, 7)).toBe(0);
  expect(c.setNoteMarked(note.id, true)).toBe(false);
  expect(browseCards(c.snapshot(), "flag:7 is:marked").map((r) => r.cardId)).toEqual([card.id]);
  expect(c.setCardFlag(card.id, 0)).toBe(7);
  expect(c.setNoteMarked(note.id, false)).toBe(true);
  expect(browseCards(c.snapshot(), "-flag:7 -is:marked")).toHaveLength(1);
  expect(() => c.setCardFlag(card.id, 8)).toThrow("Invalid flag");
});

test("stored cards from before flags default to unflagged without changing their clocks", () => {
  const hlc = { wallMs: 1000, counter: 0, deviceId: "old-phone" };
  const restored = parseRecord("cards", {
    id: "card",
    fields: {
      noteId: { value: "note", hlc },
      deckId: { value: "deck", hlc },
      ordinal: { value: 0, hlc },
      suspended: { value: false, hlc },
    },
  });
  expect(restored.fields.flag).toEqual({ value: 0, hlc });
});

test.each([1, 2, 3, 4, 5, 6, 7])("search matches only flag %i and its negation", (flag) => {
  let id = 0;
  const c = new Collection({
    deviceId: "phone",
    now: () => 1700000000000,
    random: () => new Uint8Array(16).fill(id++),
  });
  const deck = c.createDeck("Words");
  c.addBasicNote(deck.id, "front", "back");
  const card = c.snapshot().cards[0]!;
  c.setCardFlag(card.id, flag);
  const before = c.snapshot().cards[0]!;
  c.setCardFlag(card.id, flag);
  expect(c.snapshot().cards[0]).toEqual(before);
  expect(browseCards(c.snapshot(), `flag:${flag}`)).toHaveLength(1);
  expect(browseCards(c.snapshot(), `-flag:${flag}`)).toHaveLength(0);
  expect(browseCards(c.snapshot(), "flag:8")).toHaveLength(0);
});
