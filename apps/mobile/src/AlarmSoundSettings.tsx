import { BUNDLED_SOUNDS, RAMP_CHOICES, parseAlarmSound, type Alarm, type Locale } from "@app/core";
import { useEffect, useState } from "react";
import { AppState, Pressable, Switch, Text, View } from "react-native";
import { native } from "./alarm-android.ts";
import { copy } from "./copy.ts";

export function AlarmSoundSettings({
  alarm,
  locale,
  onChange,
}: {
  alarm: Alarm;
  locale: Locale;
  onChange: (alarm: Alarm) => void;
}) {
  const t = copy(locale);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") native.stopPreview();
    });
    return () => {
      listener.remove();
      native.stopPreview();
    };
  }, []);
  const sound = parseAlarmSound(alarm.sound);
  const pick = async (kind: "ringtone" | "file") => {
    setPicking(true);
    setError("");
    native.stopPreview();
    try {
      const result = await native.pickSound(kind, "uri" in sound ? sound.uri : null);
      if (result) onChange({ ...alarm, sound: parseAlarmSound(JSON.parse(result)) });
    } catch {
      setError(t("soundError"));
    } finally {
      setPicking(false);
    }
  };
  return (
    <View className="gap-4">
      <Text className="text-body font-bold text-foreground">{t("sound")}</Text>
      {[
        { kind: "default" } as const,
        ...BUNDLED_SOUNDS.map((id) => ({ kind: "bundled" as const, id })),
      ].map((choice) => {
        const selected =
          sound.kind === choice.kind &&
          (choice.kind !== "bundled" || (sound.kind === "bundled" && choice.id === sound.id));
        return (
          <Pressable
            key={choice.kind === "bundled" ? choice.id : choice.kind}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            className={
              selected
                ? "min-h-12 justify-center rounded-pill bg-primary-tint px-4"
                : "min-h-12 justify-center rounded-pill bg-surface px-4"
            }
            onPress={() => {
              native.stopPreview();
              onChange({ ...alarm, sound: choice });
            }}
          >
            <Text className="text-body text-foreground">
              {t(choice.kind === "bundled" ? choice.id : "defaultSound")}
            </Text>
          </Pressable>
        );
      })}
      {(["ringtone", "file"] as const).map((kind) => (
        <Pressable
          key={kind}
          accessibilityRole="button"
          disabled={picking}
          className="min-h-12 justify-center"
          onPress={() => {
            void pick(kind);
          }}
        >
          <Text className="text-body text-primary-ink">
            {t(kind === "file" ? "audioFile" : "ringtone")}
          </Text>
        </Pressable>
      ))}
      {"uri" in sound && (
        <Text className="text-body text-foreground">{sound.title || sound.uri}</Text>
      )}
      <Pressable
        accessibilityRole="button"
        className="min-h-12 justify-center"
        onPress={() => {
          try {
            native.previewSound(JSON.stringify(sound));
            setError("");
          } catch {
            setError(t("soundError"));
          }
        }}
      >
        <Text className="text-body text-primary-ink">{t("previewSound")}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        className="min-h-12 justify-center"
        onPress={() => native.stopPreview()}
      >
        <Text className="text-body text-foreground">{t("stopPreview")}</Text>
      </Pressable>
      <View className="flex-row items-center justify-between">
        <Text className="text-body text-foreground">{t("vibration")}</Text>
        <Switch
          accessibilityLabel={t("vibration")}
          value={alarm.vibrate}
          onValueChange={(vibrate) => onChange({ ...alarm, vibrate })}
        />
      </View>
      <Text className="text-body font-bold text-foreground">{t("ramp")}</Text>
      <View className="flex-row flex-wrap gap-2">
        {RAMP_CHOICES.map((rampSeconds) => (
          <Pressable
            key={rampSeconds}
            accessibilityRole="radio"
            accessibilityState={{ checked: alarm.rampSeconds === rampSeconds }}
            className={
              alarm.rampSeconds === rampSeconds
                ? "min-h-12 justify-center rounded-pill bg-primary-tint p-3"
                : "min-h-12 justify-center rounded-pill bg-surface p-3"
            }
            onPress={() => onChange({ ...alarm, rampSeconds })}
          >
            <Text className="text-body text-foreground">
              {rampSeconds === 0 ? t("noRamp") : t("seconds", { count: String(rampSeconds) })}
            </Text>
          </Pressable>
        ))}
      </View>
      {!!error && (
        <Text accessibilityRole="alert" className="text-body text-attention">
          {error}
        </Text>
      )}
    </View>
  );
}
