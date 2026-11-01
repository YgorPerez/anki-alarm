/* oxlint-disable unicorn/no-array-sort, unicorn/no-array-reverse -- Tests sort fresh copies; ES2022 has no toSorted. */
import { describe, expect, test } from "vite-plus/test";
import {
  alarmSession,
  Collection,
  parseCollection,
  studyCounts,
  studyQueue,
  type CollectionState,
  type LogEntry,
  type PresetOptions,
} from "./index.ts";

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 28, 12).getTime();

const cardOf = (state: CollectionState, front: string) => {
  const note = state.notes.find((x) => x.values[0]?.value === front)!;
  return state.cards.find((c) => c.fields.noteId.value === note.id)!.id;
};

/** A deck whose notes are created in order, so each front's position follows the last. */
function study(deckNames: string[] = ["Words"]) {
  let clock = NOW - 400 * DAY;
  let n = 0;
  const collection = new Collection({
    deviceId: "a",
    now: () => clock++,
    random: () => new Uint8Array(16).fill(n++),
  });
  const decks = deckNames.map((name) => collection.createDeck(name));
  const log: LogEntry[] = [];
  let entry = 0;
  const api = {
    collection,
    log,
    deckId: decks[0]!.id,
    set(options: Partial<PresetOptions>) {
      collection.updatePreset(collection.snapshot().presets[0]!.id, options);
      return api;
    },
    /** New cards, in creation order. */
    fresh(fronts: string[], deck = 0) {
      for (const front of fronts) collection.addBasicNote(decks[deck]!.id, front, "back");
      return api;
    },
    /** Adds two-card notes whose card fronts are `front/1` and `front/2`, in creation order. */
    twoCards(fronts: string[], deck = 0) {
      const typeId = collection.addBasicNote(decks[deck]!.id, "seed", "back").fields.noteTypeId
        .value;
      collection.deleteNotes(collection.snapshot().notes.map((x) => x.id));
      const type = collection.snapshot().noteTypes.find((t) => t.id === typeId)!;
      const fields = type.fields.fieldNames.value.map((name, from) => ({ name, from }));
      const template = type.fields.templates.value[0]!;
      collection.editNoteType(typeId, {
        name: type.fields.name.value,
        css: type.fields.css.value,
        fields,
        templates: [
          { ...template, from: 0 },
          { ...template, name: "Card 2" },
        ],
      });
      for (const front of fronts) collection.addNote(decks[deck]!.id, typeId, [front, "back"]);
      return api;
    },
    /** A card as AnkiDroid would hand it over, in the Review state. */
    snapshot(
      front: string,
      state: { stability?: number; difficulty?: number; interval?: number; elapsed?: number },
      deck = 0,
    ) {
      const { stability = 10, difficulty = 5, interval = 10, elapsed = 11 } = state;
      api.fresh([front], deck);
      log.push({
        kind: "snapshot",
        id: `s${entry++}`,
        cardId: cardOf(collection.snapshot(), front),
        at: NOW - 1000,
        state: {
          due: NOW - (elapsed - interval) * DAY,
          last_review: NOW - elapsed * DAY,
          stability,
          difficulty,
          elapsed_days: elapsed,
          scheduled_days: interval,
          reps: 3,
          lapses: 0,
          learning_steps: 0,
          state: 2,
        },
      });
      return api;
    },
    /** A card graduated with Easy `daysAgo` days ago, then moved to fall due `dueAgo` days ago. */
    reviewCard(front: string, { daysAgo = 30, dueAgo = 1, deck = 0 } = {}) {
      api.fresh([front], deck);
      const cardId = cardOf(collection.snapshot(), front);
      const at = NOW - daysAgo * DAY;
      log.push(
        { kind: "review", id: `r${entry++}`, cardId, at, grade: 4, durationMs: 1, origin: "phone" },
        { kind: "setDueDate", id: `d${entry++}`, cardId, at: at + 1, due: NOW - dueAgo * DAY },
      );
      return api;
    },
    answer(front: string, grade: 1 | 2 | 3 | 4, at: number) {
      const cardId = cardOf(collection.snapshot(), front);
      log.push({
        kind: "review",
        id: `r${entry++}`,
        cardId,
        at,
        grade,
        durationMs: 1,
        origin: "phone",
      });
      return api;
    },
    queue(at = NOW, edit?: (state: CollectionState) => void) {
      const state = collection.snapshot();
      edit?.(state);
      return studyQueue(state, log, api.deckId, at).map(({ card }) => {
        const front = state.notes.find((x) => x.id === card.fields.noteId.value)!.values[0]!.value;
        return state.noteTypes.some((t) => t.fields.templates.value.length > 1)
          ? `${front}/${card.fields.ordinal.value + 1}`
          : front;
      });
    },
  };
  return api;
}

