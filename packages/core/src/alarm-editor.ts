import { savedAlarmDefaults, type AlarmDefaultsInput } from "./alarm-defaults.ts";
import { newAlarm, nextRing, type Alarm, type AlarmRule } from "./alarm.ts";

/** How long until an alarm rings, as the editor's "Rings in 7 h 12 min" says it. */
export interface RingsIn {
  days: number;
  hours: number;
  minutes: number;
}

/**
 * A remaining time in days, hours and minutes. A part of a minute counts as a whole one, so a ring
 * seconds away reads "1 min". Home's "in …" and the editor's "Rings in …" both say it this way.
 */
export function timeLeft(ms: number): RingsIn {
  const total = Math.ceil(ms / 60000);
  return {
    days: Math.floor(total / 1440),
    hours: Math.floor((total % 1440) / 60),
    minutes: total % 60,
  };
}

/** The time left to the rule's next ring, or null when it never rings again. */
export function ringsIn(rule: AlarmRule, now: number, zone: string): RingsIn | null {
  const at = nextRing(rule, now, zone);
  return at === null ? null : timeLeft(at - now);
}

/** Stable property and repeat-day order for an alarm's plain data, including nested values. */
function canonical(key: string, value: unknown): unknown {
  // Hermes has no toSorted; both arrays are fresh copies.
  if (key === "repeatDays" && Array.isArray(value))
    // oxlint-disable-next-line unicorn/no-array-sort
    return [...value].sort((a, b) => Number(a) - Number(b));
  if (value && typeof value === "object" && !Array.isArray(value))
    // oxlint-disable-next-line unicorn/no-array-sort
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  return value;
}

/**
 * Whether two alarms hold the same values, however their keys and repeat days are ordered: the
 * editor's "anything to discard?", since its sheets may return the same values in a new object.
 */
export const sameAlarmValues = (a: Alarm, b: Alarm) =>
  JSON.stringify(a, canonical) === JSON.stringify(b, canonical);

/**
 * A new alarm as the editor opens it: with the deck and N of the most recently saved alarm (the
 * newest one with a deck when that isn't known), so saving doesn't wait on picking a deck. A deck
 * that's gone gives way to the first of `deckIds`, in the order the editor lists them.
 */
export function newAlarmFor(id: string, input: AlarmDefaultsInput): Alarm {
  const fresh = newAlarm(id);
  const defaults = savedAlarmDefaults(input);
  return {
    ...fresh,
    deckId: defaults?.deckId ?? input.deckIds[0] ?? null,
    need: defaults?.need ?? fresh.need,
  };
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

/**
 * The rule the editor saves. No days and no date rings once, at the time's next occurrence. Null
 * when it would never ring (a date that has passed).
 */
export function savedRule(rule: AlarmRule, now: number, zone: string): AlarmRule | null {
  const { hour, minute, onceDate, repeatDays = [] } = rule;
  const next = onceDate
    ? { hour, minute, onceDate }
    : repeatDays.length
      ? { hour, minute, repeatDays }
      : onceRule(hour, minute, now, zone);
  return ringsIn(next, now, zone) ? next : null;
}
