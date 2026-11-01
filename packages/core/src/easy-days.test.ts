import { expect, test } from "vite-plus/test";
import {
  cardMemory,
  Collection,
  nextIntervals,
  schedulingOptions,
  type EasyDay,
  type LogEntry,
  type Preset,
} from "./index.ts";

const DAY = 86_400_000;
/** A Monday noon, so a card's interval says its weekday: 17 days later is a Thursday. */
const monday = new Date(2026, 10, 2, 12).getTime();

function fixture() {
  let n = 0;
  const c = new Collection({
    deviceId: "a",
    now: () => monday,
    random: () => new Uint8Array(16).fill(n++),
  });
  const deck = c.createDeck("Words");
  c.addBasicNote(deck.id, "one", "um");
  const state = c.snapshot();
  return { state, cardId: state.cards[0]!.id, preset: state.presets[0]! };
}
/** Monday first; every day unnamed is normal. */
function week(days: Partial<Record<number, EasyDay>>, others: EasyDay = "normal"): EasyDay[] {
  return Array.from({ length: 7 }, (_, day) => days[day] ?? others);
}
const [MON, TUE, WED, THU, FRI, SAT, SUN] = [0, 1, 2, 3, 4, 5, 6] as const;
/** A review card of this stability, due today; 5 gives Hard 12, Good 17 and Easy 28 days. */
function reviewCard(cardId: string, stability: number, scheduled = stability): LogEntry {
  const last = monday - stability * DAY;
  return {
    kind: "snapshot",
    id: "snapshot",
    cardId,
    at: last,
    state: {
      due: monday,
      stability,
      difficulty: 5,
      elapsed_days: 0,
      scheduled_days: scheduled,
      learning_steps: 0,
      reps: 3,
      lapses: 0,
      state: 2,
      last_review: last,
    },
  };
}
function answer(grade: 1 | 2 | 3 | 4, cardId: string, preset: Preset, at = monday): LogEntry {
  return {
    kind: "review",
    id: `answer-${grade}`,
    cardId,
    at,
    grade,
    durationMs: 100,
    origin: "phone",
    options: schedulingOptions(preset, at),
  };
}
const inDays = (seconds: number) => Math.round(seconds / 86_400);
function intervalAfter(
  grade: 1 | 2 | 3 | 4,
  days: EasyDay[],
  stability = 5,
  scheduled = stability,
) {
  const { state, cardId, preset } = fixture();
  preset.fields.easyDays.value = days;
  const log = [reviewCard(cardId, stability, scheduled), answer(grade, cardId, preset)];
  return (cardMemory(state, log, cardId, monday)!.due.getTime() - monday) / DAY;
}

test("a later answer leaves a minimum day for the nearest normal day, earlier on a tie", () => {
  expect(intervalAfter(3, week({}))).toBe(17);
  expect(intervalAfter(3, week({ [THU]: "minimum" }))).toBe(16);
  expect(intervalAfter(3, week({ [THU]: "minimum", [WED]: "minimum" }))).toBe(18);
});

test("a reduced day gives way to a normal one and beats a minimum one, as in Anki", () => {
  expect(intervalAfter(3, week({ [THU]: "reduced" }))).toBe(16);
  expect(intervalAfter(3, week({ [THU]: "minimum" }, "reduced"))).toBe(16);
  expect(intervalAfter(3, week({ [THU]: "reduced" }, "minimum"))).toBe(17);
});

test("with no better day in range the interval stays, so an all-minimum week changes nothing", () => {
  expect(intervalAfter(3, week({}, "minimum"))).toBe(17);
  expect(intervalAfter(3, week({}, "reduced"))).toBe(17);
});

test("a move stays inside Anki's fuzz range for the interval", () => {
  // 17 days fuzz to 14..20, a full week, so the one normal day is in reach.
  expect(intervalAfter(3, week({ [THU]: "reduced", [SUN]: "normal" }, "minimum"))).toBe(20);
  // 12 days fuzz to 10..14; day 12 is a Saturday, and days 10 and 11 stay out of reach.
  expect(intervalAfter(2, week({ [SAT]: "minimum", [TUE]: "normal" }, "minimum"))).toBe(12);
});

test("an interval above Anki's 90 day limit never moves", () => {
  // Stability 40: Good is 110 days, a Saturday.
  expect(intervalAfter(3, week({ [SAT]: "minimum" }), 40)).toBe(110);
});

test("a card that held its interval is not moved below it", () => {
  // Hard is 12 days on a card scheduled for 12: the earlier normal day 11 is out, as in Anki.
  expect(intervalAfter(2, week({ [SAT]: "minimum" }), 5, 12)).toBe(13);
});

test("grades stay in order after moving", () => {
  const { state, cardId, preset } = fixture();
  const seconds = (days: EasyDay[]) => {
    preset.fields.easyDays.value = days;
    return nextIntervals(state, [reviewCard(cardId, 1)], cardId, monday)!;
  };
  const plain = seconds(week({}));
  const hard = inDays(plain[2]);
  const good = inDays(plain[3]);
  expect(good).toBeGreaterThan(hard);
  // Send Hard up onto Good's day: everything from Good's day down to Hard's is minimum but Good's.
  const moved = seconds(week({ [hard % 7]: "minimum", [good % 7]: "normal" }, "minimum"));
  expect(inDays(moved[2])).toBe(good);
  expect(inDays(moved[3])).toBeGreaterThan(good);
});

