import type { Locale } from "@app/core";
import { copy } from "./copy.ts";
import type { StudyMenuItem } from "./StudyMenu.tsx";

/** Bury until the next study day: the same item on Decks study, the alarm and the awake check. */
export const buryItem = (locale: Locale, bury: () => Promise<void>): StudyMenuItem => ({
  id: "bury",
  label: copy(locale)("buryCard"),
  onPress: () => {
    void bury();
  },
});
