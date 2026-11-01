import { State } from "ts-fsrs";
import type { Card, CollectionState } from "./collection.ts";
import { importId } from "./ids.ts";
import { isBuried, type LogEntry } from "./study.ts";

/**
 * What `modules/ankidroid` reads from AnkiDroid's ContentProvider (`FlashCardsContract`), close to
 * the provider's own columns. See docs/research/ankidroid-api.md.
 */
export interface AnkiDroidDeck {
  id: number;
  /** Full name; subdecks nest with `::`. */
  name: string;
  /** The deck's options group as Anki's schema-11 JSON. */
  options: string;
  filtered: boolean;
}
export interface AnkiDroidNoteType {
  id: number;
  name: string;
  /** Field names joined by 0x1f. */
  fieldNames: string;
  css: string;
  cloze: boolean;
  templates: { ord: number; name: string; front: string; back: string }[];
}
export interface AnkiDroidNote {
  id: number;
  guid: string;
  noteTypeId: number;
  /** Seconds. */
  mod: number;
  /** Space-separated, as Anki stores them. */
  tags: string;
  /** Field values joined by 0x1f. */
  fields: string;
}
export interface AnkiDroidCard {
  id: number;
  noteId: number;
  ord: number;
  deckId: number;
  /** The home deck while the card sits in a filtered deck, otherwise 0. */
  originalDeckId: number;
  reps: number;
  lapses: number;
  /** 0 new, 1 learning, 2 review, 3 relearning. */
  type: number;
  queue: number;
  /** Unix seconds for intraday learning; a collection day number for review cards. */
  due: number;
  interval: number;
  left: number;
  stability: number | null;
  difficulty: number | null;
  lastReviewSecs: number | null;
}
/** One AnkiDroid deck to link, with its subdecks and everything their cards need. */
export interface AnkiDroidSource {
  deckId: number;
  decks: AnkiDroidDeck[];
  noteTypes: AnkiDroidNoteType[];
  notes: AnkiDroidNote[];
  cards: AnkiDroidCard[];
}

/** AnkiDroid 2.24.0 added card ids and scheduling columns to the API. */
const MINIMUM_VERSION_CODE = 22400300;
/**
 * Whether any of these cards came from AnkiDroid and sits in a linked deck. AnkiDroid's API can't
 * write Forget or Set due date, so on such a card they stay in the app (ADR 0003).
 */
export function cardsStayInApp(collection: CollectionState, cards: readonly Card[]) {
  const linked = new Set(collection.decks.filter((d) => d.fields.linkedBy).map((d) => d.id));
  return cards.some((c) => c.anki && linked.has(c.fields.deckId.value));
}

export type AnkiDroidAccess = "missing" | "outdated" | "permission" | "ready";
/** Why the AnkiDroid screens can or can't link. `null` means AnkiDroid isn't installed. */
export function ankiDroidAccess(
  installed: { versionCode: number; permission: "granted" | "denied" } | null,
): AnkiDroidAccess {
  if (!installed) return "missing";
  // ABI split APKs add 100000000 per ABI to AnkiDroid's version code.
  if (installed.versionCode % 100_000_000 < MINIMUM_VERSION_CODE) return "outdated";
  return installed.permission === "granted" ? "ready" : "permission";
}

/**
 * The app's gap between Sync AnkiDroid requests. AnkiDroid's docs warn of a "server busy" error
 * under 5 minutes; its code rejects `DO_SYNC` under 2.
 */
const SYNC_REQUEST_GAP_MS = 5 * 60_000;
/** How long Sync AnkiDroid must wait after the request at `requestedAt`; 0 when it can go now. */
export function ankiDroidSyncWaitMs(requestedAt: number | null, now: number): number {
  if (requestedAt === null || requestedAt > now) return 0;
  return Math.max(0, requestedAt + SYNC_REQUEST_GAP_MS - now);
}

export function linkableAnkiDroidDecks(decks: readonly AnkiDroidDeck[]): AnkiDroidDeck[] {
  // oxlint-disable-next-line unicorn/no-array-sort -- ES2022/Hermes target; sorts a fresh copy.
  return decks.filter((d) => !d.filtered).sort((a, b) => a.name.localeCompare(b.name));
}

