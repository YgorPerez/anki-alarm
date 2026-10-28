import { AlarmSoundSettings } from "./AlarmSoundSettings.tsx";
import { AlarmDeckSettings } from "./AlarmDeckSettings.tsx";
import { AlarmScreen } from "./AlarmScreen.tsx";
import { ReliabilityScreen } from "./ReliabilityScreen.tsx";
import { reliabilityCopy } from "./reliability-copy.ts";
import { UpdateOffer } from "./UpdateOffer.tsx";
import { newAlarm, nextRing, themeFor, type Alarm, type Locale } from "@app/core";
import {
  AtkinsonHyperlegible_400Regular,
  AtkinsonHyperlegible_700Bold,
  useFonts,
} from "@expo-google-fonts/atkinson-hyperlegible";
import { CollectionScreen } from "./CollectionScreen.tsx";
import { androidAnkiDroid } from "./ankidroid-android.ts";
import { StatsScreen } from "./StatsScreen.tsx";
import { statsCopy } from "./stats-copy.ts";
import { Effect } from "effect";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import type { ListRenderItemInfo } from "react-native";
import {
  AppState,
  BackHandler,
  Pressable,
  FlatList,
  Switch,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { copy } from "./copy.ts";
import { AlarmService, alarmController, type Ring } from "./alarms.ts";
import { androidAlarmService, native } from "./alarm-android.ts";
import { localData } from "./database.ts";
import { QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { ThemeSettings } from "./ThemeSettings.tsx";
import { initializeTheme, useThemeChoice } from "./theme.ts";
import { ScopedTheme } from "uniwind";
import { queryClient } from "./query.ts";
import { useUI } from "./ui.ts";
const repository = {
  list: localData((data) => data.alarms),
  save: (alarm: Alarm) => localData((data) => data.saveAlarm(alarm)),
  ingest: (events: readonly import("./alarms.ts").AlarmEvent[]) =>
    localData((data) => data.ingestEvents(events)),
  events: localData((data) => data.events),
};

export function App() {
  const [fontsLoaded, fontError] = useFonts({
    AtkinsonHyperlegible_400Regular,
    AtkinsonHyperlegible_700Bold,
  });
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        {fontsLoaded || fontError ? <Home /> : <View className="flex-1 bg-background" />}
        <StatusBar style="auto" />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
const run = <A,>(effect: Effect.Effect<A, Error, AlarmService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(androidAlarmService)));

const currentTime = () => Date.now();
function Home() {
  const [onboarding, setOnboarding] = useState(() => !native.isOnboardingComplete());
  const [showSettings, setShowSettings] = useState(false);
  const [showDecks, setShowDecks] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const scheme = useColorScheme();
  const [controller] = useState(() => alarmController(repository));
  const client = useQueryClient();
  const [showTheme, setShowTheme] = useState(false);
  const alarmsQuery = useQuery({
    queryKey: ["alarms"],
    queryFn: () => Effect.runPromise(controller.list),
  });
  const alarms = alarmsQuery.data ?? [];
  const { locale, setLocale } = useUI();
  const [ring, setRing] = useState<Ring | null>(null);
  const [editing, setEditing] = useState<Alarm | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void initializeTheme().catch(() => setError(copy(locale)("error")));
  }, [locale]);
  useEffect(() => {
    if (!showTheme || ring) return undefined;
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      setShowTheme(false);
      return true;
    });
    return () => back.remove();
  }, [showTheme, ring]);
  const [permissions, setPermissions] = useState(() => native.getPermissions());
  const t = copy(locale);
  const insets = useSafeAreaInsets();
  const theme = useThemeChoice();
  useEffect(() => {
    const dark = themeFor(theme, "dark");
    void run(
      Effect.flatMap(AlarmService, (service) =>
        service.setAppearance(
          {
            background: dark.background,
            foreground: dark.foreground,
            primary: dark["primary-ink"],
          },
          locale,
        ),
      ),
    ).catch(() => setError(copy(locale)("alarmError")));
  }, [locale, theme]);
  useEffect(() => {
    const refresh = () => {
      setPermissions(native.getPermissions());
      void client.invalidateQueries({ queryKey: ["alarms"] });
      void Effect.runPromise(controller.resume.pipe(Effect.provide(androidAlarmService)))
        .then((active) => {
          setRing(active);
          // An alarm folded into the ring can raise its N.
          void client.invalidateQueries({ queryKey: ["alarmSession"] });
        })
        .catch(() => setError(copy(locale)("alarmError")));
    };
    refresh();
    const subscription = native.addListener("onChange", refresh);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      subscription.remove();
      appState.remove();
    };
  }, [controller, locale, client]);
  const save = useCallback(
    (alarm: Alarm) => {
      void run(controller.save(alarm))
        .then(() => {
          void client.invalidateQueries({ queryKey: ["alarms"] });
          setEditing(null);
          setError("");
        })
        .catch(() => setError(copy(locale)("alarmError")));
    },
    [controller, locale, client],
  );
  const renderAlarm = useCallback(
    ({ item }: ListRenderItemInfo<Alarm>) => (
      <AlarmRow alarm={item} locale={locale} onEdit={setEditing} onSave={save} />
    ),
    [locale, save],
  );
  if (ring)
    return (
      <ScopedTheme theme="dark">
        <AlarmScreen
          key={ring.id}
          ring={ring}
          locale={locale}
          layer={androidAlarmService}
          onDismissed={() => {
            void run(controller.resume)
              .then(setRing)
              .catch(() => setError(t("alarmError")));
          }}
        />
      </ScopedTheme>
    );
  if (onboarding || showSettings)
    return (
      <ReliabilityScreen
        permissions={permissions}
        onboarding={onboarding}
        locale={locale}
        refresh={() => setPermissions(native.getPermissions())}
        onExit={() => {
          setOnboarding(false);
          setShowSettings(false);
        }}
        switchLanguage={() => setLocale(locale === "en" ? "pt-BR" : "en")}
      />
    );
  if (showTheme) return <ThemeSettings locale={locale} onBack={() => setShowTheme(false)} />;
  if (showStats)
    return (
      <StatsScreen
        locale={locale}
        theme={themeFor(theme, scheme === "dark" ? "dark" : "light")}
        onExit={() => setShowStats(false)}
      />
    );
  if (showDecks)
    return (
      <CollectionScreen
        locale={locale}
        onExit={() => setShowDecks(false)}
        onTheme={() => setShowTheme(true)}
        ankiDroid={androidAnkiDroid}
      />
    );

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <FlatList
        contentContainerStyle={{ padding: 24, gap: 20 }}
        data={editing ? [] : alarms}
        keyExtractor={(alarm) => alarm.id}
        renderItem={renderAlarm}
        ListHeaderComponent={
          <View className="gap-4">
            <Text className="text-title font-bold text-foreground">{t("alarms")}</Text>
            <Pressable accessibilityRole="button" onPress={() => setShowDecks(true)}>
              <Text className="text-body text-primary">{t("title")}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setShowStats(true)}>
              <Text className="text-body text-primary-ink">{statsCopy(locale)("stats")}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setShowTheme(true)}>
              <Text className="text-body text-primary-ink">{t("theme")}</Text>
            </Pressable>
            {editing ? (
              <AlarmEditor
                alarm={editing}
                locale={locale}
                onSave={save}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  className="rounded-pill bg-primary p-4"
                  onPress={() => setEditing(newAlarm(native.createId()))}
                >
                  <Text className="text-body text-primary-foreground">{t("add")}</Text>
                </Pressable>
              </>
            )}
          </View>
        }
        ListFooterComponent={
          <View className="gap-4">
            <UpdateOffer locale={locale} />
            <Text accessibilityRole="alert" className="text-body text-attention">
              {error || (alarmsQuery.isError ? t("alarmError") : "")}
            </Text>
            <Pressable
              accessibilityRole="button"
              className="min-h-12 justify-center"
              onPress={() => setShowSettings(true)}
            >
              <Text className="text-body text-primary">{reliabilityCopy(locale)("settings")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setLocale(locale === "en" ? "pt-BR" : "en")}
            >
              <Text className="text-body text-primary">{t("switchLanguage")}</Text>
            </Pressable>
          </View>
        }
      />
    </View>
  );
}
function AlarmRow({
  alarm,
  locale,
  onEdit,
  onSave,
}: {
  alarm: Alarm;
  locale: Locale;
  onEdit: (alarm: Alarm) => void;
  onSave: (alarm: Alarm) => void;
}) {
  const t = copy(locale);
  return (
    <View className="flex-row items-center justify-between border-b border-border py-4">
      <Pressable accessibilityRole="button" onPress={() => onEdit(alarm)}>
        <Text className="text-title text-foreground">{`${String(alarm.rule.hour).padStart(2, "0")}:${String(alarm.rule.minute).padStart(2, "0")}`}</Text>
        <Text className="text-body text-muted-foreground">{alarm.label}</Text>
      </Pressable>
      <Switch
        accessibilityLabel={`${alarm.label}: ${t(alarm.enabled ? "enabled" : "disabled")}`}
        value={alarm.enabled}
        onValueChange={(enabled) => onSave({ ...alarm, enabled })}
      />
    </View>
  );
}
/**
 * The editor's time and date as a rule that rings again, or null. Outside the component: React
 * Compiler doesn't compile a `throw` inside `try`.
 */
