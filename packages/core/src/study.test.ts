import { expect, test } from "vite-plus/test";
import {
  cardMemory,
  schedulingOptions,
  nextIntervals,
  Collection,
  replayCard,
  studyQueue,
  studyCounts,
  nextStudyCard,
  type LogEntry,
  type Note,
  type NoteType,
} from "./index.ts";
const now = new Date(2026, 9, 28, 12).getTime();
function fixture() {
  let n = 0;
  const c = new Collection({
    deviceId: "a",
    now: () => now,
    random: () => new Uint8Array(16).fill(n++),
  });
  const deck = c.createDeck("Words");
  c.addBasicNote(deck.id, "one", "um");
  c.addBasicNote(deck.id, "two", "dois");
  const state = c.snapshot();
  return { state, deckId: deck.id, cardId: state.cards[0]!.id, preset: state.presets[0]! };
}
test("replays FSRS reviews in answer order and void restores the earlier state", () => {
  const { cardId, preset } = fixture();
  const review: LogEntry = {
    kind: "review",
    id: "r",
    cardId,
    at: now,
    grade: 3,
    durationMs: 1200,
    origin: "phone",
  };
  const learned = replayCard(cardId, [review], preset, now);
  expect(learned.reps).toBe(1);
  expect(learned.stability).toBeGreaterThan(0);
  expect(learned.due.getTime()).toBeGreaterThan(now);
  expect(
    replayCard(
      cardId,
      [{ kind: "void", id: "v", cardId, at: now + 1, targetId: "r" }, review],
      preset,
      now,
    ).reps,
  ).toBe(0);
});
test("daily limits count cards once, include alarm answers and leave learning available", () => {
  const { state, deckId, cardId, preset } = fixture();
  preset.fields.newPerDay.value = 1;
  expect(studyQueue(state, [], deckId, now)).toHaveLength(2);
  const log: LogEntry[] = [
    { kind: "review", id: "a", cardId, at: now, grade: 1, durationMs: 1, origin: "alarm" },
  ];
  expect(studyQueue(state, log, deckId, now)).toHaveLength(0);
  expect(studyQueue(state, log, deckId, now + 61_000).map((c) => c.card.id)).toEqual([cardId]);
  expect(studyQueue(state, log, deckId, now + 86_400_000)).toHaveLength(2);
  preset.fields.reviewsPerDay.value = 0;
  const graduated: LogEntry[] = [
    {
      kind: "review",
      id: "b",
      cardId,
      at: now - 10 * 86_400_000,
      grade: 4,
      durationMs: 1,
      origin: "phone",
    },
  ];
  expect(studyQueue(state, graduated, deckId, now).some((c) => c.card.id === cardId)).toBe(false);
});
test("snapshot, set due date and reset replay without fabricating grades", () => {
  const { cardId, preset } = fixture();
  const state = replayCard(
    cardId,
    [{ kind: "review", id: "a", cardId, at: now, grade: 4, durationMs: 1, origin: "phone" }],
    preset,
    now,
  );
  const log: LogEntry[] = [
    {
      kind: "snapshot",
      id: "s",
      cardId,
      at: now,
      state: { ...state, due: now + 1000, last_review: now },
    },
  ];
  log.push({ kind: "setDueDate", id: "d", cardId, at: now + 1, due: now + 2000 });
  expect(replayCard(cardId, log, preset, now).due.getTime()).toBe(now + 2000);
  expect(replayCard(cardId, log, preset, now).stability).toBe(state.stability);
  log.push({ kind: "reset", id: "r", cardId, at: now + 2 });
  expect(replayCard(cardId, log, preset, now).reps).toBe(0);
});

