import type { CollectionState, NoteType, Template } from "./collection.ts";

/**
 * A note type as the web's editor saves it: fields and templates in their new order. `from` is a
 * field's or template's position before the edit; a new one has none. A field renamed keeps its
 * `from`, so notes keep its values and templates follow the new name.
 */
export interface NoteTypeEdit {
  name: string;
  fields: { name: string; from?: number }[];
  templates: (Template & { from?: number })[];
  css: string;
}
export type NoteTypeProblem =
  | { problem: "name" | "noFields" | "noTemplates" | "clozeTemplates" }
  | {
      problem: "fieldName" | "duplicateField" | "source" | "templateName" | "front";
      index: number;
    };
/** What an edit would do to the notes of the type, for the editor to confirm before saving. */
export interface NoteTypeImpact {
  notes: number;
  /** Values that aren't empty in the fields the edit removes. */
  valuesLost: number;
  cardsAdded: number;
  cardsRemoved: number;
}

/** The edit that changes nothing: where the editor starts. */
export const noteTypeEditOf = (type: NoteType): NoteTypeEdit => ({
  name: type.fields.name.value,
  fields: type.fields.fieldNames.value.map((name, from) => ({ name, from })),
  templates: type.fields.templates.value.map((template, from) => ({ ...template, from })),
  css: type.fields.css.value,
});

/** Anki's rule: no `:`, `"`, `{` or `}`, and no leading `#`, `/` or `^`, which mean sections. */
const validFieldName = (name: string) => Boolean(name) && !/[:"{}]|^[#/^]/.test(name);
const sources = (items: readonly { from?: number }[], count: number) => {
  const seen = new Set<number>();
  return items.map(({ from }) => {
    if (from === undefined) return true;
    const ok = Number.isInteger(from) && from >= 0 && from < count && !seen.has(from);
    seen.add(from);
    return ok;
  });
};

/** Everything that keeps an edit from saving, in the order the form shows them. */
export function noteTypeProblems(type: NoteType, edit: NoteTypeEdit): NoteTypeProblem[] {
  const problems: NoteTypeProblem[] = [];
  if (!edit.name.trim()) problems.push({ problem: "name" });
  if (!edit.fields.length) problems.push({ problem: "noFields" });
  const fieldSources = sources(edit.fields, type.fields.fieldNames.value.length);
  const names = new Set<string>();
  edit.fields.forEach((field, index) => {
    const name = field.name.trim();
    if (!validFieldName(name)) problems.push({ problem: "fieldName", index });
    else if (names.has(name.toLowerCase())) problems.push({ problem: "duplicateField", index });
    else if (!fieldSources[index]) problems.push({ problem: "source", index });
    names.add(name.toLowerCase());
  });
  if (!edit.templates.length) problems.push({ problem: "noTemplates" });
  if (type.fields.kind.value === "cloze" && edit.templates.length > 1)
    problems.push({ problem: "clozeTemplates" });
  const templateSources = sources(edit.templates, type.fields.templates.value.length);
  const templateNames = new Set<string>();
  edit.templates.forEach((template, index) => {
    const name = template.name.trim().toLowerCase();
    if (!name || templateNames.has(name)) problems.push({ problem: "templateName", index });
    else if (!template.front.trim()) problems.push({ problem: "front", index });
    else if (!templateSources[index]) problems.push({ problem: "source", index });
    templateNames.add(name);
  });
  return problems;
}

/** `{{Field}}`, `{{#Field}}`, `{{/Field}}`, `{{^Field}}` and `{{filter:Field}}`. */
const REFERENCE = /\{\{(\s*[#^/]?\s*(?:[^{}:]*:)*\s*)([^{}:]+?)(\s*)\}\}/g;
/** A template with every reference to a renamed field following its new name. */
export const renameFieldReferences = (template: string, renames: ReadonlyMap<string, string>) =>
  renames.size
    ? template.replace(REFERENCE, (whole, before: string, name: string, after: string) => {
        const renamed = renames.get(name);
        return renamed === undefined ? whole : `{{${before}${renamed}${after}}}`;
      })
    : template;

/** The fields an edit renames: old name to new name. */
export const fieldRenames = (type: NoteType, edit: NoteTypeEdit) =>
  new Map(
    edit.fields.flatMap(({ name, from }) => {
      const old = from === undefined ? undefined : type.fields.fieldNames.value[from];
      return old !== undefined && old !== name.trim() ? [[old, name.trim()] as const] : [];
    }),
  );

export function noteTypeImpact(
  state: CollectionState,
  id: string,
  edit: NoteTypeEdit,
): NoteTypeImpact {
  const type = state.noteTypes.find((t) => t.id === id);
  if (!type) throw new Error("Invalid note type");
  const notes = state.notes.filter((n) => n.fields.noteTypeId.value === id);
  const noteIds = new Set(notes.map((n) => n.id));
  const kept = new Set(edit.fields.map((f) => f.from));
  const valuesLost = notes.flatMap((n) =>
    n.values.filter((v, i) => !kept.has(i) && v.value.trim()),
  ).length;
  if (type.fields.kind.value === "cloze")
    return { notes: notes.length, valuesLost, cardsAdded: 0, cardsRemoved: 0 };
  const templates = new Set(edit.templates.map((t) => t.from));
  const cardsRemoved = state.cards.filter(
    (c) => noteIds.has(c.fields.noteId.value) && !templates.has(c.fields.ordinal.value),
  ).length;
  const added = edit.templates.filter((t) => t.from === undefined).length;
  return { notes: notes.length, valuesLost, cardsAdded: added * notes.length, cardsRemoved };
}
