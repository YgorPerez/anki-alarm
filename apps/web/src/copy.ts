import { translator, type Locale, type Messages } from "@app/core";

const messages = {
  "pt-BR": {
    title: "Despertador",
    tagline: "Estude seus baralhos no navegador. Os alarmes tocam no celular.",
    switchLanguage: "English",
  },
  en: {
    title: "Alarm clock",
    tagline: "Study your decks in the browser. Alarms ring on the phone.",
    switchLanguage: "Português",
  },
} satisfies Messages<string>;

type CopyKey = keyof (typeof messages)["pt-BR"];

export const copy = (locale: Locale) => translator<CopyKey>(messages, locale);
