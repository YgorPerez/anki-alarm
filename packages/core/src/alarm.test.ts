import { describe, expect, it } from "vite-plus/test";
import fixtures from "../fixtures/next-ring.json" with { type: "json" };
import { awakeCheckAfter, newAlarm, nextRing, parseAlarmSound, readAlarm } from "./index.ts";

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
      awakeCheck: false,
      awakeCheckMinutes: 5,
      readAloud: false,
    });
  });
});

describe("awake check", () => {
  it("starts its delay after dismissal only when it's on", () => {
    expect(awakeCheckAfter(newAlarm("a"))).toBeNull();
    expect(awakeCheckAfter({ ...newAlarm("a"), awakeCheck: true })).toBe(300);
    expect(awakeCheckAfter({ ...newAlarm("a"), awakeCheck: true, awakeCheckMinutes: 10 })).toBe(
      600,
    );
  });

  it("is off with a 5 minute delay for alarms saved before it, and keeps a valid delay", () => {
    const { awakeCheck: _on, awakeCheckMinutes: _minutes, ...legacy } = newAlarm("a");
    expect(readAlarm(legacy)).toMatchObject({ awakeCheck: false, awakeCheckMinutes: 5 });
    expect(readAlarm({ ...legacy, awakeCheck: true, awakeCheckMinutes: 15 })).toMatchObject({
      awakeCheck: true,
      awakeCheckMinutes: 15,
    });
    expect(readAlarm({ ...legacy, awakeCheck: "yes", awakeCheckMinutes: 0 })).toMatchObject({
      awakeCheck: false,
      awakeCheckMinutes: 1,
    });
    expect(readAlarm({ ...legacy, awakeCheckMinutes: 2.5 })).toMatchObject({
      awakeCheckMinutes: 5,
    });
  });
});
