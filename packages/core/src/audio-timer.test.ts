import {
  Collection,
  studyAudio,
  studyAnswerDuration,
  presetTexts,
  parseCollection,
  readPresetTexts,
} from "./index.ts";
import { expect, test } from "vite-plus/test";

test("audio and timer options survive form editing and collection reload", () => {
  let id = 0;
  const c = new Collection({
    deviceId: "test",
    now: () => 1000,
    random: () => new Uint8Array(16).fill(++id),
  });
  const deck = c.createDeck("Words");
  c.updatePreset(deck.fields.presetId.value, {
    dontPlayAutomatically: true,
    skipQuestionWhenReplayingAnswer: true,
    maximumAnswerSeconds: 12,
    showTimer: true,
    stopTimerOnAnswer: true,
  });
  const preset = parseCollection(c.snapshot()).presets[0]!;
  expect(readPresetTexts(presetTexts(preset, "en"))).toMatchObject({
    dontPlayAutomatically: true,
    skipQuestionWhenReplayingAnswer: true,
    maximumAnswerSeconds: 12,
    showTimer: true,
    stopTimerOnAnswer: true,
  });
});

test("normal study caps answer duration but alarms keep their own duration", () => {
  const c = new Collection({ deviceId: "t", now: () => 1000, random: () => new Uint8Array(16) });
  const deck = c.createDeck("Words");
  const preset = c.snapshot().presets[0]!;
  c.updatePreset(deck.fields.presetId.value, { maximumAnswerSeconds: 12 });
  expect(studyAnswerDuration(c.snapshot().presets[0]!, 20000)).toBe(12000);
  expect(studyAnswerDuration(preset, 1000)).toBe(1000);
});

test("study audio distinguishes answer autoplay from replay of the question", () => {
  const c = new Collection({ deviceId: "t", now: () => 1000, random: () => new Uint8Array(16) });
  const deck = c.createDeck("Words");
  c.addBasicNote(deck.id, "question [sound:q.mp3]", "answer [sound:a.mp3]");
  const s = c.snapshot();
  const input = { note: s.notes[0]!, type: s.noteTypes[0]!, ordinal: 0 };
  expect(studyAudio(input, "back", s.presets[0]!, false)).toEqual(["a.mp3"]);
  expect(studyAudio(input, "back", s.presets[0]!, true)).toEqual(["q.mp3", "a.mp3"]);
  c.updatePreset(deck.fields.presetId.value, {
    dontPlayAutomatically: true,
    skipQuestionWhenReplayingAnswer: true,
  });
  const preset = c.snapshot().presets[0]!;
  expect(studyAudio(input, "front", preset, false)).toEqual([]);
  expect(studyAudio(input, "back", preset, true)).toEqual(["a.mp3"]);
});
