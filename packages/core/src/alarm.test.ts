import { describe, expect, it } from "vite-plus/test";
import fixtures from "../fixtures/next-ring.json" with { type: "json" };
import { newAlarm, nextRing, parseAlarmSound } from "./index.ts";

describe("next ring", () => {
  it.each(fixtures)("$name", (fixture) => {
    expect(nextRing(fixture.rule, Date.parse(fixture.now), fixture.zone)).toBe(
      fixture.expected === null ? null : Date.parse(fixture.expected),
    );
  });
});

describe("alarm sound", () => {
  it("reads a chosen sound back from stored or synced data", () => {
    expect(parseAlarmSound({ kind: "bundled", id: "chimes" })).toEqual({
      kind: "bundled",
      id: "chimes",
    });
    expect(parseAlarmSound({ kind: "file", uri: "content://media/1", title: "galo.mp3" })).toEqual({
      kind: "file",
      uri: "content://media/1",
      title: "galo.mp3",
    });
  });

  it("falls back to the phone's alarm sound for a missing or broken sound", () => {
    for (const broken of [
      null,
      "content://media/1",
      { kind: "bundled", id: "a sound from a newer version" },
      { kind: "ringtone", title: "no uri" },
      { kind: "sirene" },
    ]) {
      expect(parseAlarmSound(broken)).toEqual({ kind: "default" });
    }
  });
});

describe("a new alarm", () => {
  it("rings weekdays at 7:00 with a bundled sound, vibration, a 30 s ramp, three cards and snooze", () => {
    expect(newAlarm("alarm-1")).toEqual({
      id: "alarm-1",
      label: "",
      enabled: true,
      rule: { hour: 7, minute: 0, repeatDays: [1, 2, 3, 4, 5] },
      vibrate: true,
      rampSeconds: 30,
      sound: { kind: "bundled", id: "dawn" },
      deckId: null,
      need: 3,
      snooze: true,
      snoozeMinutes: 9,
      snoozeCap: 2,
    });
  });
});
