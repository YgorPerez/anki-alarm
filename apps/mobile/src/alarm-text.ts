import { EVERY_DAY, WEEKDAYS, type AlarmRule, type Locale, type RingsIn } from "@app/core";
import { copy } from "./copy.ts";

/** An alarm's time as the phone shows it: "06:30" on a 24 h phone, "6:30 AM" on a 12 h one. */
export const clockText = (hour: number, minute: number, use24Hour: boolean, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    hour: use24Hour ? "2-digit" : "numeric",
    minute: "2-digit",
    hour12: !use24Hour,
    timeZone: "UTC",
  })
    .format(Date.UTC(2000, 0, 1, hour, minute))
    .replace(/\s+/g, " ");

const weekdayNames = {
  "pt-BR": ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
} as const;
/** A weekday's short name ("Mon", "Seg"), ISO numbering. */
export const weekdayName = (day: number, locale: Locale) => weekdayNames[locale][day - 1]!;

/** The civil date `at` falls on in `zone`, as YYYY-MM-DD. */
const civilDate = (at: number, zone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);

const same = (days: readonly number[], set: readonly number[]) =>
  days.length === set.length && set.every((day) => days.includes(day));

/**
 * How an alarm repeats, in a few words: "Weekdays", "Mon, Wed", "Tomorrow", a date, or "Once"
 * for no days and no date yet. Home's cards and the editor's Repeat row both show it.
 */
export function repeatSummary(
  rule: Pick<AlarmRule, "repeatDays" | "onceDate">,
  { locale, now, zone }: { locale: Locale; now: number; zone: string },
) {
  const t = copy(locale);
  if (rule.onceDate) {
    const today = civilDate(now, zone);
    if (rule.onceDate === today) return t("today");
    // Advance the civil day, including days containing a DST transition.
    const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    if (rule.onceDate === tomorrow) return t("tomorrow");
    return new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium" }).format(
      Date.parse(`${rule.onceDate}T12:00:00Z`),
    );
  }
  const days = rule.repeatDays ?? [];
  if (days.length === 0) return t("repeatOnce");
  if (same(days, EVERY_DAY)) return t("everyDay");
  if (same(days, WEEKDAYS)) return t("weekdays");
  if (same(days, [6, 7])) return t("weekends");
  return EVERY_DAY.filter((day) => days.includes(day))
    .map((day) => weekdayName(day, locale))
    .join(", ");
}

/** A wait such as "7 h 12 min" or "1 d 8 h", from Core's `timeLeft`/`ringsIn`. */
export function durationText({ days, hours, minutes }: RingsIn, locale: Locale) {
  const t = copy(locale);
  return [
    days ? t("durationDays", { count: String(days) }) : "",
    hours ? t("durationHours", { count: String(hours) }) : "",
    minutes ? t("minutes", { count: String(minutes) }) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** "Rings in 7 h 12 min": the notice after saving an alarm. */
export const ringsInText = (left: RingsIn, locale: Locale) =>
  copy(locale)("ringsIn", { time: durationText(left, locale) });

/** Today's date in `zone` as a local midnight, which Android's date picker works in. */
export function startOfToday(now: number, zone: string) {
  const [year, month, day] = civilDate(now, zone).split("-").map(Number);
  return new Date(year!, month! - 1, day);
}
