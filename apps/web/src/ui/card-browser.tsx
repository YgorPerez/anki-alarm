import type { BrowseRow, Locale } from "@app/core";
import { Debouncer } from "@tanstack/pacer";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { cn } from "cn";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { editingCopy } from "#/editing-copy.ts";
import { Field, Input } from "#/ui/form.tsx";

/** How long typing pauses before the browser searches. */
const SEARCH_MS = 250;
const ROW_HEIGHT = 76;

/**
 * Search and the cards it finds, virtualized against the window so a big collection only renders
 * what's on screen. Typing searches once it pauses.
 */
export function CardBrowser({
  rows,
  query,
  selected,
  locale,
  onQuery,
  onSelect,
}: {
  rows: readonly BrowseRow[] | undefined;
  /** The search when the browser opens; typing changes it through `onQuery`. */
  query: string;
  /** The note being edited. */
  selected: string | undefined;
  locale: Locale;
  onQuery: (query: string) => void;
  onSelect: (row: BrowseRow) => void;
}) {
  // React Compiler would keep the list's height from the first render (see DeckList).
  "use no memo";
  const t = editingCopy(locale);
  // Pacer: one search after typing pauses, not one per key.
  const [search] = useState(() => new Debouncer(onQuery, { wait: SEARCH_MS }));
  useEffect(() => () => search.cancel(), [search]);
  const list = useRef<HTMLUListElement>(null);
  const [top, setTop] = useState(0);
  useLayoutEffect(() => setTop(list.current?.offsetTop ?? 0), []);
  const items = rows ?? [];
  // oxlint-disable-next-line react/incompatible-library -- TanStack Virtual: this list re-renders on scroll by design.
  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    scrollMargin: top,
  });
  return (
    <section aria-label={t("browser")} className="flex flex-col gap-4">
      <Field label={t("search")} hint={t("searchHint")}>
        {(props) => (
          <Input
            {...props}
            type="search"
            defaultValue={query}
            onChange={(event) => search.maybeExecute(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") search.flush();
            }}
          />
        )}
      </Field>
      {rows && (
        <p role="status" className="text-label text-muted-foreground">
          {rows.length ? t("results", { count: String(rows.length) }) : t("noResults")}
        </p>
      )}
      <ul
        ref={list}
        aria-label={t("cards")}
        className="relative"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const row = items[item.index]!;
          const current = row.noteId === selected;
          return (
            <li
              key={row.cardId}
              className="absolute inset-x-0 top-0"
              style={{
                height: item.size,
                transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              <button
                type="button"
                aria-current={current || undefined}
                onClick={() => onSelect(row)}
                className={cn(
                  "flex h-full w-full flex-col justify-center gap-0.5 border-b border-border px-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  current && "bg-primary-tint",
                )}
              >
                <span className="truncate text-body font-bold">{row.question || "…"}</span>
                <span className="truncate text-label text-muted-foreground">
                  {[
                    row.deck,
                    row.card,
                    row.suspended ? t("suspended") : "",
                    row.buried ? t("buried") : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
