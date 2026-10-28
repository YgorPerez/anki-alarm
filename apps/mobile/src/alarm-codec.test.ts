import { expect, it } from "vite-plus/test";
import { newAlarm } from "@app/core";
import { decodeAlarm, decodeAlarms, decodeAwakeCheck, decodeRing } from "./alarm-codec.ts";

const stored = (sound: unknown) => JSON.stringify({ ...newAlarm("a"), sound });

it("reads an alarm saved before sound choices as ringing the phone's alarm sound", () => {
  expect(decodeAlarm(stored(null)).sound).toEqual({ kind: "default" });
});

it("reads back the chosen sound from storage, native's list and the active ring", () => {
  const file = { kind: "file", uri: "content://media/7", title: "galo.mp3" };
  expect(decodeAlarm(stored(file)).sound).toEqual(file);
  expect(decodeAlarms(`[${stored(file)}]`)[0]!.sound).toEqual(file);
  const ring = `{"id":"r","alarm":${stored(file)},"startedAt":1,"phase":"ringing"}`;
  expect(decodeRing(ring)!.alarm.sound).toEqual(file);
});

const ringAlarm = (alarm: string) =>
  decodeRing(`{"id":"r","alarm":${alarm},"startedAt":1,"phase":"ringing"}`)!.alarm;
it("keeps the ring's deck and N through native, with defaults for older alarms", () => {
  expect(ringAlarm(JSON.stringify({ ...newAlarm("a"), deckId: "deck", need: 7 }))).toMatchObject({
    deckId: "deck",
    need: 7,
  });
  const { deckId: _deck, need: _need, ...legacy } = newAlarm("a");
  expect(ringAlarm(JSON.stringify(legacy))).toMatchObject({ deckId: null, need: 3 });
});

it("reads native's awake check, before and after its prompt shows", () => {
  const alarm = JSON.stringify({ ...newAlarm("a"), deckId: "deck", awakeCheck: true });
  const pending = `{"id":"c","ringId":"r","alarm":${alarm},"dueAt":5}`;
  expect(decodeAwakeCheck(pending)).toMatchObject({
    id: "c",
    ringId: "r",
    alarm: { deckId: "deck", awakeCheck: true },
    dueAt: 5,
    shownAt: null,
  });
  expect(
    decodeAwakeCheck(`{"id":"c","ringId":"r","alarm":${alarm},"dueAt":5,"shownAt":9}`),
  ).toMatchObject({ shownAt: 9 });
  expect(decodeAwakeCheck("null")).toBeNull();
});
