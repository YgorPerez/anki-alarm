import { expect, test } from "vite-plus/test";
import {
  alarmSession,
  answerUndo,
  awakeCheckSession,
  checkLogEntry,
  Collection,
  isBuried,
  mergeRecord,
  nextStudyCard,
  popUndo,
  pushUndo,
  runCommand,
  runStudyAction,
  UNDO_LIMIT,
  type Grade,
  type LogEntry,
  type UndoStack,
  type UndoStep,
} from "./index.ts";

const now = new Date(2026, 9, 30, 7).getTime();

function setup() {
  let seed = 0;
  const c = new Collection({
    deviceId: "phone",
    now: () => now,
    random: () => new Uint8Array(16).fill(seed++),
  });
  const deck = c.createDeck("Words");
  for (const front of ["one", "two", "three"]) c.addBasicNote(deck.id, front, "back");
  const state = c.snapshot();
  const card = (front: string) =>
    state.cards.find(
      (x) => state.notes.find((n) => n.id === x.fields.noteId.value)?.values[0]?.value === front,
    )!;
  return { c, deckId: deck.id, card };
}

const answer = (cardId: string, at: number, ringId?: string, grade: Grade = 3): LogEntry => ({
  kind: "review",
  id: `answer-${cardId}-${at}`,
  cardId,
  at,
  grade,
  durationMs: 1000,
  ...(ringId ? { origin: "alarm" as const, ringId } : { origin: "phone" as const }),
});

/** Reverses a step as the app does: a void for an answer, the step's command otherwise. */
function undo(c: Collection, log: LogEntry[], step: UndoStep, at: number) {
  if (step.kind === "command") {
    runCommand(c, step.command);
    return;
  }
  const entry: LogEntry = {
    kind: "void",
    id: `void-${step.entryId}`,
    cardId: step.cardId,
    at,
    targetId: step.entryId,
  };
  checkLogEntry(c.snapshot(), log, entry);
  log.push(entry);
}

test("one stack undoes answers, suspend, bury, flag and mark, newest first", () => {
  const { c, deckId, card } = setup();
  const one = card("one").id;
  const before = c.snapshot();
  const log: LogEntry[] = [];
  let stack: UndoStack = [];
  const act = (step: UndoStep) => (stack = pushUndo(stack, step));

  act(runStudyAction(c, { kind: "setCardFlag", cardId: one, flag: 2 }));
  act(runStudyAction(c, { kind: "setNoteMarked", cardId: one, marked: true }));
  const entry = answer(one, now);
  log.push(entry);
  act(answerUndo(entry));
  act(runStudyAction(c, { kind: "buryCard", cardId: card("two").id }));
  act(runStudyAction(c, { kind: "suspendNote", cardId: card("three").id }));
  expect(stack.map((s) => s.cardId)).toEqual([one, one, one, card("two").id, card("three").id]);

  const shown: string[] = [];
  for (let top = popUndo(stack); top; top = popUndo(stack)) {
    undo(c, log, top.step, now + 1);
    stack = top.rest;
    shown.push(nextStudyCard(c.snapshot(), log, deckId, now + 1, top.step.cardId)!.card.id);
  }
  // Each undo brings back the card it acted on.
  expect(shown).toEqual([card("three").id, card("two").id, one, one, one]);
  const after = c.snapshot();
  for (const x of after.cards) {
    const was = before.cards.find((b) => b.id === x.id)!;
    expect(x.fields.flag.value).toBe(was.fields.flag.value);
    expect(x.fields.suspended.value).toBe(false);
    expect(isBuried(x, now + 1)).toBe(false);
  }
  expect(after.notes.every((n) => !n.fields.tags.value.includes("marked"))).toBe(true);
  expect(stack).toEqual([]);
});

test("undoing a suspend note restores each card's own earlier suspension", () => {
  const { c, card } = setup();
  const one = card("one").id;
  c.setCardsSuspended([one], true);
  const step = runStudyAction(c, { kind: "suspendCard", cardId: one });
  undo(c, [], step, now);
  expect(c.snapshot().cards.find((x) => x.id === one)!.fields.suspended.value).toBe(true);
});

