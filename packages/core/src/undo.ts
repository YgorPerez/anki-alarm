import type { Collection } from "./collection.ts";
import type { CollectionCommand } from "./commands.ts";
import type { LogEntry } from "./study.ts";

/** What a study screen's card menu does to the card on screen. Each one can be undone. */
export type StudyAction =
  | { kind: "suspendCard"; cardId: string }
  /** Suspends every card of the card's note, siblings in other decks included. */
  | { kind: "suspendNote"; cardId: string }
  | { kind: "buryCard"; cardId: string }
  /** Anki's flag 1–7; 0 clears it. */
  | { kind: "setCardFlag"; cardId: string; flag: number }
  /** The `marked` tag on the card's note. */
  | { kind: "setNoteMarked"; cardId: string; marked: boolean };

/**
 * How to reverse one study action, as plain data: an answer by a void of its review, anything else
 * by a command that puts back the values the action found. Both are normal edits that sync.
 * `cardId` is the card the action was on, which comes back on screen.
 */
export type UndoStep =
  | { kind: "void"; cardId: string; entryId: string }
  | { kind: "command"; cardId: string; command: CollectionCommand };

/** A study screen's undo history, newest last. */
export type UndoStack = readonly UndoStep[];

/** The steps a stack keeps, as Anki's own undo. */
export const UNDO_LIMIT = 30;

/** Takes a study action on the collection and returns the step that reverses it. */
export function runStudyAction(collection: Collection, action: StudyAction): UndoStep {
  const { cardId } = action;
  const step = (command: CollectionCommand): UndoStep => ({ kind: "command", cardId, command });
  if (action.kind === "suspendCard" || action.kind === "suspendNote") {
    const previous =
      action.kind === "suspendCard"
        ? collection.setCardsSuspended([cardId], true)
        : collection.suspendNote(collection.noteIdOf(cardId));
    return step({ kind: "restoreSuspension", previous });
  }
  if (action.kind === "buryCard") {
    collection.buryCard(cardId);
    // A card on screen is never buried, so undo always ends the bury.
    return step({ kind: "unburyCard", id: cardId });
  }
  if (action.kind === "setCardFlag")
    return step({
      kind: "setCardFlag",
      id: cardId,
      flag: collection.setCardFlag(cardId, action.flag),
    });
  const id = collection.noteIdOf(cardId);
  return step({ kind: "setNoteMarked", id, marked: collection.setNoteMarked(id, action.marked) });
}

/** The step that reverses an answer: a void of its review. */
export function answerUndo(entry: LogEntry): UndoStep {
  if (entry.kind !== "review") throw new Error("Nothing to undo");
  return { kind: "void", cardId: entry.cardId, entryId: entry.id };
}

/** The stack with `step` on top, keeping the newest `UNDO_LIMIT` steps. */
export const pushUndo = (stack: UndoStack, step: UndoStep): UndoStack =>
  [...stack, step].slice(-UNDO_LIMIT);

/** The newest step and the stack under it, or undefined when there is nothing to undo. */
export function popUndo(stack: UndoStack): { step: UndoStep; rest: UndoStack } | undefined {
  const step = stack.at(-1);
  return step && { step, rest: stack.slice(0, -1) };
}
