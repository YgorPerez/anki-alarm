import { expect, test } from "vite-plus/test";
import {
  alarmSession,
  canStudyCard,
  Collection,
  deckLimitTexts,
  scopedLimit,
  studyCounts,
  studyDayStart,
  studyQueue,
  type LogEntry,
} from "./index.ts";

const now = new Date(2026, 9, 28, 12).getTime();
const nextStudyDay = new Date(2026, 9, 29, 4).getTime();

function collection() {
  let n = 0;
  return new Collection({
    deviceId: "a",
    now: () => now,
    random: () => new Uint8Array(16).fill(n++),
  });
}
const answer = (id: string, cardId: string): LogEntry => ({
  kind: "review",
  id,
  cardId,
  at: now - 1000,
  grade: 3,
  durationMs: 1,
  origin: "phone",
});
const cardsIn = (c: Collection, deckId: string) =>
  c.snapshot().cards.filter((card) => card.fields.deckId.value === deckId);

test("this deck overrides the preset, and today overrides both until the next study day", () => {
  const c = collection();
  const deck = c.createDeck("Limits");
  for (const front of ["a", "b", "c", "d"]) c.addBasicNote(deck.id, front, "x");
  c.setDeckLimit(deck.id, "new", "deck", 3);
  expect(studyCounts(c.snapshot(), [], deck.id, now).new).toBe(3);
  c.setDeckLimit(deck.id, "new", "today", 1);
  expect(studyCounts(c.snapshot(), [], deck.id, now).new).toBe(1);
  expect(studyCounts(c.snapshot(), [], deck.id, nextStudyDay).new).toBe(3);
});

test("choosing the preset scope sets the shared limit and drops this deck's overrides", () => {
  const c = collection();
  const deck = c.createDeck("Limits");
  const other = c.createDeck("Other");
  for (const front of ["a", "b", "c"]) {
    c.addBasicNote(deck.id, front, "x");
    c.addBasicNote(other.id, front, "x");
  }
  c.setDeckLimit(deck.id, "new", "deck", 1);
  c.setDeckLimit(deck.id, "new", "today", 0);
  c.setDeckLimit(deck.id, "new", "preset", 2);
  expect(studyCounts(c.snapshot(), [], deck.id, now).new).toBe(2);
  expect(studyCounts(c.snapshot(), [], other.id, now).new).toBe(2);
});

test("deck options show each scope's own number, so changing scope never copies an override", () => {
  const c = collection();
  const created = c.createDeck("Limits");
  c.setDeckLimit(created.id, "new", "deck", 5);
  c.setDeckLimit(created.id, "review", "today", 7);
  const state = c.snapshot();
  const deck = state.decks.find((d) => d.id === created.id)!;
  const preset = state.presets[0]!;
  const today = studyDayStart(now);
  expect(deckLimitTexts(deck, preset, today)).toEqual({
    newPerDay: "5",
    newScope: "deck",
    reviewsPerDay: "7",
    reviewScope: "today",
  });
  expect(scopedLimit(deck, preset, "new", "preset", today)).toBe(20);
  expect(scopedLimit(deck, preset, "new", "today", today)).toBe(5);
  expect(deckLimitTexts(deck, preset, studyDayStart(nextStudyDay))).toMatchObject({
    reviewsPerDay: "200",
    reviewScope: "preset",
  });
});

test("an invalid limit changes nothing", () => {
  const c = collection();
  const deck = c.createDeck("Limits");
  expect(() => c.setDeckLimit(deck.id, "new", "today", -1)).toThrow("Invalid");
  expect(() => c.setDeckLimit("nope", "new", "deck", 1)).toThrow("Invalid");
});

test("cards answered and later buried still count against the limits", () => {
  const c = collection();
  const deck = c.createDeck("Buried");
  c.setDeckLimit(deck.id, "new", "preset", 1);
  c.addBasicNote(deck.id, "one", "x");
  c.addBasicNote(deck.id, "two", "x");
  const [first] = cardsIn(c, deck.id);
  c.buryCard(first!.id);
  expect(studyCounts(c.snapshot(), [answer("r", first!.id)], deck.id, now).new).toBe(0);
});

