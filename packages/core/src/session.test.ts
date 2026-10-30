import { describe, expect, test } from "vite-plus/test";
import {
  alarmSession,
  awakeCheckSession,
  Collection,
  newAlarm,
  readAlarm,
  ringNeed,
  type Grade,
  type LogEntry,
} from "./index.ts";

const now = new Date(2026, 9, 28, 7).getTime();
const day = 86_400_000;
let seed = 0;
const journalEvent = (kind: string, alarmId: string, ringId: string | null) => ({
  kind,
  alarmId,
  ringId,
});
function collection() {
  return new Collection({
    deviceId: "a",
    now: () => now,
    random: () => new Uint8Array(16).fill(seed++),
  });
}
const review = (
  cardId: string,
  grade: Grade,
  at: number,
  extra: Partial<LogEntry & { kind: "review" }> = {},
): LogEntry => ({
  kind: "review",
  id: `${cardId}-${at}-${grade}`,
  cardId,
  at,
  grade,
  durationMs: 1000,
  origin: "phone",
  ...extra,
});
const inRing = (cardId: string, grade: Grade, at: number) =>
  review(cardId, grade, at, { origin: "alarm", ringId: "ring" });

/** A deck with four cards: one overdue, one due soonest-but-ahead, one due later, one new. */
function deckWithEveryKind() {
  const c = collection();
  const deck = c.createDeck("Words");
  for (const front of ["overdue", "ahead-soon", "ahead-later", "new"])
    c.addBasicNote(deck.id, front, "back");
  const state = c.snapshot();
  const id = (front: string) =>
    state.cards.find(
      (card) =>
        state.notes.find((n) => n.id === card.fields.noteId.value)?.values[0]?.value === front,
    )!.id;
  const log = [
    review(id("overdue"), 4, now - 60 * day),
    review(id("ahead-later"), 4, now - day),
    review(id("ahead-soon"), 4, now - 2 * day),
  ];
  return { state, deckId: deck.id, id, log };
}
const session = (
  setup: ReturnType<typeof deckWithEveryKind>,
  log: readonly LogEntry[],
  need = 10,
  at = now,
) =>
  alarmSession({
    collection: setup.state,
    log: [...setup.log, ...log],
    deckId: setup.deckId,
    need,
    ringId: "ring",
    now: at,
  });

