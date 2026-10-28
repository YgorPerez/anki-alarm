import { UpdateOffer } from "./UpdateOffer.tsx";
import { nextRing, type Alarm, type Locale } from "@app/core";
import {
  AtkinsonHyperlegible_400Regular,
  AtkinsonHyperlegible_700Bold,
  useFonts,
} from "@expo-google-fonts/atkinson-hyperlegible";
import { CollectionScreen } from "./CollectionScreen.tsx";
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
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { copy } from "./copy.ts";
import { ThemeSettings } from "./ThemeSettings.tsx";
import { ScopedTheme } from "uniwind";
import { AlarmService, alarmController, type Ring } from "./alarms.ts";
import { androidAlarmService, native } from "./alarm-android.ts";
import { sqliteAlarmRepository } from "./alarm-storage.ts";

export function App() {
  const [fontsLoaded, fontError] = useFonts({
    AtkinsonHyperlegible_400Regular,
    AtkinsonHyperlegible_700Bold,
  });
  return (
    <SafeAreaProvider>
      {fontsLoaded || fontError ? <Home /> : <View className="flex-1 bg-background" />}
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
const run = <A,>(effect: Effect.Effect<A, Error, AlarmService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(androidAlarmService)));

const currentTime = () => Date.now();
function Home() {
  const [showDecks, setShowDecks] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [controller] = useState(() => alarmController(sqliteAlarmRepository()));
  const [locale, setLocale] = useState<Locale>("pt-BR");
  const [alarms, setAlarms] = useState(() => controller.list());
  const [ring, setRing] = useState<Ring | null>(null);
  const [editing, setEditing] = useState<Alarm | null>(null);
  const [error, setError] = useState("");
  const [permissions, setPermissions] = useState(() => native.getPermissions());
  const t = copy(locale);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    // Theme settings can replace these factory dark colors through the same service API.
    void run(
      Effect.flatMap(AlarmService, (service) =>
        service.setAppearance(
          { background: "#000000", foreground: "#ffffff", primary: "#c9b6ff" },
          locale,
        ),
      ),
    ).catch(() => setError(copy(locale)("alarmError")));
  }, [locale]);
  useEffect(() => {
    const refresh = () => {
      setPermissions(native.getPermissions());
      void Effect.runPromise(controller.resume.pipe(Effect.provide(androidAlarmService)))
        .then(setRing)
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
  }, [controller, locale]);
  useEffect(() => {
    if (!themeOpen || ring) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setThemeOpen(false);
      return true;
    });
    return () => subscription.remove();
  }, [themeOpen, ring]);
  const save = useCallback(
    (alarm: Alarm) => {
      void run(controller.save(alarm))
        .then(() => {
          setAlarms(controller.list());
          setEditing(null);
          setError("");
        })
        .catch(() => setError(copy(locale)("alarmError")));
    },
    [controller, locale],
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
        <View
          className="flex-1 justify-center gap-6 bg-background p-6"
          style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
        >
          <Text className="text-clock font-bold text-foreground">
            {new Date(ring.startedAt).toLocaleTimeString(locale, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
          <Text className="text-question text-foreground">{ring.alarm.label}</Text>
          <Pressable
            accessibilityRole="button"
            className="rounded-pill bg-primary p-6"
            onPress={() => {
              void run(Effect.flatMap(AlarmService, (service) => service.dismiss(ring.id)))
                .then(() => run(controller.resume))
                .then(setRing)
                .catch(() => setError(t("alarmError")));
            }}
          >
            <Text className="text-body text-primary-foreground">{t("dismiss")}</Text>
          </Pressable>
          <Text className="text-body text-foreground">{error}</Text>
        </View>
      </ScopedTheme>
    );
  if (themeOpen) return <ThemeSettings locale={locale} onBack={() => setThemeOpen(false)} />;
  if (showDecks) return <CollectionScreen locale={locale} onExit={() => setShowDecks(false)} />;
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
            <Pressable accessibilityRole="button" onPress={() => setThemeOpen(true)}>
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
                  onPress={() =>
                    setEditing({
                      id: native.createId(),
                      label: "",
                      enabled: true,
                      rule: { hour: 7, minute: 0, repeatDays: [1, 2, 3, 4, 5] },
                      vibrate: true,
                      rampSeconds: 30,
                      sound: null,
                    })
                  }
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
              {error}
            </Text>
            <Text className="text-body text-foreground">{t("permission")}</Text>
            {(["notifications", "exactAlarm", "fullScreenIntent", "overlay", "battery"] as const)
              .filter((kind) => !permissions[kind])
              .map((kind) => (
                <Pressable
                  key={kind}
                  accessibilityRole="button"
                  onPress={() => native.request(kind)}
                >
                  <Text className="text-body text-primary">{t(kind)}</Text>
                </Pressable>
              ))}
            <Text className="text-label text-muted-foreground">{t("forceStop")}</Text>
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
      <Text accessibilityRole="alert" className="text-body text-attention">
        {error}
      </Text>
      <Pressable
        accessibilityRole="button"
        className="rounded-pill bg-primary p-4"
        onPress={() => {
          try {
            if (
              !/^\d{2}:\d{2}$/.test(time) ||
              (date &&
                (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
                  new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date))
            )
              throw new Error("Invalid date");
            const [hour, minute] = time.split(":").map(Number);
            const rule = {
              hour: hour!,
              minute: minute!,
              ...(date ? { onceDate: date } : { repeatDays: days }),
            };
            if (
              nextRing(rule, currentTime(), Intl.DateTimeFormat().resolvedOptions().timeZone) ===
              null
            )
              throw new Error("No next ring");
            onSave({ ...alarm, label, rule });
          } catch {
            setError(t("invalid"));
          }
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
