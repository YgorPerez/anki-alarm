import { fsrs, Rating, State } from "ts-fsrs";
import type { CollectionState } from "./collection.ts";
import { replayEntries, studyDayStart, type LogEntry, type MemoryState } from "./study.ts";

type GradeCounts = { again: number; hard: number; good: number; easy: number };
const gradeKeys = ["again", "hard", "good", "easy"] as const;
const noGrades = (): GradeCounts => ({ again: 0, hard: 0, good: 0, easy: 0 });
/** Anki's line between young and mature cards, in days of interval. */
const MATURE = 21;

export interface StatsOptions {
  now: number;
  /** One deck, or the whole collection when omitted. */
  deckId?: string;
  /** How many study days the charts cover: back for activity, ahead for the forecast. */
  days?: number;
  /** The hour a study day starts at. */
  dayHour?: number;
}
export interface CardCounts {
  new: number;
  learning: number;
  relearning: number;
  young: number;
  mature: number;
}
export interface StudyStats {
  /** One entry per study day, oldest first; `day` 0 is today. */
  reviews: ({ day: number } & GradeCounts)[];
  /** Cards coming due per study day from today; overdue cards count on today. */
  forecast: { day: number; due: number }[];
  counts: CardCounts;
  /** Anki's true retention table: passed (Hard, Good, Easy) and failed answers to review cards. */
  retention: RetentionRow[];
  /** Answers in the window by local hour of the day, 0 to 23. */
  hours: ({ hour: number; rate: number | null } & GradeCounts)[];
  /** Review cards by their current interval in days. */
  intervals: Bucket[];
  /** Cards with a memory state by FSRS stability in days. */
  stability: Bucket[];
  /** By FSRS difficulty, 1 to 10 read as 0 to 1, in tenths. */
  difficulty: Bucket[];
  /** By the chance of recall now, 0 to 1, in tenths. */
  retrievability: Bucket[];
}
/** Values from `from` up to, not including, `to`; the last bucket is open or includes 1. */
export interface Bucket {
  from: number;
  to: number | null;
  count: number;
}
const DAY_EDGES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 15, 22, 31, 61, 91, 181, 366];
const TENTHS = Array.from({ length: 11 }, (_, i) => i / 10);
function histogram(edges: readonly number[], values: readonly number[], closed = false): Bucket[] {
  const buckets = edges
    .slice(0, closed ? -1 : undefined)
    .map((from, i) => ({ from, to: edges[i + 1] ?? null, count: 0 }));
  for (const value of values) {
    const index = buckets.filter((b) => value >= b.from).length - 1;
    buckets[Math.max(0, index)]!.count++;
  }
  return buckets;
}
export type RetentionPeriod = "today" | "yesterday" | "week" | "month" | "year" | "all";
export interface Tally {
  passed: number;
  failed: number;
  /** passed / (passed + failed), or null without answers. */
  rate: number | null;
}
export interface RetentionRow {
  period: RetentionPeriod;
  young: Tally;
  mature: Tally;
  total: Tally;
}
/** Each period's study days, from `first` to `last` relative to today. */
const PERIODS: { period: RetentionPeriod; first: number; last: number }[] = [
  { period: "today", first: 0, last: 0 },
  { period: "yesterday", first: -1, last: -1 },
  { period: "week", first: -6, last: 0 },
  { period: "month", first: -29, last: 0 },
  { period: "year", first: -364, last: 0 },
  { period: "all", first: -Infinity, last: 0 },
];
const tally = (): Tally => ({ passed: 0, failed: 0, rate: null });
export function studyStats(
  collection: CollectionState,
  log: readonly LogEntry[],
  { now, deckId, days = 30, dayHour = 4 }: StatsOptions,
): StudyStats {
  const today = studyDayStart(now, dayHour);
  const dayOf = (at: number) => Math.round((studyDayStart(at, dayHour) - today) / 86_400_000);
  const cards = deckId
    ? collection.cards.filter((c) => c.fields.deckId.value === deckId)
    : collection.cards;
  const byCard = new Map<string, LogEntry[]>();
  for (const entry of log) {
    const list = byCard.get(entry.cardId) ?? [];
    list.push(entry);
    byCard.set(entry.cardId, list);
  }
  const reviews = Array.from({ length: days }, (_, i) => ({ day: i - days + 1, ...noGrades() }));
  const forecast = Array.from({ length: days }, (_, day) => ({ day, due: 0 }));
  const counts: CardCounts = { new: 0, learning: 0, relearning: 0, young: 0, mature: 0 };
  const presetOf = (cardId: string) => {
    const card = collection.cards.find((c) => c.id === cardId);
    const deck = collection.decks.find((d) => d.id === card?.fields.deckId.value);
    return (
      collection.presets.find((p) => p.id === deck?.fields.presetId.value) ?? collection.presets[0]
    );
  };
  const replay = (cardId: string, visit?: (entry: LogEntry, before: MemoryState) => void) => {
    const preset = presetOf(cardId);
    return preset ? replayEntries(byCard.get(cardId) ?? [], preset, now, visit) : undefined;
  };
  const retention = PERIODS.map(({ period, first, last }) => ({
    row: { period, young: tally(), mature: tally(), total: tally() } satisfies RetentionRow,
    first,
    last,
  }));
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    ...noGrades(),
    rate: null as number | null,
  }));
  const visitReview = (entry: LogEntry, before: MemoryState) => {
    if (entry.kind !== "review") return;
    const day = dayOf(entry.at);
    const grade = gradeKeys[entry.grade - 1]!;
    const bucket = reviews[day + days - 1];
    if (bucket) {
      bucket[grade]++;
      hours[new Date(entry.at).getHours()]![grade]++;
    }
    if (before.state !== State.Review) return;
    const outcome = entry.grade === Rating.Again ? "failed" : "passed";
    const age = before.scheduled_days >= MATURE ? "mature" : "young";
    for (const { row, first, last } of retention) {
      if (day < first || day > last) continue;
      row[age][outcome]++;
      row.total[outcome]++;
    }
  };
  // The whole collection keeps the history of deleted cards; a deck only has its current cards.
  const current = new Set(cards.map((c) => c.id));
  const reviewed = deckId ? current : new Set([...current, ...byCard.keys()]);
  const remembered: MemoryState[] = [];
  for (const cardId of reviewed) {
    const memory = replay(cardId, visitReview);
    if (!memory || !current.has(cardId)) continue;
    counts[stateOf(memory)]++;
    if (memory.state !== State.New) {
      remembered.push(memory);
      const due = forecast[Math.max(0, dayOf(memory.due.getTime()))];
      if (due) due.due++;
    }
  }
  const scheduler = fsrs();
  const at = new Date(now);
  for (const { row } of retention)
    for (const t of [row.young, row.mature, row.total])
      t.rate = t.passed + t.failed ? t.passed / (t.passed + t.failed) : null;
  for (const hour of hours) {
    const total = hour.again + hour.hard + hour.good + hour.easy;
    hour.rate = total ? 1 - hour.again / total : null;
  }
  return {
    reviews,
    forecast,
    counts,
    retention: retention.map(({ row }) => row),
    hours,
    intervals: histogram(
      DAY_EDGES.slice(1),
      remembered.filter((m) => m.state === State.Review).map((m) => m.scheduled_days),
    ),
    stability: histogram(
      DAY_EDGES,
      remembered.map((m) => m.stability),
    ),
    difficulty: histogram(
      TENTHS,
      remembered.map((m) => (m.difficulty - 1) / 9),
      true,
    ),
    retrievability: histogram(
      TENTHS,
      remembered.map((m) => scheduler.get_retrievability(m, at, false)),
      true,
    ),
  };
}
function stateOf(memory: MemoryState): keyof CardCounts {
  if (memory.state === State.Review) return memory.scheduled_days >= MATURE ? "mature" : "young";
  if (memory.state === State.Learning) return "learning";
  if (memory.state === State.Relearning) return "relearning";
  return "new";
}
