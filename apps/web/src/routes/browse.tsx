import {
  browseCards,
  cardMemory,
  cardsStayInApp,
  type CollectionState,
  type LogEntry,
  type Locale,
} from "@app/core";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { collectionQuery } from "#/data/queries.ts";
import { change, write } from "#/data/write.ts";
import { editingCopy, type EditingT } from "#/editing-copy.ts";
import { CardActions } from "#/ui/card-actions.tsx";
import { CardBrowser } from "#/ui/card-browser.tsx";
import { Confirm } from "#/ui/confirm.tsx";
import { Notice } from "#/ui/form.tsx";
import { BackLink } from "#/ui/nav.tsx";
import { NoteEditor } from "#/ui/note-editor.tsx";

interface BrowseSearch {
  /** The search. */
  q?: string;
  /** The note being edited. */
  note?: string;
  /** Adding a note to this deck. */
  add?: string;
}
const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

/** The search with `patch` applied; an empty value leaves the URL. */
const searchWith = (
  search: BrowseSearch & { lang?: Locale },
  patch: { [K in keyof BrowseSearch]?: string | undefined },
) => {
  const { lang } = search;
  const [q, note, add] = (["q", "note", "add"] as const).map((key) =>
    key in patch ? patch[key] : search[key],
  );
  return { ...(lang && { lang }), ...(q && { q }), ...(note && { note }), ...(add && { add }) };
};

export const Route = createFileRoute("/browse")({
  validateSearch: (search: Record<string, unknown>): BrowseSearch => {
    const [q, note, add] = [text(search["q"]), text(search["note"]), text(search["add"])];
    return { ...(q && { q }), ...(note && { note }), ...(add && { add }) };
  },
  component: Browse,
});

/** The card browser beside the note editor: search, pick a card, edit its note. */
function Browse() {
  const search = Route.useSearch();
  const { q = "", lang = "pt-BR" } = search;
  const t = editingCopy(lang);
  const navigate = useNavigate({ from: "/browse" });
  const query = useQuery(collectionQuery);
  const rows = query.data && browseCards(query.data.collection, q);
  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-6 p-6">
      <BackLink lang={lang} label={t("goBack")} />
      <h1 className="text-title font-bold">{t("browser")}</h1>
      <div className="grid gap-8 lg:grid-cols-2">
        <CardBrowser
          rows={rows}
          query={q}
          selected={search.note}
          locale={lang}
          onQuery={(next) =>
            void navigate({ search: (s) => searchWith(s, { q: next }), replace: true })
          }
          onSelect={(row) =>
            void navigate({ search: (s) => searchWith(s, { note: row.noteId, add: undefined }) })
          }
        />
        <aside className="flex flex-col gap-6 lg:sticky lg:top-6 lg:self-start">
          {query.data ? (
            <NotePanel
              collection={query.data.collection}
              log={query.data.log}
              now={query.data.now}
              noteId={search.note}
              addTo={search.add}
              lang={lang}
              t={t}
              onDeleted={() => void navigate({ search: (s) => searchWith(s, { note: undefined }) })}
            />
          ) : (
            <Notice tone="muted">{t("loading")}</Notice>
          )}
        </aside>
      </div>
    </main>
  );
}

function NotePanel({
  collection,
  log,
  now,
  noteId,
  addTo,
  lang,
  t,
  onDeleted,
}: {
  collection: CollectionState;
  log: readonly LogEntry[];
  now: number;
  noteId: string | undefined;
  addTo: string | undefined;
  lang: Locale;
  t: EditingT;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const note = collection.notes.find((n) => n.id === noteId);
  const addDeck = collection.decks.find((d) => d.id === addTo);
  if (!note && addDeck)
    return (
      <section aria-labelledby="note" className="flex flex-col gap-4">
        <h2 id="note" className="text-label font-bold">
          {t("addNote")}
        </h2>
        <NoteEditor
          key={addDeck.id}
          noteTypes={collection.noteTypes}
          decks={collection.decks}
          deckId={addDeck.id}
          locale={lang}
          onSave={async (draft) => {
            await change({ kind: "addNote", ...draft });
          }}
        />
      </section>
    );
  if (!note) return <p className="text-body text-muted-foreground">{t("chooseNote")}</p>;
  const type = collection.noteTypes.find((x) => x.id === note.fields.noteTypeId.value);
  const cards = collection.cards
    .filter((c) => c.fields.noteId.value === note.id)
    // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 target; sorts a fresh array.
    .sort((a, b) => a.fields.ordinal.value - b.fields.ordinal.value);
  const cloze = type?.fields.kind.value === "cloze";
  /** Card actions, one at a time; the screen keeps what it had when one fails. */
  const act = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setFailed(false);
    try {
      await task();
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };
  return (
    <section aria-labelledby="note" className="flex flex-col gap-6">
      <h2 id="note" className="text-label font-bold">
        {t("edit")}
      </h2>
      <NoteEditor
        key={note.id}
        note={note}
        noteTypes={collection.noteTypes}
        decks={collection.decks}
        deckId={cards[0]?.fields.deckId.value ?? ""}
        locale={lang}
        onSave={async ({ values, deckId }) => {
          await change({ kind: "editNote", id: note.id, values, ...(deckId ? { deckId } : {}) });
        }}
      />
      <CardActions
        cards={cards.map((card) => ({
          id: card.id,
          name: cloze
            ? `Cloze ${card.fields.ordinal.value + 1}`
            : (type?.fields.templates.value[card.fields.ordinal.value]?.name ?? ""),
          memory: cardMemory(collection, log, card.id, now),
        }))}
        locale={lang}
        busy={busy}
        linked={cardsStayInApp(collection, cards)}
        onForget={(cardId) => void act(() => write("forgetCard", cardId))}
        onSetDueDate={(cardId, days) => void act(() => write("setDueDate", cardId, days))}
      />
      <Confirm
        label={t("deleteNote")}
        question={t("deleteNoteConfirm", { count: String(cards.length) })}
        confirm={t("delete")}
        cancel={t("cancel")}
        destructive
        disabled={busy}
        onConfirm={() =>
          void act(async () => {
            await change({ kind: "deleteNotes", ids: [note.id] });
            onDeleted();
          })
        }
      />
      {failed && <Notice tone="error">{t("saveFailed")}</Notice>}
    </section>
  );
}
