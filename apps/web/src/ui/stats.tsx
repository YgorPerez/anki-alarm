// The stats page's pieces, drawn with TanStack Charts' DOM host. The chart definitions, copy and
// text come from `@app/stats-ui`, which the phone draws with its React Native host.
import {
  chartDefinition,
  GRADE_INK,
  GRADES,
  type BarChart,
  type Paint,
  type RetentionTable as Table,
  type StatsCopy,
  type WakeUpScope,
} from "@app/stats-ui";
import { Chart } from "@tanstack/charts/react";

/** The theme's CSS variables: the chart follows the theme and the color scheme like the page. */
const paint: Paint = (token) => `var(--color-${token})`;
const HEIGHT = 180;

/** A grade or count chart, as wide as its column. */
export function StatsChart({ chart }: { chart: BarChart }) {
  return (
    <Chart
      definition={chartDefinition(chart, paint)}
      ariaLabel={chart.label}
      height={HEIGHT}
      initialWidth={576}
      className="w-full text-label text-muted-foreground"
    />
  );
}

/** Each grade's swatch and name in its ink: the key to a grade chart. */
const LEGEND = {
  again: { swatch: "size-3 rounded-full bg-again", ink: "text-label text-again-ink" },
  hard: { swatch: "size-3 rounded-full bg-hard", ink: "text-label text-hard-ink" },
  good: { swatch: "size-3 rounded-full bg-good", ink: "text-label text-primary-ink" },
  easy: { swatch: "size-3 rounded-full bg-easy", ink: "text-label text-easy-ink" },
} as const satisfies Record<keyof typeof GRADE_INK, { swatch: string; ink: string }>;
export function GradeLegend({ t }: { t: StatsCopy }) {
  return (
    <ul className="flex flex-wrap gap-4">
      {GRADES.map((grade) => (
        <li key={grade} className="flex items-center gap-2">
          <span aria-hidden className={LEGEND[grade].swatch} />
          <span className={LEGEND[grade].ink}>{t(grade)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Anki's true retention table: young, mature and total per period. */
export function RetentionTable({ table, caption }: { table: Table; caption: string }) {
  return (
    <table className="w-full border-collapse">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border">
          <td />
          {table.columns.map((column) => (
            <th key={column} scope="col" className="py-2 text-right text-label font-bold">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row) => (
          <tr key={row.period} className="border-b border-border">
            <th scope="row" className="py-2 text-left text-label font-normal text-muted-foreground">
              {row.period}
            </th>
            {row.cells.map((cell) => (
              <td key={cell.label} className="py-2 text-right tabular-nums">
                <span
                  className={cell.total ? "block text-body font-bold" : "block text-body"}
                  aria-label={cell.label}
                >
                  {cell.value}
                </span>
                <span className="block text-caption text-muted-foreground">{cell.detail}</span>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Wake-up stats: every alarm together, then each alarm that rang or was missed. */
export function WakeUpScopes({ scopes, t }: { scopes: readonly WakeUpScope[]; t: StatsCopy }) {
  if (scopes.length === 0) return <p className="text-body text-muted-foreground">{t("noRings")}</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {scopes.map((scope) => (
        <li key={scope.key} aria-label={scope.name} className="rounded-lg bg-surface p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-body font-bold">{scope.name}</h3>
            <span className="text-label text-muted-foreground tabular-nums">{scope.rang}</span>
          </div>
          <dl>
            {scope.rows.map((row) => (
              <div key={row.label} className="flex min-h-10 items-center justify-between gap-3">
                <dt className="text-label text-muted-foreground">{row.label}</dt>
                <dd className="text-body font-bold tabular-nums">{row.value}</dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}
