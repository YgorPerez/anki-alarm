import { EASY_DAYS } from "@app/core";
import { EASY_DAY_MESSAGES, WEEKDAY_MESSAGES, type EasyDaysFieldProps } from "@app/editing-ui";
import { Text, View } from "react-native";
import { Choice } from "./controls.tsx";
import { editingCopy } from "./editing-copy.ts";
import { regular } from "./fonts.ts";

/** Each weekday's easy day. `value` is the form's text: one day per weekday, Monday first. */
export function EasyDaysField({ value, locale, onChange }: EasyDaysFieldProps) {
  const t = editingCopy(locale);
  const days = value.split(" ");
  const options = EASY_DAYS.map((day) => ({
    value: day as string,
    label: t(EASY_DAY_MESSAGES[day]),
  }));
  return (
    <View className="gap-4">
      <View className="gap-1">
        <Text style={regular} className="text-body text-foreground">
          {t("easyDays")}
        </Text>
        <Text style={regular} className="text-label text-muted-foreground">
          {t("easyDaysHint")}
        </Text>
      </View>
      {WEEKDAY_MESSAGES.map((weekday, index) => (
        <Choice
          key={weekday}
          label={t(weekday)}
          options={options}
          value={days[index]!}
          onChange={(day) => onChange(days.map((d, i) => (i === index ? day : d)).join(" "))}
        />
      ))}
    </View>
  );
}