/** Reviews falling due on successive days, the first the oldest. */
function reviews(fronts: string[], s = study()) {
  fronts.forEach((front, i) => s.reviewCard(front, { dueAgo: fronts.length - i }));
  return s;
}

const interleaved = ["r1", "n1", "r2", "n2", "r3"];

describe("new versus reviews", () => {
  test("mixes new cards evenly with reviews by default, as Anki does", () => {
    expect(reviews(["r1", "r2", "r3"]).fresh(["n1", "n2"]).queue()).toEqual(interleaved);
  });
  test("shows new cards after or before reviews", () => {
    const s = reviews(["r1", "r2"]).fresh(["n1", "n2"]);
    expect(s.set({ newMix: "after" }).queue()).toEqual(["r1", "r2", "n1", "n2"]);
    expect(s.set({ newMix: "before" }).queue()).toEqual(["n1", "n2", "r1", "r2"]);
  });
});

/** `day` was answered five days ago on a four-day step, so it waits in interday learning. */
const withLearning = () => {
  const s = reviews(["r1", "r2"])
    .set({ learningSteps: [2880, 5760] })
    .fresh(["day"]);
  s.answer("day", 3, NOW - 5 * DAY);
  return s;
};

describe("learning versus reviews", () => {
  test("mixes interday learning with reviews by default", () => {
    expect(withLearning().queue()).toEqual(["r1", "day", "r2"]);
  });
  test("shows interday learning after or before reviews", () => {
    const s = withLearning();
    expect(s.set({ interdayLearningMix: "after" }).queue()).toEqual(["r1", "r2", "day"]);
    expect(s.set({ interdayLearningMix: "before" }).queue()).toEqual(["day", "r1", "r2"]);
  });
  test("a short step that ends past the 4am day boundary counts as interday", () => {
    const s = reviews(["r1", "r2"]).set({ learningSteps: [10], interdayLearningMix: "after" });
    s.fresh(["night"]).answer("night", 1, new Date(2026, 9, 28, 3, 55).getTime());
    expect(s.queue()).toEqual(["r1", "r2", "night"]);
  });
  test("steps due within the study day always come first, whatever the mix", () => {
    const s = reviews(["r1", "r2"]).fresh(["short"]).set({ newMix: "before" });
    s.answer("short", 1, NOW - 120_000);
    expect(s.set({ interdayLearningMix: "before" }).queue()[0]).toBe("short");
    expect(s.set({ interdayLearningMix: "after", newMix: "after" }).queue()[0]).toBe("short");
  });
});

const limited = () =>
  study(["Words", "Words::B", "Words::A"]).set({
    newPerDay: 3,
    newSortOrder: "noSort",
    newMix: "before",
  });

