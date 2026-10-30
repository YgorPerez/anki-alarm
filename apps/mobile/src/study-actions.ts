import type { QueryClient } from "@tanstack/react-query";
import type { Card, Locale } from "@app/core";
import { Effect } from "effect";
import { copy } from "./copy.ts";
import { localData } from "./database.ts";
import type { StudyMenuItem } from "./StudyMenu.tsx";

/** Bury until the next study day: the same item on Decks study, the alarm and the awake check. */
export const buryItem = (locale: Locale, bury: () => Promise<void>): StudyMenuItem => ({
  id: "bury",
  label: copy(locale)("buryCard"),
  onPress: () => {
    void bury();
  },
});

/** Buries the card until the next study day; it writes no answer, so it never counts. */
export const buryStudyCard = async (card: Card, client: QueryClient) => {
  await Effect.runPromise(localData((data) => data.changeCollection((c) => c.buryCard(card.id))));
  await client.invalidateQueries({ queryKey: ["collection"] });
};
