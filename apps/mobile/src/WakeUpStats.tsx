import type { Alarm, Locale, WakeUpStats, WakeUpTally } from "@app/core";
import { Text, View } from "react-native";
import type { StatsCopy } from "./stats-copy.ts";

const regular = { fontFamily: "AtkinsonHyperlegible_400Regular" };
const bold = { fontFamily: "AtkinsonHyperlegible_700Bold" };
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

/** Wake-up stats: every alarm together, then each alarm that rang or was missed. */
export function WakeUpSection({
  stats,
  alarms,
  t,
  locale,
}: {
  stats: WakeUpStats;
  alarms: readonly Alarm[];
  t: StatsCopy;
  locale: Locale;
}) {
  const name = (alarmId: string) => {
    const alarm = alarms.find((a) => a.id === alarmId);
    return alarm ? alarm.label || clock(alarm) : t("deletedAlarm");
  };
  if (stats.overall.rings === 0 && stats.overall.missed === 0)
    return (
      <Text style={regular} className="text-body text-muted-foreground">
        {t("noRings")}
      </Text>
    );
  return (
    <>
      <Scope name={t("allAlarms")} tally={stats.overall} t={t} locale={locale} />
      {stats.alarms.map((tally) => (
        <Scope key={tally.alarmId} name={name(tally.alarmId)} tally={tally} t={t} locale={locale} />
      ))}
    </>
  );
}

function Scope({
  name,
  tally,
  t,
  locale,
}: {
  name: string;
  tally: WakeUpTally;
  t: StatsCopy;
  locale: Locale;
}) {
  const average = (value: number | null) => (value === null ? "—" : DECIMAL[locale].format(value));
  const checks = tally.awakeChecksPassed + tally.awakeChecksFailed;
  const rows: [string, string][] = [
    [t("dismissTime"), tally.medianDismissMs === null ? "—" : duration(tally.medianDismissMs, t)],
    [t("snoozesPerRing"), average(tally.snoozesPerRing)],
    [t("cardsPerDismissal"), average(tally.cardsPerDismissal)],
    [
      t("awakeChecks"),
      checks ? t("of", { passed: String(tally.awakeChecksPassed), total: String(checks) }) : "—",
    ],
    [t("missed"), String(tally.missed)],
  ];
  return (
    <View accessibilityLabel={name} className="gap-1 rounded-lg bg-surface p-4">
      <View className="flex-row items-baseline justify-between gap-3">
        <Text style={bold} className="flex-1 text-body text-foreground">
          {name}
        </Text>
        <Text style={regular} className="text-label text-muted-foreground tabular-nums">
          {tally.rings === 1 ? t("rangOnce") : t("rang", { count: String(tally.rings) })}
        </Text>
      </View>
      {rows.map(([label, value]) => (
        <View key={label} className="min-h-10 flex-row items-center justify-between gap-3">
          <Text style={regular} className="flex-1 text-label text-muted-foreground">
            {label}
          </Text>
          <Text style={bold} className="text-body text-foreground tabular-nums">
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}
