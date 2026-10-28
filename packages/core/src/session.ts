/* oxlint-disable unicorn/no-array-sort -- ES2022/Hermes target; only freshly filtered/mapped arrays are sorted. */
import { Rating, State, type Grade } from "ts-fsrs";
import type { Alarm } from "./alarm.ts";
import type { Card, CollectionState } from "./collection.ts";
import { newPosition, replayCard, type LogEntry } from "./study.ts";

/**
 * Fixed session timings and rules. `gradeDelaySeconds` keeps the grades hidden for a moment after
 * the reveal, so a half-awake thumb can't rate the card unread. A card rated Again or Hard returns
 * after `retryGap` other answers, or at once when nothing else is left.
 */
export const SESSION_RULES = { gradeDelaySeconds: 3, retryGap: 2 };

/** Good and Easy count toward N. */
const isRight = (grade: Grade) => grade === Rating.Good || grade === Rating.Easy;

/** Cards each snooze adds to the ring's N: the snooze cost. */
const SNOOZE_COST = 2;

/**
 * A ring needs the largest N among its alarm and the alarms folded into it, plus the snooze cost
 * for each snooze so far.
 */
export function ringNeed(alarm: Alarm, absorbed: readonly Alarm[], snoozes = 0) {
  return Math.max(alarm.need, ...absorbed.map((a) => a.need)) + snoozes * SNOOZE_COST;
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

/** The deck and its subdecks, which Anki names `Parent::Child`. */
function deckIds(collection: CollectionState, deckId: string) {
  const deck = collection.decks.find((d) => d.id === deckId);
  if (!deck) return new Set<string>();
  const prefix = `${deck.fields.name.value}::`;
  return new Set(
    collection.decks
      .filter((d) => d.id === deckId || d.fields.name.value.startsWith(prefix))
      .map((d) => d.id),
  );
}

export interface AlarmSessionInput {
  collection: CollectionState;
  log: readonly LogEntry[];
  deckId: string | null;
  need: number;
  ringId: string;
  now: number;
}

/**
 * Where a ring's session stands, from the review log alone: its answers carry the ring id, so the
 * progress survives a restart. Daily limits don't apply: the session always gets its cards.
 */
export function alarmSession({ collection, log, deckId, need, ringId, now }: AlarmSessionInput) {
  const voided = new Set(log.filter((e) => e.kind === "void").map((e) => e.targetId));
  const answers = log
    .filter(
      (e): e is LogEntry & { kind: "review" } =>
        e.kind === "review" && e.origin === "alarm" && e.ringId === ringId && !voided.has(e.id),
    )
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const right = answers.filter((a) => isRight(a.grade)).length;
  const done = right >= need;
  const decks = deckId ? deckIds(collection, deckId) : new Set<string>();
  // Suspended cards stay out of alarm sessions, as out of normal study.
  const cards = collection.cards.filter(
    (c) => decks.has(c.fields.deckId.value) && !c.fields.suspended.value,
  );
  const lastAnswer = new Map(
    answers.map((a, index) => [a.cardId, { right: isRight(a.grade), index }]),
  );
  const fresh = cards
    .filter((card) => !lastAnswer.has(card.id))
    .map((card) => {
      const deck = collection.decks.find((d) => d.id === card.fields.deckId.value);
      const preset = collection.presets.find((p) => p.id === deck?.fields.presetId.value);
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
  ];
  const pick = done ? undefined : order[0];
  const note = pick && collection.notes.find((n) => n.id === pick.card.fields.noteId.value);
  const noteType = note && collection.noteTypes.find((t) => t.id === note.fields.noteTypeId.value);
  const deckName =
    collection.decks.find((d) => d.id === pick?.card.fields.deckId.value)?.fields.name.value ?? "";
  return {
    right,
    need,
    done,
    next: pick && note && noteType ? { ...pick, note, noteType, deckName } : null,
  };
}
