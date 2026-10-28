// Stats charts, drawn with TanStack Charts' React Native host over react-native-svg. That host is
// experimental: if it fails on a phone, only these components change.
import type { Locale, RetentionRow, Tally, Theme } from "@app/core";
import { barY } from "@tanstack/charts/bar";
import { Chart } from "@tanstack/charts/react-native";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { defineChart } from "@tanstack/charts/scene";
import { stack } from "@tanstack/charts/stack";
import { Text, View, useWindowDimensions } from "react-native";
import type { StatsCopy } from "./stats-copy.ts";

const GRADES = ["again", "hard", "good", "easy"] as const;
type GradeName = (typeof GRADES)[number];
const regular = { fontFamily: "AtkinsonHyperlegible_400Regular" };
const bold = { fontFamily: "AtkinsonHyperlegible_700Bold" };
const HEIGHT = 180;

function useChartProps(label: string, theme: Theme, locale: Locale) {
  const { width, fontScale } = useWindowDimensions();
  return {
    accessibilityLabel: label,
    // The screen's 24px side margins.
    width: Math.max(160, width - 48),
    height: HEIGHT * Math.min(fontScale, 1.3),
    color: theme["muted-foreground"],
    focusFill: theme.background,
    fontFamily: regular.fontFamily,
    fontScale,
    locale,
  };
}
/** Every x keeps its slot, so a day without answers is a gap, not a missing day. */
const axes = (theme: Theme, xs: readonly number[], format: (value: number) => string) =>
  ({
    x: {
      scale: () => scaleBand<number>().domain(xs).padding(0.15),
      axis: { line: { stroke: theme.border }, ticks: { size: 0, format } },
    },
    y: {
      scale: scaleLinear,
      nice: true,
      grid: { stroke: theme.border },
      axis: { line: false, ticks: { size: 0, format: (n: number) => String(n) } },
    },
  }) as const;

/** Bars stacked by grade, each grade in its hue: Again at the base, Easy on top. */
export function GradeChart({
  label,
  rows,
  format,
  theme,
  locale,
}: {
  label: string;
  rows: readonly ({ x: number } & Record<GradeName, number>)[];
  format: (x: number) => string;
  theme: Theme;
  locale: Locale;
}) {
  const props = useChartProps(label, theme, locale);
  const data = rows.flatMap((row) =>
    GRADES.map((grade) => ({ x: row.x, grade, n: row[grade] })).filter((d) => d.n > 0),
  );
  const definition = defineChart({
    marks: [
      barY(data, {
        x: "x",
        y: "n",
        z: "grade",
        fill: (d) => theme[d.grade],
        layout: stack({ order: GRADES }),
      }),
    ],
    scales: axes(
      theme,
      rows.map((row) => row.x),
      format,
    ),
  });
  return <Chart definition={definition} {...props} />;
}

/** One bar per bucket, each in the color it's given. */
export function CountChart({
  label,
  rows,
  format,
  theme,
  locale,
}: {
  label: string;
  rows: readonly { x: number; n: number; fill: string }[];
  format: (x: number) => string;
  theme: Theme;
  locale: Locale;
}) {
  const props = useChartProps(label, theme, locale);
  const definition = defineChart({
    marks: [barY(rows, { x: "x", y: "n", fill: (d) => d.fill })],
    scales: axes(
      theme,
      rows.map((row) => row.x),
      format,
    ),
  });
  return <Chart definition={definition} {...props} />;
}

// Good's ink is the primary's, as Good is the solid primary grade.
const INK = {
  again: "again-ink",
  hard: "hard-ink",
  good: "primary-ink",
  easy: "easy-ink",
} as const;
/** The grade names in their ink, the key to a grade chart. */
export function GradeLegend({ t, theme }: { t: StatsCopy; theme: Theme }) {
  return (
    <View className="flex-row flex-wrap gap-4">
      {GRADES.map((grade) => (
        <View key={grade} className="flex-row items-center gap-2">
          <View className="size-3 rounded-full" style={{ backgroundColor: theme[grade] }} />
          <Text style={[regular, { color: theme[INK[grade]] }]} className="text-label">
            {t(grade)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const percent = (tally: Tally) => (tally.rate === null ? "—" : `${Math.round(tally.rate * 100)}%`);
/** Anki's true retention table: young, mature and total per period. */
export function RetentionTable({ rows, t }: { rows: readonly RetentionRow[]; t: StatsCopy }) {
  const periods = {
    today: t("today"),
    yesterday: t("yesterday"),
    week: t("week"),
    month: t("monthPeriod"),
    year: t("yearPeriod"),
    all: t("all"),
  };
  const columns = ["young", "mature", "total"] as const;
  return (
    <View accessibilityRole="summary">
      <View className="flex-row border-b border-border py-2">
        <View className="flex-1" />
        {columns.map((column) => (
          <Text key={column} style={bold} className="flex-1 text-right text-label text-foreground">
            {t(column)}
          </Text>
        ))}
      </View>
      {rows.map((row) => (
        <View key={row.period} className="min-h-12 flex-row items-center border-b border-border">
          <Text style={regular} className="flex-1 text-label text-muted-foreground">
            {periods[row.period]}
          </Text>
          {columns.map((column) => (
            <View
              key={column}
              className="flex-1 items-end"
              accessibilityLabel={`${periods[row.period]}, ${t(column)}: ${percent(row[column])}`}
            >
              <Text
                style={column === "total" ? bold : regular}
                className="text-body text-foreground tabular-nums"
              >
                {percent(row[column])}
              </Text>
              <Text style={regular} className="text-caption text-muted-foreground tabular-nums">
                {t("of", {
                  passed: String(row[column].passed),
                  total: String(row[column].passed + row[column].failed),
                })}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
