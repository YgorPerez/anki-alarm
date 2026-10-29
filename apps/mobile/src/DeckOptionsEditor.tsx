import {
  DEFAULT_FSRS_PARAMETERS,
  presetTexts,
  readPresetTexts,
  validPresetText,
  type Locale,
  type Preset,
  type PresetOptions,
} from "@app/core";
import { useForm } from "@tanstack/react-form";
import { Text, View } from "react-native";
import { Button, SaveButtons, TextField } from "./controls.tsx";
import { editingCopy } from "./editing-copy.ts";
import { regular } from "./fonts.ts";

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
  const defaultValues = presetTexts(preset, locale);
  const form = useForm({
    defaultValues,
    onSubmit: ({ value }) => {
      const options = readPresetTexts(value);
      if (options) onSave(options);
    },
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
            onChange: ({ value }) => (validPresetText[spec.key](value) ? undefined : spec.error),
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
