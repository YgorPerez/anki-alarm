import { expect, test } from "vite-plus/test";
import { ALARM_EVENTS, wakeUpStats, type AlarmEvent, type LogEntry } from "./index.ts";

const now = new Date(2026, 9, 28, 12).getTime();
const day = 86_400_000;
const minute = 60_000;
let id = 0;
/** A journal event `at` wall time, with the monotonic clock `boot` ms behind it. */
const event = (
  kind: string,
  alarmId: string,
  ringId: string | null,
  at: number,
  boot = now - 10 * day,
): AlarmEvent => ({
  id: `e${String(id++).padStart(4, "0")}`,
  kind,
  alarmId,
  ringId,
  wallTime: at,
  elapsedRealtime: at - boot,
});
const answer = (
  ringId: string,
  at: number,
  grade: 1 | 2 | 3 | 4,
  origin: "alarm" | "phone" = "alarm",
): LogEntry => ({
  kind: "review",
  id: `r${String(id++).padStart(4, "0")}`,
  cardId: "card",
  at,
  grade,
  durationMs: 1000,
  origin,
  ringId,
});

test("time to dismissal runs from the ring's start to its dismissal on the monotonic clock", () => {
  const start = now - day;
  const events = [
    event(ALARM_EVENTS.ringStarted, "a", "r1", start),
    // The wall clock jumped forward an hour mid-ring; the monotonic clock didn't.
    {
      ...event(ALARM_EVENTS.dismissed, "a", "r1", start + 4 * minute),
      wallTime: start + 64 * minute,
    },
    event(ALARM_EVENTS.ringStarted, "a", "r2", start - day),
    event(ALARM_EVENTS.dismissed, "a", "r2", start - day + 2 * minute),
    event(ALARM_EVENTS.ringStarted, "b", "r3", start),
    event(ALARM_EVENTS.dismissed, "b", "r3", start + 10 * minute),
  ];
  const stats = wakeUpStats(events, [], { now });
  expect(stats.alarms.map((a) => [a.alarmId, a.rings, a.dismissed, a.medianDismissMs])).toEqual([
    ["a", 2, 2, 3 * minute],
    ["b", 1, 1, 10 * minute],
  ]);
  expect(stats.overall).toMatchObject({ rings: 3, dismissed: 3, medianDismissMs: 4 * minute });
});

test("snoozes count per ring, and cards needed are the ring's answers up to its dismissal", () => {
  const start = now - day;
  const voided = answer("r1", start + 2 * minute, 3);
  const events = [
    event(ALARM_EVENTS.ringStarted, "a", "r1", start),
    event(ALARM_EVENTS.snoozed, "a", "r1", start + minute),
    event(ALARM_EVENTS.snoozeEnded, "a", "r1", start + 10 * minute),
    event(ALARM_EVENTS.snoozed, "a", "r1", start + 11 * minute),
    event(ALARM_EVENTS.snoozeEnded, "a", "r1", start + 20 * minute),
    event(ALARM_EVENTS.dismissed, "a", "r1", start + 25 * minute),
    event(ALARM_EVENTS.ringStarted, "a", "r2", start - day),
    event(ALARM_EVENTS.dismissed, "a", "r2", start - day + minute),
    // Rang and never dismissed: its snooze counts, its answers don't.
    event(ALARM_EVENTS.ringStarted, "a", "r3", start - 2 * day),
    event(ALARM_EVENTS.snoozed, "a", "r3", start - 2 * day + minute),
  ];
  const log: LogEntry[] = [
    answer("r1", start + 21 * minute, 1),
    voided,
    { kind: "void", id: "v", cardId: "card", at: start + 3 * minute, targetId: voided.id },
    answer("r1", start + 22 * minute, 3),
    answer("r1", start + 23 * minute, 2),
    answer("r1", start + 24 * minute, 4),
    // The awake check's card, after the dismissal.
    answer("r1", start + 30 * minute, 3),
    answer("r2", start - day + 30_000, 3),
    answer("r3", start - 2 * day + 30_000, 1),
    answer("r2", start - day + 40_000, 3, "phone"),
  ];
  expect(wakeUpStats(events, log, { now }).overall).toMatchObject({
    rings: 3,
    dismissed: 2,
    snoozes: 3,
    snoozesPerRing: 1,
    cardsPerDismissal: 2.5,
  });
});

