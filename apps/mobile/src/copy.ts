import { translator, type Locale, type Messages } from "@app/core";

const messages = {
  "pt-BR": {
    title: "Despertador",
    tagline: "Para desligar o alarme, acerte os cartões.",
    switchLanguage: "English",
    theme: "Tema",
    back: "Voltar",
    lightBackground: "Fundo claro",
    darkBackground: "Fundo escuro",
    primary: "Primária",
    secondary: "Secundária",
    again: "De novo",
    hard: "Difícil",
    good: "Bom",
    easy: "Fácil",
    sameAsPrimary: "Igual à primária",
    freeColor: "cor livre (#rrggbb)",
    lookAlike: "{a} e {b} se parecem.",
    onTheAlarm: "No alarme",
    cardsLeft: "faltam 3",
    reset: "Voltar ao tema de fábrica",
  },
  en: {
    title: "Alarm clock",
    tagline: "Get the cards right to turn the alarm off.",
    switchLanguage: "Português",
    theme: "Theme",
    back: "Back",
    lightBackground: "Light background",
    darkBackground: "Dark background",
    primary: "Primary",
    secondary: "Secondary",
    again: "Again",
    hard: "Hard",
    good: "Good",
    easy: "Easy",
    sameAsPrimary: "Same as primary",
    freeColor: "free color (#rrggbb)",
    lookAlike: "{a} and {b} look alike.",
    onTheAlarm: "On the alarm",
    cardsLeft: "3 left",
    reset: "Back to the factory theme",
  },
} satisfies Messages<string>;

type CopyKey = keyof (typeof messages)["pt-BR"];

export const copy = (locale: Locale) => translator<CopyKey>(messages, locale);
