import {
  basicField,
  noteDraft,
  noteTypeChoices,
  type Deck,
  type Locale,
  type Note,
  type NoteDraft,
  type NoteType,
  type NoteTypeChoice,
} from "@app/core";
import { Debouncer } from "@tanstack/pacer";
import { useForm, useStore } from "@tanstack/react-form";
import { useEffect, useState } from "react";

import { editingCopy, type EditingT } from "#/editing-copy.ts";
import { Field, Notice, Select, TextField } from "#/ui/form.tsx";
import { Button } from "#/ui/shadcn/button.tsx";

/** The app's own Basic shows its two fields in the UI's language. */
const fieldLabel = (t: EditingT, type: NoteTypeChoice, name: string) => {
  const basic = basicField(type, name);
  return basic ? t(basic) : name;
};
/** How long typing pauses before an edit saves. */
const AUTOSAVE_MS = 600;
type Status = "idle" | "saving" | "saved" | "failed";

/**
 * A note's fields, following its note type, and the deck its cards are in. A new note picks its
 * note type and is added with a button; an existing one saves as the user types.
 */
export function NoteEditor({
  note,
  noteTypes,
  decks,
  deckId,
  locale,
  onSave,
}: {
  note?: Note | undefined;
  noteTypes: readonly NoteType[];
  decks: readonly Deck[];
  deckId: string;
  locale: Locale;
  /** Rejects when the save failed; the form keeps what was typed. */
  onSave: (draft: NoteDraft) => Promise<void>;
}) {
  const t = editingCopy(locale);
  const types = noteTypeChoices(noteTypes);
  const { type: initialType, draft: defaultValues } = noteDraft(types, note, deckId);
  const [status, setStatus] = useState<Status>("idle");
  const save = async (draft: NoteDraft) => {
    if (!draft.values[0]?.trim()) return false;
    setStatus("saving");
    try {
      await onSave(draft);
      setStatus("saved");
      return true;
    } catch {
      setStatus("failed");
      return false;
    }
  };
  // Pacer: one save after typing pauses; leaving the editor saves what's pending.
  const [autosave] = useState(
    () => new Debouncer((draft: NoteDraft) => void save(draft), { wait: AUTOSAVE_MS }),
  );
  useEffect(() => () => autosave.flush(), [autosave]);
  const form = useForm({
    defaultValues,
    onSubmit: async ({ value, formApi }) => {
      if (await save(value))
        formApi.reset(
          { ...value, values: value.values.map(() => "") },
          { keepDefaultValues: true },
        );
    },
    listeners: {
      onChange: ({ formApi }) => {
        if (note) autosave.maybeExecute(formApi.state.values);
      },
    },
  });
  const typeId = useStore(form.store, (state) => state.values.noteTypeId);
  const type = types.find((choice) => choice.id === typeId) ?? initialType;
  /** A new note's type: its fields start empty. */
  const pickType = (id: string) => {
    const next = types.find((choice) => choice.id === id) ?? initialType;
    form.setFieldValue("noteTypeId", next.id);
    form.setFieldValue(
      "values",
      next.fieldNames.map(() => ""),
    );
  };
  const required = (i: number) => ({
    onChange: ({ value }: { value: string }) =>
      i === 0 && !value.trim() ? t("firstFieldRequired") : undefined,
  });
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      {note || types.length === 1 ? (
        <p className="text-label text-muted-foreground">
          {t("noteType")}: {initialType.name}
        </p>
      ) : (
        <Field label={t("noteType")}>
          {(props) => (
            <Select {...props} value={type.id} onChange={(event) => pickType(event.target.value)}>
              {types.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {type.fieldNames.map((name, i) => (
        <form.Field key={`${type.id}-${name}`} name={`values[${i}]`} validators={required(i)}>
          {(field) => (
            <TextField
              kind="box"
              label={fieldLabel(t, type, name)}
              errors={field.state.meta.errors}
              value={field.state.value}
              onChange={field.handleChange}
              onBlur={() => {
                field.handleBlur();
                if (note) autosave.flush();
              }}
            />
          )}
        </form.Field>
      ))}
      {decks.length > 1 && (
        <form.Field name="deckId">
          {(field) => (
            <Field label={t("deck")} hint={note ? t("moveHint") : undefined}>
              {(props) => (
                <Select
                  {...props}
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                    if (note) autosave.flush();
                  }}
                >
                  {decks.map((deck) => (
                    <option key={deck.id} value={deck.id}>
                      {deck.fields.name.value}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </form.Field>
      )}
      {note ? (
        <SaveStatus status={status} t={t} idle={t("autosaveHint")} />
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <form.Subscribe
            selector={(state) => state.canSubmit && Boolean(state.values.values[0]?.trim())}
          >
            {(canSubmit) => (
              <Button type="submit" size="lg" disabled={!canSubmit || status === "saving"}>
                {t("add")}
              </Button>
            )}
          </form.Subscribe>
          <SaveStatus status={status} t={t} saved={t("added")} />
        </div>
      )}
    </form>
  );
}

/** What the last save did. */
export function SaveStatus({
  status,
  t,
  idle,
  saved,
}: {
  status: Status;
  t: EditingT;
  idle?: string;
  saved?: string;
}) {
  if (status === "failed") return <Notice tone="error">{t("saveFailed")}</Notice>;
  const text = { idle, saving: t("saving"), saved: saved ?? t("saved") }[status];
  return text ? <Notice tone="muted">{text}</Notice> : null;
}
