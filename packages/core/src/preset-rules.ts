import { ANSWER_ACTIONS, QUESTION_ACTIONS, validAutoAdvanceSeconds } from "./auto-advance.ts";
import type { PresetOptions } from "./collection.ts";
import { validDisplayOrder } from "./display-order.ts";
import { EASY_DAYS } from "./easy-days.ts";

/** The bounds of a preset's options, for the rules below and the copy that states them. */
export const PRESET_LIMITS = {
  /** New cards and reviews per day: a whole number from 0 to this. */
  maxPerDay: 9999,
  minRetention: 0.7,
  maxRetention: 0.99,
  maxLearningSteps: 20,
  /** FSRS-6's parameter count. */
  fsrsParameters: 21,
} as const;
/** The rule `updatePreset` applies to each option, for forms to check as the user types. */
export const validOption: { [K in keyof PresetOptions]: (value: PresetOptions[K]) => boolean } = {
  buryNew: (v) => typeof v === "boolean",
  buryReviews: (v) => typeof v === "boolean",
  buryLearning: (v) => typeof v === "boolean",
  dontPlayAutomatically: (v) => typeof v === "boolean",
  skipQuestionWhenReplayingAnswer: (v) => typeof v === "boolean",
  maximumAnswerSeconds: (v) => Number.isSafeInteger(v) && v >= 0 && v <= 9999,
  showTimer: (v) => typeof v === "boolean",
  stopTimerOnAnswer: (v) => typeof v === "boolean",
  secondsToShowQuestion: validAutoAdvanceSeconds,
  secondsToShowAnswer: validAutoAdvanceSeconds,
  waitForAudio: (v) => typeof v === "boolean",
  questionAction: (v) => QUESTION_ACTIONS.includes(v),
  answerAction: (v) => ANSWER_ACTIONS.includes(v),
  name: (v) => typeof v === "string" && Boolean(v.trim()),
  newPerDay: (v) => Number.isSafeInteger(v) && v >= 0 && v <= PRESET_LIMITS.maxPerDay,
  reviewsPerDay: (v) => Number.isSafeInteger(v) && v >= 0 && v <= PRESET_LIMITS.maxPerDay,
  newIgnoreReviewLimit: (v) => typeof v === "boolean",
  applyAllParentLimits: (v) => typeof v === "boolean",
  desiredRetention: (v) =>
    Number.isFinite(v) && v >= PRESET_LIMITS.minRetention && v <= PRESET_LIMITS.maxRetention,
  learningSteps: (v) =>
    Array.isArray(v) &&
    v.length <= PRESET_LIMITS.maxLearningSteps &&
    v.every((n) => Number.isFinite(n) && n > 0),
  relearningSteps: (v) => validOption.learningSteps(v),
  insertionOrder: (v) => v === "sequential" || v === "random",
  leechThreshold: (v) => Number.isSafeInteger(v) && v >= 0 && v <= 9999,
  leechAction: (v) => v === "suspend" || v === "tagOnly",
  maximumInterval: (v) => Number.isSafeInteger(v) && v >= 1 && v <= 36500,
  fsrsParameters: (v) =>
    Array.isArray(v) && v.length === PRESET_LIMITS.fsrsParameters && v.every(Number.isFinite),
  easyDays: (v) => Array.isArray(v) && v.length === 7 && v.every((d) => EASY_DAYS.includes(d)),
  newGatherPriority: (v) => validDisplayOrder("newGatherPriority", v),
  newSortOrder: (v) => validDisplayOrder("newSortOrder", v),
  newMix: (v) => validDisplayOrder("newMix", v),
  interdayLearningMix: (v) => validDisplayOrder("interdayLearningMix", v),
  reviewOrder: (v) => validDisplayOrder("reviewOrder", v),
};
