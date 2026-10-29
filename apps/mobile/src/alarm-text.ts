import { EVERY_DAY, WEEKDAYS, type AlarmRule, type Locale, type RingsIn } from "@app/core";
import { copy } from "./copy.ts";

/** An alarm's time as the phone shows it: "06:30" on a 24 h phone, "6:30 AM" on a 12 h one. */
export const clockText = (hour: number, minute: number, hour24: boolean, locale: Locale) =>
  new Date(Date.UTC(2000, 0, 1, hour, minute)).toLocaleTimeString(locale, {
    hour: hour24 ? "2-digit" : "numeric",
    minute: "2-digit",
    hour12: !hour24,
    timeZone: "UTC",
  });

/** A weekday's short name ("Mon", "seg."), ISO numbering. 2026-10-19 is a Monday. */
export const weekdayName = (day: number, locale: Locale) =>
  new Date(Date.UTC(2026, 9, 18 + day)).toLocaleDateString(locale, {
    weekday: "short",
    timeZone: "UTC",
  });

/** A one-off date ("Thu, Nov 5", "qui., 5 de nov."). */
export const dateText = (date: string, locale: Locale) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

const same = (days: readonly number[], set: readonly number[]) =>
  days.length === set.length && set.every((day) => days.includes(day));

/** How an alarm repeats, in a few words: "Weekdays", "Mon, Wed", a date, or "Once". */
export function repeatSummary(rule: Pick<AlarmRule, "repeatDays" | "onceDate">, locale: Locale) {
  const t = copy(locale);
  if (rule.onceDate) return dateText(rule.onceDate, locale);
  const days = rule.repeatDays ?? [];
  if (same(days, EVERY_DAY)) return t("everyDay");
  if (same(days, WEEKDAYS)) return t("weekdays");
  if (days.length === 0) return t("repeatOnce");
  return EVERY_DAY.filter((day) => days.includes(day))
    .map((day) => weekdayName(day, locale))
    .join(", ");
}

/** "Rings in 7 h 12 min": the notice after saving an alarm. */
export function ringsInText({ days, hours, minutes }: RingsIn, locale: Locale) {
  const t = copy(locale);
  const parts = [
    days ? t("durationDays", { count: String(days) }) : "",
    hours ? t("durationHours", { count: String(hours) }) : "",
    minutes ? t("minutes", { count: String(minutes) }) : "",
  ].filter(Boolean);
  return t("ringsIn", { time: parts.join(" ") });
}

/** Today's date in `zone` as a local midnight, which Android's date picker works in. */
export function startOfToday(now: number, zone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((part) => [part.type, Number(part.value)]),
  );
  return new Date(parts["year"]!, parts["month"]! - 1, parts["day"]!);
}
