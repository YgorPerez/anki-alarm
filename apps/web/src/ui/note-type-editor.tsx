import {
  editedNoteType,
  editedValues,
  noteTypeEditOf,
  noteTypeProblems,
  type Locale,
  type Note,
  type NoteType,
  type NoteTypeEdit,
  type NoteTypeImpact,
} from "@app/core";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import { editingCopy, type EditingKey, type EditingT } from "#/editing-copy.ts";
import { Confirm } from "#/ui/confirm.tsx";
import { CardFrame } from "#/ui/card-frame.tsx";
import { Notice, TextField } from "#/ui/form.tsx";
import { Button } from "#/ui/shadcn/button.tsx";

/** The values a preview shows: a note of the type, or each field's name. */
function previewNote(type: NoteType, edit: NoteTypeEdit, sample: Note | undefined): Note {
  const hlc = type.fields.name.hlc;
  const values = sample
    ? editedValues(sample.values, edit)
    : edit.fields.map((f) => `(${f.name.trim()})`);
  return {
    id: sample?.id ?? "preview",
    fields: { noteTypeId: { value: type.id, hlc }, tags: { value: [], hlc } },
    values: values.map((value) => ({ value, hlc })),
  };
}
/** The form's lists carry a key per item, so a moved field keeps its input. */
type Draft = Omit<NoteTypeEdit, "fields" | "templates"> & {
  fields: (NoteTypeEdit["fields"][number] & { key: string })[];
  templates: (NoteTypeEdit["templates"][number] & { key: string })[];
};
const keyed = <T extends object>(item: T) => ({ ...item, key: crypto.randomUUID() });
const draftOf = (type: NoteType): Draft => {
  const edit = noteTypeEditOf(type);
  return { ...edit, fields: edit.fields.map(keyed), templates: edit.templates.map(keyed) };
};
const from = (item: { from?: number }) => (item.from === undefined ? {} : { from: item.from });
const editOf = (draft: Draft): NoteTypeEdit => ({
  name: draft.name,
  css: draft.css,
  fields: draft.fields.map((f) => ({ name: f.name, ...from(f) })),
  templates: draft.templates.map((t) => ({
    name: t.name,
    front: t.front,
    back: t.back,
    ...from(t),
  })),
});
const lossy = (impact: NoteTypeImpact) => impact.valuesLost > 0 || impact.cardsRemoved > 0;

/**
 * A note type's name, fields, card templates and CSS, with a preview of the selected template.
 * Saving asks first when it would erase values or delete cards. Key it by the type's version:
 * a saved edit starts from the new type.
 */
