import { describe, expect, test } from "vite-plus/test";
import {
  alarmSession,
  Collection,
  replayCard,
  studyQueue,
  type AnkiDroidSource,
  type AnkiPackage,
  type CollectionState,
  type LogEntry,
} from "./index.ts";

const NOW = 1_900_000_000_000;
// One clock reading: everything a link or an import writes shares its millisecond.
const environment = (deviceId = "phone") => {
  let n = 0;
  return { deviceId, now: () => NOW, random: () => new Uint8Array(16).fill(n++) };
};
const QUESTIONS = ["pergunta1", "pergunta2", "pergunta3"];

const adCard = (noteId: number, due: number, over: object = {}) => ({
  id: noteId + 8000,
  noteId,
  ord: 0,
  deckId: 20,
  originalDeckId: 0,
  reps: 0,
  lapses: 0,
  type: 0,
  queue: 0,
  due,
  interval: 0,
  left: 0,
  stability: null,
  difficulty: null,
  lastReviewSecs: null,
  ...over,
});
const adSource = (cards: AnkiDroidSource["cards"]): AnkiDroidSource => ({
  deckId: 20,
  decks: [{ id: 20, name: "Perguntas", options: "{}", filtered: false }],
  noteTypes: [
    {
      id: 10,
      name: "Basic",
      cloze: false,
      fieldNames: "Front\u001fBack",
      css: "",
      templates: [{ ord: 0, name: "Card 1", front: "{{Front}}", back: "{{Back}}" }],
    },
  ],
  notes: QUESTIONS.map((front, i) => ({
    id: 101 + i,
    guid: `guid-${i}`,
    noteTypeId: 10,
    mod: 1_760_000_000,
    tags: "",
    fields: `${front}\u001fback`,
  })),
  cards,
});
const linked = () => adSource([adCard(101, 1), adCard(102, 2), adCard(103, 3)]);

const front = (state: CollectionState, cardId: string) => {
  const card = state.cards.find((c) => c.id === cardId)!;
  return state.notes.find((n) => n.id === card.fields.noteId.value)!.values[0]!.value;
};
const deckOf = (state: CollectionState) =>
  state.decks.find((d) => d.fields.name.value === "Perguntas")!;
const studied = (state: CollectionState, log: LogEntry[] = []) =>
  studyQueue(state, log, deckOf(state).id, NOW).map((q) => front(state, q.card.id));

describe("linked decks", () => {
  test("study AnkiDroid's new cards in its order", () => {
    const c = new Collection(environment());
    c.linkAnkiDroid(linked());
    expect(studied(c.snapshot())).toEqual(QUESTIONS);
  });

  test("follow AnkiDroid's due position over its ids, and a pull that repositions", () => {
    const c = new Collection(environment());
    c.linkAnkiDroid(adSource([adCard(101, 3), adCard(102, 1), adCard(103, 2)]));
    expect(studied(c.snapshot())).toEqual(["pergunta2", "pergunta3", "pergunta1"]);
    c.linkAnkiDroid(linked());
    expect(studied(c.snapshot())).toEqual(QUESTIONS);
  });

  test("a deck linked before positions were kept orders by AnkiDroid's card ids", () => {
    const c = new Collection(environment());
    c.linkAnkiDroid(linked());
    const state = c.snapshot();
    for (const card of state.cards) delete card.fields.sourcePosition;
    expect(studied(state)).toEqual(QUESTIONS);
  });

  test("a filtered card's due isn't a source position", () => {
    const c = new Collection(environment());
    c.linkAnkiDroid(
      adSource([
        adCard(101, 900, { originalDeckId: 20, deckId: 99 }),
        adCard(102, 800, { originalDeckId: 20, deckId: 99 }),
        adCard(103, 700, { originalDeckId: 20, deckId: 99 }),
      ]),
    );
    expect(studied(c.snapshot())).toEqual(QUESTIONS);
  });

  test("the same pull writes nothing new", () => {
    const c = new Collection(environment());
    c.linkAnkiDroid(linked());
    const before = JSON.stringify(c.snapshot().cards);
    c.linkAnkiDroid(linked());
    expect(JSON.stringify(c.snapshot().cards)).toBe(before);
  });

  test("a reviewed card's due, a day number, doesn't become a position", () => {
    const c = new Collection(environment());
    c.linkAnkiDroid(
      adSource([
        adCard(101, 20_000, {
          type: 2,
          queue: 2,
          reps: 3,
          interval: 5,
          lastReviewSecs: 1_700_000_000,
        }),
        adCard(102, 2),
        adCard(103, 3),
      ]),
    );
    const state = c.snapshot();
    const positions = state.cards.map((card) => card.fields.sourcePosition?.value);
    expect(positions).toEqual([undefined, 2, 3]);
  });
});

