// The editors' shared copy: deck options, notes and card actions read the same on the phone and the
// web. Each app spreads it into its own messages and adds the keys only its screens have. The
// limits come from Core, so the copy can't drift from the rules it states.
import { MAX_DUE_DAYS, PRESET_LIMITS, type Messages } from "@app/core";

const { maxPerDay, minRetention, maxRetention, fsrsParameters } = PRESET_LIMITS;
/** A retention as each locale writes it: 0,70 in pt-BR, 0.70 in English. */
const retention = (value: number, comma: boolean) =>
  comma ? value.toFixed(2).replace(".", ",") : value.toFixed(2);

/** Each weekday's message, Monday first, as a preset's `easyDays` lists them. */
export const WEEKDAY_MESSAGES = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export const EASY_DAY_MESSAGES = {
  minimum: "easyDayMinimum",
  reduced: "easyDayReduced",
  normal: "easyDayNormal",
} as const;

export const editingMessages = {
  "pt-BR": {
    deckOptions: "Opções do baralho",
    advanced: "Avançado",
    discardOptions: "Descartar as alterações não salvas?",
    presetName: "Nome da predefinição",
    sharedPreset: "Estas opções valem para {count} baralhos.",
    newPerDay: "Cartões novos por dia",
    reviewsPerDay: "Revisões por dia",
    desiredRetention: "Retenção desejada",
    desiredRetentionHint: `De ${retention(minRetention, true)} a ${retention(maxRetention, true)}. Mais alta: mais revisões, menos esquecimento.`,
    learningSteps: "Etapas de aprendizado (minutos)",
    learningStepsHint: "Separadas por espaço, por exemplo 1 10.",
    fsrsParameters: "Parâmetros do FSRS",
    fsrsParametersHint: `${fsrsParameters} números separados por vírgula, com ponto decimal.`,
    defaultParameters: "Usar os parâmetros padrão",
    easyDays: "Dias fáceis",
    easyDaysHint:
      "As próximas respostas evitam os dias mínimos e reduzidos, em intervalos de até 90 dias. Cartões já respondidos não mudam.",
    easyDayMinimum: "Mínimo",
    easyDayReduced: "Reduzido",
    easyDayNormal: "Normal",
    monday: "Segunda-feira",
    tuesday: "Terça-feira",
    wednesday: "Quarta-feira",
    thursday: "Quinta-feira",
    friday: "Sexta-feira",
    saturday: "Sábado",
    sunday: "Domingo",
    invalidLimit: `Use um número inteiro de 0 a ${maxPerDay}.`,
    invalidRetention: `Use um valor de ${retention(minRetention, true)} a ${retention(maxRetention, true)}.`,
    invalidSteps: "Use minutos maiores que zero, separados por espaço.",
    invalidParameters: `Informe os ${fsrsParameters} números do FSRS-6.`,
    invalidName: "Dê um nome.",
    noteType: "Tipo de nota",
    deck: "Baralho",
    moveHint: "Trocar o baralho move os cartões desta nota.",
    firstFieldRequired: "Preencha o primeiro campo.",
    front: "Frente",
    back: "Verso",
    cardNew: "Novo",
    cardDue: "Vence em {date}",
    forget: "Esquecer",
    setDueDate: "Definir vencimento",
    dueDays: "Vence daqui a quantos dias (0 = hoje)",
    invalidDays: `Use um número inteiro de 0 a ${MAX_DUE_DAYS}.`,
    // A linked deck's card (ADR 0003): AnkiDroid can't take either change.
    linkedOnly:
      "Esquecer e Definir vencimento ficam só no app: o AnkiDroid não recebe essas mudanças. A próxima revisão deste cartão no AnkiDroid as substitui.",
  },
  en: {
    deckOptions: "Deck options",
    advanced: "Advanced",
    discardOptions: "Discard unsaved changes?",
    presetName: "Preset name",
    sharedPreset: "These options apply to {count} decks.",
    newPerDay: "New cards per day",
    reviewsPerDay: "Reviews per day",
    desiredRetention: "Desired retention",
    desiredRetentionHint: `From ${retention(minRetention, false)} to ${retention(maxRetention, false)}. Higher: more reviews, less forgetting.`,
    learningSteps: "Learning steps (minutes)",
    learningStepsHint: "Separated by spaces, for example 1 10.",
    fsrsParameters: "FSRS parameters",
    fsrsParametersHint: `${fsrsParameters} numbers separated by commas, with a decimal point.`,
    defaultParameters: "Use the default parameters",
    easyDays: "Easy days",
    easyDaysHint:
      "Later answers avoid minimum and reduced days, for intervals up to 90 days. Cards already answered stay put.",
    easyDayMinimum: "Minimum",
    easyDayReduced: "Reduced",
    easyDayNormal: "Normal",
    monday: "Monday",
    tuesday: "Tuesday",
    wednesday: "Wednesday",
    thursday: "Thursday",
    friday: "Friday",
    saturday: "Saturday",
    sunday: "Sunday",
    invalidLimit: `Use a whole number from 0 to ${maxPerDay}.`,
    invalidRetention: `Use a value from ${retention(minRetention, false)} to ${retention(maxRetention, false)}.`,
    invalidSteps: "Use minutes above zero, separated by spaces.",
    invalidParameters: `Enter FSRS-6's ${fsrsParameters} numbers.`,
    invalidName: "Give it a name.",
    noteType: "Note type",
    deck: "Deck",
    moveHint: "Changing the deck moves this note's cards.",
    firstFieldRequired: "Fill in the first field.",
    front: "Front",
    back: "Back",
    cardNew: "New",
    cardDue: "Due {date}",
    forget: "Forget",
    setDueDate: "Set due date",
    dueDays: "Due in how many days (0 = today)",
    invalidDays: `Use a whole number from 0 to ${MAX_DUE_DAYS}.`,
    linkedOnly:
      "Forget and Set due date stay in the app: AnkiDroid doesn't get these changes. This card's next review in AnkiDroid replaces them.",
  },
} satisfies Messages<string>;
