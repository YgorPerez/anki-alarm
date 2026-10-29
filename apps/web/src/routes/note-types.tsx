import { noteTypeImpact, type NoteType } from "@app/core";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { cn } from "cn";
import { useState } from "react";

import { collectionQuery } from "#/data/queries.ts";
import { change } from "#/data/write.ts";
import { editingCopy } from "#/editing-copy.ts";
import { Notice } from "#/ui/form.tsx";
import { langSearch } from "#/lang.ts";
import { BackLink } from "#/ui/nav.tsx";
import { NoteTypeEditor } from "#/ui/note-type-editor.tsx";

export const Route = createFileRoute("/note-types")({
  validateSearch: (search: Record<string, unknown>): { type?: string } =>
    typeof search["type"] === "string" ? { type: search["type"] } : {},
  component: NoteTypes,
});

/** Changes to the type, from any tab or device, start the editor again from what's saved. */
const version = (type: NoteType) =>
  Object.values(type.fields)
    .map((f) => `${f.hlc.wallMs}.${f.hlc.counter}.${f.hlc.deviceId}`)
    .join("|");

/** Note types: their fields, card templates and CSS. Web only (the phone edits notes). */
function NoteTypes() {
  const { type: typeId, lang = "pt-BR" } = Route.useSearch();
  const t = editingCopy(lang);
  const query = useQuery(collectionQuery);
  const collection = query.data?.collection;
  const types = collection?.noteTypes ?? [];
  const type = types.find((x) => x.id === typeId) ?? types[0];
  const [saved, setSaved] = useState<string>();
  const notes = collection?.notes.filter((n) => n.fields.noteTypeId.value === type?.id) ?? [];
  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-6 p-6">
      <BackLink lang={lang} label={t("goBack")} />
      <h1 className="text-title font-bold">{t("noteTypes")}</h1>
      {!collection ? (
        <Notice tone="muted">{t("loading")}</Notice>
      ) : !type ? (
        <p className="text-body text-muted-foreground">{t("noNoteTypes")}</p>
      ) : (
        <>
          <nav aria-label={t("noteTypes")} className="flex flex-wrap gap-x-6 gap-y-2">
            {types.map((x) => (
              <Link
                key={x.id}
                to="/note-types"
                search={{ type: x.id, ...langSearch(lang) }}
                aria-current={x.id === type.id ? "page" : undefined}
                className={cn(
                  "text-body underline-offset-4 hover:underline",
                  x.id === type.id ? "font-bold text-primary-ink" : "text-foreground",
                )}
              >
                {x.fields.name.value}
              </Link>
            ))}
          </nav>
          <NoteTypeEditor
            key={`${type.id}:${version(type)}`}
            type={type}
            sample={notes[0]}
            noteCount={notes.length}
            impact={(edit) => noteTypeImpact(collection, type.id, edit)}
            locale={lang}
            onSave={async (edit) => {
              setSaved(undefined);
              await change({ kind: "editNoteType", id: type.id, edit });
              setSaved(type.id);
            }}
          />
          {saved === type.id && <Notice tone="muted">{t("saved")}</Notice>}
        </>
      )}
    </main>
  );
}
