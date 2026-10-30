import type { Locale } from "@app/core";
import Svg, { Path } from "react-native-svg";
import { View } from "react-native";
import { copy } from "./copy.ts";
import { flagLabel, flags, type Current } from "./study-menu.ts";

/** The current card's flag and its note's star, for the top bar (never inside the card HTML). */
export function StudyAnnotations({ next, locale }: { next: Current; locale: Locale }) {
  if (!next) return null;
  const t = copy(locale);
  const marked = next.note.fields.tags.value.includes("marked");
  const flag = flags.find((f) => f.id === next.card.fields.flag.value);
  if (!flag && !marked) return null;
  return (
    <View className="flex-row items-center gap-2">
      {flag && (
        <Svg
          accessible
          accessibilityLabel={flagLabel(t, flag)}
          width={20}
          height={20}
          viewBox="0 0 24 24"
        >
          <Path
            d="M4 22V3Q9 0 14 3T23 3V15Q18 18 13 15T4 15"
            stroke={flag.color}
            fill={flag.color}
            strokeWidth={2}
          />
        </Svg>
      )}
      {marked && (
        <Svg
          accessible
          accessibilityLabel={t("noteMarked")}
          width={20}
          height={20}
          viewBox="0 0 24 24"
        >
          <Path d="m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z" fill="#e0b000" />
        </Svg>
      )}
    </View>
  );
}
