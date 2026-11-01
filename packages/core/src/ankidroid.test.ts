import { describe, expect, test } from "vite-plus/test";
import {
  Collection,
  linkOfferPlan,
  DEFAULT_FSRS_PARAMETERS,
  browseCards,
  ankiDroidAccess,
  presetFromOptions,
  ankiDroidScheduler,
  ankiDroidSyncWaitMs,
  cardId,
  cardsStayInApp,
  importId,
  linkableAnkiDroidDecks,
  replayCard,
  studyQueue,
  syncBackBuries,
  syncBackBuryPlan,
  syncBackPlan,
  syncBackQueue,
  type AnkiDroidSource,
  type LogEntry,
} from "./index.ts";

const now = Date.UTC(2026, 9, 28, 12);
const environment = (deviceId = "phone-a") => {
  let n = 0;
  return { deviceId, now: () => now, random: () => new Uint8Array(16).fill(n++) };
};
const options = JSON.stringify({
  id: 1,
  name: "Default",
  new: { perDay: 15, delays: [1, 10] },
  rev: { perDay: 150 },
  desiredRetention: 0.85,
});
const card = (over: Partial<AnkiDroidSource["cards"][number]>) => ({
  id: 9001,
  noteId: 501,
  ord: 0,
  deckId: 1700000000001,
  originalDeckId: 0,
  reps: 0,
  lapses: 0,
  type: 0,
  queue: 0,
  due: 1,
  interval: 0,
  left: 0,
  stability: null,
  difficulty: null,
  lastReviewSecs: null,
  ...over,
});
const source = (): AnkiDroidSource => ({
  deckId: 1700000000001,
  decks: [
    { id: 1, name: "Default", options, filtered: false },
    { id: 1700000000001, name: "Japanese", options, filtered: false },
    { id: 1700000000002, name: "Japanese::Kanji", options, filtered: false },
  ],
  noteTypes: [
    {
      id: 1600000000000,
      name: "Basic (and reversed card)",
      fieldNames: "Front\u001fBack",
      css: ".card{color:red}",
      cloze: false,
      templates: [
        { ord: 1, name: "Card 2", front: "{{Back}}", back: "{{FrontSide}}<hr>{{Front}}" },
        { ord: 0, name: "Card 1", front: "{{Front}}", back: "{{FrontSide}}<hr>{{Back}}" },
      ],
    },
  ],
  notes: [
    {
      id: 501,
      guid: "abc",
      noteTypeId: 1600000000000,
      mod: 1_760_000_000,
      tags: " verb n5 ",
      fields: "食べる\u001feat",
    },
  ],
  cards: [
    card({}),
    card({
      id: 9002,
      ord: 1,
      deckId: 1700000000002,
      reps: 4,
      lapses: 1,
      type: 2,
      queue: 2,
      due: 20000,
      interval: 12,
      stability: 14.5,
      difficulty: 6.2,
      lastReviewSecs: now / 1000 - 2 * 86_400,
    }),
  ],
});

test("AnkiDroid's screens say why linking isn't possible, and from which version it is", () => {
  expect(ankiDroidAccess(null)).toBe("missing");
  expect(ankiDroidAccess({ versionCode: 22303300, permission: "granted" })).toBe("outdated");
  // ABI split builds add 100000000 per ABI to the version code.
  expect(ankiDroidAccess({ versionCode: 322303300, permission: "granted" })).toBe("outdated");
  expect(ankiDroidAccess({ versionCode: 22400300, permission: "denied" })).toBe("permission");
  expect(ankiDroidAccess({ versionCode: 322500300, permission: "granted" })).toBe("ready");
});

test("Sync AnkiDroid leaves five minutes between requests", () => {
  expect(ankiDroidSyncWaitMs(null, now)).toBe(0);
  expect(ankiDroidSyncWaitMs(now - 60_000, now)).toBe(240_000);
  expect(ankiDroidSyncWaitMs(now - 299_999, now)).toBe(1);
  expect(ankiDroidSyncWaitMs(now - 300_000, now)).toBe(0);
  // A phone clock set back mustn't lock the button.
  expect(ankiDroidSyncWaitMs(now + 60_000, now)).toBe(0);
});

const withTags = (tags: string, mod = 1_760_000_000) => {
  const linked = source();
  linked.notes[0] = { ...linked.notes[0]!, tags, mod };
  return linked;
};

/** The preset a deck gets when linked with these options. */
const linkedPreset = (json: object) => {
  const linked = source();
  linked.decks = linked.decks.map((d) => ({ ...d, options: JSON.stringify(json) }));
  const c = new Collection(environment());
  c.linkAnkiDroid(linked);
  return c.snapshot().presets[0]!.fields;
};

