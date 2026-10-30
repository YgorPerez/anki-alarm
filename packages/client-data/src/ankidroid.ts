import { eq, inArray, sql } from "drizzle-orm";
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import {
  sentSuspensionKey,
  syncBackBuries,
  syncBackBuryPlan,
  syncBackPlan,
  syncBackQueue,
  syncBackSuspensions,
  type SyncBackSuspension,
  type AnkiDroidCard,
  type AnkiDroidLink,
  type AnkiDroidSource,
  type Collection,
  type CollectionState,
  type LogEntry,
  type SyncBackAnswer,
  type SyncBackBury,
} from "@app/core";
import { Data, Deferred, Effect } from "effect";

import { ankiDroidCards, ankiDroidSent, metadata } from "./schema.ts";
import { inBatches, query, type CommandRejected, type StorageFailed } from "./sql.ts";

/**
 * AnkiDroid's ContentProvider as sync back and pull use it. The phone implements it natively;
 * a failure is the provider's own error.
 */
export interface AnkiDroidProvider {
  /** Suspends and reads back the card; null when deleted. */
  suspend: (action: SyncBackSuspension) => Effect.Effect<AnkiDroidCard | null, Error>;
  /** An AnkiDroid deck with its subdecks, notes, note types and cards. */
  readDeck: (ankiDeckId: number) => Effect.Effect<AnkiDroidSource, Error>;
  /** Every card of these AnkiDroid notes, with scheduling. */
  cards: (noteIds: readonly number[]) => Effect.Effect<AnkiDroidCard[], Error>;
  /**
   * Answers the card through AnkiDroid's scheduler and reads it back; `null` when AnkiDroid has no
   * such card. AnkiDroid reports success even when the answer failed, so the reps tell.
   */
  answer: (answer: SyncBackAnswer) => Effect.Effect<AnkiDroidCard | null, Error>;
  /** Buries the card and reads it back; `null` when AnkiDroid has no such card. */
  bury: (bury: SyncBackBury) => Effect.Effect<AnkiDroidCard | null, Error>;
}
export interface SyncBackSummary {
  sent: number;
  /** Waiting: the card is suspended or buried in AnkiDroid. */
  held: number;
  /** Dropped: AnkiDroid no longer has the card. */
  gone: number;
  /** Cards AnkiDroid reviewed since we last saw them. */
  snapshots: number;
  /** Cards buried in the app that this sync back buried in AnkiDroid. */
  buried: number;
}
export interface PullSummary extends SyncBackSummary {
  added: number;
  edited: number;
}

/**
 * AnkiDroid took the answer but its reps didn't move, or took the bury but the card stayed in its
 * queue: it didn't record it.
 */
export class AnswerNotRecorded extends Data.TaggedError("AnswerNotRecorded")<{
  message: string;
}> {}
/** Pull asked for a deck this phone didn't link. */
export class DeckNotLinked extends Data.TaggedError("DeckNotLinked")<{ message: string }> {}

interface Deps {
  db: SqliteRemoteDatabase;
  deviceId: string;
  now: () => number;
  /** Runs `operation` after earlier local operations, in one collection transaction. */
  write: <A, E>(operation: Effect.Effect<A, E>) => Effect.Effect<A, E | StorageFailed>;
  /** Runs `operation` after earlier local operations. */
  read: <A, E>(operation: Effect.Effect<A, E>) => Effect.Effect<A, E>;
  readCollection: Effect.Effect<CollectionState, StorageFailed>;
  readLog: Effect.Effect<LogEntry[], StorageFailed>;
  /** Runs a Core command and its own writes in one transaction (the store's `run`). */
  runCollection: <R, E>(
    command: (collection: Collection) => R,
    within: (result: R) => Effect.Effect<void, E>,
  ) => Effect.Effect<{ result: R }, E | StorageFailed | CommandRejected>;
  appendNew: (log: readonly LogEntry[]) => Effect.Effect<number, StorageFailed>;
  /** Tells subscribers a write that syncs committed. */
  notify: () => void;
}

