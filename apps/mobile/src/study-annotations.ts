import { useQueryClient } from "@tanstack/react-query";
import type { Card, Locale, Note, StudyAction, UndoStep } from "@app/core";
import { copy } from "./copy.ts";
import type { StudyMenuItem } from "./StudyMenu.tsx";
import { takeStudyAction } from "./study-undo.ts";

export const flags = [
  { id: 1, name: "flagRed", color: "#d32f2f" },
  { id: 2, name: "flagOrange", color: "#ed6c02" },
  { id: 3, name: "flagGreen", color: "#2e9d46" },
  { id: 4, name: "flagBlue", color: "#4285f4" },
  { id: 5, name: "flagPink", color: "#e86aa6" },
  { id: 6, name: "flagTurquoise", color: "#22b8b0" },
  { id: 7, name: "flagPurple", color: "#a66be0" },
] as const;

export type Current = { card: Card; note: Note } | undefined;
export const flagLabel = (t: ReturnType<typeof copy>, f: (typeof flags)[number]) =>
  `${t("flag")} ${f.id}: ${t(f.name)}`;

/** Flag and mark menu entries for the current card. The owning screen guards and persists them. */
export function annotationItems(
  next: Current,
  locale: Locale,
  change: (action: StudyAction) => Promise<void>,
): StudyMenuItem[] {
  if (!next) return [];
  const { card, note } = next;
  const t = copy(locale);
  const marked = note.fields.tags.value.includes("marked");
  const set = (flag: number) => () => {
    void change({ kind: "setCardFlag", cardId: card.id, flag });
  };
  return [
    ...flags.map((f) => ({ id: `flag-${f.id}`, label: flagLabel(t, f), onPress: set(f.id) })),
    {
      id: "flag-clear",
      label: t("flagClear"),
      disabled: card.fields.flag.value === 0,
      onPress: set(0),
    },
    {
      id: "mark",
      label: t(marked ? "unmarkNote" : "markNote"),
      onPress: () => {
        void change({ kind: "setNoteMarked", cardId: card.id, marked: !marked });
      },
    },
  ];
}

/**
 * Persists a flag or mark under the screen's action lock, records its undo, then refreshes that
 * screen's session query.
 */
export function useStudyAnnotationChange(
  guarded: (operation: () => Promise<void>) => Promise<void>,
  refresh: () => Promise<unknown>,
  record: (step: UndoStep) => void,
) {
  const client = useQueryClient();
  return (action: StudyAction) =>
    guarded(async () => {
      record(await takeStudyAction(action));
      await Promise.all([refresh(), client.invalidateQueries({ queryKey: ["collection"] })]);
    });
}
