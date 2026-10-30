import CalendarClock from "lucide-react-native/icons/calendar-clock";
import CirclePause from "lucide-react-native/icons/circle-pause";
import Pencil from "lucide-react-native/icons/pencil";
import Star from "lucide-react-native/icons/star";
import Undo2 from "lucide-react-native/icons/undo-2";
import { COLLECTION_QUERY_KEY } from "./collection-query.ts";
import type { LucideIcon } from "lucide-react-native";
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
  icon: LucideIcon,
  run: () => unknown,
  disabled = false,
): StudyMenuItem => ({
  id,
  label,
  icon,
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
    ...flags.map((f): StudyMenuItem => {
      // The set flag's button clears it, so it's named for that.
      const selected = card.fields.flag.value === f.id;
      return {
        id: `flag-${f.id}`,
        label: selected ? t("flagClear") : flagLabel(t, f),
        flag: { color: f.color, selected },
        onPress: () => {
          void setFlag(selected ? 0 : f.id)();
        },
      };
    }),
    ...(undo
      ? [menuItem("undo", editingCopy(locale)("undo"), Undo2, undo.run, !undo.canUndo)]
      : []),
    menuItem("editNote", t("editNote"), Pencil, () => edit(cardId)),
    menuItem("mark", t(marked ? "unmarkNote" : "markNote"), Star, () =>
      change({ kind: "setNoteMarked", cardId, marked: !marked }),
    ),
    menuItem("bury", t("buryCard"), CalendarClock, () => leave({ kind: "buryCard", cardId })),
    menuItem("suspend-card", t("suspendCard"), CirclePause, () =>
      leave({ kind: "suspendCard", cardId }),
    ),
    menuItem("suspend-note", t("suspendNote"), CirclePause, () =>
      leave({ kind: "suspendNote", cardId }),
    ),
  ];
}

/** Takes a card-menu action, refreshes the collection and resolves with the step that undoes it. */
export const takeStudyAction = async (action: StudyAction, client: QueryClient) => {
  const step = await Effect.runPromise(localData((data) => data.studyAction(action)));
  await client.invalidateQueries({ queryKey: COLLECTION_QUERY_KEY });
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
