import type { Locale } from "@app/core";
import X from "lucide-react-native/icons/x";
import { Pressable, Text, View } from "react-native";

import { Button } from "./controls.tsx";
import { copy } from "./copy.ts";
import { bold, regular } from "./fonts.ts";
import { ThemedIcon } from "./icons.tsx";
import type { UpdateOffer } from "./update-store.ts";

function offerText(offer: UpdateOffer, locale: Locale) {
  const t = copy(locale);
  if (offer.kind === "ota")
    return {
      title: t("otaReady"),
      action: offer.failed ? t("retryUpdate") : t("restartToUpdate"),
      failed: offer.failed,
      busy: false,
    };
  const { apk, download } = offer;
  const failed = download.kind === "failed";
  const action =
    download.kind === "downloading"
      ? t("downloading", { percent: String(download.percent) })
      : download.kind === "ready"
        ? t("installDownloaded")
        : failed
          ? t("retryUpdate")
          : t("installUpdate", { size: String(Math.round(apk.size / 1_000_000)) });
  return {
    title: t("updateAvailable", { version: apk.version }),
    action,
    failed,
    busy: download.kind === "downloading",
  };
}

export function UpdateOfferButton({
  offer,
  locale,
  onAccept,
}: {
  offer: UpdateOffer;
  locale: Locale;
  onAccept: () => void;
}) {
  const t = copy(locale);
  const { title, action, failed, busy } = offerText(offer, locale);
  return (
    <View className="gap-2">
      <Text style={regular} className="text-body text-foreground">
        {title}
      </Text>
      <Button label={action} primary disabled={busy} onPress={onAccept} />
      {failed && (
        <Text style={regular} accessibilityRole="alert" className="text-body text-attention">
          {t("updateFailed")}
        </Text>
      )}
    </View>
  );
}

export function UpdateCard({
  offer,
  locale,
  bottom,
  onAccept,
  onDismiss,
}: {
  offer: UpdateOffer;
  locale: Locale;
  bottom: number;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const t = copy(locale);
  const { title, action, failed, busy } = offerText(offer, locale);
  return (
    <View className="bg-background px-4 pt-2 pb-2" style={{ marginBottom: bottom }}>
      <View className="flex-row items-center rounded-lg bg-surface pr-1">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          accessibilityLabel={`${title}. ${action}`}
          disabled={busy}
          onPress={onAccept}
          className="min-h-12 flex-1 gap-1 p-4"
        >
          <Text style={regular} className="text-label text-foreground">
            {title}
          </Text>
          <Text style={bold} className="text-body font-bold text-primary-ink">
            {action}
          </Text>
          {failed && (
            <Text style={regular} accessibilityRole="alert" className="text-label text-attention">
              {t("updateFailed")}
            </Text>
          )}
        </Pressable>
        {!busy && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("dismissUpdate")}
            onPress={onDismiss}
            className="min-h-12 min-w-12 items-center justify-center rounded-pill"
          >
            <ThemedIcon icon={X} colorClassName="text-muted-foreground" size={20} />
          </Pressable>
        )}
      </View>
    </View>
  );
}