test("a position moves nothing already answered: memory stays and a reset still goes last", () => {
  const c = new Collection(environment());
  c.linkAnkiDroid(linked());
  const state = c.snapshot();
  const first = state.cards[0]!;
  const preset = state.presets.find((p) => p.id === deckOf(state).fields.presetId.value)!;
  const log: LogEntry[] = [
    {
      id: "a",
      cardId: first.id,
      at: NOW - 5000,
      kind: "review",
      grade: 3,
      durationMs: 1,
      origin: "phone",
    },
  ];
  const memory = replayCard(first.id, log, preset, NOW);
  const without = structuredClone(state);
  for (const card of without.cards) delete card.fields.sourcePosition;
  expect(
    replayCard(
      first.id,
      log,
      without.presets.find((p) => p.id === preset.id)!,
      NOW,
    ),
  ).toEqual(memory);
  const reset: LogEntry[] = [{ id: "r", cardId: first.id, at: NOW - 1000, kind: "reset" }];
  expect(studied(state, reset)).toEqual(["pergunta2", "pergunta3", "pergunta1"]);
});

test("the alarm session takes new cards in the same order, whatever the records' order", () => {
  const c = new Collection(environment());
  c.linkAnkiDroid(linked());
  const state = c.snapshot();
  const reversed = structuredClone(state);
  reversed.cards.reverse();
  const log: LogEntry[] = [];
  for (const collection of [state, reversed]) {
    const { next } = alarmSession({
      collection,
      log,
      deckId: deckOf(state).id,
      need: 3,
      ringId: "ring",
      now: NOW,
    });
    expect(front(state, next!.card.id)).toBe("pergunta1");
  }
});

test("a phone and the web order the deck alike after syncing the same records", () => {
  const phone = new Collection(environment());
  phone.linkAnkiDroid(linked());
  const web = structuredClone(phone.snapshot());
  web.cards.reverse();
  web.notes.reverse();
  expect(studied(web)).toEqual(studied(phone.snapshot()));
});

const pkg = (cards: { noteId: number; due?: number }[]): AnkiPackage => ({
  version: 2,
  noteTypes: [
    {
      id: 10,
      name: "Basic",
      kind: "standard",
      css: "",
      mtime: 1000,
      fields: [
        { name: "Front", id: "" },
        { name: "Back", id: "" },
      ],
      templates: [{ name: "Card 1", front: "{{Front}}", back: "{{Back}}", id: "" }],
    },
  ],
  decks: [{ id: 20, name: "Perguntas", mtime: 1000, presetId: 1, desiredRetention: null }],
  presets: [],
  notes: QUESTIONS.map((question, i) => ({
    id: 101 + i,
    guid: `guid-${i}`,
    noteTypeId: 10,
    mtime: 1000,
    tags: [],
    fields: [question, "back"],
  })),
  cards: cards.map(({ noteId, due }) =>
    Object.assign(
      {
        id: noteId + 8000,
        noteId,
        deckId: 20,
        ordinal: 0,
        mtime: 1000,
        suspended: false,
        buried: false,
      },
      due === undefined ? {} : { position: due },
    ),
  ),
  revlog: [],
});

describe(".apkg import", () => {
  test("keeps the package's new-card position", () => {
    const c = new Collection(environment());
    c.importAnki(
      pkg([
        { noteId: 101, due: 3 },
        { noteId: 102, due: 1 },
        { noteId: 103, due: 2 },
      ]),
    );
    expect(studied(c.snapshot())).toEqual(["pergunta2", "pergunta3", "pergunta1"]);
  });

  test("falls back to Anki's card ids for a card with no position", () => {
    const c = new Collection(environment());
    c.importAnki(pkg([{ noteId: 101 }, { noteId: 102 }, { noteId: 103 }]));
    expect(studied(c.snapshot())).toEqual(QUESTIONS);
  });
});

test("notes written here in one millisecond keep the order they were written in", () => {
  const c = new Collection(environment());
  const deck = c.createDeck("Perguntas");
  for (const question of QUESTIONS) c.addBasicNote(deck.id, question, "back");
  const state = c.snapshot();
  expect(studied(state)).toEqual(QUESTIONS);
  const { next } = alarmSession({
    collection: state,
    log: [],
    deckId: deck.id,
    need: 3,
    ringId: "ring",
    now: NOW,
  });
  expect(front(state, next!.card.id)).toBe("pergunta1");
});
