import { expect, test } from "vite-plus/test";
import { Collection, studyStats, type Bucket, type LogEntry } from "./index.ts";

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
  const [one, two, run] = state.cards.map((card) => card.id);
  return { state, words: words.id, verbs: verbs.id, one: one!, two: two!, run: run! };
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
  state: {
    state: 1 | 2 | 3;
    scheduled_days: number;
    due: number;
    stability?: number;
    difficulty?: number;
  },
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

test("true retention counts only answers to review cards, young or mature by their interval", () => {
  const { state, one, two, run } = fixture();
  const log = [
    snapshot(one, now - 40 * day, { state: 2, scheduled_days: 30, due: now - 10 * day }),
    review(one, now, 3),
    snapshot(two, now - 10 * day, { state: 2, scheduled_days: 5, due: now - 5 * day }),
    review(two, now - day, 1),
    // Relearning and learning answers are not retention.
    review(two, now - day + 600_000, 3),
    review(run, now, 3),
  ];
  const rows = Object.fromEntries(
    studyStats(state, log, { now }).retention.map((row) => [row.period, row]),
  );
  expect(Object.keys(rows)).toEqual(["today", "yesterday", "week", "month", "year", "all"]);
  expect(rows.today).toEqual({
    period: "today",
    young: { passed: 0, failed: 0, rate: null },
    mature: { passed: 1, failed: 0, rate: 1 },
    total: { passed: 1, failed: 0, rate: 1 },
  });
  expect(rows.yesterday?.young).toEqual({ passed: 0, failed: 1, rate: 0 });
  expect(rows.week?.total).toEqual({ passed: 1, failed: 1, rate: 0.5 });
  expect(rows.all?.total).toEqual({ passed: 1, failed: 1, rate: 0.5 });
});

const at = (date: number, hour: number, minute = 0) =>
  new Date(2026, 9, date, hour, minute).getTime();
test("the hourly breakdown groups the window's answers by local hour with their success rate", () => {
  const { state, one, two, run } = fixture();
  const log = [
    review(one, at(28, 7, 10), 3),
    review(two, at(28, 7, 30), 1),
    review(run, at(27, 22), 4),
    review(run, at(10, 7), 1),
  ];
  const { hours } = studyStats(state, log, { now, days: 7 });
  expect(hours).toHaveLength(24);
  expect(hours[7]).toEqual({ hour: 7, again: 1, hard: 0, good: 1, easy: 0, rate: 0.5 });
  expect(hours[22]).toEqual({ hour: 22, again: 0, hard: 0, good: 0, easy: 1, rate: 1 });
  expect(hours[0]).toEqual({ hour: 0, again: 0, hard: 0, good: 0, easy: 0, rate: null });
  expect(studyStats(state, log, { now, days: 30 }).hours[7]?.again).toBe(2);
});

const filled = (buckets: readonly Bucket[]) =>
  buckets.filter((b) => b.count).map(({ from, to, count }) => [from, to, count]);
test("intervals and FSRS memory distributions bucket the cards that have a memory state", () => {
  const { state, one, two } = fixture();
  const log: LogEntry[] = [
    snapshot(one, now - 50 * day, {
      state: 2,
      scheduled_days: 7,
      due: now - 43 * day,
      stability: 1,
      difficulty: 1,
    }),
    snapshot(two, now, {
      state: 2,
      scheduled_days: 30,
      due: now + 30 * day,
      stability: 400,
      difficulty: 10,
    }),
  ];
  const stats = studyStats(state, log, { now });
  expect(filled(stats.intervals)).toEqual([
    [7, 8, 1],
    [22, 31, 1],
  ]);
  expect(stats.intervals[0]).toMatchObject({ from: 1, to: 2 });
  expect(filled(stats.stability)).toEqual([
    [1, 2, 1],
    [366, null, 1],
  ]);
  expect(stats.stability[0]).toMatchObject({ from: 0, to: 1 });
  // Difficulty 1 to 10 reads as 0% to 100%.
  expect(stats.difficulty).toHaveLength(10);
  expect(filled(stats.difficulty)).toEqual([
    [0, 0.1, 1],
    [0.9, 1, 1],
  ]);
  // FSRS-6 with default decay 0.1542: (1 + 0.9806 * 50 / 1) ** -0.1542 is about 0.55. Just
  // reviewed is certain.
  expect(filled(stats.retrievability)).toEqual([
    [0.5, 0.6, 1],
    [0.9, 1, 1],
  ]);
  // The deck's preset weights count: a faster decay (0.8) forgets the old card sooner.
  const tuned = structuredClone(state);
  for (const preset of tuned.presets) preset.fields.fsrsParameters.value[20] = 0.8;
  expect(filled(studyStats(tuned, log, { now }).retrievability)).toEqual([
    [0.1, 0.2, 1],
    [0.9, 1, 1],
  ]);
});

test("the whole collection keeps answers to deleted cards in its activity but not in its counts", () => {
  const { state, words } = fixture();
  const log = [review("deleted", now, 3)];
  const overall = studyStats(state, log, { now });
  expect(overall.reviews.at(-1)?.good).toBe(1);
  expect(overall.hours[12]?.good).toBe(1);
  expect(overall.counts).toEqual({ new: 3, learning: 0, relearning: 0, young: 0, mature: 0 });
  expect(studyStats(state, log, { now, deckId: words }).reviews.at(-1)?.good).toBe(0);
});
