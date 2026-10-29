import { AWAKE_CHECK_DELAYS, RING_POLICY, type Alarm, type Locale } from "@app/core";
import { Pressable, Switch, Text, View } from "react-native";
import { copy } from "./copy.ts";

/** The alarm editor's awake check: on or off, and how long after dismissal it shows. */
export function AlarmAwakeCheckSettings({
  alarm,
  locale,
  onChange,
}: {
  alarm: Alarm;
  locale: Locale;
  onChange: (alarm: Alarm) => void;
}) {
  const t = copy(locale);
  return (
    <View className="gap-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-body font-bold text-foreground">{t("awakeCheck")}</Text>
        <Switch
          accessibilityLabel={t("awakeCheck")}
          value={alarm.awakeCheck}
          onValueChange={(awakeCheck) => onChange({ ...alarm, awakeCheck })}
        />
      </View>
      {alarm.awakeCheck && (
        <>
          <Text className="text-body text-muted-foreground">
            {t("awakeCheckHint", { seconds: String(RING_POLICY.awakeCheckSeconds) })}
          </Text>
          <Text className="text-body text-foreground">{t("awakeCheckDelay")}</Text>
          <View className="flex-row flex-wrap gap-2">
            {AWAKE_CHECK_DELAYS.map((awakeCheckMinutes) => {
              const selected = alarm.awakeCheckMinutes === awakeCheckMinutes;
              return (
                <Pressable
                  key={awakeCheckMinutes}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  className={`min-h-12 justify-center rounded-pill p-3 ${selected ? "bg-primary-tint" : "bg-surface"}`}
                  onPress={() => onChange({ ...alarm, awakeCheckMinutes })}
                >
                  <Text className="text-body text-foreground">
                    {t("minutes", { count: String(awakeCheckMinutes) })}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}
