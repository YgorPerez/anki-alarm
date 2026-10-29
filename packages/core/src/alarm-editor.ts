import { newAlarm, nextRing, type Alarm, type AlarmRule } from "./alarm.ts";

/** How long until an alarm rings, as the editor's "Rings in 7 h 12 min" says it. */
export interface RingsIn {
  days: number;
  hours: number;
  minutes: number;
}

/**
 * The time left to the rule's next ring, or null when it never rings again. A part of a minute
 * counts as a whole one, so a ring seconds away reads "1 min".
 */
export function ringsIn(rule: AlarmRule, now: number, zone: string): RingsIn | null {
  const at = nextRing(rule, now, zone);
  if (at === null) return null;
  const total = Math.ceil((at - now) / 60000);
  return {
    days: Math.floor(total / 1440),
    hours: Math.floor((total % 1440) / 60),
    minutes: total % 60,
  };
}

/**
 * A new alarm as the editor opens it: with the deck and N of the most recently saved alarm (the
 * newest one with a deck when that isn't known), so saving doesn't wait on picking a deck. A deck
 * that's gone gives way to the first of `deckIds`, in the order the editor lists them.
 */
export function newAlarmFor(
  id: string,
  {
    alarms,
    lastSavedId,
    deckIds,
  }: { alarms: readonly Alarm[]; lastSavedId: string | null; deckIds: readonly string[] },
): Alarm {
  const fresh = newAlarm(id);
  const last =
    alarms.find((alarm) => alarm.id === lastSavedId) ??
    // Hermes may lack findLast; the copy is fresh.
    // oxlint-disable-next-line unicorn/no-array-reverse
    [...alarms].reverse().find((alarm) => alarm.deckId !== null);
  const deckId = last?.deckId && deckIds.includes(last.deckId) ? last.deckId : (deckIds[0] ?? null);
  return { ...fresh, deckId, need: last?.need ?? fresh.need };
}

/** Every ISO weekday, Monday first: the Repeat sheet's "Every day". */
export const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7] as const;
/** Monday to Friday: the Repeat sheet's "Weekdays". */
export const WEEKDAYS = [1, 2, 3, 4, 5] as const;

/** An alarm with no repeat days and no date rings once, at the time's next occurrence. */
export function onceRule(hour: number, minute: number, now: number, zone: string): AlarmRule {
  const at = nextRing({ hour, minute, repeatDays: EVERY_DAY }, now, zone)!;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return { hour, minute, onceDate: `${parts["year"]}-${parts["month"]}-${parts["day"]}` };
}
