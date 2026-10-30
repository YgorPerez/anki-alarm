import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Card, Locale, Note, StudyAction, UndoStep } from "@app/core";
import { Effect } from "effect";
import { copy } from "./copy.ts";
import { localData } from "./database.ts";
import { editingCopy } from "./editing-copy.ts";
import type { StudyMenuItem } from "./StudyMenu.tsx";

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

const menuItem = (
  id: string,
  label: string,
  run: () => unknown,
  disabled = false,
): StudyMenuItem => ({
  id,
  label,
  disabled,
  onPress: () => {
    void run();
  },
});

/**
 * The card menu's entries on all three study screens, in order. The screen supplies what differs:
 * `leave` takes the card out without an answer and brings the next one, `change` keeps the card,
 * and `undo` is absent on Decks study, which has it in its top bar.
 */
export function studyMenuItems({
  next,
  locale,
  undo,
  edit,
  leave,
  change,
}: {
  next: Current;
  locale: Locale;
  undo?: { canUndo: boolean; run: () => Promise<void> } | undefined;
  edit: (cardId: string) => void;
  leave: (action: StudyAction) => Promise<void>;
  change: (action: StudyAction) => Promise<void>;
}): StudyMenuItem[] {
  if (!next) return [];
  const { card, note } = next;
  const cardId = card.id;
  const t = copy(locale);
  const marked = note.fields.tags.value.includes("marked");
  const setFlag = (flag: number) => () => change({ kind: "setCardFlag", cardId, flag });
  return [
    ...(undo ? [menuItem("undo", editingCopy(locale)("undo"), undo.run, !undo.canUndo)] : []),
    menuItem("editNote", t("editNote"), () => edit(cardId)),
    menuItem("suspend-card", t("suspendCard"), () => leave({ kind: "suspendCard", cardId })),
    menuItem("suspend-note", t("suspendNote"), () => leave({ kind: "suspendNote", cardId })),
    menuItem("bury", t("buryCard"), () => leave({ kind: "buryCard", cardId })),
    ...flags.map((f) => menuItem(`flag-${f.id}`, flagLabel(t, f), setFlag(f.id))),
    menuItem("flag-clear", t("flagClear"), setFlag(0), card.fields.flag.value === 0),
    menuItem("mark", t(marked ? "unmarkNote" : "markNote"), () =>
      change({ kind: "setNoteMarked", cardId, marked: !marked }),
    ),
  ];
}

/** Takes a card-menu action, refreshes the collection and resolves with the step that undoes it. */
export const takeStudyAction = async (action: StudyAction, client: QueryClient) => {
  const step = await Effect.runPromise(localData((data) => data.studyAction(action)));
  await client.invalidateQueries({ queryKey: ["collection"] });
  return step;
};

/**
 * `change` for `studyMenuItems`: takes the action under the screen's lock, records its undo and
 * refreshes the screen's session. The card stays.
 */
export function useStudyChange(
  guarded: (operation: () => Promise<void>) => Promise<void>,
  refresh: () => Promise<unknown>,
  record: (step: UndoStep) => void,
) {
  const client = useQueryClient();
  return (action: StudyAction) =>
    guarded(async () => {
      record(await takeStudyAction(action, client));
      await refresh();
    });
}
