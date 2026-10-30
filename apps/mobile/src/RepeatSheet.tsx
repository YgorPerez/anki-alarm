import ChevronRight from "lucide-react-native/icons/chevron-right";
import { ThemedIcon } from "./icons.tsx";
import { PillChip } from "./PillChip.tsx";
import { EVERY_DAY, WEEKDAYS, type AlarmRule, type Locale } from "@app/core";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Pressable, Text, View } from "react-native";
import {
  repeatLine,
  sameDays,
  startOfToday,
  WEEK_FROM_SUNDAY,
  weekdayLetter,
  weekdayName,
} from "./alarm-text.ts";
import { copy } from "./copy.ts";
import { bold, regular } from "./fonts.ts";
import { Sheet } from "./Sheet.tsx";

type Repeat = Pick<AlarmRule, "repeatDays" | "onceDate">;

const pad = (value: number) => String(value).padStart(2, "0");

/** Tappable day letters, Sunday first. Picking a day clears a one-off date. */
export function DayLetters({
  repeat,
  locale,
  onChange,
}: {
  repeat: Repeat;
  locale: Locale;
  onChange: (repeat: Repeat) => void;
}) {
  const days = repeat.onceDate ? [] : (repeat.repeatDays ?? []);
  return (
    // Seven 48dp targets need 336dp: 12dp margins on a 360dp phone, and they wrap on a narrower one.
    <View className="-mx-3 flex-row flex-wrap justify-between">
      {WEEK_FROM_SUNDAY.map((day) => {
        const checked = days.includes(day);
        const next = new Set(days);
        if (checked) next.delete(day);
        else next.add(day);
        return (
          <Pressable
            key={day}
            accessibilityRole="checkbox"
            accessibilityLabel={weekdayName(day, locale)}
            accessibilityState={{ checked }}
            onPress={() => onChange({ repeatDays: EVERY_DAY.filter((d) => next.has(d)) })}
            style={{ width: 48, minHeight: 48 }}
            className={`items-center justify-center rounded-pill ${checked ? "bg-primary-tint" : ""}`}
          >
            <Text
              style={checked ? bold : regular}
              className={`text-body ${checked ? "text-primary-ink" : "text-foreground"}`}
            >
              {weekdayLetter(day, locale)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The sheet behind the editor's summary line: Every day and Weekdays, or a one-off date from
 * Android's calendar. A date clears the days and a preset clears the date.
 */
export function RepeatSheet({
  repeat,
  visible,
  locale,
  now,
  zone,
  onChange,
  onClose,
}: {
  repeat: AlarmRule;
  visible: boolean;
  locale: Locale;
  now: () => number;
  zone: string;
  onChange: (repeat: Repeat) => void;
  onClose: () => void;
}) {
  const t = copy(locale);
  const days = repeat.onceDate ? [] : (repeat.repeatDays ?? []);
  const pickDate = () => {
    const today = startOfToday(now(), zone);
    const [year, month, day] = (repeat.onceDate ?? "").split("-").map(Number);
    DateTimePickerAndroid.open({
      mode: "date",
      value: repeat.onceDate ? new Date(year!, month! - 1, day) : today,
      minimumDate: today,
      onValueChange: (_event, date) => {
        onChange({
          onceDate: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        });
      },
    });
  };
  return (
    <Sheet title={t("repeat")} visible={visible} locale={locale} onClose={onClose}>
      <View className="flex-row flex-wrap gap-2">
        <PillChip
          className=""
          label={t("everyDay")}
          selected={sameDays(days, EVERY_DAY)}
          onPress={() => onChange({ repeatDays: EVERY_DAY })}
        />
        <PillChip
          className=""
          label={t("weekdays")}
          selected={sameDays(days, WEEKDAYS)}
          onPress={() => onChange({ repeatDays: WEEKDAYS })}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("onceDate")}
        accessibilityState={{ selected: Boolean(repeat.onceDate) }}
        onPress={pickDate}
        className={`min-h-12 flex-row items-center justify-between gap-4 rounded-pill px-5 ${repeat.onceDate ? "bg-primary-tint" : "bg-surface"}`}
      >
        <Text style={regular} className="text-body text-foreground">
          {t("onceDate")}
        </Text>
        {repeat.onceDate ? (
          <Text style={bold} className="text-body text-primary-ink">
            {repeatLine(repeat, { locale, now: now(), zone })}
          </Text>
        ) : (
          <ThemedIcon icon={ChevronRight} colorClassName="text-primary-ink" />
        )}
      </Pressable>
    </Sheet>
  );
}
