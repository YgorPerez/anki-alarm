import { MAX_SNOOZE_CAP, SNOOZE_CHOICES, SNOOZE_COST, type Alarm, type Locale } from "@app/core";
import { Switch, Text, View } from "react-native";
import { Choice, Stepper } from "./controls.tsx";
import { copy } from "./copy.ts";

/** The alarm editor's snooze: on or off, its length and the snoozes per ring. */
export function AlarmSnoozeSettings({
  alarm,
  locale,
  onChange,
}: {
  alarm: Alarm;
  locale: Locale;
  onChange: (alarm: Alarm) => void;
}) {
  const t = copy(locale);
  // A length synced from elsewhere that the editor doesn't offer stays selectable.
  // Hermes has no toSorted; the array is fresh.
  // oxlint-disable-next-line unicorn/no-array-sort
  const lengths = [...new Set<number>([...SNOOZE_CHOICES, alarm.snoozeMinutes])].sort(
    (a, b) => a - b,
  );
  return (
    <View className="gap-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-body font-bold text-foreground">{t("allowSnooze")}</Text>
        <Switch
          accessibilityLabel={t("allowSnooze")}
          value={alarm.snooze}
          onValueChange={(snooze) => onChange({ ...alarm, snooze })}
        />
      </View>
      <Text className="text-label text-muted-foreground">
        {t("snoozeCostHint", { count: String(SNOOZE_COST) })}
      </Text>
      {alarm.snooze && (
        <>
          <Choice
            label={t("snoozeLength")}
            options={lengths.map((minutes) => ({
              value: String(minutes),
              label: t("minutes", { count: String(minutes) }),
            }))}
            value={String(alarm.snoozeMinutes)}
            onChange={(minutes) => onChange({ ...alarm, snoozeMinutes: Number(minutes) })}
          />
          <Stepper
            label={t("snoozeCap")}
            value={alarm.snoozeCap}
            text={t(alarm.snoozeCap === 1 ? "snoozeCountOne" : "snoozeCount", {
              count: String(alarm.snoozeCap),
            })}
            min={1}
            max={MAX_SNOOZE_CAP}
            fewer={t("fewerSnoozes")}
            more={t("moreSnoozes")}
            onChange={(snoozeCap) => onChange({ ...alarm, snoozeCap })}
          />
        </>
      )}
    </View>
  );
}
