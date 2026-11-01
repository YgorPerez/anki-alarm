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
import { useState } from "react";
import { RetentionSlider } from "./RetentionSlider.tsx";
import { Text, View } from "react-native";
import { Button, Choice, SaveButtons, TextField } from "./controls.tsx";
import { editingCopy } from "./editing-copy.ts";
import { regular } from "./fonts.ts";

/** Edits a preset: the daily limits and FSRS options its decks share. */
export function DeckOptionsEditor({
  preset,
  deckCount,
  locale,
  busy,
  onDirtyChange,
  onSave,
  onCancel,
}: {
  onDirtyChange?: (dirty: boolean) => void;
  preset: Preset;
  deckCount: number;
  locale: Locale;
  busy: boolean;
  onSave: (options: PresetOptions) => void;
  onCancel: () => void;
}) {
  const t = editingCopy(locale);
  const [advanced, setAdvanced] = useState(false);
  const defaultValues = presetTexts(preset, locale);
  const form = useForm({
    listeners: {
      onChange: ({ formApi }) => onDirtyChange?.(!formApi.state.isDefaultValue),
    },
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
      key: "learningSteps",
      label: t("learningSteps"),
      error: t("invalidSteps"),
      hint: t("learningStepsHint"),
      numeric: true,
    },
    {
      key: "relearningSteps",
      label: t("relearningSteps"),
      error: t("invalidSteps"),
      hint: t("relearningStepsHint"),
    },
    { key: "leechThreshold", label: t("leechThreshold"), error: t("invalidLimit"), numeric: true },
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
      {deckCount > 1 && (
        <Text style={regular} className="text-body text-attention">
          {t("sharedPreset", { count: String(deckCount) })}
        </Text>
      )}
      <form.Field name="desiredRetention">
        {(field) => (
          <RetentionSlider
            label={t("desiredRetention")}
            hint={t("desiredRetentionHint")}
            value={field.state.value}
            onChange={field.handleChange}
          />
        )}
      </form.Field>
      {(["insertionOrder", "leechAction"] as const).map((key) => (
        <form.Field key={key} name={key}>
          {(field) => (
            <Choice
              label={t(key)}
              value={field.state.value}
              options={(key === "insertionOrder"
                ? (["sequential", "random"] as const)
                : (["suspend", "tagOnly"] as const)
              ).map((value) => ({ value, label: t(value) }))}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
      ))}
      {fields.map((spec) => (
        <form.Field
          key={spec.key}
          name={spec.key}
          validators={{
            onChange: ({ value }) => (validPresetText[spec.key](value) ? undefined : spec.error),
          }}
        >
          {(field) => {
            const control = (
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
            );
            return spec.key === "fsrsParameters" ? (
              <View className="gap-6">
                <Button label={t("advanced")} onPress={() => setAdvanced(!advanced)} />
                {advanced && (
                  <>
                    <form.Field
                      name="maximumInterval"
                      validators={{
                        onChange: ({ value }) =>
                          validPresetText.maximumInterval(value) ? undefined : t("invalidInterval"),
                      }}
                    >
                      {(intervalField) => (
                        <TextField
                          label={t("maximumInterval")}
                          numeric
                          value={intervalField.state.value}
                          onChange={intervalField.handleChange}
                          onBlur={intervalField.handleBlur}
                          error={intervalField.state.meta.errors[0]}
                        />
                      )}
                    </form.Field>
                    {control}
                    <Button
                      label={t("defaultParameters")}
                      disabled={busy}
                      onPress={() =>
                        form.setFieldValue("fsrsParameters", DEFAULT_FSRS_PARAMETERS.join(", "))
                      }
                    />
                  </>
                )}
              </View>
            ) : (
              control
            );
          }}
        </form.Field>
      ))}
    </View>
  );
}
