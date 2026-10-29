import type { Deck, Locale } from "@app/core";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import { collectionQuery } from "#/data/queries.ts";
import { webRequest } from "#/data/client.ts";
import { change } from "#/data/write.ts";
import { download } from "#/download.ts";
import { editingCopy, type EditingT } from "#/editing-copy.ts";
import { Confirm } from "#/ui/confirm.tsx";
import { DeckOptionsEditor } from "#/ui/deck-options-editor.tsx";
import { Notice, TextField } from "#/ui/form.tsx";
import { langSearch } from "#/lang.ts";
import { BackLink } from "#/ui/nav.tsx";
import { Button } from "#/ui/shadcn/button.tsx";

// No deck: the form for a new one.
export const Route = createFileRoute("/deck")({
  validateSearch: (search: Record<string, unknown>): { deck?: string } =>
    typeof search["deck"] === "string" ? { deck: search["deck"] } : {},
  component: DeckPage,
});

function DeckPage() {
  const { deck: deckId, lang = "pt-BR" } = Route.useSearch();
  const t = editingCopy(lang);
  const query = useQuery(collectionQuery);
  const deck = query.data?.collection.decks.find((d) => d.id === deckId);
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 p-6">
      <BackLink lang={lang} label={t("goBack")} />
      {!deckId ? (
        <NewDeck lang={lang} t={t} />
      ) : !query.data ? (
        <Notice tone="muted">{t("loading")}</Notice>
      ) : !deck ? (
        <Notice tone="muted">{t("deckMissing")}</Notice>
      ) : (
        <DeckEditor key={deck.id} deck={deck} lang={lang} t={t} />
      )}
    </main>
  );
}

function NewDeck({ lang, t }: { lang: Locale; t: EditingT }) {
  const navigate = useNavigate();
  return (
    <>
      <h1 className="text-title font-bold">{t("newDeck")}</h1>
      <DeckNameForm
        t={t}
        name=""
        action={t("createDeck")}
        onSave={async (name) => {
          const id = await change({ kind: "createDeck", name });
          await navigate({ to: "/deck", search: { ...(id && { deck: id }), ...langSearch(lang) } });
        }}
      />
    </>
  );
}

function DeckEditor({ deck, lang, t }: { deck: Deck; lang: Locale; t: EditingT }) {
  const navigate = useNavigate();
  const { data } = useQuery(collectionQuery);
  const collection = data!.collection;
  const name = deck.fields.name.value;
  const preset = collection.presets.find((p) => p.id === deck.fields.presetId.value);
  const sharing = collection.decks.filter((d) => d.fields.presetId.value === preset?.id).length;
  const cards = collection.cards.filter((c) => c.fields.deckId.value === deck.id).length;
  const [deleteFailed, setDeleteFailed] = useState(false);
  return (
    <>
      <h1 className="text-title font-bold">{name}</h1>
      <nav className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          size="lg"
          nativeButton={false}
          render={<Link to="/study" search={{ deck: deck.id, ...langSearch(lang) }} />}
        >
          {t("study")}
        </Button>
        <Button
          variant="outline"
          size="lg"
          nativeButton={false}
          render={<Link to="/browse" search={{ add: deck.id, ...langSearch(lang) }} />}
        >
          {t("addNote")}
        </Button>
      </nav>
      <DeckNameForm
        t={t}
        name={name}
        action={t("rename")}
        onSave={(next) => change({ kind: "renameDeck", id: deck.id, name: next }).then(() => {})}
      />
      {preset && (
        <DeckOptionsEditor
          key={preset.id}
          preset={preset}
          deckCount={sharing}
          locale={lang}
          onSave={async (options) => {
            await change({ kind: "updatePreset", id: preset.id, patch: options });
          }}
        />
      )}
      <DeckExport deckId={deck.id} t={t} />
      <section className="flex flex-col gap-3">
        <Confirm
          label={t("deleteDeck")}
          question={t("deleteDeckConfirm", { name, count: String(cards) })}
          confirm={t("delete")}
          cancel={t("cancel")}
          destructive
          onConfirm={() =>
            void change({ kind: "deleteDeck", id: deck.id }).then(
              () => navigate({ to: "/", search: langSearch(lang) }),
              () => setDeleteFailed(true),
            )
          }
        />
        {deleteFailed && <Notice tone="error">{t("saveFailed")}</Notice>}
      </section>
    </>
  );
}

function DeckNameForm({
  t,
  name,
  action,
  onSave,
}: {
  t: EditingT;
  name: string;
  action: string;
  onSave: (name: string) => Promise<void>;
}) {
  const [failed, setFailed] = useState(false);
  const form = useForm({
    defaultValues: { name },
    onSubmit: async ({ value, formApi }) => {
      setFailed(false);
      try {
        await onSave(value.name.trim());
        formApi.reset({ name: value.name.trim() });
      } catch {
        setFailed(true);
      }
    },
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field
        name="name"
        validators={{ onChange: ({ value }) => (value.trim() ? undefined : t("invalidName")) }}
      >
        {(field) => (
          <TextField
            label={t("deckName")}
            hint={t("deckNameHint")}
            errors={field.state.meta.errors}
            value={field.state.value}
            onChange={field.handleChange}
            onBlur={field.handleBlur}
          />
        )}
      </form.Field>
      <form.Subscribe
        selector={(state) => state.canSubmit && state.isDirty && Boolean(state.values.name.trim())}
      >
        {(canSubmit) => (
          <Button
            type="submit"
            variant="outline"
            size="lg"
            className="self-start"
            disabled={!canSubmit}
          >
            {action}
          </Button>
        )}
      </form.Subscribe>
      {failed && <Notice tone="error">{t("saveFailed")}</Notice>}
    </form>
  );
}

/** Downloads the deck and its subdecks as an `.apkg`, with what Anki needs to keep the schedule. */
function DeckExport({ deckId, t }: { deckId: string; t: EditingT }) {
  const [state, setState] = useState<
    { kind: "idle" | "busy" | "failed" } | { kind: "done"; name: string }
  >({ kind: "idle" });
  return (
    <section aria-labelledby="export" className="flex flex-col items-start gap-3">
      <h2 id="export" className="text-label font-bold">
        {t("exportApkg")}
      </h2>
      <p className="text-label text-muted-foreground">{t("exportHint")}</p>
      <Button
        variant="outline"
        size="lg"
        disabled={state.kind === "busy"}
        onClick={async () => {
          setState({ kind: "busy" });
          try {
            const file = await webRequest("exportApkg", deckId);
            download(file.name, file.bytes);
            setState({ kind: "done", name: file.name });
          } catch {
            setState({ kind: "failed" });
          }
        }}
      >
        {state.kind === "busy" ? t("exporting") : t("exportApkg")}
      </Button>
      {state.kind === "done" && <Notice tone="muted">{t("exported", { name: state.name })}</Notice>}
      {state.kind === "failed" && <Notice tone="error">{t("exportError")}</Notice>}
    </section>
  );
}