test("a linked deck starts with its AnkiDroid options' display order", () => {
  expect(
    linkedPreset({
      newGatherPriority: 5,
      newSortOrder: 3,
      newMix: 2,
      interdayLearningMix: 1,
      reviewOrder: 12,
    }),
  ).toMatchObject({
    newGatherPriority: { value: "deckThenRandomNotes" },
    newSortOrder: { value: "randomNoteThenTemplate" },
    newMix: { value: "before" },
    interdayLearningMix: { value: "after" },
    reviewOrder: { value: "relativeOverdueness" },
  });
  // Older options and numbers from a later Anki take Anki's defaults.
  expect(linkedPreset({ newMix: 99 })).toMatchObject({
    newGatherPriority: { value: "deck" },
    newMix: { value: "mix" },
  });
});

test("linking takes AnkiDroid's mark; afterwards a pull keeps the app's", () => {
  const c = new Collection(environment());
  c.linkAnkiDroid(withTags("verb marked"));
  const tags = () => c.snapshot().notes[0]!.fields.tags.value;
  const noteId = c.snapshot().notes[0]!.id;
  expect(tags()).toEqual(["verb", "marked"]);

  c.setNoteMarked(noteId, false);
  c.linkAnkiDroid(withTags("verb n4 marked", now / 1000 + 60));
  expect(tags()).toEqual(["verb", "n4"]);

  c.setNoteMarked(noteId, true);
  c.linkAnkiDroid(withTags("verb n3", now / 1000 + 120));
  expect(tags()).toEqual(["verb", "n3", "marked"]);
});

test("a note already here takes AnkiDroid's mark when first linked, however old its mod", () => {
  const before = new Collection(environment());
  before.linkAnkiDroid(withTags("verb"));
  const state = before.snapshot();
  // As an .apkg import leaves it: the same ids, in a deck nothing has linked.
  for (const deck of state.decks) delete deck.fields.linkedBy;
  const c = new Collection(environment(), state);
  c.linkAnkiDroid(withTags("verb marked", 1_000));
  expect(c.snapshot().notes[0]!.fields.tags.value).toEqual(["verb", "marked"]);
});

test("a note marked here before its first link stays marked", () => {
  const before = new Collection(environment());
  before.linkAnkiDroid(withTags("verb"));
  const state = before.snapshot();
  for (const deck of state.decks) delete deck.fields.linkedBy;
  const c = new Collection(environment(), state);
  c.setNoteMarked(state.notes[0]!.id, true);
  c.linkAnkiDroid(withTags("verb"));
  expect(c.snapshot().notes[0]!.fields.tags.value).toEqual(["verb", "marked"]);
});

test("filtered decks are not offered for linking, and the list is sorted by name", () => {
  const decks = [
    ...source().decks,
    { id: 77, name: "Filtered Deck 1", options: "{}", filtered: true },
  ];
  expect(linkableAnkiDroidDecks(decks).map((d) => d.name)).toEqual([
    "Default",
    "Japanese",
    "Japanese::Kanji",
  ]);
});

test("a linked deck's AnkiDroid cards keep Forget and Set due date in the app; its own cards don't", () => {
  const c = new Collection(environment());
  c.linkAnkiDroid(source());
  const own = c.createDeck("Own");
  c.addBasicNote(own.id, "casa", "house");
  const state = c.snapshot();
  const fromAnkiDroid = state.cards.filter((item) => item.anki);
  const added = state.cards.filter((item) => !item.anki);
  expect(fromAnkiDroid.length).toBeGreaterThan(0);
  expect(cardsStayInApp(state, fromAnkiDroid)).toBe(true);
  expect(cardsStayInApp(state, added)).toBe(false);
});