test("awake checks count as passed or failed on the ring they followed, after its dismissal", () => {
  const start = now - day;
  const events = [
    event(ALARM_EVENTS.ringStarted, "a", "r1", start),
    event(ALARM_EVENTS.dismissed, "a", "r1", start + 2 * minute),
    event(ALARM_EVENTS.awakeCheckShown, "a", "r1", start + 7 * minute),
    event(ALARM_EVENTS.awakeCheckFailed, "a", "r1", start + 8 * minute),
    // The failed check starts a fresh ring.
    event(ALARM_EVENTS.ringStarted, "a", "r2", start + 8 * minute),
    event(ALARM_EVENTS.dismissed, "a", "r2", start + 9 * minute),
    event(ALARM_EVENTS.awakeCheckShown, "a", "r2", start + 14 * minute),
    event(ALARM_EVENTS.awakeCheckPassed, "a", "r2", start + 14 * minute + 20_000),
  ];
  expect(wakeUpStats(events, [], { now }).overall).toMatchObject({
    rings: 2,
    dismissed: 2,
    medianDismissMs: 1.5 * minute,
    awakeChecksPassed: 1,
    awakeChecksFailed: 1,
  });
});

test("stats cover the rings started in the period, and count missed alarms per alarm", () => {
  const events = [
    event(ALARM_EVENTS.ringStarted, "a", "old", now - 40 * day),
    event(ALARM_EVENTS.dismissed, "a", "old", now - 40 * day + minute),
    event(ALARM_EVENTS.ringStarted, "a", "r1", now - 20 * day),
    event(ALARM_EVENTS.dismissed, "a", "r1", now - 20 * day + minute),
    event(ALARM_EVENTS.missed, "b", null, now - 2 * day),
    event(ALARM_EVENTS.missed, "b", null, now - 50 * day),
    // An alarm folded into a ring is not a ring of its own.
    event(ALARM_EVENTS.absorbed, "c", "r1", now - 20 * day + 30_000),
  ];
  const month = wakeUpStats(events, [], { now });
  expect(month.alarms.map((a) => [a.alarmId, a.rings, a.missed])).toEqual([
    ["a", 1, 0],
    ["b", 0, 1],
  ]);
  expect(month.overall).toMatchObject({ rings: 1, missed: 1, snoozesPerRing: 0 });
  expect(wakeUpStats(events, [], { now, days: 365 }).overall).toMatchObject({
    rings: 2,
    missed: 2,
  });
  expect(wakeUpStats([], [], { now }).overall).toEqual({
    rings: 0,
    dismissed: 0,
    medianDismissMs: null,
    snoozes: 0,
    snoozesPerRing: null,
    cardsPerDismissal: null,
    awakeChecksPassed: 0,
    awakeChecksFailed: 0,
    missed: 0,
  });
});

test("a reboot mid-ring restarts the monotonic clock, so that gap is timed on the wall clock", () => {
  const start = now - day;
  const rebooted = start + 3 * minute;
  const events = [
    event(ALARM_EVENTS.ringStarted, "a", "r1", start),
    event(ALARM_EVENTS.ringStarted, "a", "r2", start + 2 * minute),
    // Booted at `rebooted`: elapsedRealtime is near zero again.
    event(ALARM_EVENTS.serviceRestarted, "a", "r1", start + 5 * minute, rebooted),
    event(ALARM_EVENTS.dismissed, "a", "r1", start + 7 * minute, rebooted),
  ];
  expect(wakeUpStats(events, [], { now }).alarms[0]).toMatchObject({
    rings: 2,
    dismissed: 1,
    medianDismissMs: 7 * minute,
  });
});
