import { expect, test } from "vite-plus/test";
import {
  Collection,
  replayCard,
  studyQueue,
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

import { studyDayStart, renderCard } from "./index.ts";
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
