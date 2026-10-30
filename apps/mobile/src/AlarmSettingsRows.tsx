import { parseAlarmSound, type Alarm, type Locale } from "@app/core";
import { useState } from "react";
import { View } from "react-native";
import { AlarmDeckSettings, useAlarmDecks } from "./AlarmDeckSettings.tsx";
import { AlarmSoundSettings } from "./AlarmSoundSettings.tsx";
import { AlarmSnoozeSettings } from "./AlarmSnoozeSettings.tsx";
import { AlarmAwakeCheckSettings } from "./AlarmAwakeCheckSettings.tsx";
import { AlarmReadAloudSettings } from "./AlarmReadAloudSettings.tsx";
import { EditorRow } from "./AlarmEditorScreen.tsx";
import { Sheet } from "./Sheet.tsx";
import { copy } from "./copy.ts";

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
  const t = copy(locale);
  const decks = useAlarmDecks(locale);
  const [open, setOpen] = useState<string | null>(null);
  const deck = decks.data?.find((item) => item.id === alarm.deckId);
  const rows = settingsRows(alarm, locale, deck?.name);
  const selected = rows.find((row) => row.id === open);
  const Controls = selected?.Controls;
  return (
    <>
      <View className="rounded-lg bg-surface">
        {rows.map((row, index) => (
          <View key={row.id}>
            {index > 0 && <View className="mx-4 h-px bg-border" />}
            <EditorRow label={row.label} value={row.value} onPress={() => setOpen(row.id)} />
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

function settingsRows(alarm: Alarm, locale: Locale, deckName?: string) {
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
      id: "cards",
      label: t("editorCards"),
      value: `${deckName ?? t("chooseDeck")} · ${t("needCount", { count: String(alarm.need) })}`,
      Controls: AlarmDeckSettings,
    },
    {
      id: "sound",
      label: t("sound"),
      value: [
        soundName,
        alarm.rampSeconds ? t("seconds", { count: String(alarm.rampSeconds) }) : t("noRamp"),
        ...(alarm.vibrate ? [t("vibration")] : []),
      ].join(" · "),
      Controls: AlarmSoundSettings,
    },
    {
      id: "snooze",
      label: t("snooze"),
      value: alarm.snooze
        ? `${minutes(alarm.snoozeMinutes)} · ${t(alarm.snoozeCap === 1 ? "snoozeCountOne" : "snoozeCount", { count: String(alarm.snoozeCap) })}`
        : t("disabled"),
      Controls: AlarmSnoozeSettings,
    },
    {
      id: "awake",
      label: t("awakeCheck"),
      value: alarm.awakeCheck ? minutes(alarm.awakeCheckMinutes) : t("disabled"),
      Controls: AlarmAwakeCheckSettings,
    },
    {
      id: "read",
      label: t("readAloud"),
      value: t(alarm.readAloud ? "enabled" : "disabled"),
      Controls: AlarmReadAloudSettings,
    },
  ];
}
