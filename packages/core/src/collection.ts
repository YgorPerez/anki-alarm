import { cardId, uuid7 } from "./ids.ts";

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
  learningSteps: number[];
}>;
export type NoteType = RecordFields<{
  name: string;
  fieldNames: string[];
  frontTemplate: string;
  backTemplate: string;
  css: string;
}>;
export type Note = RecordFields<{
  deckId: string;
  noteTypeId: string;
  front: string;
  back: string;
}>;
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
const empty = (): CollectionState => ({
  decks: [],
  presets: [],
  noteTypes: [],
  notes: [],
  cards: [],
  tombstones: [],
});
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
  addBasicNote(deckId: string, front: string, back: string): Note {
    if (!this.state.decks.some((d) => d.id === deckId) || !front.trim())
      throw new Error("Invalid note");
    let type = this.state.noteTypes[0];
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
    const note = this.record({ deckId, noteTypeId: type.id, front, back });
    this.state.notes.push(note);
    this.state.cards.push(this.record({ noteId: note.id, deckId, ordinal: 0 }, cardId(note.id, 0)));
    return copy(note);
  }
  editBasicNote(id: string, front: string, back: string) {
    const note = this.state.notes.find((n) => n.id === id);
    if (!note || !front.trim()) throw new Error("Invalid note");
    for (const key of ["front", "back"] as const) {
      const value = key === "front" ? front : back;
      if (note.fields[key].value !== value) note.fields[key] = { value, hlc: this.tick() };
    }
  }
  deleteDeck(id: string) {
    if (!this.state.decks.some((d) => d.id === id)) return;
    for (const card of this.state.cards.filter((c) => c.fields.deckId.value === id))
      this.remove("cards", card.id);
    for (const note of this.state.notes.filter((n) => n.fields.deckId.value === id))
      this.remove("notes", note.id);
    this.remove("decks", id);
  }
  private remove(kind: RecordKind, id: string) {
    this.state.tombstones.push({ id, kind, sequence: 0, hlc: this.tick() });
    const records = this.state[kind];
    const index = records.findIndex((r) => r.id === id);
    if (index >= 0) records.splice(index, 1);
  }
}
