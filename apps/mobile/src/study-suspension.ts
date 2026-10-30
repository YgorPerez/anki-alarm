import type { QueryClient } from "@tanstack/react-query";
import type { Card, Locale } from "@app/core";
import { Effect } from "effect";
import { copy } from "./copy.ts";
import { localData } from "./database.ts";
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

export const suspendStudyCard = async (card: Card, scope: SuspendScope, client: QueryClient) => {
  await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        if (scope === "note") c.suspendNote(card.fields.noteId.value);
        else c.setCardsSuspended([card.id], true);
      }),
    ),
  );

  await client.invalidateQueries({ queryKey: ["collection"] });
};
