/* oxlint-disable unicorn/no-array-sort -- ES2022/Hermes target; only freshly filtered/mapped arrays are sorted. */
import { createEmptyCard, fsrs, State, type Card as MemoryState, type Grade } from "ts-fsrs";
import type { Card, CollectionState, Deck, Preset } from "./collection.ts";
export type { MemoryState, Grade };
/** FSRS card states: New, Learning, Review, Relearning. */
export { State as CardState };
/** Scheduling inputs only, copied so later preset edits cannot change an answer. */
export type SchedulingOptions = {
  desiredRetention: number;
  learningSteps: number[];
  fsrsParameters: number[];
};
export function schedulingOptions(preset: Preset): SchedulingOptions {
  return {
    desiredRetention: preset.fields.desiredRetention.value,
    learningSteps: [...preset.fields.learningSteps.value],
    fsrsParameters: [...preset.fields.fsrsParameters.value],
  };
}
type Entry = { id: string; cardId: string; at: number };
export type LogEntry = Entry &
  (
    | {
        kind: "review";
        grade: Grade;
        /** Absent only on legacy entries, frozen by the upgrade migration. */
        options?: SchedulingOptions;
        /** Previous sibling buries, for undo; the actual buries are synced card fields. */
        siblingBuries?: { cardId: string; until: number | null }[];
        durationMs: number;
        origin: "phone" | "web" | "alarm" | "import";
        /**
         * The ring an alarm-session answer belongs to (its progress toward N), or the awake
         * check's id for the check's one answer.
         */
        ringId?: string;
      }
    | {
        kind: "snapshot";
        state: Omit<MemoryState, "due" | "last_review"> & { due: number; last_review?: number };
      }
    | { kind: "reset" }
    | { kind: "setDueDate"; due: number }
    | { kind: "void"; targetId: string }
  );
export function replayCard(
  cardId: string,
  log: readonly LogEntry[],
  preset: Preset,
  now: number,
): MemoryState {
  return replayEntries(
    log.filter((e) => e.cardId === cardId),
    preset,
    now,
  );
}
/**
 * Folds one card's entries in answer-time order. `visit` sees each entry that counts with the
 * state it found, for stats.
 */
export function replayEntries(
  cardLog: readonly LogEntry[],
  preset: Preset,
  now: number,
  visit?: (entry: LogEntry, before: MemoryState) => void,
): MemoryState {
  const entries = [...cardLog].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const voided = new Set(entries.filter((e) => e.kind === "void").map((e) => e.targetId));
  let state = createEmptyCard(new Date(now));
  for (const entry of entries) {
    if (voided.has(entry.id)) continue;
    visit?.(entry, state);
    switch (entry.kind) {
      case "review":
        state = schedulerFor(entry.options ?? schedulingOptions(preset)).next(
          state,
          new Date(entry.at),
          entry.grade,
        ).card;
        break;
      case "reset":
        state = createEmptyCard(new Date(entry.at));
        break;
      case "setDueDate":
        state = { ...state, due: new Date(entry.due) };
        break;
      case "snapshot": {
        const { last_review, ...snapshot } = entry.state;
        state = {
          ...snapshot,
          due: new Date(entry.state.due),
          ...(last_review === undefined ? {} : { last_review: new Date(last_review) }),
        };
        break;
      }
      case "void":
        break;
    }
  }
  return state;
}
function schedulerFor(options: SchedulingOptions) {
  return fsrs({
    request_retention: options.desiredRetention,
    w: options.fsrsParameters,
    enable_fuzz: false,
    learning_steps: options.learningSteps.map((n) => `${n}m` as const),
  });
}

/** Seconds until each grade's due date, using the card's own preset, without adding reviews. */
export function nextIntervals(
  collection: CollectionState,
  log: readonly LogEntry[],
  cardId: string,
  now: number,
): Record<Grade, number> | undefined {
  const card = collection.cards.find((c) => c.id === cardId);
  const deck = collection.decks.find((d) => d.id === card?.fields.deckId.value);
  const preset = deck && deckPreset(collection, deck);
  if (!preset) return undefined;
  const memory = replayCard(cardId, log, preset, now);
  const choices = schedulerFor(schedulingOptions(preset)).repeat(memory, new Date(now));
  const seconds = (grade: Grade) => (choices[grade].card.due.getTime() - now) / 1000;
  return { 1: seconds(1), 2: seconds(2), 3: seconds(3), 4: seconds(4) };
}

