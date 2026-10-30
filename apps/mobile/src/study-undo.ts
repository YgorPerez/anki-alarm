import { popUndo, pushUndo, type UndoStack, type UndoStep } from "@app/core";
import { Effect } from "effect";
import { useRef, useState } from "react";
import { localData } from "./database.ts";

/**
 * A study screen's undo history, as in AnkiDroid: every answer and card-menu action pushes its
 * reverse, and `undo` reverses the newest one, resolving with the card it was on.
 */
export function useUndoStack() {
  const [stack, setStack] = useState<UndoStack>([]);
  return {
    canUndo: stack.length > 0,
    record: (step: UndoStep) => setStack((steps) => pushUndo(steps, step)),
    undo: async () => {
      const top = popUndo(stack);
      if (!top) return undefined;
      await Effect.runPromise(localData((data) => data.undoStudy(top.step)));
      setStack((steps) => popUndo(steps)?.rest ?? steps);
      return top.step.cardId;
    },
  };
}

/**
 * Undo on a screen whose session picks the card itself (alarm, awake check): after an undo, its
 * card comes first until an answer or a leave replaces it.
 */
export function useSessionUndo() {
  const history = useUndoStack();
  const undone = useRef<string>(undefined);
  return {
    canUndo: history.canUndo,
    /** The card the last undo was on, for the session to show first. */
    undone: () => undone.current,
    /** Records a flag or mark: the card stays. */
    record: history.record,
    /** Records an answer or a leave: the session picks the next card again. */
    replaced: (step: UndoStep) => {
      history.record(step);
      undone.current = undefined;
    },
    undo: async () => {
      undone.current = await history.undo();
    },
  };
}