test("the grade buttons show where the answer will land", () => {
  const { state, cardId, preset } = fixture();
  preset.fields.easyDays.value = week({ [THU]: "minimum" });
  const before = reviewCard(cardId, 5);
  const shown = nextIntervals(state, [before], cardId, monday)!;
  const after = cardMemory(state, [before, answer(3, cardId, preset)], cardId, monday)!;
  expect(shown[3]).toBe(16 * 86_400);
  expect(after.due.getTime()).toBe(monday + shown[3] * 1000);
  expect(after.scheduled_days).toBe(16);
});

test("a graduating answer follows easy days too", () => {
  const { state, cardId, preset } = fixture();
  const easy = (days: EasyDay[]) => {
    preset.fields.easyDays.value = days;
    const entry = answer(4, cardId, preset);
    return cardMemory(state, [entry], cardId, monday)!.scheduled_days;
  };
  const exact = easy(week({}));
  expect(exact).toBeGreaterThan(2);
  expect(easy(week({ [exact % 7]: "minimum" }))).toBe(exact - 1);
});

test("answered cards don't move when the setting changes", () => {
  const { state, cardId, preset } = fixture();
  preset.fields.easyDays.value = week({ [THU]: "minimum" });
  const log = [reviewCard(cardId, 5), answer(3, cardId, preset)];
  const before = cardMemory(state, log, cardId, monday);
  preset.fields.easyDays.value = week({ [WED]: "minimum", [FRI]: "minimum" });
  expect(cardMemory(state, log, cardId, monday)).toEqual(before);
  preset.fields.easyDays.value = week({});
  expect(cardMemory(state, log, cardId, monday)).toEqual(before);
});

test("reviews from before easy days don't pick them up", () => {
  const { state, cardId, preset } = fixture();
  const { options: _, ...legacy } = answer(3, cardId, preset) as LogEntry & { options?: unknown };
  const log = [reviewCard(cardId, 5), legacy];
  const before = cardMemory(state, log, cardId, monday);
  preset.fields.easyDays.value = week({ [THU]: "minimum" });
  expect(cardMemory(state, log, cardId, monday)).toEqual(before);
});

test("replay reads the answer's weekday from the review, not this device's clock", () => {
  const { state, cardId, preset } = fixture();
  preset.fields.easyDays.value = week({ [MON]: "minimum" });
  const review = answer(3, cardId, preset);
  if (review.kind !== "review" || !review.options?.easyDays) throw new Error("No easy days");
  // Answered where it was already Friday: 17 days on is a Monday there, whatever the clock here says.
  review.options.easyDays.weekday = FRI;
  const memory = cardMemory(state, [reviewCard(cardId, 5), review], cardId, monday)!;
  expect(memory.scheduled_days).toBe(16);
});

test("an answer before the 4 am day boundary counts for the study day it belongs to", () => {
  const { preset } = fixture();
  preset.fields.easyDays.value = week({ [SUN]: "minimum" });
  const tuesdayEarly = new Date(2026, 10, 3, 2).getTime();
  expect(schedulingOptions(preset, tuesdayEarly).easyDays?.weekday).toBe(MON);
  expect(schedulingOptions(preset, monday).easyDays?.weekday).toBe(MON);
});

test("an all-normal week records nothing extra", () => {
  const { preset } = fixture();
  expect(schedulingOptions(preset, monday)).not.toHaveProperty("easyDays");
});

test("presets save a valid week and refuse any other", () => {
  let n = 0;
  const c = new Collection({
    deviceId: "a",
    now: () => monday,
    random: () => new Uint8Array(16).fill(n++),
  });
  c.createDeck("Words");
  const preset = c.snapshot().presets[0]!;
  expect(preset.fields.easyDays.value).toEqual(week({}));
  c.updatePreset(preset.id, { easyDays: week({ [SUN]: "minimum", [SAT]: "reduced" }) });
  expect(c.snapshot().presets[0]!.fields.easyDays.value).toEqual(
    week({ [SUN]: "minimum", [SAT]: "reduced" }),
  );
  expect(() => c.updatePreset(preset.id, { easyDays: week({}).slice(1) })).toThrow(
    "Invalid deck options",
  );
});

test("a new preset starts all normal and a duplicate keeps its source's week", () => {
  let n = 0;
  const c = new Collection({
    deviceId: "a",
    now: () => monday,
    random: () => new Uint8Array(16).fill(n++),
  });
  c.createDeck("Words");
  const source = c.snapshot().presets[0]!;
  const edited = week({ [SUN]: "minimum" });
  c.updatePreset(source.id, { easyDays: edited });
  expect(c.createPreset("Fresh").fields.easyDays.value).toEqual(week({}));
  expect(c.duplicatePreset(source.id, "Copy").fields.easyDays.value).toEqual(edited);
});
