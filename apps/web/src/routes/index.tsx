import type { Locale } from "@app/core";
import { statsCopy } from "@app/stats-ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useLayoutEffect, useRef, useState } from "react";

import { copy, type T } from "#/copy.ts";
import { decksQuery } from "#/data/queries.ts";
import { editingCopy } from "#/editing-copy.ts";
import { AccountPanel } from "#/ui/account-panel.tsx";
import { ApkgImport } from "#/ui/apkg-import.tsx";
import { langSearch } from "#/lang.ts";
import { Button } from "#/ui/shadcn/button.tsx";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const { lang = "pt-BR" } = Route.useSearch();
  const t = copy(lang);
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-8 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-title font-bold">{t("title")}</h1>
        <p className="text-body text-muted-foreground">{t("tagline")}</p>
      </header>
      <DeckList lang={lang} t={t} />
      <EditorLinks lang={lang} />
      <AccountPanel locale={lang} />
      <nav className="flex flex-wrap items-center gap-6">
        <Button
          size="lg"
          variant="outline"
          nativeButton={false}
          render={<Link to="/" search={lang === "en" ? {} : { lang: "en" }} />}
        >
          {t("switchLanguage")}
        </Button>
        <Link
          to="/settings/theme"
          search={lang === "en" ? { lang } : {}}
          className="text-label text-primary-ink underline underline-offset-4"
        >
          {t("theme")}
        </Link>
        <Link
          to="/stats"
          search={lang === "en" ? { lang } : {}}
          className="text-label text-primary-ink underline underline-offset-4"
        >
          {statsCopy(lang)("stats")}
        </Link>
      </nav>
    </main>
  );
}

const ROW_HEIGHT = 72;

/** The decks, virtualized against the window: a big collection only renders what's on screen. */
function DeckList({ lang, t }: { lang: Locale; t: T }) {
  // React Compiler would keep the list's height from the first render: the virtualizer object
  // never changes, though what it measures does.
  "use no memo";
  const edit = editingCopy(lang);
  const decks = useQuery(decksQuery);
  const list = useRef<HTMLUListElement>(null);
  // Where the list starts on the page, for the window's scroll position.
  const [top, setTop] = useState(0);
  useLayoutEffect(() => setTop(list.current?.offsetTop ?? 0), []);
  const rows = decks.data ?? [];
  // oxlint-disable-next-line react/incompatible-library -- TanStack Virtual: this list re-renders on scroll by design.
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
    scrollMargin: top,
  });
  return (
    <section aria-labelledby="decks" className="flex flex-col gap-3">
      <h2 id="decks" className="text-label font-bold">
        {t("decks")}
      </h2>
      {decks.isSuccess && rows.length === 0 && (
        <p className="text-body text-muted-foreground">{t("noDecks")}</p>
      )}
      <ul
        ref={list}
        className="relative"
        style={{ height: virtualizer.getTotalSize() }}
        aria-label={t("decks")}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const deck = rows[item.index]!;
          return (
            <li
              key={deck.id}
              className="absolute inset-x-0 top-0"
              style={{
                height: item.size,
                transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              <div className="flex h-full items-center gap-4 border-b border-border px-1">
                <Link
                  to="/study"
                  search={{ deck: deck.id, ...langSearch(lang) }}
                  className="flex h-full min-w-0 flex-1 items-center justify-between gap-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="truncate text-body font-bold">{deck.name}</span>
                  <span
                    className={
                      deck.due > 0
                        ? "shrink-0 text-label text-attention"
                        : "shrink-0 text-label text-muted-foreground"
                    }
                  >
                    {deck.due > 0 ? t("dueToday", { count: String(deck.due) }) : t("nothingDue")}
                  </span>
                </Link>
                <Link
                  to="/deck"
                  search={{ deck: deck.id, ...langSearch(lang) }}
                  aria-label={edit("editDeck", { name: deck.name })}
                  className="shrink-0 text-label text-primary-ink underline underline-offset-4"
                >
                  {edit("edit")}
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** New deck, the card browser, note types and import. */
function EditorLinks({ lang }: { lang: Locale }) {
  const t = editingCopy(lang);
  const link = "text-label text-primary-ink underline underline-offset-4";
  return (
    <section className="flex flex-col items-start gap-4">
      <nav aria-label={t("edit")} className="flex flex-wrap gap-x-6 gap-y-2">
        <Link to="/deck" search={langSearch(lang)} className={link}>
          {t("newDeck")}
        </Link>
        <Link to="/browse" search={langSearch(lang)} className={link}>
          {t("browser")}
        </Link>
        <Link to="/note-types" search={langSearch(lang)} className={link}>
          {t("noteTypes")}
        </Link>
      </nav>
      <ApkgImport locale={lang} />
    </section>
  );
}
