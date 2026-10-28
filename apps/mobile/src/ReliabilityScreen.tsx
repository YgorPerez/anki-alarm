import {
  reliabilitySteps,
  type AlarmPermissions,
  type Locale,
  type ReliabilityKind,
} from "@app/core";
import { Effect } from "effect";
import { useCallback, useEffect, useState } from "react";
import { BackHandler, Pressable, FlatList, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AlarmService } from "./alarms.ts";
import { androidAlarmService } from "./alarm-android.ts";
import { reliabilityCopy } from "./reliability-copy.ts";
import { copy } from "./copy.ts";

const run = <A,>(effect: Effect.Effect<A, Error, AlarmService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(androidAlarmService)));
const regular = { fontFamily: "AtkinsonHyperlegible_400Regular" };
const bold = { fontFamily: "AtkinsonHyperlegible_700Bold" };
function Button({
  label,
  onPress,
  primary = false,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={
        primary
          ? "min-h-12 justify-center rounded-pill bg-primary p-4"
          : "min-h-12 justify-center rounded-pill bg-surface p-4"
      }
    >
      <Text
        style={regular}
        className={primary ? "text-body text-primary-foreground" : "text-body text-foreground"}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function ReliabilityScreen({
  permissions,
  onboarding,
  locale,
  refresh,
  onExit,
  switchLanguage,
}: {
  permissions: AlarmPermissions;
  onboarding: boolean;
  locale: Locale;
  refresh: () => void;
  onExit: () => void;
  switchLanguage: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [confirmed, setConfirmed] = useState<ReadonlySet<ReliabilityKind>>(new Set());
  const [error, setError] = useState(false);
  const t = reliabilityCopy(locale);
  const insets = useSafeAreaInsets();
  const steps = reliabilitySteps(permissions);
  const back = useCallback(() => {
    if (!onboarding) onExit();
    else setIndex((i) => Math.max(0, i - 1));
    return true;
  }, [onboarding, onExit]);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", back);
    return () => sub.remove();
  }, [back]);
  function open(kind: ReliabilityKind | "appInfo") {
    setError(false);
    void run(Effect.flatMap(AlarmService, (service) => service.getPermissions))
      .then((p) => {
        refresh();
        // Re-check overlay before sending a user who already granted it back to Settings.
        if (kind === "overlay" && p.overlay === "granted") return true;
        return run(Effect.flatMap(AlarmService, (service) => service.request(kind)));
      })
      .then((ok) => {
        if (!ok) setError(true);
      })
      .catch(() => setError(true));
  }
  function next() {
    if (index < steps.length - 1) {
      setIndex(index + 1);
      return;
    }
    void run(Effect.flatMap(AlarmService, (service) => service.completeOnboarding))
      .then((ok) => {
        if (ok) onExit();
        else setError(true);
      })
      .catch(() => setError(true));
  }
  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <FlatList
        contentContainerStyle={{ padding: 24, gap: 20 }}
        data={onboarding ? steps.slice(index, index + 1) : steps}
        keyExtractor={(step) => step.kind}
        ListHeaderComponent={
          <View className="gap-5">
            <Text style={bold} accessibilityRole="header" className="text-title text-foreground">
              {t(onboarding ? "setup" : "settings")}
            </Text>
            {!onboarding && (
              <Text
                style={bold}
                accessibilityRole="header"
                className="text-question text-foreground"
              >
                {t("reliability")}
              </Text>
            )}
            <Text style={regular} className="text-body text-foreground">
              {t("intro")}
            </Text>
            <Button label={copy(locale)("switchLanguage")} onPress={switchLanguage} />
          </View>
        }
        renderItem={({ item: step }) => (
          <View key={step.kind} className="gap-4 border-b border-border pb-6">
            {onboarding && (
              <Text style={regular} className="text-label text-muted-foreground">
                {index + 1} / {steps.length}
              </Text>
            )}
            <Text style={bold} accessibilityRole="header" className="text-question text-foreground">
              {t(step.kind)}
            </Text>
            <Text style={regular} className="text-body text-foreground">
              {t(`${step.kind}Hint`)}
            </Text>
            <Text
              accessibilityLiveRegion="polite"
              style={regular}
              className={
                step.state === "granted" ? "text-body text-primary" : "text-body text-attention"
              }
            >
              {t(step.state)}
            </Text>
            {step.restrictedSettings && (
              <>
                <Text style={regular} className="text-body text-attention">
                  {t("restricted")}
                </Text>
                <Button label={t("appInfo")} onPress={() => open("appInfo")} />
              </>
            )}
            {step.kind !== "recents" && (
              <Button label={t("open")} onPress={() => open(step.kind)} />
            )}
            {step.state === "unknown" && (
              <>
                {confirmed.has(step.kind) && (
                  <Text style={regular} className="text-body text-muted-foreground">
                    {t("confirmed")}
                  </Text>
                )}
                <Button
                  label={t("manual")}
                  onPress={() => {
                    setConfirmed(new Set([...confirmed, step.kind]));
                    if (onboarding) next();
                  }}
                />
                <Button
                  label={t("missing")}
                  onPress={() => {
                    if (onboarding) next();
                    else open("appInfo");
                  }}
                />
              </>
            )}
          </View>
        )}
        ListFooterComponent={
          <View className="gap-5">
            {error && (
              <Text accessibilityRole="alert" style={regular} className="text-body text-attention">
                {t("error")}
              </Text>
            )}
            <Button
              label={t("refresh")}
              onPress={() => {
                setConfirmed(new Set());
                refresh();
              }}
            />
            <Text style={regular} className="text-body text-attention">
              {t("forceStop")}
            </Text>
            {onboarding ? (
              <>
                <Button
                  primary
                  label={t(index === steps.length - 1 ? "finish" : "next")}
                  onPress={next}
                />
                {index > 0 && <Button label={t("close")} onPress={back} />}
              </>
            ) : (
              <Button label={t("close")} onPress={onExit} />
            )}
          </View>
        }
      />
    </View>
  );
}
