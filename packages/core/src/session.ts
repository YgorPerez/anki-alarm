/* oxlint-disable unicorn/no-array-sort -- ES2022/Hermes target; only freshly filtered/mapped arrays are sorted. */
import { Rating, State, type Grade } from "ts-fsrs";
import type { Alarm } from "./alarm.ts";
import type { Card, CollectionState } from "./collection.ts";
import { deckLanguage } from "./read-aloud.ts";
import {
  deckFamily,
  deckPreset,
  isBuried,
  nextIntervals,
  newPosition,
  replayCard,
  type LogEntry,
} from "./study.ts";

/**
 * Fixed session timings and rules. `gradeDelaySeconds` keeps the grades hidden for a moment after
 * the reveal, so a half-awake thumb can't rate the card unread. A card rated Again or Hard returns
 * after `retryGap` other answers, or at once when nothing else is left.
 */
export const SESSION_RULES = { gradeDelaySeconds: 3, retryGap: 2 };

/** Good and Easy count toward N. */
const isRight = (grade: Grade) => grade === Rating.Good || grade === Rating.Easy;

/** A journal event, as native records it: only the fields the fold rule reads. */
interface RingEvent {
  kind: string;
  alarmId: string;
  ringId: string | null;
}

/** Cards each snooze adds to the ring's N: the snooze cost. */
export const SNOOZE_COST = 2;

/**
 * A ring needs the largest N among its alarm and the alarms folded into it: those the journal
 * records as `absorbed` by this ring. An absorbed alarm deleted since then no longer counts. Each
 * snooze so far adds the snooze cost.
 */
export function ringNeed(
  ring: { id: string; alarm: Alarm; snoozes?: number },
  journal: readonly RingEvent[],
  alarms: readonly Alarm[],
) {
  const folded = new Set(
    journal.filter((e) => e.kind === "absorbed" && e.ringId === ring.id).map((e) => e.alarmId),
  );
  const need = Math.max(
    ring.alarm.need,
    ...alarms.filter((a) => folded.has(a.id)).map((a) => a.need),
  );
  return need + (ring.snoozes ?? 0) * SNOOZE_COST;
}

/**
 * The snooze a ring offers after `snoozes` snoozes: its length, the cards it adds, and the snoozes
 * left counting this one. Null when the alarm doesn't allow snooze or the ring reached the cap.
 */
export function snoozeOffer(alarm: Alarm, snoozes: number) {
  const left = alarm.snoozeCap - snoozes;
  if (!alarm.snooze || left <= 0) return null;
  return { minutes: alarm.snoozeMinutes, cost: SNOOZE_COST, left };
}

const voidedIds = (log: readonly LogEntry[]) =>
  new Set(log.filter((e) => e.kind === "void").map((e) => e.targetId));

/** The answers that carry this ring (or awake check) id and weren't undone, oldest first. */
const answersFor = (log: readonly LogEntry[], ringId: string, voided: ReadonlySet<string>) =>
  log
    .filter(
      (e): e is LogEntry & { kind: "review" } =>
        e.kind === "review" && e.origin === "alarm" && e.ringId === ringId && !voided.has(e.id),
    )
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

export interface AlarmSessionInput {
  collection: CollectionState;
  log: readonly LogEntry[];
  deckId: string | null;
  need: number;
  ringId: string;
  now: number;
  /** A card the session just undid an action on: it comes back first, as Decks study does. */
  undone?: string | undefined;
}

/**
 * Where a ring's session stands, from the review log alone: its answers carry the ring id, so the
 * progress survives a restart. Daily limits don't apply: the session always gets its cards.
 */
