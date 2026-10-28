import type { Locale } from "@app/core";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { copy } from "./copy.ts";

export function App() {
  // pt-BR first; Settings will keep the choice once it exists.
  const [locale, setLocale] = useState<Locale>("pt-BR");
  const t = copy(locale);
  return (
    <SafeAreaProvider>
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 justify-center gap-6 p-6">
          <Text className="text-title font-bold text-foreground">{t("title")}</Text>
          <Text className="text-body text-muted-foreground">{t("tagline")}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setLocale(locale === "en" ? "pt-BR" : "en")}
            className="self-start rounded-lg bg-primary px-4 py-3 active:opacity-80"
          >
            <Text className="text-label font-medium text-primary-foreground">
              {t("switchLanguage")}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
