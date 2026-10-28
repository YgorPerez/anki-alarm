import { default_w } from "ts-fsrs";
import { cardId, uuid7 } from "./ids.ts";

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
export type Deck = RecordFields<{ name: string; presetId: string }>;
export type Preset = RecordFields<{
  name: string;
  newPerDay: number;
  reviewsPerDay: number;
  desiredRetention: number;
  /** Minutes. */
  learningSteps: number[];
  /** FSRS-6's 21 weights. */
  fsrsParameters: number[];
}>;
export type PresetOptions = {
  [K in keyof Preset["fields"]]: Preset["fields"][K]["value"];
};
const presetKeys = [
  "name",
  "newPerDay",
  "reviewsPerDay",
  "desiredRetention",
  "learningSteps",
  "fsrsParameters",
] as const satisfies readonly (keyof PresetOptions)[];
/** The rule `updatePreset` applies to each option, for forms to check as the user types. */
export const validOption: { [K in keyof PresetOptions]: (value: PresetOptions[K]) => boolean } = {
  name: (v) => typeof v === "string" && Boolean(v.trim()),
  newPerDay: (v) => Number.isSafeInteger(v) && v >= 0 && v <= 9999,
  reviewsPerDay: (v) => Number.isSafeInteger(v) && v >= 0 && v <= 9999,
  desiredRetention: (v) => Number.isFinite(v) && v >= 0.7 && v <= 0.99,
  learningSteps: (v) =>
    Array.isArray(v) && v.length <= 20 && v.every((n) => Number.isFinite(n) && n > 0),
  fsrsParameters: (v) => Array.isArray(v) && v.length === 21 && v.every(Number.isFinite),
};
export type NoteType = RecordFields<{
  name: string;
  fieldNames: string[];
  frontTemplate: string;
  backTemplate: string;
  css: string;
}>;
/** `values` follow the note type's `fieldNames` by position, each with its own clock. */
export type Note = RecordFields<{ noteTypeId: string }> & { values: Field<string>[] };
export type Card = RecordFields<{ noteId: string; deckId: string; ordinal: number }>;
export type RecordKind = "decks" | "presets" | "noteTypes" | "notes" | "cards";
export interface Tombstone {
  id: string;
  kind: RecordKind;
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
const fits = (type: NoteType, values: readonly string[]) =>
  values.length === type.fields.fieldNames.value.length && Boolean(values[0]?.trim());
const empty = (): CollectionState => ({
  decks: [],
  presets: [],
  noteTypes: [],
  notes: [],
  cards: [],
  tombstones: [],
});
/** A note as saved before `values`: Basic's two fields, and a deck the cards now own. */
type LegacyNote = {
  id: string;
  fields: { [K in "deckId" | "noteTypeId" | "front" | "back"]: Field<string> };
  values?: undefined;
};
type LegacyPreset = Omit<Preset, "fields"> & {
  fields: Omit<Preset["fields"], "fsrsParameters"> &
    Partial<Pick<Preset["fields"], "fsrsParameters">>;
};
/** Records as SQLite may hold them, from any earlier version. */
export type StoredCollection = Omit<CollectionState, "notes" | "presets"> & {
  notes: (Note | LegacyNote)[];
  presets: (Preset | LegacyPreset)[];
};
/**
 * Reads stored records in the current shape. Notes saved before `values` (Basic's `front` and
 * `back`, and a `deckId` the cards now own) and presets saved before `fsrsParameters` are upgraded
 * with their own clocks, so the upgrade itself is not an edit.
 */
export function parseCollection(stored: StoredCollection): CollectionState {
  const { notes, presets, ...rest } = copy(stored);
  return {
    ...rest,
    notes: notes.map((note) => {
      if (note.values) return note;
      const { noteTypeId, front, back } = note.fields;
      return { id: note.id, fields: { noteTypeId }, values: [front, back] };
    }),
    presets: presets.map((preset) =>
      Object.assign(preset, {
        fields: Object.assign(preset.fields, {
          fsrsParameters: preset.fields.fsrsParameters ?? {
            value: [...DEFAULT_FSRS_PARAMETERS],
            hlc: preset.fields.name.hlc,
          },
        }),
      }),
    ),
  };
}
// JSON-only domain records; serialization preserves this type.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Offline commands. Persist each resulting snapshot in one transaction before showing it. */
export class Collection {
  private state: CollectionState;
  private lastWall = 0;
  private counter = 0;
  private readonly env: CollectionEnvironment;
  constructor(env: CollectionEnvironment, state: CollectionState = empty()) {
    this.env = env;
    this.state = copy(state);
    // Resume the clock after a restart, including when the wall clock moved backwards.
    for (const kind of ["decks", "presets", "noteTypes", "notes", "cards"] as const) {
      for (const record of this.state[kind]) {
        for (const field of Object.values(record.fields)) this.observe(field.hlc);
        if ("values" in record) for (const field of record.values) this.observe(field.hlc);
      }
      const records = this.state[kind];
      for (let i = records.length - 1; i >= 0; i--) {
        if (this.deleted(kind, records[i]!.id)) records.splice(i, 1);
      }
    }
    for (const tombstone of this.state.tombstones) this.observe(tombstone.hlc);
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
  ): RecordFields<T> {
    const hlc = this.tick();
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
  createDeck(name: string): Deck {
    if (!name.trim()) throw new Error("Deck name is required");
    let preset = this.state.presets[0];
    if (!preset) {
      preset = this.record({
        name: "Default",
        newPerDay: 20,
        reviewsPerDay: 200,
        desiredRetention: 0.9,
        learningSteps: [1, 10],
        fsrsParameters: [...DEFAULT_FSRS_PARAMETERS],
      });
      this.state.presets.push(preset);
    }
    const deck = this.record({ name: name.trim(), presetId: preset.id });
    this.state.decks.push(deck);
    return copy(deck);
  }
  renameDeck(id: string, name: string) {
    const deck = this.state.decks.find((d) => d.id === id);
    if (!deck || !name.trim()) throw new Error("Invalid deck");
    if (deck.fields.name.value !== name.trim())
      deck.fields.name = { value: name.trim(), hlc: this.tick() };
  }
  /** Adds a note to Basic, the app's own note type, creating it on first use. */
  addBasicNote(deckId: string, front: string, back: string): Note {
    if (!this.state.decks.some((d) => d.id === deckId) || !front.trim())
      throw new Error("Invalid note");
    return this.addNote(deckId, this.basicType().id, [front, back]);
  }
  private basicType(): NoteType {
    let type = this.state.noteTypes.find(
      (t) => t.fields.name.value === "Basic" && t.fields.fieldNames.value.length === 2,
    );
    if (!type) {
      type = this.record({
        name: "Basic",
        fieldNames: ["Front", "Back"],
        frontTemplate: "{{Front}}",
        backTemplate: '{{FrontSide}}<hr id="answer">{{Back}}',
        css: "",
      });
      this.state.noteTypes.push(type);
    }
    return type;
  }
  addNote(deckId: string, noteTypeId: string, values: readonly string[]): Note {
    const type = this.state.noteTypes.find((t) => t.id === noteTypeId);
    if (!this.state.decks.some((d) => d.id === deckId) || !type || !fits(type, values))
      throw new Error("Invalid note");
    const record = this.record({ noteTypeId });
    const hlc = record.fields.noteTypeId.hlc;
    const note: Note = { ...record, values: values.map((value) => ({ value, hlc })) };
    this.state.notes.push(note);
    this.state.cards.push(this.record({ noteId: note.id, deckId, ordinal: 0 }, cardId(note.id, 0)));
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
  moveCards(cardIds: readonly string[], deckId: string) {
    if (!this.state.decks.some((d) => d.id === deckId)) throw new Error("Invalid deck");
    const cards = this.state.cards.filter((c) => cardIds.includes(c.id));
    if (cards.length !== new Set(cardIds).size) throw new Error("Invalid card");
    for (const card of cards)
      if (card.fields.deckId.value !== deckId)
        card.fields.deckId = { value: deckId, hlc: this.tick() };
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
  private remove(kind: RecordKind, id: string) {
    this.state.tombstones.push({ id, kind, sequence: 0, hlc: this.tick() });
    const records = this.state[kind];
    const index = records.findIndex((r) => r.id === id);
    if (index >= 0) records.splice(index, 1);
  }
}
