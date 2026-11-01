import {
  ANSWER_ACTIONS,
  QUESTION_ACTIONS,
  type AnswerAction,
  type QuestionAction,
} from "./auto-advance.ts";
import type { Preset, PresetOptions } from "./collection.ts";
import { validOption } from "./preset-rules.ts";
import { DISPLAY_ORDER_KEYS, validDisplayOrder, type DisplayOrder } from "./display-order.ts";
import { EASY_DAYS, type EasyDay } from "./easy-days.ts";
import type { Locale } from "./locale.ts";

/** Deck options as a form holds them: the text the user types for each one. */
export type PresetTexts = Record<keyof PresetOptions, string>;

// What each option reads from its text. undefined: not a value of that type.
const integer = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined);
const decimal = (text: string) => {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() && Number.isFinite(value) ? value : undefined;
};
const list = (text: string, separator: RegExp) => {
  const parts = text.trim() ? text.trim().split(separator) : [];
  const values = parts.map(Number);
  return parts.every((p) => p !== "") && values.every(Number.isFinite) ? values : undefined;
};
const isEasyDay = (text: string): text is EasyDay => EASY_DAYS.some((day) => day === text);
const boolean = (text: string) => (text === "true" ? true : text === "false" ? false : undefined);
const choice =
  <K extends keyof DisplayOrder>(key: K) =>
  (text: string) =>
    validDisplayOrder(key, text) ? text : undefined;
const read = {
  buryNew: boolean,
  buryReviews: boolean,
  buryLearning: boolean,
  dontPlayAutomatically: boolean,
  skipQuestionWhenReplayingAnswer: boolean,
  maximumAnswerSeconds: integer,
  showTimer: boolean,
  stopTimerOnAnswer: boolean,
  secondsToShowQuestion: decimal,
  secondsToShowAnswer: decimal,
  waitForAudio: boolean,
  questionAction: (text: string) => QUESTION_ACTIONS.find((a): a is QuestionAction => a === text),
  answerAction: (text: string) => ANSWER_ACTIONS.find((a): a is AnswerAction => a === text),
  name: (text: string) => text.trim(),
  newPerDay: integer,
  reviewsPerDay: integer,
  newIgnoreReviewLimit: boolean,
  applyAllParentLimits: boolean,
  desiredRetention: decimal,
  learningSteps: (text: string) => list(text, /\s+/),
  relearningSteps: (text: string) => list(text, /\s+/),
  insertionOrder: (text: string) => (text === "sequential" || text === "random" ? text : undefined),
  leechThreshold: integer,
  leechAction: (text: string) => (text === "suspend" || text === "tagOnly" ? text : undefined),
  maximumInterval: integer,
  fsrsParameters: (text: string) => list(text, /[\s,;]+/),
  easyDays: (text: string) => {
    const days = text.split(" ");
    return days.every(isEasyDay) ? days : undefined;
  },
  newGatherPriority: choice("newGatherPriority"),
  newSortOrder: choice("newSortOrder"),
  newMix: choice("newMix"),
  interdayLearningMix: choice("interdayLearningMix"),
  reviewOrder: choice("reviewOrder"),
} satisfies { [K in keyof PresetOptions]: (text: string) => PresetOptions[K] | undefined };
const KEYS = [
  "secondsToShowQuestion",
  "secondsToShowAnswer",
  "waitForAudio",
  "questionAction",
  "answerAction",
  "dontPlayAutomatically",
  "skipQuestionWhenReplayingAnswer",
  "maximumAnswerSeconds",
  "showTimer",
  "stopTimerOnAnswer",

  "name",
  "newPerDay",
  "reviewsPerDay",
  "newIgnoreReviewLimit",
  "applyAllParentLimits",
  "desiredRetention",
  "learningSteps",
  "relearningSteps",
  "insertionOrder",
  "leechThreshold",
  "leechAction",
  "maximumInterval",
  "fsrsParameters",
  "easyDays",
  "buryNew",
  "buryReviews",
  "buryLearning",
  ...DISPLAY_ORDER_KEYS,
] as const satisfies readonly (keyof PresetOptions)[];
const ok = <T>(value: T | undefined, rule: (value: T) => boolean) =>
  value !== undefined && rule(value);

