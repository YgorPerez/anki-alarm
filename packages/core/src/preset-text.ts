import { validOption, type Preset, type PresetOptions } from "./collection.ts";
import { DISPLAY_ORDER_KEYS, validDisplayOrder, type DisplayOrder } from "./display-order.ts";
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
  name: (text: string) => text.trim(),
  newPerDay: integer,
  reviewsPerDay: integer,
  desiredRetention: decimal,
  learningSteps: (text: string) => list(text, /\s+/),
  fsrsParameters: (text: string) => list(text, /[\s,;]+/),
  newGatherPriority: choice("newGatherPriority"),
  newSortOrder: choice("newSortOrder"),
  newMix: choice("newMix"),
  interdayLearningMix: choice("interdayLearningMix"),
  reviewOrder: choice("reviewOrder"),
} satisfies { [K in keyof PresetOptions]: (text: string) => PresetOptions[K] | undefined };
const KEYS = [
  "dontPlayAutomatically",
  "skipQuestionWhenReplayingAnswer",
  "maximumAnswerSeconds",
  "showTimer",
  "stopTimerOnAnswer",

  "name",
  "newPerDay",
  "reviewsPerDay",
  "desiredRetention",
  "learningSteps",
  "fsrsParameters",
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
  name: (text) => validOption.name(text),
  newPerDay: (text) => ok(read.newPerDay(text), validOption.newPerDay),
  reviewsPerDay: (text) => ok(read.reviewsPerDay(text), validOption.reviewsPerDay),
  desiredRetention: (text) => ok(read.desiredRetention(text), validOption.desiredRetention),
  learningSteps: (text) => ok(read.learningSteps(text), validOption.learningSteps),
  fsrsParameters: (text) => ok(read.fsrsParameters(text), validOption.fsrsParameters),
  newGatherPriority: (text) => validDisplayOrder("newGatherPriority", text),
  newSortOrder: (text) => validDisplayOrder("newSortOrder", text),
  newMix: (text) => validDisplayOrder("newMix", text),
  interdayLearningMix: (text) => validDisplayOrder("interdayLearningMix", text),
  reviewOrder: (text) => validDisplayOrder("reviewOrder", text),
};

/** A preset's options as text, with the locale's decimal comma. */
export function presetTexts(preset: Preset, locale: Locale): PresetTexts {
  const f = preset.fields;
  const decimalText = (n: number) => (locale === "pt-BR" ? String(n).replace(".", ",") : String(n));
  return {
    buryNew: String(f.buryNew.value),
    buryReviews: String(f.buryReviews.value),
    buryLearning: String(f.buryLearning.value),
    dontPlayAutomatically: String(f.dontPlayAutomatically.value),
    skipQuestionWhenReplayingAnswer: String(f.skipQuestionWhenReplayingAnswer.value),
    maximumAnswerSeconds: String(f.maximumAnswerSeconds.value),
    showTimer: String(f.showTimer.value),
    stopTimerOnAnswer: String(f.stopTimerOnAnswer.value),
    name: f.name.value,
    newPerDay: String(f.newPerDay.value),
    reviewsPerDay: String(f.reviewsPerDay.value),
    desiredRetention: decimalText(f.desiredRetention.value),
    learningSteps: f.learningSteps.value.join(" "),
    fsrsParameters: f.fsrsParameters.value.join(", "),
    newGatherPriority: f.newGatherPriority.value,
    newSortOrder: f.newSortOrder.value,
    newMix: f.newMix.value,
    interdayLearningMix: f.interdayLearningMix.value,
    reviewOrder: f.reviewOrder.value,
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
    name: read.name(texts.name),
    newPerDay: read.newPerDay(texts.newPerDay)!,
    reviewsPerDay: read.reviewsPerDay(texts.reviewsPerDay)!,
    desiredRetention: read.desiredRetention(texts.desiredRetention)!,
    learningSteps: read.learningSteps(texts.learningSteps)!,
    fsrsParameters: read.fsrsParameters(texts.fsrsParameters)!,
    newGatherPriority: read.newGatherPriority(texts.newGatherPriority)!,
    newSortOrder: read.newSortOrder(texts.newSortOrder)!,
    newMix: read.newMix(texts.newMix)!,
    interdayLearningMix: read.interdayLearningMix(texts.interdayLearningMix)!,
    reviewOrder: read.reviewOrder(texts.reviewOrder)!,
  };
}