test("linking keeps AnkiDroid's ids, records the phone, and imports subdecks, notes and cards", () => {
  const c = new Collection(environment());
  const { deckId } = c.linkAnkiDroid(source());
  const state = c.snapshot();
  expect(deckId).toBe(importId("deck", 1700000000001));
  expect(state.decks.map((d) => [d.fields.name.value, d.fields.linkedBy?.value, d.anki])).toEqual([
    ["Japanese", "phone-a", { id: 1700000000001 }],
    ["Japanese::Kanji", "phone-a", { id: 1700000000002 }],
  ]);
  const preset = state.presets[0]!;
  expect(preset.id).toBe(importId("preset", 1, "Default"));
  expect(preset.fields.newPerDay.value).toBe(15);
  expect(preset.fields.reviewsPerDay.value).toBe(150);
  expect(preset.fields.desiredRetention.value).toBe(0.85);
  expect(preset.fields.learningSteps.value).toEqual([1, 10]);
  const type = state.noteTypes[0]!;
  expect(type.id).toBe(importId("noteType", 1600000000000));
  expect(type.anki).toEqual({ id: 1600000000000 });
  expect(type.fields.fieldNames.value).toEqual(["Front", "Back"]);
  expect(type.fields.templates.value.map((t) => t.name)).toEqual(["Card 1", "Card 2"]);
  const note = state.notes[0]!;
  expect(note.id).toBe(importId("note", "abc"));
  expect(note.anki).toEqual({ id: 501, guid: "abc" });
  expect(note.values.map((v) => v.value)).toEqual(["食べる", "eat"]);
  expect(note.fields.tags.value).toEqual(["verb", "n5"]);
  expect(state.cards[0]!.fields.deckId.value).toBe(deckId);
  expect(state.cards.map((x) => [x.id, x.fields.ordinal.value, x.anki])).toEqual([
    [cardId(note.id, 0), 0, { id: 9001 }],
    [cardId(note.id, 1), 1, { id: 9002 }],
  ]);
  expect(state.cards[1]!.fields.deckId.value).toBe(importId("deck", 1700000000002));
});

test("reviewed cards start from a snapshot of AnkiDroid's state, timed at its last review", () => {
  const c = new Collection(environment());
  const { snapshots } = c.linkAnkiDroid(source());
  const state = c.snapshot();
  const reviewed = state.cards[1]!;
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]).toMatchObject({
    kind: "snapshot",
    cardId: reviewed.id,
    at: now - 2 * 86_400_000,
    state: { stability: 14.5, difficulty: 6.2, reps: 4, lapses: 1, scheduled_days: 12 },
  });
  const memory = replayCard(reviewed.id, snapshots, state.presets[0]!, now);
  expect(memory.due.getTime()).toBe(now + 10 * 86_400_000);
  expect(memory.stability).toBe(14.5);
  // The new card is studied; the review card isn't due for ten days.
  const queue = studyQueue(state, snapshots, importId("deck", 1700000000002), now);
  expect(queue).toEqual([]);
});

test("relinking the same deck gives the same records and snapshots, and keeps newer local edits", () => {
  const first = new Collection(environment());
  const once = first.linkAnkiDroid(source());
  const noteId = first.snapshot().notes[0]!.id;
  first.editNote(noteId, ["食べる", "to eat"]);
  const again = first.linkAnkiDroid(source());
  expect(again.snapshots.map((s) => s.id)).toEqual(once.snapshots.map((s) => s.id));
  const state = first.snapshot();
  expect(state.notes).toHaveLength(1);
  expect(state.cards).toHaveLength(2);
  expect(state.notes[0]!.values[1]!.value).toBe("to eat");

  // A field edited in AnkiDroid after our last change to it comes in.
  const edited = source();
  edited.notes[0]!.mod = now / 1000 + 60;
  edited.notes[0]!.fields = "食べる\u001fto eat (food)";
  const later = new Collection({ ...environment(), now: () => now + 120_000 }, state);
  later.linkAnkiDroid(edited);
  expect(later.snapshot().notes[0]!.values[1]!.value).toBe("to eat (food)");

  // Another phone that links it becomes the one that pulls.
  const other = new Collection(environment("phone-b"), later.snapshot());
  other.linkAnkiDroid(source());
  expect(other.snapshot().decks.every((d) => d.fields.linkedBy?.value === "phone-b")).toBe(true);
});

test("a linked deck the user deleted is not brought back", () => {
  const c = new Collection(environment());
  const { deckId } = c.linkAnkiDroid(source());
  c.deleteDeck(deckId);
  expect(() => c.linkAnkiDroid(source())).toThrow("Linked deck was deleted");
});

test("Basic records stored before imported note types load in the current shape", () => {
  const hlc = { wallMs: 5, counter: 0, deviceId: "phone-a" };
  // Stored JSON from before this shape, read back as SQLite returns it; the constructor upgrades it.
  const stored = JSON.stringify({
    decks: [],
    presets: [],
    cards: [],
    tombstones: [],
    noteTypes: [
      {
        id: "t",
        fields: {
          name: { value: "Basic", hlc },
          fieldNames: { value: ["Front", "Back"], hlc },
          frontTemplate: { value: "{{Front}}", hlc },
          backTemplate: { value: "{{Back}}", hlc },
          css: { value: "", hlc },
        },
      },
    ],
    notes: [
      {
        id: "n",
        fields: {
          deckId: { value: "d", hlc },
          noteTypeId: { value: "t", hlc },
          front: { value: "casa", hlc },
          back: { value: "house", hlc },
        },
      },
    ],
  });
  const c = new Collection(environment(), JSON.parse(stored));
  const state = c.snapshot();
  expect(state.notes[0]!.values.map((v) => v.value)).toEqual(["casa", "house"]);
  expect(state.notes[0]!.fields.tags.value).toEqual([]);
  expect(state.noteTypes[0]!.fields.templates.value).toEqual([
    { name: "Card 1", front: "{{Front}}", back: "{{Back}}" },
  ]);
  expect(state.noteTypes[0]!.fields.kind.value).toBe("standard");
});

