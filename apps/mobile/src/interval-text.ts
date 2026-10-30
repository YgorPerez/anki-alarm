import type { Locale } from "@app/core";
import { copy } from "./copy.ts";

const DAY = 86400;
const YEAR = 365 * DAY;
const units = [
  { seconds: YEAR, label: "intervalYears", decimals: 1 },
  { seconds: YEAR / 12, label: "intervalMonths", decimals: 1 },
  { seconds: DAY, label: "intervalDays", decimals: 0 },
  { seconds: 3600, label: "intervalHours", decimals: 1 },
  { seconds: 60, label: "intervalMinutes", decimals: 0 },
  { seconds: 1, label: "intervalSeconds", decimals: 0 },
] as const;

/** Anki's short answer-button time, with its default 20-minute learn-ahead prefix. */
export function intervalText(seconds: number, locale: Locale): string {
  const unit = units.find((u) => seconds >= u.seconds) ?? units[units.length - 1]!;
  const amount = (seconds / unit.seconds).toLocaleString(locale, {
    maximumFractionDigits: unit.decimals,
    useGrouping: false,
  });
  return `${seconds < 20 * 60 ? "<" : ""}${amount}${copy(locale)(unit.label)}`;
}
