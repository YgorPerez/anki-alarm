import type { Locale } from "@app/core";
import Flag from "lucide-react-native/icons/flag";
import Star from "lucide-react-native/icons/star";
import { View } from "react-native";
import { copy } from "./copy.ts";
import { flagLabel, flags, type Current } from "./study-menu.ts";

/**
 * The current card's flag and its note's star, for the top bar (never inside the card HTML).
 * Lucide hides an icon from screen readers unless it has an aria- prop, so the labels are on Views.
 */
export function StudyAnnotations({ next, locale }: { next: Current; locale: Locale }) {
  if (!next) return null;
  const t = copy(locale);
  const marked = next.note.fields.tags.value.includes("marked");
  const flag = flags.find((f) => f.id === next.card.fields.flag.value);
  if (!flag && !marked) return null;
  return (
    <View className="flex-row items-center gap-2">
      {flag && (
        <View accessible accessibilityLabel={flagLabel(t, flag)}>
          <Flag size={20} color={flag.color} fill={flag.color} />
        </View>
      )}
      {marked && (
        <View accessible accessibilityLabel={t("noteMarked")}>
          <Star size={20} color="#e0b000" fill="#e0b000" />
        </View>
      )}
    </View>
  );
}
