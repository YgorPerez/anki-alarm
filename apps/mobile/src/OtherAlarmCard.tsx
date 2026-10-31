import type { Locale } from "@app/core";
import AlarmClock from "lucide-react-native/icons/alarm-clock";
import ArrowUpRight from "lucide-react-native/icons/arrow-up-right";
import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { timeParts, timeText } from "./alarm-text.ts";
import { ClockFigures } from "./clock.tsx";
import { copy } from "./copy.ts";
import { regular } from "./fonts.ts";
import { ThemedIcon } from "./icons.tsx";

/** Another app's next alarm, as far as Android tells. `app` and `icon` are null when it hides them. */
export type OtherAlarm = { at: number; app: string | null; icon: string | null };

const ICON_SIZE = 40;
const TIME_SIZE = 30;

function calendarDay(at: number, zone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(at);
}

function dayText(at: number, locale: Locale, zone: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(at);
}

export function OtherAlarmCard({
  alarm,
  locale,
  now,
  zone,
  use24Hour,
  onOpen,
}: {
  alarm: OtherAlarm | null;
  locale: Locale;
  now: number;
  zone: string;
  use24Hour: boolean;
  /** False when the app has no screen for its alarm, or is gone. */
  onOpen: () => boolean;
}) {
  const [failedAt, setFailedAt] = useState<number | null>(null);
  if (!alarm || alarm.at <= now) return null;
  const t = copy(locale);
  const app = alarm.app ?? t("otherApp");
  const time = timeText(alarm.at, locale, zone, use24Hour);
  const isToday = calendarDay(alarm.at, zone) === calendarDay(now, zone);
  const day = dayText(alarm.at, locale, zone);
  return (
    <View className="gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          isToday ? t("otherAlarmToday", { app, time }) : t("otherAlarmLater", { app, day, time })
        }
        onPress={() => setFailedAt(onOpen() ? null : alarm.at)}
        className="min-h-12 flex-row items-center gap-3 rounded-lg bg-surface p-4"
      >
        <View
          style={{ width: ICON_SIZE, height: ICON_SIZE }}
          className="items-center justify-center"
        >
          {alarm.icon ? (
            <Image
              testID="other-alarm-icon"
              source={{ uri: alarm.icon }}
              style={{ width: ICON_SIZE, height: ICON_SIZE }}
            />
          ) : (
            <ThemedIcon icon={AlarmClock} colorClassName="text-muted-foreground" size={32} />
          )}
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <ClockFigures parts={timeParts(alarm.at, locale, zone, use24Hour)} fontSize={TIME_SIZE} />
          <Text style={regular} className="text-label text-muted-foreground">
            {app} · {isToday ? t("today").toLocaleLowerCase(locale) : day}
          </Text>
        </View>
        <ThemedIcon icon={ArrowUpRight} colorClassName="text-muted-foreground" />
      </Pressable>
      {failedAt === alarm.at ? (
        <Text style={regular} accessibilityRole="alert" className="text-body text-attention">
          {alarm.app ? t("otherAlarmOpenFailed", { app: alarm.app }) : t("otherAppOpenFailed")}
        </Text>
      ) : null}
    </View>
  );
}
