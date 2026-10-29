import { UpdateOffer } from "./UpdateOffer.tsx";
import {
  reliabilitySteps,
  type AlarmPermissions,
  type Locale,
  type ReliabilityKind,
  type ReliabilityStep,
} from "@app/core";
import { Effect } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ListRenderItemInfo } from "react-native";
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
  const list = useRef<FlatList<ReliabilityRowProps>>(null);
  const [index, setIndex] = useState(0);
  const [confirmed, setConfirmed] = useState<ReadonlySet<ReliabilityKind>>(new Set());
  const [error, setError] = useState(false);
  const t = reliabilityCopy(locale);
  const insets = useSafeAreaInsets();
  const steps = useMemo(() => reliabilitySteps(permissions), [permissions]);
  const back = useCallback(() => {
    if (!onboarding) onExit();
    else {
      list.current?.scrollToOffset({ offset: 0, animated: false });
      setIndex((i) => Math.max(0, i - 1));
    }
    return true;
  }, [onboarding, onExit]);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", back);
    return () => sub.remove();
  }, [back]);
  const open = useCallback(
    (kind: ReliabilityKind | "appInfo") => {
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
    },
    [refresh],
  );
  const next = useCallback(() => {
    if (index < steps.length - 1) {
      list.current?.scrollToOffset({ offset: 0, animated: false });
      setIndex(index + 1);
      return;
    }
    void run(Effect.flatMap(AlarmService, (service) => service.completeOnboarding))
      .then((ok) => {
        if (ok) onExit();
        else setError(true);
      })
      .catch(() => setError(true));
  }, [index, steps.length, onExit]);
  const rows = useMemo(
    () =>
      (onboarding ? steps.slice(index, index + 1) : steps).map((step) => ({
        step,
        locale,
        onboarding,
        index,
        total: steps.length,
        confirmed: confirmed.has(step.kind),
        open,
        next,
        confirm: () => {
          setConfirmed((previous) => new Set([...previous, step.kind]));
          if (onboarding) next();
        },
      })),
    [onboarding, steps, index, locale, confirmed, open, next],
  );
  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <FlatList
        ref={list}
        contentContainerStyle={{ padding: 24, gap: 20 }}
        data={rows}
        keyExtractor={(row) => row.step.kind}
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
        renderItem={renderReliabilityRow}
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
              <>
                <UpdateOffer locale={locale} dismissible={false} />
                <Button label={t("close")} onPress={onExit} />
              </>
            )}
          </View>
        }
      />
    </View>
  );
}

interface ReliabilityRowProps {
  step: ReliabilityStep;
  locale: Locale;
  onboarding: boolean;
  index: number;
  total: number;
  confirmed: boolean;
  open: (kind: ReliabilityKind | "appInfo") => void;
  next: () => void;
  confirm: () => void;
}
function renderReliabilityRow({ item }: ListRenderItemInfo<ReliabilityRowProps>) {
  return <ReliabilityRow {...item} />;
}
function ReliabilityRow({
  step,
  locale,
  onboarding,
  index,
  total,
  confirmed,
  open,
  next,
  confirm,
}: ReliabilityRowProps) {
  const t = reliabilityCopy(locale);
  return (
    <View className="gap-4 border-b border-border pb-6">
      {onboarding && (
        <Text style={regular} className="text-label text-muted-foreground">
          {index + 1} / {total}
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
        className={step.state === "granted" ? "text-body text-primary" : "text-body text-attention"}
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
      {step.kind !== "recents" && <Button label={t("open")} onPress={() => open(step.kind)} />}
      {step.state === "unknown" && (
        <>
          {confirmed && (
            <Text style={regular} className="text-body text-muted-foreground">
              {t("confirmed")}
            </Text>
          )}
          <Button
            label={t("manual")}
            onPress={() => {
              confirm();
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
  );
}
