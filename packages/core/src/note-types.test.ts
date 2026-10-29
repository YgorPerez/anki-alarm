/* oxlint-disable unicorn/no-array-sort -- ES2022 target; sorts fresh arrays. */
import { expect, test } from "vite-plus/test";
import {
  Collection,
  noteTypeEditOf,
  noteTypeImpact,
  noteTypeProblems,
  renderCard,
  type CollectionState,
  type NoteTypeEdit,
} from "./index.ts";

const environment = () => {
  let n = 0;
  let now = 1_700_000_000_000;
  return {
    deviceId: "web-a",
    now: () => now++,
    random: () => new Uint8Array(16).fill(n++),
  };
};
function vocabulary() {
  const c = new Collection(environment());
  const deck = c.createDeck("Japanese");
  const other = c.createDeck("Kanji");
  const basic = c.addBasicNote(deck.id, "seed", "");
  const typeId = basic.fields.noteTypeId.value;
  c.editNoteType(typeId, {
    name: "Vocabulary",
    fields: [{ name: "Word", from: 0 }, { name: "Meaning", from: 1 }, { name: "Reading" }],
    templates: [
      { name: "Recognition", front: "{{Word}}", back: "{{FrontSide}}<hr>{{Meaning}}", from: 0 },
    ],
    css: ".card { color: red }",
  });
  const note = c.addNote(deck.id, typeId, ["水", "water", "みず"]);
  return { c, deckId: deck.id, otherId: other.id, typeId, note, seed: basic };
}
const typeOf = (state: CollectionState, id: string) => state.noteTypes.find((t) => t.id === id)!;
const cardsOf = (state: CollectionState, noteId: string) =>
  state.cards
    .filter((c) => c.fields.noteId.value === noteId)
    .map((c) => [c.fields.ordinal.value, c.fields.deckId.value] as const)
    .sort((a, b) => a[0] - b[0]);

test("renaming, adding and reordering fields moves every note's values with them", () => {
  const { c, typeId, note, seed } = vocabulary();
  let state = c.snapshot();
  expect(typeOf(state, typeId).fields.fieldNames.value).toEqual(["Word", "Meaning", "Reading"]);
  // The seed note gained an empty Reading.
  expect(state.notes.find((n) => n.id === seed.id)!.values.map((v) => v.value)).toEqual([
    "seed",
    "",
    "",
  ]);
  const before = state.notes.find((n) => n.id === note.id)!;

  c.editNoteType(typeId, {
    ...noteTypeEditOf(typeOf(state, typeId)),
    fields: [
      { name: "Expression", from: 0 },
      { name: "Reading", from: 2 },
      { name: "Meaning", from: 1 },
    ],
  });
  state = c.snapshot();
  const type = typeOf(state, typeId);
  expect(type.fields.fieldNames.value).toEqual(["Expression", "Reading", "Meaning"]);
  const after = state.notes.find((n) => n.id === note.id)!;
  expect(after.values.map((v) => v.value)).toEqual(["水", "みず", "water"]);
  // Only the positions whose value changed take a new clock.
  expect(after.values[0]).toEqual(before.values[0]);
  expect(after.values[1]!.hlc.wallMs).toBeGreaterThan(before.values[1]!.hlc.wallMs);
  // Templates follow the rename.
  expect(type.fields.templates.value[0]!.front).toBe("{{Expression}}");
  const front = renderCard({ note: after, type, ordinal: 0, side: "front", dark: false });
  expect(front).toContain("水");
  expect(front).toContain(".card { color: red }");
});

test("renaming a field rewrites its references in every template syntax", () => {
  const { c, typeId } = vocabulary();
  const edit = noteTypeEditOf(typeOf(c.snapshot(), typeId));
  c.editNoteType(typeId, {
    ...edit,
    templates: [
      {
        ...edit.templates[0]!,
        front: "{{#Word}}{{Word}} {{text:Word}} {{ Word }}{{/Word}}{{^Word}}-{{/Word}}{{Wordy}}",
      },
    ],
  });
  c.editNoteType(typeId, {
    ...noteTypeEditOf(typeOf(c.snapshot(), typeId)),
    fields: [
      { name: "Term", from: 0 },
      { name: "Meaning", from: 1 },
      { name: "Reading", from: 2 },
    ],
  });
  expect(typeOf(c.snapshot(), typeId).fields.templates.value[0]!.front).toBe(
    "{{#Term}}{{Term}} {{text:Term}} {{ Term }}{{/Term}}{{^Term}}-{{/Term}}{{Wordy}}",
  );
});

