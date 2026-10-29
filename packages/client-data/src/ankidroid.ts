/* oxlint-disable eslint/no-await-in-loop -- Answers go to AnkiDroid one at a time, each stored before the next. */
import { eq, sql } from "drizzle-orm";
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import {
  syncBackPlan,
  syncBackQueue,
  type AnkiDroidCard,
  type AnkiDroidLink,
  type AnkiDroidSource,
  type Collection,
  type CollectionState,
  type LogEntry,
  type SyncBackAnswer,
} from "@app/core";
import { ankiDroidCards, ankiDroidSent, metadata } from "./schema.ts";

/** AnkiDroid's ContentProvider as sync back and pull use it. The phone implements it natively. */
export interface AnkiDroidProvider {
  /** An AnkiDroid deck with its subdecks, notes, note types and cards. */
  readDeck: (ankiDeckId: number) => Promise<AnkiDroidSource>;
  /** Every card of these AnkiDroid notes, with scheduling. */
  cards: (noteIds: readonly number[]) => Promise<AnkiDroidCard[]>;
  /**
   * Answers the card through AnkiDroid's scheduler and reads it back; `null` when AnkiDroid has no
   * such card. AnkiDroid reports success even when the answer failed, so the reps tell.
   */
  answer: (answer: SyncBackAnswer) => Promise<AnkiDroidCard | null>;
}
export interface SyncBackSummary {
  sent: number;
  /** Waiting: the card is suspended or buried in AnkiDroid. */
  held: number;
  /** Dropped: AnkiDroid no longer has the card. */
  gone: number;
  /** Cards AnkiDroid reviewed since we last saw them. */
  snapshots: number;
}
export interface PullSummary extends SyncBackSummary {
  added: number;
  edited: number;
}

interface Deps {
  db: SqliteRemoteDatabase;
  deviceId: string;
  now: () => number;
  /** Runs `operation` after earlier local operations, in one collection transaction. */
  write: <A>(operation: () => Promise<A>) => Promise<A>;
  /** Runs `operation` after earlier local operations. */
  read: <A>(operation: () => Promise<A>) => Promise<A>;
  readCollection: () => Promise<CollectionState>;
  readLog: () => Promise<LogEntry[]>;
  /** Runs a Core command and its own writes in one transaction (the store's `run`). */
  runCollection: <R>(
    command: (collection: Collection) => R,
    within: (result: R) => Promise<void>,
  ) => Promise<{ result: R }>;
  appendNew: (log: readonly LogEntry[]) => Promise<number>;
  /** Tells subscribers a write that syncs committed. */
  notify: () => void;
}

