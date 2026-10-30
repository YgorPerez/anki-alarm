import type { Locale } from "@app/core";
import { useEffect, useState } from "react";
import { AppState, Text, View, useWindowDimensions } from "react-native";
import { timeParts } from "./alarm-text.ts";
import { CLOCK_EMS, clock, fittedClockSize, regular } from "./fonts.ts";

// The clock the alarm screens share: the system's 12 or 24 h setting, in the phone's zone.

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

/** A time's Inter figures, with AM/PM apart in Atkinson so it can wrap. */
export function ClockFigures({
  parts,
  fontSize,
  className = "text-foreground",
}: {
  parts: ReturnType<typeof timeParts>;
  fontSize: number;
  className?: string;
}) {
  const period = parts.find((part) => part.type === "dayPeriod")?.value;
  return (
    <View className="flex-row flex-wrap items-baseline gap-2">
      <Text className={className} style={{ ...clock, fontSize }}>
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

// The screen's side margins.
const PAGE_MARGINS = 48;

/**
 * The big clock. The figures shrink to fit the width at large font scales; everything else follows
 * the system's scale.
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
  const { width, fontScale } = useWindowDimensions();
  return (
    <ClockFigures
      parts={timeParts(at, locale, zone, use24Hour)}
      fontSize={fittedClockSize(width - PAGE_MARGINS, CLOCK_EMS.screen, fontScale, 68)}
    />
  );
}
