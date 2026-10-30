import {
  onceRule,
  ringsIn,
  timeLeft,
  upcomingRing,
  type Alarm,
  type AlarmRule,
  type Locale,
} from "@app/core";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useState, type ReactNode } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, ToastAndroid, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { clockText, repeatSummary, ringsInText } from "./alarm-text.ts";
import { Button } from "./controls.tsx";
import { copy } from "./copy.ts";
import { bold, regular } from "./fonts.ts";
import { RepeatSheet } from "./RepeatSheet.tsx";
import { Sheet } from "./Sheet.tsx";
import { HomeClock } from "./HomeScreen.tsx";

const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
/** A wall time as an instant in UTC, which HomeClock shows with zone "UTC". */
const utcTime = (hour: number, minute: number) => Date.UTC(2000, 0, 1, hour, minute);

/**
 * The rule the editor saves. No days and no date rings once, at the time's next occurrence. Null
 * when it would never ring (a date that has passed).
 */
function savedRule(rule: AlarmRule, now: number, zone: string): AlarmRule | null {
  const { hour, minute, onceDate, repeatDays = [] } = rule;
  const next = onceDate
    ? { hour, minute, onceDate }
    : repeatDays.length
      ? { hour, minute, repeatDays }
      : onceRule(hour, minute, now, zone);
  return ringsIn(next, now, zone) ? next : null;
}

/**
 * The alarm editor, a screen of its own: the time large at the top, rows that open sheets, Save
 * pinned at the bottom and Delete in the "⋯" menu. Leaving without Save discards the changes.
 * `options` draws the alarm's other settings under the rows.
 */
export function AlarmEditorScreen({
  alarm,
  saved,
  locale,
  hour24,
  onSave,
  onDelete,
  onClose,
  options,
  now = Date.now,
  zone = deviceZone(),
}: {
  alarm: Alarm;
  /** A saved alarm can be deleted; a new one only left. */
  saved: boolean;
  locale: Locale;
  /** The phone's 12/24 h setting. */
  hour24: boolean;
  onSave: (alarm: Alarm) => Promise<void>;
  onDelete: (alarmId: string) => Promise<void>;
  onClose: () => void;
  options?: (alarm: Alarm, onChange: (alarm: Alarm) => void) => ReactNode;
  now?: () => number;
  zone?: string;
}) {
  const t = copy(locale);
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(alarm);
  const [sheet, setSheet] = useState<"repeat" | "label" | "menu" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { rule } = draft;
  const time = clockText(rule.hour, rule.minute, hour24, locale);
  const pickTime = () =>
    DateTimePickerAndroid.open({
      mode: "time",
      // No is24Hour: the dialog follows the phone's setting.
      value: new Date(2000, 0, 1, rule.hour, rule.minute),
      onValueChange: (_event, date) =>
        setDraft((current) => ({
          ...current,
          rule: { ...current.rule, hour: date.getHours(), minute: date.getMinutes() },
        })),
    });
  const save = () => {
    const at = now();
    const next = savedRule(rule, at, zone);
    if (!draft.deckId) return setError(t("chooseDeck"));
    if (!next) return setError(t("datePassed"));
    const savedAlarm = { ...draft, enabled: true, rule: next };
    const left = timeLeft(upcomingRing(savedAlarm, at, zone)! - at);
    setBusy(true);
    // Saving turns the alarm on, so the notice is true.
    onSave(savedAlarm).then(
      () => {
        ToastAndroid.show(ringsInText(left, locale), ToastAndroid.SHORT);
        onClose();
      },
      () => {
        setBusy(false);
        setError(t("alarmError"));
      },
    );
  };
  const confirmDelete = () => {
    setSheet(null);
    Alert.alert(t("deleteAlarmTitle"), t("deleteAlarmBody"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("deleteAlarm"),
        style: "destructive",
        onPress: () => {
          setBusy(true);
          onDelete(alarm.id).then(onClose, () => {
            setBusy(false);
            setError(t("alarmError"));
          });
        },
      },
    ]);
  };
  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className="min-h-14 flex-row items-center justify-between gap-2 px-2">
        <HeaderButton label={t("back")} onPress={onClose}>
          {t("back")}
        </HeaderButton>
        <Text accessibilityRole="header" style={bold} className="shrink text-body text-foreground">
          {t(saved ? "editAlarm" : "add")}
        </Text>
        {saved ? (
          <HeaderButton label={t("moreOptions")} onPress={() => setSheet("menu")}>
            ⋯
          </HeaderButton>
        ) : (
          <View className="min-w-12" />
        )}
      </View>
      <ScrollView className="flex-1" contentContainerClassName="gap-6 px-6 pb-6">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t("time")}, ${time}`}
          onPress={pickTime}
          className="items-center py-4"
        >
          {/* Home's clock, which fits the width at large font scales. */}
          <HomeClock
            now={utcTime(rule.hour, rule.minute)}
            locale={locale}
            zone="UTC"
            use24Hour={hour24}
          />
        </Pressable>
        <View className="rounded-lg bg-surface">
          <EditorRow
            label={t("repeat")}
            value={repeatSummary(rule, { locale, now: now(), zone })}
            onPress={() => setSheet("repeat")}
          />
          <View className="mx-4 h-px bg-border" />
          <EditorRow
            label={t("label")}
            value={draft.label || t("noLabel")}
            onPress={() => setSheet("label")}
          />
        </View>
        {options?.(draft, setDraft)}
      </ScrollView>
      <View className="gap-2 border-t border-border px-6 pt-4 pb-4">
        {error ? (
          <Text accessibilityRole="alert" style={regular} className="text-body text-destructive">
            {error}
          </Text>
        ) : null}
        <Button label={t(busy ? "saving" : "save")} primary disabled={busy} onPress={save} />
      </View>
      <RepeatSheet
        repeat={rule}
        visible={sheet === "repeat"}
        locale={locale}
        now={now}
        zone={zone}
        onChange={(repeat) =>
          setDraft((current) => ({
            ...current,
            rule: { hour: current.rule.hour, minute: current.rule.minute, ...repeat },
          }))
        }
        onClose={() => setSheet(null)}
      />
      <Sheet
        title={t("label")}
        visible={sheet === "label"}
        locale={locale}
        onClose={() => setSheet(null)}
      >
        <TextInput
          accessibilityLabel={t("label")}
          placeholder={t("noLabel")}
          value={draft.label}
          onChangeText={(label) => setDraft((current) => ({ ...current, label }))}
          autoFocus
          style={regular}
          className="min-h-12 rounded-lg border border-border bg-surface p-4 text-body text-foreground"
        />
      </Sheet>
      <Sheet
        title={t("moreOptions")}
        visible={sheet === "menu"}
        locale={locale}
        onClose={() => setSheet(null)}
      >
        <Button label={t("deleteAlarm")} destructive disabled={busy} onPress={confirmDelete} />
      </Sheet>
    </View>
  );
}

/** "Name — current value ›": opens the sheet that sets it. */
function EditorRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      onPress={onPress}
      className="min-h-16 flex-row items-center justify-between gap-4 px-4 py-3"
    >
      <Text style={regular} className="text-body text-foreground">
        {label}
      </Text>
      <Text style={regular} className="shrink text-right text-body text-muted-foreground">
        {value} ›
      </Text>
    </Pressable>
  );
}

function HeaderButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="min-h-12 min-w-12 items-center justify-center px-2"
    >
      <Text style={bold} className="text-body text-primary-ink">
        {children}
      </Text>
    </Pressable>
  );
}
