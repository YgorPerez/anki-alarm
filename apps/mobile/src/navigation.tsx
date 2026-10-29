import type { Theme, Locale } from "@app/core";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { copy } from "./copy.ts";
import { reliabilityCopy } from "./reliability-copy.ts";
import { bold, regular } from "./fonts.ts";

function Icon({ name, color }: { name: string; color: string }) {
  return (
    <Svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "settings" ? (
        <>
          <Path d="m9 3-.6 2.4-2 .9-2.2-.7-2 3.5L4 10.8v2.4l-1.8 1.7 2 3.5 2.3-.7 2 .9L9 21h4l.6-2.4 2-.9 2.2.7 2-3.5-1.8-1.7v-2.4l1.8-1.7-2-3.5-2.2.7-2-.9L13 3Z" />
          <Circle cx={11} cy={12} r={3} />
        </>
      ) : name === "index" ? (
        <>
          <Circle cx={12} cy={13} r={8} />
          <Path d="M12 9v4l3 2M3 4l3-2m12 0 3 2M6 20l-2 2m14-2 2 2" />
        </>
      ) : name === "decks" ? (
        <>
          <Path d="M5 4h14v17H5zM8 1h11M8 8h8m-8 4h8" />
        </>
      ) : (
        <Path d="M4 20V10m8 10V4m8 16v-7" />
      )}
    </Svg>
  );
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
            <Text className={active === name ? "text-primary-ink" : "text-muted-foreground"}>
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
