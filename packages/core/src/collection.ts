/* oxlint-disable unicorn/no-array-sort -- ES2022/Hermes target; only fresh arrays are sorted. */
import { default_w } from "ts-fsrs";
import type { AnkiPackage } from "./apkg.ts";
import {
  linkedAnkiDroidDecks,
  presetFromOptions,
  seenReps,
  sentSuspensionKey,
  snapshotEntry,
  type AnkiDroidCard,
  type AnkiDroidSource,
} from "./ankidroid.ts";
import { cardId, importId, uuid7 } from "./ids.ts";
import { isLanguageTag } from "./locale.ts";
import { EASY_DAYS, NORMAL_WEEK, type EasyDay } from "./easy-days.ts";
import { editedNoteType, editedValues, noteTypeProblems, type NoteTypeEdit } from "./note-types.ts";
import {
  deckPreset,
  schedulingOptions,
  dueInDays,
  studyDayStart,
  cardMemory,
  CardState,
  type LogEntry,
} from "./study.ts";

/** FSRS-6's default weights, which every new preset starts from. */
export const DEFAULT_FSRS_PARAMETERS: readonly number[] = default_w;

export interface Hlc {
  wallMs: number;
  counter: number;
  deviceId: string;
}
export interface Field<T> {
  value: T;
  hlc: Hlc;
}
type RecordFields<T> = { id: string; fields: { [K in keyof T]: Field<T[K]> } };
/** Anki's own ids, kept for matching and export (ADR 0001). Absent on records made in the app. */
type AnkiIdentity<T = object> = { anki?: { id: number } & T };
export type Deck = RecordFields<{
  name: string;
  presetId: string;
  /** Overrides the preset's when set, as in Anki. */
  desiredRetention: number | null;
  /** The phone that linked this deck from AnkiDroid; another phone can take over. */
  linkedBy?: string;
  /** The BCP 47 tag read aloud speaks this deck's cards in. Absent: its parent's, or pt-BR. */
  language?: string;
}> &
  AnkiIdentity;
const AUDIO_TIMER_DEFAULTS = {
  dontPlayAutomatically: false,
  skipQuestionWhenReplayingAnswer: false,
  maximumAnswerSeconds: 60,
  showTimer: false,
  stopTimerOnAnswer: false,
};
export type Preset = RecordFields<{
  name: string;
  buryNew: boolean;
  buryReviews: boolean;
  buryLearning: boolean;
  newPerDay: number;
  reviewsPerDay: number;
  desiredRetention: number;
  /** Minutes. */
  learningSteps: number[];
  relearningSteps: number[];
  insertionOrder: "sequential" | "random";
  leechThreshold: number;
  leechAction: "suspend" | "tagOnly";
  maximumInterval: number;
  /** Absent on legacy app presets, which were all defaults. */
  isDefault?: boolean;
  /** FSRS-6's 21 weights. */
  fsrsParameters: number[];
  /** Each weekday, Monday first. */
  easyDays: EasyDay[];
  dontPlayAutomatically: boolean;
  skipQuestionWhenReplayingAnswer: boolean;
  maximumAnswerSeconds: number;
  showTimer: boolean;
  stopTimerOnAnswer: boolean;
}> &
  AnkiIdentity;
/** Legacy app presets and explicitly marked defaults cannot be deleted. */
export const isDefaultPreset = (preset: Preset): boolean =>
  !preset.anki && preset.fields.isDefault?.value !== false;

export type PresetOptions = {
  [K in Exclude<keyof Preset["fields"], "isDefault">]: Preset["fields"][K]["value"];
};
const presetKeys = [
  "dontPlayAutomatically",
  "skipQuestionWhenReplayingAnswer",
  "maximumAnswerSeconds",
  "showTimer",
  "stopTimerOnAnswer",

  "name",
  "newPerDay",
  "reviewsPerDay",
  "desiredRetention",
  "learningSteps",
  "relearningSteps",
  "insertionOrder",
  "leechThreshold",
  "leechAction",
  "maximumInterval",
  "fsrsParameters",
  "easyDays",
  "buryNew",
  "buryReviews",
  "buryLearning",
] as const satisfies readonly (keyof PresetOptions)[];
/** The bounds of a preset's options, for the rules below and the copy that states them. */
export const PRESET_LIMITS = {
  /** New cards and reviews per day: a whole number from 0 to this. */
  maxPerDay: 9999,
  minRetention: 0.7,
  maxRetention: 0.99,
  maxLearningSteps: 20,
  /** FSRS-6's parameter count. */
  fsrsParameters: 21,
} as const;
/** The rule `updatePreset` applies to each option, for forms to check as the user types. */
export const validOption: { [K in keyof PresetOptions]: (value: PresetOptions[K]) => boolean } = {
  buryNew: (v) => typeof v === "boolean",
  buryReviews: (v) => typeof v === "boolean",
  buryLearning: (v) => typeof v === "boolean",
  dontPlayAutomatically: (v) => typeof v === "boolean",
  skipQuestionWhenReplayingAnswer: (v) => typeof v === "boolean",
  maximumAnswerSeconds: (v) => Number.isSafeInteger(v) && v >= 0 && v <= 9999,
  showTimer: (v) => typeof v === "boolean",
  stopTimerOnAnswer: (v) => typeof v === "boolean",
  name: (v) => typeof v === "string" && Boolean(v.trim()),
  newPerDay: (v) => Number.isSafeInteger(v) && v >= 0 && v <= PRESET_LIMITS.maxPerDay,
  reviewsPerDay: (v) => Number.isSafeInteger(v) && v >= 0 && v <= PRESET_LIMITS.maxPerDay,
  desiredRetention: (v) =>
    Number.isFinite(v) && v >= PRESET_LIMITS.minRetention && v <= PRESET_LIMITS.maxRetention,
  learningSteps: (v) =>
    Array.isArray(v) &&
    v.length <= PRESET_LIMITS.maxLearningSteps &&
    v.every((n) => Number.isFinite(n) && n > 0),
  relearningSteps: (v) => validOption.learningSteps(v),
  insertionOrder: (v) => v === "sequential" || v === "random",
  leechThreshold: (v) => Number.isSafeInteger(v) && v >= 0 && v <= 9999,
  leechAction: (v) => v === "suspend" || v === "tagOnly",
  maximumInterval: (v) => Number.isSafeInteger(v) && v >= 1 && v <= 36500,
  fsrsParameters: (v) =>
    Array.isArray(v) && v.length === PRESET_LIMITS.fsrsParameters && v.every(Number.isFinite),
  easyDays: (v) => Array.isArray(v) && v.length === 7 && v.every((d) => EASY_DAYS.includes(d)),
};
export interface Template {
  name: string;
  front: string;
  back: string;
}
export type NoteType = RecordFields<{
  name: string;
  kind: "standard" | "cloze";
  fieldNames: string[];
  /** One card per template; a cloze type has one template and one card per cloze number. */
  templates: Template[];
  css: string;
}> &
  AnkiIdentity<{ fieldIds?: string[]; templateIds?: string[] }>;
