import { Pressable, Text } from "react-native";
import { bold, regular } from "./fonts.ts";

export function PillChip({
  label,
  selected = false,
  onPress,
  className = "self-start active:opacity-80",
}: {
  className?: string;
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`min-h-12 justify-center rounded-pill px-5 ${className} ${selected ? "bg-primary-tint" : "bg-surface"}`}
    >
      <Text
        numberOfLines={1}
        style={selected ? bold : regular}
        className={`text-body ${selected ? "text-primary-ink" : "text-foreground"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