function parseRule(time: string, date: string, days: readonly number[]): Alarm["rule"] | null {
  try {
    if (
      !/^\d{2}:\d{2}$/.test(time) ||
      (date &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date))
    )
      return null;
    const [hour, minute] = time.split(":").map(Number);
    const rule = {
      hour: hour!,
      minute: minute!,
      ...(date ? { onceDate: date } : { repeatDays: days }),
    };
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // nextRing throws on an hour or minute out of range.
    return nextRing(rule, currentTime(), zone) === null ? null : rule;
  } catch {
    return null;
  }
}
function AlarmEditor({
  alarm,
  locale,
  onSave,
  onCancel,
}: {
  alarm: Alarm;
  locale: Locale;
  onSave: (alarm: Alarm) => void;
  onCancel: () => void;
}) {
  const [options, setOptions] = useState(alarm);
  const [label, setLabel] = useState(alarm.label);
  const [time, setTime] = useState(
    `${String(alarm.rule.hour).padStart(2, "0")}:${String(alarm.rule.minute).padStart(2, "0")}`,
  );
  const [date, setDate] = useState(alarm.rule.onceDate ?? "");
  const [days, setDays] = useState<readonly number[]>(alarm.rule.repeatDays ?? []);
  const [error, setError] = useState("");
  const t = copy(locale);
  return (
    <View className="gap-4">
      <TextInput
        accessibilityLabel={t("label")}
        placeholder={t("label")}
        value={label}
        onChangeText={setLabel}
        className="rounded-lg bg-surface p-4 text-body text-foreground"
      />
      <TextInput
        accessibilityLabel={t("time")}
        placeholder={t("time")}
        value={time}
        onChangeText={setTime}
        keyboardType="numbers-and-punctuation"
        className="rounded-lg bg-surface p-4 text-body text-foreground"
      />
      <Text className="text-body text-foreground">{t("repeat")}</Text>
      <View className="flex-row justify-between">
        {[1, 2, 3, 4, 5, 6, 7].map((day) => (
          <Pressable
            key={day}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: days.includes(day) }}
            onPress={() => {
              setDate("");
              setDays(days.includes(day) ? days.filter((d) => d !== day) : [...days, day]);
            }}
          >
            <Text className={days.includes(day) ? "p-2 text-primary" : "p-2 text-muted-foreground"}>
              {new Date(Date.UTC(2026, 9, 19 + day - 1)).toLocaleDateString(locale, {
                weekday: "short",
                timeZone: "UTC",
              })}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        accessibilityLabel={t("once")}
        placeholder={t("once")}
        value={date}
        onChangeText={(value) => {
          setDate(value);
          setDays([]);
        }}
        className="rounded-lg bg-surface p-4 text-body text-foreground"
      />
      <AlarmDeckSettings alarm={options} locale={locale} onChange={setOptions} />
      <AlarmSoundSettings alarm={options} locale={locale} onChange={setOptions} />
      <Text accessibilityRole="alert" className="text-body text-attention">
        {error}
      </Text>
      <Pressable
        accessibilityRole="button"
        className="rounded-pill bg-primary p-4"
        onPress={() => {
          const rule = parseRule(time, date, days);
          if (!options.deckId) setError(t("chooseDeck"));
          else if (rule) onSave({ ...options, label, rule });
          else setError(t("invalid"));
        }}
      >
        <Text className="text-body text-primary-foreground">{t("save")}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onCancel}>
        <Text className="text-body text-foreground">{t("cancel")}</Text>
      </Pressable>
    </View>
  );
}