const review = (
  id: string,
  reviewed: string,
  at: number,
  over: Partial<{ grade: 1 | 2 | 3 | 4; origin: "phone" | "web" | "alarm" | "import" }> = {},
): LogEntry => ({
  kind: "review",
  id,
  cardId: reviewed,
  at,
  grade: over.grade ?? 3,
  durationMs: 4200,
  origin: over.origin ?? "phone",
});
const linked = () => {
  const c = new Collection(environment());
  const { snapshots } = c.linkAnkiDroid(source());
  const state = c.snapshot();
  const [fresh, reviewed] = state.cards;
  return { c, state, snapshots, fresh: fresh!, reviewed: reviewed! };
};

test("sync back sends this phone's reviews of linked cards from any origin, in answer-time order", () => {
  const { c, state, snapshots, fresh, reviewed } = linked();
  const own = c.createDeck("Mine");
  c.addBasicNote(own.id, "casa", "house");
  const mine = c.snapshot().cards.find((x) => x.fields.deckId.value === own.id)!;
  const log: LogEntry[] = [
    ...snapshots,
    review("r3", reviewed.id, now + 3000, { origin: "alarm", grade: 1 }),
    review("r1", fresh.id, now + 1000, { origin: "web", grade: 4 }),
    review("r2", reviewed.id, now + 2000),
    review("imported", reviewed.id, now - 9000, { origin: "import" }),
    review("undone", fresh.id, now + 2500),
    { kind: "void", id: "v", cardId: fresh.id, at: now + 2600, targetId: "undone" },
    review("own", mine.id, now + 4000),
    review("sent", fresh.id, now + 500),
  ];
  const queue = syncBackQueue(c.snapshot(), log, "phone-a", new Set(["sent"]));
  const answer = (entryId: string, x: typeof fresh, ord: number, ease: number) => ({
    entryId,
    cardId: x.id,
    deckId: x.fields.deckId.value,
    noteId: 501,
    ord,
    ease,
    timeTakenMs: 4200,
  });
  expect(queue).toEqual([
    answer("r1", fresh, 0, 4),
    answer("r2", reviewed, 1, 3),
    answer("r3", reviewed, 1, 1),
  ]);
  // Another phone owns the deck after it links it; this one stops sending.
  const other = new Collection(environment("phone-b"), state);
  other.linkAnkiDroid(source());
  expect(syncBackQueue(other.snapshot(), log, "phone-a", new Set())).toEqual([]);
});

test("sync back holds answers for cards suspended or buried in AnkiDroid and drops deleted cards", () => {
  const { state, snapshots, fresh, reviewed } = linked();
  const log = [
    ...snapshots,
    review("a", fresh.id, now + 1000),
    review("b", reviewed.id, now + 2000),
  ];
  const queue = syncBackQueue(state, log, "phone-a", new Set());
  const [ankiFresh, ankiReviewed] = source().cards;
  const buried = syncBackPlan(
    state,
    log,
    queue,
    [{ ...ankiFresh!, queue: -3 }, ankiReviewed!],
    new Map(),
    now,
  );
  expect(buried.send.map((a) => a.entryId)).toEqual(["b"]);
  expect(buried.held.map((a) => a.entryId)).toEqual(["a"]);
  expect(buried.snapshots).toEqual([]);
  const deleted = syncBackPlan(state, log, queue, [ankiReviewed!], new Map(), now);
  expect(deleted.gone.map((a) => a.entryId)).toEqual(["a"]);
  expect(deleted.send.map((a) => a.entryId)).toEqual(["b"]);
});

