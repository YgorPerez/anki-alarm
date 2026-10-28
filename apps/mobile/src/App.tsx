import type { Locale } from "@app/core";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import { copy } from "./copy.ts";

export function App() {
  return (
    <SafeAreaProvider>
      <Home />
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

function Home() {
  // pt-BR first; Settings will keep the choice once it exists.
  const [locale, setLocale] = useState<Locale>("pt-BR");
  const t = copy(locale);
  // Insets as padding: react-native-safe-area-context's SafeAreaView hides its Text children on
  // React Native 0.88.
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 justify-center gap-6 bg-background p-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
    >
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
  );
}
