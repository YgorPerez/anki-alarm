import type { Locale, studyCounts } from "@app/core";
import { Text, View, useColorScheme } from "react-native";
import { copy } from "./copy.ts";

/** Queue order and colours follow Anki: new blue, learning red, review green. */
export function StudyCounts({
  counts,
  locale,
}: {
  counts: ReturnType<typeof studyCounts>;
  locale: Locale;
}) {
  const t = copy(locale);
  const dark = useColorScheme() === "dark";
  return (
    <View className="flex-row items-center gap-2">
      <Text
        accessibilityLabel={t("studyNew", { count: String(counts.new) })}
        className="text-caption"
        style={{ color: dark ? "#77aaff" : "#2266aa" }}
      >
        {counts.new}
      </Text>
      <Text
        accessibilityLabel={t("studyLearning", { count: String(counts.learning) })}
        className="text-caption text-again-ink"
      >
        {counts.learning}
      </Text>
      <Text
        accessibilityLabel={t("studyReview", { count: String(counts.review) })}
        className="text-caption text-easy-ink"
      >
        {counts.review}
      </Text>
    </View>
  );
}