export function NoteTypeEditor({
  type,
  sample,
  noteCount,
  impact,
  locale,
  onSave,
}: {
  type: NoteType;
  /** A note of the type, for the preview. */
  sample?: Note | undefined;
  noteCount: number;
  impact: (edit: NoteTypeEdit) => NoteTypeImpact;
  locale: Locale;
  /** Rejects when the save failed. */
  onSave: (edit: NoteTypeEdit) => Promise<void>;
}) {
  const t = editingCopy(locale);
  const cloze = type.fields.kind.value === "cloze";
  const [selected, setSelected] = useState(0);
  const [pending, setPending] = useState<{ edit: NoteTypeEdit; impact: NoteTypeImpact }>();
  const [status, setStatus] = useState<"idle" | "saving" | "failed">("idle");
  const save = async (edit: NoteTypeEdit) => {
    setPending(undefined);
    setStatus("saving");
    try {
      await onSave(edit);
      setStatus("idle");
    } catch {
      setStatus("failed");
    }
  };
  const form = useForm({
    defaultValues: draftOf(type),
    onSubmit: async ({ value }) => {
      const edit = editOf(value);
      const effect = impact(edit);
      if (lossy(effect)) setPending({ edit, impact: effect });
      else await save(edit);
    },
  });
  return (
    <form
      aria-label={type.fields.name.value}
      className="grid gap-8 lg:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="flex flex-col gap-6">
        <form.Field name="name">
          {(field) => (
            <TextField
              label={t("noteTypeName")}
              value={field.state.value}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
        <p className="text-label text-muted-foreground">
          {t("usedBy", { count: String(noteCount) })}
        </p>
        <form.Field name="fields" mode="array">
          {(list) => (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-3 text-label font-bold">{t("fields")}</legend>
              {list.state.value.map((item, i) => (
                <div key={item.key} className="flex items-end gap-2">
                  <form.Field name={`fields[${i}].name`}>
                    {(field) => (
                      <TextField
                        label={t("fieldName", { number: String(i + 1) })}
                        className="flex-1"
                        value={field.state.value}
                        onChange={field.handleChange}
                      />
                    )}
                  </form.Field>
                  <Reorder
                    t={t}
                    name={item.name}
                    index={i}
                    count={list.state.value.length}
                    onMove={(to) => list.moveValue(i, to)}
                    onRemove={() => list.removeValue(i)}
                  />
                </div>
              ))}
              <Button
                variant="outline"
                size="lg"
                className="self-start"
                onClick={() =>
                  list.pushValue(
                    keyed({ name: t("newField", { number: String(list.state.value.length + 1) }) }),
                  )
                }
              >
                {t("addField")}
              </Button>
            </fieldset>
          )}
        </form.Field>
        <form.Field name="templates" mode="array">
          {(list) => {
            const index = Math.min(selected, list.state.value.length - 1);
            const current = list.state.value[index];
            return (
              <fieldset className="flex flex-col gap-4">
                <legend className="mb-3 text-label font-bold">{t("templates")}</legend>
                {cloze && <p className="text-label text-muted-foreground">{t("clozeTemplate")}</p>}
                <div role="group" aria-label={t("templates")} className="flex flex-wrap gap-2">
                  {list.state.value.map((template, i) => (
                    <Button
                      key={template.key}
                      variant={i === index ? "secondary" : "ghost"}
                      size="lg"
                      aria-pressed={i === index}
                      onClick={() => setSelected(i)}
                    >
                      {template.name || "…"}
                    </Button>
                  ))}
                  {!cloze && (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => {
                        const n = list.state.value.length + 1;
                        list.pushValue(
                          keyed({
                            name: t("newTemplate", { number: String(n) }),
                            front: `{{${list.form.state.values.fields[0]?.name ?? ""}}}`,
                            back: '{{FrontSide}}<hr id="answer">',
                          }),
                        );
                        setSelected(n - 1);
                      }}
                    >
                      {t("addTemplate")}
                    </Button>
                  )}
                </div>
                {current && (
                  <div key={index} className="flex flex-col gap-4">
                    <div className="flex items-end gap-2">
                      <form.Field name={`templates[${index}].name`}>
                        {(field) => (
                          <TextField
                            label={t("templateName")}
                            className="flex-1"
                            value={field.state.value}
                            onChange={field.handleChange}
                          />
                        )}
                      </form.Field>
                      {!cloze && (
                        <Reorder
                          t={t}
                          name={current.name}
                          index={index}
                          count={list.state.value.length}
                          onMove={(to) => {
                            list.moveValue(index, to);
                            setSelected(to);
                          }}
                          onRemove={() => {
                            list.removeValue(index);
                            setSelected(Math.max(0, index - 1));
                          }}
                        />
                      )}
                    </div>
                    {(["front", "back"] as const).map((side) => (
                      <form.Field key={side} name={`templates[${index}].${side}`}>
                        {(field) => (
                          <TextField
                            label={t(side === "front" ? "frontTemplate" : "backTemplate")}
                            kind="code"
                            value={field.state.value}
                            onChange={field.handleChange}
                          />
                        )}
                      </form.Field>
                    ))}
                  </div>
                )}
              </fieldset>
            );
          }}
        </form.Field>
        <form.Field name="css">
          {(field) => (
            <TextField
              label={t("css")}
              kind="code"
              value={field.state.value}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values}>
          {(draft) => {
            const edit = editOf(draft);
            const problems = noteTypeProblems(type, edit);
            const messages = [...new Set(problems.map((p) => `problem_${p.problem}` as const))];
            return (
              <div className="flex flex-col gap-3">
                {messages.length > 0 && (
                  <ul aria-label={t("save")} className="flex flex-col gap-1">
                    {messages.map((key) => (
                      <li key={key} className="text-body text-destructive">
                        {t(key satisfies EditingKey)}
                      </li>
                    ))}
                  </ul>
                )}
                {pending ? (
                  <Confirm
                    key="pending"
                    label={t("save")}
                    question={t("impact", {
                      lost: String(pending.impact.valuesLost),
                      removed: String(pending.impact.cardsRemoved),
                      added: String(pending.impact.cardsAdded),
                    })}
                    confirm={t("confirmSave")}
                    cancel={t("cancel")}
                    destructive
                    asking
                    onConfirm={() => void save(pending.edit)}
                    onCancel={() => setPending(undefined)}
                  />
                ) : (
                  <Button
                    type="submit"
                    size="lg"
                    className="self-start"
                    disabled={problems.length > 0 || status === "saving"}
                  >
                    {status === "saving" ? t("saving") : t("save")}
                  </Button>
                )}
                {status === "failed" && <Notice tone="error">{t("saveFailed")}</Notice>}
              </div>
            );
          }}
        </form.Subscribe>
      </div>
      <form.Subscribe selector={(state) => state.values}>
        {(draft) => {
          const edit = editOf(draft);
          const preview = editedNoteType(type, edit);
          const note = previewNote(type, edit, sample);
          const ordinal = cloze ? 0 : Math.min(selected, edit.templates.length - 1);
          return (
            <section
              aria-labelledby="preview"
              className="flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start"
            >
              <h2 id="preview" className="text-label font-bold">
                {t("preview")}
              </h2>
              {(["front", "back"] as const).map((side) => (
                <CardFrame
                  key={side}
                  title={t(side === "front" ? "previewFront" : "previewBack")}
                  note={note}
                  type={preview}
                  ordinal={Math.max(0, ordinal)}
                  side={side}
                  className="min-h-48 border border-border"
                />
              ))}
            </section>
          );
        }}
      </form.Subscribe>
    </form>
  );
}

/** Up, down and remove for one item of a list. */
function Reorder({
  t,
  name,
  index,
  count,
  onMove,
  onRemove,
}: {
  t: EditingT;
  name: string;
  index: number;
  count: number;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex gap-1 pb-1">
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={t("moveUp", { name })}
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
      >
        ↑
      </Button>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={t("moveDown", { name })}
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
      >
        ↓
      </Button>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={t("remove", { name })}
        disabled={count === 1}
        onClick={onRemove}
      >
        ×
      </Button>
    </div>
  );
}
