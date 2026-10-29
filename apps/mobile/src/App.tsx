import { HomeScreen } from "./HomeScreen.tsx";
import { AlarmSoundSettings } from "./AlarmSoundSettings.tsx";
import { AlarmDeckSettings } from "./AlarmDeckSettings.tsx";
import { AlarmSnoozeSettings } from "./AlarmSnoozeSettings.tsx";
import { AlarmReadAloudSettings } from "./AlarmReadAloudSettings.tsx";
import { AlarmScreen } from "./AlarmScreen.tsx";
import { AwakeCheckScreen } from "./AwakeCheckScreen.tsx";
import { AlarmAwakeCheckSettings } from "./AlarmAwakeCheckSettings.tsx";
import { ReliabilityScreen } from "./ReliabilityScreen.tsx";
import { reliabilityCopy } from "./reliability-copy.ts";
import { UpdateOffer } from "./UpdateOffer.tsx";
import { AccountPanel } from "./AccountPanel.tsx";
import { appSync } from "./app-sync.ts";
import {
  newAlarm,
  nextRing,
  reliabilityChecklist,
  themeFor,
  type Alarm,
  type Locale,
} from "@app/core";
import {
  AtkinsonHyperlegible_400Regular,
  AtkinsonHyperlegible_700Bold,
  useFonts,
} from "@expo-google-fonts/atkinson-hyperlegible";
import { CollectionScreen } from "./CollectionScreen.tsx";
import { androidAnkiDroid } from "./ankidroid-android.ts";
import { syncBackAfterSession } from "./ankidroid.ts";
import { StatsScreen } from "./StatsScreen.tsx";

import { Effect } from "effect";
import { StatusBar } from "expo-status-bar";
import {
  createContext,
  useContext,
  useMemo,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ScreenActivity } from "./screen-activity.ts";
import { useRouter, useIsFocused, useLocalSearchParams } from "expo-router";
import { NavigationGate } from "./NavigationGate.tsx";
import { SettingsScreen } from "./SettingsScreen.tsx";
import {
  Alert,
  AppState,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { copy } from "./copy.ts";
import { AlarmService, alarmController, type AwakeCheck, type Ring } from "./alarms.ts";
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
  remove: (alarmId: string) => localData((data) => data.deleteAlarm(alarmId)),
  ingest: (events: readonly import("./alarms.ts").AlarmEvent[]) =>
    localData((data) => data.ingestEvents(events)),
  events: localData((data) => data.events),
};

const RuntimeContext = createContext<{
  alarms: ReactNode;
  editor: (id: string) => ReactNode;
  reliability: (onExit: () => void) => ReactNode;
} | null>(null);
function RuntimeProvider({
  alarms,
  editor,
  reliability,
  children,
}: {
  alarms: ReactNode;
  editor: (id: string) => ReactNode;
  reliability: (onExit: () => void) => ReactNode;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ alarms, editor, reliability }), [alarms, editor, reliability]);
  return <RuntimeContext value={value}>{children}</RuntimeContext>;
}
function useRuntime() {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("Routes must be inside App");
  return runtime;
}
export function AlarmsRoute() {
  return useRuntime().alarms;
}
export function AlarmEditorRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return useRuntime().editor(id);
}
export function ReliabilityRoute() {
  const router = useRouter();
  return useRuntime().reliability(() => router.back());
}
export function SettingsRoute() {
  const router = useRouter();
  const { locale, setLocale } = useUI();
  return (
    <SettingsScreen
      locale={locale}
      onReliability={() => router.push("/settings/reliability")}
      onTheme={() => router.push("/settings/theme")}
      switchLanguage={() => setLocale(locale === "en" ? "pt-BR" : "en")}
      account={<AccountPanel sync={appSync} locale={locale} />}
      update={<UpdateOffer locale={locale} dismissible={false} />}
    />
  );
}
export function ThemeRoute() {
  const router = useRouter();
  return <ThemeSettings locale={useUI().locale} onBack={() => router.back()} />;
}
export function DecksRoute() {
  const router = useRouter();
  const focused = useIsFocused();
  return (
    <ScreenActivity value={focused}>
      <CollectionScreen
        locale={useUI().locale}
        ankiDroid={androidAnkiDroid}
        onTheme={() => router.push("/settings/theme")}
      />
    </ScreenActivity>
  );
}
export function StatsRoute() {
  const scheme = useColorScheme();
  return (
    <StatsScreen
      locale={useUI().locale}
      theme={themeFor(useThemeChoice(), scheme === "dark" ? "dark" : "light")}
    />
  );
}
export function App({ children }: { children: ReactNode }) {
  const [fontsLoaded, fontError] = useFonts({
    AtkinsonHyperlegible_400Regular,
    AtkinsonHyperlegible_700Bold,
  });
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        {fontsLoaded || fontError ? (
          <Home>{children}</Home>
        ) : (
          <View className="flex-1 bg-background" />
        )}
        <StatusBar style="auto" />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
const run = <A,>(effect: Effect.Effect<A, Error, AlarmService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(androidAlarmService)));

