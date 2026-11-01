import type { Preset } from "./collection.ts";

// Each action's index is its number in Anki's deck_config.proto.
export const QUESTION_ACTIONS = ["showAnswer", "showReminder"] as const;
export const ANSWER_ACTIONS = ["bury", "again", "good", "hard", "showReminder"] as const;
export type QuestionAction = (typeof QUESTION_ACTIONS)[number];
export type AnswerAction = (typeof ANSWER_ACTIONS)[number];

const MAX_AUTO_ADVANCE_SECONDS = 9999;

/** Anki's defaults: off, because each side's seconds start at 0. */
export const AUTO_ADVANCE_DEFAULTS = {
  secondsToShowQuestion: 0,
  secondsToShowAnswer: 0,
  waitForAudio: true,
  questionAction: "showAnswer" as QuestionAction,
  answerAction: "bury" as AnswerAction,
};
export type AutoAdvanceOptions = typeof AUTO_ADVANCE_DEFAULTS;

export const validAutoAdvanceSeconds = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_AUTO_ADVANCE_SECONDS;

/** A preset's auto advance options, as plain values. */
export function autoAdvanceOptions({ fields: f }: Preset): AutoAdvanceOptions {
  return {
    secondsToShowQuestion: f.secondsToShowQuestion.value,
    secondsToShowAnswer: f.secondsToShowAnswer.value,
    waitForAudio: f.waitForAudio.value,
    questionAction: f.questionAction.value,
    answerAction: f.answerAction.value,
  };
}

// As an Anki package stores them; anything unreadable falls back to the default.
export const ankiSeconds = (v: unknown) => (validAutoAdvanceSeconds(v) ? v : 0);
export const ankiQuestionAction = (v: unknown): QuestionAction =>
  (typeof v === "number" ? QUESTION_ACTIONS[v] : undefined) ?? AUTO_ADVANCE_DEFAULTS.questionAction;
export const ankiAnswerAction = (v: unknown): AnswerAction =>
  (typeof v === "number" ? ANSWER_ACTIONS[v] : undefined) ?? AUTO_ADVANCE_DEFAULTS.answerAction;

/** Auto advance for Anki's `dconf` JSON. */
export function ankiAutoAdvance(options: AutoAdvanceOptions) {
  return {
    secondsToShowQuestion: options.secondsToShowQuestion,
    secondsToShowAnswer: options.secondsToShowAnswer,
    waitForAudio: options.waitForAudio,
    questionAction: QUESTION_ACTIONS.indexOf(options.questionAction),
    answerAction: ANSWER_ACTIONS.indexOf(options.answerAction),
  };
}

export interface AutoAdvanceStep {
  delayMs: number;
  /** The delay starts when the side's audio ends. */
  waitForAudio: boolean;
  action: QuestionAction | AnswerAction;
}

/**
 * What normal study does by itself on a card side; undefined leaves it to the user. An alarm session
 * and an awake check never ask: auto advance must not pass an alarm unanswered.
 */
export function autoAdvanceStep(
  preset: Preset,
  side: "front" | "back",
): AutoAdvanceStep | undefined {
  const f = preset.fields;
  const seconds = side === "front" ? f.secondsToShowQuestion.value : f.secondsToShowAnswer.value;
  if (seconds <= 0) return undefined;
  return {
    delayMs: Math.round(seconds * 1000),
    waitForAudio: f.waitForAudio.value,
    action: side === "front" ? f.questionAction.value : f.answerAction.value,
  };
}
