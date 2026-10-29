import { EVERY_DAY, WEEKDAYS, type AlarmRule, type Locale } from "@app/core";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Pressable, Text, View } from "react-native";
import { dateText, startOfToday, weekdayName } from "./alarm-text.ts";
import { copy } from "./copy.ts";
import { bold, regular } from "./fonts.ts";
import { Sheet } from "./Sheet.tsx";

type Repeat = Pick<AlarmRule, "repeatDays" | "onceDate">;

const sameDays = (days: readonly number[], set: readonly number[]) =>
  days.length === set.length && set.every((day) => days.includes(day));

/**
 * The editor's Repeat sheet: day chips, Every day and Weekdays, or a one-off date from Android's
 * calendar. A date clears the days and a day clears the date.
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
  repeat: Repeat;
  visible: boolean;
  locale: Locale;
  now: () => number;
  zone: string;
  onChange: (repeat: Repeat) => void;
  onClose: () => void;
}) {
  const t = copy(locale);
  const days = repeat.onceDate ? [] : (repeat.repeatDays ?? []);
  const setDays = (next: readonly number[]) =>
    onChange({ repeatDays: EVERY_DAY.filter((day) => next.includes(day)) });
  const pickDate = () => {
    const today = startOfToday(now(), zone);
    const [year, month, day] = (repeat.onceDate ?? "").split("-").map(Number);
    DateTimePickerAndroid.open({
      mode: "date",
      value: repeat.onceDate ? new Date(year!, month! - 1, day) : today,
      minimumDate: today,
      onValueChange: (_event, date) => {
        const pad = (value: number) => String(value).padStart(2, "0");
        onChange({
          onceDate: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        });
      },
    });
  };
  return (
    <Sheet title={t("repeat")} visible={visible} locale={locale} onClose={onClose}>
      <View className="flex-row flex-wrap gap-2">
        <Shortcut
          label={t("everyDay")}
          selected={sameDays(days, EVERY_DAY)}
          onPress={() => setDays(EVERY_DAY)}
        />
        <Shortcut
          label={t("weekdays")}
          selected={sameDays(days, WEEKDAYS)}
          onPress={() => setDays(WEEKDAYS)}
        />
      </View>
      <View className="flex-row flex-wrap gap-2">
        {EVERY_DAY.map((day) => {
          const checked = days.includes(day);
          return (
            <Pressable
              key={day}
              accessibilityRole="checkbox"
              accessibilityLabel={weekdayName(day, locale)}
              accessibilityState={{ checked }}
              onPress={() => setDays(checked ? days.filter((d) => d !== day) : [...days, day])}
              className={`min-h-12 min-w-12 items-center justify-center rounded-pill px-3 ${checked ? "bg-primary-tint" : "bg-surface"}`}
            >
              <Text
                style={checked ? bold : regular}
                className={`text-label ${checked ? "text-primary-ink" : "text-foreground"}`}
              >
                {weekdayName(day, locale)}
              </Text>
            </Pressable>
          );
        })}
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
        <Text style={bold} className="text-body text-primary-ink">
          {repeat.onceDate ? dateText(repeat.onceDate, locale) : "›"}
        </Text>
      </Pressable>
    </Sheet>
  );
}

function Shortcut({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`min-h-12 justify-center rounded-pill px-5 ${selected ? "bg-primary-tint" : "bg-surface"}`}
    >
      <Text
        style={selected ? bold : regular}
        className={`text-body ${selected ? "text-primary-ink" : "text-foreground"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
