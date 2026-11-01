/* oxlint-disable unicorn/no-array-sort -- ES2022/Hermes target; only freshly filtered/mapped arrays are sorted. */
import {
  computeDecayFactor,
  createEmptyCard,
  forgetting_curve,
  fsrs,
  State,
  type Card as MemoryState,
  type Grade,
} from "ts-fsrs";
import type { Card, CollectionState, Deck, Preset } from "./collection.ts";
import type { DisplayOrder } from "./display-order.ts";
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
const DAY_MS = 86_400_000;
/** FNV-1a, so "random" orders hold still while a study day's queue is rebuilt after each answer. */
function stableHash(id: string, salt: number) {
  let hash = 0x81_1c_9d_c5;
  for (const char of `${salt}:${id}`) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01_00_01_93);
  return hash >>> 0;
}
/** Anki's even mix: `two` spreads through `one`, and the longer side comes first. */
function intersperse<T>(one: readonly T[], two: readonly T[]) {
  const ratio = (one.length + 1) / (two.length + 1);
  const mixed: T[] = [];
  let i = 0;
  let j = 0;
  while (i < one.length && j < two.length)
    mixed.push((j + 1) * ratio < i + 1 ? two[j++]! : one[i++]!);
  return [...mixed, ...one.slice(i), ...two.slice(j)];
}
const merged = <T>(mix: DisplayOrder["newMix"], reviews: readonly T[], other: readonly T[]) => {
  if (mix === "after") return [...reviews, ...other];
  return mix === "before" ? [...other, ...reviews] : intersperse(reviews, other);
};
type Queued = { card: Card; memory: MemoryState; newPosition: number };
type SortKey = (item: Queued) => number | string;
const by =
  (keys: readonly SortKey[]) =>
  (a: Queued, b: Queued): number => {
    for (const key of keys) {
      const [x, y] = [key(a), key(b)];
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  };
const negative = (key: SortKey) => (item: Queued) => -Number(key(item));
const position: SortKey = (item) => item.newPosition;
const noteOf: SortKey = ({ card }) => card.fields.noteId.value;
const template: SortKey = ({ card }) => card.fields.ordinal.value;
const dueDay: SortKey = ({ memory }) => studyDayStart(memory.due.getTime());
const interval: SortKey = ({ memory }) => memory.scheduled_days;
const difficulty: SortKey = ({ memory }) => memory.difficulty;
const added: SortKey = ({ card }) => card.anki?.id ?? card.fields.noteId.hlc.wallMs;
/** Anki's collation: case-insensitive, with a parent right before its subdecks. */
const deckSortName = (deck: Deck) =>
  deck.fields.name.value.toLowerCase().replaceAll("::", "\u001f");
/**
 * Learning that waits for a later study day: ts-fsrs marks a step of a day or more as Review with
 * steps left, and a shorter step can still end past the day boundary.
 */
const isInterday = ({ memory }: Queued) => {
  if (memory.state === State.Review) return memory.learning_steps > 0;
  return (
    memory.last_review !== undefined &&
    studyDayStart(memory.due.getTime()) > studyDayStart(memory.last_review.getTime())
  );
};
/**
 * The study order, built as Anki's queue is. Learning steps due within the day come first; then
 * reviews, interday learning and new cards merge as the studied deck's preset says. The daily
 * limits pick which reviews and new cards take part, in gather order; new cards then sort.
 */
function displayQueue<T extends Queued>(
  items: readonly T[],
  options: {
    preset: Preset;
    presetOf: (card: Card) => Preset;
    decks: readonly Deck[];
    newRemaining: number;
    reviewRemaining: number;
    salt: number;
    now: number;
  },
): T[] {
  const { preset, presetOf, decks, newRemaining, reviewRemaining, salt, now } = options;
  const f = preset.fields;
  const ranks = new Map(
    [...decks]
      .map((d) => [deckSortName(d), d.id] as const)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, id], rank) => [id, rank]),
  );
  const deck: SortKey = ({ card }) => ranks.get(card.fields.deckId.value)!;
  const randomNote: SortKey = ({ card }) => stableHash(card.fields.noteId.value, salt);
  const randomCard: SortKey = ({ card }) => stableHash(card.id, salt);
  const gather: { [K in DisplayOrder["newGatherPriority"]]: readonly SortKey[] } = {
    deck: [deck, position, noteOf, template],
    deckThenRandomNotes: [deck, randomNote, noteOf, template],
    lowestPosition: [position, noteOf, template],
    highestPosition: [negative(position), noteOf, template],
    randomNotes: [randomNote, noteOf, template],
    randomCards: [randomCard],
  };
  const sort: { [K in DisplayOrder["newSortOrder"]]: readonly SortKey[] } = {
    template: [template],
    noSort: [],
    templateThenRandom: [template, randomCard],
    randomNoteThenTemplate: [randomNote, template],
    randomCard: [randomCard],
  };
  const retrievability = ({ card, memory }: Queued) =>
    forgetting_curve(
      presetOf(card).fields.fsrsParameters.value,
      Math.max(0, now - (memory.last_review?.getTime() ?? now)) / DAY_MS,
      memory.stability,
    );
  // How far past its interval a card is: Anki's FSRS relative overdueness.
  const overdueness = (item: Queued) => {
    const own = presetOf(item.card).fields;
    const { decay } = computeDecayFactor(own.fsrsParameters.value);
    const stretch = (r: number) => r ** (1 / decay) - 1;
    return stretch(retrievability(item)) / stretch(own.desiredRetention.value);
  };
  const review: { [K in DisplayOrder["reviewOrder"]]: readonly SortKey[] } = {
    day: [dueDay],
    dayThenDeck: [dueDay, deck],
    deckThenDay: [deck, dueDay],
    intervalsAscending: [interval],
    intervalsDescending: [negative(interval)],
    difficultyDescending: [negative(difficulty)],
    difficultyAscending: [difficulty],
    retrievabilityAscending: [retrievability],
    retrievabilityDescending: [negative(retrievability)],
    relativeOverdueness: [negative(overdueness)],
    random: [],
    added: [added, template],
    reverseAdded: [negative(added), template],
  };
  const reviewOrder = by([...review[f.reviewOrder.value], randomCard]);
  const ofState = (...states: State[]) => items.filter((i) => states.includes(i.memory.state));
  const learning = ofState(State.Learning, State.Relearning);
  const intraday = learning
    .filter((i) => !isInterday(i))
    .sort(by([({ memory }) => memory.due.getTime(), ({ card }) => card.id]));
  const allowed = ofState(State.Review).sort(reviewOrder).slice(0, reviewRemaining);
  const interday = [...learning, ...allowed].filter((i) => isInterday(i)).sort(reviewOrder);
  const reviews = allowed.filter((i) => !isInterday(i));
  const fresh = ofState(State.New)
    .sort(by(gather[f.newGatherPriority.value]))
    .slice(0, newRemaining)
    .sort(by(sort[f.newSortOrder.value]));
  return [
    ...intraday,
    ...merged(f.newMix.value, merged(f.interdayLearningMix.value, reviews, interday), fresh),
  ];
}
/**
 * The cards to study now in a deck and its subdecks, as Anki studies them. Each card schedules
 * with its own deck's preset; the daily limits and display order are the studied deck's.
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
  const candidates = cards
    .map((card) => ({
      card,
      memory: replayCard(card.id, entries.get(card.id) ?? [], presetOf(card), now),
      newPosition: newPosition(card, entries.get(card.id) ?? [], voided),
    }))
    .filter(({ memory }) => memory.state === State.New || memory.due.getTime() <= now);
  const newRemaining = Math.max(0, preset.fields.newPerDay.value - newCount);
  const reviewRemaining = Math.max(0, preset.fields.reviewsPerDay.value - reviewCount);
  const queue = displayQueue(candidates, {
    preset,
    presetOf,
    decks: collection.decks.filter((d) => family.has(d.id)),
    newRemaining,
    reviewRemaining,
    salt: dayStart,
    now,
  });
  return { queue, newRemaining, reviewRemaining };
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

/** Time recorded by normal study, capped by the card’s preset. */
export function studyAnswerDuration(preset: Preset, elapsedMs: number): number {
  return Math.min(
    Math.max(0, Math.round(elapsedMs)),
    preset.fields.maximumAnswerSeconds.value * 1000,
  );
}
