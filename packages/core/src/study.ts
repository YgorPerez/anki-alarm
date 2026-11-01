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
import { dailyLimit } from "./daily-limits.ts";
import type { DisplayOrder } from "./display-order.ts";
import { easyDayInterval, type EasyDays } from "./easy-days.ts";
export type { MemoryState, Grade };
/** FSRS card states: New, Learning, Review, Relearning. */
export { State as CardState };
/** Scheduling inputs only, copied so later preset edits cannot change an answer. */
export type SchedulingOptions = {
  desiredRetention: number;
  learningSteps: number[];
  fsrsParameters: number[];
  relearningSteps?: number[];
  maximumInterval?: number;
  leechThreshold?: number;
  leechAction?: "suspend" | "tagOnly";
  /**
   * Absent when every day is normal, as on reviews from before easy days. The answer's weekday is
   * recorded because a replay in another time zone would read another one from the clock.
   */
  easyDays?: EasyDays;
};
function fsrsOptions(preset: Preset): SchedulingOptions {
  return {
    desiredRetention: preset.fields.desiredRetention.value,
    learningSteps: [...preset.fields.learningSteps.value],
    fsrsParameters: [...preset.fields.fsrsParameters.value],
    relearningSteps: [...(preset.fields.relearningSteps?.value ?? [10])],
    maximumInterval: preset.fields.maximumInterval?.value ?? 36500,
    leechThreshold: preset.fields.leechThreshold?.value ?? 8,
    leechAction: preset.fields.leechAction?.value ?? "tagOnly",
  };
}
/** The options an answer at `at` records. */
export function schedulingOptions(preset: Preset, at: number): SchedulingOptions {
  const days = preset.fields.easyDays.value;
  if (days.every((day) => day === "normal")) return fsrsOptions(preset);
  const weekday = (new Date(studyDayStart(at)).getDay() + 6) % 7;
  return { ...fsrsOptions(preset), easyDays: { days: [...days], weekday } };
}
const DAY = 86_400_000;
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
        state = answered(entry.options ?? fsrsOptions(preset), state, entry.at, entry.grade);
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
function capInterval(state: MemoryState, at: number, maximum: number): MemoryState {
  if (state.state !== State.Review || state.scheduled_days <= maximum) return state;
  return { ...state, scheduled_days: maximum, due: new Date(at + maximum * 86400_000) };
}
function schedulerFor(options: SchedulingOptions) {
  return fsrs({
    request_retention: options.desiredRetention,
    w: options.fsrsParameters,
    enable_fuzz: false,
    maximum_interval: options.maximumInterval ?? 36500,
    relearning_steps: (options.relearningSteps ?? [10]).map((n) => `${n}m` as const),
    learning_steps: options.learningSteps.map((n) => `${n}m` as const),
  });
}
function answered(options: SchedulingOptions, memory: MemoryState, at: number, grade: Grade) {
  return options.easyDays
    ? answers(options, memory, at)[grade]
    : capInterval(
        schedulerFor(options).next(memory, new Date(at), grade).card,
        at,
        options.maximumInterval ?? 36500,
      );
}
/** Each grade's next state; the days Hard, Good and Easy send a card to follow the easy days. */
function answers(options: SchedulingOptions, memory: MemoryState, at: number) {
  const scheduler = schedulerFor(options);
  const choices = scheduler.repeat(memory, new Date(at));
  const capped = (grade: Grade) =>
    capInterval(choices[grade].card, at, options.maximumInterval ?? 36500);
  const states: Record<Grade, MemoryState> = {
    1: capped(1),
    2: capped(2),
    3: capped(3),
    4: capped(4),
  };
  if (!options.easyDays) return states;
  const previous = memory.state === State.Review ? { previous: memory.scheduled_days } : {};
  let floor = 1;
  for (const grade of [2, 3, 4] as const) {
    const card = states[grade];
    if (card.state !== State.Review) continue;
    const maximum = scheduler.parameters.maximum_interval;
    const days = easyDayInterval(card.scheduled_days, options.easyDays, {
      floor,
      maximum,
      ...previous,
    });
    const moved = (days - card.scheduled_days) * DAY;
    states[grade] = {
      ...card,
      scheduled_days: days,
      due: new Date(card.due.getTime() + moved),
    };
    floor = days + 1;
  }
  return states;
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
  const choices = answers(schedulingOptions(preset, now), memory, now);
  const seconds = (grade: Grade) => (choices[grade].due.getTime() - now) / 1000;
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
// Stable pseudo-random positions keep a random new queue identical on both clients.
function insertionPosition(
  card: Card,
  log: readonly LogEntry[],
  voided: ReadonlySet<string>,
  preset: Preset,
) {
  if (preset.fields.insertionOrder?.value !== "random") return newPosition(card, log, voided);
  const resets = log.filter((e) => e.cardId === card.id && e.kind === "reset" && !voided.has(e.id));
  if (resets.length) return 2 ** 32 + Math.max(...resets.map((e) => e.at));
  let hash = 2166136261;
  for (const char of card.id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
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
/** A deck and the decks above it, named `Parent::Child`. */
function deckLineage(collection: CollectionState, deck: Deck) {
  const name = deck.fields.name.value;
  return collection.decks.filter(
    (d) => d.id === deck.id || name.startsWith(`${d.fields.name.value}::`),
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
    /** Reserves a daily limit slot for a card; false when one of its limits has none left. */
    spend: (card: Card, kind: "new" | "review") => boolean;
    salt: number;
    now: number;
  },
): T[] {
  const { preset, presetOf, decks, spend, salt, now } = options;
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
  // Reviews reserve first: by default new cards share the review limit with them.
  const allowed = ofState(State.Review)
    .sort(reviewOrder)
    .filter(({ card }) => spend(card, "review"));
  const interday = [...learning, ...allowed].filter((i) => isInterday(i)).sort(reviewOrder);
  const reviews = allowed.filter((i) => !isInterday(i));
  const fresh = ofState(State.New)
    .sort(by(gather[f.newGatherPriority.value]))
    .filter(({ card }) => spend(card, "new"))
    .sort(by(sort[f.newSortOrder.value]));
  return [
    ...intraday,
    ...merged(f.newMix.value, merged(f.interdayLearningMix.value, reviews, interday), fresh),
  ];
}
/**
 * The cards to study now in a deck and its subdecks, as Anki studies them. Each card schedules
 * with its own deck's preset; the display order is the studied deck's. The daily limits are the
 * studied deck's, or with `applyAllParentLimits`, those of every deck from the top parent down to
 * the card's own.
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
  const allParents = preset.fields.applyAllParentLimits.value;
  const ignoreReviewLimit = preset.fields.newIgnoreReviewLimit.value;
  // With parent limits, answers anywhere under the top parent count.
  const top = deck.fields.name.value.split("::")[0]!;
  const counted = allParents
    ? collection.decks.filter(
        (d) => d.fields.name.value === top || d.fields.name.value.startsWith(`${top}::`),
      )
    : collection.decks.filter((d) => family.has(d.id));
  const presets = new Map<string, Preset>();
  for (const d of counted) {
    const own = deckPreset(collection, d);
    if (!own) throw new Error("Deck preset missing");
    presets.set(d.id, own);
  }
  const presetOf = (card: Card) => presets.get(card.fields.deckId.value)!;
  const voided = new Set(log.filter((e) => e.kind === "void").map((e) => e.targetId));
  // Each card replays only its own entries.
  const entries = new Map<string, LogEntry[]>();
  for (const entry of log) {
    const own = entries.get(entry.cardId);
    if (own) own.push(entry);
    else entries.set(entry.cardId, [entry]);
  }
  // Answers count wherever the card is now, even if it was later buried or suspended.
  const done = new Map<string, { new: number; review: number }>();
  for (const card of collection.cards) {
    if (!presets.has(card.fields.deckId.value)) continue;
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
      const count = done.get(card.fields.deckId.value) ?? { new: 0, review: 0 };
      if (before.state === State.New) count.new++;
      else if (before.state === State.Review) count.review++;
      done.set(card.fields.deckId.value, count);
    }
  }
  // What each limiting deck has left today, counting its subdecks' answers. By default new cards
  // use up the review limit too. Fresh per call, so the queue can reserve from it with `spend`.
  const budgets = new Map<string, { new: number; review: number }>();
  const budget = (d: Deck) => {
    const known = budgets.get(d.id);
    if (known) return known;
    let fresh = 0;
    let reviews = 0;
    for (const id of deckFamily(collection, d.id)) {
      fresh += done.get(id)?.new ?? 0;
      reviews += done.get(id)?.review ?? 0;
    }
    const own = presets.get(d.id)!;
    const review =
      dailyLimit(d, own, "review", dayStart) - reviews - (ignoreReviewLimit ? 0 : fresh);
    const left = dailyLimit(d, own, "new", dayStart) - fresh;
    const result = { new: ignoreReviewLimit ? left : Math.min(left, review), review };
    budgets.set(d.id, result);
    return result;
  };
  const budgetsOf = (card: Card) => {
    if (!allParents) return [budget(deck)];
    const own = collection.decks.find((d) => d.id === card.fields.deckId.value)!;
    return deckLineage(collection, own).map(budget);
  };
  /** Reserves a slot for a card; false when one of its limits has none left. */
  const spend = (card: Card, kind: "new" | "review") => {
    const limits = budgetsOf(card);
    if (limits.some((b) => b[kind] <= 0)) return false;
    for (const b of limits) {
      b[kind]--;
      if (ignoreReviewLimit) continue;
      if (kind === "new") b.review--;
      b.new = Math.min(b.new, b.review);
    }
    return true;
  };
  const candidates = collection.cards
    .filter(
      (c) => family.has(c.fields.deckId.value) && !c.fields.suspended?.value && !isBuried(c, now),
    )
    .map((card) => ({
      card,
      memory: replayCard(card.id, entries.get(card.id) ?? [], presetOf(card), now),
      newPosition: insertionPosition(card, entries.get(card.id) ?? [], voided, presetOf(card)),
    }))
    .filter(({ memory }) => memory.state === State.New || memory.due.getTime() <= now);
  return displayQueue(candidates, {
    preset,
    presetOf,
    decks: collection.decks.filter((d) => family.has(d.id)),
    spend,
    salt: dayStart,
    now,
  });
}

export function studyQueue(
  collection: CollectionState,
  log: readonly LogEntry[],
  deckId: string,
  now: number,
  dayStart = studyDayStart(now),
) {
  return studyCandidates(collection, log, deckId, now, dayStart);
}

/**
 * Whether a card can be answered in normal study: it is in the queue of its deck or of a deck
 * above it, whose limits may allow it when its own don't.
 */
export function canStudyCard(
  collection: CollectionState,
  log: readonly LogEntry[],
  cardId: string,
  now: number,
) {
  const card = collection.cards.find((c) => c.id === cardId);
  const deck = collection.decks.find((d) => d.id === card?.fields.deckId.value);
  return (
    !!deck &&
    deckLineage(collection, deck).some((d) =>
      studyQueue(collection, log, d.id, now).some((c) => c.card.id === cardId),
    )
  );
}

/** Cards available now, including subdecks, within the remaining daily limits. */
export function studyCounts(
  collection: CollectionState,
  log: readonly LogEntry[],
  deckId: string,
  now: number,
) {
  const counts = { new: 0, learning: 0, review: 0 };
  for (const { memory } of studyCandidates(collection, log, deckId, now)) {
    if (memory.state === State.New) counts.new++;
    else if (memory.state === State.Review) counts.review++;
    else counts.learning++;
  }
  return counts;
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