/** The selected deck and its subdecks. */
export function linkedAnkiDroidDecks(source: AnkiDroidSource): AnkiDroidDeck[] {
  const root = source.decks.find((d) => d.id === source.deckId && !d.filtered);
  if (!root) throw new Error("AnkiDroid deck missing");
  return source.decks.filter(
    (d) => !d.filtered && (d.id === root.id || d.name.startsWith(`${root.name}::`)),
  );
}

export interface ImportedPreset {
  ankiId: number;
  name: string;
  newPerDay: number;
  reviewsPerDay: number;
  desiredRetention: number;
  learningSteps: number[];
}
const number = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
/** Reads a deck's schema-11 options JSON; missing or broken keys take the app's defaults. */
export function presetFromOptions(json: string): ImportedPreset {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object") raw = { ...parsed };
  } catch {
    // Defaults below.
  }
  const section = (key: string): Record<string, unknown> => {
    const value = raw[key];
    return value && typeof value === "object" ? { ...value } : {};
  };
  const delays = section("new")["delays"];
  return {
    ankiId: number(raw["id"], 1),
    name: typeof raw["name"] === "string" && raw["name"] ? raw["name"] : "Default",
    newPerDay: number(section("new")["perDay"], 20),
    reviewsPerDay: number(section("rev")["perDay"], 200),
    desiredRetention: number(raw["desiredRetention"], 0.9),
    learningSteps:
      Array.isArray(delays) && delays.every((d) => typeof d === "number" && d > 0)
        ? delays
        : [1, 10],
  };
}

const DAY = 86_400_000;
type SnapshotState = Extract<LogEntry, { kind: "snapshot" }>["state"];
/**
 * AnkiDroid's state of a reviewed card, as a snapshot at its last review (ADR 0003). New cards
 * have none. Without FSRS memory (SM-2 collections) the interval stands in for stability.
 */
function ankiDroidSnapshot(
  card: AnkiDroidCard,
  learningSteps: readonly number[],
  now: number,
): { at: number; state: SnapshotState } | null {
  if (card.type === 0 || card.reps === 0) return null;
  const at = card.lastReviewSecs === null ? now : card.lastReviewSecs * 1000;
  const learning = card.type === 1 || card.type === 3;
  // Intraday learning cards carry their due as Unix seconds; others count from the last review.
  const due =
    learning && card.due > 1_000_000_000 ? card.due * 1000 : at + Math.max(card.interval, 0) * DAY;
  const state =
    card.type === 1 ? State.Learning : card.type === 3 ? State.Relearning : State.Review;
  return {
    at,
    state: {
      due,
      last_review: at,
      stability: card.stability ?? Math.max(card.interval, 0.5),
      difficulty: card.difficulty ?? 5,
      elapsed_days: 0,
      scheduled_days: Math.max(card.interval, 0),
      reps: card.reps,
      lapses: card.lapses,
      learning_steps: learning ? Math.max(0, learningSteps.length - (card.left % 1000)) : 0,
      state,
    },
  };
}

/** One review to send to AnkiDroid as an answer. AnkiDroid finds the card by note id and ord. */
export interface SyncBackAnswer {
  entryId: string;
  cardId: string;
  deckId: string;
  /** AnkiDroid's note id. */
  noteId: number;
  ord: number;
  /** AnkiDroid's `answer_ease`: the grade, 1 Again to 4 Easy. */
  ease: number;
  timeTakenMs: number;
}
const voidedIn = (log: readonly LogEntry[]) =>
  new Set(log.flatMap((e) => (e.kind === "void" ? [e.targetId] : [])));
/** Decks this phone linked: only it pulls from AnkiDroid and syncs back (ADR 0001). */
const ownedDecks = (state: CollectionState, deviceId: string) =>
  state.decks.filter((d) => d.anki && d.fields.linkedBy?.value === deviceId);

