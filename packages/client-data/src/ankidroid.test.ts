import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { expect, test } from "vite-plus/test";
import { answerUndo, type AnkiDroidCard, type AnkiDroidSource } from "@app/core";
import fixture from "../../core/fixtures/ankidroid-deck.json" with { type: "json" };
import { ClientData, clientDataLayer, type AnkiDroidProvider, type ExecuteSql } from "./index.ts";

const NOW = 1_770_000_000_000;
/** AnkiDroid as its ContentProvider behaves: answers raise reps, unless told to fail silently. */
function fakeAnkiDroid() {
  const source: AnkiDroidSource = structuredClone(fixture.source);
  const calls: string[] = [];
  const state = { ignoreAnswers: false, ignoreBuries: false };
  const provider: AnkiDroidProvider = {
    suspend: ({ noteId, ord }) =>
      Effect.sync(() => {
        const card = source.cards.find((c) => c.noteId === noteId && c.ord === ord);
        if (!card) return null;
        card.queue = -1;
        return { ...card };
      }),
    readDeck: (deckId) =>
      Effect.sync(() => {
        calls.push(`read ${deckId}`);
        return structuredClone(source);
      }),
    cards: (noteIds) =>
      Effect.sync(() => {
        calls.push(`cards ${noteIds.join(",")}`);
        return structuredClone(source.cards.filter((c) => noteIds.includes(c.noteId)));
      }),
    answer: ({ noteId, ord, ease, timeTakenMs }) =>
      Effect.sync(() => {
        calls.push(`answer ${noteId}:${ord} ease ${ease} ${timeTakenMs}ms`);
        const card = source.cards.find((c) => c.noteId === noteId && c.ord === ord);
        if (!card) return null;
        if (!state.ignoreAnswers) review(card, NOW / 1000);
        return { ...card };
      }),
    bury: ({ noteId, ord }) =>
      Effect.sync(() => {
        calls.push(`bury ${noteId}:${ord}`);
        const card = source.cards.find((c) => c.noteId === noteId && c.ord === ord);
        if (!card) return null;
        if (!state.ignoreBuries) card.queue = -3;
        return { ...card };
      }),
  };
  return { provider, source, calls, state, review };
}
/** A review, as AnkiDroid's scheduler records it. */
function review(card: AnkiDroidCard, secs: number) {
  Object.assign(card, {
    reps: card.reps + 1,
    type: 2,
    queue: 2,
    interval: 9,
    stability: 9.5,
    difficulty: 5,
    lastReviewSecs: secs,
  });
}

const openData = () => {
  const databases = new Map<string, DatabaseSync>();
  const connect = (name: string): ExecuteSql => {
    const db = databases.get(name) ?? new DatabaseSync(":memory:");
    databases.set(name, db);
    return async (query, params, method) => {
      const stmt = db.prepare(query);
      if (method === "run") {
        stmt.run(...params);
        return { rows: [] };
      }
      stmt.setReturnArrays(true);
      return { rows: stmt.all(...params) };
    };
  };
  let n = 0;
  const open = () =>
    Effect.runPromise(
      ClientData.pipe(
        Effect.provide(
          clientDataLayer({ connect, now: () => NOW, random: () => new Uint8Array(16).fill(n++) }),
        ),
      ),
    );
  return { open, close: () => databases.forEach((db) => db.close()) };
};
const run = Effect.runPromise;

