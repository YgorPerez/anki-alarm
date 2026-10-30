import { useEffect, useRef, useState } from "react";
import {
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type ScrollViewInstance,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import type { Locale } from "@app/core";
import { copy } from "./copy.ts";
import { clock } from "./fonts.ts";

/** Inline wall time. Each column wraps independently; minutes never carry into hours. */
export function TimeWheels({
  hour,
  minute,
  locale,
  hour24,
  onChange,
}: {
  hour: number;
  minute: number;
  locale: Locale;
  hour24: boolean;
  onChange: (hour: number, minute: number) => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const fontSize = Math.min(68, (width - 80) / (3 * fontScale));
  const rowHeight = Math.ceil(76 * fontScale);
  const t = copy(locale);
  return (
    <View className="flex-row items-center justify-center py-4">
      <Wheel
        key={`hours-${hour24}-${rowHeight}`}
        label={t("hours")}
        value={hour24 ? hour : hour % 12}
        count={hour24 ? 24 : 12}
        format={hour24 ? undefined : (value) => String(value || 12).padStart(2, "0")}
        rowHeight={rowHeight}
        fontSize={fontSize}
        onChange={(value) => onChange(hour24 ? value : value + (hour >= 12 ? 12 : 0), minute)}
      />
      <Text accessible={false} style={[clock, { fontSize }]} className="text-foreground">
        :
      </Text>
      <Wheel
        key={`minutes-${rowHeight}`}
        label={t("wheelMinutes")}
        value={minute}
        count={60}
        rowHeight={rowHeight}
        fontSize={fontSize}
        onChange={(value) => onChange(hour, value)}
      />
      {!hour24 && (
        <Wheel
          key={`period-${rowHeight}`}
          label="AM/PM"
          value={hour >= 12 ? 1 : 0}
          count={2}
          rowHeight={rowHeight}
          fontSize={Math.min(fontSize, 28)}
          format={(value) => (value === 0 ? "AM" : "PM")}
          onChange={(value) => onChange((hour % 12) + value * 12, minute)}
        />
      )}
    </View>
  );
}

const digits = (value: number) => String(value).padStart(2, "0");

/** Five copies keep either end outside normal gestures; settling returns to the middle copy. */
function Wheel({
  label,
  value,
  count,
  rowHeight,
  fontSize,
  format = digits,
  onChange,
}: {
  label: string;
  value: number;
  count: number;
  rowHeight: number;
  fontSize: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const scroll = useRef<ScrollViewInstance>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [initialOffset] = useState(() => ({ x: 0, y: (count * 2 + value) * rowHeight }));
  useEffect(() => () => clearTimeout(idle.current), []);
  const indexAt = (event: NativeSyntheticEvent<NativeScrollEvent>) =>
    Math.max(0, Math.round(event.nativeEvent.contentOffset.y / rowHeight)) % count;
  const recenter = (next: number) => {
    scroll.current?.scrollTo?.({ y: (count * 2 + next) * rowHeight, animated: false });
  };
  const settle = (next: number) => {
    clearTimeout(idle.current);
    onChange(next);
    recenter(next);
  };
  return (
    <ScrollView
      ref={scroll}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: count - 1, now: value, text: format(value) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === "increment") settle((value + 1) % count);
        if (nativeEvent.actionName === "decrement") settle((value + count - 1) % count);
      }}
      className="flex-1"
      style={{ height: rowHeight * 3 }}
      contentContainerStyle={{ paddingVertical: rowHeight }}
      contentOffset={initialOffset}
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
      snapToInterval={rowHeight}
      decelerationRate="fast"
      scrollEventThrottle={16}
      onScroll={(event) => onChange(indexAt(event))}
      onScrollBeginDrag={() => clearTimeout(idle.current)}
      onMomentumScrollBegin={() => clearTimeout(idle.current)}
      onScrollEndDrag={(event) => {
        const next = indexAt(event);
        onChange(next);
        // Delay only the native repositioning, never a draft update with captured values.
        idle.current = setTimeout(() => recenter(next), 150);
      }}
      onMomentumScrollEnd={(event) => settle(indexAt(event))}
    >
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {Array.from({ length: count * 5 }, (_, index) => (
          <Text
            key={index}
            style={[
              clock,
              {
                height: rowHeight,
                lineHeight: rowHeight,
                fontSize,
              },
            ]}
            className={
              index % count === value
                ? "text-center text-foreground"
                : "text-center text-muted-foreground"
            }
          >
            {format(index % count)}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}
