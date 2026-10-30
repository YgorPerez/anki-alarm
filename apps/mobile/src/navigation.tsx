import type { Theme, Locale } from "@app/core";
import { useMemo, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
import type { LucideIcon } from "lucide-react-native";
import AlarmClock from "lucide-react-native/icons/alarm-clock";
import ChartNoAxesColumn from "lucide-react-native/icons/chart-no-axes-column";
import Layers from "lucide-react-native/icons/layers";
import Settings from "lucide-react-native/icons/settings";
import { reliabilityCopy } from "./reliability-copy.ts";
import { tabLabels } from "./tab-labels.ts";
import { bold, regular } from "./fonts.ts";

const icons: Record<string, LucideIcon> = {
  settings: Settings,
  index: AlarmClock,
  decks: Layers,
};

function Icon({ name, color }: { name: string; color: string }) {
  const Glyph = icons[name] ?? ChartNoAxesColumn;
  return <Glyph size={24} color={color} strokeWidth={1.8} />;
}
/** The native header already clears the status bar, so screens below it must not clear it again. */
export function BelowHeader({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const below = useMemo(() => ({ ...insets, top: 0 }), [insets]);
  return <SafeAreaInsetsContext.Provider value={below}>{children}</SafeAreaInsetsContext.Provider>;
}
export function SettingsButton({
  locale,
  onPress,
  color = "currentColor",
}: {
  locale: Locale;
  onPress: () => void;
  color?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={reliabilityCopy(locale)("settings")}
      testID="open-settings"
      onPress={onPress}
      className="min-h-12 min-w-12 items-center justify-center rounded-pill"
    >
      <Icon name="settings" color={color} />
    </Pressable>
  );
}
export function TabBar({
  locale,
  active,
  onSelect,
  bottom,
  colors,
}: {
  locale: Locale;
  active: string;
  onSelect: (name: string) => void;
  bottom: number;
  colors?: Theme;
}) {
  const labels = tabLabels(locale);
  return (
    <View
      className="flex-row border-t border-border bg-background"
      style={{ paddingBottom: bottom }}
    >
      {Object.entries(labels).map(([name, label]) => (
        <Pressable
          key={name}
          accessibilityRole="tab"
          accessibilityLabel={label}
          accessibilityState={{ selected: active === name }}
          testID={`tab-${name}`}
          onPress={() => onSelect(name)}
          className="min-h-16 flex-1 items-center justify-center gap-1 py-2"
        >
          <View className="h-8 w-16 items-center justify-center">
            {/* Always mounted and only faded: Android dropped the radius when the fill changed. */}
            <View
              style={{ borderRadius: 16, opacity: active === name ? 1 : 0 }}
              className="absolute inset-0 bg-primary-tint"
            />
            <Icon
              name={name}
              color={
                colors
                  ? active === name
                    ? colors["primary-ink"]
                    : colors["muted-foreground"]
                  : "currentColor"
              }
            />
          </View>
          <Text
            style={active === name ? bold : regular}
            className={
              active === name
                ? "text-caption text-primary-ink"
                : "text-caption text-muted-foreground"
            }
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
