import { translator, type Locale, type Messages } from "@app/core";

const messages = {
  "pt-BR": {
    title: "Despertador",
    updateAvailable: "Nova versão disponível:",
    installUpdate: "Baixar e instalar",
    downloading: "Baixando…",
    dismissUpdate: "Agora não",
    updateFailed:
      "Não foi possível instalar. Permita instalações deste app nos ajustes do Android e tente novamente.",
    tagline: "Para desligar o alarme, acerte os cartões.",
    switchLanguage: "English",
  },
  en: {
    title: "Alarm clock",
    updateAvailable: "New version available:",
    installUpdate: "Download and install",
    downloading: "Downloading…",
    dismissUpdate: "Not now",
    updateFailed:
      "Could not install. Allow installs from this app in Android settings and try again.",
    tagline: "Get the cards right to turn the alarm off.",
    switchLanguage: "Português",
  },
} satisfies Messages<string>;

type CopyKey = keyof (typeof messages)["pt-BR"];

export const copy = (locale: Locale) => translator<CopyKey>(messages, locale);
