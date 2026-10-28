import { Pressable, Text } from "react-native";

const regular = { fontFamily: "AtkinsonHyperlegible_400Regular" };
export function Button({
  label,
  onPress,
  primary = false,
  destructive = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={
        primary
          ? "min-h-12 justify-center rounded-full bg-primary px-5 py-3 active:opacity-80 disabled:opacity-40"
          : "min-h-12 justify-center rounded-full bg-surface px-5 py-3 active:opacity-80 disabled:opacity-40"
      }
    >
      <Text
        style={regular}
        className={
          destructive
            ? "text-body text-destructive"
            : primary
              ? "text-body text-primary-foreground"
              : "text-body text-foreground"
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}
