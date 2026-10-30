import {
  popUndo,
  pushUndo,
  type Locale,
  type StudyAction,
  type UndoStack,
  type UndoStep,
} from "@app/core";
import { Effect } from "effect";
import { useState } from "react";
import { localData } from "./database.ts";
import { editingCopy } from "./editing-copy.ts";
import type { StudyMenuItem } from "./StudyMenu.tsx";

/** Takes a card-menu action and resolves with the step that undoes it. */
export const takeStudyAction = (action: StudyAction) =>
  Effect.runPromise(localData((data) => data.studyAction(action)));

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

/** Undo in the alarm's and awake check's card menu; Decks study has it in its top bar. */
export const undoItem = (
  locale: Locale,
  canUndo: boolean,
  undo: () => Promise<void>,
): StudyMenuItem => ({
  id: "undo",
  label: editingCopy(locale)("undo"),
  disabled: !canUndo,
  onPress: () => {
    void undo();
  },
});