/** `values` follow the note type's `fieldNames` by position, each with its own clock. Cards own decks. */
export type Note = RecordFields<{ noteTypeId: string; tags: string[] }> & {
  values: Field<string>[];
} & AnkiIdentity<{ guid: string }>;
export type Card = RecordFields<{
  noteId: string;
  deckId: string;
  ordinal: number;
  suspended: boolean;
  /** Buried until this time, the start of a study day; a past time or null means not buried. */
  buriedUntil: number | null;
  flag: number;
}> &
  AnkiIdentity;
export type RecordKind = "decks" | "presets" | "noteTypes" | "notes" | "cards";
/** The kinds a delete syncs for: the collection's records, and alarms. */
export type TombstoneKind = RecordKind | "alarms";
export interface Tombstone {
  id: string;
  kind: TombstoneKind;
  sequence: number;
  hlc: Hlc;
}
export interface CollectionState {
  decks: Deck[];
  presets: Preset[];
  noteTypes: NoteType[];
  notes: Note[];
  cards: Card[];
  tombstones: Tombstone[];
}
export interface CollectionEnvironment {
  deviceId: string;
  now: () => number;
  random: () => Uint8Array;
}
/** What linking or pulling an AnkiDroid deck changed. */
export interface AnkiDroidLink {
  deckId: string;
  /** Cards AnkiDroid reviewed since this phone last saw them. */
  snapshots: LogEntry[];
  /** AnkiDroid's `reps` for every linked card read, to store as seen. */
  seen: [cardId: string, reps: number][];
  /** Decks this phone took over: their earlier reviews are not sent back from here. */
  claimed: string[];
  /** Keys in what sync back sent for suspensions AnkiDroid no longer holds, to forget. */
  released: string[];
  added: number;
  edited: number;
}
const KINDS = ["decks", "presets", "noteTypes", "notes", "cards"] as const;
const fits = (type: NoteType, values: readonly string[]) =>
  values.length === type.fields.fieldNames.value.length && Boolean(values[0]?.trim());