/** A card's memory state under its deck's preset, or undefined when the card is gone. */
export function cardMemory(
  collection: CollectionState,
  log: readonly LogEntry[],
  cardId: string,
  now: number,
): MemoryState | undefined {
  const card = collection.cards.find((c) => c.id === cardId);
  const deck = collection.decks.find((d) => d.id === card?.fields.deckId.value);
  const preset = deck && deckPreset(collection, deck);
  return preset && replayCard(cardId, log, preset, now);
}
/**
 * Throws unless `entry` may be appended to `log`: its card exists, a set due date moves a card
 * that has been studied (a new card has no interval), and a void cancels a review, reset or set
 * due date the user made on that card and that isn't voided yet.
 */
export function checkLogEntry(
  collection: CollectionState,
  log: readonly LogEntry[],
  entry: LogEntry,
) {
  const memory = cardMemory(collection, log, entry.cardId, entry.at);
  if (!memory) throw new Error("Card missing");
  if (entry.kind === "setDueDate") {
    if (!Number.isSafeInteger(entry.due)) throw new Error("Invalid due date");
    if (memory.state === State.New) throw new Error("Set due date needs a studied card");
  }
  if (entry.kind === "void") {
    const target = log.find((e) => e.id === entry.targetId && e.cardId === entry.cardId);
    const undoable =
      (target?.kind === "review" && target.origin !== "import") ||
      target?.kind === "reset" ||
      target?.kind === "setDueDate";
    if (!undoable || log.some((e) => e.kind === "void" && e.targetId === entry.targetId))
      throw new Error("Nothing to undo");
  }
}
/** The start of the study day `days` after the current one. */
export function dueInDays(days: number, now: number, hour = 4): number {
  if (!Number.isSafeInteger(days) || days < 0) throw new Error("Invalid due date");
  const date = new Date(studyDayStart(now, hour));
  date.setDate(date.getDate() + days);
  return date.getTime();
}
/** The furthest Set due date goes: about a hundred years. */
export const MAX_DUE_DAYS = 36_500;
/** The days a Set due date form holds: a whole number from 0 to `MAX_DUE_DAYS`, else undefined. */
export function readDueDays(text: string): number | undefined {
  const value = /^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
  return value <= MAX_DUE_DAYS ? value : undefined;
}
/** New cards come in creation order; a reset moves a card behind the untouched ones. */
export function newPosition(card: Card, log: readonly LogEntry[], voided: ReadonlySet<string>) {
  return Math.max(
    card.fields.noteId.hlc.wallMs,
    ...log
      .filter((e) => e.cardId === card.id && e.kind === "reset" && !voided.has(e.id))
      .map((e) => e.at),
  );
}
/** Whether the card is buried at `now`: `buryCard` keeps it out of study until the next day. */
export const isBuried = (card: Card, now: number) => (card.fields.buriedUntil?.value ?? 0) > now;
/** Local calendar arithmetic keeps the 4am boundary correct across DST. */
export function studyDayStart(now: number, hour = 4): number {
  const date = new Date(now);
  if (date.getHours() < hour) date.setDate(date.getDate() - 1);
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}
/** The preset a deck schedules with: its own, with the deck's desired retention when set. */
export function deckPreset(collection: CollectionState, deck: Deck): Preset | undefined {
  const base = collection.presets.find((p) => p.id === deck.fields.presetId.value);
  const override = deck.fields.desiredRetention?.value;
  if (!base || override == null) return base;
  return {
    ...base,
    fields: {
      ...base.fields,
      desiredRetention: { ...base.fields.desiredRetention, value: override },
    },
  };
}
/** The deck and its subdecks, which Anki names `Parent::Child`. */
export function deckFamily(collection: CollectionState, deckId: string) {
  const deck = collection.decks.find((d) => d.id === deckId);
  if (!deck) return new Set<string>();
  const prefix = `${deck.fields.name.value}::`;
  return new Set(
    collection.decks
      .filter((d) => d.id === deckId || d.fields.name.value.startsWith(prefix))
      .map((d) => d.id),
  );
}
/**
 * The cards to study now in a deck and its subdecks, as Anki studies them. Each card schedules
 * with its own deck's preset; the daily limits are the studied deck's.
 */
