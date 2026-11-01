import {
  ANSWER_ACTIONS,
  DEFAULT_FSRS_PARAMETERS,
  deckLimitTexts,
  LIMIT_SCOPES,
  PRESET_LIMITS,
  QUESTION_ACTIONS,
  presetTexts,
  readPresetTexts,
  scopedLimit,
  studyDayStart,
  validPresetText,
  type Deck,
  type LimitScope,
  type Locale,
  type Preset,
  type PresetOptions,
} from "@app/core";
import { displayOrderFields } from "@app/editing-ui";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import { editingCopy, type EditingKey } from "#/editing-copy.ts";
import { EasyDaysField } from "#/ui/easy-days-field.tsx";
import { Field, Select, TextField } from "#/ui/form.tsx";
import { SaveStatus } from "#/ui/note-editor.tsx";
import { Button } from "#/ui/shadcn/button.tsx";

const ACTION_LABELS = {
  showAnswer: "actionShowAnswer",
  showReminder: "actionShowReminder",
  bury: "actionBury",
  again: "actionAgain",
  good: "actionGood",
  hard: "actionHard",
} as const;

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
  onSave: (
    options: PresetOptions,
    limits?: { deckId: string; new: LimitScope; review: LimitScope },
  ) => Promise<void>;
}) {
  const t = editingCopy(locale);
  const [today] = useState(() => studyDayStart(Date.now()));
  const [advanced, setAdvanced] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const form = useForm({
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
      <div className="flex flex-wrap items-center gap-4">
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
          <Field label={t("desiredRetention")} hint={t("desiredRetentionHint")}>
            {(props) => (
              <div className="flex items-center gap-4">
                <input
                  {...props}
                  type="range"
                  min={PRESET_LIMITS.minRetention * 100}
                  max={PRESET_LIMITS.maxRetention * 100}
                  step={1}
                  value={Math.round(Number(field.state.value.replace(",", ".")) * 100)}
                  onChange={(event) =>
                    field.handleChange((Number(event.target.value) / 100).toFixed(2))
                  }
                  className="min-h-12 w-full accent-primary"
                />
                <span>{Math.round(Number(field.state.value.replace(",", ".")) * 100)}%</span>
              </div>
            )}
          </Field>
        )}
      </form.Field>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-label font-bold">{t("burying")}</legend>
        {(["buryNew", "buryReviews", "buryLearning"] as const).map((key) => (
          <form.Field key={key} name={key}>
            {(field) => (
              <label className="flex min-h-12 items-center gap-3 text-body">
                <input
                  type="checkbox"
                  checked={field.state.value === "true"}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(String(event.target.checked))}
                  className="size-5 accent-primary"
                />
                {t(key)}
              </label>
            )}
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
          {(field) => (
            <label className="flex min-h-12 items-center gap-3 text-body">
              <input
                type="checkbox"
                checked={field.state.value === "true"}
                onChange={(event) => field.handleChange(String(event.target.checked))}
              />
              {t(key)}
            </label>
          )}
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
                <label className="flex flex-col gap-1 text-body">
                  {t(label)}
                  <select
                    className="min-h-12 rounded-lg border border-border bg-background px-3 text-body text-foreground"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      const scope = LIMIT_SCOPES.find((s) => s === event.target.value) ?? "preset";
                      form.setFieldValue(
                        limit,
                        String(scopedLimit(deck, preset, kind, scope, today)),
                      );
                      field.handleChange(scope);
                    }}
                  >
                    <option value="preset">{t("limitPreset")}</option>
                    <option value="deck">{t("limitDeck")}</option>
                    <option value="today">{t("limitToday")}</option>
                  </select>
                </label>
              )}
            </form.Field>
          ))}
          <p className="text-body text-muted-foreground">{t("limitTodayHint")}</p>
        </div>
      )}
      {(["newIgnoreReviewLimit", "applyAllParentLimits"] as const).map((key) => (
        <form.Field key={key} name={key}>
          {(field) => (
            <label className="flex min-h-12 items-center gap-3 text-body">
              <input
                type="checkbox"
                checked={field.state.value === "true"}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(String(event.target.checked))}
                className="size-5 accent-primary"
              />
              {t(key)}
            </label>
          )}
        </form.Field>
      ))}
      <p className="text-body text-muted-foreground">{t("applyAllParentLimitsHint")}</p>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-label font-bold">{t("autoAdvance")}</legend>
        <form.Field name="waitForAudio">
          {(field) => (
            <label className="flex min-h-12 items-center gap-3 text-body">
              <input
                type="checkbox"
                checked={field.state.value === "true"}
                onChange={(event) => field.handleChange(String(event.target.checked))}
                className="size-5 accent-primary"
              />
              {t("waitForAudio")}
            </label>
          )}
        </form.Field>
        <form.Field name="questionAction">
          {(field) => (
            <Field label={t("questionAction")}>
              {(props) => (
                <Select
                  {...props}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                >
                  {QUESTION_ACTIONS.map((action) => (
                    <option key={action} value={action}>
                      {t(ACTION_LABELS[action])}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </form.Field>
        <form.Field name="answerAction">
          {(field) => (
            <Field label={t("answerAction")}>
              {(props) => (
                <Select
                  {...props}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                >
                  {ANSWER_ACTIONS.map((action) => (
                    <option key={action} value={action}>
                      {t(ACTION_LABELS[action])}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </form.Field>
      </fieldset>
      <div className="grid gap-5 sm:grid-cols-2">
        {(["insertionOrder", "leechAction"] as const).map((key) => (
          <form.Field key={key} name={key}>
            {(field) => (
              <Field label={t(key)}>
                {(props) => (
                  <select
                    {...props}
                    className="min-h-12 rounded-md border border-input bg-background px-3"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  >
                    {(key === "insertionOrder"
                      ? (["sequential", "random"] as const)
                      : (["suspend", "tagOnly"] as const)
                    ).map((value) => (
                      <option key={value} value={value}>
                        {t(value)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
          </form.Field>
        ))}
        {OPTIONS.map(([key, label, error, hint, control]) => (
          <form.Field
            key={key}
            name={key}
            validators={{
              onChange: ({ value }) => (validPresetText[key](value) ? undefined : t(error)),
            }}
          >
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
                        validators={{
                          onChange: ({ value }) =>
                            validPresetText.maximumInterval(value)
                              ? undefined
                              : t("invalidInterval"),
                        }}
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
          {displayOrderFields(locale).map(({ key, label, choices }) => (
            <form.Field key={key} name={key}>
              {(field) => (
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
              )}
            </form.Field>
          ))}
        </div>
      </section>
    </form>
  );
}
