import type { Locale } from "@app/core";

const DAY = 86400;
const YEAR = 365 * DAY;
const units = [
  { seconds: YEAR, pt: "a", en: "y", decimals: 1 },
  { seconds: YEAR / 12, pt: "mês(es)", en: "mo", decimals: 1 },
  { seconds: DAY, pt: "dia(s)", en: "d", decimals: 0 },
  { seconds: 3600, pt: "h", en: "h", decimals: 1 },
  { seconds: 60, pt: "min(s)", en: "m", decimals: 0 },
  { seconds: 1, pt: "s", en: "s", decimals: 0 },
];

/** Anki's short answer-button time, with its default 20-minute learn-ahead prefix. */
export function intervalText(seconds: number, locale: Locale): string {
  const unit = units.find((u) => seconds >= u.seconds) ?? units[units.length - 1]!;
  const amount = (seconds / unit.seconds).toLocaleString(locale, {
    maximumFractionDigits: unit.decimals,
    useGrouping: false,
  });
  return `${seconds < 20 * 60 ? "<" : ""}${amount}${locale === "pt-BR" ? unit.pt : unit.en}`;
}
