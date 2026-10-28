import {
  DEFAULT_FSRS_PARAMETERS,
  validOption,
  type Locale,
  type Preset,
  type PresetOptions,
} from "@app/core";
import { useForm } from "@tanstack/react-form";
import { Text, View } from "react-native";
import { Button, SaveButtons, TextField } from "./controls.tsx";
import { editingCopy } from "./editing-copy.ts";
import { regular } from "./fonts.ts";

// The text the user types, and what each option reads from it. undefined: not a valid value.
const integer = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined);
const decimal = (text: string) => {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() && Number.isFinite(value) ? value : undefined;
};
const list = (text: string, separator: RegExp) => {
  const parts = text.trim() ? text.trim().split(separator) : [];
  const values = parts.map(Number);
  return parts.every((p) => p !== "") && values.every(Number.isFinite) ? values : undefined;
};
const read = {
  name: (text: string) => text,
  newPerDay: integer,
  reviewsPerDay: integer,
  desiredRetention: decimal,
  learningSteps: (text: string) => list(text, /\s+/),
  fsrsParameters: (text: string) => list(text, /[\s,;]+/),
} satisfies { [K in keyof PresetOptions]: (text: string) => PresetOptions[K] | undefined };
type Texts = Record<keyof PresetOptions, string>;
const ok = <T,>(value: T | undefined, rule: (value: T) => boolean) =>
  value !== undefined && rule(value);
/** Core's rule for each option, applied to what the user typed. */
const valid: Record<keyof PresetOptions, (text: string) => boolean> = {
  name: (text) => validOption.name(text),
  newPerDay: (text) => ok(read.newPerDay(text), validOption.newPerDay),
  reviewsPerDay: (text) => ok(read.reviewsPerDay(text), validOption.reviewsPerDay),
  desiredRetention: (text) => ok(read.desiredRetention(text), validOption.desiredRetention),
  learningSteps: (text) => ok(read.learningSteps(text), validOption.learningSteps),
  fsrsParameters: (text) => ok(read.fsrsParameters(text), validOption.fsrsParameters),
};

/** Edits a preset: the daily limits and FSRS options its decks share. */
export function DeckOptionsEditor({
  preset,
  deckCount,
  locale,
  busy,
  onSave,
  onCancel,
}: {
  preset: Preset;
  deckCount: number;
  locale: Locale;
  busy: boolean;
  onSave: (options: PresetOptions) => void;
  onCancel: () => void;
}) {
  const t = editingCopy(locale);
  const f = preset.fields;
  const decimalText = (n: number) => (locale === "pt-BR" ? String(n).replace(".", ",") : String(n));
  const defaultValues: Texts = {
    name: f.name.value,
    newPerDay: String(f.newPerDay.value),
    reviewsPerDay: String(f.reviewsPerDay.value),
    desiredRetention: decimalText(f.desiredRetention.value),
    learningSteps: f.learningSteps.value.join(" "),
    fsrsParameters: f.fsrsParameters.value.join(", "),
  };
  const form = useForm({
    defaultValues,
    onSubmit: ({ value }) =>
      onSave({
        name: value.name.trim(),
        newPerDay: read.newPerDay(value.newPerDay)!,
        reviewsPerDay: read.reviewsPerDay(value.reviewsPerDay)!,
        desiredRetention: read.desiredRetention(value.desiredRetention)!,
        learningSteps: read.learningSteps(value.learningSteps)!,
        fsrsParameters: read.fsrsParameters(value.fsrsParameters)!,
      }),
  });
  const fields = [
    { key: "name", label: t("presetName"), error: t("invalidName") },
    { key: "newPerDay", label: t("newPerDay"), error: t("invalidLimit"), numeric: true },
    { key: "reviewsPerDay", label: t("reviewsPerDay"), error: t("invalidLimit"), numeric: true },
    {
      key: "desiredRetention",
      label: t("desiredRetention"),
      error: t("invalidRetention"),
      hint: t("desiredRetentionHint"),
      numeric: true,
    },
    {
      key: "learningSteps",
      label: t("learningSteps"),
      error: t("invalidSteps"),
      hint: t("learningStepsHint"),
      numeric: true,
    },
    {
      key: "fsrsParameters",
      label: t("fsrsParameters"),
      error: t("invalidParameters"),
      hint: t("fsrsParametersHint"),
      multiline: true,
    },
  ] as const;
  return (
    <View className="gap-6" pointerEvents={busy ? "none" : "auto"}>
      {deckCount > 1 && (
        <Text style={regular} className="text-body text-attention">
          {t("sharedPreset", { count: String(deckCount) })}
        </Text>
      )}
      {fields.map((spec) => (
        <form.Field
          key={spec.key}
          name={spec.key}
          validators={{
            onChange: ({ value }) => (valid[spec.key](value) ? undefined : spec.error),
          }}
        >
          {(field) => (
            <TextField
              label={spec.label}
              hint={"hint" in spec ? spec.hint : undefined}
              value={field.state.value}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
              error={field.state.meta.errors[0]}
              multiline={"multiline" in spec}
              numeric={"numeric" in spec}
            />
          )}
        </form.Field>
      ))}
      <Button
        label={t("defaultParameters")}
        disabled={busy}
        onPress={() => form.setFieldValue("fsrsParameters", DEFAULT_FSRS_PARAMETERS.join(", "))}
      />
      <form.Subscribe selector={(state) => state.canSubmit}>
        {(canSubmit) => (
          <SaveButtons
            locale={locale}
            busy={busy}
            disabled={!canSubmit}
            onSave={() => {
              void form.handleSubmit();
            }}
            onCancel={onCancel}
          />
        )}
      </form.Subscribe>
    </View>
  );
}