describe("new card gathering", () => {
  test("takes each deck in turn, a parent before its subdecks, by default", () => {
    const s = limited().fresh(["b1"], 1).fresh(["a1", "a2"], 2).fresh(["p1"], 0);
    expect(s.queue()).toEqual(["p1", "a1", "a2"]);
  });
  test("lowest position ignores decks and highest position reverses it", () => {
    const s = limited().fresh(["b1"], 1).fresh(["a1", "a2"], 2).fresh(["p1"], 0);
    expect(s.set({ newGatherPriority: "lowestPosition" }).queue()).toEqual(["b1", "a1", "a2"]);
    expect(s.set({ newGatherPriority: "highestPosition" }).queue()).toEqual(["p1", "a2", "a1"]);
  });
  test("deck then random notes keeps the deck order and shuffles inside it", () => {
    const fronts = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const s = limited().fresh(fronts, 0).fresh(["a1"], 2);
    s.set({ newPerDay: 13, newGatherPriority: "deckThenRandomNotes" });
    const queue = s.queue();
    expect(queue.at(-1)).toBe("a1");
    expect(queue.slice(0, 12)).not.toEqual(fronts);
  });
  test("random notes keep a note's cards together and random cards don't have to", () => {
    const fronts = Array.from({ length: 12 }, (_, i) => `n${i}`);
    const s = limited().twoCards(fronts).set({ newPerDay: 99, newGatherPriority: "randomNotes" });
    const notes = s.queue().map((card) => card.split("/")[0]);
    expect(notes.filter((_, i) => i % 2 === 0)).toEqual(notes.filter((_, i) => i % 2 === 1));
    expect(notes.filter((_, i) => i % 2 === 0)).not.toEqual(fronts);
    const cards = s.set({ newGatherPriority: "randomCards" }).queue();
    expect(cards.map((card) => card.split("/")[0])).not.toEqual(notes);
    expect([...cards].sort()).toEqual(
      [...s.set({ newGatherPriority: "lowestPosition" }).queue()].sort(),
    );
  });
  test("gathers within the daily limit before sorting, as Anki does", () => {
    const s = limited().fresh(["n1", "n2", "n3", "n4"]).set({ newPerDay: 2 });
    s.set({ newGatherPriority: "highestPosition", newSortOrder: "noSort" });
    expect(s.queue()).toEqual(["n4", "n3"]);
    s.set({ newSortOrder: "template" });
    expect(s.queue()).toEqual(["n4", "n3"]);
  });
});

const twoEach = () =>
  study().twoCards(["a", "b"]).set({ newMix: "before", newGatherPriority: "lowestPosition" });

describe("new card sort", () => {
  test("sorts by card type, then the order gathered, by default", () => {
    expect(twoEach().queue()).toEqual(["a/1", "b/1", "a/2", "b/2"]);
  });
  test("keeps the order gathered", () => {
    expect(twoEach().set({ newSortOrder: "noSort" }).queue()).toEqual(["a/1", "a/2", "b/1", "b/2"]);
  });
  test("card type then random keeps each type together", () => {
    const fronts = Array.from({ length: 12 }, (_, i) => `n${i}`);
    const s = study().twoCards(fronts);
    s.set({ newPerDay: 99, newMix: "before", newSortOrder: "templateThenRandom" });
    const queue = s.queue();
    expect(queue.slice(0, 12).every((card) => card.endsWith("/1"))).toBe(true);
    expect(queue.slice(0, 12)).not.toEqual(fronts.map((front) => `${front}/1`));
  });
  test("random note then card type keeps a note's cards together in type order", () => {
    const fronts = Array.from({ length: 12 }, (_, i) => `n${i}`);
    const s = study().twoCards(fronts);
    s.set({ newPerDay: 99, newMix: "before", newSortOrder: "randomNoteThenTemplate" });
    const queue = s.queue();
    const firsts = queue.filter((_, i) => i % 2 === 0);
    expect(firsts.every((card) => card.endsWith("/1"))).toBe(true);
    expect(queue.filter((_, i) => i % 2 === 1)).toEqual(firsts.map((c) => c.replace("/1", "/2")));
    expect(firsts).not.toEqual(fronts.map((front) => `${front}/1`));
  });
  test("random shuffles cards and notes alike", () => {
    const fronts = Array.from({ length: 12 }, (_, i) => `n${i}`);
    const s = study().twoCards(fronts);
    s.set({ newPerDay: 99, newMix: "before", newSortOrder: "randomCard" });
    const notes = s.queue().map((card) => card.split("/")[0]);
    expect(notes.filter((_, i) => i % 2 === 0)).not.toEqual(notes.filter((_, i) => i % 2 === 1));
  });
});

