import { describe, expect, it } from "vite-plus/test";
import fixtures from "../fixtures/next-ring.json" with { type: "json" };
import {
  awakeCheckAfter,
  newAlarm,
  nextAlarmRing,
  parseAlarmSound,
  readAlarm,
  clearExpiredSkip,
  skipNextRing,
  skipOffer,
  undoSkip,
  upcomingRing,
} from "./index.ts";

describe("next ring", () => {
  it.each(fixtures)("$name", (fixture) => {
    const skip = "skip" in fixture ? Date.parse(fixture.skip) : null;
    const alarm = { ...newAlarm("fixture"), rule: fixture.rule, skip };
    expect(upcomingRing(alarm, Date.parse(fixture.now), fixture.zone)).toBe(
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
      skip: null,
      quick: false,
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

describe("next enabled alarm", () => {
  it("selects the earliest ring and elapsed time across alarms, ignoring disabled ones", () => {
    const now = Date.parse("2026-10-29T02:18:00Z");
    const alarms = [
      { ...newAlarm("later"), rule: { hour: 8, minute: 0, repeatDays: [4] } },
      { ...newAlarm("off"), enabled: false, rule: { hour: 3, minute: 0, repeatDays: [4] } },
      { ...newAlarm("next"), rule: { hour: 6, minute: 30, repeatDays: [4] } },
    ];
    expect(nextAlarmRing(alarms, now, "America/Sao_Paulo")).toEqual({
      alarmId: "next",
      at: Date.parse("2026-10-29T09:30:00Z"),
      remainingMs: 25920000,
    });
  });
});

it("has no next ring for empty, disabled or expired alarms; ties keep input order", () => {
  const now = Date.parse("2026-10-29T06:30:00Z");
  expect(nextAlarmRing([], now, "UTC")).toBeNull();
  expect(nextAlarmRing([{ ...newAlarm("off"), enabled: false }], now, "UTC")).toBeNull();
  expect(
    nextAlarmRing(
      [{ ...newAlarm("past"), rule: { hour: 6, minute: 30, onceDate: "2026-10-29" } }],
      now,
      "UTC",
    ),
  ).toBeNull();
  expect(nextAlarmRing([newAlarm("first"), newAlarm("second")], now, "UTC")).toEqual({
    alarmId: "first",
    at: Date.parse("2026-10-29T07:00:00Z"),
    remainingMs: 1800000,
  });
});
it("reports actual elapsed time across daylight saving changes", () => {
  expect(
    nextAlarmRing(
      [{ ...newAlarm("spring"), rule: { hour: 3, minute: 30, onceDate: "2026-03-08" } }],
      Date.parse("2026-03-08T06:30:00Z"),
      "America/New_York",
    ),
  ).toEqual({
    alarmId: "spring",
    at: Date.parse("2026-03-08T07:30:00Z"),
    remainingMs: 3600000,
  });
});

describe("skip the next ring", () => {
  // Thursday 2026-10-29, 02:18 UTC; the alarm rings every day at 06:30.
  const now = Date.parse("2026-10-29T02:18:00Z");
  const daily = {
    ...newAlarm("daily"),
    rule: { hour: 6, minute: 30, repeatDays: [1, 2, 3, 4, 5, 6, 7] },
  };

  it("skips one occurrence: the next ring is the one after it", () => {
    const skipped = skipNextRing(daily, now, "UTC");
    expect(skipped.skip).toBe(Date.parse("2026-10-29T06:30:00Z"));
    expect(nextAlarmRing([skipped], now, "UTC")).toMatchObject({
      at: Date.parse("2026-10-30T06:30:00Z"),
    });
    expect(nextAlarmRing([undoSkip(skipped)], now, "UTC")).toMatchObject({
      at: Date.parse("2026-10-29T06:30:00Z"),
    });
  });

  it("offers skip for enabled repeating alarms, and undo while the skip is ahead", () => {
    expect(skipOffer(daily, now, "UTC")).toBe("skip");
    const skipped = skipNextRing(daily, now, "UTC");
    expect(skipOffer(skipped, now, "UTC")).toBe("undo");
    expect(upcomingRing(skipped, now, "UTC")).toBe(Date.parse("2026-10-30T06:30:00Z"));
    expect(skipOffer({ ...daily, enabled: false }, now, "UTC")).toBeNull();
    expect(skipOffer({ ...skipped, enabled: false }, now, "UTC")).toBeNull();
    const once = { ...daily, rule: { hour: 6, minute: 30, onceDate: "2026-10-29" } };
    expect(skipOffer(once, now, "UTC")).toBeNull();
    expect(skipNextRing(once, now, "UTC")).toEqual(once);
  });

  it("clears itself once the skipped occurrence has passed", () => {
    const skipped = skipNextRing(daily, now, "UTC");
    const friday = Date.parse("2026-10-29T12:00:00Z");
    expect(skipOffer(skipped, friday, "UTC")).toBe("skip");
    expect(upcomingRing(skipped, friday, "UTC")).toBe(Date.parse("2026-10-30T06:30:00Z"));
  });

  it("no longer applies once the rule stops ringing at the skipped time", () => {
    const skipped = skipNextRing(daily, now, "UTC");
    const earlier = { ...skipped, rule: { ...skipped.rule, hour: 6, minute: 0 } };
    expect(skipOffer(earlier, now, "UTC")).toBe("skip");
    expect(upcomingRing(earlier, now, "UTC")).toBe(Date.parse("2026-10-29T06:00:00Z"));
  });

  it("is read back from stored alarms, and is absent from alarms saved before it", () => {
    const { skip: _skip, ...legacy } = daily;
    expect(readAlarm(legacy).skip).toBeNull();
    expect(readAlarm({ ...legacy, skip: "tomorrow" }).skip).toBeNull();
    expect(readAlarm({ ...legacy, skip: 1_800_000_000_000 }).skip).toBe(1_800_000_000_000);
  });
});

it("clears expired skips without changing future skips or the source alarm", () => {
  const alarm = { ...newAlarm("a"), skip: 1000 };
  expect(clearExpiredSkip(alarm, 999)).toBe(alarm);
  expect(clearExpiredSkip(alarm, 1000)).toEqual({ ...alarm, skip: null });
  expect(clearExpiredSkip(alarm, 1001).skip).toBeNull();
  expect(alarm.skip).toBe(1000);
  const fresh = newAlarm("fresh");
  expect(clearExpiredSkip(fresh, 1001)).toBe(fresh);
});
