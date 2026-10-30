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
import Svg, { Path } from "react-native-svg";
import { repeatLine, ringsInText } from "./alarm-text.ts";
import { Button } from "./controls.tsx";
import { copy } from "./copy.ts";
import { regular } from "./fonts.ts";
import { DayLetters, RepeatSheet } from "./RepeatSheet.tsx";
import { TimeWheels } from "./TimeWheels.tsx";

const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
/**
 * The alarm editor, a screen of its own: the time large at the top, then the repeat summary, day
 * letters and name on the page, and Save and Cancel pinned at the bottom. Leaving asks before discarding unsaved changes.
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
  iconColor = "currentColor",
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
  /** The theme's color for the summary's calendar icon; SVG can't take a class name. */
  iconColor?: string;
  now?: () => number;
  zone?: string;
}) {
  const t = copy(locale);
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(alarm);
  const [repeatOpen, setRepeatOpen] = useState(false);
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
      if (repeatOpen) setRepeatOpen(false);
      else leave();
      return true;
    });
    return () => handler.remove();
  }, [repeatOpen, leave]);
  const offer = skipOffer(draft, now(), zone);
  const { rule } = draft;
  const setRepeat = (repeat: Pick<Alarm["rule"], "repeatDays" | "onceDate">) =>
    setDraft((current) => ({
      ...current,
      rule: { hour: current.rule.hour, minute: current.rule.minute, ...repeat },
    }));
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
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-6 pb-6"
        keyboardShouldPersistTaps="handled"
      >
        <TimeWheels
          hour={rule.hour}
          minute={rule.minute}
          locale={locale}
          hour24={hour24}
          onChange={(hour, minute) =>
            setDraft((current) =>
              current.rule.hour === hour && current.rule.minute === minute
                ? current
                : { ...current, rule: { ...current.rule, hour, minute } },
            )
          }
        />
        <View className="gap-3">
          <RepeatSummaryLine
            label={t("repeat")}
            summary={repeatLine(rule, { locale, now: now(), zone })}
            iconColor={iconColor}
            onPress={() => setRepeatOpen(true)}
          />
          <DayLetters repeat={rule} locale={locale} onChange={setRepeat} />
        </View>
        <TextInput
          accessibilityLabel={t("label")}
          placeholder={t("alarmNamePlaceholder")}
          placeholderTextColorClassName="accent-muted-foreground"
          value={draft.label}
          onChangeText={(label) => setDraft((current) => ({ ...current, label }))}
          style={regular}
          className="min-h-12 rounded-lg border border-border bg-surface p-4 text-body text-foreground"
        />
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
        visible={repeatOpen}
        locale={locale}
        now={now}
        zone={zone}
        onChange={setRepeat}
        onClose={() => setRepeatOpen(false)}
      />
    </View>
  );
}

/** How the alarm repeats, with a calendar icon: opens the presets and the one-off date. */
function RepeatSummaryLine({
  label,
  summary,
  iconColor,
  onPress,
}: {
  label: string;
  summary: string;
  iconColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${summary}`}
      onPress={onPress}
      className="min-h-12 flex-row items-center justify-between gap-4"
    >
      <Text style={regular} className="shrink text-body text-foreground">
        {summary}
      </Text>
      <Svg
        width={24}
        height={24}
        viewBox="0 0 24 24"
        fill="none"
        stroke={iconColor}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <Path d="M6 5h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3ZM3 10h18M8 3v4m8-4v4" />
      </Svg>
    </Pressable>
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
