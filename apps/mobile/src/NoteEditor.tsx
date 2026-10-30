import {
  basicField,
  noteDraft,
  noteTypeChoices,
  type NoteDraft,
  type Deck,
  type Locale,
  type Note,
  type NoteType,
  type NoteTypeChoice,
} from "@app/core";
import { useForm } from "@tanstack/react-form";
import { Text, View } from "react-native";
import { Choice, SaveButtons, TextField } from "./controls.tsx";
import { editingCopy, type EditingTranslate } from "./editing-copy.ts";
import { regular } from "./fonts.ts";

/** The app's own Basic shows its two fields in the UI's language. */
const fieldLabel = (t: EditingTranslate, type: NoteTypeChoice, name: string) => {
  const basic = basicField(type, name);
  return basic ? t(basic) : name;
};

/**
 * A note's fields, following its note type, and the deck its cards are in. A new note picks its
 * note type here; an existing one keeps it, since note types are edited on the web.
 */
export function NoteEditor({
  note,
  noteTypes,
  decks,
  deckId,
  locale,
  busy,
  onSave,
  onCancel,
  onChange,
}: {
  note?: Note;
  noteTypes: readonly NoteType[];
  decks: readonly Deck[];
  deckId: string;
  locale: Locale;
  busy: boolean;
  onSave: (draft: NoteDraft) => void;
  onCancel: () => void;
  /** Any field edited. */
  onChange?: (() => void) | undefined;
}) {
  const t = editingCopy(locale);
  const types = noteTypeChoices(noteTypes);
  const { type: initialType, draft: defaultValues } = noteDraft(types, note, deckId);
  const form = useForm({
    defaultValues,
    listeners: { onChange: () => onChange?.() },
    onSubmit: ({ value }) => onSave(value),
  });
  return (
    <View className="gap-6" pointerEvents={busy ? "none" : "auto"}>
      <form.Field name="noteTypeId">
        {(field) =>
          note || types.length === 1 ? (
            <View className="gap-1">
              <Text style={regular} className="text-label text-muted-foreground">
                {t("noteType")}: {initialType.name}
              </Text>
              <Text style={regular} className="text-label text-muted-foreground">
                {t("noteTypeWebOnly")}
              </Text>
            </View>
          ) : (
            <Choice
              label={t("noteType")}
              options={types.map((type) => ({ value: type.id, label: type.name }))}
              value={field.state.value}
              disabled={busy}
              onChange={(id) => {
                field.handleChange(id);
                const type = types.find((choice) => choice.id === id) ?? initialType;
                form.setFieldValue(
                  "values",
                  type.fieldNames.map(() => ""),
                );
              }}
            />
          )
        }
      </form.Field>
      <form.Subscribe selector={(state) => state.values.noteTypeId}>
        {(typeId) => {
          const type = types.find((choice) => choice.id === typeId) ?? initialType;
          return type.fieldNames.map((name, i) => (
            <form.Field
              key={`${type.id}-${name}`}
              name={`values[${i}]`}
              validators={{
                onChange: ({ value }) =>
                  i === 0 && !value.trim() ? t("firstFieldRequired") : undefined,
              }}
            >
              {(field) => (
                <TextField
                  label={fieldLabel(t, type, name)}
                  value={field.state.value}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                  error={field.state.meta.errors[0]}
                  multiline
                />
              )}
            </form.Field>
          ));
        }}
      </form.Subscribe>
      {decks.length > 1 && (
        <form.Field name="deckId">
          {(field) => (
            <View className="gap-2">
              <Choice
                label={t("deck")}
                options={decks.map((deck) => ({ value: deck.id, label: deck.fields.name.value }))}
                value={field.state.value}
                disabled={busy}
                onChange={field.handleChange}
              />
              {note && (
                <Text style={regular} className="text-label text-muted-foreground">
                  {t("moveHint")}
                </Text>
              )}
            </View>
          )}
        </form.Field>
      )}
      <form.Subscribe
        selector={(state) => state.canSubmit && Boolean(state.values.values[0]?.trim())}
      >
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
