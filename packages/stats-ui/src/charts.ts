// The stats charts as host-free TanStack Charts definitions. The phone draws them with
// `@tanstack/charts/react-native`, the web with `@tanstack/charts/react`; only the host differs.
import type { Theme } from "@app/core";
import { barY } from "@tanstack/charts/bar";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { defineChart } from "@tanstack/charts/scene";
import { stack } from "@tanstack/charts/stack";

export const GRADES = ["again", "hard", "good", "easy"] as const;
export type GradeName = (typeof GRADES)[number];
/** A design token by name (DESIGN.md). */
export type Token = keyof Theme;
/** The paint a host gives a token: the derived color on the phone, the CSS variable on the web. */
export type Paint = (token: Token) => string;
/** Good's ink is the primary's, as Good is the solid primary grade. */
export const GRADE_INK = {
  again: "again-ink",
  hard: "hard-ink",
  good: "primary-ink",
  easy: "easy-ink",
} as const satisfies Record<GradeName, Token>;

/** Bars stacked by grade, each grade in its hue: Again at the base, Easy on top. */
export interface GradeChart {
  kind: "grade";
  /** The chart's accessible name. */
  label: string;
  rows: ({ x: number } & Record<GradeName, number>)[];
  format: (x: number) => string;
}
/** One bar per bucket, each in its token. */
export interface CountChart {
  kind: "count";
  label: string;
  rows: { x: number; n: number; fill: Token }[];
  format: (x: number) => string;
}
export type BarChart = GradeChart | CountChart;

/** Every x keeps its slot, so a day without answers is a gap, not a missing day. */
const axes = (paint: Paint, xs: readonly number[], format: (value: number) => string) =>
  ({
    x: {
      scale: () => scaleBand<number>().domain(xs).padding(0.15),
      axis: { line: { stroke: paint("border") }, ticks: { size: 0, format } },
    },
    y: {
      scale: scaleLinear,
      nice: true,
      grid: { stroke: paint("border") },
      axis: { line: false, ticks: { size: 0, format: (n: number) => String(n) } },
    },
  }) as const;

/** One bar segment: a grade's share of its day or hour, or a whole count bar. */
interface Segment {
  x: number;
  n: number;
  fill: Token;
  z: GradeName | "count";
}
const segments = (chart: BarChart): Segment[] =>
  chart.kind === "grade"
    ? chart.rows.flatMap((row) =>
        GRADES.map((grade) => ({ x: row.x, n: row[grade], fill: grade, z: grade }))
          // A zero-height segment would still draw an edge.
          .filter((d) => d.n > 0),
      )
    : chart.rows.map((row) => ({ ...row, z: "count" as const }));

/** The definition a host draws for `chart`: grades stack Again at the base, Easy on top. */
export const chartDefinition = (chart: BarChart, paint: Paint) =>
  defineChart({
    marks: [
      barY(segments(chart), {
        x: "x",
        y: "n",
        z: "z",
        fill: (d) => paint(d.fill),
        layout: stack({ order: [...GRADES, "count"] }),
      }),
    ],
    scales: axes(
      paint,
      chart.rows.map((row) => row.x),
      chart.format,
    ),
  });
