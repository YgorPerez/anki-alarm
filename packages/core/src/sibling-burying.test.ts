import { expect, test } from "vite-plus/test";
import { Collection, studyQueue, dueInDays, type LogEntry } from "./index.ts";
const now = new Date(2026, 10, 1, 12).getTime();
function fixture() {
  let n = 0;
  const c = new Collection({
    deviceId: "a",
    now: () => now,
    random: () => new Uint8Array(16).fill(n++),
  });
  const deck = c.createDeck("Words");
  const basic = c.addBasicNote(deck.id, "one", "um");
  const type = c.snapshot().noteTypes[0]!;
  c.editNoteType(type.id, {
    name: "Both directions",
    fields: [
      { name: "Front", from: 0 },
      { name: "Back", from: 1 },
    ],
    templates: [
      type.fields.templates.value[0]!,
      { name: "Reverse", front: "{{Back}}", back: "{{Front}}" },
    ],
    css: "",
  });
  const state = c.snapshot();
  const [first, sibling] = state.cards.filter((card) => card.fields.noteId.value === basic.id);
  const answer: LogEntry = {
    id: "answer",
    kind: "review",
    cardId: first!.id,
    at: now,
    grade: 3,
    durationMs: 100,
    origin: "phone",
  };
  return { c, deck, first: first!, sibling: sibling!, answer, preset: state.presets[0]! };
}
test("new sibling burying skips a sibling until 4am and undo restores it", () => {
  const { c, deck, first, sibling, answer, preset } = fixture();
  c.updatePreset(preset.id, { buryNew: true });
  const applied = c.applySiblingBurying(answer, []);
  expect(c.snapshot().cards.find((card) => card.id === sibling.id)!.fields.buriedUntil.value).toBe(
    dueInDays(1, now),
  );
  expect(
    studyQueue(c.snapshot(), [applied], deck.id, now).map((item) => item.card.id),
  ).not.toContain(sibling.id);
  expect(
    c.snapshot().cards.find((card) => card.id === first.id)!.fields.buriedUntil.value,
  ).toBeNull();
  c.applySiblingBurying(
    { id: "undo", kind: "void", cardId: first.id, at: now, targetId: answer.id },
    [applied],
  );
  expect(studyQueue(c.snapshot(), [], deck.id, now).map((item) => item.card.id)).toContain(
    sibling.id,
  );
});

test.each([
  ["buryNew", 0],
  ["buryReviews", 2],
  ["buryLearning", 1],
  ["buryLearning", 3],
] as const)("%s selects siblings in memory state %i independently", (option, state) => {
  const { c, sibling, answer, preset } = fixture();
  const log: LogEntry[] =
    state === 0
      ? []
      : [
          {
            kind: "snapshot",
            id: "snapshot",
            cardId: sibling.id,
            at: now - 86400000,
            state: {
              due: now - 1000,
              stability: 3,
              difficulty: 5,
              elapsed_days: 1,
              scheduled_days: 1,
              reps: 1,
              lapses: 0,
              learning_steps: 0,
              state,
              last_review: now - 86400000,
            },
          },
        ];
  expect([
    preset.fields.buryNew.value,
    preset.fields.buryReviews.value,
    preset.fields.buryLearning.value,
  ]).toEqual([false, false, false]);
  c.applySiblingBurying(answer, log);
  expect(
    c.snapshot().cards.find((card) => card.id === sibling.id)!.fields.buriedUntil.value,
  ).toBeNull();
  c.updatePreset(preset.id, { [option]: true });
  c.applySiblingBurying(answer, log);
  expect(c.snapshot().cards.find((card) => card.id === sibling.id)!.fields.buriedUntil.value).toBe(
    dueInDays(1, now),
  );
});

test("siblings in another deck are buried, unrelated notes and suspended siblings stay unchanged", () => {
  const { c, sibling, first, answer, preset } = fixture();
  const other = c.createDeck("Other");
  c.moveCards([sibling.id], other.id);
  c.addBasicNote(other.id, "unrelated", "note");
  c.updatePreset(preset.id, { buryNew: true });
  c.setCardsSuspended([sibling.id], true);
  c.applySiblingBurying(answer, []);
  expect(c.snapshot().cards.every((card) => card.fields.buriedUntil.value === null)).toBe(true);
  c.setCardsSuspended([sibling.id], false);
  c.applySiblingBurying(answer, []);
  expect(
    c
      .snapshot()
      .cards.filter((card) => card.fields.buriedUntil.value !== null)
      .map((card) => card.id),
  ).toEqual([sibling.id]);
  expect(
    studyQueue(c.snapshot(), [], other.id, dueInDays(1, now)).map((item) => item.card.id),
  ).toContain(sibling.id);
  expect(
    c.snapshot().cards.find((card) => card.id === first.id)!.fields.buriedUntil.value,
  ).toBeNull();
});
