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

import { editingCopy, type EditingKey } from "#/editing-copy.ts";
import { TextField } from "#/ui/form.tsx";
import { SaveStatus } from "#/ui/note-editor.tsx";
import { Button } from "#/ui/shadcn/button.tsx";

type OptionKey = keyof PresetOptions;
/** Each option's label, error and hint copy, and the control it takes. */
const OPTIONS: [OptionKey, EditingKey, EditingKey, EditingKey | null, "line" | "number" | "box"][] =
  [
    ["name", "presetName", "invalidName", null, "line"],
    ["newPerDay", "newPerDay", "invalidLimit", null, "number"],
    ["reviewsPerDay", "reviewsPerDay", "invalidLimit", null, "number"],
    ["desiredRetention", "desiredRetention", "invalidRetention", "desiredRetentionHint", "number"],
    ["learningSteps", "learningSteps", "invalidSteps", "learningStepsHint", "line"],
    ["fsrsParameters", "fsrsParameters", "invalidParameters", "fsrsParametersHint", "box"],
  ];

/** Edits a preset: the daily limits and FSRS options its decks share. */
export function DeckOptionsEditor({
  preset,
  deckCount,
  locale,
  onSave,
}: {
  preset: Preset;
  deckCount: number;
  locale: Locale;
  /** Rejects when the save failed. */
  onSave: (options: PresetOptions) => Promise<void>;
}) {
  const t = editingCopy(locale);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const form = useForm({
    defaultValues: presetTexts(preset, locale),
    onSubmit: async ({ value, formApi }) => {
      const options = readPresetTexts(value);
      if (!options) return;
      setStatus("saving");
      try {
        await onSave(options);
        formApi.reset(value);
        setStatus("saved");
      } catch {
        setStatus("failed");
      }
    },
  });
  return (
    <form
      aria-labelledby="deck-options"
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <h2 id="deck-options" className="text-label font-bold">
        {t("deckOptions")}
      </h2>
      {deckCount > 1 && (
        <p className="text-body text-attention">
          {t("sharedPreset", { count: String(deckCount) })}
        </p>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        {OPTIONS.map(([key, label, error, hint, control]) => (
          <form.Field
            key={key}
            name={key}
            validators={{
              onChange: ({ value }) => (validPresetText[key](value) ? undefined : t(error)),
            }}
          >
            {(field) => (
              <TextField
                label={t(label)}
                hint={hint ? t(hint) : undefined}
                errors={field.state.meta.errors}
                kind={control === "box" ? "box" : "line"}
                className={control === "box" ? "sm:col-span-2" : undefined}
                {...(control === "number" ? { inputMode: "decimal" as const } : {})}
                value={field.state.value}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
              />
            )}
          </form.Field>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <form.Subscribe selector={(state) => state.canSubmit}>
          {(canSubmit) => (
            <Button type="submit" size="lg" disabled={!canSubmit || status === "saving"}>
              {t("save")}
            </Button>
          )}
        </form.Subscribe>
        <Button
          variant="ghost"
          size="lg"
          onClick={() => form.setFieldValue("fsrsParameters", DEFAULT_FSRS_PARAMETERS.join(", "))}
        >
          {t("defaultParameters")}
        </Button>
        <SaveStatus status={status} t={t} />
      </div>
    </form>
  );
}
