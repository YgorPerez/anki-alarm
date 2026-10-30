import { expect, test } from "vite-plus/test";
import { duplicateAlarm, newAlarm } from "./index.ts";

test("duplicating preserves every setting under a new id", () => {
  const source = {
    ...newAlarm("source"),
    label: "Work",
    quick: true,
    enabled: false,
    need: 12,
    sound: { kind: "file" as const, uri: "file:///wake.mp3", title: "Wake" },
    rule: { hour: 8, minute: 42, repeatDays: [2, 4] },
    deckId: "deck",
    snooze: false,
    snoozeMinutes: 20,
    snoozeCap: 4,
    awakeCheck: true,
    awakeCheckMinutes: 10,
    readAloud: true,
    rampSeconds: 120,
    vibrate: false,
  };
  const copy = duplicateAlarm(source, "copy");
  expect(copy).toEqual({ ...source, id: "copy" });
  expect(source.id).toBe("source");
});

test("a duplicate drops expired skips and preserves future skips", () => {
  const source = { ...newAlarm("source"), skip: 1000 };
  expect(duplicateAlarm(source, "expired", 1000).skip).toBeNull();
  expect(duplicateAlarm(source, "future", 999).skip).toBe(1000);
});
