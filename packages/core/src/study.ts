/* oxlint-disable unicorn/no-array-sort -- ES2022/Hermes target; only freshly filtered/mapped arrays are sorted. */
import { createEmptyCard, fsrs, State, type Card as MemoryState, type Grade } from "ts-fsrs";
import type { CollectionState, Preset } from "./collection.ts";
export type { MemoryState, Grade };
type Entry = { id: string; cardId: string; at: number };
export type LogEntry = Entry &
  (
    | {
        kind: "review";
        grade: Grade;
        durationMs: number;
        origin: "phone" | "web" | "alarm" | "import";
      }
    | {
        kind: "snapshot";
        state: Omit<MemoryState, "due" | "last_review"> & { due: number; last_review?: number };
      }
    | { kind: "reset" }
    | { kind: "setDueDate"; due: number }
    | { kind: "void"; targetId: string }
  );
export function replayCard(
  cardId: string,
  log: readonly LogEntry[],
  preset: Preset,
  now: number,
): MemoryState {
  const entries = log
    .filter((e) => e.cardId === cardId)
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const voided = new Set(entries.filter((e) => e.kind === "void").map((e) => e.targetId));
  const scheduler = fsrs({
    request_retention: preset.fields.desiredRetention.value,
    enable_fuzz: false,
    learning_steps: preset.fields.learningSteps.value.map((n) => `${n}m` as const),
  });
  let state = createEmptyCard(new Date(now));
  for (const entry of entries) {
    if (voided.has(entry.id)) continue;
    switch (entry.kind) {
      case "review":
        state = scheduler.next(state, new Date(entry.at), entry.grade).card;
        break;
      case "reset":
        state = createEmptyCard(new Date(entry.at));
        break;
      case "setDueDate":
        state = { ...state, due: new Date(entry.due) };
        break;
      case "snapshot": {
        const { last_review, ...snapshot } = entry.state;
        state = {
          ...snapshot,
          due: new Date(entry.state.due),
          ...(last_review === undefined ? {} : { last_review: new Date(last_review) }),
        };
        break;
      }
      case "void":
        break;
    }
  }
  return state;
}
/** Local calendar arithmetic keeps the 4am boundary correct across DST. */
export function studyDayStart(now: number, hour = 4): number {
  const date = new Date(now);
  if (date.getHours() < hour) date.setDate(date.getDate() - 1);
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}
export function studyQueue(
  collection: CollectionState,
  log: readonly LogEntry[],
  deckId: string,
  now: number,
  dayStart = studyDayStart(now),
) {
  const deck = collection.decks.find((d) => d.id === deckId);
  const base = collection.presets.find((p) => p.id === deck?.fields.presetId.value);
  if (!deck || !base) throw new Error("Deck preset missing");
  const override = deck.fields.desiredRetention?.value;
  const preset: Preset =
    override == null
      ? base
      : {
          ...base,
          fields: {
            ...base.fields,
            desiredRetention: { ...base.fields.desiredRetention, value: override },
          },
        };
  const cards = collection.cards.filter(
    (c) => c.fields.deckId.value === deckId && !c.fields.suspended?.value,
  );
  const voided = new Set(log.filter((e) => e.kind === "void").map((e) => e.targetId));
  // Each card replays only its own entries.
  const entries = new Map<string, LogEntry[]>();
  for (const entry of log) {
    const own = entries.get(entry.cardId);
    if (own) own.push(entry);
    else entries.set(entry.cardId, [entry]);
  }
  let newCount = 0;
  let reviewCount = 0;
  for (const card of cards) {
    const own = entries.get(card.id) ?? [];
    const today = own
      .filter(
        (e) =>
          e.cardId === card.id &&
          e.kind === "review" &&
          !voided.has(e.id) &&
          e.at >= dayStart &&
          e.at <= now,
      )
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    const first = today[0];
    if (first) {
      const before = replayCard(
        card.id,
        own.filter(
          (e) => e.at < first.at || (e.at === first.at && e.id < first.id) || e.kind === "void",
        ),
        preset,
        now,
      );
      if (before.state === State.New) newCount++;
      else if (before.state === State.Review) reviewCount++;
    }
  }
  return cards
    .map((card) => ({
      card,
      memory: replayCard(card.id, entries.get(card.id) ?? [], preset, now),
      newPosition: Math.max(
        card.fields.noteId.hlc.wallMs,
        ...(entries.get(card.id) ?? [])
          .filter((e) => e.kind === "reset" && !voided.has(e.id))
          .map((e) => e.at),
      ),
    }))
    .filter(({ memory }) =>
      memory.state === State.New
        ? newCount < preset.fields.newPerDay.value
        : memory.due.getTime() <= now &&
          (memory.state !== State.Review || reviewCount < preset.fields.reviewsPerDay.value),
    )
    .sort(
      (a, b) =>
        (a.memory.state === State.New ? 1 : 0) - (b.memory.state === State.New ? 1 : 0) ||
        (a.memory.state === State.New && b.memory.state === State.New
          ? a.newPosition - b.newPosition
          : a.memory.due.getTime() - b.memory.due.getTime()) ||
        a.card.id.localeCompare(b.card.id),
    );
}
