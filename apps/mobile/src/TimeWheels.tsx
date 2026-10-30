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
  const periodWidth = hour24 ? 0 : Math.ceil(28 * fontScale * 1.9);
  const colonWidth = Math.ceil(18 * fontScale);
  const columnWidth = (width - 48 - periodWidth - colonWidth) / 2;
  // Reserve two scaled digits plus side bearings, including on narrow phones in 12-hour mode.
  const fontSize = Math.min(68, columnWidth / (1.55 * fontScale));
  const rowHeight = Math.ceil(76 * fontScale);
  const t = copy(locale);
  return (
    <View className="flex-row items-center justify-center py-4">
      <Wheel
        key={`hours-${hour24}-${rowHeight}`}
        label={t("hours")}
        testName="Hours"
        value={hour24 ? hour : hour % 12}
        count={hour24 ? 24 : 12}
        format={hour24 ? undefined : (value) => String(value || 12).padStart(2, "0")}
        rowHeight={rowHeight}
        fontScale={fontScale}
        fontSize={fontSize}
        onChange={(value) => onChange(hour24 ? value : value + (hour >= 12 ? 12 : 0), minute)}
      />
      <Text
        accessible={false}
        style={[clock, { fontSize, width: colonWidth, textAlign: "center" }]}
        className="text-foreground"
      >
        :
      </Text>
      <Wheel
        key={`minutes-${rowHeight}`}
        label={t("wheelMinutes")}
        testName="Minutes"
        value={minute}
        count={60}
        rowHeight={rowHeight}
        fontScale={fontScale}
        fontSize={fontSize}
        onChange={(value) => onChange(hour, value)}
      />
      {!hour24 && (
        <Wheel
          key={`period-${rowHeight}`}
          label="AM/PM"
          testName="AM/PM"
          width={periodWidth}
          value={hour >= 12 ? 1 : 0}
          count={2}
          rowHeight={rowHeight}
          fontScale={fontScale}
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
  testName,
  value,
  count,
  rowHeight,
  fontScale,
  fontSize,
  format = digits,
  width,
  onChange,
}: {
  label: string;
  testName: string;
  value: number;
  count: number;
  rowHeight: number;
  fontScale: number;
  fontSize: number;
  format?: (value: number) => string;
  width?: number;
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
    // Android gives a ScrollView its own accessibility delegate and then ignores role, value and
    // actions set on it, so TalkBack's control has to be this View around it.
    <View
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
      style={{ height: rowHeight * 3, ...(width === undefined ? {} : { flex: 0, width }) }}
    >
      <ScrollView
        ref={scroll}
        testID={`time-wheel-${testName}`}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
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
        <View>
          {Array.from({ length: count * 5 }, (_, index) => (
            <Text
              key={index}
              style={[
                clock,
                {
                  height: rowHeight,
                  // Android scales lineHeight by the font scale itself, but not height.
                  lineHeight: rowHeight / fontScale,
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
    </View>
  );
}
