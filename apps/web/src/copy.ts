import { translator, type Locale, type Messages } from "@app/core";

const messages = {
  "pt-BR": {
    title: "Despertador",
    storageError:
      "Não foi possível acessar o armazenamento local. Confira o espaço e as permissões do navegador e recarregue a página.",
    storageLoading: "Abrindo os dados locais…",
    tagline: "Estude seus baralhos no navegador. Os alarmes tocam no celular.",
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
    freeColor: "cor livre",
    lookAlike: "{a} e {b} se parecem.",
    reset: "Voltar ao tema de fábrica",
  },
  en: {
    title: "Alarm clock",
    storageError:
      "Could not access local storage. Check browser storage space and permissions, then reload the page.",
    storageLoading: "Opening local data…",
    tagline: "Study your decks in the browser. Alarms ring on the phone.",
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
    freeColor: "free color",
    lookAlike: "{a} and {b} look alike.",
    reset: "Back to the factory theme",
  },
} satisfies Messages<string>;

type CopyKey = keyof (typeof messages)["pt-BR"];

export const copy = (locale: Locale) => translator<CopyKey>(messages, locale);
