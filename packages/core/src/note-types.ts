import type { CollectionState, Note, NoteType, Template } from "./collection.ts";

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
const renameFieldReferences = (template: string, renames: ReadonlyMap<string, string>) =>
  renames.size
    ? template.replace(REFERENCE, (whole, before: string, name: string, after: string) => {
        const renamed = renames.get(name);
        return renamed === undefined ? whole : `{{${before}${renamed}${after}}}`;
      })
    : template;

/** The fields an edit renames: old name to new name. */
const fieldRenames = (type: NoteType, edit: NoteTypeEdit) =>
  new Map(
    edit.fields.flatMap(({ name, from }) => {
      const old = from === undefined ? undefined : type.fields.fieldNames.value[from];
      return old !== undefined && old !== name.trim() ? [[old, name.trim()] as const] : [];
    }),
  );

/** The note type as the edit would leave it, for a preview before saving. */
export function editedNoteType(type: NoteType, edit: NoteTypeEdit): NoteType {
  const renames = fieldRenames(type, edit);
  const field = <T>(value: T) => ({ value, hlc: type.fields.name.hlc });
  return {
    ...type,
    fields: {
      ...type.fields,
      name: field(edit.name.trim()),
      fieldNames: field(edit.fields.map((f) => f.name.trim())),
      templates: field(
        edit.templates.map((t) => ({
          name: t.name.trim(),
          front: renameFieldReferences(t.front, renames),
          back: renameFieldReferences(t.back, renames),
        })),
      ),
      css: field(edit.css),
    },
  };
}
/** A note's values moved to the fields of an edit, new fields empty. */
export const editedValues = (values: readonly { value: string }[], edit: NoteTypeEdit) =>
  edit.fields.map(({ from }) => (from === undefined ? "" : (values[from]?.value ?? "")));

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

/** A note type a new note can take: its id (empty for Basic, made on first use) and fields. */
export interface NoteTypeChoice {
  id: string;
  name: string;
  fieldNames: string[];
}
const BASIC: NoteTypeChoice = { id: "", name: "Basic", fieldNames: ["Front", "Back"] };
/** The note types a note editor offers; Basic when the collection has none yet. */
export const noteTypeChoices = (types: readonly NoteType[]): NoteTypeChoice[] =>
  types.length
    ? types.map((type) => ({
        id: type.id,
        name: type.fields.name.value,
        fieldNames: type.fields.fieldNames.value,
      }))
    : [BASIC];
/** What a note editor holds: the note type, the deck of the note's cards, and the values. */
export interface NoteDraft {
  /** Empty for Basic in a collection that has no note type yet: Core makes it. */
  noteTypeId: string;
  deckId: string;
  values: string[];
}
/** Where a note editor starts: the note's type and values, or a new note's first type. */
export function noteDraft(
  choices: readonly NoteTypeChoice[],
  note: Note | undefined,
  deckId: string,
): { type: NoteTypeChoice; draft: NoteDraft } {
  const type = choices.find((c) => c.id === note?.fields.noteTypeId.value) ?? choices[0] ?? BASIC;
  const values = type.fieldNames.map((_, i) => note?.values[i]?.value ?? "");
  return { type, draft: { noteTypeId: type.id, deckId, values } };
}
/** Basic's two fields, which the apps label in the UI's language; undefined for any other. */
export const basicField = (type: NoteTypeChoice, name: string) =>
  type.name !== "Basic"
    ? undefined
    : name === "Front"
      ? ("front" as const)
      : name === "Back"
        ? ("back" as const)
        : undefined;