const currentTime = () => Date.now();
function Home({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [onboarding, setOnboarding] = useState(() => !native.isOnboardingComplete());

  const [controller] = useState(() => alarmController(repository));
  const client = useQueryClient();

  const alarmsQuery = useQuery({
    queryKey: ["alarms"],
    queryFn: () => Effect.runPromise(controller.list),
  });
  const alarms = alarmsQuery.data ?? [];
  const { locale, setLocale, confirmedSettings: confirmedList, confirmSetting } = useUI();
  const confirmedSettings = new Set(confirmedList);
  const [ring, setRing] = useState<Ring | null>(null);
  const [awakeCheck, setAwakeCheck] = useState<AwakeCheck | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void initializeTheme().catch(() => setError(copy(locale)("error")));
  }, [locale]);
  const [permissions, setPermissions] = useState(() => native.getPermissions());
  const t = copy(locale);
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
          setRing(active.ring);
          setAwakeCheck(active.awakeCheck);
          // An alarm folded into the ring can raise its N.
          void client.invalidateQueries({ queryKey: ["alarmSession"] });
        })
        .catch(() => setError(copy(locale)("alarmError")));
    };
    refresh();
    const subscription = native.addListener("onChange", refresh);
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      refresh();
      appSync?.syncNow();
    });
    // A pull that changed alarms re-arms them, as a local save does.
    const synced = appSync?.onSynced(({ changed }) => {
      if (changed.includes("alarms")) refresh();
    });
    return () => {
      subscription.remove();
      appState.remove();
      synced?.();
    };
  }, [controller, locale, client]);
  useEffect(() => {
    // On open: resume the stored session and sync.
    void appSync?.start();
  }, []);
  const [refreshing, setRefreshing] = useState(false);
  const pullToRefresh = useCallback(() => {
    setRefreshing(true);
    appSync?.syncNow();
    void client.invalidateQueries({ queryKey: ["alarms"] }).finally(() => setRefreshing(false));
  }, [client]);
  const save = useCallback(
    (alarm: Alarm, onSuccess?: () => void) => {
      void run(controller.save(alarm))
        .then(() => {
          void client.invalidateQueries({ queryKey: ["alarms"] });
          setError("");
          onSuccess?.();
        })
        .catch(() => setError(copy(locale)("alarmError")));
    },
    [controller, locale, client],
  );
  const remove = useCallback(
    (alarmId: string, onSuccess?: () => void) => {
      void run(controller.remove(alarmId))
        .then(() => {
          void client.invalidateQueries({ queryKey: ["alarms"] });
          setError("");
          onSuccess?.();
        })
        .catch(() => setError(copy(locale)("alarmError")));
    },
    [controller, locale, client],
  );
  // After each alarm session and awake check: its reviews reach the other devices.
  const afterAlarm = () => {
    void run(controller.resume)
      .then((next) => {
        setRing(next.ring);
        setAwakeCheck(next.awakeCheck);
        // After each alarm session or awake check: its reviews reach the other devices, and
        // AnkiDroid when auto sync back is on. A failed sync back retries after the next one.
        appSync?.syncNow();
        void Effect.runPromise(syncBackAfterSession(androidAnkiDroid)).catch(() => {});
      })
      .catch(() => setError(t("alarmError")));
  };
  const reliability = (onExit: () => void, setup = false) => (
    <ReliabilityScreen
      permissions={permissions}
      onboarding={setup}
      locale={locale}
      layer={androidAlarmService}
      confirmed={confirmedSettings}
      onConfirm={confirmSetting}
      refresh={() => setPermissions(native.getPermissions())}
      onExit={onExit}
      switchLanguage={() => setLocale(locale === "en" ? "pt-BR" : "en")}
    />
  );
  const [use24Hour, setUse24Hour] = useState(() => native.is24HourFormat());
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setUse24Hour(native.is24HourFormat());
    });
    return () => subscription.remove();
  }, []);
  const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const takeover = ring ? (
    <ScopedTheme theme="dark">
      <AlarmScreen
        key={ring.id}
        ring={ring}
        locale={locale}
        zone={zone}
        use24Hour={use24Hour}
        layer={androidAlarmService}
        onDismissed={afterAlarm}
      />
    </ScopedTheme>
  ) : awakeCheck?.shownAt ? (
    <ScopedTheme theme="dark">
      <AwakeCheckScreen
        key={awakeCheck.id}
        check={awakeCheck}
        locale={locale}
        zone={zone}
        use24Hour={use24Hour}
        layer={androidAlarmService}
        onPassed={afterAlarm}
      />
    </ScopedTheme>
  ) : null;

  const collectionQuery = useQuery({
    queryKey: ["collection"],
    queryFn: () => Effect.runPromise(localData((data) => data.collection)),
  });
  const alarmsContent = (
    <HomeScreen
      alarms={alarms}
      decks={(collectionQuery.data?.decks ?? []).map((deck) => ({
        id: deck.id,
        name: deck.fields.name.value,
      }))}
      locale={locale}
      zone={zone}
      use24Hour={use24Hour}
      onEdit={(alarm) => router.push({ pathname: "/alarm/[id]", params: { id: alarm.id } })}
      onAdd={() => router.push({ pathname: "/alarm/[id]", params: { id: "new" } })}
      onToggle={save}
      refreshing={refreshing}
      onRefresh={pullToRefresh}
      error={
        error ||
        (alarmsQuery.isError ? t("alarmError") : collectionQuery.isError ? t("loadError") : "")
      }
      banner={
        !reliabilityChecklist(permissions, confirmedSettings).ready ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/settings/reliability")}
            className="min-h-12 flex-row items-center justify-between gap-4 rounded-lg bg-surface p-4"
          >
            <Text className="shrink text-body text-attention">
              {reliabilityCopy(locale)("atRisk")}
            </Text>
            <Text className="text-body font-bold text-primary-ink">
              {reliabilityCopy(locale)("fix")}
            </Text>
          </Pressable>
        ) : null
      }
    />
  );
  const editor = (id: string) => (
    <LegacyEditorRoute id={id} alarms={alarms} locale={locale} onSave={save} onDelete={remove} />
  );

  return (
    <NavigationGate takeover={takeover}>
      {onboarding ? (
        reliability(() => setOnboarding(false), true)
      ) : (
        <RuntimeProvider
          alarms={alarmsContent}
          editor={editor}
          reliability={(onExit) => reliability(onExit)}
        >
          {children}
        </RuntimeProvider>
      )}
    </NavigationGate>
  );
}
/** Existing editor adapter until #76 replaces the screen; Home only pushes routes. */
function LegacyEditorRoute({
  id,
  alarms,
  locale,
  onSave,
  onDelete,
}: {
  id: string;
  alarms: readonly Alarm[];
  locale: Locale;
  onSave: (alarm: Alarm, onSuccess?: () => void) => void;
  onDelete: (id: string, onSuccess?: () => void) => void;
}) {
  const router = useRouter();
  const [draft] = useState(() => newAlarm(native.createId()));
  const alarm = id === "new" ? draft : alarms.find((item) => item.id === id);
  if (!alarm) return <Text className="text-body text-foreground">{copy(locale)("loading")}</Text>;
  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 24 }}>
      <AlarmEditor
        key={alarm.id}
        alarm={alarm}
        locale={locale}
        saved={id !== "new"}
        onCancel={() => router.back()}
        onSave={(value) => onSave(value, () => router.back())}
        onDelete={(value) => onDelete(value, () => router.back())}
      />
    </ScrollView>
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
  saved,
  onDelete,
}: {
  alarm: Alarm;
  locale: Locale;
  onSave: (alarm: Alarm) => void;
  onCancel: () => void;
  /** A saved alarm can be deleted; a new one only cancelled. */
  saved: boolean;
  onDelete: (alarmId: string) => void;
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
      <AlarmSnoozeSettings alarm={options} locale={locale} onChange={setOptions} />
      <AlarmAwakeCheckSettings alarm={options} locale={locale} onChange={setOptions} />
      <AlarmReadAloudSettings alarm={options} locale={locale} onChange={setOptions} />
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
      {saved ? (
        <Pressable
          accessibilityRole="button"
          className="min-h-12 justify-center"
          onPress={() =>
            Alert.alert(t("deleteAlarmTitle"), t("deleteAlarmBody"), [
              { text: t("cancel"), style: "cancel" },
              { text: t("deleteAlarm"), style: "destructive", onPress: () => onDelete(alarm.id) },
            ])
          }
        >
          <Text className="text-body text-attention">{t("deleteAlarm")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
