import {
  DEFAULT_FSRS_PARAMETERS,
  deckLimitTexts,
  LIMIT_SCOPES,
  PRESET_LIMITS,
  presetTexts,
  readPresetTexts,
  scopedLimit,
  studyDayStart,
  type Deck,
  type LimitScope,
  type Locale,
  type Preset,
  type PresetOptions,
} from "@app/core";
import { autoAdvanceActionFields, displayOrderFields, presetTextValidators } from "@app/editing-ui";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import { editingCopy, type EditingKey } from "#/editing-copy.ts";
import { EasyDaysField } from "#/ui/easy-days-field.tsx";
import { Field, Select, TextField } from "#/ui/form.tsx";
import { SaveStatus } from "#/ui/note-editor.tsx";
import { Button } from "#/ui/shadcn/button.tsx";

/** The part of a form field the option controls use. */
interface OptionField<Value = string> {
  state: { value: Value };
  handleBlur: () => void;
  handleChange: (value: Value) => void;
}

/** A yes-or-no option: the form keeps it as the text "true" or "false". */
function OptionCheckbox({ label, field }: { label: string; field: OptionField }) {
  return (
    <label className="flex min-h-12 items-center gap-3 text-body">
      <input
        type="checkbox"
        checked={field.state.value === "true"}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(String(event.target.checked))}
        className="size-5 accent-primary"
      />
      {label}
    </label>
  );
}

/** A retention slider; the form keeps the retention as text, which may have a decimal comma. */
function RetentionField({
  label,
  hint,
  field,
}: {
  label: string;
  hint: string;
  field: OptionField;
}) {
  const percent = Math.round(Number(field.state.value.replace(",", ".")) * 100);
  return (
    <Field label={label} hint={hint}>
      {(props) => (
        <div className="flex items-center gap-4">
          <input
            {...props}
            type="range"
            min={PRESET_LIMITS.minRetention * 100}
            max={PRESET_LIMITS.maxRetention * 100}
            step={1}
            value={percent}
            onChange={(event) => field.handleChange((Number(event.target.value) / 100).toFixed(2))}
            className="min-h-12 w-full accent-primary"
          />
          <span>{percent}%</span>
        </div>
      )}
    </Field>
  );
}

type ChoiceOption = (
  | ReturnType<typeof autoAdvanceActionFields>
  | ReturnType<typeof displayOrderFields>
)[number];

