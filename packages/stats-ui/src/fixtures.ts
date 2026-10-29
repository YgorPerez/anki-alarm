// Sample stats for both apps' chart stories: deterministic, so a story looks the same each time.
import type { RetentionRow } from "@app/core";
import type { CountChart, GradeChart } from "./charts.ts";
import type { StatsCopy } from "./copy.ts";
import { retentionTable } from "./sections.ts";

/** A month of answers that grows toward today, and the month of due cards ahead. */
export function sampleCharts(t: StatsCopy): { reviews: GradeChart; forecast: CountChart } {
  return {
    reviews: {
      kind: "grade",
      label: t("reviews"),
      rows: Array.from({ length: 30 }, (_, i) => ({
        x: i - 29,
        again: (i * 7) % 5,
        hard: (i * 3) % 4,
        good: 6 + ((i * 5) % 9) + Math.floor(i / 3),
        easy: (i * 11) % 6,
      })),
      format: (day) => (day === 0 ? t("today") : String(day)),
    },
    forecast: {
      kind: "count",
      label: t("forecast"),
      rows: Array.from({ length: 30 }, (_, day) => ({
        x: day,
        n: day === 0 ? 24 : Math.max(0, 18 - day + ((day * 7) % 6)),
        fill: "primary",
      })),
      format: (day) => (day === 0 ? t("today") : `+${day}`),
    },
  };
}

const tally = (passed: number, failed: number) => ({
  passed,
  failed,
  rate: passed + failed ? passed / (passed + failed) : null,
});
const RETENTION: RetentionRow[] = (
  [
    ["today", 12, 2, 30, 1],
    ["yesterday", 9, 3, 27, 2],
    ["week", 70, 14, 190, 12],
    ["month", 290, 51, 820, 49],
    ["year", 2400, 420, 7100, 380],
    ["all", 2600, 450, 7300, 390],
  ] as const
).map(([period, yp, yf, mp, mf]) => ({
  period,
  young: tally(yp, yf),
  mature: tally(mp, mf),
  total: tally(yp + mp, yf + mf),
}));
/** A long-time learner's true retention table. */
export const sampleRetention = (t: StatsCopy) => retentionTable(RETENTION, t);