describe("alarm session", () => {
  test("takes due cards, then new cards, then reviews ahead soonest first", () => {
    const setup = deckWithEveryKind();
    const order: string[] = [];
    const answers: LogEntry[] = [];
    for (let i = 0; i < 4; i++) {
      const next = session(setup, answers).next!;
      order.push(next.card.id);
      answers.push(inRing(next.card.id, 3, now + i));
    }
    expect(order).toEqual(
      ["overdue", "new", "ahead-soon", "ahead-later"].map((front) => setup.id(front)),
    );
  });

  test("daily limits never starve the session", () => {
    const setup = deckWithEveryKind();
    const preset = setup.state.presets[0]!;
    preset.fields.newPerDay.value = 0;
    preset.fields.reviewsPerDay.value = 0;
    expect(session(setup, []).next?.card.id).toBe(setup.id("overdue"));
    expect(session(setup, [inRing(setup.id("overdue"), 3, now)]).next?.card.id).toBe(
      setup.id("new"),
    );
  });

  test("only Good and Easy in this ring count toward N, and N right dismisses", () => {
    const setup = deckWithEveryKind();
    const answers = [
      inRing(setup.id("overdue"), 1, now),
      inRing(setup.id("new"), 2, now + 1),
      inRing(setup.id("ahead-soon"), 3, now + 2),
      review(setup.id("ahead-later"), 4, now + 3, { origin: "alarm", ringId: "earlier ring" }),
      review(setup.id("ahead-later"), 4, now + 4),
    ];
    expect(session(setup, answers, 2)).toMatchObject({ right: 1, need: 2, done: false });
    const done = session(setup, [...answers, inRing(setup.id("ahead-later"), 4, now + 5)], 2);
    expect(done).toMatchObject({ right: 2, need: 2, done: true, next: null });
  });

  test("a voided answer stops counting", () => {
    const setup = deckWithEveryKind();
    const answer = inRing(setup.id("overdue"), 3, now);
    const voided: LogEntry = {
      kind: "void",
      id: "v",
      cardId: answer.cardId,
      at: now + 1,
      targetId: answer.id,
    };
    expect(session(setup, [answer, voided], 1)).toMatchObject({ right: 0, done: false });
  });

  test("Again and Hard bring the card back after other cards", () => {
    const setup = deckWithEveryKind();
    const missed = inRing(setup.id("overdue"), 1, now);
    expect(session(setup, [missed]).next?.card.id).toBe(setup.id("new"));
    const afterOne = [missed, inRing(setup.id("new"), 3, now + 1)];
    expect(session(setup, afterOne).next?.card.id).toBe(setup.id("ahead-soon"));
    const afterTwo = [...afterOne, inRing(setup.id("ahead-soon"), 3, now + 2)];
    expect(session(setup, afterTwo).next).toMatchObject({
      card: { id: setup.id("overdue") },
      again: true,
    });
    const hard = [...afterTwo, inRing(setup.id("overdue"), 2, now + 3)];
    expect(session(setup, hard).next?.card.id).toBe(setup.id("ahead-later"));
  });

  test("a missed card comes straight back when nothing else is left", () => {
    const c = collection();
    const deck = c.createDeck("One");
    c.addBasicNote(deck.id, "only", "card");
    const state = c.snapshot();
    const cardId = state.cards[0]!.id;
    const input = { collection: state, deckId: deck.id, need: 2, ringId: "ring", now };
    expect(alarmSession({ ...input, log: [inRing(cardId, 1, now)] }).next?.card.id).toBe(cardId);
    // A deck smaller than N still lets the session finish.
    expect(alarmSession({ ...input, log: [inRing(cardId, 3, now)] }).next?.card.id).toBe(cardId);
  });

  test("subdecks are included, sibling decks are not", () => {
    const c = collection();
    const parent = c.createDeck("Idiomas");
    const child = c.createDeck("Idiomas::Inglês");
    const sibling = c.createDeck("Idiomas2");
    c.addBasicNote(sibling.id, "sibling", "x");
    c.addBasicNote(child.id, "child", "x");
    const state = c.snapshot();
    const input = { collection: state, log: [], need: 1, ringId: "ring", now };
    expect(alarmSession({ ...input, deckId: parent.id }).next?.note.values[0]?.value).toBe("child");
    expect(alarmSession({ ...input, deckId: child.id }).next?.note.values[0]?.value).toBe("child");
  });

  test("schedules with the deck's desired retention, not only its preset's", () => {
    const c = collection();
    const deck = c.createDeck("Words");
    c.addBasicNote(deck.id, "studied", "x");
    c.addBasicNote(deck.id, "new", "x");
    const state = c.snapshot();
    const studied = state.cards.find(
      (card) =>
        state.notes.find((n) => n.id === card.fields.noteId.value)?.values[0]?.value === "studied",
    )!.id;
    // Easy three days ago: not due yet at 90% retention, due at 99%.
    const log = [review(studied, 4, now - 3 * day)];
    const input = { collection: state, log, deckId: deck.id, need: 1, ringId: "ring", now };
    expect(alarmSession(input).next?.card.id).not.toBe(studied);
    state.decks[0]!.fields.desiredRetention.value = 0.99;
    expect(alarmSession(input).next?.card.id).toBe(studied);
    expect(
      awakeCheckSession({ collection: state, log, deckId: deck.id, checkId: "check", now }).next
        ?.card.id,
    ).toBe(studied);
  });

  test("suspended cards come only when nothing else is left, so suspending never ends an alarm", () => {
    const setup = deckWithEveryKind();
    const state = structuredClone(setup.state);
    for (const card of state.cards)
      if (card.id !== setup.id("new")) card.fields.suspended.value = true;
    const only = { ...setup, state };
    expect(session(only, []).next?.card.id).toBe(setup.id("new"));
    expect(session(only, [inRing(setup.id("new"), 4, now)], 1).done).toBe(true);
    for (const card of state.cards) card.fields.suspended.value = true;
    const last = session(only, []);
    expect(last.next).not.toBeNull();
    expect(last).toMatchObject({ right: 0, done: false });
  });

  test("a suspended card comes after buried ones, and the awake check gets one too", () => {
    const setup = deckWithEveryKind();
    const c = new Collection(
      { deviceId: "a", now: () => now, random: () => new Uint8Array(16) },
      setup.state,
    );
    const ids = setup.state.cards.map((card) => card.id);
    c.setCardsSuspended(
      ids.filter((id) => id !== setup.id("new")),
      true,
    );
    c.buryCard(setup.id("new"));
    const check = (state: typeof setup.state) =>
      awakeCheckSession({
        collection: state,
        log: setup.log,
        deckId: setup.deckId,
        checkId: "check",
        now,
      });
    expect(session({ ...setup, state: c.snapshot() }, []).next?.card.id).toBe(setup.id("new"));
    expect(check(c.snapshot()).next?.card.id).toBe(setup.id("new"));
    c.setCardsSuspended([setup.id("new")], true);
    expect(check(c.snapshot())).toMatchObject({ passed: false });
    expect(check(c.snapshot()).next).not.toBeNull();
  });

  test("burying the current card brings another without counting toward N", () => {
    const setup = deckWithEveryKind();
    const c = new Collection(
      { deviceId: "a", now: () => now, random: () => new Uint8Array(16) },
      setup.state,
    );
    const before = session(setup, [inRing(setup.id("overdue"), 4, now)], 3);
    expect(before.next?.card.id).toBe(setup.id("new"));
    c.buryCard(setup.id("new"));
    const after = session(
      { ...setup, state: c.snapshot() },
      [inRing(setup.id("overdue"), 4, now)],
      3,
    );
    expect(after).toMatchObject({ right: 1, need: 3, done: false });
    expect(after.next?.card.id).toBe(setup.id("ahead-soon"));
    c.buryCard(setup.id("overdue"));
    expect(
      awakeCheckSession({
        collection: c.snapshot(),
        log: setup.log,
        deckId: setup.deckId,
        checkId: "check",
        now,
      }).next?.card.id,
    ).toBe(setup.id("ahead-soon"));
  });

  test("an alarm whose cards are all buried still shows them, so burying never ends it", () => {
    const setup = deckWithEveryKind();
    const c = new Collection(
      { deviceId: "a", now: () => now, random: () => new Uint8Array(16) },
      setup.state,
    );
    for (const card of setup.state.cards) if (card.id !== setup.id("new")) c.buryCard(card.id);
    expect(session({ ...setup, state: c.snapshot() }, []).next?.card.id).toBe(setup.id("new"));
    c.buryCard(setup.id("new"));
    expect(session({ ...setup, state: c.snapshot() }, []).next?.card.id).toBe(setup.id("overdue"));
  });

  test("an alarm with no deck or no cards has nothing to show", () => {
    const c = collection();
    const empty = c.createDeck("Empty");
    const state = c.snapshot();
    const input = { collection: state, log: [], need: 3, ringId: "ring", now };
    expect(alarmSession({ ...input, deckId: null })).toMatchObject({ next: null, done: false });
    expect(alarmSession({ ...input, deckId: empty.id })).toMatchObject({ next: null, done: false });
    expect(alarmSession({ ...input, deckId: "deleted" })).toMatchObject({ next: null });
  });

  test("an alarm folded into the ring makes the session need the larger N", () => {
    const morning = { ...newAlarm("a"), need: 3 };
    const ring = { id: "ring-1", alarm: morning };
    const alarms = [morning, { ...newAlarm("b"), need: 5 }, { ...newAlarm("c"), need: 2 }];
    expect(ringNeed(ring, [], alarms)).toBe(3);
    expect(ringNeed(ring, [journalEvent("absorbed", "c", "ring-1")], alarms)).toBe(3);
    expect(
      ringNeed(
        ring,
        [journalEvent("absorbed", "b", "ring-1"), journalEvent("absorbed", "c", "ring-1")],
        alarms,
      ),
    ).toBe(5);
  });

  test("only alarms folded into this ring count toward its N", () => {
    const morning = { ...newAlarm("a"), need: 3 };
    const ring = { id: "ring-2", alarm: morning };
    const alarms = [morning, { ...newAlarm("b"), need: 8 }];
    expect(ringNeed(ring, [journalEvent("absorbed", "b", "ring-1")], alarms)).toBe(3);
    expect(ringNeed(ring, [journalEvent("absorbed", "b", null)], alarms)).toBe(3);
    expect(ringNeed(ring, [journalEvent("ringStarted", "b", "ring-2")], alarms)).toBe(3);
    // An absorbed alarm deleted since then no longer raises N.
    expect(ringNeed(ring, [journalEvent("absorbed", "b", "ring-2")], [morning])).toBe(3);
  });
});