const sorted = (reviewOrder: PresetOptions["reviewOrder"], s = study()) =>
  s.set({ reviewOrder }).queue();

const strictThenRelaxed = (state: CollectionState) => {
  state.decks[0]!.fields.desiredRetention.value = 0.97;
  state.decks[1]!.fields.desiredRetention.value = 0.7;
};

describe("review sort", () => {
  test("goes by due day, and shuffles within a day", () => {
    const s = study().reviewCard("late", { dueAgo: 1 }).reviewCard("early", { dueAgo: 3 });
    expect(sorted("day", s)).toEqual(["early", "late"]);
    const sameDay = Array.from({ length: 12 }, (_, i) => `r${i}`);
    const t = study();
    for (const front of sameDay) t.reviewCard(front);
    expect(sorted("day", t)).not.toEqual(sameDay);
  });
  test("due day then deck, and deck then due day", () => {
    const s = study(["Words", "Words::A"])
      .reviewCard("parent-new", { dueAgo: 1 })
      .reviewCard("sub-old", { dueAgo: 3, deck: 1 })
      .reviewCard("parent-old", { dueAgo: 3 });
    expect(sorted("dayThenDeck", s)).toEqual(["parent-old", "sub-old", "parent-new"]);
    expect(sorted("deckThenDay", s)).toEqual(["parent-old", "parent-new", "sub-old"]);
  });
  test("by interval, either way", () => {
    const s = study()
      .snapshot("long", { interval: 30, elapsed: 31 })
      .snapshot("short", { interval: 3 });
    expect(sorted("intervalsAscending", s)).toEqual(["short", "long"]);
    expect(sorted("intervalsDescending", s)).toEqual(["long", "short"]);
  });
  test("by difficulty, either way", () => {
    const s = study().snapshot("easy", { difficulty: 2 }).snapshot("hard", { difficulty: 9 });
    expect(sorted("difficultyAscending", s)).toEqual(["easy", "hard"]);
    expect(sorted("difficultyDescending", s)).toEqual(["hard", "easy"]);
  });
  test("by retrievability, either way", () => {
    const s = study().snapshot("fading", { stability: 2 }).snapshot("firm", { stability: 200 });
    expect(sorted("retrievabilityAscending", s)).toEqual(["fading", "firm"]);
    expect(sorted("retrievabilityDescending", s)).toEqual(["firm", "fading"]);
  });
  test("relative overdueness weighs each card against its own desired retention", () => {
    // `relaxed` is the less retrievable card, yet well inside its deck's low retention.
    const s = study(["Words", "Words::Relaxed"])
      .snapshot("strict", { interval: 1, elapsed: 3 })
      .snapshot("relaxed", { interval: 1, elapsed: 10 }, 1);
    s.set({ reviewOrder: "retrievabilityAscending" });
    expect(s.queue(NOW, strictThenRelaxed)).toEqual(["relaxed", "strict"]);
    s.set({ reviewOrder: "relativeOverdueness" });
    expect(s.queue(NOW, strictThenRelaxed)).toEqual(["strict", "relaxed"]);
  });
  test("random shuffles, and order added goes either way", () => {
    const fronts = Array.from({ length: 12 }, (_, i) => `r${i}`);
    const s = study();
    fronts.forEach((front, i) => s.reviewCard(front, { dueAgo: 12 - i }));
    expect(sorted("random", s)).not.toEqual(fronts);
    expect(sorted("added", s)).toEqual(fronts);
    expect(sorted("reverseAdded", s)).toEqual([...fronts].reverse());
  });
  test("the review limit keeps the first cards in this order", () => {
    const s = study()
      .snapshot("long", { interval: 30, elapsed: 31 })
      .snapshot("short", { interval: 3 });
    s.set({ reviewsPerDay: 1 });
    expect(sorted("intervalsAscending", s)).toEqual(["short"]);
    expect(sorted("intervalsDescending", s)).toEqual(["long"]);
  });
});