test("sync back buries this phone's linked cards still buried, once per bury", () => {
  const { c, fresh, reviewed } = linked();
  const own = c.createDeck("Mine");
  c.addBasicNote(own.id, "casa", "house");
  const mine = c.snapshot().cards.find((x) => x.fields.deckId.value === own.id)!;
  for (const id of [fresh.id, reviewed.id, mine.id]) c.buryCard(id);
  const state = c.snapshot();
  const until = state.cards.find((x) => x.id === fresh.id)!.fields.buriedUntil.value;
  const buries = syncBackBuries(state, "phone-a", new Set(), now);
  expect(buries).toEqual([
    { key: `bury:${fresh.id}:${until}`, cardId: fresh.id, noteId: 501, ord: 0 },
    { key: `bury:${reviewed.id}:${until}`, cardId: reviewed.id, noteId: 501, ord: 1 },
  ]);
  expect(syncBackBuries(state, "phone-a", new Set([buries[0]!.key]), now)).toEqual([buries[1]]);
  expect(syncBackBuries(state, "phone-a", new Set(), until!)).toEqual([]);
  expect(syncBackBuries(state, "phone-b", new Set(), now)).toEqual([]);
  // Burying a suspended card would take it out of its suspension in AnkiDroid.
  c.setCardsSuspended([fresh.id], true);
  expect(syncBackBuries(c.snapshot(), "phone-a", new Set(), now)).toEqual([buries[1]]);
  // Already out of AnkiDroid's queue, or gone from it: nothing to send.
  const [ankiFresh, ankiReviewed] = source().cards;
  expect(syncBackBuryPlan(buries, [ankiFresh!, ankiReviewed!])).toEqual({ send: buries, done: [] });
  expect(syncBackBuryPlan(buries, [{ ...ankiReviewed!, queue: -1 }])).toEqual({
    send: [],
    done: buries,
  });
});

test("a card AnkiDroid reviewed since we last saw it is snapshotted before our answers go", () => {
  const { state, snapshots, reviewed } = linked();
  const log = [...snapshots, review("ours", reviewed.id, now + 60_000)];
  const queue = syncBackQueue(state, log, "phone-a", new Set());
  // AnkiDroid reviewed it once more an hour ago (reps 4 -> 5).
  const there = {
    ...source().cards[1]!,
    reps: 5,
    interval: 30,
    stability: 31,
    lastReviewSecs: now / 1000 - 3600,
  };
  const plan = syncBackPlan(state, log, queue, [there], new Map(), now);
  expect(plan.snapshots).toMatchObject([
    {
      kind: "snapshot",
      cardId: reviewed.id,
      at: now - 3_600_000,
      state: { reps: 5, stability: 31 },
    },
  ]);
  expect(plan.send.map((a) => a.entryId)).toEqual(["ours"]);
  // Our own answer, read back as reps 5 and stored as seen, is not AnkiDroid's review.
  const again = syncBackPlan(state, log, queue, [there], new Map([[reviewed.id, 5]]), now);
  expect(again.snapshots).toEqual([]);
});

test("pull brings new notes and edited fields, and snapshots only cards AnkiDroid reviewed since", () => {
  const { c, snapshots, fresh, reviewed } = linked();
  const later = source();
  later.notes[0]!.mod = now / 1000 + 60;
  later.notes[0]!.fields = "食べる\u001fto eat";
  later.notes.push({
    id: 502,
    guid: "def",
    noteTypeId: 1600000000000,
    mod: 1_760_000_000,
    tags: "",
    fields: "飲む\u001fdrink",
  });
  later.cards.push(card({ id: 9003, noteId: 502 }), card({ id: 9004, noteId: 502, ord: 1 }));
  // Our synced-back answer raised reps to 5; AnkiDroid suspended the new card.
  later.cards[1] = { ...later.cards[1]!, reps: 5 };
  later.cards[0] = { ...later.cards[0]!, queue: -1 };
  const pulled = new Collection({ ...environment(), now: () => now + 120_000 }, c.snapshot());
  const result = pulled.linkAnkiDroid(later, snapshots, new Map([[reviewed.id, 5]]));
  expect(result.snapshots).toEqual([]);
  expect(result.added).toBe(1);
  expect(result.edited).toBe(1);
  expect(result.claimed).toEqual([]);
  const state = pulled.snapshot();
  expect(state.notes.map((n) => n.values[1]!.value)).toEqual(["to eat", "drink"]);
  expect(state.cards).toHaveLength(4);
  expect(state.cards.find((x) => x.id === fresh.id)!.fields.suspended.value).toBe(true);
  expect(new Map(result.seen).get(reviewed.id)).toBe(5);

  // Reviewed once more in AnkiDroid: reps 6 is newer than what we saw.
  later.cards[1] = { ...later.cards[1], reps: 6, lastReviewSecs: now / 1000 + 100 };
  const next = pulled.linkAnkiDroid(later, snapshots, new Map([[reviewed.id, 5]]));
  expect(next.snapshots).toMatchObject([
    { cardId: reviewed.id, at: now + 100_000, state: { reps: 6 } },
  ]);
});

test("linking reports the decks this phone took over, so earlier reviews can be offered", () => {
  const { state } = linked();
  expect(new Collection(environment()).linkAnkiDroid(source()).claimed).toHaveLength(2);
  const other = new Collection(environment("phone-b"), state);
  expect(other.linkAnkiDroid(source()).claimed).toEqual(state.decks.map((d) => d.id));
  expect(new Collection(environment(), state).linkAnkiDroid(source()).claimed).toEqual([]);
});

