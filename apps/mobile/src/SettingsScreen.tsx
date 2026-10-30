import type { Locale } from "@app/core";
import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { Button } from "./controls.tsx";
import { copy } from "./copy.ts";
import { bold } from "./fonts.ts";
import { reliabilityCopy } from "./reliability-copy.ts";

export function SettingsScreen({
  locale,
  onReliability,
  onTheme,
  switchLanguage,
  account,
  update,
}: {
  locale: Locale;
  onReliability: () => void;
  onTheme: () => void;
  switchLanguage: () => void;
  account: ReactNode;
  update: ReactNode;
}) {
  const t = copy(locale);
  const r = reliabilityCopy(locale);
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 p-6">
      <Text accessibilityRole="header" style={bold} className="text-title text-foreground">
        {r("settings")}
      </Text>
      <View className="gap-4">
        <Button label={r("reliability")} onPress={onReliability} />
        <Button label={t("theme")} onPress={onTheme} />
        <Button label={t("switchLanguage")} onPress={switchLanguage} />
      </View>
      {account}
      {update}
    </ScrollView>
  );
}