/** Core's rule for each option (`validOption`), applied to what the user typed. */
export const validPresetText: Record<keyof PresetOptions, (text: string) => boolean> = {
  buryNew: (text) => ok(read.buryNew(text), validOption.buryNew),
  buryReviews: (text) => ok(read.buryReviews(text), validOption.buryReviews),
  buryLearning: (text) => ok(read.buryLearning(text), validOption.buryLearning),
  dontPlayAutomatically: (text) =>
    ok(read.dontPlayAutomatically(text), validOption.dontPlayAutomatically),
  skipQuestionWhenReplayingAnswer: (text) =>
    ok(read.skipQuestionWhenReplayingAnswer(text), validOption.skipQuestionWhenReplayingAnswer),
  maximumAnswerSeconds: (text) =>
    ok(read.maximumAnswerSeconds(text), validOption.maximumAnswerSeconds),
  showTimer: (text) => ok(read.showTimer(text), validOption.showTimer),
  stopTimerOnAnswer: (text) => ok(read.stopTimerOnAnswer(text), validOption.stopTimerOnAnswer),
  secondsToShowQuestion: (text) =>
    ok(read.secondsToShowQuestion(text), validOption.secondsToShowQuestion),
  secondsToShowAnswer: (text) =>
    ok(read.secondsToShowAnswer(text), validOption.secondsToShowAnswer),
  waitForAudio: (text) => ok(read.waitForAudio(text), validOption.waitForAudio),
  questionAction: (text) => ok(read.questionAction(text), validOption.questionAction),
  answerAction: (text) => ok(read.answerAction(text), validOption.answerAction),
  name: (text) => validOption.name(text),
  newPerDay: (text) => ok(read.newPerDay(text), validOption.newPerDay),
  reviewsPerDay: (text) => ok(read.reviewsPerDay(text), validOption.reviewsPerDay),
  newIgnoreReviewLimit: (text) =>
    ok(read.newIgnoreReviewLimit(text), validOption.newIgnoreReviewLimit),
  applyAllParentLimits: (text) =>
    ok(read.applyAllParentLimits(text), validOption.applyAllParentLimits),
  desiredRetention: (text) => ok(read.desiredRetention(text), validOption.desiredRetention),
  learningSteps: (text) => ok(read.learningSteps(text), validOption.learningSteps),
  relearningSteps: (text) => ok(read.relearningSteps(text), validOption.relearningSteps),
  insertionOrder: (text) => ok(read.insertionOrder(text), validOption.insertionOrder),
  leechThreshold: (text) => ok(read.leechThreshold(text), validOption.leechThreshold),
  leechAction: (text) => ok(read.leechAction(text), validOption.leechAction),
  maximumInterval: (text) => ok(read.maximumInterval(text), validOption.maximumInterval),
  fsrsParameters: (text) => ok(read.fsrsParameters(text), validOption.fsrsParameters),
  easyDays: (text) => ok(read.easyDays(text), validOption.easyDays),
  newGatherPriority: (text) => validDisplayOrder("newGatherPriority", text),
  newSortOrder: (text) => validDisplayOrder("newSortOrder", text),
  newMix: (text) => validDisplayOrder("newMix", text),
  interdayLearningMix: (text) => validDisplayOrder("interdayLearningMix", text),
  reviewOrder: (text) => validDisplayOrder("reviewOrder", text),
};

/** A preset's options as text, with the locale's decimal comma. */
export const presetTexts = (preset: Preset, locale: Locale): PresetTexts =>
  textsOf((key) => preset.fields[key].value, locale);
/** Options read from elsewhere as text, the same way. */
export const presetOptionTexts = (options: PresetOptions, locale: Locale): PresetTexts =>
  textsOf((key) => options[key], locale);