function studyCandidates(
  collection: CollectionState,
  log: readonly LogEntry[],
  deckId: string,
  now: number,
  dayStart = studyDayStart(now),
) {
  const deck = collection.decks.find((d) => d.id === deckId);
  const preset = deck && deckPreset(collection, deck);
  if (!deck || !preset) throw new Error("Deck preset missing");
  const family = deckFamily(collection, deckId);
  const presets = new Map<string, Preset>();
  for (const d of collection.decks) {
    if (!family.has(d.id)) continue;
    const own = deckPreset(collection, d);
    if (!own) throw new Error("Deck preset missing");
    presets.set(d.id, own);
  }
  const presetOf = (card: Card) => presets.get(card.fields.deckId.value)!;
  const cards = collection.cards.filter(
    (c) => family.has(c.fields.deckId.value) && !c.fields.suspended?.value && !isBuried(c, now),
  );
  const voided = new Set(log.filter((e) => e.kind === "void").map((e) => e.targetId));
  // Each card replays only its own entries.
  const entries = new Map<string, LogEntry[]>();
  for (const entry of log) {
    const own = entries.get(entry.cardId);
    if (own) own.push(entry);
    else entries.set(entry.cardId, [entry]);
  }
  let newCount = 0;
  let reviewCount = 0;
  for (const card of cards) {
    const own = entries.get(card.id) ?? [];
    const today = own
      .filter(
        (e) =>
          e.cardId === card.id &&
          e.kind === "review" &&
          !voided.has(e.id) &&
          e.at >= dayStart &&
          e.at <= now,
      )
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    const first = today[0];
    if (first) {
      const before = replayCard(
        card.id,
        own.filter(
          (e) => e.at < first.at || (e.at === first.at && e.id < first.id) || e.kind === "void",
        ),
        presetOf(card),
        now,
      );
      if (before.state === State.New) newCount++;
      else if (before.state === State.Review) reviewCount++;
    }
  }
  const queue = cards
    .map((card) => ({
      card,
      memory: replayCard(card.id, entries.get(card.id) ?? [], presetOf(card), now),
      newPosition: newPosition(card, entries.get(card.id) ?? [], voided),
    }))
    .filter(({ memory }) =>
      memory.state === State.New
        ? newCount < preset.fields.newPerDay.value
        : memory.due.getTime() <= now &&
          (memory.state !== State.Review || reviewCount < preset.fields.reviewsPerDay.value),
    )
    .sort(
      (a, b) =>
        (a.memory.state === State.New ? 1 : 0) - (b.memory.state === State.New ? 1 : 0) ||
        (a.memory.state === State.New && b.memory.state === State.New
          ? a.newPosition - b.newPosition
          : a.memory.due.getTime() - b.memory.due.getTime()) ||
        a.card.id.localeCompare(b.card.id),
    );
  return {
    queue,
    newRemaining: Math.max(0, preset.fields.newPerDay.value - newCount),
    reviewRemaining: Math.max(0, preset.fields.reviewsPerDay.value - reviewCount),
  };
}

export function studyQueue(
  collection: CollectionState,
  log: readonly LogEntry[],
  deckId: string,
  now: number,
  dayStart = studyDayStart(now),
) {
  return studyCandidates(collection, log, deckId, now, dayStart).queue;
}

/** Cards available now, including subdecks, capped by the studied deck's remaining daily limits. */
export function studyCounts(
  collection: CollectionState,
  log: readonly LogEntry[],
  deckId: string,
  now: number,
) {
  const { queue, newRemaining, reviewRemaining } = studyCandidates(collection, log, deckId, now);
  const counts = { new: 0, learning: 0, review: 0 };
  for (const { memory } of queue) {
    if (memory.state === State.New) counts.new++;
    else if (memory.state === State.Review) counts.review++;
    else counts.learning++;
  }
  return {
    ...counts,
    new: Math.min(counts.new, newRemaining),
    review: Math.min(counts.review, reviewRemaining),
  };
}

/**
 * The card a study session shows next, with its note and note type: a card the session just
 * undid comes back first, as it was before the answer; otherwise the queue's head. Undefined when
 * nothing is left to study now.
 */
export function nextStudyCard(
  collection: CollectionState,
  log: readonly LogEntry[],
  deckId: string,
  now: number,
  undone?: string,
) {
  const queue = studyQueue(collection, log, deckId, now);
  const item = queue.find((c) => c.card.id === undone) ?? queue[0];
  const note = collection.notes.find((n) => n.id === item?.card.fields.noteId.value);
  const type = collection.noteTypes.find((t) => t.id === note?.fields.noteTypeId.value);
  return item && note && type ? { card: item.card, note, type } : undefined;
}
