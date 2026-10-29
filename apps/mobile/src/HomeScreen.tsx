import { nextAlarmRing, timeLeft, type Alarm, type Locale } from "@app/core";
import { useEffect, useState, type ReactNode } from "react";
import {
  AppState,
  FlatList,
  Pressable,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { clockText, durationText, repeatSummary } from "./alarm-text.ts";
import { bold, regular } from "./fonts.ts";
import { copy } from "./copy.ts";

type Deck = { id: string; name: string };

/** Resamples on resume as well as each second, so sleeping never leaves a stale clock. */
function useClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 1000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") tick();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);
  return now;
}

function timeParts(at: number, locale: Locale, zone: string, use24Hour: boolean) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    hour: use24Hour ? "2-digit" : "numeric",
    minute: "2-digit",
    hour12: !use24Hour,
  }).formatToParts(at);
}
function timeText(at: number, locale: Locale, zone: string, use24Hour: boolean) {
  return timeParts(at, locale, zone, use24Hour)
    .map((part) => part.value)
    .join("")
    .replace(/\s+/g, " ");
}

export function HomeClock({
  now,
  locale,
  zone,
  use24Hour,
}: {
  now: number;
  locale: Locale;
  zone: string;
  use24Hour: boolean;
}) {
  const parts = timeParts(now, locale, zone, use24Hour);
  const { width, fontScale } = useWindowDimensions();
  return (
    <View className="flex-row flex-wrap items-baseline gap-2">
      <Text
        className="text-foreground"
        style={{
          ...bold,
          fontSize: Math.min(68, (width - 48) / (3.5 * fontScale)),
          fontVariant: ["tabular-nums"],
        }}
      >
        {parts
          .filter((p) => p.type !== "dayPeriod")
          .map((p) => p.value)
          .join("")
          .trim()}
      </Text>
      {parts.some((p) => p.type === "dayPeriod") && (
        <Text style={regular} className="text-body text-muted-foreground">
          {parts.find((p) => p.type === "dayPeriod")?.value}
        </Text>
      )}
    </View>
  );
}

export function AlarmCard({
  alarm,
  deckName,
  locale,
  now,
  zone,
  use24Hour,
  onEdit,
  onToggle,
}: {
  alarm: Alarm;
  deckName?: string;
  locale: Locale;
  now: number;
  zone: string;
  use24Hour: boolean;
  onEdit: (alarm: Alarm) => void;
  onToggle: (alarm: Alarm) => void;
}) {
  const t = copy(locale);
  const time = clockText(alarm.rule.hour, alarm.rule.minute, use24Hour, locale);
  return (
    <View
      className={
        alarm.enabled ? "rounded-lg bg-surface p-4" : "rounded-lg bg-surface p-4 opacity-50"
      }
    >
      <View className="flex-row items-center gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${time}, ${alarm.label || t("alarms")}`}
          onPress={() => onEdit(alarm)}
          className="min-h-12 flex-1 gap-1"
        >
          <Text
            className="text-title font-bold text-foreground"
            style={{ ...bold, fontVariant: ["tabular-nums"] }}
          >
            {time}
          </Text>
          <Text style={regular} className="text-label text-muted-foreground">
            {repeatSummary(alarm.rule, { locale, now, zone })}
          </Text>
          {alarm.label ? (
            <Text style={regular} className="text-body text-foreground">
              {alarm.label}
            </Text>
          ) : null}
          <Text style={regular} className="text-label text-muted-foreground">
            {deckName || t("chooseDeck")} ·{" "}
            {alarm.need === 1 ? t("oneCard") : t("needCount", { count: String(alarm.need) })}
          </Text>
        </Pressable>
        <Switch
          accessibilityLabel={`${alarm.label || time}: ${t(alarm.enabled ? "enabled" : "disabled")}`}
          value={alarm.enabled}
          onValueChange={(enabled) => onToggle({ ...alarm, enabled })}
        />
      </View>
    </View>
  );
}

export function HomeScreen({
  alarms,
  decks,
  locale,
  zone,
  use24Hour,
  onEdit,
  onAdd,
  onToggle,
  banner,
  error,
  refreshing,
  onRefresh,
}: {
  alarms: readonly Alarm[];
  decks: readonly Deck[];
  locale: Locale;
  zone: string;
  use24Hour: boolean;
  onEdit: (alarm: Alarm) => void;
  onAdd: () => void;
  onToggle: (alarm: Alarm) => void;
  banner?: ReactNode;
  error?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const now = useClock();
  const t = copy(locale);
  const next = nextAlarmRing(alarms, now, zone);
  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={alarms}
        keyExtractor={(alarm) => alarm.id}
        contentContainerStyle={{ padding: 24, gap: 16, paddingBottom: 112 }}
        refreshing={refreshing ?? false}
        onRefresh={onRefresh}
        ListHeaderComponent={
          <View className="gap-4 pb-4">
            <HomeClock now={now} locale={locale} zone={zone} use24Hour={use24Hour} />
            <Text style={regular} className="text-body text-muted-foreground">
              {next
                ? t("nextAlarm", {
                    time: timeText(next.at, locale, zone, use24Hour),
                    left: durationText(timeLeft(next.remainingMs), locale),
                  })
                : t("noEnabledAlarms")}
            </Text>
            {banner}
            {error ? (
              <Text accessibilityRole="alert" className="text-body text-attention">
                {error}
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <AlarmCard
            alarm={item}
            deckName={decks.find((d) => d.id === item.deckId)?.name}
            locale={locale}
            now={now}
            zone={zone}
            use24Hour={use24Hour}
            onEdit={onEdit}
            onToggle={onToggle}
          />
        )}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("add")}
        onPress={onAdd}
        className="absolute bottom-4 right-6 min-h-16 min-w-20 items-center justify-center rounded-pill bg-primary px-6 py-4"
      >
        <Text style={bold} className="text-question text-primary-foreground">
          +
        </Text>
      </Pressable>
    </View>
  );
}