test("sync back answers in AnkiDroid once per review, and pull doesn't take our answers back", async () => {
  const { open, close } = openData();
  const ankiDroid = fakeAnkiDroid();
  try {
    const data = await open();
    const deckId = await run(data.linkAnkiDroidDeck(ankiDroid.source));
    const cards = (await run(data.collection)).cards;
    const fresh = cards.find((c) => c.anki?.id === 9001)!;
    const reviewed = cards.find((c) => c.anki?.id === 9002)!;
    await run(data.answerCard(fresh.id, 3, 5000));
    await run(data.answerCard(reviewed.id, 1, 8000, "ring-1"));

    expect(await run(data.syncBackAnkiDroid(ankiDroid.provider))).toEqual({
      sent: 2,
      held: 0,
      gone: 0,
      snapshots: 0,
      buried: 0,
    });
    expect(ankiDroid.calls).toEqual([
      "cards 501,502",
      "answer 501:0 ease 3 5000ms",
      "answer 502:0 ease 1 8000ms",
    ]);
    // Reopening keeps what was sent.
    const reopened = await open();
    expect((await run(reopened.syncBackAnkiDroid(ankiDroid.provider))).sent).toBe(0);

    const logBefore = await run(reopened.reviewLog);
    const pulled = await run(reopened.pullAnkiDroid(ankiDroid.provider, deckId));
    expect(pulled).toMatchObject({ snapshots: 0, added: 0, sent: 0 });
    expect(await run(reopened.reviewLog)).toHaveLength(logBefore.length);

    // A review done in AnkiDroid comes in as a snapshot at its time.
    ankiDroid.review(ankiDroid.source.cards[0]!, NOW / 1000 + 600);
    expect((await run(reopened.pullAnkiDroid(ankiDroid.provider, deckId))).snapshots).toBe(1);
    expect((await run(reopened.reviewLog)).at(-1)).toMatchObject({
      kind: "snapshot",
      cardId: fresh.id,
      at: NOW + 600_000,
    });
  } finally {
    close();
  }
});

test("pull sends pending reviews before it reads the deck", async () => {
  const { open, close } = openData();
  const ankiDroid = fakeAnkiDroid();
  try {
    const data = await open();
    const deckId = await run(data.linkAnkiDroidDeck(ankiDroid.source));
    const fresh = (await run(data.collection)).cards.find((c) => c.anki?.id === 9001)!;
    await run(data.answerCard(fresh.id, 4, 3000));
    const result = await run(data.pullAnkiDroid(ankiDroid.provider, deckId));
    expect(result).toMatchObject({ sent: 1, snapshots: 0 });
    expect(ankiDroid.calls).toEqual([
      "cards 501",
      "answer 501:0 ease 4 3000ms",
      `read ${ankiDroid.source.deckId}`,
    ]);
  } finally {
    close();
  }
});

test("an answer AnkiDroid didn't record stays pending and the sync back fails", async () => {
  const { open, close } = openData();
  const ankiDroid = fakeAnkiDroid();
  try {
    const data = await open();
    await run(data.linkAnkiDroidDeck(ankiDroid.source));
    const fresh = (await run(data.collection)).cards.find((c) => c.anki?.id === 9001)!;
    await run(data.answerCard(fresh.id, 3, 5000));
    ankiDroid.state.ignoreAnswers = true;
    await expect(run(data.syncBackAnkiDroid(ankiDroid.provider))).rejects.toThrow(
      "AnkiDroid didn't record the answer",
    );
    ankiDroid.state.ignoreAnswers = false;
    expect((await run(data.syncBackAnkiDroid(ankiDroid.provider))).sent).toBe(1);
  } finally {
    close();
  }
});

test("a bury goes to AnkiDroid after the card's answers, once, and must be recorded", async () => {
  const { open, close } = openData();
  const ankiDroid = fakeAnkiDroid();
  try {
    const data = await open();
    const deckId = await run(data.linkAnkiDroidDeck(ankiDroid.source));
    const fresh = (await run(data.collection)).cards.find((c) => c.anki?.id === 9001)!;
    await run(data.answerCard(fresh.id, 1, 5000));
    await run(data.changeCollection((c) => c.buryCard(fresh.id)));
    ankiDroid.state.ignoreBuries = true;
    await expect(run(data.syncBackAnkiDroid(ankiDroid.provider))).rejects.toThrow(
      "AnkiDroid didn't record the bury",
    );
    ankiDroid.state.ignoreBuries = false;
    expect(await run(data.syncBackAnkiDroid(ankiDroid.provider))).toMatchObject({
      sent: 0,
      buried: 1,
    });
    expect(ankiDroid.calls).toEqual([
      "cards 501",
      "answer 501:0 ease 1 5000ms",
      "bury 501:0",
      "cards 501",
      "bury 501:0",
    ]);
    expect(await run(data.pullAnkiDroid(ankiDroid.provider, deckId))).toMatchObject({
      buried: 0,
    });
    const card = (await run(data.collection)).cards.find((c) => c.id === fresh.id)!;
    expect(card.fields.buriedUntil.value).toBeGreaterThan(NOW);
  } finally {
    close();
  }
});

