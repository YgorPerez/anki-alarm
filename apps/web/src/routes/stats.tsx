import { studyStats, wakeUpStats } from "@app/core";
import { STATS_PERIODS, statsCopy, studySections, wakeUpScopes } from "@app/stats-ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { statsQuery } from "#/data/queries.ts";
import { GradeLegend, RetentionTable, StatsChart, WakeUpScopes } from "#/ui/stats.tsx";

type Search = { deck?: string; days?: number };
const PERIOD_DAYS: ReadonlySet<number> = new Set(STATS_PERIODS.map((period) => period.days));

// Deck and period are search parameters, so one precached /stats page serves every view offline.
export const Route = createFileRoute("/stats")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    ...(typeof search["deck"] === "string" ? { deck: search["deck"] } : {}),
    ...(typeof search["days"] === "number" && PERIOD_DAYS.has(search["days"])
      ? { days: search["days"] }
      : {}),
  }),
  component: Stats,
});

const CHIP = "flex min-h-12 items-center rounded-full bg-surface px-5 text-body text-foreground";
const SELECTED =
  "flex min-h-12 items-center rounded-full bg-primary-tint px-5 text-body font-bold text-primary-ink";

/** The phone's stats, from the same Core functions: wake-up first, then study, by deck and period. */
function Stats() {
  const { deck: deckId, days = 30, lang = "pt-BR" } = Route.useSearch();
  const t = statsCopy(lang);
  const query = useQuery(statsQuery);
  const data = query.data;
  const language = lang === "en" ? { lang } : {};
  const chip = (selected: boolean, search: Search, label: string, key: string) => (
    <li key={key}>
      <Link
        to="/stats"
        search={{ ...search, ...language }}
        aria-current={selected ? "true" : undefined}
        className={selected ? SELECTED : CHIP}
      >
        {label}
      </Link>
    </li>
  );
  const period = days === 30 ? {} : { days };
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 p-6">
      <nav>
        <Link
          to="/"
          search={language}
          className="text-label text-primary-ink underline underline-offset-4"
        >
          ‹ {t("back")}
        </Link>
      </nav>
      <h1 className="text-title font-bold">{t("stats")}</h1>
      <ul aria-label={t("deck")} className="flex flex-wrap gap-2">
        {chip(!deckId, period, t("allDecks"), "all")}
        {data?.collection.decks.map((deck) =>
          chip(deck.id === deckId, { ...period, deck: deck.id }, deck.fields.name.value, deck.id),
        )}
      </ul>
      <ul aria-label={t("period")} className="flex flex-wrap gap-2">
        {STATS_PERIODS.map((option) =>
          chip(
            option.days === days,
            {
              ...(deckId ? { deck: deckId } : {}),
              ...(option.days === 30 ? {} : { days: option.days }),
            },
            t(option.label),
            String(option.days),
          ),
        )}
      </ul>
      {data ? (
        <>
          {deckId ? null : (
            <Section title={t("wakeUp")} hint={t("wakeUpHint")}>
              <WakeUpScopes
                scopes={wakeUpScopes(
                  wakeUpStats(data.events, data.log, { now: data.now, days }),
                  data.alarms,
                  t,
                  lang,
                )}
                t={t}
              />
            </Section>
          )}
          {studySections(
            studyStats(data.collection, data.log, {
              now: data.now,
              days,
              ...(deckId ? { deckId } : {}),
            }),
            t,
          ).map((section) => (
            <Section key={section.title} title={section.title} hint={section.hint}>
              {section.notice ? (
                <p className="text-body text-muted-foreground">{section.notice}</p>
              ) : null}
              {section.body.kind === "retention" ? (
                <RetentionTable table={section.body.table} caption={section.title} />
              ) : (
                <StatsChart chart={section.body} />
              )}
              {section.legend ? <GradeLegend t={t} /> : null}
            </Section>
          ))}
        </>
      ) : query.isError ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-body text-destructive">
            {t("loadError")}
          </p>
          <button
            type="button"
            className={CHIP}
            onClick={() => {
              void query.refetch();
            }}
          >
            {t("retry")}
          </button>
        </div>
      ) : (
        <p className="text-body text-muted-foreground">{t("loading")}</p>
      )}
    </main>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string | null;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="text-body font-bold">{title}</h2>
      {hint ? <p className="text-label text-muted-foreground">{hint}</p> : null}
      {children}
    </section>
  );
}