test("undoing a flag or mark puts back the value it replaced", () => {
  const { c, card } = setup();
  const one = card("one").id;
  c.setCardFlag(one, 5);
  const flag = runStudyAction(c, { kind: "setCardFlag", cardId: one, flag: 1 });
  const unmark = runStudyAction(c, { kind: "setNoteMarked", cardId: one, marked: false });
  undo(c, [], unmark, now);
  undo(c, [], flag, now);
  const state = c.snapshot();
  expect(state.cards.find((x) => x.id === one)!.fields.flag.value).toBe(5);
  expect(state.notes.every((n) => !n.fields.tags.value.includes("marked"))).toBe(true);
  expect(() => runStudyAction(c, { kind: "buryCard", cardId: "missing" })).toThrow("Invalid card");
});

test("an undo is a later edit, so it wins over a copy that only saw the action", () => {
  const { c, card } = setup();
  const one = card("one").id;
  const step = runStudyAction(c, { kind: "setCardFlag", cardId: one, flag: 4 });
  const synced = structuredClone(c.snapshot().cards.find((x) => x.id === one)!);
  undo(c, [], step, now);
  const local = c.snapshot().cards.find((x) => x.id === one)!;
  for (const merged of [mergeRecord(local, synced), mergeRecord(synced, local)])
    expect(merged.fields.flag.value).toBe(0);
});

test("only an answer has an answer undo", () => {
  expect(() => answerUndo({ kind: "reset", id: "r", cardId: "c", at: now })).toThrow(
    "Nothing to undo",
  );
});

test("the stack keeps the newest steps up to its limit", () => {
  let stack: UndoStack = [];
  for (let i = 0; i <= UNDO_LIMIT; i++)
    stack = pushUndo(stack, { kind: "void", cardId: "c", entryId: `e${i}` });
  expect(stack).toHaveLength(UNDO_LIMIT);
  expect(popUndo(stack)?.step).toEqual({ kind: "void", cardId: "c", entryId: `e${UNDO_LIMIT}` });
  expect(stack[0]).toEqual({ kind: "void", cardId: "c", entryId: "e1" });
  expect(popUndo([])).toBeUndefined();
});

test("on an alarm, undoing a grade takes it off the progress and brings its card back", () => {
  const { c, deckId, card } = setup();
  const state = c.snapshot();
  const minute = 60_000;
  const ring = (log: LogEntry[], at: number, undone?: string) =>
    alarmSession({
      collection: state,
      log,
      deckId,
      need: 3,
      ringId: "ring",
      now: at,
      ...(undone ? { undone } : {}),
    });
  // "two" failed in normal study a moment ago: it is due again in a minute.
  const log: LogEntry[] = [answer(card("two").id, now, undefined, 1)];
  const first = ring(log, now).next!.card.id;
  expect(first).toBe(card("one").id);
  const entry = answer(first, now, "ring");
  log.push(entry);
  expect(ring(log, now)).toMatchObject({ right: 1 });
  undo(c, log, answerUndo(entry), now + 2 * minute);
  expect(ring(log, now + 2 * minute).next!.card.id).toBe(card("two").id);
  const after = ring(log, now + 2 * minute, first);
  expect(after.right).toBe(0);
  expect(after.next!.card.id).toBe(first);
});

test("undoing a bury on an alarm or awake check shows that card again, without progress", () => {
  const { c, deckId } = setup();
  const input = { log: [], deckId, need: 3, ringId: "ring", now };
  const first = alarmSession({ ...input, collection: c.snapshot() }).next!.card.id;
  const step = runStudyAction(c, { kind: "buryCard", cardId: first });
  expect(alarmSession({ ...input, collection: c.snapshot() }).next!.card.id).not.toBe(first);
  undo(c, [], step, now);
  const collection = c.snapshot();
  const back = alarmSession({ ...input, collection, undone: first });
  expect(back).toMatchObject({ right: 0, next: { card: { id: first } } });
  const check = awakeCheckSession({
    collection,
    log: [],
    deckId,
    checkId: "check",
    now,
    undone: first,
  });
  expect(check).toMatchObject({ passed: false, next: { card: { id: first } } });
});