test("review limit includes web answers and void restores the daily allowance", () => {
  const { state, deckId, cardId, preset } = fixture();
  preset.fields.reviewsPerDay.value = 1;
  const other = state.cards[1]!.id;
  const snapshot = {
    due: now - 1000,
    stability: 3,
    difficulty: 5,
    elapsed_days: 3,
    scheduled_days: 3,
    reps: 1,
    lapses: 0,
    learning_steps: 0,
    state: 2 as const,
    last_review: now - 4 * 86_400_000,
  };
  const log: LogEntry[] = [cardId, other].map((id, i) => ({
    kind: "snapshot",
    id: `s${i}`,
    cardId: id,
    at: now - 86_400_000,
    state: snapshot,
  }));
  log.push({ kind: "review", id: "r", cardId, at: now, grade: 3, durationMs: 100, origin: "web" });
  expect(studyQueue(state, log, deckId, now)).toHaveLength(0);
  log.push({ kind: "void", id: "v", cardId, at: now + 1, targetId: "r" });
  expect(studyQueue(state, log, deckId, now + 1)).toHaveLength(2);
});

import { studyDayStart, renderCard, usesScripts } from "./index.ts";
test("study days turn over at 4am rather than midnight", () => {
  expect(studyDayStart(new Date(2026, 9, 28, 3, 59).getTime())).toBe(
    new Date(2026, 9, 27, 4).getTime(),
  );
  expect(studyDayStart(new Date(2026, 9, 28, 4).getTime())).toBe(
    new Date(2026, 9, 28, 4).getTime(),
  );
});
test("Basic rendering keeps the back hidden until reveal and includes author CSS and night classes", () => {
  const { state } = fixture();
  const note = state.notes[0]!;
  const type = state.noteTypes[0]!;
  type.fields.css.value = ".card{font-size:32px}";
  const side = (shown: "front" | "back") =>
    renderCard({ note, type, ordinal: 0, side: shown, dark: true });
  expect(side("front")).toContain("nightMode night_mode");
  expect(side("front")).not.toContain("um");
  expect(side("back")).toContain('one<hr id="answer">um');
  expect(side("back")).toContain(".card{font-size:32px}");
});

test("reset puts a card after the untouched new cards", () => {
  const { state, deckId, cardId } = fixture();
  const log: LogEntry[] = [{ kind: "reset", id: "reset", cardId, at: now + 1 }];
  expect(studyQueue(state, log, deckId, now + 2).at(-1)?.card.id).toBe(cardId);
});

const hlc = { wallMs: 1, counter: 0, deviceId: "a" };
const f = <T>(value: T) => ({ value, hlc });
function imported(
  fieldNames: string[],
  templates: [string, string][],
  values: string[],
  cloze = false,
) {
  const type: NoteType = {
    id: "t",
    fields: {
      name: f("Imported"),
      fieldNames: f(fieldNames),
      templates: f(templates.map(([front, back], i) => ({ name: `Card ${i + 1}`, front, back }))),
      css: f(""),
      kind: f(cloze ? ("cloze" as const) : ("standard" as const)),
    },
  };
  const note: Note = {
    id: "n",
    fields: { noteTypeId: f("t"), tags: f(["verb", "leech"]) },
    values: values.map(f),
  };
  return { type, note };
}
const body = (html: string) => /<body[^>]*>([\s\S]*)<\/body>/.exec(html)![1]!;
/** Inactive clozes show their text, marked as Anki marks them. */
const plain = (html: string) =>
  body(html).replace(/<span class="cloze-inactive"[^>]*>(.*?)<\/span>/g, "$1");
const render = (note: Note, type: NoteType, ordinal: number, side: "front" | "back") =>
  renderCard({ note, type, ordinal, side, dark: false });