describe("what a takeover offers (#113: no double counting)", () => {
  const DAY = 86_400_000;
  /** Phone A linked at `reps`, then these answers exist; phone B links AnkiDroid as `there`. */
  function takeover(
    answers: readonly number[],
    there: { reps: number; lastReviewSecs: number | null },
    atLink: { reps: number; at: number } = { reps: 2, at: now - 10 * DAY },
  ) {
    const first = source();
    first.cards[0] = card({
      reps: atLink.reps,
      type: 2,
      queue: 2,
      interval: 4,
      lastReviewSecs: atLink.at / 1000,
    });
    const a = new Collection(environment());
    const { snapshots } = a.linkAnkiDroid(first);
    const before = a.snapshot();
    const id = cardId(before.notes[0]!.id, 0);
    const log: LogEntry[] = [
      ...snapshots,
      ...answers.map((at, i): LogEntry => ({
        kind: "review",
        id: `r${i}`,
        cardId: id,
        at,
        grade: 3,
        durationMs: 1,
        origin: "phone",
      })),
    ];
    const later = source();
    later.cards[0] = card({ type: 2, queue: 2, interval: 4, ...there });
    const b = new Collection(environment("phone-b"), before);
    const { claimed } = b.linkAnkiDroid(later, log);
    return linkOfferPlan({
      before,
      after: b.snapshot(),
      log,
      deviceId: "phone-b",
      sent: new Set(),
      claimed,
      source: later,
      seen: new Map(),
    });
  }
  const [t1, t2, t3] = [now - 3 * DAY, now - 2 * DAY, now - DAY];

  test("answers the earlier phone delivered aren't offered", () => {
    expect(takeover([t1, t2], { reps: 4, lastReviewSecs: t3 / 1000 })).toEqual({
      offered: [],
      delivered: ["r0", "r1"],
    });
  });

  test("when AnkiDroid's reps didn't rise, nothing was delivered", () => {
    expect(takeover([t1, t2], { reps: 2, lastReviewSecs: (now - 10 * DAY) / 1000 })).toEqual({
      offered: ["r0", "r1"],
      delivered: [],
    });
  });

  test("a partial delivery offers only the rest, in answer order", () => {
    expect(takeover([t1, t2], { reps: 3, lastReviewSecs: t3 / 1000 })).toEqual({
      offered: ["r1"],
      delivered: ["r0"],
    });
  });

  test("an answer newer than AnkiDroid's last review can't have arrived", () => {
    expect(takeover([t1, t3], { reps: 4, lastReviewSecs: t2 / 1000 })).toEqual({
      offered: ["r1"],
      delivered: ["r0"],
    });
  });

  test("an answer delivered in the same second as it was given still counts", () => {
    expect(takeover([t1 + 500], { reps: 3, lastReviewSecs: t1 / 1000 })).toEqual({
      offered: [],
      delivered: ["r0"],
    });
  });

  test("an answer before the last snapshot is already in AnkiDroid's state", () => {
    expect(
      takeover([now - 20 * DAY], { reps: 2, lastReviewSecs: (now - 10 * DAY) / 1000 }),
    ).toEqual({ offered: [], delivered: ["r0"] });
  });

  test("a deck no phone linked before offers every answer", () => {
    const fresh = new Collection(environment("phone-b"));
    const before = fresh.snapshot();
    const { claimed } = fresh.linkAnkiDroid(source());
    const after = fresh.snapshot();
    const log: LogEntry[] = [
      {
        kind: "review",
        id: "r0",
        cardId: cardId(after.notes[0]!.id, 0),
        at: t1,
        grade: 3,
        durationMs: 1,
        origin: "phone",
      },
    ];
    const later = source();
    later.cards[0] = card({ reps: 9, type: 2, queue: 2, lastReviewSecs: t3 / 1000 });
    expect(
      linkOfferPlan({
        before,
        after,
        log,
        deviceId: "phone-b",
        sent: new Set(),
        claimed,
        source: later,
        seen: new Map(),
      }),
    ).toEqual({ offered: ["r0"], delivered: [] });
  });
});

