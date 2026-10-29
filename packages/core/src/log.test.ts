import { expect, test } from "vite-plus/test";
import {
  Collection,
  checkLogEntry,
  dueInDays,
  replayCard,
  studyQueue,
  type Grade,
  type LogEntry,
} from "./index.ts";

const now = new Date(2026, 9, 28, 12).getTime();
function fixture() {
  let n = 0;
  const c = new Collection({
    deviceId: "a",
    now: () => now,
    random: () => new Uint8Array(16).fill(n++),
  });
  const deck = c.createDeck("Words");
  c.addBasicNote(deck.id, "one", "um");
  c.addBasicNote(deck.id, "two", "dois");
  const state = c.snapshot();
  return { state, deckId: deck.id, cardId: state.cards[0]!.id, preset: state.presets[0]! };
}
const review = (
  id: string,
  cardId: string,
  at = now,
  { grade = 3, origin = "phone" }: { grade?: Grade; origin?: "phone" | "import" } = {},
): LogEntry => ({ kind: "review", id, cardId, at, grade, durationMs: 1, origin });

test("due in N days falls on the start of that study day", () => {
  expect(dueInDays(0, now)).toBe(new Date(2026, 9, 28, 4).getTime());
  expect(dueInDays(3, now)).toBe(new Date(2026, 9, 31, 4).getTime());
  // Before 4am still belongs to the previous study day.
  expect(dueInDays(1, new Date(2026, 9, 29, 2).getTime())).toBe(new Date(2026, 9, 29, 4).getTime());
  expect(() => dueInDays(-1, now)).toThrow("Invalid due date");
  expect(() => dueInDays(1.5, now)).toThrow("Invalid due date");
});

test("a set due date brings a studied card back on that day and keeps its stability", () => {
  const { state, deckId, cardId, preset } = fixture();
  const log: LogEntry[] = [review("r", cardId, now - 3_600_000, { grade: 4 })];
  const studied = replayCard(cardId, log, preset, now);
  expect(studied.due.getTime()).toBeGreaterThan(now + 86_400_000);
  const entry: LogEntry = { kind: "setDueDate", id: "d", cardId, at: now, due: dueInDays(0, now) };
  checkLogEntry(state, log, entry);
  log.push(entry);
  expect(replayCard(cardId, log, preset, now).stability).toBe(studied.stability);
  expect(studyQueue(state, log, deckId, now).map((c) => c.card.id)).toContain(cardId);
});

test("set due date needs a studied card: a new card has no interval to move", () => {
  const { state, cardId } = fixture();
  expect(() =>
    checkLogEntry(state, [], { kind: "setDueDate", id: "d", cardId, at: now, due: now }),
  ).toThrow("Set due date needs a studied card");
});

test("forget and undo apply to cards that exist", () => {
  const { state, cardId } = fixture();
  checkLogEntry(state, [review("r", cardId)], { kind: "reset", id: "x", cardId, at: now });
  expect(() =>
    checkLogEntry(state, [], { kind: "reset", id: "x", cardId: "missing", at: now }),
  ).toThrow("Card missing");
});

test("undo voids one user entry once; imports, snapshots and voids can't be undone", () => {
  const { state, cardId } = fixture();
  const log: LogEntry[] = [
    review("r", cardId),
    review("i", cardId, now, { origin: "import" }),
    { kind: "reset", id: "reset", cardId, at: now + 1 },
    { kind: "void", id: "v", cardId, at: now + 2, targetId: "reset" },
  ];
  const undo = (targetId: string, on = cardId): LogEntry => ({
    kind: "void",
    id: `undo-${targetId}`,
    cardId: on,
    at: now + 3,
    targetId,
  });
  checkLogEntry(state, log, undo("r"));
  expect(() => checkLogEntry(state, log, undo("reset"))).toThrow("Nothing to undo");
  expect(() => checkLogEntry(state, log, undo("i"))).toThrow("Nothing to undo");
  expect(() => checkLogEntry(state, log, undo("v"))).toThrow("Nothing to undo");
  expect(() => checkLogEntry(state, log, undo("missing"))).toThrow("Nothing to undo");
  expect(() => checkLogEntry(state, log, undo("r", state.cards[1]!.id))).toThrow("Nothing to undo");
});
