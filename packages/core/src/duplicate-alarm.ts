import type { Alarm } from "./alarm.ts";

/** A regular alarm with the source's settings and a fresh identity. */
export function duplicateAlarm(alarm: Alarm, id: string): Alarm {
  return { ...alarm, id, quick: false };
}
