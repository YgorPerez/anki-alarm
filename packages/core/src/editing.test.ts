import { expect, test } from "vite-plus/test";
import {
  Collection,
  cardId,
  parseCollection,
  parseRecord,
  presetTexts,
  readPresetTexts,
  renderCard,
  replayCard,
  validOption,
  validPresetText,
  type CollectionState,
  type Grade,
  type LogEntry,
} from "./index.ts";

const environment = () => {
  let n = 0;
  return {
    deviceId: "phone-a",
    now: () => 1700000000000,
    random: () => new Uint8Array(16).fill(n++),
  };
};
/** A collection with Basic and an imported three-field note type. */
function withVocabularyType() {
  const c = new Collection(environment());
  const deck = c.createDeck("Japanese");
  c.addBasicNote(deck.id, "seed", "");
  const state = c.snapshot();
  const basic = state.noteTypes[0]!;
  const vocabulary = structuredClone(basic);
  vocabulary.id = "018bcfe5-6800-7fff-bfff-000000000001";
  vocabulary.fields.name.value = "Vocabulary";
  vocabulary.fields.fieldNames.value = ["Word", "Reading", "Meaning"];
  vocabulary.fields.templates.value = [
    {
      name: "Card 1",
      front: "{{Word}}",
      back: "{{FrontSide}}<hr id=answer>{{Reading}} {{ Meaning }}",
    },
  ];
  const next: CollectionState = { ...state, noteTypes: [basic, vocabulary] };
  return {
    collection: new Collection(environment(), next),
    deckId: deck.id,
    typeId: vocabulary.id,
  };
}

test("notes of any note type keep one clocked value per field", () => {
  const { collection, deckId, typeId } = withVocabularyType();
  const note = collection.addNote(deckId, typeId, ["水", "みず", "water"]);
  const state = collection.snapshot();
  const card = state.cards.find((c) => c.fields.noteId.value === note.id)!;
  expect(card.id).toBe(cardId(note.id, 0));
  expect(card.fields.deckId.value).toBe(deckId);
  expect(note.values.map((v) => v.value)).toEqual(["水", "みず", "water"]);

  collection.editNote(note.id, ["水", "みず", "water (drink)"]);
  const edited = collection.snapshot().notes.find((n) => n.id === note.id)!;
  expect(edited.values[0]).toEqual(note.values[0]);
  expect(edited.values[1]).toEqual(note.values[1]);
  expect(edited.values[2]!.value).toBe("water (drink)");
  expect(edited.values[2]!.hlc.counter).toBeGreaterThan(note.values[2]!.hlc.counter);

  const type = state.noteTypes.find((t) => t.id === typeId)!;
  const render = (side: "front" | "back") =>
    renderCard({ note: edited, type, ordinal: 0, side, dark: false });
  expect(render("front")).not.toContain("みず");
  expect(render("back")).toContain("水<hr id=answer>みず water (drink)");
});

test("moved cards study in their new deck and survive deleting the old one", () => {
  const { collection, deckId } = withVocabularyType();
  const other = collection.createDeck("Kanji");
  const note = collection.addBasicNote(deckId, "火", "fire");
  const card = cardId(note.id, 0);
  const before = collection.snapshot().cards.find((c) => c.id === card)!;
  collection.moveCards([card], other.id);
  const moved = collection.snapshot().cards.find((c) => c.id === card)!;
  expect(moved.fields.deckId.value).toBe(other.id);
  expect(moved.fields.deckId.hlc.counter).toBeGreaterThan(before.fields.deckId.hlc.counter);
  expect(moved.fields.noteId).toEqual(before.fields.noteId);
  expect(() => collection.moveCards([card], "missing")).toThrow("Invalid deck");
  expect(() => collection.moveCards(["missing"], deckId)).toThrow("Invalid card");

  collection.deleteDeck(deckId);
  const state = collection.snapshot();
  expect(state.notes.map((n) => n.id)).toEqual([note.id]);
  expect(state.cards.map((c) => c.id)).toEqual([card]);
});

test("deck options stamp changed values and replay uses their FSRS parameters", () => {
  const { collection, deckId } = withVocabularyType();
  const preset = collection.snapshot().presets[0]!;
  expect(preset.fields.fsrsParameters.value).toHaveLength(21);
  expect(preset.fields.fsrsParameters.value[2]).toBe(2.3065); // FSRS-6 default w[2]
  const parameters = [...preset.fields.fsrsParameters.value];
  parameters[2] = 5;
  collection.updatePreset(preset.id, {
    newPerDay: 5,
    desiredRetention: 0.85,
    learningSteps: [2, 15, 60],
    fsrsParameters: parameters,
    reviewsPerDay: preset.fields.reviewsPerDay.value,
  });
  const updated = collection.snapshot().presets[0]!;
  expect(updated.fields.newPerDay.value).toBe(5);
  expect(updated.fields.desiredRetention.value).toBe(0.85);
  expect(updated.fields.learningSteps.value).toEqual([2, 15, 60]);
  expect(updated.fields.reviewsPerDay).toEqual(preset.fields.reviewsPerDay);
  expect(updated.fields.newPerDay.hlc.counter).toBeGreaterThan(preset.fields.newPerDay.hlc.counter);

  const card = collection.snapshot().cards.find((c) => c.fields.deckId.value === deckId)!;
  const at = 1700000000000;
  const answer = (grade: Grade): LogEntry[] => [
    { kind: "review", id: "r", cardId: card.id, at, grade, durationMs: 1, origin: "phone" },
  ];
  expect(replayCard(card.id, answer(3), updated, at).stability).toBe(5);
  // The first of three learning steps is two minutes.
  const again = replayCard(card.id, answer(1), updated, at);
  expect(again.due.getTime()).toBe(at + 2 * 60_000);
});