test("a newer AnkiDroid pull preserves local flag and mark choices", () => {
  const c = new Collection(environment());
  c.linkAnkiDroid(source());
  const state = c.snapshot();
  const localCard = state.cards[0]!;
  const note = state.notes[0]!;
  c.setCardFlag(localCard.id, 5);
  c.setNoteMarked(note.id, true);
  expect(c.snapshot().cards[1]!.fields.flag.value).toBe(0);
  expect(browseCards(c.snapshot(), "is:marked", Date.now())).toHaveLength(2);
  const update = source();
  update.notes[0]!.mod = now / 1000 + 60;
  update.notes[0]!.tags = "updated";
  c.linkAnkiDroid(update, []);
  expect(c.snapshot().cards[0]!.fields.flag.value).toBe(5);
  expect(c.snapshot().notes[0]!.fields.tags.value).toEqual(["updated", "marked"]);
  c.setNoteMarked(note.id, false);
  update.notes[0]!.mod += 60;
  update.notes[0]!.tags = "updated marked";
  c.linkAnkiDroid(update, []);
  expect(c.snapshot().notes[0]!.fields.tags.value).toEqual(["updated"]);
});

test("linking takes FSRS-6 parameters and pulling preserves the app's options", () => {
  const c = new Collection(environment());
  const ad = source();
  const weights = [...DEFAULT_FSRS_PARAMETERS];
  weights[0] = 0.4;
  ad.decks.forEach((d) => {
    d.options = JSON.stringify({ ...JSON.parse(d.options), fsrsParams6: weights });
  });
  const { deckId } = c.linkAnkiDroid(ad);
  const presetId = c.snapshot().decks.find((d) => d.id === deckId)!.fields.presetId.value;
  expect(c.snapshot().presets.find((p) => p.id === presetId)!.fields.fsrsParameters.value).toEqual(
    weights,
  );
  c.updatePreset(presetId, { newPerDay: 7, fsrsParameters: [...DEFAULT_FSRS_PARAMETERS] });
  c.linkAnkiDroid(ad);
  const preset = c.snapshot().presets.find((p) => p.id === presetId)!;
  expect(preset.fields.newPerDay.value).toBe(7);
  expect(preset.fields.fsrsParameters.value).toEqual(DEFAULT_FSRS_PARAMETERS);
});

/** Every option the app has, as Anki's schema-11 JSON holds it, none at its default. */
const allOptions = {
  id: 44,
  name: "Kanji options",
  new: { perDay: 42, delays: [3, 15], order: 0, bury: true },
  rev: { perDay: 177, bury: true, maxIvl: 400 },
  lapse: { delays: [5, 20], leechFails: 4, leechAction: 0 },
  newCardsIgnoreReviewLimit: true,
  applyAllParentLimits: true,
  newGatherPriority: 5,
  newSortOrder: 3,
  newMix: 2,
  interdayLearningMix: 1,
  reviewOrder: 12,
  buryInterdayLearning: true,
  autoplay: false,
  replayq: false,
  maxTaken: 45,
  timer: 1,
  stopTimerOnAnswer: true,
  secondsToShowQuestion: 2.5,
  secondsToShowAnswer: 4,
  waitForAudio: false,
  questionAction: 1,
  answerAction: 2,
  easyDaysPercentages: [1, 1, 0.5, 1, 1, 0, 0],
  desiredRetention: 0.85,
  fsrsParams6: Array.from({ length: 21 }, (_, i) => i / 10),
};
/** The same options, as the app stores them. */
const allOptionsRead = {
  name: "Kanji options",
  newPerDay: 42,
  learningSteps: [3, 15],
  insertionOrder: "random",
  buryNew: true,
  reviewsPerDay: 177,
  buryReviews: true,
  maximumInterval: 400,
  relearningSteps: [5, 20],
  leechThreshold: 4,
  leechAction: "suspend",
  newIgnoreReviewLimit: true,
  applyAllParentLimits: true,
  newGatherPriority: "deckThenRandomNotes",
  newSortOrder: "randomNoteThenTemplate",
  newMix: "before",
  interdayLearningMix: "after",
  reviewOrder: "relativeOverdueness",
  buryLearning: true,
  dontPlayAutomatically: true,
  skipQuestionWhenReplayingAnswer: true,
  maximumAnswerSeconds: 45,
  showTimer: true,
  stopTimerOnAnswer: true,
  secondsToShowQuestion: 2.5,
  secondsToShowAnswer: 4,
  waitForAudio: false,
  questionAction: "showReminder",
  answerAction: "good",
  easyDays: ["normal", "normal", "reduced", "normal", "normal", "minimum", "minimum"],
  desiredRetention: 0.85,
  fsrsParameters: allOptions.fsrsParams6,
};
const ankiDefaults = {
  name: "Default",
  newPerDay: 20,
  learningSteps: [1, 10],
  insertionOrder: "sequential",
  buryNew: false,
  reviewsPerDay: 200,
  buryReviews: false,
  maximumInterval: 36500,
  relearningSteps: [10],
  leechThreshold: 8,
  leechAction: "tagOnly",
  newIgnoreReviewLimit: false,
  applyAllParentLimits: false,
  newGatherPriority: "deck",
  newSortOrder: "template",
  newMix: "mix",
  interdayLearningMix: "mix",
  reviewOrder: "day",
  buryLearning: false,
  dontPlayAutomatically: false,
  skipQuestionWhenReplayingAnswer: false,
  maximumAnswerSeconds: 60,
  showTimer: false,
  stopTimerOnAnswer: false,
  secondsToShowQuestion: 0,
  secondsToShowAnswer: 0,
  waitForAudio: true,
  questionAction: "showAnswer",
  answerAction: "bury",
  easyDays: Array.from({ length: 7 }, () => "normal"),
  desiredRetention: 0.9,
  fsrsParameters: DEFAULT_FSRS_PARAMETERS,
};