test("an answer, suspend or bury undone before sync back never reaches AnkiDroid", async () => {
  const { open, close } = openData();
  const ankiDroid = fakeAnkiDroid();
  const provider: AnkiDroidProvider = {
    ...ankiDroid.provider,
    suspend: (a) => {
      ankiDroid.calls.push(`suspend ${a.noteId}:${a.ord}`);
      return ankiDroid.provider.suspend(a);
    },
  };
  try {
    const data = await open();
    await run(data.linkAnkiDroidDeck(ankiDroid.source));
    const fresh = (await run(data.collection)).cards.find((c) => c.anki?.id === 9001)!;
    const answer = await run(data.answerCard(fresh.id, 3, 5000));
    const suspend = await run(data.studyAction({ kind: "suspendNote", cardId: fresh.id }));
    const bury = await run(data.studyAction({ kind: "buryCard", cardId: fresh.id }));
    await run(data.undoStudy(bury));
    await run(data.undoStudy(suspend));
    await run(data.undoStudy(answerUndo(answer)));
    ankiDroid.calls.length = 0;
    expect(await run(data.syncBackAnkiDroid(provider))).toMatchObject({ sent: 0, buried: 0 });
    expect(ankiDroid.calls.filter((call) => !call.startsWith("cards"))).toEqual([]);
  } finally {
    close();
  }
});

test("auto sync back after alarm sessions is on until the user turns it off", async () => {
  const { open, close } = openData();
  try {
    const data = await open();
    expect(await run(data.autoSyncBack)).toBe(true);
    await run(data.setAutoSyncBack(false));
    expect(await run((await open()).autoSyncBack)).toBe(false);
  } finally {
    close();
  }
});

test("suspension syncs without reviews, survives restart and retries a failed provider write", async () => {
  const db = openData();
  const anki = fakeAnkiDroid();
  let attempts = 0;
  const provider: AnkiDroidProvider = {
    ...anki.provider,
    suspend: (action) =>
      Effect.sync(() => {
        attempts++;
        const card = anki.source.cards.find(
          (c) => c.noteId === action.noteId && c.ord === action.ord,
        )!;
        if (attempts > 1) card.queue = -1;
        return { ...card };
      }),
  };
  try {
    const data = await db.open();
    await run(data.linkAnkiDroidDeck(anki.source));
    const card = (await run(data.collection)).cards.find((c) => c.anki?.id === 9001)!;
    await run(
      data.changeCollection((c) => {
        c.setCardsSuspended([card.id], true);
      }),
    );
    await expect(run(data.syncBackAnkiDroid(provider))).rejects.toThrow(
      "AnkiDroid didn't suspend the card",
    );
    const reopened = await db.open();
    await run(reopened.syncBackAnkiDroid(provider));
    await run(reopened.syncBackAnkiDroid(provider));
    expect(attempts).toBe(2);
    expect(anki.source.cards.find((c) => c.id === 9001)!.queue).toBe(-1);
  } finally {
    db.close();
  }
});

