import type { QueryClient } from "@tanstack/react-query";
import type { Card, Locale } from "@app/core";
import { copy } from "./copy.ts";
import { takeStudyAction } from "./study-undo.ts";
import type { StudyMenuItem } from "./StudyMenu.tsx";

/** Bury until the next study day: the same item on Decks study, the alarm and the awake check. */
export const buryItem = (locale: Locale, bury: () => Promise<void>): StudyMenuItem => ({
  id: "bury",
  label: copy(locale)("buryCard"),
  onPress: () => {
    void bury();
  },
});

/**
 * Buries the card until the next study day; it writes no answer, so it never counts. Resolves
 * with the step that undoes it.
 */
export const buryStudyCard = async (card: Card, client: QueryClient) => {
  const step = await takeStudyAction({ kind: "buryCard", cardId: card.id });
  await client.invalidateQueries({ queryKey: ["collection"] });
  return step;
};
