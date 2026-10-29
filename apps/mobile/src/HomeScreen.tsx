import { nextAlarmRing, type Alarm, type Locale } from "@app/core";
import type { ReactNode } from "react";
import { FlatList, Pressable, Switch, Text, View } from "react-native";
import { Clock, timeText, useNow } from "./clock.tsx";
import { bold, regular } from "./fonts.ts";
import { copy } from "./copy.ts";

type Deck = { id: string; name: string };

function ruleTime(alarm: Alarm) {
  return Date.UTC(2000, 0, 1, alarm.rule.hour, alarm.rule.minute);
}

function repeatSummary(alarm: Alarm, now: number, locale: Locale, zone: string) {
  const t = copy(locale);
  if (alarm.rule.onceDate) {
    const date = (at: number) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(at);
    if (alarm.rule.onceDate === date(now)) return t("today");
    // Advance the civil day, including days containing a DST transition.
    const today = date(now);
    const tomorrow = new Date(Date.parse(today + "T12:00:00Z") + 86400000)
      .toISOString()
      .slice(0, 10);
    if (alarm.rule.onceDate === tomorrow) return t("tomorrow");
    return new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium" }).format(
      Date.parse(alarm.rule.onceDate + "T12:00:00Z"),
    );
  }
  const days = [...new Set(alarm.rule.repeatDays)].toSorted((a, b) => a - b);
  if (days.join() === "1,2,3,4,5") return t("weekdays");
  if (days.length === 7) return t("everyDay");
  if (days.join() === "6,7") return t("weekends");
  const names =
    locale === "pt-BR"
      ? ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return days.map((day) => names[day - 1]).join(", ");
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
  const time = timeText(ruleTime(alarm), locale, "UTC", use24Hour);
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
            {repeatSummary(alarm, now, locale, zone)}
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
  const now = useNow();
  const t = copy(locale);
  const next = nextAlarmRing(alarms, now, zone);
  const minutes = next ? Math.ceil(next.remainingMs / 60000) : 0;
  const left =
    minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
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
            <Clock at={now} locale={locale} zone={zone} use24Hour={use24Hour} />
            <Text style={regular} className="text-body text-muted-foreground">
              {next
                ? t("nextAlarm", { time: timeText(next.at, locale, zone, use24Hour), left })
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