test("undoing a suspend already sent stays undone until AnkiDroid's queue changes", async () => {
  const db = openData();
  const anki = fakeAnkiDroid();
  try {
    const data = await db.open();
    const deckId = await run(data.linkAnkiDroidDeck(anki.source));
    const stored = async () =>
      (await run(data.collection)).cards.find((c) => c.anki?.id === 9001)!.fields.suspended.value;
    const inAnkiDroid = anki.source.cards.find((c) => c.id === 9001)!;
    const queue = inAnkiDroid.queue;
    const card = (await run(data.collection)).cards.find((c) => c.anki?.id === 9001)!;
    const step = await run(data.studyAction({ kind: "suspendCard", cardId: card.id }));
    await run(data.syncBackAnkiDroid(anki.provider));
    expect(inAnkiDroid.queue).toBe(-1);

    await run(data.undoStudy(step));
    await run(data.pullAnkiDroid(anki.provider, deckId));
    expect(await stored()).toBe(false);
    // A restart keeps it.
    const reopened = await db.open();
    await run(reopened.pullAnkiDroid(anki.provider, deckId));
    expect(await stored()).toBe(false);

    // Unsuspended there, then suspended there: that one is AnkiDroid's own.
    inAnkiDroid.queue = queue;
    await run(reopened.pullAnkiDroid(anki.provider, deckId));
    expect(await stored()).toBe(false);
    inAnkiDroid.queue = -1;
    await run(reopened.pullAnkiDroid(anki.provider, deckId));
    expect(await stored()).toBe(true);
  } finally {
    db.close();
  }
});

test("a suspension AnkiDroid made itself still follows AnkiDroid after an unsuspend here", async () => {
  const db = openData();
  const anki = fakeAnkiDroid();
  try {
    const data = await db.open();
    const deckId = await run(data.linkAnkiDroidDeck(anki.source));
    const inAnkiDroid = anki.source.cards.find((c) => c.id === 9001)!;
    inAnkiDroid.queue = -1;
    await run(data.pullAnkiDroid(anki.provider, deckId));
    const card = (await run(data.collection)).cards.find((c) => c.anki?.id === 9001)!;
    expect(card.fields.suspended.value).toBe(true);
    await run(
      data.changeCollection((c) => {
        c.setCardsSuspended([card.id], false);
      }),
    );
    await run(data.pullAnkiDroid(anki.provider, deckId));
    expect(
      (await run(data.collection)).cards.find((c) => c.id === card.id)!.fields.suspended.value,
    ).toBe(true);
  } finally {
    db.close();
  }
});

test("sync back sends answers before suspension and a pull does not resend imported suspension", async () => {
  const db = openData();
  const anki = fakeAnkiDroid();
  const actions: string[] = [];
  const provider: AnkiDroidProvider = {
    ...anki.provider,
    answer: (a) =>
      Effect.tap(anki.provider.answer(a), () =>
        Effect.sync(() => {
          actions.push("answer");
        }),
      ),
    suspend: (a) =>
      Effect.tap(anki.provider.suspend(a), () =>
        Effect.sync(() => {
          actions.push("suspend");
        }),
      ),
  };
  try {
    const data = await db.open();
    const deckId = await run(data.linkAnkiDroidDeck(anki.source));
    const card = (await run(data.collection)).cards.find((c) => c.anki?.id === 9001)!;
    await run(data.answerCard(card.id, 3, 100));
    await run(
      data.changeCollection((c) => {
        c.setCardsSuspended([card.id], true);
      }),
    );
    await run(data.syncBackAnkiDroid(provider));
    expect(actions).toEqual(["answer", "suspend"]);
    await run(data.pullAnkiDroid(provider, deckId));
    expect(actions).toEqual(["answer", "suspend"]);
    expect((await run(data.reviewLog)).filter((e) => e.kind === "review")).toHaveLength(1);
  } finally {
    db.close();
  }
});

