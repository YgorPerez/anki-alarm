import type { Locale } from "@app/core";
import { Text, View } from "react-native";
import { ankiDroidCopy } from "./ankidroid-copy.ts";
import { useAnkiDroidSyncBackStatus } from "./ankidroid-sync-query.ts";
import { regular } from "./fonts.ts";

/** A persistent local failure is visible across screens and after restarting the app. */
export function AnkiDroidSyncBackCard({ locale }: { locale: Locale }) {
  const status = useAnkiDroidSyncBackStatus();
  const failure = status.isError ? "failed" : status.data?.failure;
  if (!failure) return null;
  const t = ankiDroidCopy(locale);
  return (
    <View className="rounded-lg bg-surface p-4">
      <Text
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={regular}
        className="text-body text-attention"
      >
        {t("autoStopped")} {t(failure === "failed" ? "syncBackError" : failure)}
      </Text>
    </View>
  );
}
