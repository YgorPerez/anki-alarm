import { useState } from "react";
import { ringsIn, type Alarm, type Locale } from "@app/core";
import { ringsInText } from "./alarm-text.ts";

/** Shows the scheduled time briefly after a quick alarm has been saved. */
export function useQuickAlarmNotice(
  now: number,
  zone: string,
  locale: Locale,
  onQuickAlarm?: (minutes: number, onAdded: (alarm: Alarm) => void) => void,
) {
  // "Rings in …" after a chip adds its alarm, for a few seconds.
  const [notice, setNotice] = useState<{ text: string; until: number }>();
  const addQuickAlarm = (minutes: number) => {
    onQuickAlarm?.(minutes, (alarm) => {
      const at = Date.now();
      const left = ringsIn(alarm.rule, at, zone);
      if (left !== null)
        setNotice({
          text: ringsInText(left, locale),
          until: at + 5000,
        });
    });
  };
  return { addQuickAlarm, notice: notice && now < notice.until ? notice.text : null };
}
