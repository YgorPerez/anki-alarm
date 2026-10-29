import { expect, test } from "vite-plus/test";
import { browseCards, Collection, runCommand } from "./index.ts";

const environment = () => {
  let n = 0;
  let now = 1_700_000_000_000;
  return { deviceId: "web-a", now: () => now++, random: () => new Uint8Array(16).fill(n++) };
};
function collection() {
  const c = new Collection(environment());
  const pt = c.createDeck("Português");
  const verbs = c.createDeck("Português::Verbos");
  const geo = c.createDeck("Geografia");
  c.addBasicNote(pt.id, "<b>Maçã</b>", "apple");
  c.addBasicNote(verbs.id, "correr", "to run");
  c.addBasicNote(geo.id, "Capital da França", "Paris &amp; arredores");
  const typeId = c.snapshot().noteTypes[0]!.id;
  c.editNoteType(typeId, {
    name: "Basic",
    fields: [
      { name: "Front", from: 0 },
      { name: "Back", from: 1 },
    ],
    templates: [
      { name: "Card 1", front: "{{Front}}", back: "{{Back}}", from: 0 },
      { name: "Reverse", front: "{{Back}}", back: "{{Front}}" },
    ],
    css: "",
  });
  return c.snapshot();
}
const fronts = (rows: { question: string; card: string }[]) =>
  rows.map((r) => `${r.question}/${r.card}`);

test("the browser lists every card by its note's first field, as plain text", () => {
  const rows = browseCards(collection(), "");
  expect(fronts(rows)).toEqual([
    "Capital da França/Card 1",
    "Capital da França/Reverse",
    "correr/Card 1",
    "correr/Reverse",
    "Maçã/Card 1",
    "Maçã/Reverse",
  ]);
  expect(rows[0]).toMatchObject({ deck: "Geografia", noteType: "Basic", suspended: false });
  expect(rows[0]!.answer).toBe("Paris & arredores");
});

test("search ignores case, accents and HTML, and every term must match", () => {
  const state = collection();
  expect(fronts(browseCards(state, "maca"))).toEqual(["Maçã/Card 1", "Maçã/Reverse"]);
  expect(fronts(browseCards(state, "APPLE"))).toEqual(["Maçã/Card 1", "Maçã/Reverse"]);
  expect(browseCards(state, "b")).toHaveLength(0);
  expect(browseCards(state, "paris arredores")).toHaveLength(2);
  expect(browseCards(state, '"paris arredores"')).toHaveLength(0);
  expect(browseCards(state, '"paris & arredores"')).toHaveLength(2);
  expect(browseCards(state, "paris -arredores")).toHaveLength(0);
});

test("search by deck (with its subdecks), note type, card and suspension", () => {
  const state = collection();
  expect(fronts(browseCards(state, "deck:português card:reverse"))).toEqual([
    "correr/Reverse",
    "Maçã/Reverse",
  ]);
  expect(fronts(browseCards(state, "deck:Português::Verbos card:1"))).toEqual(["correr/Card 1"]);
  expect(browseCards(state, "deck:portu")).toHaveLength(0);
  expect(browseCards(state, "deck:portu*")).toHaveLength(4);
  expect(browseCards(state, "note:basic")).toHaveLength(6);
  expect(browseCards(state, '"deck:Geografia"')).toHaveLength(2);
  expect(browseCards(state, "is:suspended")).toHaveLength(0);
  expect(browseCards(state, "-is:suspended")).toHaveLength(6);
});

test("commands are plain data, so a web tab can send them to the leader's database", () => {
  const c = new Collection(environment());
  runCommand(c, { kind: "createDeck", name: "Inglês" });
  const deckId = c.snapshot().decks[0]!.id;
  runCommand(c, { kind: "addNote", deckId, noteTypeId: "", values: ["cat", "gato"] });
  const note = c.snapshot().notes[0]!;
  const other = runCommand(c, { kind: "createDeck", name: "Animais" });
  runCommand(c, { kind: "editNote", id: note.id, values: ["cat", "gata"], deckId: other! });
  let state = c.snapshot();
  expect(state.notes[0]!.values.map((v) => v.value)).toEqual(["cat", "gata"]);
  expect(state.cards[0]!.fields.deckId.value).toBe(other);
  runCommand(c, { kind: "renameDeck", id: deckId, name: "English" });
  runCommand(c, {
    kind: "updatePreset",
    id: state.presets[0]!.id,
    patch: { newPerDay: 3 },
  });
  runCommand(c, {
    kind: "addNote",
    deckId,
    noteTypeId: state.noteTypes[0]!.id,
    values: ["dog", "cão"],
  });
  runCommand(c, { kind: "deleteNotes", ids: [note.id] });
  state = c.snapshot();
  expect(state.decks.map((d) => d.fields.name.value)).toEqual(["English", "Animais"]);
  expect(state.presets[0]!.fields.newPerDay.value).toBe(3);
  expect(state.notes.map((n) => n.values[0]!.value)).toEqual(["dog"]);
  runCommand(c, { kind: "deleteDeck", id: deckId });
  expect(c.snapshot().decks.map((d) => d.fields.name.value)).toEqual(["Animais"]);
  expect(() => runCommand(c, { kind: "renameDeck", id: "missing", name: "x" })).toThrow(
    "Invalid deck",
  );
});
