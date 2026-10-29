import type { Bucket, RetentionRow, StudyStats, Tally } from "@app/core";
import type { BarChart, Token } from "./charts.ts";
import type { StatsCopy } from "./copy.ts";

/** The period chips: how many days back (and ahead, for the forecast) the stats cover. */
export const STATS_PERIODS = [
  { days: 30, label: "month" },
  { days: 90, label: "quarter" },
  { days: 365, label: "year" },
] as const;

export interface RetentionTable {
  /** Young, mature and total. */
  columns: string[];
  rows: {
    period: string;
    cells: {
      /** The cell read aloud: period, column and value. */
      label: string;
      value: string;
      /** "passed of answered". */
      detail: string;
      /** The total column, set in bold. */
      total: boolean;
    }[];
  }[];
}
export interface StudySection {
  title: string;
  hint: string | null;
  /** Said above the chart: the period has no answers. */
  notice: string | null;
  /** The grade names in their ink go under the chart. */
  legend: boolean;
  body: BarChart | { kind: "retention"; table: RetentionTable };
}

const percent = (tally: Tally) => (tally.rate === null ? "—" : `${Math.round(tally.rate * 100)}%`);
/** Anki's true retention table as text: young, mature and total per period. */
export function retentionTable(rows: readonly RetentionRow[], t: StatsCopy): RetentionTable {
  const periods = {
    today: t("today"),
    yesterday: t("yesterday"),
    week: t("week"),
    month: t("monthPeriod"),
    year: t("yearPeriod"),
    all: t("all"),
  };
  const columns = ["young", "mature", "total"] as const;
  return {
    columns: columns.map((column) => t(column)),
    rows: rows.map((row) => ({
      period: periods[row.period],
      cells: columns.map((column) => ({
        label: `${periods[row.period]}, ${t(column)}: ${percent(row[column])}`,
        value: percent(row[column]),
        detail: t("of", {
          passed: String(row[column].passed),
          total: String(row[column].passed + row[column].failed),
        }),
        total: column === "total",
      })),
    })),
  };
}

const span = ({ from, to }: Bucket) =>
  to === null ? `${from}+` : to - from === 1 ? String(from) : `${from}–${to - 1}`;
const tenth = ({ from }: Bucket) => `${Math.round(from * 100)}%`;
/** A distribution in the neutral ink, each bar labelled by its bucket. */
const distribution = (
  label: string,
  list: readonly Bucket[],
  name: (bucket: Bucket) => string,
): BarChart => ({
  kind: "count",
  label,
  rows: list.map((bucket, x) => ({ x, n: bucket.count, fill: "muted-foreground" })),
  format: (x) => (list[x] ? name(list[x]) : ""),
});
// Card states mirror the deck row: new in Easy's hue, learning in Again's, review in primary.
const STATES = [
  ["new", "easy"],
  ["learning", "again"],
  ["relearning", "again"],
  ["young", "primary"],
  ["mature", "primary"],
] as const satisfies readonly (readonly [keyof StudyStats["counts"], Token])[];

/** Every study stat, in the order both apps show them. */
export function studySections(stats: StudyStats, t: StatsCopy): StudySection[] {
  const answered = stats.reviews.some((d) => d.again + d.hard + d.good + d.easy > 0);
  const section = (
    title: string,
    body: StudySection["body"],
    hint: string | null = null,
  ): StudySection => ({ title, hint, notice: null, legend: false, body });
  return [
    {
      ...section(
        t("reviews"),
        {
          kind: "grade",
          label: t("reviews"),
          rows: stats.reviews.map(({ day, again, hard, good, easy }) => ({
            x: day,
            again,
            hard,
            good,
            easy,
          })),
          format: (day) => (day === 0 ? t("today") : String(day)),
        },
        t("reviewsHint"),
      ),
      notice: answered ? null : t("noReviews"),
      legend: true,
    },
    section(
      t("forecast"),
      {
        kind: "count",
        label: t("forecast"),
        rows: stats.forecast.map(({ day, due }) => ({ x: day, n: due, fill: "primary" })),
        format: (day) => (day === 0 ? t("today") : `+${day}`),
      },
      t("forecastHint"),
    ),
    section(
      t("retention"),
      { kind: "retention", table: retentionTable(stats.retention, t) },
      t("retentionHint"),
    ),
    section(t("counts"), {
      kind: "count",
      label: t("counts"),
      rows: STATES.map(([state, fill], x) => ({ x, n: stats.counts[state], fill })),
      format: (x) => {
        const state = STATES[x]?.[0];
        return state ? `${t(state)} ${stats.counts[state]}` : "";
      },
    }),
    section(
      t("intervals"),
      distribution(t("intervals"), stats.intervals, span),
      t("intervalsHint"),
    ),
    section(
      t("hours"),
      {
        kind: "grade",
        label: t("hours"),
        rows: stats.hours.map(({ hour, again, hard, good, easy }) => ({
          x: hour,
          again,
          hard,
          good,
          easy,
        })),
        format: (hour) => `${hour}h`,
      },
      t("hoursHint"),
    ),
    section(
      t("stability"),
      distribution(t("stability"), stats.stability, span),
      t("stabilityHint"),
    ),
    section(
      t("difficulty"),
      distribution(t("difficulty"), stats.difficulty, tenth),
      t("difficultyHint"),
    ),
    section(
      t("retrievability"),
      distribution(t("retrievability"), stats.retrievability, tenth),
      t("retrievabilityHint"),
    ),
  ];
}