test("new cards use up the review limit unless they ignore it", () => {
  const c = collection();
  const deck = c.createDeck("Budget");
  for (const front of ["a", "b", "c"]) c.addBasicNote(deck.id, front, "x");
  c.setDeckLimit(deck.id, "review", "deck", 2);
  expect(studyCounts(c.snapshot(), [], deck.id, now).new).toBe(2);
  const [first, second] = cardsIn(c, deck.id);
  const log = [answer("r1", first!.id), answer("r2", second!.id)];
  expect(studyCounts(c.snapshot(), log, deck.id, now).new).toBe(0);
  c.updatePreset(deck.fields.presetId.value, { newIgnoreReviewLimit: true });
  expect(studyCounts(c.snapshot(), log, deck.id, now).new).toBe(1);
});

test("by default only the studied deck's limits apply", () => {
  const c = collection();
  const parent = c.createDeck("Parent");
  const child = c.createDeck("Parent::Child");
  c.addBasicNote(child.id, "one", "x");
  c.addBasicNote(child.id, "two", "x");
  c.setDeckLimit(child.id, "new", "deck", 1);
  c.setDeckLimit(parent.id, "new", "deck", 0);
  expect(studyCounts(c.snapshot(), [], child.id, now).new).toBe(1);
  c.setDeckLimit(parent.id, "new", "deck", 2);
  expect(studyCounts(c.snapshot(), [], parent.id, now).new).toBe(2);
});

test("limits from the parent also hold a subdeck to its own, however the deck is studied", () => {
  const c = collection();
  const parent = c.createDeck("Parent");
  const child = c.createDeck("Parent::Child");
  const other = c.createDeck("Parent::Other");
  c.addBasicNote(child.id, "one", "x");
  c.addBasicNote(child.id, "two", "x");
  c.addBasicNote(other.id, "three", "x");
  c.updatePreset(parent.fields.presetId.value, { applyAllParentLimits: true });
  c.setDeckLimit(child.id, "new", "deck", 1);
  expect(studyCounts(c.snapshot(), [], parent.id, now).new).toBe(2);
  c.setDeckLimit(parent.id, "new", "deck", 0);
  expect(studyQueue(c.snapshot(), [], child.id, now)).toHaveLength(0);
});

test("answers in one subdeck use up the parent's limit for its siblings", () => {
  const c = collection();
  const parent = c.createDeck("Parent");
  const child = c.createDeck("Parent::Child");
  const other = c.createDeck("Parent::Other");
  c.addBasicNote(child.id, "one", "x");
  c.addBasicNote(other.id, "two", "x");
  c.updatePreset(parent.fields.presetId.value, { applyAllParentLimits: true });
  c.setDeckLimit(parent.id, "new", "deck", 1);
  const [answered] = cardsIn(c, child.id);
  expect(studyCounts(c.snapshot(), [], other.id, now).new).toBe(1);
  expect(studyCounts(c.snapshot(), [answer("r", answered!.id)], other.id, now).new).toBe(0);
});

test("a card studied through its parent can be answered past its own deck's limit", () => {
  const c = collection();
  const parent = c.createDeck("Parent");
  const child = c.createDeck("Parent::Child");
  c.addBasicNote(child.id, "one", "x");
  c.setDeckLimit(child.id, "new", "deck", 0);
  const [card] = cardsIn(c, child.id);
  expect(studyQueue(c.snapshot(), [], parent.id, now).map((q) => q.card.id)).toEqual([card!.id]);
  expect(canStudyCard(c.snapshot(), [], card!.id, now)).toBe(true);
  c.setDeckLimit(parent.id, "new", "deck", 0);
  expect(canStudyCard(c.snapshot(), [], card!.id, now)).toBe(false);
});

test("alarms are never stopped by a limit", () => {
  const c = collection();
  const deck = c.createDeck("Morning");
  c.addBasicNote(deck.id, "one", "x");
  c.setDeckLimit(deck.id, "new", "today", 0);
  c.setDeckLimit(deck.id, "review", "today", 0);
  expect(studyCounts(c.snapshot(), [], deck.id, now).new).toBe(0);
  const session = alarmSession({
    collection: c.snapshot(),
    log: [],
    deckId: deck.id,
    need: 1,
    ringId: "ring",
    now,
  });
  expect(session.next?.card.id).toBe(cardsIn(c, deck.id)[0]!.id);
});
