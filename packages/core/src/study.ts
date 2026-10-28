/* oxlint-disable unicorn/no-array-sort -- ES2022/Hermes target; only freshly filtered/mapped arrays are sorted. */
import { createEmptyCard, fsrs, State, type Card as MemoryState, type Grade } from "ts-fsrs";
import type { CollectionState, Note, NoteType, Preset } from "./collection.ts";
export type { MemoryState, Grade };
/** FSRS card states: New, Learning, Review, Relearning. */
export { State as CardState };
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
    w: preset.fields.fsrsParameters.value,
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
/** A card's memory state under its deck's preset, or undefined when the card is gone. */
export function cardMemory(
  collection: CollectionState,
  log: readonly LogEntry[],
  cardId: string,
  now: number,
): MemoryState | undefined {
  const card = collection.cards.find((c) => c.id === cardId);
  const deck = collection.decks.find((d) => d.id === card?.fields.deckId.value);
  const preset = collection.presets.find((p) => p.id === deck?.fields.presetId.value);
  return preset && replayCard(cardId, log, preset, now);
}
/**
 * Throws unless `entry` may be appended to `log`: its card exists, a set due date moves a card
 * that has been studied (a new card has no interval), and a void cancels a review, reset or set
 * due date the user made on that card and that isn't voided yet.
 */
export function checkLogEntry(
  collection: CollectionState,
  log: readonly LogEntry[],
  entry: LogEntry,
) {
  const memory = cardMemory(collection, log, entry.cardId, entry.at);
  if (!memory) throw new Error("Card missing");
  if (entry.kind === "setDueDate") {
    if (!Number.isSafeInteger(entry.due)) throw new Error("Invalid due date");
    if (memory.state === State.New) throw new Error("Set due date needs a studied card");
  }
  if (entry.kind === "void") {
    const target = log.find((e) => e.id === entry.targetId && e.cardId === entry.cardId);
    const undoable =
      (target?.kind === "review" && target.origin !== "import") ||
      target?.kind === "reset" ||
      target?.kind === "setDueDate";
    if (!undoable || log.some((e) => e.kind === "void" && e.targetId === entry.targetId))
      throw new Error("Nothing to undo");
  }
}
/** The start of the study day `days` after the current one. */
export function dueInDays(days: number, now: number, hour = 4): number {
  if (!Number.isSafeInteger(days) || days < 0) throw new Error("Invalid due date");
  const date = new Date(studyDayStart(now, hour));
  date.setDate(date.getDate() + days);
  return date.getTime();
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
  const preset = collection.presets.find((p) => p.id === deck?.fields.presetId.value);
  if (!preset) throw new Error("Deck preset missing");
  const cards = collection.cards.filter((c) => c.fields.deckId.value === deckId);
  const voided = new Set(log.filter((e) => e.kind === "void").map((e) => e.targetId));
  let newCount = 0;
  let reviewCount = 0;
  for (const card of cards) {
    const today = log
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
        log.filter(
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
      memory: replayCard(card.id, log, preset, now),
      newPosition: Math.max(
        card.fields.noteId.hlc.wallMs,
        ...log
          .filter((e) => e.cardId === card.id && e.kind === "reset" && !voided.has(e.id))
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
export function renderCard(note: Note, type: NoteType, side: "front" | "back", dark: boolean) {
  const fields = new Map(
    type.fields.fieldNames.value.map((name, i) => [name, note.values[i]?.value ?? ""]),
  );
  // Plain {{Field}} placeholders only; Anki's filters and conditionals come with import.
  const expand = (template: string) =>
    template.replace(/{{([^{}]+)}}/g, (whole, name: string) => fields.get(name.trim()) ?? whole);
  const front = expand(type.fields.frontTemplate.value);
  const body =
    side === "front"
      ? front
      : expand(type.fields.backTemplate.value).replaceAll("{{FrontSide}}", front);
  return `<!doctype html><html class="${dark ? "nightMode night_mode" : ""}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: file:; media-src data: file:; style-src 'unsafe-inline'"><style>body{margin:24px;background:${dark ? "#000" : "#fff"};color:${dark ? "#fff" : "#16131d"};font:28px/1.4 sans-serif;overflow-wrap:anywhere}img{max-width:100%}${type.fields.css.value}</style></head><body class="card">${body}</body></html>`;
}
