import { describe, expect, it } from "vite-plus/test";
import {
  alarmFromRecord,
  mergeRecord,
  newAlarm,
  newAlarmFor,
  nextRing,
  quickAlarm,
  quickAlarmOptions,
  QUICK_ALARM_MINUTES,
  quickAlarmsDone,
  readAlarm,
  stampAlarm,
  type Alarm,
  type AlarmEvent,
} from "./index.ts";

const zone = "America/Sao_Paulo";
// Thursday 2026-10-29, 06:00:40 in São Paulo (UTC−3).
const now = Date.parse("2026-10-29T09:00:40Z");

const saved = (id: string, changes: Partial<Alarm> = {}): Alarm => ({
  ...newAlarm(id),
  deckId: "inglês",
  ...changes,
});
const options = { deckId: "inglês", need: 5, sound: { kind: "bundled", id: "chimes" } } as const;

describe("a quick alarm", () => {
  it("is offered as +10, +20 and +30 min", () => {
    expect(QUICK_ALARM_MINUTES).toEqual([10, 20, 30]);
  });

  it("rings once, at the minute that many minutes from now", () => {
    const alarm = quickAlarm("q", 10, options, now, zone);
    expect(alarm.rule).toEqual({ hour: 6, minute: 10, onceDate: "2026-10-29" });
    expect(nextRing(alarm.rule, now, zone)).toBe(Date.parse("2026-10-29T09:10:00Z"));
  });

  it("rings tomorrow when the minutes cross midnight", () => {
    const late = Date.parse("2026-10-30T02:45:00Z"); // 23:45
    expect(quickAlarm("q", 30, options, late, zone).rule).toEqual({
      hour: 0,
      minute: 15,
      onceDate: "2026-10-30",
    });
  });

  it("copies the deck, N and sound, is on, and is marked to delete itself after its ring", () => {
    expect(quickAlarm("q", 20, options, now, zone)).toEqual({
      ...newAlarm("q"),
      rule: { hour: 6, minute: 20, onceDate: "2026-10-29" },
      deckId: "inglês",
      need: 5,
      sound: { kind: "bundled", id: "chimes" },
      enabled: true,
      quick: true,
    });
  });

  it("is not quick by default, nor when stored before quick alarms existed", () => {
    expect(newAlarm("a").quick).toBe(false);
    const { quick: _, ...older } = newAlarm("a");
    expect(readAlarm(older).quick).toBe(false);
  });
});

describe("what a quick alarm copies", () => {
  const decks = ["alemão", "inglês"];

  it("comes from the most recently saved alarm", () => {
    const alarms = [
      saved("a", { deckId: "alemão", need: 8 }),
      saved("b", { need: 4, sound: { kind: "default" } }),
    ];
    expect(quickAlarmOptions({ alarms, lastSavedId: "a", deckIds: decks })).toEqual({
      deckId: "alemão",
      need: 8,
      sound: newAlarm("a").sound,
    });
  });

  it("takes the newest alarm when it doesn't know which was saved last", () => {
    const alarms = [saved("a", { need: 8 }), saved("b", { need: 4 })];
    expect(quickAlarmOptions({ alarms, lastSavedId: null, deckIds: decks })?.need).toBe(4);
    expect(quickAlarmOptions({ alarms, lastSavedId: "deleted", deckIds: decks })?.need).toBe(4);
  });

  it("uses the newest regular alarm with a deck for both editor and quick defaults", () => {
    const alarms = [saved("a", { need: 8 }), saved("b", { deckId: null, need: 4 })];
    const input = { alarms, lastSavedId: null, deckIds: decks };
    expect(quickAlarmOptions(input)).toMatchObject({ deckId: "inglês", need: 8 });
    expect(newAlarmFor("new", input)).toMatchObject({ deckId: "inglês", need: 8 });
  });

  it("never comes from another quick alarm", () => {
    const alarms = [saved("a", { need: 8 }), saved("q", { need: 4, quick: true })];
    expect(quickAlarmOptions({ alarms, lastSavedId: "q", deckIds: decks })?.need).toBe(8);
    expect(
      quickAlarmOptions({ alarms: [alarms[1]!], lastSavedId: null, deckIds: decks }),
    ).toBeNull();
  });

  it("takes the first deck when that alarm has none or its deck is gone", () => {
    const alarms = [saved("a", { deckId: "russo", need: 8 })];
    expect(quickAlarmOptions({ alarms, lastSavedId: "a", deckIds: decks })).toMatchObject({
      deckId: "alemão",
      need: 8,
    });
    expect(
      quickAlarmOptions({
        alarms: [saved("b", { deckId: null })],
        lastSavedId: "b",
        deckIds: decks,
      })?.deckId,
    ).toBe("alemão");
  });

  it("is nothing without a saved alarm or without a deck, so Home hides the chips", () => {
    expect(quickAlarmOptions({ alarms: [], lastSavedId: null, deckIds: decks })).toBeNull();
    expect(quickAlarmOptions({ alarms: [saved("a")], lastSavedId: "a", deckIds: [] })).toBeNull();
  });
});

const event = (kind: string, alarmId: string, ringId: string | null): AlarmEvent => ({
  id: `${kind}-${alarmId}-${ringId}`,
  kind,
  alarmId,
  ringId,
  wallTime: 0,
  elapsedRealtime: 0,
});

describe("a quick alarm after its ring", () => {
  const quick = saved("q", { quick: true });
  const regular = saved("a");

  it("is done once its ring is dismissed", () => {
    expect(
      quickAlarmsDone(
        [regular, quick],
        [event("ringStarted", "q", "r1"), event("dismissed", "q", "r1")],
      ),
    ).toEqual(["q"]);
  });

  it("is done when it was folded into a ring that was dismissed", () => {
    const events = [
      event("ringStarted", "a", "r1"),
      event("absorbed", "q", "r1"),
      event("dismissed", "a", "r1"),
    ];
    expect(quickAlarmsDone([regular, quick], events)).toEqual(["q"]);
  });

  it("stays while its ring is still going or snoozed, and a regular alarm always stays", () => {
    expect(
      quickAlarmsDone(
        [regular, quick],
        [
          event("ringStarted", "q", "r1"),
          event("snoozed", "q", "r1"),
          event("dismissed", "a", "r0"),
        ],
      ),
    ).toEqual([]);
  });
});

describe("a quick alarm across devices", () => {
  const env = { deviceId: "phone", now: () => 1000, random: () => new Uint8Array(16) };

  it("keeps its quick flag through sync", () => {
    const alarm = quickAlarm("q", 10, options, now, zone);
    const record = stampAlarm(undefined, alarm, env);
    expect(alarmFromRecord(record)).toEqual(alarm);
    const relabeled = stampAlarm(
      record,
      { ...alarm, label: "Cochilo" },
      { ...env, deviceId: "tablet", now: () => 2000 },
    );
    expect(alarmFromRecord(mergeRecord(record, relabeled))).toMatchObject({
      label: "Cochilo",
      quick: true,
    });
  });
});