test("pending answers expose held cards and a stopped run's reason across restarts", async () => {
  const { open, close } = openData();
  const anki = fakeAnkiDroid();
  try {
    const data = await open();
    const deckId = await run(data.linkAnkiDroidDeck(anki.source));
    const fresh = (await run(data.collection)).cards.find((c) => c.anki?.id === 9001)!;
    await run(data.answerCard(fresh.id, 3, 5000));
    expect(await run(data.ankiDroidSyncBackStatus)).toMatchObject({
      pending: [{ deckId, held: false }],
      failure: null,
    });
    anki.source.cards.find((c) => c.id === 9001)!.queue = -1;
    await run(data.syncBackAnkiDroid(anki.provider));
    expect(await run((await open()).ankiDroidSyncBackStatus)).toMatchObject({
      pending: [{ deckId, held: true }],
      failure: null,
    });
    anki.source.cards.find((c) => c.id === 9001)!.queue = 2;
    anki.state.ignoreAnswers = true;
    await expect(run(data.syncBackAnkiDroid(anki.provider))).rejects.toThrow(
      "AnkiDroid didn't record the answer",
    );
    expect(await run((await open()).ankiDroidSyncBackStatus)).toMatchObject({
      pending: [{ deckId, held: false }],
      failure: "notRecorded",
    });
    anki.state.ignoreAnswers = false;
    await run(data.syncBackAnkiDroid(anki.provider));
    expect(await run(data.ankiDroidSyncBackStatus)).toEqual({ pending: [], failure: null });
  } finally {
    close();
  }
});

import { unlinkedAnkiDroidDeck } from "./ankidroid-offer-fixture.ts";

test("linking offers earlier answers and keeps them out of sync back until accepted", async () => {
  const { open, close } = openData();
  const anki = fakeAnkiDroid();
  try {
    const data = await open();
    await run(data.importAnki(unlinkedAnkiDroidDeck()));
    const cards = (await run(data.collection)).cards;
    await run(data.answerCard(cards[1]!.id, 1, 8000));
    await run(data.answerCard(cards[0]!.id, 4, 3000));
    const deckId = await run(data.linkAnkiDroidDeck(anki.source));
    expect(await run(data.ankiDroidLinkOffer(deckId))).toBe(2);
    expect((await run(data.syncBackAnkiDroid(anki.provider))).sent).toBe(0);
    const reopened = await open();
    expect(await run(reopened.ankiDroidLinkOffer(deckId))).toBe(2);
    await run(reopened.resolveAnkiDroidLinkOffer(deckId, true));
    expect((await run(reopened.syncBackAnkiDroid(anki.provider))).sent).toBe(2);
    expect(anki.calls.filter((c) => c.startsWith("answer"))).toEqual([
      "answer 502:0 ease 1 8000ms",
      "answer 501:0 ease 4 3000ms",
    ]);
    await run(reopened.linkAnkiDroidDeck(anki.source));
    expect(await run(reopened.ankiDroidLinkOffer(deckId))).toBe(0);
    expect((await run(reopened.syncBackAnkiDroid(anki.provider))).sent).toBe(0);
  } finally {
    close();
  }
});

test("declining earlier answers survives reopening and leaves later answers sendable", async () => {
  const { open, close } = openData();
  const anki = fakeAnkiDroid();
  try {
    const data = await open();
    await run(data.importAnki(unlinkedAnkiDroidDeck()));
    const card = (await run(data.collection)).cards[0]!;
    await run(data.answerCard(card.id, 3, 5000));
    const deckId = await run(data.linkAnkiDroidDeck(anki.source));
    expect(await run(data.ankiDroidLinkOffer(deckId))).toBe(1);
    await run(data.resolveAnkiDroidLinkOffer(deckId, false));
    const reopened = await open();
    await run(reopened.linkAnkiDroidDeck(anki.source));
    expect(await run(reopened.ankiDroidLinkOffer(deckId))).toBe(0);
    expect((await run(reopened.syncBackAnkiDroid(anki.provider))).sent).toBe(0);
    await run(reopened.answerCard(card.id, 4, 1000, "ring-later"));
    expect((await run(reopened.syncBackAnkiDroid(anki.provider))).sent).toBe(1);
  } finally {
    close();
  }
});
