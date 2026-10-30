import type { Theme, Locale } from "@app/core";
import { useMemo, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
import type { LucideIcon } from "lucide-react-native";
import AlarmClock from "lucide-react-native/icons/alarm-clock";
import ChartNoAxesColumn from "lucide-react-native/icons/chart-no-axes-column";
import Layers from "lucide-react-native/icons/layers";
import Settings from "lucide-react-native/icons/settings";
import { copy } from "./copy.ts";
import { reliabilityCopy } from "./reliability-copy.ts";
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
  const t = copy(locale);
  const labels = {
    index: t("alarms"),
    decks: t("title"),
    stats: locale === "pt-BR" ? "Estatísticas" : "Stats",
  };
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
          <View
            className={
              active === name
                ? "items-center rounded-pill bg-primary-tint px-5 py-1"
                : "items-center rounded-pill px-5 py-1"
            }
          >
            <Text
              style={regular}
              className={active === name ? "text-primary-ink" : "text-muted-foreground"}
            >
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
            </Text>
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
