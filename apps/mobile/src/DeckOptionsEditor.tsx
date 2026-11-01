import { AnkiDroidOptions } from "./AnkiDroidOptions.tsx";
import type { AnkiDroidApi } from "./ankidroid.ts";
import {
  DEFAULT_FSRS_PARAMETERS,
  deckLimitTexts,
  presetOptionTexts,
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
import { RetentionSlider } from "./RetentionSlider.tsx";
import { Pressable, Switch, Text, View } from "react-native";
import { Button, Choice, SaveButtons, TextField } from "./controls.tsx";
import { editingCopy, type EditingTranslate } from "./editing-copy.ts";
import { EasyDaysField } from "./EasyDaysField.tsx";
import { bold, regular } from "./fonts.ts";

/** A yes-or-no option: the form keeps it as the text "true" or "false". */
function OptionSwitch({
  label,
  field,
  busy,
}: {
  label: string;
  field: { state: { value: string }; handleChange: (value: string) => void };
  busy: boolean;
}) {
  return (
    <View className="min-h-12 flex-row items-center justify-between gap-3">
      <Text style={regular} className="flex-1 text-body text-foreground">
        {label}
      </Text>
      <Switch
        accessible
        accessibilityRole="switch"
        accessibilityLabel={label}
        value={field.state.value === "true"}
        onValueChange={(value) => field.handleChange(String(value))}
        disabled={busy}
      />
    </View>
  );
}

/** Each option typed as text: its copy and its control. */
const textOptions = (t: EditingTranslate) =>
  [
    {
      key: "maximumAnswerSeconds",
      label: t("maximumAnswerSeconds"),
      error: t("invalidLimit"),
      numeric: true,
    },
    {
      key: "secondsToShowQuestion",
      label: t("secondsToShowQuestion"),
      error: t("invalidLimit"),
      numeric: true,
    },
    {
      key: "secondsToShowAnswer",
      label: t("secondsToShowAnswer"),
      error: t("invalidLimit"),
      numeric: true,
    },
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

/** Where a deck's daily limit applies. */
function LimitScopeChoice({
  label,
  t,
  busy,
  value,
  onChoose,
}: {
  label: string;
  t: EditingTranslate;
  busy: boolean;
  value: LimitScope;
  onChoose: (scope: LimitScope) => void;
}) {
  return (
    <View className="gap-2" accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={regular} className="text-body text-foreground">
        {label}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {(
          [
            ["preset", "limitPreset"],
            ["deck", "limitDeck"],
            ["today", "limitToday"],
          ] as const
        ).map(([scope, scopeLabel]) => (
          <Pressable
            key={scope}
            accessibilityRole="radio"
            accessibilityLabel={t(scopeLabel)}
            accessibilityState={{ checked: value === scope, disabled: busy }}
            disabled={busy}
            className={`min-h-12 justify-center rounded-pill px-5 py-3 ${
              value === scope ? "bg-primary" : "bg-surface"
            }`}
            onPress={() => onChoose(scope)}
          >
            <Text
              style={regular}
              className={
                value === scope ? "text-body text-primary-foreground" : "text-body text-foreground"
              }
            >
              {t(scopeLabel)}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Edits a preset: the daily limits and FSRS options its decks share. */
export function DeckOptionsEditor({
  preset,
  deck,
  ankiDroid,
  deckCount,
  locale,
  busy,
  onDirtyChange,
  onSave,
  onCancel,
}: {
  onDirtyChange?: (dirty: boolean) => void;
  ankiDroid?: AnkiDroidApi;
  preset: Preset;
  /** The deck whose options these are: its limits can be set for it alone. */
  deck?: Deck;
  deckCount: number;
  locale: Locale;
  busy: boolean;
  onSave: (
    options: PresetOptions,
    limits?: { deckId: string; new: LimitScope; review: LimitScope },
  ) => void;
  onCancel: () => void;
}) {
  const t = editingCopy(locale);
  const [advanced, setAdvanced] = useState(false);
  const [today] = useState(() => studyDayStart(Date.now()));
  const defaultValues = {
    ...presetTexts(preset, locale),
    ...deckLimitTexts(deck, preset, today),
  };
  const form = useForm({
    listeners: {
      onChange: ({ formApi }) => onDirtyChange?.(!formApi.state.isDefaultValue),
    },
    defaultValues,
    onSubmit: ({ value }) => {
      const options = readPresetTexts(value);
      if (!options) return;
      if (deck)
        onSave(options, { deckId: deck.id, new: value.newScope, review: value.reviewScope });
      else onSave(options);
    },
  });
  const fields = textOptions(t);
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
      {deck?.fields.linkedBy && ankiDroid && (
        <AnkiDroidOptions
          deck={deck}
          api={ankiDroid}
          locale={locale}
          busy={busy}
          onBring={(options) => {
            const { values } = form.state;
            form.reset(
              {
                ...presetOptionTexts({ ...options, name: values.name }, locale),
                newScope: "preset",
                reviewScope: "preset",
              },
              { keepDefaultValues: true },
            );
            onDirtyChange?.(true);
          }}
        />
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
      <View className="gap-3">
        <Text style={bold} className="text-label text-foreground">
          {t("burying")}
        </Text>
        {(["buryNew", "buryReviews", "buryLearning"] as const).map((key) => (
          <form.Field key={key} name={key}>
            {(field) => <OptionSwitch label={t(key)} field={field} busy={busy} />}
          </form.Field>
        ))}
      </View>

      {(
        [
          "dontPlayAutomatically",
          "skipQuestionWhenReplayingAnswer",
          "showTimer",
          "stopTimerOnAnswer",
        ] as const
      ).map((key) => (
        <form.Field key={key} name={key}>
          {(field) => <OptionSwitch label={t(key)} field={field} busy={busy} />}
        </form.Field>
      ))}
      {deck &&
        (
          [
            ["newScope", "newPerDay", "new", "newLimitScope"],
            ["reviewScope", "reviewsPerDay", "review", "reviewLimitScope"],
          ] as const
        ).map(([name, limit, kind, label]) => (
          <form.Field key={name} name={name}>
            {(field) => (
              <LimitScopeChoice
                label={t(label)}
                t={t}
                busy={busy}
                value={field.state.value}
                onChoose={(scope) => {
                  form.setFieldValue(limit, String(scopedLimit(deck, preset, kind, scope, today)));
                  field.handleChange(scope);
                }}
              />
            )}
          </form.Field>
        ))}
      {deck && (
        <Text style={regular} className="text-body text-muted-foreground">
          {t("limitTodayHint")}
        </Text>
      )}
      {(["newIgnoreReviewLimit", "applyAllParentLimits"] as const).map((key) => (
        <form.Field key={key} name={key}>
          {(field) => <OptionSwitch label={t(key)} field={field} busy={busy} />}
        </form.Field>
      ))}
      <Text style={regular} className="text-body text-muted-foreground">
        {t("applyAllParentLimitsHint")}
      </Text>

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
      <View className="gap-3">
        <Text style={bold} className="text-label text-foreground">
          {t("autoAdvance")}
        </Text>
        <form.Field name="waitForAudio">
          {(field) => <OptionSwitch label={t("waitForAudio")} field={field} busy={busy} />}
        </form.Field>
        {autoAdvanceActionFields(locale).map(({ key, label, choices }) => (
          <form.Field key={key} name={key}>
            {(field) => (
              <Choice<string>
                label={label}
                options={choices}
                value={field.state.value}
                onChange={field.handleChange}
                disabled={busy}
              />
            )}
          </form.Field>
        ))}
      </View>
      {fields.map((spec) => (
        <form.Field
          key={spec.key}
          name={spec.key}
          validators={presetTextValidators(spec.key, spec.error)}
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
                      validators={presetTextValidators("maximumInterval", t("invalidInterval"))}
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
      <form.Field name="easyDays">
        {(field) => (
          <EasyDaysField value={field.state.value} locale={locale} onChange={field.handleChange} />
        )}
      </form.Field>
      <Text style={bold} accessibilityRole="header" className="text-label text-foreground">
        {t("displayOrder")}
      </Text>
      {displayOrderFields(locale).map(({ key, label, choices }) => (
        <form.Field key={key} name={key}>
          {(field) => (
            <Choice
              label={label}
              options={choices}
              value={field.state.value}
              onChange={field.handleChange}
              disabled={busy}
            />
          )}
        </form.Field>
      ))}
    </View>
  );
}
