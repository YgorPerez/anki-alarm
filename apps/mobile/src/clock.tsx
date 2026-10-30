import type { Locale } from "@app/core";
import { useEffect, useState } from "react";
import { AppState, Text, View, useWindowDimensions } from "react-native";
import { timeParts } from "./alarm-text.ts";
import { clock, regular } from "./fonts.ts";

// The clock Home and the alarm screens share: the system's 12 or 24 h setting, in the phone's zone.

/** The wall clock each second. Resamples on resume as well, so sleeping never leaves it stale. */
export function useNow() {
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

/**
 * The big clock: bold tabular figures, with AM/PM apart so it can wrap. The figures shrink to fit
 * the width at large font scales; everything else follows the system's scale.
 */
export function Clock({
  at,
  locale,
  zone,
  use24Hour,
}: {
  at: number;
  locale: Locale;
  zone: string;
  use24Hour: boolean;
}) {
  const parts = timeParts(at, locale, zone, use24Hour);
  const period = parts.find((part) => part.type === "dayPeriod")?.value;
  const { width, fontScale } = useWindowDimensions();
  return (
    <View className="flex-row flex-wrap items-baseline gap-2">
      <Text
        className="text-foreground"
        style={{
          ...clock,
          fontSize: Math.min(68, (width - 48) / (3.5 * fontScale)),
        }}
      >
        {parts
          .filter((part) => part.type !== "dayPeriod")
          .map((part) => part.value)
          .join("")
          .trim()}
      </Text>
      {period && (
        <Text style={regular} className="text-body text-muted-foreground">
          {period}
        </Text>
      )}
    </View>
  );
}
