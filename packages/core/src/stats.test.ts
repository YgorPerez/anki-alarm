import { expect, test } from "vite-plus/test";
import { Collection, studyStats, type LogEntry } from "./index.ts";

const now = new Date(2026, 9, 28, 12).getTime();
const day = 86_400_000;
function fixture() {
  let n = 0;
  const c = new Collection({
    deviceId: "a",
    now: () => now - 400 * day,
    random: () => new Uint8Array(16).fill(n++),
  });
  const words = c.createDeck("Words");
  const verbs = c.createDeck("Verbs");
  c.addBasicNote(words.id, "one", "um");
  c.addBasicNote(words.id, "two", "dois");
  c.addBasicNote(verbs.id, "run", "correr");
  const state = c.snapshot();
  const [one, two, run] = state.cards.map((card) => card.id) as [string, string, string];
  return { state, words: words.id, verbs: verbs.id, one, two, run };
}
let id = 0;
const review = (cardId: string, at: number, grade: 1 | 2 | 3 | 4): LogEntry => ({
  kind: "review",
  id: `r${String(id++).padStart(4, "0")}`,
  cardId,
  at,
  grade,
  durationMs: 1000,
  origin: "phone",
});

test("reviews per day count each grade by study day, skip voided answers and follow the deck", () => {
  const { state, words, one, two, run } = fixture();
  const voided = review(two, now, 4);
  const log: LogEntry[] = [
    review(one, now, 3),
    review(two, now - 1000, 1),
    voided,
    { kind: "void", id: "v", cardId: two, at: now + 1, targetId: voided.id },
    // 3am today belongs to yesterday's study day.
    review(one, new Date(2026, 9, 28, 3).getTime(), 2),
    review(run, now - 2 * day, 4),
  ];
  const overall = studyStats(state, log, { now, days: 7 });
  expect(overall.reviews).toHaveLength(7);
  expect(overall.reviews.at(-1)).toEqual({ day: 0, again: 1, hard: 0, good: 1, easy: 0 });
  expect(overall.reviews.at(-2)).toEqual({ day: -1, again: 0, hard: 1, good: 0, easy: 0 });
  expect(overall.reviews.at(-3)).toEqual({ day: -2, again: 0, hard: 0, good: 0, easy: 1 });
  expect(overall.reviews[0]).toEqual({ day: -6, again: 0, hard: 0, good: 0, easy: 0 });
  const deck = studyStats(state, log, { now, days: 7, deckId: words });
  expect(deck.reviews.at(-3)).toEqual({ day: -2, again: 0, hard: 0, good: 0, easy: 0 });
});

const snapshot = (
  cardId: string,
  at: number,
  state: { state: 1 | 2 | 3; scheduled_days: number; due: number; stability?: number },
): LogEntry => ({
  kind: "snapshot",
  id: `s${String(id++).padStart(4, "0")}`,
  cardId,
  at,
  state: {
    stability: 10,
    difficulty: 5,
    elapsed_days: 0,
    reps: 3,
    lapses: 0,
    learning_steps: 0,
    last_review: at,
    ...state,
  },
});

test("card counts split review cards into young and mature at a 21-day interval", () => {
  const { state, words, one, two, run } = fixture();
  const log = [
    snapshot(one, now - day, { state: 2, scheduled_days: 21, due: now + 20 * day }),
    snapshot(two, now - day, { state: 2, scheduled_days: 20, due: now + 19 * day }),
    review(run, now - 60_000, 1),
  ];
  expect(studyStats(state, log, { now }).counts).toEqual({
    new: 0,
    learning: 1,
    relearning: 0,
    young: 1,
    mature: 1,
  });
  expect(studyStats(state, [], { now, deckId: words }).counts).toEqual({
    new: 2,
    learning: 0,
    relearning: 0,
    young: 0,
    mature: 0,
  });
  expect(
    studyStats(state, [snapshot(one, now, { state: 3, scheduled_days: 0, due: now })], { now })
      .counts.relearning,
  ).toBe(1);
});

test("the forecast puts overdue cards on today and leaves new cards out", () => {
  const { state, one, two, run } = fixture();
  const log = [
    snapshot(one, now - 9 * day, { state: 2, scheduled_days: 7, due: now - 2 * day }),
    snapshot(two, now - day, { state: 2, scheduled_days: 6, due: now + 5 * day }),
  ];
  const { forecast } = studyStats(state, log, { now, days: 7 });
  expect(forecast).toEqual([
    { day: 0, due: 1 },
    { day: 1, due: 0 },
    { day: 2, due: 0 },
    { day: 3, due: 0 },
    { day: 4, due: 0 },
    { day: 5, due: 1 },
    { day: 6, due: 0 },
  ]);
  // A due date past the window is outside the chart.
  const later = snapshot(run, now, { state: 2, scheduled_days: 9, due: now + 9 * day });
  expect(studyStats(state, [later], { now, days: 7 }).forecast.every((d) => d.due === 0)).toBe(
    true,
  );
});
