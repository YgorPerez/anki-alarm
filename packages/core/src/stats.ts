import { State } from "ts-fsrs";
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
}
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
  const visitReview = (entry: LogEntry) => {
    if (entry.kind !== "review") return;
    const bucket = reviews[dayOf(entry.at) + days - 1];
    if (bucket) bucket[gradeKeys[entry.grade - 1]!]++;
  };
  // The whole collection keeps the history of deleted cards; a deck only has its current cards.
  const current = new Set(cards.map((c) => c.id));
  const reviewed = deckId ? current : new Set([...current, ...byCard.keys()]);
  for (const cardId of reviewed) {
    const memory = replay(cardId, visitReview);
    if (!memory || !current.has(cardId)) continue;
    counts[stateOf(memory)]++;
    if (memory.state !== State.New) {
      const due = forecast[Math.max(0, dayOf(memory.due.getTime()))];
      if (due) due.due++;
    }
  }
  return { reviews, forecast, counts };
}
function stateOf(memory: MemoryState): keyof CardCounts {
  switch (memory.state) {
    case State.New:
      return "new";
    case State.Learning:
      return "learning";
    case State.Relearning:
      return "relearning";
    case State.Review:
      return memory.scheduled_days >= MATURE ? "mature" : "young";
  }
}
