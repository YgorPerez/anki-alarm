import { State } from "ts-fsrs";
import type { LogEntry } from "./study.ts";

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
export function ankiDroidSnapshot(
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
