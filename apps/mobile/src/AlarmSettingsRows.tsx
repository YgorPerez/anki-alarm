import { MAX_NEED, parseAlarmSound, type Alarm, type Locale } from "@app/core";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AlarmDeckSettings, useAlarmDecks } from "./AlarmDeckSettings.tsx";
import { AlarmSoundSettings, AlarmVibrationSettings } from "./AlarmSoundSettings.tsx";
import { AlarmSnoozeSettings } from "./AlarmSnoozeSettings.tsx";
import { AlarmAwakeCheckSettings } from "./AlarmAwakeCheckSettings.tsx";
import { AlarmReadAloudSettings } from "./AlarmReadAloudSettings.tsx";
import { EditorRow } from "./AlarmEditorScreen.tsx";
import { Sheet } from "./Sheet.tsx";
import { StepperControl } from "./controls.tsx";
import { copy } from "./copy.ts";
import { bold, regular } from "./fonts.ts";

/** Settings edit the route's draft; closing a sheet keeps its changes until Save. */
export function AlarmSettingsRows({
  alarm,
  locale,
  onChange,
}: {
  alarm: Alarm;
  locale: Locale;
  onChange: (alarm: Alarm) => void;
}) {
  const decks = useAlarmDecks(locale);
  const [open, setOpen] = useState<string | null>(null);
  const deck = decks.data?.find((item) => item.id === alarm.deckId);
  const t = copy(locale);
  const deckName = deck?.name ?? t("chooseDeck");
  const rows = settingsRows(alarm, locale);
  const sheets = [{ id: "deck", label: t("alarmDeck"), Controls: AlarmDeckSettings }, ...rows];
  const selected = sheets.find((sheet) => sheet.id === open);
  const Controls = selected?.Controls;
  return (
    <>
      <View className="rounded-lg bg-surface">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t("cardsFrom")}, ${deckName}`}
          onPress={() => setOpen("deck")}
          className="min-h-16 justify-center px-4 py-3"
        >
          <Text style={regular} className="text-label text-muted-foreground">
            {t("cardsFrom")}
          </Text>
          <Text numberOfLines={2} style={bold} className="text-body text-foreground">
            {deckName}
          </Text>
        </Pressable>
        <View className="mx-4 h-px bg-border" />
        <View className="min-h-16 flex-row items-center gap-3 px-4 py-2">
          <Text style={regular} className="min-w-0 flex-1 text-body text-foreground">
            {t("need")}
          </Text>
          <StepperControl
            value={alarm.need}
            text={String(alarm.need)}
            spoken={t("needCount", { count: String(alarm.need) })}
            min={1}
            max={MAX_NEED}
            fewer={t("fewer")}
            more={t("more")}
            onSurface
            onChange={(need) => onChange({ ...alarm, need })}
          />
        </View>
      </View>
      <View className="rounded-lg bg-surface">
        {rows.map((row, index) => (
          <View key={row.id}>
            {index > 0 && <View className="mx-4 h-px bg-border" />}
            <EditorRow
              label={row.label}
              value={row.value}
              onPress={() => setOpen(row.id)}
              toggle={
                row.toggle && {
                  value: alarm[row.toggle],
                  onChange: (value) => onChange({ ...alarm, [row.toggle]: value }),
                }
              }
            />
          </View>
        ))}
      </View>
      <Sheet
        title={selected?.label ?? ""}
        visible={!!selected}
        locale={locale}
        onClose={() => setOpen(null)}
      >
        {Controls && <Controls alarm={alarm} locale={locale} onChange={onChange} />}
      </Sheet>
    </>
  );
}

function settingsRows(alarm: Alarm, locale: Locale) {
  const t = copy(locale);
  const sound = parseAlarmSound(alarm.sound);
  const soundName =
    sound.kind === "bundled"
      ? t(sound.id)
      : sound.kind === "default"
        ? t("defaultSound")
        : sound.title || t(sound.kind === "file" ? "audioFile" : "ringtone");
  const minutes = (count: number) => t("minutes", { count: String(count) });
  return [
    {
      id: "sound",
      label: t("sound"),
      value: [
        soundName,
        alarm.rampSeconds ? t("seconds", { count: String(alarm.rampSeconds) }) : t("noRamp"),
      ].join(" · "),
      Controls: AlarmSoundSettings,
      toggle: undefined,
    },
    {
      id: "vibration",
      label: t("vibration"),
      value: t(alarm.vibrate ? "vibrationOn" : "vibrationOff"),
      Controls: AlarmVibrationSettings,
      toggle: "vibrate" as const,
    },
    {
      id: "snooze",
      label: t("snooze"),
      value: alarm.snooze
        ? `${minutes(alarm.snoozeMinutes)} · ${t(alarm.snoozeCap === 1 ? "snoozeCountOne" : "snoozeCount", { count: String(alarm.snoozeCap) })}`
        : t("disabled"),
      Controls: AlarmSnoozeSettings,
      toggle: "snooze" as const,
    },
    {
      id: "awake",
      label: t("awakeCheck"),
      value: alarm.awakeCheck ? minutes(alarm.awakeCheckMinutes) : t("disabled"),
      Controls: AlarmAwakeCheckSettings,
      toggle: "awakeCheck" as const,
    },
    {
      id: "read",
      label: t("readAloud"),
      value: t(alarm.readAloud ? "enabled" : "disabled"),
      Controls: AlarmReadAloudSettings,
      toggle: "readAloud" as const,
    },
  ];
}
