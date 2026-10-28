import type { Locale } from "@app/core";
import { Pressable, Text, View } from "react-native";

import { syncCopy } from "./sync-copy.ts";
import { useAccountState, type AccountState, type Sync } from "./sync.ts";

const syncLine = (state: Extract<AccountState, { kind: "signedIn" }>, locale: Locale) => {
  const t = syncCopy(locale);
  const { sync } = state;
  if (sync.kind === "syncing") return t("syncing");
  if (sync.kind === "failed") return t("failed");
  if (sync.kind === "updateRequired") return t("updateRequired");
  if (sync.kind === "signedOut") return t("expired");
  if (sync.lastSyncedAt === null) return t("notSynced");
  const time = new Date(sync.lastSyncedAt).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return t("synced", { time });
};

/** Media files that didn't move, when the last sync left any. */
const mediaLine = (state: Extract<AccountState, { kind: "signedIn" }>, locale: Locale) => {
  const t = syncCopy(locale);
  const { media } = state;
  if (!media) return null;
  if (media.storageRefused) return t("mediaRefused");
  if (media.heldBack > 0) return t("mediaHeld");
  if (media.missing > 0) return t("mediaMissing", { count: String(media.missing) });
  return null;
};

function Action({
  label,
  onPress,
  primary,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      className={
        primary ? "min-h-12 justify-center rounded-pill bg-primary px-6" : "min-h-12 justify-center"
      }
      onPress={onPress}
    >
      <Text className={primary ? "text-body text-primary-foreground" : "text-body text-primary"}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Settings › Account: sign in with Google, merge confirmation, sync status, sign out. */
export function AccountPanel({ sync, locale }: { sync: Sync | null; locale: Locale }) {
  const t = syncCopy(locale);
  const state = useAccountState(sync);
  if (!sync)
    return (
      <View className="gap-2">
        <Text className="text-title font-bold text-foreground">{t("account")}</Text>
        <Text className="text-body text-muted-foreground">{t("unavailable")}</Text>
      </View>
    );
  return (
    <View className="gap-3">
      <Text accessibilityRole="header" className="text-title font-bold text-foreground">
        {t("account")}
      </Text>
      {state.kind === "signedOut" && (
        <>
          <Text className="text-body text-muted-foreground">{t("pitch")}</Text>
          {state.busy ? (
            <Text className="text-body text-foreground">{t("signingIn")}</Text>
          ) : (
            <Action primary label={t("signIn")} onPress={() => void sync.signIn()} />
          )}
          {state.failed && (
            <Text accessibilityRole="alert" className="text-body text-attention">
              {t("signInFailed")}
            </Text>
          )}
        </>
      )}
      {state.kind === "confirm" && (
        <>
          <Text className="text-body font-bold text-foreground">{t("confirmTitle")}</Text>
          <Text className="text-body text-foreground">
            {t("confirmBody", { email: state.user.email })}
          </Text>
          <Action primary label={t("merge")} onPress={() => void sync.confirm()} />
          <Action label={t("cancel")} onPress={() => void sync.signOut()} />
        </>
      )}
      {state.kind === "signedIn" && (
        <>
          <Text className="text-body text-foreground">
            {t("signedInAs", { email: state.user.email })}
          </Text>
          <Text
            accessibilityRole="text"
            accessibilityLiveRegion="polite"
            className="text-body text-muted-foreground"
          >
            {syncLine(state, locale)}
          </Text>
          {mediaLine(state, locale) !== null && (
            <Text className="text-body text-attention">{mediaLine(state, locale)}</Text>
          )}
          {state.sync.kind === "signedOut" ? (
            <Action primary label={t("signIn")} onPress={() => void sync.signIn()} />
          ) : (
            <Action label={t("syncNow")} onPress={sync.syncNow} />
          )}
          <Action label={t("signOut")} onPress={() => void sync.signOut()} />
          <Text className="text-body text-muted-foreground">{t("signOutNote")}</Text>
        </>
      )}
    </View>
  );
}
