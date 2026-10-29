import type { Locale } from "@app/core";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { copy } from "./copy.ts";
import { findApk, installApk } from "./updates.ts";

/**
 * A newer APK, offered as ADR 0002 says: a dismissible banner on Home, and a line in Settings that
 * stays until the update is installed.
 */
export function UpdateOffer({
  locale,
  dismissible = true,
}: {
  locale: Locale;
  dismissible?: boolean;
}) {
  const [apk, setApk] = useState<Awaited<ReturnType<typeof findApk>>>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const t = copy(locale);
  useEffect(() => {
    let active = true;
    void findApk()
      .then((result) => {
        if (active) setApk(result);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  if (!apk) return null;
  return (
    <View className="gap-3">
      <Text className="text-body text-foreground">
        {t("updateAvailable")} {apk.version}
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          setFailed(false);
          try {
            await installApk(apk.url);
          } catch {
            setFailed(true);
          }
          setBusy(false);
        }}
      >
        <Text className="text-body text-primary">
          {busy ? t("downloading") : t("installUpdate")}
        </Text>
      </Pressable>
      {failed && <Text className="text-body text-foreground">{t("updateFailed")}</Text>}
      {dismissible && (
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => setApk(undefined)}>
          <Text className="text-body text-muted-foreground">{t("dismissUpdate")}</Text>
        </Pressable>
      )}
    </View>
  );
}
