/** The UI's languages. pt-BR is the source copy and the default. */
export type Locale = "pt-BR" | "en";

/** A screen's copy: every key in pt-BR, and English for the keys it has translated. */
export type Messages<Key extends string> = {
  "pt-BR": Record<Key, string>;
  en: Partial<Record<Key, string>>;
};

/**
 * Looks up copy in `locale`. A string missing in English falls back to pt-BR. `{name}` in the copy
 * takes `params.name`.
 */
export const translator =
  <Key extends string>(messages: Messages<Key>, locale: Locale = "pt-BR") =>
  (key: Key, params: Record<string, string> = {}): string =>
    ((locale === "en" ? messages.en[key] : undefined) ?? messages["pt-BR"][key]).replace(
      /\{(\w+)\}/g,
      (placeholder, name: string) => params[name] ?? placeholder,
    );