test("a removed field drops its values; the preview of the impact counts them first", () => {
  const { c, typeId, note } = vocabulary();
  const edit: NoteTypeEdit = {
    ...noteTypeEditOf(typeOf(c.snapshot(), typeId)),
    fields: [
      { name: "Word", from: 0 },
      { name: "Reading", from: 2 },
    ],
  };
  // The seed note has no Meaning; only the vocabulary note loses one.
  expect(noteTypeImpact(c.snapshot(), typeId, edit)).toEqual({
    notes: 2,
    valuesLost: 1,
    cardsAdded: 0,
    cardsRemoved: 0,
  });
  c.editNoteType(typeId, edit);
  const after = c.snapshot().notes.find((n) => n.id === note.id)!;
  expect(after.values.map((v) => v.value)).toEqual(["水", "みず"]);
});

test("a new template adds a card to every note, in the deck of its other cards", () => {
  const { c, typeId, note, otherId } = vocabulary();
  const card = c.snapshot().cards.find((x) => x.fields.noteId.value === note.id)!;
  c.moveCards([card.id], otherId);
  const edit = noteTypeEditOf(typeOf(c.snapshot(), typeId));
  const added: NoteTypeEdit = {
    ...edit,
    templates: [
      ...edit.templates,
      { name: "Production", front: "{{Meaning}}", back: "{{FrontSide}}<hr>{{Word}}" },
    ],
  };
  expect(noteTypeImpact(c.snapshot(), typeId, added)).toMatchObject({
    cardsAdded: 2,
    cardsRemoved: 0,
  });
  c.editNoteType(typeId, added);
  let state = c.snapshot();
  expect(cardsOf(state, note.id)).toEqual([
    [0, otherId],
    [1, otherId],
  ]);
  const production = state.cards.find(
    (x) => x.fields.noteId.value === note.id && x.fields.ordinal.value === 1,
  )!;
  expect(
    renderCard({ note, type: typeOf(state, typeId), ordinal: 1, side: "front", dark: false }),
  ).toContain("water");

  // Removing the first template removes its cards; the second becomes ordinal 0, same card.
  const removal: NoteTypeEdit = {
    ...noteTypeEditOf(typeOf(state, typeId)),
    templates: [{ ...noteTypeEditOf(typeOf(state, typeId)).templates[1]!, from: 1 }],
  };
  expect(noteTypeImpact(state, typeId, removal)).toMatchObject({ cardsRemoved: 2 });
  c.editNoteType(typeId, removal);
  state = c.snapshot();
  const left = state.cards.filter((x) => x.fields.noteId.value === note.id);
  expect(left.map((x) => [x.id, x.fields.ordinal.value])).toEqual([[production.id, 0]]);
  expect(state.tombstones.some((t) => t.kind === "cards" && t.id === card.id)).toBe(true);

  // Adding a template again doesn't reuse the deleted card's id.
  c.editNoteType(typeId, {
    ...noteTypeEditOf(typeOf(state, typeId)),
    templates: [
      ...noteTypeEditOf(typeOf(state, typeId)).templates,
      { name: "Again", front: "{{Word}}", back: "" },
    ],
  });
  state = c.snapshot();
  const ids = state.cards.filter((x) => x.fields.noteId.value === note.id).map((x) => x.id);
  expect(ids).toHaveLength(2);
  expect(ids).not.toContain(card.id);
  expect(new Set(state.cards.map((x) => x.id)).size).toBe(state.cards.length);
});

test("Anki's field and template ids follow their fields and templates", () => {
  const { c, typeId } = vocabulary();
  const state = c.snapshot();
  const type = typeOf(state, typeId);
  type.anki = { id: 7, fieldIds: ["11", "12", "13"], templateIds: ["21"] };
  const imported = new Collection(environment(), state);
  imported.editNoteType(typeId, {
    ...noteTypeEditOf(type),
    fields: [{ name: "Reading", from: 2 }, { name: "New" }, { name: "Word", from: 0 }],
    templates: [
      { name: "Extra", front: "{{Word}}", back: "" },
      { ...noteTypeEditOf(type).templates[0]!, from: 0 },
    ],
  });
  expect(typeOf(imported.snapshot(), typeId).anki).toEqual({
    id: 7,
    fieldIds: ["13", "", "11"],
    templateIds: ["", "21"],
  });
});

