import type { Locale, studyCounts } from "@app/core";
import { Text, View } from "react-native";
import { copy } from "./copy.ts";

/**
 * Anki's queue colours, fixed like the flags. Each is the one shade of its hue that keeps AA text
 * contrast (4.5:1) on both the black and the white page.
 */
const COUNT_COLORS = { new: "#006cff", learning: "#ec0000", review: "#008900" };

/** Queue order and colours follow Anki: new blue, learning red, review green. */
export function StudyCounts({
  counts,
  locale,
}: {
  counts: ReturnType<typeof studyCounts>;
  locale: Locale;
}) {
  const t = copy(locale);
  return (
    <View className="flex-row items-center gap-2">
      <Text
        accessibilityLabel={t(counts.new === 1 ? "studyNewOne" : "studyNew", {
          count: String(counts.new),
        })}
        className="text-caption"
        style={{ color: COUNT_COLORS.new }}
      >
        {counts.new}
      </Text>
      <Text
        accessibilityLabel={t("studyLearning", { count: String(counts.learning) })}
        className="text-caption"
        style={{ color: COUNT_COLORS.learning }}
      >
        {counts.learning}
      </Text>
      <Text
        accessibilityLabel={t(counts.review === 1 ? "studyReviewOne" : "studyReview", {
          count: String(counts.review),
        })}
        className="text-caption"
        style={{ color: COUNT_COLORS.review }}
      >
        {counts.review}
      </Text>
    </View>
  );
}
