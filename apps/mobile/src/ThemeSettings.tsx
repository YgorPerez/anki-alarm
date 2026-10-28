import {
  lookAlikes,
  THEME_SWATCHES,
  toHex,
  type Locale,
  type ThemeChoice,
  type ThemeField,
} from "@app/core";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScopedTheme } from "uniwind";

import { copy } from "./copy.ts";
import { bold, regular } from "./fonts.ts";
import { resetTheme, setThemeField, useThemeChoice } from "./theme.ts";

type T = ReturnType<typeof copy>;

const FIELDS: ThemeField[] = [
  "darkBackground",
  "lightBackground",
  "primary",
  "secondary",
  "again",
  "hard",
  "good",
  "easy",
];

/** Settings › Theme: swatches or a free color per field, look-alike warnings, the alarm. */
export function ThemeSettings({ locale, onBack }: { locale: Locale; onBack: () => void }) {
  const t = copy(locale);
  const choice = useThemeChoice();
  const [error, setError] = useState(false);
  const attempt = (operation: Promise<void>) => {
    setError(false);
    void operation.catch(() => setError(true));
  };
  const insets = useSafeAreaInsets();
  const warnings = lookAlikes(choice).map(([a, b]) => t("lookAlike", { a: t(a), b: t(b) }));
  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <ScrollView contentContainerClassName="gap-6 p-6">
        <Pressable accessibilityRole="button" onPress={onBack} className="self-start py-2">
          <Text style={regular} className="text-label text-primary-ink">
            ‹ {t("back")}
          </Text>
        </Pressable>
        <Text accessibilityRole="header" style={bold} className="text-title text-foreground">
          {t("theme")}
        </Text>
        {FIELDS.map((field) => (
          <FieldRow key={field} field={field} choice={choice} t={t} attempt={attempt} />
        ))}
        <Text
          style={regular}
          accessibilityLiveRegion="polite"
          className="text-label text-attention"
        >
          {error ? t("error") : warnings.join(" ")}
        </Text>
        <AlarmPreview t={t} />
        <Pressable
          accessibilityRole="button"
          onPress={() => attempt(resetTheme())}
          className="self-start rounded-full bg-surface px-5 py-3 active:opacity-80"
        >
          <Text style={bold} className="text-label text-foreground">
            {t("reset")}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function FieldRow({
  field,
  choice,
  t,
  attempt,
}: {
  field: ThemeField;
  choice: ThemeChoice;
  t: T;
  attempt: (operation: Promise<void>) => void;
}) {
  const value = choice[field];
  const [text, setText] = useState("");
  const onChangeText = (next: string) => {
    setText(next);
    const hex = toHex(next);
    if (hex) attempt(setThemeField(field, hex));
  };
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t(field)} className="gap-3">
      <Text style={bold} className="text-body text-foreground">
        {t(field)}
      </Text>
      <View className="flex-row flex-wrap items-center gap-3">
        {THEME_SWATCHES[field].map((swatch) => (
          <Pressable
            key={swatch}
            accessibilityRole="radio"
            accessibilityState={{ checked: value === swatch }}
            accessibilityLabel={swatch === "primary" ? t("sameAsPrimary") : swatch}
            onPress={() => attempt(setThemeField(field, swatch))}
            className={
              value === swatch
                ? "size-11 rounded-full border-4 border-foreground"
                : "size-11 rounded-full border border-border"
            }
            style={{ backgroundColor: swatch === "primary" ? choice.primary : swatch }}
          />
        ))}
        <TextInput
          value={text}
          onChangeText={onChangeText}
          placeholder={value === "primary" ? choice.primary : value}
          accessibilityLabel={`${t(field)}: ${t("freeColor")}`}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={7}
          style={regular}
          className="h-11 min-w-28 rounded-full border border-border px-4 text-body text-foreground"
          placeholderTextColorClassName="accent-muted-foreground"
        />
      </View>
    </View>
  );
}

/** The alarm screen is always dark, so it wears the dark background with the user's colors. */
function AlarmPreview({ t }: { t: T }) {
  return (
    <ScopedTheme theme="dark">
      <View className="gap-4 rounded-xl bg-background p-4">
        <View className="flex-row items-center justify-between">
          <Text style={regular} className="text-label text-muted-foreground">
            {t("onTheAlarm")}
          </Text>
          <Text
            style={bold}
            className="rounded-full bg-attention-tint px-3 py-1 text-label text-attention"
          >
            {t("cardsLeft")}
          </Text>
        </View>
        <View className="flex-row gap-2">
          <Grade label={t("again")} pill="bg-again-tint" ink="text-again" />
          <Grade label={t("hard")} pill="bg-hard-tint" ink="text-hard" />
          <Grade label={t("good")} pill="bg-good" ink="text-good-foreground" />
          <Grade label={t("easy")} pill="bg-easy-tint" ink="text-easy" />
        </View>
      </View>
    </ScopedTheme>
  );
}

function Grade({ label, pill, ink }: { label: string; pill: string; ink: string }) {
  return (
    <View className={`h-16 flex-1 items-center justify-center rounded-full ${pill}`}>
      <Text style={bold} className={`text-label ${ink}`}>
        {label}
      </Text>
    </View>
  );
}
