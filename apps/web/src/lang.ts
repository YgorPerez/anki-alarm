import type { Locale } from "@app/core";

/** The language in a link's search: Portuguese is the default, so only English is written. */
export const langSearch = (lang: Locale): { lang?: Locale } => (lang === "en" ? { lang } : {});