const AUTO = "ankiDroidAutoSyncBack";
/** AnkiDroid finds a card by note id and ord. */
const key = (c: { noteId: number; ord: number }) => `${c.noteId}:${c.ord}`;
/** Sync back and pull for the decks this phone linked (ADR 0001, ADR 0003). */
export function ankiDroidEngine(deps: Deps) {
  const { db } = deps;
  const readSeen = async () =>
    new Map((await db.select().from(ankiDroidCards)).map((r) => [r.id, r.reps]));
  const readSent = async () => new Set((await db.select().from(ankiDroidSent)).map((r) => r.id));
  const storeSeen = async (seen: readonly (readonly [string, number])[]) => {
    for (let i = 0; i < seen.length; i += 200)
      await db
        .insert(ankiDroidCards)
        .values(seen.slice(i, i + 200).map(([id, reps]) => ({ id, reps })))
        .onConflictDoUpdate({ target: ankiDroidCards.id, set: { reps: sql`excluded.reps` } });
  };
  const markSent = async (ids: readonly string[]) => {
    for (let i = 0; i < ids.length; i += 200)
      await db
        .insert(ankiDroidSent)
        .values(ids.slice(i, i + 200).map((id) => ({ id })))
        .onConflictDoNothing();
  };

  /** Links or pulls one AnkiDroid deck, with snapshots, seen reps and the take-over baseline. */
  const link = async (source: AnkiDroidSource): Promise<AnkiDroidLink> => {
    const { result } = await deps.read(async () => {
      // Nothing else writes until this resolves: local writes share the queue.
      const log = await deps.readLog();
      const seen = await readSeen();
      return deps.runCollection(
        (c) => {
          const linked = c.linkAnkiDroid(source, log, seen);
          // Reviews of a deck this phone just took over were another phone's to send.
          const baseline = syncBackQueue(c.snapshot(), log, deps.deviceId, new Set())
            .filter((a) => linked.claimed.includes(a.deckId))
            .map((a) => a.entryId);
          return { ...linked, baseline };
        },
        async (linked) => {
          await deps.appendNew(linked.snapshots);
          await storeSeen(linked.seen);
          await markSent(linked.baseline);
        },
      );
    });
    deps.notify();
    return result;
  };

  const syncBackOnce = async (provider: AnkiDroidProvider): Promise<SyncBackSummary> => {
    const { state, log, seen, sent } = await deps.read(async () => ({
      state: await deps.readCollection(),
      log: await deps.readLog(),
      seen: await readSeen(),
      sent: await readSent(),
    }));
    const queue = syncBackQueue(state, log, deps.deviceId, sent);
    const summary: SyncBackSummary = { sent: 0, held: 0, gone: 0, snapshots: 0 };
    if (!queue.length) return summary;
    const cards = await provider.cards([...new Set(queue.map((a) => a.noteId))]);
    const plan = syncBackPlan(state, log, queue, cards, seen, deps.now());
    const reps = new Map(cards.map((c) => [key(c), c.reps]));
    const added = await deps.write(async () => {
      const count = await deps.appendNew(plan.snapshots);
      const byCard = new Map(queue.map((a) => [a.cardId, key(a)]));
      await storeSeen(plan.snapshots.map((s) => [s.cardId, reps.get(byCard.get(s.cardId)!)!]));
      await markSent(plan.gone.map((a) => a.entryId));
      return count;
    });
    if (added) deps.notify();
    Object.assign(summary, { held: plan.held.length, gone: plan.gone.length, snapshots: added });
    for (const answer of plan.send) {
      const before = reps.get(key(answer)) ?? 0;
      const after = await provider.answer(answer);
      if (!after || after.reps <= before) throw new Error("AnkiDroid didn't record the answer");
      reps.set(key(answer), after.reps);
      await deps.write(async () => {
        await markSent([answer.entryId]);
        await storeSeen([[answer.cardId, after.reps]]);
      });
      summary.sent++;
    }
    return summary;
  };
  // Two sync backs at once would send the same answers twice.
  let running: Promise<SyncBackSummary> | undefined;
  const syncBack = (provider: AnkiDroidProvider) => {
    running ??= syncBackOnce(provider).finally(() => {
      running = undefined;
    });
    return running;
  };

  const pull = async (provider: AnkiDroidProvider, deckId: string): Promise<PullSummary> => {
    // Pull always runs sync back first (ADR 0003).
    const back = await syncBack(provider);
    const deck = (await deps.read(deps.readCollection)).decks.find((d) => d.id === deckId);
    if (!deck?.anki || deck.fields.linkedBy?.value !== deps.deviceId)
      throw new Error("Deck is not linked to this phone");
    const linked = await link(await provider.readDeck(deck.anki.id));
    return {
      ...back,
      snapshots: back.snapshots + linked.snapshots.length,
      added: linked.added,
      edited: linked.edited,
    };
  };

  const autoSyncBack = () =>
    deps.read(async () => {
      const [row] = await db.select().from(metadata).where(eq(metadata.id, AUTO));
      return row?.value !== "off";
    });
  const setAutoSyncBack = (on: boolean) =>
    deps.write(async () => {
      const value = on ? "on" : "off";
      await db
        .insert(metadata)
        .values({ id: AUTO, value })
        .onConflictDoUpdate({ target: metadata.id, set: { value } });
    });
  return { link, syncBack, pull, autoSyncBack, setAutoSyncBack };
}
