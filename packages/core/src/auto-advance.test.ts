import { expect, test } from "vite-plus/test";
import {
  autoAdvanceStep,
  Collection,
  parseCollection,
  presetTexts,
  readPresetTexts,
  validPresetText,
  type PresetOptions,
} from "./index.ts";

function collectionWith(options: Partial<PresetOptions> = {}) {
  const c = new Collection({ deviceId: "t", now: () => 1000, random: () => new Uint8Array(16) });
  const deck = c.createDeck("Words");
  c.updatePreset(deck.fields.presetId.value, options);
  return c.snapshot();
}
const presetWith = (options: Partial<PresetOptions> = {}) => collectionWith(options).presets[0]!;

test("auto advance is off until a side has seconds, as in Anki", () => {
  const preset = presetWith();
  expect(preset.fields).toMatchObject({
    secondsToShowQuestion: { value: 0 },
    secondsToShowAnswer: { value: 0 },
    waitForAudio: { value: true },
    questionAction: { value: "showAnswer" },
    answerAction: { value: "bury" },
  });
  expect(autoAdvanceStep(preset, "front")).toBeUndefined();
  expect(autoAdvanceStep(preset, "back")).toBeUndefined();
});

test("each side advances after its own seconds, with its own action", () => {
  const preset = presetWith({
    secondsToShowQuestion: 2.5,
    secondsToShowAnswer: 4,
    waitForAudio: false,
    questionAction: "showReminder",
    answerAction: "hard",
  });
  expect(autoAdvanceStep(preset, "front")).toEqual({
    delayMs: 2500,
    waitForAudio: false,
    action: "showReminder",
  });
  expect(autoAdvanceStep(preset, "back")).toEqual({
    delayMs: 4000,
    waitForAudio: false,
    action: "hard",
  });
});

test("one side can advance while the other waits for the user", () => {
  const preset = presetWith({ secondsToShowAnswer: 3 });
  expect(autoAdvanceStep(preset, "front")).toBeUndefined();
  expect(autoAdvanceStep(preset, "back")).toMatchObject({ delayMs: 3000, action: "bury" });
});

test("rejects negative seconds", () => {
  expect(() => presetWith({ secondsToShowQuestion: -1 })).toThrow("Invalid deck options");
});

test("the options survive form editing, with the locale's decimal comma, and reload", () => {
  const preset = parseCollection(
    collectionWith({
      secondsToShowQuestion: 1.5,
      secondsToShowAnswer: 3,
      waitForAudio: false,
      questionAction: "showReminder",
      answerAction: "again",
    }),
  ).presets[0]!;
  const texts = presetTexts(preset, "pt-BR");
  expect(texts.secondsToShowQuestion).toBe("1,5");
  expect(readPresetTexts(texts)).toMatchObject({
    secondsToShowQuestion: 1.5,
    secondsToShowAnswer: 3,
    waitForAudio: false,
    questionAction: "showReminder",
    answerAction: "again",
  });
  expect(validPresetText.secondsToShowAnswer("abc")).toBe(false);
  expect(validPresetText.answerAction("easy")).toBe(false);
});

test("presets saved before auto advance load with Anki's defaults", () => {
  const stored = collectionWith();
  for (const key of [
    "secondsToShowQuestion",
    "secondsToShowAnswer",
    "waitForAudio",
    "questionAction",
    "answerAction",
  ])
    Reflect.deleteProperty(stored.presets[0]!.fields, key);
  expect(parseCollection(stored).presets[0]!.fields).toMatchObject({
    secondsToShowQuestion: { value: 0 },
    secondsToShowAnswer: { value: 0 },
    waitForAudio: { value: true },
    questionAction: { value: "showAnswer" },
    answerAction: { value: "bury" },
  });
});
