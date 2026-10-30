import { useQueryClient } from "@tanstack/react-query";
import {
  translator,
  type Card,
  type Locale,
  type Note,
  type StudyAction,
  type UndoStep,
} from "@app/core";
import type { StudyMenuItem } from "./StudyMenu.tsx";
import { takeStudyAction } from "./study-undo.ts";

export const annotationMessages = {
  "pt-BR": {
    flag: "Bandeira",
    clear: "Remover bandeira",
    mark: "Marcar nota",
    unmark: "Desmarcar nota",
    marked: "Nota marcada",
    red: "Vermelha",
    orange: "Laranja",
    green: "Verde",
    blue: "Azul",
    pink: "Rosa",
    turquoise: "Turquesa",
    purple: "Roxa",
  },
  en: {
    flag: "Flag",
    clear: "Clear flag",
    mark: "Mark note",
    unmark: "Unmark note",
    marked: "Marked note",
    red: "Red",
    orange: "Orange",
    green: "Green",
    blue: "Blue",
    pink: "Pink",
    turquoise: "Turquoise",
    purple: "Purple",
  },
};
export const flags = [
  { id: 1, name: "red", color: "#d32f2f" },
  { id: 2, name: "orange", color: "#ed6c02" },
  { id: 3, name: "green", color: "#2e9d46" },
  { id: 4, name: "blue", color: "#4285f4" },
  { id: 5, name: "pink", color: "#e86aa6" },
  { id: 6, name: "turquoise", color: "#22b8b0" },
  { id: 7, name: "purple", color: "#a66be0" },
] as const;

export type Current = { card: Card; note: Note } | undefined;
export const flagLabel = (
  t: (key: keyof (typeof annotationMessages)["en"]) => string,
  f: (typeof flags)[number],
) => `${t("flag")} ${f.id}: ${t(f.name)}`;

/** Flag and mark menu entries for the current card. The owning screen guards and persists them. */
export function annotationItems(
  next: Current,
  locale: Locale,
  change: (action: StudyAction) => Promise<void>,
): StudyMenuItem[] {
  if (!next) return [];
  const { card, note } = next;
  const t = translator(annotationMessages, locale);
  const marked = note.fields.tags.value.includes("marked");
  const set = (flag: number) => () => {
    void change({ kind: "setCardFlag", cardId: card.id, flag });
  };
  return [
    ...flags.map((f) => ({ id: `flag-${f.id}`, label: flagLabel(t, f), onPress: set(f.id) })),
    {
      id: "flag-clear",
      label: t("clear"),
      disabled: card.fields.flag.value === 0,
      onPress: set(0),
    },
    {
      id: "mark",
      label: t(marked ? "unmark" : "mark"),
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
