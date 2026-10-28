import { translator, type Locale, type Messages } from "@app/core";
const messages = {
  "pt-BR": {
    title: "AnkiDroid",
    entry: "Vincular do AnkiDroid",
    back: "Voltar",
    checking: "Procurando o AnkiDroid…",
    missing:
      "O AnkiDroid não está instalado neste celular. Instale-o para vincular um baralho. O resto do app funciona normalmente.",
    outdated:
      "Para vincular um baralho, é preciso o AnkiDroid 2.24 ou mais novo. Atualize o AnkiDroid e volte aqui.",
    permission:
      "Para ler seus baralhos, o app precisa da permissão de acesso ao AnkiDroid. O resto do app funciona sem ela.",
    allow: "Permitir acesso ao AnkiDroid",
    unavailable: "O AnkiDroid ainda não abriu sua coleção. Abra o AnkiDroid uma vez e volte aqui.",
    failed: "Não foi possível ler o AnkiDroid. Tente novamente.",
    retry: "Tentar novamente",
    choose:
      "Escolha um baralho. Ele vem com os subbaralhos, as notas e o estado de cada cartão, e fica vinculado a este celular.",
    none: "Nenhum baralho no AnkiDroid.",
    linking: "Vinculando {name}…",
    linked: "{name} foi vinculado a este celular.",
    linkError: "Não foi possível vincular o baralho. Nada foi alterado. Tente novamente.",
    media:
      "Imagens e áudio não vêm pela API do AnkiDroid. No AnkiDroid, exporte este baralho como .apkg com a mídia incluída e escolha o arquivo aqui.",
    pick: "Escolher arquivo .apkg",
    importing: "Lendo o arquivo…",
    imported: "{count} arquivos de mídia adicionados.",
    mediaError: "Não foi possível ler esse arquivo. Escolha um .apkg exportado do AnkiDroid.",
    open: "Abrir baralho",
    linkedLabel: "Vinculado ao AnkiDroid",
  },
  en: {
    title: "AnkiDroid",
    entry: "Link from AnkiDroid",
    back: "Back",
    checking: "Looking for AnkiDroid…",
    missing:
      "AnkiDroid isn't installed on this phone. Install it to link a deck. The rest of the app works as usual.",
    outdated: "Linking a deck needs AnkiDroid 2.24 or newer. Update AnkiDroid and come back here.",
    permission:
      "To read your decks, the app needs permission to access AnkiDroid. The rest of the app works without it.",
    allow: "Allow access to AnkiDroid",
    unavailable: "AnkiDroid hasn't opened its collection yet. Open AnkiDroid once and come back.",
    failed: "Couldn't read AnkiDroid. Try again.",
    retry: "Try again",
    choose:
      "Choose a deck. It comes with its subdecks, notes and each card's state, and is linked to this phone.",
    none: "No decks in AnkiDroid.",
    linking: "Linking {name}…",
    linked: "{name} is linked to this phone.",
    linkError: "Couldn't link the deck. Nothing was changed. Try again.",
    media:
      "Images and audio don't come through AnkiDroid's API. In AnkiDroid, export this deck as .apkg with media included and choose the file here.",
    pick: "Choose .apkg file",
    importing: "Reading the file…",
    imported: "{count} media files added.",
    mediaError: "Couldn't read that file. Choose an .apkg exported from AnkiDroid.",
    open: "Open deck",
    linkedLabel: "Linked to AnkiDroid",
  },
} satisfies Messages<string>;
export const ankiDroidCopy = (locale: Locale) =>
  translator<keyof (typeof messages)["pt-BR"]>(messages, locale);