test("presetFromOptions reads every option the app has from AnkiDroid's JSON", () => {
  expect(presetFromOptions(JSON.stringify(allOptions))).toEqual({ ankiId: 44, ...allOptionsRead });
});

test("options AnkiDroid's JSON lacks take Anki's defaults", () => {
  expect(presetFromOptions("{}")).toEqual({ ankiId: 1, ...ankiDefaults });
  expect(presetFromOptions("not json")).toEqual({ ankiId: 1, ...ankiDefaults });
});

test("a value the app could not save takes Anki's default, leaving the rest", () => {
  const read = presetFromOptions(
    JSON.stringify({
      ...allOptions,
      new: { ...allOptions.new, perDay: -3, delays: [1, 0], order: "random" },
      rev: { ...allOptions.rev, perDay: 1.5, maxIvl: 0 },
      lapse: { delays: "10", leechFails: -1, leechAction: 7 },
      desiredRetention: 1.5,
      maxTaken: "45",
      secondsToShowAnswer: -1,
      fsrsParams6: [1, 2, 3],
    }),
  );
  expect(read).toEqual({
    ankiId: 44,
    ...allOptionsRead,
    newPerDay: 20,
    learningSteps: [1, 10],
    insertionOrder: "sequential",
    reviewsPerDay: 200,
    maximumInterval: 36500,
    relearningSteps: [10],
    leechThreshold: 8,
    leechAction: "tagOnly",
    desiredRetention: 0.9,
    maximumAnswerSeconds: 60,
    secondsToShowAnswer: 0,
    fsrsParameters: DEFAULT_FSRS_PARAMETERS,
  });
});

test("linking takes every option from AnkiDroid and a pull leaves them all alone", () => {
  const c = new Collection(environment());
  const ad = source();
  ad.decks.forEach((d) => {
    d.options = JSON.stringify(allOptions);
  });
  const { deckId } = c.linkAnkiDroid(ad);
  const values = () => {
    const state = c.snapshot();
    const id = state.decks.find((d) => d.id === deckId)!.fields.presetId.value;
    const preset = state.presets.find((p) => p.id === id)!;
    return Object.fromEntries(Object.entries(preset.fields).map(([key, f]) => [key, f.value]));
  };
  expect(values()).toEqual(allOptionsRead);

  ad.decks.forEach((d) => {
    d.options = JSON.stringify({
      ...allOptions,
      new: { ...allOptions.new, perDay: 3 },
      maxTaken: 9,
    });
  });
  c.linkAnkiDroid(ad);
  expect(values()).toEqual(allOptionsRead);
});

test("AnkiDroid scheduler detection uses reviewed cards and leaves new-only decks unknown", () => {
  const ad = source();
  ad.cards = [card({})];
  expect(ankiDroidScheduler(ad)).toBe("unknown");
  ad.cards = [card({ reps: 1, stability: null })];
  expect(ankiDroidScheduler(ad)).toBe("sm2");
  ad.cards = [card({ reps: 1, stability: 2.5 })];
  expect(ankiDroidScheduler(ad)).toBe("fsrs");
});

test("answering a linked card sends its sibling bury through the usual sync back plan", () => {
  const { c, fresh, reviewed } = linked();
  c.updatePreset(c.snapshot().presets[0]!.id, { buryNew: true });
  c.applySiblingBurying(
    {
      kind: "review",
      id: "answer",
      cardId: reviewed.id,
      at: now,
      grade: 3,
      durationMs: 100,
      origin: "phone",
    },
    [],
  );
  const buries = syncBackBuries(c.snapshot(), "phone-a", new Set(), now);
  expect(buries.map((b) => b.cardId)).toEqual([fresh.id]);
  expect(syncBackBuryPlan(buries, source().cards).send).toEqual(buries);
  expect(syncBackBuries(c.snapshot(), "phone-a", new Set(buries.map((b) => b.key)), now)).toEqual(
    [],
  );
});
