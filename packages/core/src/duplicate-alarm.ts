import { clearExpiredSkip, type Alarm } from "./alarm.ts";

/** An alarm with the source's settings and a fresh identity. */
export function duplicateAlarm(alarm: Alarm, id: string, now: number): Alarm {
  return { ...clearExpiredSkip(alarm, now), id };
}
