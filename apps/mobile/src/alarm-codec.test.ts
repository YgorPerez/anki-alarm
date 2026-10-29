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

it("reads the ring's snoozes and snooze settings through native, with defaults for older rings", () => {
  const alarm = JSON.stringify({ ...newAlarm("a"), snooze: false, snoozeMinutes: 5, snoozeCap: 3 });
  const snoozed = decodeRing(
    `{"id":"r","alarm":${alarm},"startedAt":1,"phase":"snoozed","snoozes":2,"snoozedUntil":900}`,
  )!;
  expect(snoozed).toMatchObject({ phase: "snoozed", snoozes: 2, snoozedUntil: 900 });
  expect(snoozed.alarm).toMatchObject({ snooze: false, snoozeMinutes: 5, snoozeCap: 3 });
  const older = `{"id":"r","alarm":${stored(null)},"startedAt":1,"phase":"ringing"}`;
  expect(decodeRing(older)).toMatchObject({ snoozes: 0, snoozedUntil: null });
  // Native only writes ringing, session and snoozed.
  expect(() => decodeRing(`{"id":"r","alarm":${alarm},"startedAt":1,"phase":"paused"}`)).toThrow(
    /phase/,
  );
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

it("keeps read aloud through native, off for older alarms", () => {
  expect(ringAlarm(JSON.stringify({ ...newAlarm("a"), readAloud: true })).readAloud).toBe(true);
  const { readAloud: _readAloud, ...legacy } = newAlarm("a");
  expect(ringAlarm(JSON.stringify(legacy)).readAloud).toBe(false);
});

it("keeps every alarm property through native", () => {
  // Effect Schema drops keys it doesn't list: a property missing from the codec fails here.
  const alarm = {
    ...newAlarm("a"),
    label: "Cedo",
    enabled: false,
    vibrate: false,
    rampSeconds: 10,
    rule: { hour: 6, minute: 30, repeatDays: [6] },
    sound: { kind: "default" as const },
    deckId: "deck",
    need: 7,
    snooze: false,
    snoozeMinutes: 15,
    snoozeCap: 4,
    awakeCheck: true,
    awakeCheckMinutes: 10,
    readAloud: true,
  };
  // Every property here differs from its default, so a dropped one would show; a new property
  // needs a value here too.
  const defaults = new Map(Object.entries(newAlarm("a")));
  const same = Object.entries(alarm).filter(
    ([key, value]) => key !== "id" && JSON.stringify(value) === JSON.stringify(defaults.get(key)),
  );
  expect(same).toEqual([]);
  expect(decodeAlarm(JSON.stringify(alarm))).toEqual(alarm);
  const ring = `{"id":"r","alarm":${JSON.stringify(alarm)},"startedAt":1,"phase":"ringing"}`;
  expect(decodeRing(ring)!.alarm).toEqual(alarm);
});