test("random orders hold still through a study day and change with the next one", () => {
  const fronts = Array.from({ length: 12 }, (_, i) => `n${i}`);
  const s = study().fresh(fronts).set({ newGatherPriority: "randomCards", newSortOrder: "noSort" });
  expect(s.queue(NOW + 3_600_000)).toEqual(s.queue());
  const without = s.queue().slice(1);
  s.answer(s.queue()[0]!, 3, NOW);
  expect(s.queue(NOW + 1).filter((c) => without.includes(c))).toEqual(without);
  expect(s.queue(NOW + DAY)).not.toEqual(s.queue());
});

const subdeckAfter = (state: CollectionState) => {
  const [preset] = state.presets;
  const own = {
    ...preset!,
    id: "own",
    fields: { ...preset!.fields, newMix: { ...preset!.fields.newMix, value: "after" as const } },
  };
  state.presets.push(own);
  state.decks[1]!.fields.presetId.value = "own";
};

test("the studied deck's order wins over its subdecks' own", () => {
  const s = study(["Words", "Words::A"]).reviewCard("r").fresh(["n"], 1);
  s.set({ newMix: "before" });
  expect(s.queue(NOW, subdeckAfter)).toEqual(["n", "r"]);
});

test("study counts still follow the daily limits", () => {
  const s = study().fresh(["n1", "n2", "n3"]).set({ newPerDay: 2 });
  expect(studyCounts(s.collection.snapshot(), s.log, s.deckId, NOW).new).toBe(2);
});

test("an alarm session keeps its own order: due cards, then new, whatever the preset says", () => {
  const s = reviews(["r1", "r2"]).fresh(["n1", "n2"]).set({
    newMix: "before",
    reviewOrder: "reverseAdded",
    newGatherPriority: "highestPosition",
  });
  const state = s.collection.snapshot();
  const fronts = (ids: string[]) =>
    ids.map((id) => {
      const card = state.cards.find((c) => c.id === id)!;
      return state.notes.find((x) => x.id === card.fields.noteId.value)!.values[0]!.value;
    });
  const answers: LogEntry[] = [];
  const order: string[] = [];
  for (let i = 0; i < 4; i++) {
    const { next } = alarmSession({
      collection: state,
      log: [...s.log, ...answers],
      deckId: s.deckId,
      need: 10,
      ringId: "ring",
      now: NOW,
    });
    order.push(next!.card.id);
    answers.push({
      kind: "review",
      id: `a${i}`,
      cardId: next!.card.id,
      at: NOW + i,
      grade: 3,
      durationMs: 1,
      origin: "alarm",
      ringId: "ring",
    });
  }
  expect(fronts(order)).toEqual(["r1", "r2", "n1", "n2"]);
});

test("a duplicated preset keeps its display order and a new one starts from Anki's defaults", () => {
  const s = study().set({ newMix: "before", reviewOrder: "added" });
  const source = s.collection.snapshot().presets[0]!.id;
  const copy = s.collection.duplicatePreset(source, "Copy").fields;
  expect([copy.newMix.value, copy.reviewOrder.value]).toEqual(["before", "added"]);
  const fresh = s.collection.createPreset("Fresh").fields;
  expect([fresh.newMix.value, fresh.reviewOrder.value]).toEqual(["mix", "day"]);
});

test("presets saved before display order read Anki's defaults, and the upgrade edits nothing", () => {
  const stored = study().collection.snapshot();
  const fields: Record<string, unknown> = { ...stored.presets[0]!.fields };
  for (const key of [
    "newGatherPriority",
    "newSortOrder",
    "newMix",
    "interdayLearningMix",
    "reviewOrder",
  ])
    delete fields[key];
  const parsed = parseCollection({ ...stored, presets: [{ id: "p", fields }] });
  const { name, newMix, reviewOrder } = parsed.presets[0]!.fields;
  expect([newMix.value, reviewOrder.value]).toEqual(["mix", "day"]);
  expect(newMix.hlc).toEqual(name.hlc);
});
