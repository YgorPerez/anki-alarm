import type { Alarm, Locale, WakeUpStats, WakeUpTally } from "@app/core";
import type { StatsCopy } from "./copy.ts";

/** One block of wake-up stats: all alarms together, or one alarm. */
export interface WakeUpScope {
  /** The alarm's id, or "all" for every alarm together. */
  key: string;
  name: string;
  /** How many times it rang in the period. */
  rang: string;
  rows: { label: string; value: string }[];
}

const MINUTE = 60_000;
const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
const DECIMAL: Record<Locale, Intl.NumberFormat> = {
  "pt-BR": new Intl.NumberFormat("pt-BR", oneDecimal),
  en: new Intl.NumberFormat("en", oneDecimal),
};

const clock = (alarm: Alarm) =>
  `${String(alarm.rule.hour).padStart(2, "0")}:${String(alarm.rule.minute).padStart(2, "0")}`;

function duration(ms: number, t: StatsCopy) {
  if (ms < MINUTE) return t("seconds", { n: String(Math.round(ms / 1000)) });
  const minutes = Math.round(ms / MINUTE);
  return minutes < 60
    ? t("minutes", { n: String(minutes) })
    : t("hoursMinutes", { h: String(Math.floor(minutes / 60)), m: String(minutes % 60) });
}

function scope(
  key: string,
  name: string,
  tally: WakeUpTally,
  t: StatsCopy,
  locale: Locale,
): WakeUpScope {
  const average = (value: number | null) => (value === null ? "—" : DECIMAL[locale].format(value));
  const checks = tally.awakeChecksPassed + tally.awakeChecksFailed;
  return {
    key,
    name,
    rang: tally.rings === 1 ? t("rangOnce") : t("rang", { count: String(tally.rings) }),
    rows: [
      {
        label: t("dismissTime"),
        value: tally.medianDismissMs === null ? "—" : duration(tally.medianDismissMs, t),
      },
      { label: t("snoozesPerRing"), value: average(tally.snoozesPerRing) },
      { label: t("cardsPerDismissal"), value: average(tally.cardsPerDismissal) },
      {
        label: t("awakeChecks"),
        value: checks
          ? t("of", { passed: String(tally.awakeChecksPassed), total: String(checks) })
          : "—",
      },
      { label: t("missed"), value: String(tally.missed) },
    ],
  };
}

/**
 * Wake-up stats as text: every alarm together, then each alarm that rang or was missed, named by
 * its label, else its time, else as deleted. Empty when nothing rang or was missed.
 */
export function wakeUpScopes(
  stats: WakeUpStats,
  alarms: readonly Alarm[],
  t: StatsCopy,
  locale: Locale,
): WakeUpScope[] {
  if (stats.overall.rings === 0 && stats.overall.missed === 0) return [];
  const name = (alarmId: string) => {
    const alarm = alarms.find((a) => a.id === alarmId);
    return alarm ? alarm.label || clock(alarm) : t("deletedAlarm");
  };
  return [
    scope("all", t("allAlarms"), stats.overall, t, locale),
    ...stats.alarms.map((tally) => scope(tally.alarmId, name(tally.alarmId), tally, t, locale)),
  ];
}
