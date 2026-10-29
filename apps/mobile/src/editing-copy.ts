import { translator, type Locale, type Messages } from "@app/core";
import { editingMessages } from "@app/editing-ui";
// The note, card and deck options editors.
const messages = {
  "pt-BR": {
    ...editingMessages["pt-BR"],
    noteTypeWebOnly: "Campos, modelos e CSS dos tipos de nota são editados na versão web.",
    card: "Cartão {number}",
    forgetTitle: "Esquecer este cartão?",
    forgetBody:
      "Ele volta a ser novo, no fim da fila de novos. As revisões anteriores continuam no histórico.",
    dueNeedsReview: "Disponível depois da primeira revisão.",
    undo: "Desfazer",
  },
  en: {
    ...editingMessages.en,
    noteTypeWebOnly: "Note type fields, templates and CSS are edited on the web.",
    card: "Card {number}",
    forgetTitle: "Forget this card?",
    forgetBody:
      "It becomes new again, at the end of the new queue. Its earlier reviews stay in the history.",
    dueNeedsReview: "Available after the first review.",
    undo: "Undo",
  },
} satisfies Messages<string>;
type EditingKey = keyof (typeof messages)["pt-BR"];
export const editingCopy = (locale: Locale) => translator<EditingKey>(messages, locale);
export type EditingTranslate = ReturnType<typeof editingCopy>;