test("an edit Core can't apply is refused whole, with the problems a form can show", () => {
  const { c, typeId } = vocabulary();
  const before = c.snapshot();
  const type = typeOf(before, typeId);
  const edit = noteTypeEditOf(type);
  const cases: [NoteTypeEdit, string[]][] = [
    [{ ...edit, name: " " }, ["name"]],
    [{ ...edit, fields: [] }, ["noFields"]],
    [{ ...edit, fields: [{ name: "Word", from: 0 }, { name: "word" }] }, ["duplicateField"]],
    [{ ...edit, fields: [{ name: "A:B", from: 0 }] }, ["fieldName"]],
    [{ ...edit, fields: [{ name: "#Tag", from: 0 }] }, ["fieldName"]],
    [
      {
        ...edit,
        fields: [
          { name: "Word", from: 0 },
          { name: "Again", from: 0 },
        ],
      },
      ["source"],
    ],
    [{ ...edit, fields: [{ name: "Word", from: 9 }] }, ["source"]],
    [{ ...edit, templates: [] }, ["noTemplates"]],
    [{ ...edit, templates: [{ name: "", front: "{{Word}}", back: "" }] }, ["templateName"]],
    [{ ...edit, templates: [{ name: "Card", front: " ", back: "" }] }, ["front"]],
    [
      {
        ...edit,
        templates: [
          { name: "Card", front: "{{Word}}", back: "" },
          { name: "card", front: "{{Word}}", back: "" },
        ],
      },
      ["templateName"],
    ],
  ];
  for (const [bad, problems] of cases) {
    expect(noteTypeProblems(type, bad).map((p) => p.problem)).toEqual(problems);
    expect(() => c.editNoteType(typeId, bad)).toThrow("Invalid note type");
  }
  expect(() => c.editNoteType("missing", edit)).toThrow("Invalid note type");
  const asCloze = {
    ...type,
    fields: { ...type.fields, kind: { ...type.fields.kind, value: "cloze" as const } },
  };
  expect(
    noteTypeProblems(asCloze, { ...edit, templates: [...edit.templates, ...edit.templates] }),
  ).toContainEqual({ problem: "clozeTemplates" });
  expect(c.snapshot()).toEqual(before);
});

test("an edit that changes nothing stamps nothing", () => {
  const { c, typeId } = vocabulary();
  const before = c.snapshot();
  c.editNoteType(typeId, noteTypeEditOf(typeOf(before, typeId)));
  expect(c.snapshot()).toEqual(before);
});

function cloze() {
  const c = new Collection(environment());
  const deck = c.createDeck("Geo");
  c.addBasicNote(deck.id, "seed", "");
  const basic = c.snapshot().noteTypes[0]!;
  const type = structuredClone(basic);
  type.id = "018bcfe5-6800-7fff-bfff-0000000000c1";
  type.fields.name.value = "Cloze";
  type.fields.kind.value = "cloze";
  type.fields.fieldNames.value = ["Text", "Back Extra"];
  type.fields.templates.value = [
    { name: "Cloze", front: "{{cloze:Text}}", back: "{{cloze:Text}}" },
  ];
  const state = c.snapshot();
  return {
    c: new Collection(environment(), { ...state, noteTypes: [...state.noteTypes, type] }),
    deckId: deck.id,
    typeId: type.id,
  };
}

test("editing a cloze note adds a card for each new cloze number and keeps the others", () => {
  const { c, deckId, typeId } = cloze();
  const note = c.addNote(deckId, typeId, ["{{c1::Paris}} is in France", ""]);
  expect(cardsOf(c.snapshot(), note.id)).toEqual([[0, deckId]]);
  c.editNote(note.id, ["{{c1::Paris}} is in {{c3::France}}", ""]);
  expect(cardsOf(c.snapshot(), note.id)).toEqual([
    [0, deckId],
    [2, deckId],
  ]);
  // A cloze taken out leaves its card, as in Anki (an empty card).
  c.editNote(note.id, ["Paris is in {{c3::France}}", ""]);
  expect(cardsOf(c.snapshot(), note.id)).toEqual([
    [0, deckId],
    [2, deckId],
  ]);
  // A cloze type keeps its one template; its fields can still change.
  const type = typeOf(c.snapshot(), typeId);
  expect(noteTypeImpact(c.snapshot(), typeId, noteTypeEditOf(type))).toEqual({
    notes: 1,
    valuesLost: 0,
    cardsAdded: 0,
    cardsRemoved: 0,
  });
  c.editNoteType(typeId, {
    ...noteTypeEditOf(type),
    fields: [{ name: "Text", from: 0 }, { name: "Extra", from: 1 }, { name: "Source" }],
  });
  expect(c.snapshot().notes.find((n) => n.id === note.id)!.values).toHaveLength(3);
});

test("deleting notes deletes their cards", () => {
  const { c, note, seed, deckId } = vocabulary();
  c.deleteNotes([note.id]);
  const state = c.snapshot();
  expect(state.notes.map((n) => n.id)).toEqual([seed.id]);
  expect(state.cards.every((x) => x.fields.noteId.value === seed.id)).toBe(true);
  expect(state.tombstones.filter((t) => t.kind === "notes").map((t) => t.id)).toEqual([note.id]);
  expect(state.decks.some((d) => d.id === deckId)).toBe(true);
  expect(() => c.deleteNotes(["missing"])).toThrow("Invalid note");
});
