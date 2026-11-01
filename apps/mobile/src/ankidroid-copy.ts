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
    otherPhone:
      "Este baralho está vinculado ao AnkiDroid em outro celular. Para puxar e enviar daqui, vincule-o de novo neste celular.",
    pull: "Puxar do AnkiDroid",
    pulling: "Enviando revisões e puxando do AnkiDroid…",
    pulled:
      "Do AnkiDroid: {added} notas novas, {edited} editadas, {snapshots} cartões com estado novo. {sent} revisões enviadas.",
    pullError: "Não foi possível puxar do AnkiDroid. Tente novamente.",
    syncBack: "Enviar revisões ao AnkiDroid",
    syncingBack: "Enviando revisões ao AnkiDroid…",
    sentBack: "{sent} revisões enviadas ao AnkiDroid.",
    held: "{held} revisões esperam: o cartão está suspenso ou enterrado no AnkiDroid.",
    syncBackError:
      "Não foi possível enviar ao AnkiDroid. As revisões que faltaram vão na próxima vez.",
    syncBackNote:
      "O AnkiDroid registra cada revisão na hora do envio, com o tempo de resposta limitado pelo baralho dele.",
    pending: "{count} revisões pendentes para o AnkiDroid.",
    waiting: "Ainda não enviadas. Use Enviar revisões ou ative o envio automático.",
    notRecorded:
      "O AnkiDroid não registrou uma resposta. O envio parou; as revisões restantes continuam pendentes. Abra o AnkiDroid e tente enviar novamente.",
    autoStopped: "O envio automático ao AnkiDroid parou.",
    autoDetails:
      "Envia ao terminar o estudo, ao sair do app e depois de cada alarme. Só neste celular.",
    auto: "Enviar ao AnkiDroid automaticamente",
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
    otherPhone:
      "This deck is linked to AnkiDroid on another phone. To pull and send from here, link it again on this phone.",
    pull: "Pull from AnkiDroid",
    pulling: "Sending reviews and pulling from AnkiDroid…",
    pulled:
      "From AnkiDroid: {added} new notes, {edited} edited, {snapshots} cards with a new state. {sent} reviews sent.",
    pullError: "Couldn't pull from AnkiDroid. Try again.",
    syncBack: "Send reviews to AnkiDroid",
    syncingBack: "Sending reviews to AnkiDroid…",
    sentBack: "{sent} reviews sent to AnkiDroid.",
    held: "{held} reviews are waiting: the card is suspended or buried in AnkiDroid.",
    syncBackError: "Couldn't send to AnkiDroid. The reviews left go next time.",
    syncBackNote:
      "AnkiDroid records each review at the time it's sent, with the answer time capped by its deck.",
    pending: "{count} pending answers for AnkiDroid.",
    waiting: "Not sent yet. Use Send reviews or turn on automatic sending.",
    notRecorded:
      "AnkiDroid did not record an answer. Sending stopped; the remaining reviews are still pending. Open AnkiDroid and try sending again.",
    autoStopped: "Automatic sending to AnkiDroid stopped.",
    autoDetails:
      "Sends when study ends, when leaving the app and after each alarm. This phone only.",
    auto: "Send to AnkiDroid automatically",
  },
} satisfies Messages<string>;
export const ankiDroidCopy = (locale: Locale) =>
  translator<keyof (typeof messages)["pt-BR"]>(messages, locale);
