/* oxlint-disable unicorn/no-array-sort -- ES2022/Hermes target; only fresh arrays are sorted. */
import type { AnkiPackage } from "./apkg.ts";
import { cardId, importId, uuid7 } from "./ids.ts";
import { studyDayStart, type LogEntry } from "./study.ts";

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
}> &
  AnkiIdentity;
export type Preset = RecordFields<{
  name: string;
  newPerDay: number;
  reviewsPerDay: number;
  desiredRetention: number;
  learningSteps: number[];
}> &
  AnkiIdentity;
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
  AnkiIdentity<{ fieldIds: string[]; templateIds: string[] }>;
/** `values` follow the note type's `fieldNames`, each with its own clock. */
export type Note = RecordFields<{ deckId: string; noteTypeId: string; tags: string[] }> & {
  values: Field<string>[];
} & AnkiIdentity<{ guid: string }>;
export type Card = RecordFields<{
  noteId: string;
  deckId: string;
  ordinal: number;
  suspended: boolean;
}> &
  AnkiIdentity;
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
const KINDS = ["decks", "presets", "noteTypes", "notes", "cards"] as const;
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
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Brings records stored by earlier versions to the current shape: Basic notes kept `front` and
 * `back` as properties and note types had one front and back template. Safe on current records.
 */
export function upgradeCollection(state: CollectionState): CollectionState {
  for (const deck of state.decks)
    deck.fields.desiredRetention ??= { value: null, hlc: deck.fields.name.hlc };
  for (const card of state.cards)
    card.fields.suspended ??= { value: false, hlc: card.fields.ordinal.hlc };
  for (const type of state.noteTypes) {
    const old = legacy(type.fields);
    if (!old.frontTemplate) continue;
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
    if (!old.front) continue;
    note.values = [old.front, old.back ?? { value: "", hlc: old.front.hlc }];
    note.fields.tags = { value: [], hlc: old.front.hlc };
    delete old.front;
    delete old.back;
  }
  return state;
}
interface Legacy {
  frontTemplate?: Field<string>;
  backTemplate?: Field<string>;
  front?: Field<string>;
  back?: Field<string>;
}
// Records stored before #49 had these string properties; current ones have none of them.
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
    this.state = upgradeCollection(copy(state));
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
  snapshot(): CollectionState {
    return copy(this.state);
  }
  /** The app's own preset, made on first use. */
  private defaultPreset(): Preset {
    let preset = this.state.presets.find((p) => !p.anki);
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
    return preset;
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
  addBasicNote(deckId: string, front: string, back: string): Note {
    if (!this.state.decks.some((d) => d.id === deckId) || !front.trim())
      throw new Error("Invalid note");
    let type = this.state.noteTypes.find((t) => !t.anki);
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
    const hlc = this.tick();
    const note: Note = {
      ...this.record({ deckId, noteTypeId: type.id, tags: [] as string[] }, undefined, hlc),
      values: [front, back].map((value) => ({ value, hlc })),
    };
    this.state.notes.push(note);
    this.state.cards.push(
      this.record({ noteId: note.id, deckId, ordinal: 0, suspended: false }, cardId(note.id, 0)),
    );
    return copy(note);
  }
  editBasicNote(id: string, front: string, back: string) {
    const note = this.state.notes.find((n) => n.id === id);
    if (!note || !front.trim()) throw new Error("Invalid note");
    [front, back].forEach((value, i) => {
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
  private remove(kind: RecordKind, id: string) {
    this.state.tombstones.push({ id, kind, sequence: 0, hlc: this.tick() });
    const records = this.state[kind];
    const index = records.findIndex((r) => r.id === id);
    if (index >= 0) records.splice(index, 1);
  }

  /**
   * Merges an Anki package. Ids come from Anki identities, so importing it again, here or on
   * another device, finds the same records. Each property keeps the newer of its local clock and
   * the Anki modification time. Deleted records stay deleted. Returns the package's review log as
   * entries to append; their ids are stable too, so appending them again changes nothing.
   */
  importAnki(source: AnkiPackage): { log: LogEntry[]; notes: number; cards: number } {
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
      const id = importId("preset", p.id === 1 ? `name:${p.name}` : String(p.id));
      const { id: ankiId, mtime, ...values } = p;
      const rest = { anki: { id: ankiId } };
      if (merge("presets", this.state.presets, index.presets, { id, values, mtime, rest }))
        presets.set(p.id, id);
    }
    const decks = new Map<number, string>();
    for (const d of source.decks) {
      if (!usedDecks.has(d.id)) continue;
      const id = importId("deck", d.id === 1 ? `name:${d.name}` : String(d.id));
      const presetId = presets.get(d.presetId) ?? this.defaultPreset().id;
      const values = { name: d.name, presetId, desiredRetention: d.desiredRetention };
      const rest = { anki: { id: d.id } };
      if (merge("decks", this.state.decks, index.decks, { id, values, mtime: d.mtime, rest }))
        decks.set(d.id, id);
    }
    const types = new Map<number, string>();
    const usedTypes = new Set(source.notes.map((n) => n.noteTypeId));
    for (const t of source.noteTypes) {
      if (!usedTypes.has(t.id)) continue;
      const id = importId("noteType", String(t.id));
      const values = {
        name: t.name,
        kind: t.kind,
        fieldNames: t.fields.map((f) => f.name),
        templates: t.templates.map(({ name, front, back }) => ({ name, front, back })),
        css: t.css,
      };
      const anki = {
        id: t.id,
        fieldIds: t.fields.map((f) => f.id),
        templateIds: t.templates.map((x) => x.id),
      };
      const merged = { id, values, mtime: t.mtime, rest: { anki } };
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
      const id = importId("note", n.guid);
      const values = { deckId: decks.get(own[0]!.deckId)!, noteTypeId, tags: n.tags };
      const rest = { anki: { id: n.id, guid: n.guid }, values: [] };
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
        };
        const merged = {
          id: cardId(id, c.ordinal),
          values: cardValues,
          mtime: c.mtime,
          rest: { anki: { id: c.id } },
        };
        const card = merge("cards", this.state.cards, index.cards, merged);
        if (card) cards.set(c.id, card.id);
      }
    }
    const log: LogEntry[] = [];
    for (const r of source.revlog) {
      const card = cards.get(r.cardId);
      if (!card) continue;
      const base = { id: importId("review", `${r.cardId}:${r.id}`), cardId: card, at: r.at };
      if (r.kind === "review")
        log.push({
          ...base,
          kind: "review",
          grade: r.grade,
          durationMs: r.durationMs,
          origin: "import",
        });
      else if (r.kind === "reset") log.push({ ...base, kind: "reset" });
      else log.push({ ...base, kind: "setDueDate", due: dueAfter(r.at, r.interval) });
    }
    return { log, notes: noteCount, cards: cards.size };
  }
}

/** Anki intervals are days when positive and seconds when negative. Days end at the study day. */
function dueAfter(at: number, interval: number) {
  if (interval < 0) return at - interval * 1000;
  if (interval === 0) return at;
  const due = new Date(studyDayStart(at));
  due.setDate(due.getDate() + interval);
  return due.getTime();
}