const csp = (html: string) => /Content-Security-Policy" content="([^"]*)"/.exec(html)![1]!;
test("a card's scripts stay blocked unless the caller allows them, and never reach the network", () => {
  const { note, type } = imported(["Q"], [["<script>mark()</script>{{Q}}", "{{Q}}"]], ["casa"]);
  expect(csp(render(note, type, 0, "front"))).not.toContain("script-src");
  const allowed = csp(
    renderCard({ note, type, ordinal: 0, side: "front", dark: false, scripts: true }),
  );
  expect(allowed).toContain("script-src 'unsafe-inline' file:");
  expect(allowed).toContain("default-src 'none'");
  expect(allowed).not.toMatch(/https?:/);
});

test("usesScripts spots script tags and inline handlers, not plain cards", () => {
  expect(usesScripts("<script>mark()</script>")).toBe(true);
  expect(usesScripts('<script src="_deck.js"></script>')).toBe(true);
  expect(usesScripts('<div onclick="mark(this)">A</div>')).toBe(true);
  expect(usesScripts('<b>online</b> description="a"')).toBe(false);
});

test("imported templates pick the card's template and expand sections, filters and tags", () => {
  const { note, type } = imported(
    ["Word", "Meaning", "Extra"],
    [
      ["{{Word}}{{#Extra}} ({{Extra}}){{/Extra}}", "{{FrontSide}}<hr>{{Meaning}}"],
      ["{{text:Meaning}}{{^Extra}}!{{/Extra}}", "{{FrontSide}}={{Word}} {{Tags}}"],
    ],
    ["casa", "<b>house</b>", ""],
  );
  expect(body(render(note, type, 0, "front"))).toBe("casa");
  expect(body(render(note, type, 0, "back"))).toBe("casa<hr><b>house</b>");
  expect(body(render(note, type, 1, "front"))).toBe("house!");
  expect(body(render(note, type, 1, "back"))).toBe("house!=casa verb leech");
});

test("cloze cards hide only their own number and reveal it on the back", () => {
  const { note, type } = imported(
    ["Text", "Back Extra"],
    [["{{cloze:Text}}", "{{cloze:Text}}<br>{{Back Extra}}"]],
    ["{{c1::Brasília}} is the capital of {{c2::Brazil::country}}", "note"],
    true,
  );
  expect(plain(render(note, type, 0, "front"))).toBe(
    '<span class="cloze" data-ordinal="1">[...]</span> is the capital of Brazil',
  );
  expect(plain(render(note, type, 1, "front"))).toBe(
    'Brasília is the capital of <span class="cloze" data-ordinal="2">[country]</span>',
  );
  expect(plain(render(note, type, 1, "back"))).toBe(
    'Brasília is the capital of <span class="cloze" data-ordinal="2">Brazil</span><br>note',
  );
});

test("card media stays referenced by file name and sound tags become tap-to-play audio", () => {
  const { note, type } = imported(
    ["Front", "Back"],
    [["{{Front}}", "{{Back}}"]],
    ['<img src="cat.jpg">[sound:cat.mp3]', ""],
  );
  expect(body(render(note, type, 0, "front"))).toBe(
    '<img src="cat.jpg"><audio controls preload="none" src="cat.mp3"></audio>',
  );
});

test("the next card is the queue's head with its note and type, and an undone card comes back first", () => {
  const { state, deckId } = fixture();
  const [first, second] = studyQueue(state, [], deckId, now).map((c) => c.card);
  const next = nextStudyCard(state, [], deckId, now);
  expect(next?.card.id).toBe(first!.id);
  expect(next?.note.id).toBe(first!.fields.noteId.value);
  expect(next?.type.id).toBe(next?.note.fields.noteTypeId.value);

  expect(nextStudyCard(state, [], deckId, now, second!.id)?.card.id).toBe(second!.id);
  // An undone card no longer in the queue (another device graded it) is skipped.
  expect(nextStudyCard(state, [], deckId, now, "gone")?.card.id).toBe(first!.id);
  const log: LogEntry[] = [first!, second!].map((card, i) => ({
    kind: "review",
    id: `r${i}`,
    cardId: card.id,
    at: now,
    grade: 4,
    durationMs: 1,
    origin: "web",
  }));
  expect(nextStudyCard(state, log, deckId, now)).toBeUndefined();
});

test("a card's memory follows its deck's desired retention", () => {
  const { state, cardId } = fixture();
  const log: LogEntry[] = [
    { kind: "review", id: "r", cardId, at: now, grade: 4, durationMs: 1, origin: "phone" },
  ];
  const atPreset = cardMemory(state, log, cardId, now)!.due.getTime();
  state.decks[0]!.fields.desiredRetention.value = 0.99;
  expect(cardMemory(state, log, cardId, now)!.due.getTime()).toBeLessThan(atPreset);
});

function seeded(seed: number) {
  let next = seed;
  return new Collection({
    deviceId: "a",
    now: () => now,
    random: () => new Uint8Array(16).fill(next++),
  });
}
test("studying a deck includes its subdecks, as Anki does, and not its siblings", () => {
  const c = seeded(100);
  const parent = c.createDeck("Idiomas");
  const child = c.createDeck("Idiomas::Inglês");
  const sibling = c.createDeck("Idiomas2");
  c.addBasicNote(parent.id, "parent", "x");
  c.addBasicNote(child.id, "child", "x");
  c.addBasicNote(sibling.id, "sibling", "x");
  const state = c.snapshot();
  const fronts = (deckId: string) =>
    studyQueue(state, [], deckId, now).map(
      ({ card }) =>
        state.notes.find((note) => note.id === card.fields.noteId.value)?.values[0]?.value,
    );
  expect(new Set(fronts(parent.id))).toEqual(new Set(["parent", "child"]));
  expect(fronts(child.id)).toEqual(["child"]);
});

test("a subdeck's card schedules with the subdeck's own preset", () => {
  const c = seeded(200);
  const parent = c.createDeck("Idiomas");
  const child = c.createDeck("Idiomas::Inglês");
  c.addBasicNote(child.id, "child", "x");
  const state = c.snapshot();
  const cardId = state.cards[0]!.id;
  // Easy three days ago: not due at 90% retention, due at the subdeck's 99%.
  const log: LogEntry[] = [
    {
      kind: "review",
      id: "r",
      cardId,
      at: now - 3 * 86_400_000,
      grade: 4,
      durationMs: 1,
      origin: "phone",
    },
  ];
  expect(studyQueue(state, log, parent.id, now)).toHaveLength(0);
  state.decks.find((d) => d.id === child.id)!.fields.desiredRetention.value = 0.99;
  expect(studyQueue(state, log, parent.id, now).map((item) => item.card.id)).toEqual([cardId]);
});

test("study counts respect daily allowance and move answered cards into learning, including undo", () => {
  const { state, deckId, cardId, preset } = fixture();
  preset.fields.newPerDay.value = 1;
  expect(studyCounts(state, [], deckId, now)).toEqual({ new: 1, learning: 0, review: 0 });
  const log: LogEntry[] = [
    { kind: "review", id: "a", cardId, at: now, grade: 1, durationMs: 1, origin: "alarm" },
  ];
  expect(studyCounts(state, log, deckId, now + 61_000)).toEqual({ new: 0, learning: 1, review: 0 });
  log.push({ kind: "void", id: "v", cardId, at: now + 62_000, targetId: "a" });
  expect(studyCounts(state, log, deckId, now + 62_000)).toEqual({ new: 1, learning: 0, review: 0 });
});

test("study counts separate due reviews from relearning and exclude suspended and future cards", () => {
  const { state, deckId, cardId } = fixture();
  const second = state.cards[1]!.id;
  const snapshot = (id: string, cardState: 2 | 3, due: number): LogEntry => ({
    kind: "snapshot",
    id: `snapshot-${id}`,
    cardId: id,
    at: now - 1000,
    state: {
      state: cardState,
      due,
      stability: 5,
      difficulty: 5,
      elapsed_days: 0,
      scheduled_days: 5,
      learning_steps: 0,
      reps: 2,
      lapses: 1,
    },
  });
  const log = [snapshot(cardId, 2, now), snapshot(second, 3, now)];
  expect(studyCounts(state, log, deckId, now)).toEqual({ new: 0, learning: 1, review: 1 });
  state.cards[0]!.fields.suspended = {
    value: true,
    hlc: { wallMs: now, counter: 0, deviceId: "a" },
  };
  expect(studyCounts(state, log, deckId, now)).toEqual({ new: 0, learning: 1, review: 0 });
  expect(studyCounts(state, [snapshot(second, 3, now + 1000)], deckId, now)).toEqual({
    new: 0,
    learning: 0,
    review: 0,
  });
});

test("a buried card leaves study until the next study day starts, and unburying brings it back", () => {
  let at = now;
  const c = new Collection({ deviceId: "a", now: () => at, random: () => new Uint8Array(16) });
  const deck = c.createDeck("Words");
  c.addBasicNote(deck.id, "one", "um");
  const cardId = c.snapshot().cards[0]!.id;
  c.buryCard(cardId);
  const nextDay = new Date(2026, 9, 29, 4).getTime();
  expect(studyQueue(c.snapshot(), [], deck.id, now)).toHaveLength(0);
  expect(studyCounts(c.snapshot(), [], deck.id, nextDay - 1)).toEqual({
    new: 0,
    learning: 0,
    review: 0,
  });
  expect(nextStudyCard(c.snapshot(), [], deck.id, nextDay)?.card.id).toBe(cardId);
  at = now + 1000;
  c.unburyCard(cardId);
  expect(studyQueue(c.snapshot(), [], deck.id, at).map((x) => x.card.id)).toEqual([cardId]);
});

test("burying a card that is missing or gone throws", () => {
  const c = new Collection({ deviceId: "a", now: () => now, random: () => new Uint8Array(16) });
  expect(() => c.buryCard("missing")).toThrow("Invalid card");
});

test("new-card intervals follow its preset learning steps without writing a review", () => {
  const { state, cardId, preset } = fixture();
  preset.fields.learningSteps.value = [2, 20];
  expect(nextIntervals(state, [], cardId, now)).toEqual({
    1: 120,
    2: 660,
    3: 1200,
    4: 8 * 86400,
  });
  expect(cardMemory(state, [], cardId, now)!.reps).toBe(0);
  expect(nextIntervals(state, [], "missing", now)).toBeUndefined();
});

test.each([1, 2, 3] as const)("intervals preview every grade from card state %i", (stateCode) => {
  const { state, cardId, preset } = fixture();
  const log: LogEntry[] = [
    {
      kind: "snapshot",
      id: "snapshot",
      cardId,
      at: now - 86400_000,
      state: {
        state: stateCode,
        due: now,
        last_review: now - 5 * 86400_000,
        stability: 5,
        difficulty: 5,
        elapsed_days: 5,
        scheduled_days: 5,
        learning_steps: 0,
        reps: 3,
        lapses: 1,
      },
    },
  ];
  const before = structuredClone(log);
  const intervals = nextIntervals(state, log, cardId, now)!;
  for (const grade of [1, 2, 3, 4] as const) {
    // Commit the answer through replay: the displayed interval must describe its actual due date.
    const answered = replayCard(
      cardId,
      [
        ...log,
        {
          kind: "review",
          id: "answer",
          cardId,
          at: now,
          grade,
          durationMs: 1,
          origin: "phone",
        },
      ],
      preset,
      now,
    );
    expect(intervals[grade]).toBe((answered.due.getTime() - now) / 1000);
    expect(intervals[grade]).toBeGreaterThan(0);
  }
  expect(log).toEqual(before);
});

test("intervals use the card's deck retention override and respond to undo", () => {
  const { state, cardId } = fixture();
  const original = nextIntervals(state, [], cardId, now)!;
  state.decks[0]!.fields.desiredRetention.value = 0.99;
  expect(nextIntervals(state, [], cardId, now)![4]).toBeLessThan(original[4]);
  const log: LogEntry[] = [
    { kind: "review", id: "answer", cardId, at: now, grade: 4, durationMs: 1, origin: "phone" },
    { kind: "void", id: "undo", cardId, at: now + 1, targetId: "answer" },
  ];
  expect(nextIntervals(state, log, cardId, now)).toEqual(nextIntervals(state, [], cardId, now));
});

test("preset edits leave answered cards alone and only change later answers", () => {
  const { state, cardId, preset } = fixture();
  const options = schedulingOptions(preset);
  const review: LogEntry = {
    kind: "review",
    id: "first",
    cardId,
    at: now,
    grade: 1,
    durationMs: 100,
    origin: "phone",
    options,
  };
  const before = cardMemory(state, [review], cardId, now);
  preset.fields.learningSteps.value[0] = 30;
  preset.fields.desiredRetention.value = 0.99;
  preset.fields.fsrsParameters.value[0] = 5;
  expect(cardMemory(state, [review], cardId, now)).toEqual(before);
  expect(options.learningSteps[0]).toBe(1);
  expect(options.fsrsParameters[0]).not.toBe(5);
  const later: LogEntry = {
    ...review,
    id: "later",
    at: now + 60_000,
    options: schedulingOptions(preset),
  };
  expect(cardMemory(state, [review, later], cardId, now)?.due.getTime()).toBe(
    later.at + 30 * 60_000,
  );
});

test("relearning steps and maximum interval apply only to later alarm answers", () => {
  const { state, cardId, preset } = fixture();
  const old: LogEntry = {
    kind: "review",
    id: "old",
    cardId,
    at: now,
    grade: 4,
    durationMs: 1,
    origin: "alarm",
    options: schedulingOptions(preset),
  };
  const before = cardMemory(state, [old], cardId, now);
  const c = new Collection(
    { deviceId: "a", now: () => now, random: () => new Uint8Array(16) },
    state,
  );
  c.updatePreset(preset.id, { relearningSteps: [3, 15], maximumInterval: 2 });
  const updated = c.snapshot();
  expect(cardMemory(updated, [old], cardId, now)).toEqual(before);
  const at = now + 10 * 86400_000;
  const answer: LogEntry = {
    ...old,
    id: "later",
    at,
    grade: 1,
    options: schedulingOptions(updated.presets[0]!),
  };
  expect(cardMemory(updated, [old, answer], cardId, at)!.due.getTime()).toBe(at + 180_000);
  expect(nextIntervals(updated, [old], cardId, at)![4]).toBe(2 * 86400);
});

test("random insertion order is stable across queue reads and differs from creation order", () => {
  let n = 0;
  const c = new Collection({
    deviceId: "a",
    now: () => now + n,
    random: () => new Uint8Array(16).fill(n++),
  });
  const deck = c.createDeck("Words");
  for (let i = 0; i < 12; i++) c.addBasicNote(deck.id, String(i), "back");
  const ids = () => studyQueue(c.snapshot(), [], deck.id, now + 100).map((x) => x.card.id);
  const sequential = ids();
  c.updatePreset(deck.fields.presetId.value, { insertionOrder: "random" });
  const random = ids();
  expect(random).not.toEqual(sequential);
  expect(ids()).toEqual(random);
  expect(new Set(random)).toEqual(new Set(sequential));
});

test.each(["suspend", "tagOnly"] as const)(
  "leech action %s runs on a Good alarm answer too",
  (action) => {
    const { state, cardId, preset } = fixture();
    const c = new Collection(
      { deviceId: "a", now: () => now, random: () => new Uint8Array(16) },
      state,
    );
    c.updatePreset(preset.id, { leechThreshold: 1, leechAction: action });
    const log: LogEntry[] = [
      {
        kind: "review",
        id: "easy",
        cardId,
        at: now - 10 * 86400_000,
        grade: 4,
        durationMs: 1,
        origin: "phone",
      },
      {
        kind: "review",
        id: "lapse",
        cardId,
        at: now - 86400_000,
        grade: 1,
        durationMs: 1,
        origin: "alarm",
      },
    ];
    const answer: LogEntry = {
      kind: "review",
      id: "good",
      cardId,
      at: now,
      grade: 3,
      durationMs: 1,
      origin: "alarm",
      options: schedulingOptions(c.snapshot().presets[0]!),
    };
    c.applyReviewEffects(log, answer);
    const after = c.snapshot();
    expect(
      after.notes.find((n) => n.id === after.cards[0]!.fields.noteId.value)!.fields.tags.value,
    ).toContain("leech");
    expect(after.cards[0]!.fields.suspended.value).toBe(action === "suspend");
  },
);

test("reset cards go behind untouched cards even with random insertion", () => {
  const { state, deckId, cardId, preset } = fixture();
  const c = new Collection(
    { deviceId: "a", now: () => now, random: () => new Uint8Array(16) },
    state,
  );
  c.updatePreset(preset.id, { insertionOrder: "random" });
  const log: LogEntry[] = [{ kind: "reset", id: "reset", cardId, at: now + 1 }];
  expect(studyQueue(c.snapshot(), log, deckId, now + 2).at(-1)!.card.id).toBe(cardId);
});
