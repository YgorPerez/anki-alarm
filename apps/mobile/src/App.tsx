import { HomeScreen } from "./HomeScreen.tsx";
import { AlarmSoundSettings } from "./AlarmSoundSettings.tsx";
import { AlarmDeckSettings, useAlarmDecks } from "./AlarmDeckSettings.tsx";
import { AlarmEditorScreen } from "./AlarmEditorScreen.tsx";
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
  newAlarmFor,
  quickAlarm,
  quickAlarmOptions,
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
import { AnkiDroidScreen } from "./AnkiDroidScreen.tsx";
import { pickAndImportApkg } from "./apkg.ts";
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
import { AppState, Pressable, Text, View, useColorScheme } from "react-native";
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
/** Links an AnkiDroid deck from Home's empty state; the new deck then shows on Home. */
export function AnkiDroidRoute() {
  const router = useRouter();
  return (
    <AnkiDroidScreen
      ankiDroid={androidAnkiDroid}
      locale={useUI().locale}
      onExit={() => router.back()}
      onOpen={() => router.back()}
    />
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
  const {
    locale,
    setLocale,
    confirmedSettings: confirmedList,
    confirmSetting,
    setLastSavedAlarm,
    lastSavedAlarm,
  } = useUI();
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
  // The editor shows its own failure; a toggle on Home shows it there.
  const save = useCallback(
    (alarm: Alarm) =>
      run(controller.save(alarm)).then(() => {
        void client.invalidateQueries({ queryKey: ["alarms"] });
        setError("");
      }),
    [controller, client],
  );
  const toggle = useCallback(
    (alarm: Alarm) => void save(alarm).catch(() => setError(copy(locale)("alarmError"))),
    [save, locale],
  );
  const remove = useCallback(
    (alarmId: string) =>
      run(controller.remove(alarmId)).then(() => {
        void client.invalidateQueries({ queryKey: ["alarms"] });
        setError("");
      }),
    [controller, client],
  );
  // After each alarm session and awake check: its reviews reach the other devices.
  const afterAlarm = () => {
    void run(controller.resume)
      .then((next) => {
        setRing(next.ring);
        setAwakeCheck(next.awakeCheck);
        // A dismissed quick alarm deleted itself.
        void client.invalidateQueries({ queryKey: ["alarms"] });
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
  const decks = (collectionQuery.data?.decks ?? []).map((deck) => ({
    id: deck.id,
    name: deck.fields.name.value,
  }));
  const quickOptions = quickAlarmOptions({
    alarms,
    lastSavedId: lastSavedAlarm,
    deckIds: decks.map((deck) => deck.id),
  });

  const alarmsContent = (
    <HomeScreen
      alarms={alarms}
      decks={decks}
      locale={locale}
      zone={zone}
      use24Hour={use24Hour}
      onQuickAlarm={
        quickOptions
          ? (minutes, onAdded) => {
              const alarm = quickAlarm(native.createId(), minutes, quickOptions, Date.now(), zone);
              void save(alarm)
                .then(() => onAdded(alarm))
                .catch(() => setError(t("alarmError")));
            }
          : undefined
      }
      onEdit={(alarm) => router.push({ pathname: "/alarm/[id]", params: { id: alarm.id } })}
      onAdd={() => router.push({ pathname: "/alarm/[id]", params: { id: "new" } })}
      onToggle={toggle}
      refreshing={refreshing}
      onRefresh={pullToRefresh}
      setup={
        alarmsQuery.data && collectionQuery.data
          ? {
              onImport: async () => {
                const summary = await pickAndImportApkg();
                await client.invalidateQueries({ queryKey: ["collection"] });
                return summary;
              },
              onLink: () => router.push("/ankidroid"),
            }
          : undefined
      }
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
  // The editor waits on the saved alarms: a new alarm starts with the last saved one's deck and N.
  const editor = (id: string) => (
    <EditorRoute
      id={id}
      alarms={alarmsQuery.isSuccess ? alarms : null}
      locale={locale}
      use24Hour={use24Hour}
      onSave={(alarm) => save(alarm).then(() => setLastSavedAlarm(alarm.id))}
      onDelete={remove}
    />
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
/** The editor route: a saved alarm by id, or "new" with Core's defaults. Leaving discards it. */
function EditorRoute({
  id,
  alarms,
  locale,
  use24Hour,
  onSave,
  onDelete,
}: {
  id: string;
  /** Null until they're read. */
  alarms: readonly Alarm[] | null;
  locale: Locale;
  use24Hour: boolean;
  onSave: (alarm: Alarm) => Promise<void>;
  onDelete: (alarmId: string) => Promise<void>;
}) {
  const router = useRouter();
  const [newId] = useState(() => native.createId());
  const lastSavedId = useUI((ui) => ui.lastSavedAlarm);
  const decks = useAlarmDecks(locale);
  const alarm =
    alarms === null
      ? undefined
      : id === "new"
        ? decks.data &&
          newAlarmFor(newId, { alarms, lastSavedId, deckIds: decks.data.map((deck) => deck.id) })
        : alarms.find((item) => item.id === id);
  if (!alarm)
    return (
      <View className="flex-1 bg-background p-6">
        <Text className="text-body text-foreground">{copy(locale)("loading")}</Text>
      </View>
    );
  const settings = (draft: Alarm, onChange: (alarm: Alarm) => void) => (
    <View className="gap-6">
      <AlarmDeckSettings alarm={draft} locale={locale} onChange={onChange} />
      <AlarmSoundSettings alarm={draft} locale={locale} onChange={onChange} />
      <AlarmSnoozeSettings alarm={draft} locale={locale} onChange={onChange} />
      <AlarmAwakeCheckSettings alarm={draft} locale={locale} onChange={onChange} />
      <AlarmReadAloudSettings alarm={draft} locale={locale} onChange={onChange} />
    </View>
  );
  return (
    <AlarmEditorScreen
      key={alarm.id}
      alarm={alarm}
      saved={id !== "new"}
      locale={locale}
      hour24={use24Hour}
      onSave={onSave}
      onDelete={onDelete}
      onClose={() => router.back()}
      options={settings}
    />
  );
}
