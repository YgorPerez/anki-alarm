import type { QueryClient } from "@tanstack/react-query";
import type { Card, Locale } from "@app/core";
import { copy } from "./copy.ts";
import { takeStudyAction } from "./study-undo.ts";
import type { StudyMenuItem } from "./StudyMenu.tsx";

export type SuspendScope = "card" | "note";

/** Each screen owns the guard and refresh so suspension never submits an answer. */
export function suspensionItems(
  locale: Locale,
  suspend: (scope: SuspendScope) => Promise<void>,
): StudyMenuItem[] {
  return (["card", "note"] as const).map((scope) => ({
    id: `suspend-${scope}`,
    label: copy(locale)(scope === "card" ? "suspendCard" : "suspendNote"),
    onPress: () => {
      void suspend(scope);
    },
  }));
}

/** Suspends the card or its whole note and resolves with the step that undoes it. */
export const suspendStudyCard = async (card: Card, scope: SuspendScope, client: QueryClient) => {
  const step = await takeStudyAction({
    kind: scope === "note" ? "suspendNote" : "suspendCard",
    cardId: card.id,
  });
  await client.invalidateQueries({ queryKey: ["collection"] });
  return step;
};
