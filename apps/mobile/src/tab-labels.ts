import type { Locale } from "@app/core";
import { copy } from "./copy.ts";

/** Each tab's name, on its button and as its page's title in the native header. */
export function tabLabels(locale: Locale) {
  const t = copy(locale);
  return {
    index: t("alarms"),
    decks: t("title"),
    stats: locale === "pt-BR" ? "Estatísticas" : "Stats",
  };
}