const AUTO = "ankiDroidAutoSyncBack";
/** AnkiDroid finds a card by note id and ord. */
const key = (c: { noteId: number; ord: number }) => `${c.noteId}:${c.ord}`;
/** Sync back and pull for the decks this phone linked (ADR 0001, ADR 0003). */
export function ankiDroidEngine(deps: Deps) {
  const { db } = deps;
  const readSeen = Effect.map(
    query(() => db.select().from(ankiDroidCards)),
    (rows) => new Map(rows.map((r) => [r.id, r.reps])),
  );
  const readSent = Effect.map(
    query(() => db.select().from(ankiDroidSent)),
    (rows) => new Set(rows.map((r) => r.id)),
  );
  const storeSeen = (seen: readonly (readonly [string, number])[]) =>
    inBatches(seen, (batch) =>
      db
        .insert(ankiDroidCards)
        .values(batch.map(([id, reps]) => ({ id, reps })))
        .onConflictDoUpdate({ target: ankiDroidCards.id, set: { reps: sql`excluded.reps` } }),
    );
  const markSent = (ids: readonly string[]) =>
    inBatches(ids, (batch) =>
      db
        .insert(ankiDroidSent)
        .values(batch.map((id) => ({ id })))
        .onConflictDoNothing(),
    );
  const forgetSent = (ids: readonly string[]) =>
    inBatches(ids, (batch) =>
      db.delete(ankiDroidSent).where(inArray(ankiDroidSent.id, [...batch])),
    );

  /** Links or pulls one AnkiDroid deck, with snapshots, seen reps and the take-over baseline. */
  const link = (source: AnkiDroidSource) =>
    deps
      .read(
        // Nothing else writes until this ends: local writes share the queue.
        Effect.gen(function* () {
          const log = yield* deps.readLog;
          const seen = yield* readSeen;
          const sent = yield* readSent;
          return yield* deps.runCollection(
            (c) => {
              const linked = c.linkAnkiDroid(source, log, seen, sent);
              // Reviews of a deck this phone just took over were another phone's to send.
              const baseline = syncBackQueue(c.snapshot(), log, deps.deviceId, new Set())
                .filter((a) => linked.claimed.includes(a.deckId))
                .map((a) => a.entryId);
              const importedNotes = new Set(source.notes.map((n) => n.id));
              baseline.push(
                ...syncBackSuspensions(c.snapshot(), deps.deviceId, new Set())
                  .filter((a) => importedNotes.has(a.noteId))
                  .map((a) => a.entryId),
              );
              return { ...linked, baseline };
            },
            (linked) =>
              Effect.gen(function* () {
                yield* deps.appendNew(linked.snapshots);
                yield* storeSeen(linked.seen);
                yield* markSent(linked.baseline);
                yield* forgetSent(linked.released);
              }),
          );
        }),
      )
      .pipe(
        Effect.tap(() => Effect.sync(deps.notify)),
        Effect.map(({ result }): AnkiDroidLink => result),
      );

  const syncBackOnce = (provider: AnkiDroidProvider) =>
    Effect.gen(function* () {
      const { state, log, seen, sent } = yield* deps.read(
        Effect.all({
          state: deps.readCollection,
          log: deps.readLog,
          seen: readSeen,
          sent: readSent,
        }),
      );
      const queue = syncBackQueue(state, log, deps.deviceId, sent);
      const summary: SyncBackSummary = { sent: 0, held: 0, gone: 0, snapshots: 0, buried: 0 };
      const suspensions = syncBackSuspensions(state, deps.deviceId, sent);
      const buries = syncBackBuries(state, deps.deviceId, sent, deps.now());
      if (!queue.length && !suspensions.length && !buries.length) return summary;
      const noteIds = [...queue, ...buries].map((a) => a.noteId);
      const cards = yield* provider.cards([...new Set(noteIds)]);
      const plan = syncBackPlan(state, log, queue, cards, seen, deps.now());
      const buryPlan = syncBackBuryPlan(buries, cards);
      const reps = new Map(cards.map((c) => [key(c), c.reps]));
      const added = yield* deps.write(
        Effect.gen(function* () {
          const count = yield* deps.appendNew(plan.snapshots);
          const byCard = new Map(queue.map((a) => [a.cardId, key(a)]));
          yield* storeSeen(plan.snapshots.map((s) => [s.cardId, reps.get(byCard.get(s.cardId)!)!]));
          yield* markSent(plan.gone.map((a) => a.entryId));
          yield* markSent(buryPlan.done.map((b) => b.key));
          return count;
        }),
      );
      if (added) deps.notify();
      Object.assign(summary, { held: plan.held.length, gone: plan.gone.length, snapshots: added });
      // One answer at a time, each recorded before the next goes.
      for (const answer of plan.send) {
        const before = reps.get(key(answer)) ?? 0;
        const after = yield* provider.answer(answer);
        if (!after || after.reps <= before)
          return yield* new AnswerNotRecorded({ message: "AnkiDroid didn't record the answer" });
        reps.set(key(answer), after.reps);
        yield* deps.write(
          Effect.gen(function* () {
            yield* markSent([answer.entryId]);
            yield* storeSeen([[answer.cardId, after.reps]]);
          }),
        );
        summary.sent++;
      }
      // Answers go first: suspending beforehand would hold their writeback indefinitely.
      for (const action of suspensions) {
        const after = yield* provider.suspend(action);
        if (after && after.queue !== -1)
          return yield* new AnswerNotRecorded({ message: "AnkiDroid didn't suspend the card" });
        yield* deps.write(
          markSent(after ? [action.entryId, sentSuspensionKey(action.cardId)] : [action.entryId]),
        );
      }
      // Buries go after the answers: an answer would put a buried card back in AnkiDroid's queue.
      for (const bury of buryPlan.send) {
        const after = yield* provider.bury(bury);
        if (after && after.queue >= 0)
          return yield* new AnswerNotRecorded({ message: "AnkiDroid didn't record the bury" });
        yield* deps.write(markSent([bury.key]));
        summary.buried++;
      }
      return summary;
    });
  // Two sync backs at once would send the same answers twice: a second joins the first.
  let running:
    | Deferred.Deferred<SyncBackSummary, Error | StorageFailed | AnswerNotRecorded>
    | undefined;
  const syncBack = (provider: AnkiDroidProvider) =>
    Effect.suspend(() => {
      if (running) return Deferred.await(running);
      const done = Deferred.makeUnsafe<
        SyncBackSummary,
        Error | StorageFailed | AnswerNotRecorded
      >();
      running = done;
      return syncBackOnce(provider).pipe(
        Effect.onExit((exit) => {
          running = undefined;
          return Deferred.done(done, exit);
        }),
      );
    });

  const pull = (provider: AnkiDroidProvider, deckId: string) =>
    Effect.gen(function* () {
      // Pull always runs sync back first (ADR 0003).
      const back = yield* syncBack(provider);
      const deck = (yield* deps.read(deps.readCollection)).decks.find((d) => d.id === deckId);
      if (!deck?.anki || deck.fields.linkedBy?.value !== deps.deviceId)
        return yield* new DeckNotLinked({ message: "Deck is not linked to this phone" });
      const linked = yield* link(yield* provider.readDeck(deck.anki.id));
      const summary: PullSummary = {
        ...back,
        snapshots: back.snapshots + linked.snapshots.length,
        added: linked.added,
        edited: linked.edited,
      };
      return summary;
    });

  const autoSyncBack = deps.read(
    Effect.map(
      query(() => db.select().from(metadata).where(eq(metadata.id, AUTO))),
      ([row]) => row?.value !== "off",
    ),
  );
  const setAutoSyncBack = (on: boolean) =>
    deps.write(
      Effect.asVoid(
        query(() => {
          const value = on ? "on" : "off";
          return db
            .insert(metadata)
            .values({ id: AUTO, value })
            .onConflictDoUpdate({ target: metadata.id, set: { value } });
        }),
      ),
    );
  return { link, syncBack, pull, autoSyncBack, setAutoSyncBack };
}