/** The card ordinals a note gets: one per template, or one per cloze number for a cloze type. */
function ordinalsFor(type: NoteType, values: readonly string[]): number[] {
  if (type.fields.kind.value === "standard") return type.fields.templates.value.map((_, i) => i);
  const numbers = new Set<number>();
  for (const value of values)
    for (const match of value.matchAll(/\{\{c(\d+)::/g)) numbers.add(Number(match[1]) - 1);
  return numbers.size ? [...numbers].sort((a, b) => a - b) : [0];
}
/** Anki's field or template ids, following their fields or templates through an edit. */
const follow = (ids: string[] | undefined, items: readonly { from?: number }[]) =>
  ids && items.map(({ from }) => (from === undefined ? "" : (ids[from] ?? "")));
/** Anki joins field names and values with the unit separator. */
const SEPARATOR = "\u001f";
/** The clock after every field of `previous`, even when the wall clock went backwards. */
export function nextClock(
  previous: { fields: { [key: string]: Field<unknown> } } | undefined,
  env: CollectionEnvironment,
): Hlc {
  const clocks = Object.values(previous?.fields ?? {}).map((f) => f.hlc);
  const wallMs = Math.max(env.now(), ...clocks.map((h) => h.wallMs));
  const counter =
    Math.max(-1, ...clocks.filter((h) => h.wallMs === wallMs).map((h) => h.counter)) + 1;
  return { wallMs, counter, deviceId: env.deviceId };
}
const empty = (): CollectionState => ({
  decks: [],
  presets: [],
  noteTypes: [],
  notes: [],
  cards: [],
  tombstones: [],
});
/** Records as SQLite may hold them, from any earlier version; `parseCollection` reads them. */
export type StoredCollection = {
  [K in RecordKind]: { id: string; fields: object; values?: Field<string>[]; anki?: object }[];
} & { tombstones: Tombstone[] };
// JSON-only domain records; serialization preserves this type.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Reads stored records in the current shape, upgrading what earlier versions saved with the
 * records' own clocks, so the upgrade itself is not an edit: Basic notes kept `front` and `back` as
 * properties and a `deckId` the cards now own; note types had one front and back template; presets
 * had no `fsrsParameters` or `easyDays`, decks no `desiredRetention`, notes no `tags`, cards no
 * `suspended` or `buriedUntil`. Current records pass through unchanged.
 */
export function parseCollection(stored: StoredCollection): CollectionState {
  // Each record is brought to its current shape below.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const state = copy(stored) as unknown as CollectionState;
  for (const deck of state.decks)
    deck.fields.desiredRetention ??= { value: null, hlc: deck.fields.name.hlc };
  for (const preset of state.presets) {
    for (const key of ["buryNew", "buryReviews", "buryLearning"] as const)
      preset.fields[key] ??= { value: false, hlc: preset.fields.name.hlc };
    preset.fields.relearningSteps ??= { value: [10], hlc: preset.fields.name.hlc };
    preset.fields.insertionOrder ??= { value: "sequential", hlc: preset.fields.name.hlc };
    preset.fields.leechThreshold ??= { value: 8, hlc: preset.fields.name.hlc };
    preset.fields.leechAction ??= { value: "tagOnly", hlc: preset.fields.name.hlc };
    preset.fields.maximumInterval ??= { value: 36500, hlc: preset.fields.name.hlc };
    preset.fields.fsrsParameters ??= {
      value: [...DEFAULT_FSRS_PARAMETERS],
      hlc: preset.fields.name.hlc,
    };
    preset.fields.easyDays ??= { value: [...NORMAL_WEEK], hlc: preset.fields.name.hlc };
  }
  for (const preset of state.presets) {
    for (const [key, value] of Object.entries(AUDIO_TIMER_DEFAULTS)) {
      if (!(key in preset.fields))
        Object.assign(preset.fields, { [key]: { value, hlc: preset.fields.name.hlc } });
    }
  }
  // A preset deletion also beats assignments made offline after the deleting device last synced.
  // Keep the redirect derived from the tombstone, so a late deck field cannot resurrect its use.
  const deletedPresets = new Set(
    state.tombstones.filter((t) => t.kind === "presets").map((t) => t.id),
  );
  const fallback = state.presets
    .filter((p) => isDefaultPreset(p) && !deletedPresets.has(p.id))
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (fallback)
    for (const deck of state.decks)
      if (deletedPresets.has(deck.fields.presetId.value)) deck.fields.presetId.value = fallback.id;
  for (const card of state.cards) {
    card.fields.suspended ??= { value: false, hlc: card.fields.ordinal.hlc };
    card.fields.buriedUntil ??= { value: null, hlc: card.fields.ordinal.hlc };
    card.fields.flag ??= { value: 0, hlc: card.fields.ordinal.hlc };
  }
  for (const type of state.noteTypes) {
    const old = legacy(type.fields);
    if (!old.frontTemplate) continue;
    if (type.fields.templates) {
      delete old.frontTemplate;
      delete old.backTemplate;
      continue;
    }
    const hlc = old.frontTemplate.hlc;
    type.fields.kind = { value: "standard", hlc };
    const front = old.frontTemplate.value;
    type.fields.templates = {
      value: [{ name: "Card 1", front, back: old.backTemplate?.value ?? "" }],
      hlc,
    };
    delete old.frontTemplate;
    delete old.backTemplate;
  }
  for (const note of state.notes) {
    const old = legacy(note.fields);
    delete old.deckId;
    note.fields.tags ??= { value: [], hlc: note.fields.noteTypeId.hlc };
    if (!old.front) continue;
    // A sync merge may have joined an old record with a current one; current values win.
    note.values ??= [old.front, old.back ?? { value: "", hlc: old.front.hlc }];
    delete old.front;
    delete old.back;
  }
  return state;
}
/** One stored record in the current shape, as `parseCollection` reads it. */
export function parseRecord<K extends RecordKind>(
  kind: K,
  record: StoredCollection[K][number],
): CollectionState[K][number] {
  const stored: StoredCollection = {
    decks: [],
    presets: [],
    noteTypes: [],
    notes: [],
    cards: [],
    tombstones: [],
  };
  stored[kind].push(record);
  return parseCollection(stored)[kind][0]!;
}
interface Legacy {
  deckId?: Field<string>;
  frontTemplate?: Field<string>;
  backTemplate?: Field<string>;
  front?: Field<string>;
  back?: Field<string>;
}
// Records stored by earlier versions had these properties; current ones have none of them.
const legacy = (fields: object): Legacy => fields;
type Mergeable = { id: string; fields: Record<string, Field<unknown>>; anki?: object };
type ValuesOf<R extends Mergeable> = { [K in keyof R["fields"]]: R["fields"][K]["value"] };
const alive = (dead: Set<string>, kind: RecordKind) => (r: { id: string }) =>
  !dead.has(`${kind}:${r.id}`);
const byId = <R extends { id: string }>(records: R[]) => new Map(records.map((r) => [r.id, r]));
const fromAnki = (wallMs: number): Hlc => ({ wallMs, counter: 0, deviceId: "anki" });

/** Offline commands. Persist each resulting snapshot in one transaction before showing it. */
export class Collection {
  private state: CollectionState;
  private lastWall = 0;
  private counter = 0;
  private readonly env: CollectionEnvironment;
  constructor(env: CollectionEnvironment, state: CollectionState = empty()) {
    this.env = env;
    this.state = parseCollection(state);
    const dead = new Set(this.state.tombstones.map((t) => `${t.kind}:${t.id}`));
    // Resume the clock after a restart, including when the wall clock moved backwards.
    for (const kind of KINDS) for (const record of this.state[kind]) this.observeRecord(record);
    this.state.decks = this.state.decks.filter(alive(dead, "decks"));
    this.state.presets = this.state.presets.filter(alive(dead, "presets"));
    this.state.noteTypes = this.state.noteTypes.filter(alive(dead, "noteTypes"));
    this.state.notes = this.state.notes.filter(alive(dead, "notes"));
    this.state.cards = this.state.cards.filter(alive(dead, "cards"));
    for (const tombstone of this.state.tombstones) this.observe(tombstone.hlc);
  }
  private observeRecord(record: {
    fields: Record<string, Field<unknown>>;
    values?: Field<string>[];
  }) {
    for (const field of Object.values(record.fields)) this.observe(field.hlc);
    for (const field of record.values ?? []) this.observe(field.hlc);
  }
  private observe(hlc: Hlc) {
    if (hlc.wallMs > this.lastWall) {
      this.lastWall = hlc.wallMs;
      this.counter = hlc.counter;
    } else if (hlc.wallMs === this.lastWall) this.counter = Math.max(this.counter, hlc.counter);
  }
  private tick(): Hlc {
    const now = this.env.now();
    if (now > this.lastWall) {
      this.lastWall = now;
      this.counter = 0;
    } else this.counter++;
    return { wallMs: this.lastWall, counter: this.counter, deviceId: this.env.deviceId };
  }
  private record<T extends object>(
    values: T,
    id = uuid7(this.env.now(), this.env.random()),
    hlc = this.tick(),
  ): RecordFields<T> {
    return {
      id,
      // Every input key is retained and wrapped in Field<T>.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      fields: Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, { value, hlc }]),
      ) as RecordFields<T>["fields"],
    };
  }
  private deleted(kind: RecordKind, id: string) {
    return this.state.tombstones.some((t) => t.kind === kind && t.id === id);
  }
  snapshot(): CollectionState {
    return copy(this.state);
  }
  /** The app's own preset, made on first use. */
  private defaultPreset(): Preset {
    let preset = this.state.presets
      .filter(isDefaultPreset)
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!preset) {
      preset = this.record({
        isDefault: true,
        ...AUDIO_TIMER_DEFAULTS,
        name: "Default",
        buryNew: false,
        buryReviews: false,
        buryLearning: false,
        newPerDay: 20,
        reviewsPerDay: 200,
        desiredRetention: 0.9,
        learningSteps: [1, 10],
        relearningSteps: [10],
        insertionOrder: "sequential" as const,
        leechThreshold: 8,
        leechAction: "tagOnly" as const,
        maximumInterval: 36500,
        fsrsParameters: [...DEFAULT_FSRS_PARAMETERS],
        easyDays: [...NORMAL_WEEK],
      });
      this.state.presets.push(preset);
    }
    return preset;
  }
  /** Applies the leech action after any answer, in the same transaction as its log entry. */
  applyReviewEffects(log: readonly LogEntry[], entry: LogEntry) {
    if (entry.kind !== "review") return;
    const card = this.state.cards.find((c) => c.id === entry.cardId);
    const deck = this.state.decks.find((d) => d.id === card?.fields.deckId.value);
    const preset = deck && deckPreset(this.state, deck);
    if (!card || !preset) throw new Error("Card missing");
    const options = entry.options ?? schedulingOptions(preset, entry.at);
    const threshold = options.leechThreshold ?? 8;
    const memory = cardMemory(this.state, [...log, entry], card.id, entry.at)!;
    if (threshold === 0 || memory.lapses < threshold) return;
    const note = this.state.notes.find((n) => n.id === card.fields.noteId.value)!;
    if (!note.fields.tags.value.includes("leech"))
      note.fields.tags = { value: [...note.fields.tags.value, "leech"], hlc: this.tick() };
    if (options.leechAction === "suspend") this.setCardsSuspended([card.id], true);
  }
  createDeck(name: string): Deck {
    if (!name.trim()) throw new Error("Deck name is required");
    const preset = this.defaultPreset();
    const deck = this.record({ name: name.trim(), presetId: preset.id, desiredRetention: null });
    this.state.decks.push(deck);
    return copy(deck);
  }
  renameDeck(id: string, name: string) {
    const deck = this.state.decks.find((d) => d.id === id);
    if (!deck || !name.trim()) throw new Error("Invalid deck");
    if (deck.fields.name.value !== name.trim())
      deck.fields.name = { value: name.trim(), hlc: this.tick() };
  }
  /** The BCP 47 tag read aloud speaks the deck's cards in; subdecks without one inherit it. */
  setDeckLanguage(id: string, language: string) {
    const deck = this.state.decks.find((d) => d.id === id);
    if (!deck || !isLanguageTag(language)) throw new Error("Invalid deck language");
    if (deck.fields.language?.value !== language)
      deck.fields.language = { value: language, hlc: this.tick() };
  }
  /** Adds a note to Basic, the app's own note type, creating it on first use. */
  addBasicNote(deckId: string, front: string, back: string): Note {
    if (!this.state.decks.some((d) => d.id === deckId) || !front.trim())
      throw new Error("Invalid note");
    return this.addNote(deckId, this.basicType().id, [front, back]);
  }
  private basicType(): NoteType {
    let type = this.state.noteTypes.find(
      (t) => !t.anki && t.fields.name.value === "Basic" && t.fields.fieldNames.value.length === 2,
    );
    if (!type) {
      type = this.record({
        name: "Basic",
        kind: "standard" as const,
        fieldNames: ["Front", "Back"],
        templates: [
          { name: "Card 1", front: "{{Front}}", back: '{{FrontSide}}<hr id="answer">{{Back}}' },
        ],
        css: "",
      });
      this.state.noteTypes.push(type);
    }
    return type;
  }
  /** Adds a note with one card per template (or cloze number), all in `deckId`. */
  addNote(deckId: string, noteTypeId: string, values: readonly string[]): Note {
    const type = this.state.noteTypes.find((t) => t.id === noteTypeId);
    if (!this.state.decks.some((d) => d.id === deckId) || !type || !fits(type, values))
      throw new Error("Invalid note");
    const hlc = this.tick();
    const note: Note = {
      ...this.record({ noteTypeId, tags: [] as string[] }, undefined, hlc),
      values: values.map((value) => ({ value, hlc })),
    };
    this.state.notes.push(note);
    for (const ordinal of ordinalsFor(type, values))
      this.state.cards.push(
        this.record(
          { noteId: note.id, deckId, ordinal, suspended: false, buriedUntil: null, flag: 0 },
          cardId(note.id, ordinal),
          hlc,
        ),
      );
    return copy(note);
  }
  /** Stamps only the values that changed, so concurrent edits of other fields survive a merge. */
  editNote(id: string, values: readonly string[]) {
    const note = this.state.notes.find((n) => n.id === id);
    const type = this.state.noteTypes.find((t) => t.id === note?.fields.noteTypeId.value);
    if (!note || !type || !fits(type, values)) throw new Error("Invalid note");
    values.forEach((value, i) => {
      if (note.values[i]?.value !== value) note.values[i] = { value, hlc: this.tick() };
    });
    // A cloze number the note didn't have gets its card. One taken out keeps its card, as in Anki.
    const cards = this.cardsOf(id);
    const have = new Set(cards.map((c) => c.fields.ordinal.value));
    const deckId = cards[0]?.fields.deckId.value;
    if (deckId && type.fields.kind.value === "cloze")
      for (const ordinal of ordinalsFor(type, values))
        if (!have.has(ordinal)) this.addCard(id, ordinal, deckId);
  }
  /** Sets Anki's flag (0 clears it), returning the previous value for undo. */
  setCardFlag(id: string, flag: number): number {
    if (!Number.isInteger(flag) || flag < 0 || flag > 7) throw new Error("Invalid flag");
    const card = this.state.cards.find((c) => c.id === id);
    if (!card) throw new Error("Invalid card");
    const previous = card.fields.flag.value;
    if (previous !== flag) card.fields.flag = { value: flag, hlc: this.tick() };
    return previous;
  }
  /** Sets the note's marked tag without changing its other tags; returns the previous mark. */
  setNoteMarked(id: string, marked: boolean): boolean {
    const note = this.state.notes.find((n) => n.id === id);
    if (!note) throw new Error("Invalid note");
    const tags = note.fields.tags.value;
    const previous = tags.includes("marked");
    if (previous !== marked)
      note.fields.tags = {
        value: marked ? [...tags, "marked"] : tags.filter((t) => t !== "marked"),
        hlc: this.tick(),
      };
    return previous;
  }
  /** The note a card belongs to. */
  noteIdOf(id: string): string {
    const card = this.state.cards.find((c) => c.id === id);
    if (!card) throw new Error("Invalid card");
    return card.fields.noteId.value;
  }
  /** A note's cards, by ordinal. */
  private cardsOf(noteId: string) {
    return this.state.cards
      .filter((c) => c.fields.noteId.value === noteId)
      .sort((a, b) => a.fields.ordinal.value - b.fields.ordinal.value);
  }
  /** A new card. Its id is the note's and ordinal's unless a card had it, then a fresh one. */
  private addCard(noteId: string, ordinal: number, deckId: string, hlc = this.tick()) {
    let id = cardId(noteId, ordinal);
    if (this.state.cards.some((c) => c.id === id) || this.deleted("cards", id))
      id = uuid7(this.env.now(), this.env.random());
    this.state.cards.push(
      this.record(
        { noteId, deckId, ordinal, suspended: false, buriedUntil: null, flag: 0 },
        id,
        hlc,
      ),
    );
  }
  /**
   * Changes a note type's name, fields, templates and CSS (see `NoteTypeEdit`). Notes move their
   * values with their fields, and templates follow renamed fields. On a standard type, a removed
   * template deletes its cards, a moved one renumbers them, and a new one adds a card to every
   * note, in the deck of its first card. Only what changed takes a new clock.
   */
  editNoteType(id: string, edit: NoteTypeEdit) {
    const type = this.state.noteTypes.find((t) => t.id === id);
    if (!type || noteTypeProblems(type, edit).length) throw new Error("Invalid note type");
    const fields = type.fields;
    const next = editedNoteType(type, edit).fields;
    for (const key of ["name", "fieldNames", "templates", "css"] as const)
      if (!same(fields[key].value, next[key].value))
        Object.assign(fields, { [key]: { value: next[key].value, hlc: this.tick() } });
    if (type.anki) {
      const fieldIds = follow(type.anki.fieldIds, edit.fields);
      const templateIds = follow(type.anki.templateIds, edit.templates);
      if (fieldIds) type.anki.fieldIds = fieldIds;
      if (templateIds) type.anki.templateIds = templateIds;
    }
    const notes = this.state.notes.filter((n) => n.fields.noteTypeId.value === id);
    for (const note of notes) {
      const before = note.values;
      note.values = editedValues(before, edit).map((value, i) => {
        const kept = before[i];
        return kept?.value === value ? kept : { value, hlc: this.tick() };
      });
    }
    if (fields.kind.value === "cloze") return;
    for (const note of notes) {
      const cards = this.cardsOf(note.id);
      const deckId = cards[0]?.fields.deckId.value;
      for (const card of cards) {
        const ordinal = edit.templates.findIndex((t) => t.from === card.fields.ordinal.value);
        if (ordinal < 0) this.remove("cards", card.id);
        else if (ordinal !== card.fields.ordinal.value)
          card.fields.ordinal = { value: ordinal, hlc: this.tick() };
      }
      if (deckId)
        edit.templates.forEach((t, ordinal) => {
          if (t.from === undefined) this.addCard(note.id, ordinal, deckId);
        });
    }
  }
  /** Deletes notes and their cards. */
  deleteNotes(ids: readonly string[]) {
    if (!ids.every((id) => this.state.notes.some((n) => n.id === id)))
      throw new Error("Invalid note");
    for (const id of new Set(ids)) {
      for (const card of this.cardsOf(id)) this.remove("cards", card.id);
      this.remove("notes", id);
    }
  }
  createPreset(name: string): Preset {
    if (!validOption.name(name)) throw new Error("Invalid preset name");
    return this.copyPreset(this.defaultPreset().id, name, true);
  }
  duplicatePreset(id: string, name: string): Preset {
    return this.copyPreset(id, name, false);
  }
  private copyPreset(id: string, name: string, factory: boolean): Preset {
    const source = this.state.presets.find((p) => p.id === id);
    if (!source || !validOption.name(name)) throw new Error("Invalid preset");
    const preset = this.record({
      name: name.trim(),
      newPerDay: factory ? 20 : source.fields.newPerDay.value,
      reviewsPerDay: factory ? 200 : source.fields.reviewsPerDay.value,
      desiredRetention: factory ? 0.9 : source.fields.desiredRetention.value,
      learningSteps: factory ? [1, 10] : copy(source.fields.learningSteps.value),
      relearningSteps: factory ? [10] : copy(source.fields.relearningSteps.value),
      insertionOrder: factory ? ("sequential" as const) : source.fields.insertionOrder.value,
      leechThreshold: factory ? 8 : source.fields.leechThreshold.value,
      leechAction: factory ? ("tagOnly" as const) : source.fields.leechAction.value,
      maximumInterval: factory ? 36500 : source.fields.maximumInterval.value,
      fsrsParameters: factory
        ? [...DEFAULT_FSRS_PARAMETERS]
        : copy(source.fields.fsrsParameters.value),
      easyDays: factory ? [...NORMAL_WEEK] : copy(source.fields.easyDays.value),
      buryNew: factory ? false : source.fields.buryNew.value,
      buryReviews: factory ? false : source.fields.buryReviews.value,
      buryLearning: factory ? false : source.fields.buryLearning.value,
      dontPlayAutomatically: factory
        ? AUDIO_TIMER_DEFAULTS.dontPlayAutomatically
        : source.fields.dontPlayAutomatically.value,
      skipQuestionWhenReplayingAnswer: factory
        ? AUDIO_TIMER_DEFAULTS.skipQuestionWhenReplayingAnswer
        : source.fields.skipQuestionWhenReplayingAnswer.value,
      maximumAnswerSeconds: factory
        ? AUDIO_TIMER_DEFAULTS.maximumAnswerSeconds
        : source.fields.maximumAnswerSeconds.value,
      showTimer: factory ? AUDIO_TIMER_DEFAULTS.showTimer : source.fields.showTimer.value,
      stopTimerOnAnswer: factory
        ? AUDIO_TIMER_DEFAULTS.stopTimerOnAnswer
        : source.fields.stopTimerOnAnswer.value,
      isDefault: false,
    });
    this.state.presets.push(preset);
    return copy(preset);
  }
  setDeckPreset(deckId: string, presetId: string) {
    const deck = this.state.decks.find((d) => d.id === deckId);
    if (!deck || !this.state.presets.some((p) => p.id === presetId))
      throw new Error("Invalid preset");
    if (deck.fields.presetId.value !== presetId)
      deck.fields.presetId = { value: presetId, hlc: this.tick() };
  }
  deletePreset(id: string) {
    const preset = this.state.presets.find((p) => p.id === id);
    if (!preset || isDefaultPreset(preset)) throw new Error("Cannot delete preset");
    const fallback = this.defaultPreset();
    for (const deck of this.state.decks)
      if (deck.fields.presetId.value === id) this.setDeckPreset(deck.id, fallback.id);
    this.remove("presets", id);
  }
  /** Changes a preset, which every deck using it shares. Stamps only the changed options. */
  updatePreset(id: string, patch: Partial<PresetOptions>) {
    const preset = this.state.presets.find((p) => p.id === id);
    const valid = <K extends keyof PresetOptions>(key: K, value: PresetOptions[K] | undefined) =>
      value === undefined || validOption[key](value);
    if (!preset || presetKeys.some((key) => !valid(key, patch[key])))
      throw new Error("Invalid deck options");
    const stamp = <K extends keyof PresetOptions>(key: K, value: PresetOptions[K] | undefined) => {
      if (value !== undefined && JSON.stringify(preset.fields[key].value) !== JSON.stringify(value))
        Object.assign(preset.fields, { [key]: { value: copy(value), hlc: this.tick() } });
    };
    const options = { ...patch, ...(patch.name === undefined ? {} : { name: patch.name.trim() }) };
    for (const key of presetKeys) stamp(key, options[key]);
  }
  /** Sets suspension and returns the previous values for action undo. Validates before changing. */
  setCardsSuspended(cardIds: readonly string[], suspended: boolean) {
    const cards = this.state.cards.filter((c) => cardIds.includes(c.id));
    if (cards.length !== new Set(cardIds).size) throw new Error("Invalid card");
    const previous = cards.map((c) => ({ cardId: c.id, suspended: c.fields.suspended.value }));
    for (const card of cards)
      if (card.fields.suspended.value !== suspended)
        card.fields.suspended = { value: suspended, hlc: this.tick() };
    return previous;
  }
  /** Suspends every card of a note, including siblings in other decks. */
  suspendNote(noteId: string) {
    if (!this.state.notes.some((n) => n.id === noteId)) throw new Error("Invalid note");
    return this.setCardsSuspended(
      this.cardsOf(noteId).map((c) => c.id),
      true,
    );
  }
  /** Restores suspension through new synced field clocks, without changing the review log. */
  restoreSuspension(previous: readonly { cardId: string; suspended: boolean }[]) {
    if (previous.some((p) => !this.state.cards.some((c) => c.id === p.cardId)))
      throw new Error("Invalid card");
    for (const p of previous) this.setCardsSuspended([p.cardId], p.suspended);
  }
  moveCards(cardIds: readonly string[], deckId: string) {
    if (!this.state.decks.some((d) => d.id === deckId)) throw new Error("Invalid deck");
    const cards = this.state.cards.filter((c) => cardIds.includes(c.id));
    if (cards.length !== new Set(cardIds).size) throw new Error("Invalid card");
    for (const card of cards)
      if (card.fields.deckId.value !== deckId)
        card.fields.deckId = { value: deckId, hlc: this.tick() };
  }
  /**
   * Buries the card until the next study day starts: study and alarm sessions skip it until then.
   * Linked cards are buried in AnkiDroid too, with the next sync back.
   */
  buryCard(id: string) {
    this.setBuriedUntil(id, dueInDays(1, this.env.now()));
  }
  /** Applies normal-study sibling buries, or restores the buries of an undone answer. */
  applySiblingBurying(entry: LogEntry, log: readonly LogEntry[]): LogEntry {
    if (entry.kind === "void") {
      const target = log.find((e) => e.id === entry.targetId);
      if (target?.kind === "review")
        for (const previous of target.siblingBuries ?? []) {
          const card = this.state.cards.find((c) => c.id === previous.cardId);
          if (card?.fields.buriedUntil.value === dueInDays(1, target.at))
            this.setBuriedUntil(card.id, previous.until);
        }
      return entry;
    }
    if (
      entry.kind !== "review" ||
      entry.origin === "alarm" ||
      entry.origin === "import" ||
      entry.ringId !== undefined
    )
      return entry;
    const card = this.state.cards.find((c) => c.id === entry.cardId);
    const deck = this.state.decks.find((d) => d.id === card?.fields.deckId.value);
    const preset = deck && deckPreset(this.state, deck);
    if (!card || !preset) throw new Error("Deck preset missing");
    const previous: { cardId: string; until: number | null }[] = [];
    for (const sibling of this.cardsOf(card.fields.noteId.value)) {
      if (
        sibling.id === card.id ||
        sibling.fields.suspended.value ||
        (sibling.fields.buriedUntil.value ?? 0) > entry.at
      )
        continue;
      const memory = cardMemory(this.state, log, sibling.id, entry.at);
      if (!memory) continue;
      const bury =
        memory.state === CardState.New
          ? preset.fields.buryNew.value
          : memory.state === CardState.Review
            ? preset.fields.buryReviews.value
            : preset.fields.buryLearning.value;
      if (!bury) continue;
      previous.push({ cardId: sibling.id, until: sibling.fields.buriedUntil.value });
      this.setBuriedUntil(sibling.id, dueInDays(1, entry.at));
    }
    return previous.length ? { ...entry, siblingBuries: previous } : entry;
  }
  /** Reverses `buryCard`: the card is back in study at once. */
  unburyCard(id: string) {
    this.setBuriedUntil(id, null);
  }
  private setBuriedUntil(id: string, until: number | null) {
    const card = this.state.cards.find((c) => c.id === id);
    if (!card) throw new Error("Invalid card");
    if (card.fields.buriedUntil.value !== until)
      card.fields.buriedUntil = { value: until, hlc: this.tick() };
  }
  /** Moves every card of the note to `deckId`. */
  moveNote(id: string, deckId: string) {
    this.moveCards(
      this.cardsOf(id).map((c) => c.id),
      deckId,
    );
  }
  /** Deletes the deck, its cards, and the notes left without a card. */
  deleteDeck(id: string) {
    if (!this.state.decks.some((d) => d.id === id)) return;
    for (const card of this.state.cards.filter((c) => c.fields.deckId.value === id))
      this.remove("cards", card.id);
    const orphans = this.state.notes.filter(
      (n) => !this.state.cards.some((c) => c.fields.noteId.value === n.id),
    );
    for (const note of orphans) this.remove("notes", note.id);
    this.remove("decks", id);
  }
  /**
   * Imports an AnkiDroid deck with its subdecks as linked decks owned by this phone (ADR 0001).
   * Records take ids from their Anki identities, so linking again updates instead of duplicating:
   * a note field takes AnkiDroid's value when the note's mod time is newer than the field's clock.
   * Pulling is linking again: new notes and cards come in, edited fields follow that rule, and
   * suspension follows AnkiDroid, except a suspension sync back sent (`sent`, see
   * `sentSuspensionKey`) on a card unsuspended here since. A card AnkiDroid reviewed since this
   * phone last saw it (`seen`, see `seenReps`) comes with a snapshot of its state to append to the
   * review log.
   */
  linkAnkiDroid(
    source: AnkiDroidSource,
    log: readonly LogEntry[] = [],
    seen: ReadonlyMap<string, number> = new Map(),
    sent: ReadonlySet<string> = new Set(),
  ): AnkiDroidLink {
    const decks = linkedAnkiDroidDecks(source);
    const claimed: string[] = [];
    // Notes that were in a linked deck before this link: their mark is already the app's.
    const linkedDecks = new Set(this.state.decks.filter((d) => d.fields.linkedBy).map((d) => d.id));
    const linkedNotes = new Set(
      this.state.cards
        .filter((c) => linkedDecks.has(c.fields.deckId.value))
        .map((c) => c.fields.noteId.value),
    );
    const deckIds = new Map(decks.map((d) => [d.id, importId("deck", d.id, d.name)]));
    if ([...deckIds.values()].some((id) => this.deleted("decks", id)))
      throw new Error("Linked deck was deleted");
    const steps = new Map<string, number[]>();
    for (const ad of decks) {
      const { ankiId, ...options } = presetFromOptions(ad.options);
      const presetId = importId("preset", ankiId, options.name);
      const id = deckIds.get(ad.id)!;
      steps.set(id, options.learningSteps);
      if (!this.state.presets.some((p) => p.id === presetId))
        this.state.presets.push({
          ...this.record(
            {
              ...AUDIO_TIMER_DEFAULTS,
              relearningSteps: [10],
              insertionOrder: "sequential" as const,
              leechThreshold: 8,
              leechAction: "tagOnly" as const,
              maximumInterval: 36500,
              ...options,
              fsrsParameters: [...DEFAULT_FSRS_PARAMETERS],
              easyDays: [...NORMAL_WEEK],
            },
            presetId,
          ),
          anki: { id: ankiId },
        });
      const deck = this.state.decks.find((d) => d.id === id);
      if (deck?.fields.linkedBy?.value !== this.env.deviceId) claimed.push(id);
      if (!deck)
        this.state.decks.push({
          ...this.record(
            { name: ad.name, presetId, desiredRetention: null, linkedBy: this.env.deviceId },
            id,
          ),
          anki: { id: ad.id },
        });
      else if (deck.fields.linkedBy?.value !== this.env.deviceId)
        deck.fields.linkedBy = { value: this.env.deviceId, hlc: this.tick() };
    }
    const typeIds = new Map<number, string>();
    for (const ad of source.noteTypes) {
      const id = importId("noteType", ad.id);
      typeIds.set(ad.id, id);
      if (this.state.noteTypes.some((t) => t.id === id)) continue;
      const templates = ad.templates
        .map(({ ord, name, front, back }) => ({ ord, template: { name, front, back } }))
        // oxlint-disable-next-line unicorn/no-array-sort -- ES2022/Hermes target; sorts a fresh copy.
        .sort((a, b) => a.ord - b.ord)
        .map((t) => t.template);
      this.state.noteTypes.push({
        ...this.record(
          {
            name: ad.name,
            kind: ad.cloze ? ("cloze" as const) : ("standard" as const),
            fieldNames: ad.fieldNames.split(SEPARATOR),
            templates,
            css: ad.css,
          },
          id,
        ),
        anki: { id: ad.id },
      });
    }
    const homeDeck = (c: AnkiDroidCard) => deckIds.get(c.originalDeckId || c.deckId);
    const noteIds = new Map<number, string>();
    let added = 0;
    let edited = 0;
    for (const ad of source.notes) {
      const id = importId("note", ad.guid);
      const noteTypeId = typeIds.get(ad.noteTypeId);
      const hasCard = source.cards.some((c) => c.noteId === ad.id && homeDeck(c));
      if (!noteTypeId || !hasCard || this.deleted("notes", id)) continue;
      noteIds.set(ad.id, id);
      const merged = this.mergeAnkiNote(id, ad, noteTypeId, !linkedNotes.has(id));
      if (merged === "added") added++;
      else if (merged === "edited") edited++;
    }
    const snapshots: LogEntry[] = [];
    const reps: [string, number][] = [];
    const released: string[] = [];
    for (const ad of source.cards) {
      const noteId = noteIds.get(ad.noteId);
      const deckId = homeDeck(ad);
      if (!noteId || !deckId) continue;
      const id = cardId(noteId, ad.ord);
      if (this.deleted("cards", id)) continue;
      // Queue -1 is suspended in Anki; buried cards (-2/-3) are not modelled.
      const suspended = ad.queue === -1;
      const ours = sent.has(sentSuspensionKey(id));
      if (ours && !suspended) released.push(sentSuspensionKey(id));
      const card = this.state.cards.find((c) => c.id === id);
      if (!card)
        this.state.cards.push({
          ...this.record(
            { noteId, deckId, ordinal: ad.ord, suspended, buriedUntil: null, flag: 0 },
            id,
          ),
          anki: { id: ad.id },
        });
      else if (card.fields.suspended.value !== suspended && !(suspended && ours))
        card.fields.suspended = { value: suspended, hlc: this.tick() };
      reps.push([id, ad.reps]);
      if (ad.reps <= seenReps(log, id, seen)) continue;
      const snapshot = snapshotEntry(ad, id, steps.get(deckId) ?? [], this.env.now());
      if (snapshot) snapshots.push(snapshot);
    }
    return {
      deckId: deckIds.get(source.deckId)!,
      snapshots,
      seen: reps,
      claimed,
      released,
      added,
      edited,
    };
  }
  private mergeAnkiNote(
    id: string,
    ad: AnkiDroidSource["notes"][number],
    noteTypeId: string,
    firstLink: boolean,
  ) {
    const values = ad.fields.split(SEPARATOR);
    let tags = ad.tags.split(" ").filter(Boolean);
    const note = this.state.notes.find((n) => n.id === id);
    if (!note) {
      const hlc = this.tick();
      this.state.notes.push({
        ...this.record({ noteTypeId, tags }, id, hlc),
        values: values.map((value) => ({ value, hlc })),
        anki: { id: ad.id, guid: ad.guid },
      });
      return "added";
    }
    // A first link takes AnkiDroid's mark, whatever the clocks say. After that mark is local to
    // this app, so an unmark here survives, even when AnkiDroid edits other tags.
    const adopted = firstLink && tags.includes("marked");
    const marked = note.fields.tags.value.includes("marked");
    tags = tags.filter((tag) => tag !== "marked");
    if (marked || adopted) tags.push("marked");
    // Per field, the newer of the local clock and AnkiDroid's mod time wins (ADR 0001).
    const mod = ad.mod * 1000;
    let changed = false;
    values.forEach((value, i) => {
      const local = note.values[i];
      if (local?.value !== value && (!local || mod > local.hlc.wallMs)) {
        note.values[i] = { value, hlc: this.tick() };
        changed = true;
      }
    });
    if (note.fields.tags.value.join(" ") !== tags.join(" ") && mod > note.fields.tags.hlc.wallMs) {
      note.fields.tags = { value: tags, hlc: this.tick() };
      changed = true;
    } else if (adopted && !marked) {
      note.fields.tags = { value: [...note.fields.tags.value, "marked"], hlc: this.tick() };
      changed = true;
    }
    return changed ? "edited" : undefined;
  }
  private remove(kind: RecordKind, id: string) {
    this.state.tombstones.push({ id, kind, sequence: 0, hlc: this.tick() });
    const records = this.state[kind];
    const index = records.findIndex((r) => r.id === id);
    if (index >= 0) records.splice(index, 1);
  }

  /**
   * Merges an Anki package. Ids come from Anki identities, so importing it again, here or on
   * another device, finds the same records; records this app exported keep their own ids. Each
   * property keeps the newer of its local clock and the Anki modification time. Deleted records
   * stay deleted. Returns the package's review log as entries to append; their ids are stable too,
   * so appending them again changes nothing. Entries `known` already holds under another id (this
   * app's own answers, exported and imported back) are left out.
   */
  importAnki(
    source: AnkiPackage,
    known: readonly LogEntry[] = [],
  ): { log: LogEntry[]; notes: number; cards: number } {
    const dead = new Set(this.state.tombstones.map((t) => `${t.kind}:${t.id}`));
    /** Inserts or updates by property; undefined when the record was deleted here. */
    const merge = <R extends Mergeable>(
      kind: RecordKind,
      records: R[],
      index: Map<string, R>,
      created: { id: string; values: ValuesOf<R>; mtime: number; rest: Omit<R, "id" | "fields"> },
    ): R | undefined => {
      const { id, values, mtime, rest } = created;
      if (dead.has(`${kind}:${id}`)) return undefined;
      const hlc = fromAnki(mtime);
      this.observe(hlc);
      const existing = index.get(id);
      if (!existing) {
        // `values` holds every property of R's fields and `rest` everything else.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const record = { ...this.record(values, id, hlc), ...rest } as unknown as R;
        records.push(record);
        index.set(id, record);
        return record;
      }
      const fields: Record<string, Field<unknown>> = existing.fields;
      for (const [key, value] of Object.entries(values)) {
        const field = fields[key];
        if (!field || (mtime > field.hlc.wallMs && !same(field.value, value)))
          fields[key] = { value, hlc };
      }
      if (rest.anki) existing.anki = rest.anki;
      return existing;
    };
    const index = {
      decks: byId(this.state.decks),
      presets: byId(this.state.presets),
      noteTypes: byId(this.state.noteTypes),
      notes: byId(this.state.notes),
      cards: byId(this.state.cards),
    };

    const usedDecks = new Set(source.cards.map((c) => c.deckId));
    const presets = new Map<number, string>();
    for (const p of source.presets) {
      if (!source.decks.some((d) => d.presetId === p.id && usedDecks.has(d.id))) continue;
      const { id, rest } = identity(p.appId, importId("preset", p.id, p.name), { id: p.id });
      const { name, newPerDay, reviewsPerDay, desiredRetention, learningSteps, mtime } = p;
      const weights = p.fsrsParameters?.length === 21 ? p.fsrsParameters : DEFAULT_FSRS_PARAMETERS;
      const values = {
        dontPlayAutomatically:
          p.dontPlayAutomatically ?? AUDIO_TIMER_DEFAULTS.dontPlayAutomatically,
        skipQuestionWhenReplayingAnswer:
          p.skipQuestionWhenReplayingAnswer ?? AUDIO_TIMER_DEFAULTS.skipQuestionWhenReplayingAnswer,
        maximumAnswerSeconds: p.maximumAnswerSeconds ?? AUDIO_TIMER_DEFAULTS.maximumAnswerSeconds,
        showTimer: p.showTimer ?? AUDIO_TIMER_DEFAULTS.showTimer,
        stopTimerOnAnswer: p.stopTimerOnAnswer ?? AUDIO_TIMER_DEFAULTS.stopTimerOnAnswer,
        name,
        newPerDay,
        reviewsPerDay,
        desiredRetention,
        learningSteps,
        buryNew: p.buryNew ?? false,
        buryReviews: p.buryReviews ?? false,
        buryLearning: p.buryLearning ?? false,
        relearningSteps: p.relearningSteps ?? [10],
        insertionOrder: p.insertionOrder ?? ("sequential" as const),
        leechThreshold: p.leechThreshold ?? 8,
        leechAction: p.leechAction ?? ("tagOnly" as const),
        maximumInterval: p.maximumInterval ?? 36500,
        fsrsParameters: [...weights],
        easyDays: p.easyDays ?? [...NORMAL_WEEK],
        ...(p.appId && p.isDefault !== undefined ? { isDefault: p.isDefault } : {}),
      };
      if (merge("presets", this.state.presets, index.presets, { id, values, mtime, rest }))
        presets.set(p.id, id);
    }
    const decks = new Map<number, string>();
    for (const d of source.decks) {
      if (!usedDecks.has(d.id)) continue;
      const { id, rest } = identity(d.appId, importId("deck", d.id, d.name), { id: d.id });
      const presetId = presets.get(d.presetId) ?? this.defaultPreset().id;
      const values = { name: d.name, presetId, desiredRetention: d.desiredRetention };
      if (merge("decks", this.state.decks, index.decks, { id, values, mtime: d.mtime, rest }))
        decks.set(d.id, id);
    }
    const types = new Map<number, string>();
    const usedTypes = new Set(source.notes.map((n) => n.noteTypeId));
    for (const t of source.noteTypes) {
      if (!usedTypes.has(t.id)) continue;
      const values = {
        name: t.name,
        kind: t.kind,
        fieldNames: t.fields.map((f) => f.name),
        templates: t.templates.map(({ name, front, back }) => ({ name, front, back })),
        css: t.css,
      };
      const { id, rest } = identity(t.appId, importId("noteType", t.id), {
        id: t.id,
        fieldIds: t.fields.map((f) => f.id),
        templateIds: t.templates.map((x) => x.id),
      });
      const merged = { id, values, mtime: t.mtime, rest };
      if (merge("noteTypes", this.state.noteTypes, index.noteTypes, merged)) types.set(t.id, id);
    }
    const cardsOf = new Map<number, AnkiPackage["cards"]>();
    for (const card of source.cards) {
      if (!decks.has(card.deckId)) continue;
      const own = cardsOf.get(card.noteId);
      if (own) own.push(card);
      else cardsOf.set(card.noteId, [card]);
    }
    const cards = new Map<number, string>();
    let noteCount = 0;
    for (const n of source.notes) {
      const own = cardsOf.get(n.id)?.sort((a, b) => a.ordinal - b.ordinal);
      const noteTypeId = types.get(n.noteTypeId);
      if (!own?.length || !noteTypeId) continue;
      const { id, rest: identified } = identity(n.appId, importId("note", n.guid), {
        id: n.id,
        guid: n.guid,
      });
      const values = { noteTypeId, tags: n.tags };
      const rest = { ...identified, values: [] };
      const note = merge("notes", this.state.notes, index.notes, {
        id,
        values,
        mtime: n.mtime,
        rest,
      });
      if (!note) continue;
      noteCount++;
      const hlc = fromAnki(n.mtime);
      n.fields.forEach((value, i) => {
        const field = note.values[i];
        if (!field || (n.mtime > field.hlc.wallMs && field.value !== value))
          note.values[i] = { value, hlc };
      });
      for (const c of own) {
        const cardValues = {
          noteId: id,
          deckId: decks.get(c.deckId)!,
          ordinal: c.ordinal,
          suspended: c.suspended,
          // Anki unburies at the first study day after the card's last change.
          buriedUntil: c.buried ? dueInDays(1, c.mtime) : null,
          flag: c.flag ?? 0,
        };
        const merged = {
          id: cardId(id, c.ordinal),
          values: cardValues,
          mtime: c.mtime,
          rest: n.appId ? {} : { anki: { id: c.id } },
        };
        const card = merge("cards", this.state.cards, index.cards, merged);
        if (card) cards.set(c.id, card.id);
      }
    }
    const log: LogEntry[] = [];
    const ours = unmatched(known);
    for (const r of source.revlog) {
      const card = cards.get(r.cardId);
      if (!card || ours.take(card, r)) continue;
      const base = { id: importId("review", `${r.cardId}:${r.id}`), cardId: card, at: r.at };
      if (r.kind === "review") {
        const record = index.cards.get(card)!;
        const deck = index.decks.get(record.fields.deckId.value)!;
        const preset = deckPreset(this.state, deck)!;
        log.push({
          ...base,
          kind: "review",
          grade: r.grade,
          durationMs: r.durationMs,
          origin: "import",
          options: schedulingOptions(preset, r.at),
        });
      } else if (r.kind === "reset") log.push({ ...base, kind: "reset" });
      else log.push({ ...base, kind: "setDueDate", due: dueAfter(r.at, r.interval) });
    }
    return { log, notes: noteCount, cards: cards.size };
  }
}