test("deck options reject values FSRS or the daily limits can't use", () => {
  const { collection } = withVocabularyType();
  const id = collection.snapshot().presets[0]!.id;
  const before = collection.snapshot();
  for (const patch of [
    { newPerDay: -1 },
    { reviewsPerDay: 1.5 },
    { desiredRetention: 0.5 },
    { desiredRetention: 1 },
    { learningSteps: [0] },
    { learningSteps: [Number.NaN] },
    { fsrsParameters: [1, 2, 3] },
    { fsrsParameters: Array.from({ length: 21 }, () => Number.POSITIVE_INFINITY) },
    { name: " " },
  ])
    expect(() => collection.updatePreset(id, patch)).toThrow("Invalid deck options");
  expect(() => collection.updatePreset("missing", {})).toThrow("Invalid deck options");
  // Forms check each option with the same rule.
  expect(validOption.desiredRetention(0.5)).toBe(false);
  expect(validOption.desiredRetention(0.9)).toBe(true);
  expect(validOption.learningSteps([])).toBe(true);
  expect(collection.snapshot()).toEqual(before);
});

const hlc = (counter: number) => ({ wallMs: 1700000000000, counter, deviceId: "phone-a" });
test("collections saved before note values and FSRS parameters read in the current shape", () => {
  const legacy = {
    decks: [],
    cards: [],
    tombstones: [],
    noteTypes: [],
    notes: [
      {
        id: "n",
        fields: {
          deckId: { value: "d", hlc: hlc(1) },
          noteTypeId: { value: "t", hlc: hlc(1) },
          front: { value: "casa", hlc: hlc(1) },
          back: { value: "house", hlc: hlc(4) },
        },
      },
    ],
    presets: [
      {
        id: "p",
        fields: {
          name: { value: "Default", hlc: hlc(2) },
          newPerDay: { value: 20, hlc: hlc(2) },
          reviewsPerDay: { value: 200, hlc: hlc(2) },
          desiredRetention: { value: 0.9, hlc: hlc(2) },
          learningSteps: { value: [1, 10], hlc: hlc(3) },
        },
      },
    ],
  };
  const state = parseCollection(legacy);
  expect(state.notes).toEqual([
    {
      id: "n",
      fields: { noteTypeId: { value: "t", hlc: hlc(1) }, tags: { value: [], hlc: hlc(1) } },
      values: [
        { value: "casa", hlc: hlc(1) },
        { value: "house", hlc: hlc(4) },
      ],
    },
  ]);
  expect(state.presets[0]!.fields.fsrsParameters).toEqual({
    value: expect.arrayContaining([2.3065]),
    hlc: hlc(2),
  });
  expect(state.presets[0]!.fields.fsrsParameters.value).toHaveLength(21);
  expect(parseCollection(state)).toEqual(state);
  // One record at a time, as sync reads them, gives the same shape.
  expect(parseRecord("notes", legacy.notes[0]!)).toEqual(state.notes[0]);
});

test("a note must match its note type's fields and have a first field", () => {
  const { collection, deckId, typeId } = withVocabularyType();
  const before = collection.snapshot();
  expect(() => collection.addNote(deckId, typeId, ["水", "みず"])).toThrow("Invalid note");
  expect(() => collection.addNote(deckId, typeId, [" ", "みず", "water"])).toThrow("Invalid note");
  expect(() => collection.addNote(deckId, "missing", ["a", "b", "c"])).toThrow("Invalid note");
  expect(() => collection.addNote("missing", typeId, ["a", "b", "c"])).toThrow("Invalid note");
  const note = collection.addNote(deckId, typeId, ["水", "みず", "water"]);
  expect(() => collection.editNote(note.id, ["", "みず", "water"])).toThrow("Invalid note");
  expect(() => collection.editNote(note.id, ["水"])).toThrow("Invalid note");
  expect(collection.snapshot().notes).toHaveLength(before.notes.length + 1);
});

test("deck options forms read what the user types with Core's rules", () => {
  const { collection } = withVocabularyType();
  const preset = collection.snapshot().presets[0]!;
  const texts = presetTexts(preset, "pt-BR");
  expect(texts).toMatchObject({ newPerDay: "20", desiredRetention: "0,9", learningSteps: "1 10" });
  expect(readPresetTexts(texts)).toEqual({
    newIgnoreReviewLimit: false,
    applyAllParentLimits: false,
    buryNew: false,
    buryReviews: false,
    buryLearning: false,
    dontPlayAutomatically: false,
    skipQuestionWhenReplayingAnswer: false,
    maximumAnswerSeconds: 60,
    showTimer: false,
    stopTimerOnAnswer: false,
    name: "Default",
    newPerDay: 20,
    reviewsPerDay: 200,
    desiredRetention: 0.9,
    learningSteps: [1, 10],
    fsrsParameters: preset.fields.fsrsParameters.value,
  });
  expect(presetTexts(preset, "en").desiredRetention).toBe("0.9");
  expect(readPresetTexts({ ...texts, learningSteps: "", name: " Mine " })).toMatchObject({
    name: "Mine",
    learningSteps: [],
  });
  for (const [key, text] of [
    ["newPerDay", "1.5"],
    ["desiredRetention", "0,5"],
    ["learningSteps", "1 x"],
    ["fsrsParameters", "1, 2"],
    ["name", " "],
  ] as const) {
    expect(validPresetText[key](text)).toBe(false);
    expect(readPresetTexts({ ...texts, [key]: text })).toBeUndefined();
  }
});