function textsOf(
  get: <K extends keyof PresetOptions>(key: K) => PresetOptions[K],
  locale: Locale,
): PresetTexts {
  const decimalText = (n: number) => (locale === "pt-BR" ? String(n).replace(".", ",") : String(n));
  return {
    buryNew: String(get("buryNew")),
    buryReviews: String(get("buryReviews")),
    buryLearning: String(get("buryLearning")),
    dontPlayAutomatically: String(get("dontPlayAutomatically")),
    skipQuestionWhenReplayingAnswer: String(get("skipQuestionWhenReplayingAnswer")),
    maximumAnswerSeconds: String(get("maximumAnswerSeconds")),
    showTimer: String(get("showTimer")),
    stopTimerOnAnswer: String(get("stopTimerOnAnswer")),
    secondsToShowQuestion: decimalText(get("secondsToShowQuestion")),
    secondsToShowAnswer: decimalText(get("secondsToShowAnswer")),
    waitForAudio: String(get("waitForAudio")),
    questionAction: get("questionAction"),
    answerAction: get("answerAction"),
    name: get("name"),
    newPerDay: String(get("newPerDay")),
    reviewsPerDay: String(get("reviewsPerDay")),
    newIgnoreReviewLimit: String(get("newIgnoreReviewLimit")),
    applyAllParentLimits: String(get("applyAllParentLimits")),
    desiredRetention: decimalText(get("desiredRetention")),
    learningSteps: get("learningSteps").join(" "),
    relearningSteps: get("relearningSteps").join(" "),
    insertionOrder: get("insertionOrder"),
    leechThreshold: String(get("leechThreshold")),
    leechAction: get("leechAction"),
    maximumInterval: String(get("maximumInterval")),
    fsrsParameters: get("fsrsParameters").join(", "),
    easyDays: get("easyDays").join(" "),
    newGatherPriority: get("newGatherPriority"),
    newSortOrder: get("newSortOrder"),
    newMix: get("newMix"),
    interdayLearningMix: get("interdayLearningMix"),
    reviewOrder: get("reviewOrder"),
  };
}

/** The options the texts stand for; undefined while any of them is invalid. */
export function readPresetTexts(texts: PresetTexts): PresetOptions | undefined {
  if (!KEYS.every((key) => validPresetText[key](texts[key]))) return undefined;
  return {
    buryNew: read.buryNew(texts.buryNew)!,
    buryReviews: read.buryReviews(texts.buryReviews)!,
    buryLearning: read.buryLearning(texts.buryLearning)!,
    dontPlayAutomatically: read.dontPlayAutomatically(texts.dontPlayAutomatically)!,
    skipQuestionWhenReplayingAnswer: read.skipQuestionWhenReplayingAnswer(
      texts.skipQuestionWhenReplayingAnswer,
    )!,
    maximumAnswerSeconds: read.maximumAnswerSeconds(texts.maximumAnswerSeconds)!,
    showTimer: read.showTimer(texts.showTimer)!,
    stopTimerOnAnswer: read.stopTimerOnAnswer(texts.stopTimerOnAnswer)!,
    secondsToShowQuestion: read.secondsToShowQuestion(texts.secondsToShowQuestion)!,
    secondsToShowAnswer: read.secondsToShowAnswer(texts.secondsToShowAnswer)!,
    waitForAudio: read.waitForAudio(texts.waitForAudio)!,
    questionAction: read.questionAction(texts.questionAction)!,
    answerAction: read.answerAction(texts.answerAction)!,
    name: read.name(texts.name),
    newPerDay: read.newPerDay(texts.newPerDay)!,
    reviewsPerDay: read.reviewsPerDay(texts.reviewsPerDay)!,
    newIgnoreReviewLimit: read.newIgnoreReviewLimit(texts.newIgnoreReviewLimit)!,
    applyAllParentLimits: read.applyAllParentLimits(texts.applyAllParentLimits)!,
    desiredRetention: read.desiredRetention(texts.desiredRetention)!,
    learningSteps: read.learningSteps(texts.learningSteps)!,
    relearningSteps: read.relearningSteps(texts.relearningSteps)!,
    insertionOrder: read.insertionOrder(texts.insertionOrder)!,
    leechThreshold: read.leechThreshold(texts.leechThreshold)!,
    leechAction: read.leechAction(texts.leechAction)!,
    maximumInterval: read.maximumInterval(texts.maximumInterval)!,
    fsrsParameters: read.fsrsParameters(texts.fsrsParameters)!,
    easyDays: read.easyDays(texts.easyDays)!,
    newGatherPriority: read.newGatherPriority(texts.newGatherPriority)!,
    newSortOrder: read.newSortOrder(texts.newSortOrder)!,
    newMix: read.newMix(texts.newMix)!,
    interdayLearningMix: read.interdayLearningMix(texts.interdayLearningMix)!,
    reviewOrder: read.reviewOrder(texts.reviewOrder)!,
  };
}
