import {
  ankiDroidSnapshot,
  linkedAnkiDroidDecks,
  presetFromOptions,
  type AnkiDroidCard,
  type AnkiDroidSource,
} from "./ankidroid.ts";
import { cardId, importId, uuid7 } from "./ids.ts";
import type { LogEntry } from "./study.ts";

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
/** A linked deck (from AnkiDroid) names the phone that linked it in `linkedBy`. */
export type Deck = RecordFields<{ name: string; presetId: string; linkedBy?: string }> & {
  anki?: { deckId: number };
};
export type Preset = RecordFields<{
  name: string;
  newPerDay: number;
  reviewsPerDay: number;
  desiredRetention: number;
  learningSteps: number[];
}>;
export interface CardTemplate {
  name: string;
  front: string;
  back: string;
}
export type NoteType = RecordFields<{
  name: string;
  fieldNames: string[];
  templates: CardTemplate[];
  css: string;
  /** One card per cloze number, all from the first template. */
  cloze: boolean;
}> & { anki?: { noteTypeId: number } };
/** `values` holds one entry per note type field, each with its own clock. */
export type Note = RecordFields<{ deckId: string; noteTypeId: string; tags: string[] }> & {
  values: Field<string>[];
  anki?: { noteId: number; guid: string };
};
export type Card = RecordFields<{ noteId: string; deckId: string; ordinal: number }> & {
  anki?: { cardId: number };
};
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
/** Anki joins field names and values with the unit separator. */
const SEPARATOR = "\u001f";
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
        upgrade(record);
        for (const field of clocked(record)) this.observe(field.hlc);
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
        templates: [
          { name: "Card 1", front: "{{Front}}", back: '{{FrontSide}}<hr id="answer">{{Back}}' },
        ],
        css: "",
        cloze: false,
      });
      this.state.noteTypes.push(type);
    }
    const hlc = this.tick();
    const note: Note = {
      ...this.record({ deckId, noteTypeId: type.id, tags: [] as string[] }),
      values: [front, back].map((value) => ({ value, hlc })),
    };
    this.state.notes.push(note);
    this.state.cards.push(this.record({ noteId: note.id, deckId, ordinal: 0 }, cardId(note.id, 0)));
    return copy(note);
  }
  /** Sets the leading field values; fields past `values` keep theirs. */
  editNote(id: string, values: readonly string[]) {
    const note = this.state.notes.find((n) => n.id === id);
    if (!note || !values[0]?.trim()) throw new Error("Invalid note");
    values.forEach((value, i) => {
      if (note.values[i]?.value !== value) note.values[i] = { value, hlc: this.tick() };
    });
  }
  deleteDeck(id: string) {
    if (!this.state.decks.some((d) => d.id === id)) return;
    for (const card of this.state.cards.filter((c) => c.fields.deckId.value === id))
      this.remove("cards", card.id);
    for (const note of this.state.notes.filter((n) => n.fields.deckId.value === id))
      this.remove("notes", note.id);
    this.remove("decks", id);
  }
  /**
   * Imports an AnkiDroid deck with its subdecks as linked decks owned by this phone (ADR 0001).
   * Records take ids from their Anki identities, so linking again updates instead of duplicating:
   * a note field takes AnkiDroid's value when the note's mod time is newer than the field's clock.
   * Reviewed cards come with a snapshot of AnkiDroid's state to append to the review log.
   */
  linkAnkiDroid(source: AnkiDroidSource): { deckId: string; snapshots: LogEntry[] } {
    const decks = linkedAnkiDroidDecks(source);
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
        this.state.presets.push(this.record(options, presetId));
      const deck = this.state.decks.find((d) => d.id === id);
      if (!deck)
        this.state.decks.push({
          ...this.record({ name: ad.name, presetId, linkedBy: this.env.deviceId }, id),
          anki: { deckId: ad.id },
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
            fieldNames: ad.fieldNames.split(SEPARATOR),
            templates,
            css: ad.css,
            cloze: ad.cloze,
          },
          id,
        ),
        anki: { noteTypeId: ad.id },
      });
    }
    const homeDeck = (c: AnkiDroidCard) => deckIds.get(c.originalDeckId || c.deckId);
    const noteIds = new Map<number, string>();
    for (const ad of source.notes) {
      const id = importId("note", ad.guid);
      const noteTypeId = typeIds.get(ad.noteTypeId);
      const first = source.cards
        .filter((c) => c.noteId === ad.id && homeDeck(c))
        .reduce<AnkiDroidCard | undefined>(
          (low, c) => (low && low.ord <= c.ord ? low : c),
          undefined,
        );
      if (!noteTypeId || !first || this.deleted("notes", id)) continue;
      noteIds.set(ad.id, id);
      this.mergeAnkiNote(id, ad, noteTypeId, homeDeck(first)!);
    }
    const snapshots: LogEntry[] = [];
    for (const ad of source.cards) {
      const noteId = noteIds.get(ad.noteId);
      const deckId = homeDeck(ad);
      if (!noteId || !deckId) continue;
      const id = cardId(noteId, ad.ord);
      if (this.deleted("cards", id)) continue;
      if (!this.state.cards.some((c) => c.id === id))
        this.state.cards.push({
          ...this.record({ noteId, deckId, ordinal: ad.ord }, id),
          anki: { cardId: ad.id },
        });
      const snapshot = ankiDroidSnapshot(ad, steps.get(deckId) ?? [], this.env.now());
      if (snapshot)
        snapshots.push({
          kind: "snapshot",
          id: importId("snapshot", `${ad.id}:${ad.reps}`),
          cardId: id,
          ...snapshot,
        });
    }
    return { deckId: deckIds.get(source.deckId)!, snapshots };
  }
  private mergeAnkiNote(
    id: string,
    ad: AnkiDroidSource["notes"][number],
    noteTypeId: string,
    deckId: string,
  ) {
    const values = ad.fields.split(SEPARATOR);
    const tags = ad.tags.split(" ").filter(Boolean);
    const note = this.state.notes.find((n) => n.id === id);
    if (!note) {
      const hlc = this.tick();
      this.state.notes.push({
        ...this.record({ deckId, noteTypeId, tags }, id),
        values: values.map((value) => ({ value, hlc })),
        anki: { noteId: ad.id, guid: ad.guid },
      });
      return;
    }
    // Per field, the newer of the local clock and AnkiDroid's mod time wins (ADR 0001).
    const mod = ad.mod * 1000;
    values.forEach((value, i) => {
      const local = note.values[i];
      if (local?.value !== value && (!local || mod > local.hlc.wallMs))
        note.values[i] = { value, hlc: this.tick() };
    });
    if (note.fields.tags.value.join(" ") !== tags.join(" ") && mod > note.fields.tags.hlc.wallMs)
      note.fields.tags = { value: tags, hlc: this.tick() };
  }
  private remove(kind: RecordKind, id: string) {
    this.state.tombstones.push({ id, kind, sequence: 0, hlc: this.tick() });
    const records = this.state[kind];
    const index = records.findIndex((r) => r.id === id);
    if (index >= 0) records.splice(index, 1);
  }
}

/** Every clocked property of a record: its fields and, for notes, each field value. */
function clocked(record: { fields: object; values?: Field<string>[] }): Field<unknown>[] {
  // Each property of `fields` is a Field<T>.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return [...(Object.values(record.fields) as Field<unknown>[]), ...(record.values ?? [])];
}

/** Basic records written before imported note types existed (#38) take the current shape. */
function upgrade(record: { fields: Record<string, Field<unknown> | undefined>; values?: unknown }) {
  const f = record.fields;
  if (f["front"] && f["back"] && !record.values) {
    record.values = [f["front"], f["back"]];
    f["tags"] = { value: [], hlc: f["front"].hlc };
    delete f["front"];
    delete f["back"];
  }
  if (f["frontTemplate"] && f["backTemplate"] && !f["templates"]) {
    f["templates"] = {
      value: [{ name: "Card 1", front: f["frontTemplate"].value, back: f["backTemplate"].value }],
      hlc: f["frontTemplate"].hlc,
    };
    f["cloze"] = { value: false, hlc: f["frontTemplate"].hlc };
    delete f["frontTemplate"];
    delete f["backTemplate"];
  }
}