const check = (setup: ReturnType<typeof deckWithEveryKind>, log: readonly LogEntry[]) =>
  awakeCheckSession({
    collection: setup.state,
    log: [...setup.log, ...log],
    deckId: setup.deckId,
    checkId: "check",
    now,
  });
const inCheck = (cardId: string, grade: Grade, at: number) =>
  review(cardId, grade, at, { origin: "alarm", ringId: "check" });

describe("awake check", () => {
  test("shows one card from the alarm's deck, picked as a session's first card", () => {
    const setup = deckWithEveryKind();
    expect(check(setup, [])).toMatchObject({
      passed: false,
      next: { card: { id: setup.id("overdue") }, again: false },
    });
    // The ring's answers moved that card on; the check doesn't inherit their progress.
    expect(check(setup, [inRing(setup.id("overdue"), 4, now - 1)]).next?.card.id).toBe(
      setup.id("new"),
    );
  });

  test("any grade ends it, Again included", () => {
    const setup = deckWithEveryKind();
    expect(check(setup, [inCheck(setup.id("overdue"), 1, now)])).toEqual({
      passed: true,
      next: null,
    });
  });

  test("an answer for the ring or a voided answer doesn't end it", () => {
    const setup = deckWithEveryKind();
    const answer = inCheck(setup.id("overdue"), 3, now);
    const voided: LogEntry = {
      kind: "void",
      id: "v",
      cardId: answer.cardId,
      at: now + 1,
      targetId: answer.id,
    };
    expect(check(setup, [inRing(setup.id("new"), 3, now)]).passed).toBe(false);
    expect(check(setup, [answer, voided]).passed).toBe(false);
  });
});