/** Linked cards of decks this phone linked, with AnkiDroid's note id: what sync back can reach. */
function linkedCards(state: CollectionState, deviceId: string) {
  const decks = new Set(ownedDecks(state, deviceId).map((d) => d.id));
  const notes = new Map(state.notes.map((n) => [n.id, n]));
  return new Map(
    state.cards.flatMap((c) => {
      const noteId = notes.get(c.fields.noteId.value)?.anki?.id;
      return c.anki && noteId !== undefined && decks.has(c.fields.deckId.value)
        ? [[c.id, { card: c, noteId }] as const]
        : [];
    }),
  );
}

/**
 * The reviews sync back still has to send, in answer-time order: every review of a card in a deck
 * this phone linked, from any origin but import (those came from Anki), not voided and not in
 * `sent`. Cards made in the app have no AnkiDroid ids and stay in the app.
 */
export function syncBackQueue(
  state: CollectionState,
  log: readonly LogEntry[],
  deviceId: string,
  sent: ReadonlySet<string>,
): SyncBackAnswer[] {
  const cards = linkedCards(state, deviceId);
  const voided = voidedIn(log);
  return (
    log
      .flatMap((entry) => {
        const linked = cards.get(entry.cardId);
        if (entry.kind !== "review" || entry.origin === "import" || !linked) return [];
        if (voided.has(entry.id) || sent.has(entry.id)) return [];
        return [{ entry, ...linked }];
      })
      // oxlint-disable-next-line unicorn/no-array-sort -- ES2022/Hermes target; sorts a fresh copy.
      .sort((a, b) => a.entry.at - b.entry.at || a.entry.id.localeCompare(b.entry.id))
      .map(({ entry, card, noteId }) => ({
        entryId: entry.id,
        cardId: card.id,
        deckId: card.fields.deckId.value,
        noteId,
        ord: card.fields.ordinal.value,
        ease: entry.grade,
        timeTakenMs: Math.round(entry.durationMs),
      }))
  );
}

/**
 * AnkiDroid's `reps` the last time this phone saw the card: what it stored after linking, pulling
 * or a synced-back answer, else the latest snapshot's, else 0.
 */
export function seenReps(
  log: readonly LogEntry[],
  cardId: string,
  seen: ReadonlyMap<string, number>,
): number {
  const stored = seen.get(cardId);
  if (stored !== undefined) return stored;
  const voided = voidedIn(log);
  return Math.max(
    0,
    ...log.flatMap((e) =>
      e.kind === "snapshot" && e.cardId === cardId && !voided.has(e.id) ? [e.state.reps] : [],
    ),
  );
}

/** A snapshot entry for a linked card, keyed by AnkiDroid's card id and reps (ADR 0001). */
export function snapshotEntry(
  ad: AnkiDroidCard,
  cardId: string,
  learningSteps: readonly number[],
  now: number,
): LogEntry | null {
  const snapshot = ankiDroidSnapshot(ad, learningSteps, now);
  return (
    snapshot && {
      kind: "snapshot",
      id: importId("snapshot", `${ad.id}:${ad.reps}`),
      cardId,
      ...snapshot,
    }
  );
}

export interface SyncBackPlan {
  /** Cards AnkiDroid reviewed since we last saw them, to append before any answer goes. */
  snapshots: LogEntry[];
  send: SyncBackAnswer[];
  /** Cards suspended or buried in AnkiDroid: answering would put them back in its queue. */
  held: SyncBackAnswer[];
  /** Cards AnkiDroid no longer has. */
  gone: SyncBackAnswer[];
}
/**
 * What to do with the queue given AnkiDroid's cards as they are now. A card AnkiDroid reviewed
 * since we last saw it gets a snapshot first, so that review isn't lost under our answers.
 */
