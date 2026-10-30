import {
  savedRule,
  skipNextRing,
  skipOffer,
  undoSkip,
  timeLeft,
  upcomingRing,
  type Alarm,
  type Locale,
} from "@app/core";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Alert,
  BackHandler,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  ToastAndroid,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { clockText, repeatSummary, ringsInText } from "./alarm-text.ts";
import { Button } from "./controls.tsx";
import { copy } from "./copy.ts";
import { regular } from "./fonts.ts";
import { RepeatSheet } from "./RepeatSheet.tsx";
import { Sheet } from "./Sheet.tsx";
import { Clock } from "./clock.tsx";

const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
/** A wall time as an instant in UTC, which Clock shows with zone "UTC". */
const utcTime = (hour: number, minute: number) => Date.UTC(2000, 0, 1, hour, minute);

/**
 * The alarm editor, a screen of its own: the time large at the top, rows that open sheets, Save
 * and Cancel pinned at the bottom. Leaving asks before discarding unsaved changes.
 * `options` draws the alarm's other settings under the rows.
 */
export function AlarmEditorScreen({
  alarm,
  saved,
  locale,
  hour24,
  onSave,
  onDelete,
  onDuplicate,
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
  onDuplicate?: (alarm: Alarm) => void;
  onClose: () => void;
  options?: (alarm: Alarm, onChange: (alarm: Alarm) => void) => ReactNode;
  now?: () => number;
  zone?: string;
}) {
  const t = copy(locale);
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(alarm);
  const [sheet, setSheet] = useState<"repeat" | "label" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Compare values rather than object identity: sheets may return the original values in a new object.
  const dirty = JSON.stringify(draft, sortedKeys) !== JSON.stringify(alarm, sortedKeys);
  const leave = useCallback(() => {
    if (busy) return;
    if (!dirty) return onClose();
    Alert.alert(t("discardTitle"), t("discardBody"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("discard"), style: "destructive", onPress: onClose },
    ]);
  }, [busy, dirty, onClose, t]);
  useEffect(() => {
    const handler = BackHandler.addEventListener("hardwareBackPress", () => {
      // Native Modal consumes Back first; keep the same priority in screen tests.
      if (sheet) setSheet(null);
      else leave();
      return true;
    });
    return () => handler.remove();
  }, [sheet, leave]);
  const offer = skipOffer(draft, now(), zone);
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
      <ScrollView className="flex-1" contentContainerClassName="gap-6 px-6 pb-6">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t("time")}, ${time}`}
          onPress={pickTime}
          className="items-center py-4"
        >
          {/* Home's clock, which fits the width at large font scales. */}
          <Clock
            at={utcTime(rule.hour, rule.minute)}
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
        {saved && (
          <View className="gap-3">
            <Button
              label={t(offer === "undo" ? "undoSkip" : "skipNext")}
              disabled={busy || offer === null}
              onPress={() =>
                setDraft(offer === "undo" ? undoSkip(draft) : skipNextRing(draft, now(), zone))
              }
            />
            <Button
              label={t("duplicateAlarm")}
              disabled={busy || !onDuplicate}
              onPress={() => onDuplicate?.(draft)}
            />
            <Button label={t("deleteAlarm")} destructive disabled={busy} onPress={confirmDelete} />
          </View>
        )}
      </ScrollView>
      <View className="gap-2 border-t border-border px-6 pt-4 pb-4">
        {error ? (
          <Text accessibilityRole="alert" style={regular} className="text-body text-attention">
            {error}
          </Text>
        ) : null}
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Button label={t("cancel")} disabled={busy} onPress={leave} />
          </View>
          <View className="flex-1">
            <Button label={t(busy ? "saving" : "save")} primary disabled={busy} onPress={save} />
          </View>
        </View>
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
    </View>
  );
}

/** "Name — current value ›": opens the sheet that sets it. */
export function EditorRow({
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
      <Text style={regular} className="shrink text-body text-foreground">
        {label}
      </Text>
      <Text style={regular} className="shrink text-right text-body text-muted-foreground">
        {value} ›
      </Text>
    </Pressable>
  );
}

/** Stable property order for the editor's plain-data draft, including nested rule and sound. */
function sortedKeys(key: string, value: unknown): unknown {
  if (key === "repeatDays" && Array.isArray(value))
    return value.toSorted((a, b) => Number(a) - Number(b));
  if (value && typeof value === "object" && !Array.isArray(value))
    return Object.fromEntries(Object.entries(value).toSorted(([a], [b]) => a.localeCompare(b)));
  return value;
}