describe("stored alarms", () => {
  test("alarms saved before decks and N get no deck and the default N", () => {
    const { deckId: _deck, need: _need, ...legacy } = newAlarm("a");
    expect(readAlarm({ ...legacy, sound: null })).toEqual({
      ...legacy,
      sound: { kind: "default" },
      deckId: null,
      need: newAlarm("b").need,
    });
    expect(readAlarm({ ...legacy, deckId: "d", need: 7 })).toMatchObject({ deckId: "d", need: 7 });
    expect(readAlarm({ ...legacy, deckId: 4, need: 0 })).toMatchObject({ deckId: null, need: 1 });
  });
});

test("suspending the current card replaces it without counting an answer or passing an awake check", () => {
  const setup = deckWithEveryKind();
  const c = new Collection(
    { deviceId: "a", now: () => now, random: () => new Uint8Array(16) },
    setup.state,
  );
  const first = session(setup, []).next!.card.id;
  c.setCardsSuspended([first], true);
  setup.state = c.snapshot();
  expect(session(setup, [])).toMatchObject({ right: 0, done: false });
  expect(session(setup, []).next?.card.id).not.toBe(first);
  expect(
    awakeCheckSession({
      collection: setup.state,
      log: setup.log,
      deckId: setup.deckId,
      checkId: "check",
      now,
    }),
  ).toMatchObject({ passed: false });
  c.setCardsSuspended(
    setup.state.cards.map((x) => x.id),
    true,
  );
  const last = alarmSession({
    collection: c.snapshot(),
    log: [],
    deckId: setup.deckId,
    ringId: "ring",
    need: 1,
    now,
  });
  expect(last).toMatchObject({ right: 0, done: false });
  expect(last.next).not.toBeNull();
});
