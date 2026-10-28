import { describe, expect, test } from "vite-plus/test";
import { MAX_SNOOZE_CAP, newAlarm, readAlarm, ringNeed, snoozeOffer } from "./index.ts";

const morning = { ...newAlarm("a"), need: 3 };

describe("snooze", () => {
  test("a new alarm allows two snoozes of 9 minutes", () => {
    expect(newAlarm("a")).toMatchObject({ snooze: true, snoozeMinutes: 9, snoozeCap: 2 });
  });

  test("each snooze adds two cards to the ring's N", () => {
    expect(ringNeed(morning, [], 0)).toBe(3);
    expect(ringNeed(morning, [], 1)).toBe(5);
    expect(ringNeed(morning, [], 2)).toBe(7);
  });

  test("the cost adds to the larger N of the alarms folded into the ring", () => {
    expect(ringNeed(morning, [{ ...newAlarm("b"), need: 6 }], 1)).toBe(8);
  });

  test("a ring is offered its alarm's snooze length and cost until the cap", () => {
    const alarm = { ...morning, snoozeMinutes: 10, snoozeCap: 2 };
    expect(snoozeOffer(alarm, 0)).toEqual({ minutes: 10, cost: 2, left: 2 });
    expect(snoozeOffer(alarm, 1)).toEqual({ minutes: 10, cost: 2, left: 1 });
    expect(snoozeOffer(alarm, 2)).toBeNull();
    expect(snoozeOffer(alarm, 3)).toBeNull();
  });

  test("an alarm with snooze off offers none", () => {
    expect(snoozeOffer({ ...morning, snooze: false }, 0)).toBeNull();
  });

  test("alarms saved before snooze get the defaults, and broken settings are kept in range", () => {
    const { snooze: _s, snoozeMinutes: _m, snoozeCap: _c, ...legacy } = newAlarm("a");
    expect(readAlarm(legacy)).toMatchObject({ snooze: true, snoozeMinutes: 9, snoozeCap: 2 });
    expect(readAlarm({ ...legacy, snooze: false, snoozeMinutes: 15, snoozeCap: 4 })).toMatchObject({
      snooze: false,
      snoozeMinutes: 15,
      snoozeCap: 4,
    });
    expect(readAlarm({ ...legacy, snooze: "yes", snoozeMinutes: 0, snoozeCap: 99 })).toMatchObject({
      snooze: true,
      snoozeMinutes: 1,
      snoozeCap: MAX_SNOOZE_CAP,
    });
    expect(readAlarm({ ...legacy, snoozeMinutes: 2.5, snoozeCap: 0 })).toMatchObject({
      snoozeMinutes: 9,
      snoozeCap: 1,
    });
  });
});