export function syncBackPlan(
  state: CollectionState,
  log: readonly LogEntry[],
  queue: readonly SyncBackAnswer[],
  cards: readonly AnkiDroidCard[],
  seen: ReadonlyMap<string, number>,
  now: number,
): SyncBackPlan {
  const there = new Map(cards.map((c) => [`${c.noteId}:${c.ord}`, c]));
  const plan: SyncBackPlan = { snapshots: [], send: [], held: [], gone: [] };
  const checked = new Set<string>();
  for (const answer of queue) {
    const ad = there.get(`${answer.noteId}:${answer.ord}`);
    if (!ad) plan.gone.push(answer);
    else if (ad.queue < 0) plan.held.push(answer);
    else {
      plan.send.push(answer);
      if (checked.has(answer.cardId)) continue;
      checked.add(answer.cardId);
      if (ad.reps <= seenReps(log, answer.cardId, seen)) continue;
      const steps = learningStepsOf(state, answer.deckId);
      const snapshot = snapshotEntry(ad, answer.cardId, steps, now);
      if (snapshot) plan.snapshots.push(snapshot);
    }
  }
  return plan;
}
const learningStepsOf = (state: CollectionState, deckId: string) => {
  const deck = state.decks.find((d) => d.id === deckId);
  const preset = state.presets.find((p) => p.id === deck?.fields.presetId.value);
  return preset?.fields.learningSteps.value ?? [];
};

/** One field version to send once. Imported/pulled versions are baselined by the local engine. */
export interface SyncBackSuspension {
  entryId: string;
  cardId: string;
  deckId: string;
  noteId: number;
  ord: number;
}
/**
 * Stands in what sync back sent for "AnkiDroid holds this card's suspension because we sent it".
 * AnkiDroid's API can't unsuspend, so pull doesn't re-apply that suspension to a card unsuspended
 * here; the key goes once AnkiDroid's queue for the card leaves suspended.
 */
export const sentSuspensionKey = (cardId: string) => `sent-suspension:${cardId}`;
export function syncBackSuspensions(
  state: CollectionState,
  deviceId: string,
  sent: ReadonlySet<string>,
): SyncBackSuspension[] {
  return [...linkedCards(state, deviceId).values()].flatMap(({ card, noteId }) => {
    const field = card.fields.suspended;
    const entryId = `suspend:${card.id}:${JSON.stringify(field.hlc)}`;
    if (!field.value || sent.has(entryId)) return [];
    const deckId = card.fields.deckId.value;
    return [{ entryId, cardId: card.id, deckId, noteId, ord: card.fields.ordinal.value }];
  });
}
/** A bury to send to AnkiDroid after the card's answers. AnkiDroid finds it by note id and ord. */
export interface SyncBackBury {
  /** Stands for this bury in what sync back sent: the card and the time the bury ends. */
  key: string;
  cardId: string;
  /** AnkiDroid's note id. */
  noteId: number;
  ord: number;
}
/**
 * The buries sync back still has to send: this phone's linked cards buried at `now` whose bury
 * isn't in `sent`. A bury that already ended stays in the app; burying again sends again. A
 * suspended card's bury waits: AnkiDroid would take the card out of its suspension to bury it.
 */
export function syncBackBuries(
  state: CollectionState,
  deviceId: string,
  sent: ReadonlySet<string>,
  now: number,
): SyncBackBury[] {
  return [...linkedCards(state, deviceId).values()].flatMap(({ card, noteId }) => {
    const key = `bury:${card.id}:${card.fields.buriedUntil.value}`;
    if (!isBuried(card, now) || card.fields.suspended.value || sent.has(key)) return [];
    return [{ key, cardId: card.id, noteId, ord: card.fields.ordinal.value }];
  });
}
/**
 * Which buries to send given AnkiDroid's cards before this sync back's answers. A card out of
 * AnkiDroid's queue (suspended or buried there) keeps its answers held and needs no bury, and a
 * card AnkiDroid deleted has nothing to bury: both are `done`.
 */
export function syncBackBuryPlan(
  buries: readonly SyncBackBury[],
  cards: readonly AnkiDroidCard[],
): { send: SyncBackBury[]; done: SyncBackBury[] } {
  const there = new Map(cards.map((c) => [`${c.noteId}:${c.ord}`, c]));
  const plan = { send: [] as SyncBackBury[], done: [] as SyncBackBury[] };
  for (const bury of buries) {
    const ad = there.get(`${bury.noteId}:${bury.ord}`);
    (ad && ad.queue >= 0 ? plan.send : plan.done).push(bury);
  }
  return plan;
}
