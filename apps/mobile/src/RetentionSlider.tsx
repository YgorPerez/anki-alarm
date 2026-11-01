import { PRESET_LIMITS } from "@app/core";
import { useRef } from "react";
import { Text, View } from "react-native";
import { regular } from "./fonts.ts";

/** A one-percent slider, with the same increments available to TalkBack. */
export function RetentionSlider({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const width = useRef(0);
  const min = PRESET_LIMITS.minRetention * 100;
  const max = PRESET_LIMITS.maxRetention * 100;
  const now = Math.round(Number(value.replace(",", ".")) * 100);
  const set = (next: number) =>
    onChange((Math.min(max, Math.max(min, Math.round(next))) / 100).toFixed(2));
  const move = (x: number) => {
    if (width.current > 0) set(min + (x / width.current) * (max - min));
  };
  return (
    <View className="gap-2">
      <Text style={regular} className="text-label text-muted-foreground">
        {label}: {now}%
      </Text>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityValue={{ min, max, now, text: `${now}%` }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === "increment") set(now + 1);
          if (nativeEvent.actionName === "decrement") set(now - 1);
        }}
        onLayout={({ nativeEvent }) => {
          width.current = nativeEvent.layout.width;
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={({ nativeEvent }) => move(nativeEvent.locationX)}
        onResponderMove={({ nativeEvent }) => move(nativeEvent.locationX)}
        className="min-h-12 justify-center"
      >
        <View pointerEvents="none" className="h-2 rounded-pill bg-track">
          <View
            className="h-2 rounded-pill bg-primary"
            style={{ width: `${((now - min) / (max - min)) * 100}%` }}
          />
          <View
            className="absolute top-1/2 size-6 -translate-x-3 -translate-y-3 rounded-pill bg-primary"
            style={{ left: `${((now - min) / (max - min)) * 100}%` }}
          />
        </View>
      </View>
      <Text style={regular} className="text-label text-muted-foreground">
        {hint}
      </Text>
    </View>
  );
}