export function alarmSession({
  collection,
  log,
  deckId,
  need,
  ringId,
  now,
  undone,
}: AlarmSessionInput) {
  const voided = voidedIds(log);
  const answers = answersFor(log, ringId, voided);
  const right = answers.filter((a) => isRight(a.grade)).length;
  const done = right >= need;
  const decks = deckId ? deckFamily(collection, deckId) : new Set<string>();
  const inDeck = collection.cards.filter((c) => decks.has(c.fields.deckId.value));
  // Burying or suspending the current card brings another without counting it. Those cards come
  // only when nothing else is left, so neither can end an alarm or an awake check.
  const suspended = inDeck.filter((c) => c.fields.suspended.value);
  const buried = inDeck.filter((c) => !c.fields.suspended.value && isBuried(c, now));
  const cards = inDeck.filter((c) => !c.fields.suspended.value && !isBuried(c, now));
  const lastAnswer = new Map(
    answers.map((a, index) => [a.cardId, { right: isRight(a.grade), index }]),
  );
  const fresh = cards
    .filter((card) => !lastAnswer.has(card.id))
    .map((card) => {
      const deck = collection.decks.find((d) => d.id === card.fields.deckId.value);
      const preset = deck && deckPreset(collection, deck);
      if (!preset) throw new Error("Deck preset missing");
      return {
        card,
        memory: replayCard(card.id, log, preset, now),
        newPosition: newPosition(card, log, voided),
      };
    });
  const due = fresh
    .filter((c) => c.memory.state !== State.New && c.memory.due.getTime() <= now)
    .sort((a, b) => a.memory.due.getTime() - b.memory.due.getTime());
  const unseen = fresh
    .filter((c) => c.memory.state === State.New)
    .sort((a, b) => a.newPosition - b.newPosition);
  const ahead = fresh
    .filter((c) => c.memory.state !== State.New && c.memory.due.getTime() > now)
    .sort((a, b) => a.memory.due.getTime() - b.memory.due.getTime());
  const answered = (wasRight: boolean) =>
    cards
      .filter((card) => {
        const last = lastAnswer.get(card.id);
        return last?.right === wasRight;
      })
      .sort((a, b) => lastAnswer.get(a.id)!.index - lastAnswer.get(b.id)!.index);
  const missed = answered(false);
  const ready = missed.filter(
    (card) => answers.length - 1 - lastAnswer.get(card.id)!.index >= SESSION_RULES.retryGap,
  );
  const order: { card: Card; again: boolean }[] = [
    ...ready.map((card) => ({ card, again: true })),
    ...[...due, ...unseen, ...ahead].map(({ card }) => ({ card, again: false })),
    ...missed.map((card) => ({ card, again: true })),
    // A deck smaller than N repeats the cards already right, longest ago first.
    ...answered(true).map((card) => ({ card, again: false })),
    ...[...buried, ...suspended].map((card) => ({ card, again: false })),
  ];
  const pick = done ? undefined : (order.find((o) => o.card.id === undone) ?? order[0]);
  const note = pick && collection.notes.find((n) => n.id === pick.card.fields.noteId.value);
  const noteType = note && collection.noteTypes.find((t) => t.id === note.fields.noteTypeId.value);
  const deckName =
    collection.decks.find((d) => d.id === pick?.card.fields.deckId.value)?.fields.name.value ?? "";
  return {
    right,
    need,
    done,
    next:
      pick && note && noteType
        ? {
            ...pick,
            intervals: nextIntervals(collection, log, pick.card.id, now),
            note,
            noteType,
            deckName,
            language: deckLanguage(collection, pick.card.fields.deckId.value),
          }
        : null,
  };
}

export interface AwakeCheckInput {
  collection: CollectionState;
  log: readonly LogEntry[];
  deckId: string | null;
  /** Native's id for the check. Its answer carries it as `ringId`, so a restart sees it passed. */
  checkId: string;
  now: number;
  /** A card the check just undid an action on: it comes back. */
  undone?: string | undefined;
}

/**
 * The awake check's one card, picked as a session's first card would be. Any grade passes it:
 * the answer only has to prove someone is awake.
 */
export function awakeCheckSession({
  collection,
  log,
  deckId,
  checkId,
  now,
  undone,
}: AwakeCheckInput) {
  const passed = answersFor(log, checkId, voidedIds(log)).length > 0;
  if (passed) return { passed, next: null };
  const { next } = alarmSession({ collection, log, deckId, need: 1, ringId: checkId, now, undone });
  return { passed, next };
}
