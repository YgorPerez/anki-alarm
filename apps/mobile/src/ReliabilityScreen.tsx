import {
  reliabilityChecklist,
  type AlarmPermissions,
  type Locale,
  type ReliabilityKind,
  type ReliabilityStep,
} from "@app/core";
import { Effect, type Layer } from "effect";
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { Alert, BackHandler, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AlarmService } from "./alarms.ts";
import { Button } from "./controls.tsx";
import { copy } from "./copy.ts";
import { bold, regular } from "./fonts.ts";
import { reliabilityCopy } from "./reliability-copy.ts";

type Open = (kind: ReliabilityKind | "appInfo") => void;

/**
 * The reliability checklist: the four essentials first, then what helps on this phone. Onboarding
 * finishes once the essentials are granted; Settings shows the same list.
 */
export function ReliabilityScreen({
  permissions,
  onboarding,
  locale,
  layer,
  confirmed,
  onConfirm,
  refresh,
  onExit,
  switchLanguage,
  children,
}: {
  permissions: AlarmPermissions;
  onboarding: boolean;
  locale: Locale;
  layer: Layer.Layer<AlarmService>;
  /** Unreadable settings the user marked as done. */
  confirmed: ReadonlySet<ReliabilityKind>;
  onConfirm: (kind: ReliabilityKind, done: boolean) => void;
  /** Re-reads the permissions; App also does it when the app returns to the foreground. */
  refresh: () => void;
  onExit: () => void;
  switchLanguage: () => void;
  /** Settings-only extras, under the list. */
  children?: ReactNode;
}) {
  const t = reliabilityCopy(locale);
  const insets = useSafeAreaInsets();
  const [failed, setFailed] = useState<ReliabilityKind | "appInfo" | "finish" | null>(null);
  const [triedOverlay, setTriedOverlay] = useState(false);
  const list = reliabilityChecklist(permissions, confirmed);
  const run = <A,>(effect: Effect.Effect<A, Error, AlarmService>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)));
  const back = useEffectEvent(() => {
    onExit();
    return true;
  });
  useEffect(() => {
    if (onboarding) return undefined;
    const sub = BackHandler.addEventListener("hardwareBackPress", back);
    return () => sub.remove();
  }, [onboarding]);
  const open: Open = (kind) => {
    setFailed(null);
    if (kind === "overlay") setTriedOverlay(true);
    void run(Effect.flatMap(AlarmService, (service) => service.request(kind)))
      .then((ok) => {
        refresh();
        if (!ok) setFailed(kind);
      })
      .catch(() => setFailed(kind));
  };
  const finish = () => {
    void run(Effect.flatMap(AlarmService, (service) => service.completeOnboarding))
      .then((ok) => {
        if (ok) onExit();
        else setFailed("finish");
      })
      .catch(() => setFailed("finish"));
  };
  const skip = () =>
    Alert.alert(t("skipTitle"), t("skipMessage"), [
      { text: t("close"), style: "cancel" },
      { text: t("skip"), style: "destructive", onPress: finish },
    ]);
  const row = (step: ReliabilityStep) => (
    <ChecklistRow
      key={step.kind}
      step={step}
      locale={locale}
      failed={failed === step.kind}
      restrictedHelp={step.restrictedSettings && triedOverlay}
      appInfoFailed={failed === "appInfo"}
      open={open}
      onConfirm={onConfirm}
    />
  );
  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <ScrollView contentContainerClassName="gap-6 p-6">
        <View className="gap-2">
          <View className="flex-row items-center justify-between gap-4">
            <Text
              style={bold}
              accessibilityRole="header"
              className="shrink text-title text-foreground"
            >
              {t(onboarding ? "setup" : "reliability")}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={switchLanguage}
              className="min-h-12 justify-center px-2"
            >
              <Text style={regular} className="text-label text-primary-ink">
                {copy(locale)("switchLanguage")}
              </Text>
            </Pressable>
          </View>
          <Text style={regular} className="text-body text-muted-foreground">
            {t("intro")}
          </Text>
        </View>
        <View>{list.essentials.map(row)}</View>
        {list.recommended.length > 0 && (
          <View className="gap-2">
            <Text style={bold} accessibilityRole="header" className="text-question text-foreground">
              {t("recommended")}
            </Text>
            <View>{list.recommended.map(row)}</View>
          </View>
        )}
        {onboarding ? (
          <View className="gap-3">
            {failed === "finish" && <ErrorLine locale={locale} />}
            <Button primary label={t("finish")} disabled={!list.ready} onPress={finish} />
            {!list.ready && (
              <Pressable
                accessibilityRole="button"
                onPress={skip}
                className="min-h-12 items-center justify-center"
              >
                <Text style={regular} className="text-label text-muted-foreground">
                  {t("skip")}
                </Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View className="gap-4">
            <Text style={regular} className="text-body text-attention">
              {t("forceStop")}
            </Text>
            {children}
            <Button label={t("close")} onPress={onExit} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/** One setting: tap to open it; a check once granted; a "Done" box when the app can't read it. */
function ChecklistRow({
  step,
  locale,
  failed,
  restrictedHelp,
  appInfoFailed,
  open,
  onConfirm,
}: {
  step: ReliabilityStep;
  locale: Locale;
  failed: boolean;
  restrictedHelp: boolean;
  appInfoFailed: boolean;
  open: Open;
  onConfirm: (kind: ReliabilityKind, done: boolean) => void;
}) {
  const t = reliabilityCopy(locale);
  const manual = step.state === "unknown";
  const label = (
    <View className="min-h-12 flex-row items-center justify-between gap-4">
      <Text style={bold} className="shrink text-body text-foreground">
        {t(step.kind)}
      </Text>
      <Text
        accessibilityLiveRegion="polite"
        style={regular}
        className={step.settled ? "text-label text-primary-ink" : "text-label text-attention"}
      >
        {step.settled
          ? `✓ ${t(step.confirmed ? "done" : "granted")}`
          : t(manual ? "manual" : "denied")}
      </Text>
    </View>
  );
  return (
    <View className="gap-2 border-b border-border py-3">
      {step.openable ? (
        <Pressable accessibilityRole="button" onPress={() => open(step.kind)}>
          {label}
        </Pressable>
      ) : (
        label
      )}
      {manual && (
        <>
          <Text style={regular} className="text-body text-muted-foreground">
            {t(`${step.kind}Hint`)}
          </Text>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={t("done")}
            accessibilityState={{ checked: step.confirmed }}
            onPress={() => onConfirm(step.kind, !step.confirmed)}
            className="min-h-12 flex-row items-center gap-3"
          >
            <View
              className={
                step.confirmed
                  ? "size-6 items-center justify-center rounded-pill border-2 border-primary-ink bg-primary-tint"
                  : "size-6 rounded-pill border-2 border-border"
              }
            >
              {step.confirmed && <Text className="text-label text-primary-ink">✓</Text>}
            </View>
            <Text style={regular} className="text-body text-foreground">
              {t("done")}
            </Text>
          </Pressable>
        </>
      )}
      {restrictedHelp && (
        <View className="gap-2">
          <Text style={regular} className="text-body text-attention">
            {t("restricted")}
          </Text>
          <Button label={t("appInfo")} onPress={() => open("appInfo")} />
          {appInfoFailed && <ErrorLine locale={locale} />}
        </View>
      )}
      {failed && <ErrorLine locale={locale} />}
    </View>
  );
}

function ErrorLine({ locale }: { locale: Locale }) {
  return (
    <Text accessibilityRole="alert" style={regular} className="text-body text-attention">
      {reliabilityCopy(locale)("error")}
    </Text>
  );
}
