import type { Locale } from "@app/core";
import { Pressable, Text } from "react-native";
import { timeText } from "./alarm-text.ts";
import { copy } from "./copy.ts";
import { regular } from "./fonts.ts";

/** Another app's next alarm, as far as Android tells. `app` is null when its name is hidden from us. */
export type OtherAlarm = { at: number; app: string | null };

function calendarDay(at: number, zone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(at);
}

export function OtherAlarmNote({
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
  onOpen: () => void;
}) {
  if (!alarm || alarm.at <= now) return null;
  const t = copy(locale);
  const app = alarm.app ?? t("otherApp");
  const time = timeText(alarm.at, locale, zone, use24Hour);
  const day = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(alarm.at);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      className="min-h-12 items-center justify-center"
    >
      <Text style={regular} className="text-label text-muted-foreground text-center">
        {calendarDay(alarm.at, zone) === calendarDay(now, zone)
          ? t("otherAlarmToday", { app, time })
          : t("otherAlarmLater", { app, day, time })}
      </Text>
    </Pressable>
  );
}
