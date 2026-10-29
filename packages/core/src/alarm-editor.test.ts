import { describe, expect, it } from "vite-plus/test";
import { newAlarm, newAlarmFor, nextAlarmRing, onceRule, ringsIn, timeLeft } from "./index.ts";

const zone = "America/Sao_Paulo";
// Wednesday 2026-10-28, 23:18 in São Paulo (UTC−3).
const now = Date.parse("2026-10-29T02:18:00Z");

describe("rings in", () => {
  it("is the time left to the next ring, in hours and minutes", () => {
    expect(ringsIn({ hour: 6, minute: 30, repeatDays: [1, 2, 3, 4, 5] }, now, zone)).toEqual({
      days: 0,
      hours: 7,
      minutes: 12,
    });
  });

  it("counts a part of a minute as a whole one, so a ring seconds away isn't 0 min", () => {
    const at = Date.parse("2026-10-29T02:18:40Z");
    expect(ringsIn({ hour: 23, minute: 19, repeatDays: [3] }, at, zone)).toEqual({
      days: 0,
      hours: 0,
      minutes: 1,
    });
  });

  it("counts whole days for a ring more than a day away", () => {
    // Saturday 2026-10-31, 08:00.
    expect(ringsIn({ hour: 8, minute: 0, repeatDays: [6] }, now, zone)).toEqual({
      days: 2,
      hours: 8,
      minutes: 42,
    });
  });

  it("splits the next alarm's remaining time the same way, so Home and the editor agree", () => {
    const alarm = { ...newAlarm("a"), rule: { hour: 8, minute: 0, repeatDays: [6] } };
    const next = nextAlarmRing([alarm], now, zone)!;
    expect(timeLeft(next.remainingMs)).toEqual(ringsIn(alarm.rule, now, zone));
    expect(timeLeft(40_000)).toEqual({ days: 0, hours: 0, minutes: 1 });
    expect(timeLeft(24 * 3_600_000)).toEqual({ days: 1, hours: 0, minutes: 0 });
  });

  it("is null for a rule that never rings again", () => {
    expect(ringsIn({ hour: 8, minute: 0, onceDate: "2026-10-01" }, now, zone)).toBeNull();
  });
});

const saved = (id: string, deckId: string | null, need: number) => ({
  ...newAlarm(id),
  deckId,
  need,
});

describe("a new alarm in the editor", () => {
  const alarms = [saved("a", "inglês", 5), saved("b", "alemão", 8), saved("c", null, 3)];
  const decks = ["alemão", "inglês"];

  it("starts with the deck and N of the most recently saved alarm", () => {
    const alarm = newAlarmFor("new", { alarms, lastSavedId: "a", deckIds: decks });
    expect(alarm).toEqual({ ...newAlarm("new"), deckId: "inglês", need: 5 });
  });

  it("takes the newest alarm with a deck when it doesn't know which was saved last", () => {
    expect(newAlarmFor("new", { alarms, lastSavedId: null, deckIds: decks })).toMatchObject({
      deckId: "alemão",
      need: 8,
    });
    expect(newAlarmFor("new", { alarms, lastSavedId: "deleted", deckIds: decks })).toMatchObject({
      deckId: "alemão",
      need: 8,
    });
  });

  it("keeps the N but takes the first deck when that alarm's deck is gone", () => {
    expect(
      newAlarmFor("new", { alarms, lastSavedId: "b", deckIds: ["inglês", "russo"] }),
    ).toMatchObject({ deckId: "inglês", need: 8 });
  });

  it("starts with the only deck when no alarm is saved", () => {
    expect(newAlarmFor("new", { alarms: [], lastSavedId: null, deckIds: ["inglês"] })).toEqual({
      ...newAlarm("new"),
      deckId: "inglês",
    });
  });

  it("has no deck while there are none", () => {
    expect(newAlarmFor("new", { alarms, lastSavedId: "a", deckIds: [] })).toMatchObject({
      deckId: null,
      need: 5,
    });
  });
});

describe("an alarm with no repeat days", () => {
  it("rings once, today while the time is still ahead", () => {
    expect(onceRule(23, 30, now, zone)).toEqual({ hour: 23, minute: 30, onceDate: "2026-10-28" });
  });

  it("rings once tomorrow when today's time has passed", () => {
    expect(onceRule(6, 30, now, zone)).toEqual({ hour: 6, minute: 30, onceDate: "2026-10-29" });
    expect(onceRule(23, 18, now, zone)).toEqual({ hour: 23, minute: 18, onceDate: "2026-10-29" });
  });
});
