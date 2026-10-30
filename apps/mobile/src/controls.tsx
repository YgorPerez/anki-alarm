import Minus from "lucide-react-native/icons/minus";
import Plus from "lucide-react-native/icons/plus";
import { ThemedIcon } from "./icons.tsx";
import { Pressable, Text, TextInput, View } from "react-native";
import type { Locale } from "@app/core";
import { copy } from "./copy.ts";
import { regular } from "./fonts.ts";

export function Button({
  label,
  onPress,
  primary = false,
  destructive = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={
        primary
          ? "min-h-12 justify-center rounded-pill bg-primary px-5 py-3 active:opacity-80 disabled:opacity-40"
          : "min-h-12 justify-center rounded-pill bg-surface px-5 py-3 active:opacity-80 disabled:opacity-40"
      }
    >
      <Text
        style={regular}
        className={
          destructive
            ? "text-body text-destructive"
            : primary
              ? "text-body text-primary-foreground"
              : "text-body text-foreground"
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A labelled text input. `error` is announced and shown under it. */
export function TextField({
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  multiline = false,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  hint?: string;
  multiline?: boolean;
  numeric?: boolean;
}) {
  return (
    <View className="gap-2">
      <Text style={regular} className="text-label text-muted-foreground">
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        value={value}
        onChangeText={onChange}
        onBlur={onBlur}
        multiline={multiline}
        keyboardType={numeric ? "numbers-and-punctuation" : "default"}
        textAlignVertical="top"
        style={regular}
        className={`min-h-12 rounded-lg border bg-surface p-4 text-body text-foreground ${error ? "border-destructive" : "border-border"}`}
      />
      {hint ? (
        <Text style={regular} className="text-label text-muted-foreground">
          {hint}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={regular} className="text-label text-destructive">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** One choice among a few, as a row of pills. */
export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <View className="gap-2" accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={regular} className="text-label text-muted-foreground">
        {label}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled }}
              accessibilityLabel={option.label}
              disabled={disabled}
              onPress={() => onChange(option.value)}
              className={`min-h-12 justify-center rounded-pill border px-4 py-2 active:opacity-80 ${selected ? "border-primary bg-primary" : "border-border bg-surface"}`}
            >
              <Text
                style={regular}
                className={`text-body ${selected ? "text-primary-foreground" : "text-foreground"}`}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A whole number between `min` and `max`, set with − and +. */
export function Stepper({
  label,
  value,
  text,
  min,
  max,
  fewer,
  more,
  onChange,
}: {
  label: string;
  value: number;
  /** The value as shown, e.g. "3 cards". */
  text: string;
  min: number;
  max: number;
  /** The − and + buttons' accessible names. */
  fewer: string;
  more: string;
  onChange: (value: number) => void;
}) {
  const step = (delta: number) => onChange(Math.min(max, Math.max(min, value + delta)));
  return (
    <>
      <Text className="text-body font-bold text-foreground">{label}</Text>
      <View className="flex-row items-center gap-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={fewer}
          disabled={value <= min}
          onPress={() => step(-1)}
          className="min-h-12 min-w-12 items-center justify-center rounded-pill bg-surface"
        >
          <ThemedIcon icon={Minus} />
        </Pressable>
        <Text className="text-body text-foreground">{text}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={more}
          disabled={value >= max}
          onPress={() => step(1)}
          className="min-h-12 min-w-12 items-center justify-center rounded-pill bg-surface"
        >
          <ThemedIcon icon={Plus} />
        </Pressable>
      </View>
    </>
  );
}

/** Save and Cancel at the end of a form. */
export function SaveButtons({
  locale,
  busy,
  disabled,
  onSave,
  onCancel,
}: {
  locale: Locale;
  busy: boolean;
  disabled: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = copy(locale);
  return (
    <>
      <Button
        label={t(busy ? "saving" : "save")}
        primary
        disabled={busy || disabled}
        onPress={onSave}
      />
      <Button label={t("cancel")} disabled={busy} onPress={onCancel} />
    </>
  );
}