/** An option with a fixed set of choices. */
function OptionSelect({
  label,
  choices,
  field,
}: {
  label: string;
  choices: readonly { value: string; label: string }[];
  field: OptionField;
}) {
  return (
    <Field label={label}>
      {(props) => (
        <Select
          {...props}
          value={field.state.value}
          onChange={(event) => field.handleChange(event.target.value)}
        >
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** Where a deck's daily limit applies. `onScope` runs first, so it can bring in that limit. */
function LimitScopeSelect({
  label,
  t,
  field,
  onScope,
}: {
  label: string;
  t: ReturnType<typeof editingCopy>;
  field: OptionField<LimitScope>;
  onScope: (scope: LimitScope) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-body">
      {label}
      <select
        className="min-h-12 rounded-lg border border-border bg-background px-3 text-body text-foreground"
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => {
          const scope = LIMIT_SCOPES.find((s) => s === event.target.value) ?? "preset";
          onScope(scope);
          field.handleChange(scope);
        }}
      >
        <option value="preset">{t("limitPreset")}</option>
        <option value="deck">{t("limitDeck")}</option>
        <option value="today">{t("limitToday")}</option>
      </select>
    </label>
  );
}

type OptionKey = keyof PresetOptions;
/** Each option's label, error and hint copy, and the control it takes. */
const OPTIONS: [OptionKey, EditingKey, EditingKey, EditingKey | null, "line" | "number" | "box"][] =
  [
    ["maximumAnswerSeconds", "maximumAnswerSeconds", "invalidLimit", null, "number"],
    ["secondsToShowQuestion", "secondsToShowQuestion", "invalidLimit", null, "number"],
    ["secondsToShowAnswer", "secondsToShowAnswer", "invalidLimit", null, "number"],
    ["name", "presetName", "invalidName", null, "line"],
    ["newPerDay", "newPerDay", "invalidLimit", null, "number"],
    ["reviewsPerDay", "reviewsPerDay", "invalidLimit", null, "number"],
    ["learningSteps", "learningSteps", "invalidSteps", "learningStepsHint", "line"],
    ["relearningSteps", "relearningSteps", "invalidSteps", "relearningStepsHint", "line"],
    ["leechThreshold", "leechThreshold", "invalidLimit", null, "number"],
    ["fsrsParameters", "fsrsParameters", "invalidParameters", "fsrsParametersHint", "box"],
  ];

type SaveLimits = { deckId: string; new: LimitScope; review: LimitScope };
type SaveState = "idle" | "saving" | "saved" | "failed";

function useDeckOptionsForm({
  preset,
  deck,
  locale,
  today,
  onDirtyChange,
  onSave,
  setStatus,
}: {
  preset: Preset;
  deck: Deck | undefined;
  locale: Locale;
  today: number;
  onDirtyChange: ((dirty: boolean) => void) | undefined;
  onSave: (options: PresetOptions, limits?: SaveLimits) => Promise<void>;
  setStatus: (status: SaveState) => void;
}) {
  return useForm({
    listeners: {
      onChange: ({ formApi }) => onDirtyChange?.(!formApi.state.isDefaultValue),
    },
    defaultValues: {
      ...presetTexts(preset, locale),
      ...deckLimitTexts(deck, preset, today),
    },
    onSubmit: async ({ value, formApi }) => {
      const options = readPresetTexts(value);
      if (!options) return;
      setStatus("saving");
      try {
        if (deck)
          await onSave(options, {
            deckId: deck.id,
            new: value.newScope,
            review: value.reviewScope,
          });
        else await onSave(options);
        formApi.reset(value);
        onDirtyChange?.(false);
        setStatus("saved");
      } catch {
        setStatus("failed");
      }
    },
  });
}

function ChoiceFields({
  form,
  fields,
}: {
  form: ReturnType<typeof useDeckOptionsForm>;
  fields: readonly ChoiceOption[];
}) {
  return fields.map(({ key, label, choices }) => (
    <form.Field key={key} name={key}>
      {(field) => <OptionSelect label={label} choices={choices} field={field} />}
    </form.Field>
  ));
}

/** Edits a preset: the daily limits and FSRS options its decks share. */
export function DeckOptionsEditor({
  preset,
  deck,
  deckCount,
  locale,
  onDirtyChange,
  onSave,
}: {
  onDirtyChange?: (dirty: boolean) => void;
  preset: Preset;
  /** The deck whose options these are: its limits can be set for it alone. */
  deck?: Deck;
  deckCount: number;
  locale: Locale;
  /** Rejects when the save failed. */
  onSave: (options: PresetOptions, limits?: SaveLimits) => Promise<void>;
}) {
  const t = editingCopy(locale);
  const [today] = useState(() => studyDayStart(Date.now()));
  const [advanced, setAdvanced] = useState(false);
  const [status, setStatus] = useState<SaveState>("idle");
  const form = useDeckOptionsForm({
    preset,
    deck,
    locale,
    today,
    onDirtyChange,
    onSave,
    setStatus,
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
      {/* Stays on screen, since the options run long. */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-4 bg-background py-2">
        <form.Subscribe selector={(state) => state.canSubmit}>
          {(canSubmit) => (
            <Button type="submit" size="lg" disabled={!canSubmit || status === "saving"}>
              {t("save")}
            </Button>
          )}
        </form.Subscribe>
        <SaveStatus status={status} t={t} />
      </div>
      {deckCount > 1 && (
        <p className="text-body text-attention">
          {t("sharedPreset", { count: String(deckCount) })}
        </p>
      )}
      <form.Field name="desiredRetention">
        {(field) => (
          <RetentionField
            label={t("desiredRetention")}
            hint={t("desiredRetentionHint")}
            field={field}
          />
        )}
      </form.Field>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-label font-bold">{t("burying")}</legend>
        {(["buryNew", "buryReviews", "buryLearning"] as const).map((key) => (
          <form.Field key={key} name={key}>
            {(field) => <OptionCheckbox label={t(key)} field={field} />}
          </form.Field>
        ))}
      </fieldset>

      {(
        [
          "dontPlayAutomatically",
          "skipQuestionWhenReplayingAnswer",
          "showTimer",
          "stopTimerOnAnswer",
        ] as const
      ).map((key) => (
        <form.Field key={key} name={key}>
          {(field) => <OptionCheckbox label={t(key)} field={field} />}
        </form.Field>
      ))}
      {deck && (
        <div className="flex flex-col gap-3">
          {(
            [
              ["newScope", "newPerDay", "new", "newLimitScope"],
              ["reviewScope", "reviewsPerDay", "review", "reviewLimitScope"],
            ] as const
          ).map(([name, limit, kind, label]) => (
            <form.Field key={name} name={name}>
              {(field) => (
                <LimitScopeSelect
                  label={t(label)}
                  t={t}
                  field={field}
                  onScope={(scope) =>
                    form.setFieldValue(limit, String(scopedLimit(deck, preset, kind, scope, today)))
                  }
                />
              )}
            </form.Field>
          ))}
          <p className="text-body text-muted-foreground">{t("limitTodayHint")}</p>
        </div>
      )}
      {(["newIgnoreReviewLimit", "applyAllParentLimits"] as const).map((key) => (
        <form.Field key={key} name={key}>
          {(field) => <OptionCheckbox label={t(key)} field={field} />}
        </form.Field>
      ))}
      <p className="text-body text-muted-foreground">{t("applyAllParentLimitsHint")}</p>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-label font-bold">{t("autoAdvance")}</legend>
        <form.Field name="waitForAudio">
          {(field) => <OptionCheckbox label={t("waitForAudio")} field={field} />}
        </form.Field>
        <ChoiceFields form={form} fields={autoAdvanceActionFields(locale)} />
      </fieldset>
      <div className="grid gap-5 sm:grid-cols-2">
        {(["insertionOrder", "leechAction"] as const).map((key) => (
          <form.Field key={key} name={key}>
            {(field) => (
              <OptionSelect
                label={t(key)}
                choices={(key === "insertionOrder"
                  ? (["sequential", "random"] as const)
                  : (["suspend", "tagOnly"] as const)
                ).map((value) => ({ value, label: t(value) }))}
                field={field}
              />
            )}
          </form.Field>
        ))}
        {OPTIONS.map(([key, label, error, hint, control]) => (
          <form.Field key={key} name={key} validators={presetTextValidators(key, t(error))}>
            {(field) => {
              const controlField = (
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
              );
              return key === "fsrsParameters" ? (
                <details
                  className="sm:col-span-2"
                  onToggle={(event) => setAdvanced(event.currentTarget.open)}
                >
                  <summary className="min-h-12 cursor-pointer text-label font-bold">
                    {t("advanced")}
                  </summary>
                  {advanced && (
                    <>
                      <form.Field
                        name="maximumInterval"
                        validators={presetTextValidators("maximumInterval", t("invalidInterval"))}
                      >
                        {(intervalField) => (
                          <TextField
                            label={t("maximumInterval")}
                            inputMode="numeric"
                            value={intervalField.state.value}
                            onChange={intervalField.handleChange}
                            onBlur={intervalField.handleBlur}
                            errors={intervalField.state.meta.errors}
                          />
                        )}
                      </form.Field>
                      {controlField}
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="lg"
                    onClick={() =>
                      form.setFieldValue("fsrsParameters", DEFAULT_FSRS_PARAMETERS.join(", "))
                    }
                  >
                    {t("defaultParameters")}
                  </Button>
                </details>
              ) : (
                controlField
              );
            }}
          </form.Field>
        ))}
      </div>
      <form.Field name="easyDays">
        {(field) => (
          <EasyDaysField value={field.state.value} locale={locale} onChange={field.handleChange} />
        )}
      </form.Field>
      <section aria-labelledby="display-order" className="flex flex-col gap-5">
        <h3 id="display-order" className="text-label font-bold">
          {t("displayOrder")}
        </h3>
        <div className="grid gap-5 sm:grid-cols-2">
          <ChoiceFields form={form} fields={displayOrderFields(locale)} />
        </div>
      </section>
    </form>
  );
}
