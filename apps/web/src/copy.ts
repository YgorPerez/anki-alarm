import { translator, type Locale, type Messages } from "@app/core";

const messages = {
  "pt-BR": {
    title: "Despertador",
    tagline: "Para desligar o alarme, acerte os cartões.",
    switchLanguage: "English",
  },
  en: {
    title: "Alarm clock",
    tagline: "Get the cards right to turn the alarm off.",
    switchLanguage: "Português",
  },
} satisfies Messages<string>;

export type CopyKey = keyof (typeof messages)["pt-BR"];

export const copy = (locale: Locale) => translator<CopyKey>(messages, locale);