/** The app's own records come back under their own id and with no Anki identity. */
const identity = <T extends object>(appId: string | undefined, id: string, anki: T) =>
  appId ? { id: appId, rest: {} } : { id, rest: { anki } };
const sameEntry = (entry: LogEntry, row: AnkiPackage["revlog"][number]) => {
  if (entry.kind !== row.kind || row.at < entry.at || row.at - entry.at >= 1000) return false;
  if (entry.kind === "review") {
    const grade: number = entry.grade;
    return row.kind === "review" && row.grade === grade;
  }
  if (entry.kind === "setDueDate")
    return row.kind === "setDueDate" && dueAfter(row.at, row.interval) === entry.due;
  return true;
};
/**
 * Known entries an exported revlog row stands for, each taken once: same card, kind, grade or due,
 * and an answer time no more than a second earlier (export moves rows that share a millisecond).
 */
function unmatched(known: readonly LogEntry[]) {
  const byCard = new Map<string, LogEntry[]>();
  for (const entry of known) {
    const own = byCard.get(entry.cardId);
    if (own) own.push(entry);
    else byCard.set(entry.cardId, [entry]);
  }
  return {
    take(card: string, row: AnkiPackage["revlog"][number]) {
      const own = byCard.get(card) ?? [];
      const index = own.findIndex((entry) => sameEntry(entry, row));
      if (index >= 0) own.splice(index, 1);
      return index >= 0;
    },
  };
}

/**
 * Anki intervals are days when positive and seconds when negative. Days end at the study day; 0
 * is due today.
 */
function dueAfter(at: number, interval: number) {
  if (interval < 0) return at - interval * 1000;
  const due = new Date(studyDayStart(at));
  due.setDate(due.getDate() + interval);
  return due.getTime();
}
