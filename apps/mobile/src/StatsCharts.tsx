// Stats charts, drawn with TanStack Charts' React Native host over react-native-svg. That host is
// experimental: if it fails on a phone, only these components change. The definitions are
// `@app/stats-ui`'s, which the web draws too.
import type { Locale, Theme } from "@app/core";
import {
  chartDefinition,
  GRADE_INK,
  GRADES,
  type BarChart,
  type RetentionTable as Table,
  type StatsCopy,
} from "@app/stats-ui";
import { Chart } from "@tanstack/charts/react-native";
import { Text, View, useWindowDimensions } from "react-native";

const regular = { fontFamily: "AtkinsonHyperlegible_400Regular" };
const bold = { fontFamily: "AtkinsonHyperlegible_700Bold" };
const HEIGHT = 180;

/** A grade or count chart in the theme's colors. */
export function StatsChart({
  chart,
  theme,
  locale,
}: {
  chart: BarChart;
  theme: Theme;
  locale: Locale;
}) {
  const { width, fontScale } = useWindowDimensions();
  return (
    <Chart
      definition={chartDefinition(chart, (token) => theme[token])}
      accessibilityLabel={chart.label}
      // The screen's 24px side margins.
      width={Math.max(160, width - 48)}
      height={HEIGHT * Math.min(fontScale, 1.3)}
      color={theme["muted-foreground"]}
      focusFill={theme.background}
      fontFamily={regular.fontFamily}
      fontScale={fontScale}
      locale={locale}
    />
  );
}

/** The grade names in their ink, the key to a grade chart. */
export function GradeLegend({ t, theme }: { t: StatsCopy; theme: Theme }) {
  return (
    <View className="flex-row flex-wrap gap-4">
      {GRADES.map((grade) => (
        <View key={grade} className="flex-row items-center gap-2">
          <View className="size-3 rounded-pill" style={{ backgroundColor: theme[grade] }} />
          <Text style={[regular, { color: theme[GRADE_INK[grade]] }]} className="text-label">
            {t(grade)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Anki's true retention table: young, mature and total per period. */
export function RetentionTable({ table }: { table: Table }) {
  return (
    <View accessibilityRole="summary">
      <View className="flex-row border-b border-border py-2">
        <View className="flex-1" />
        {table.columns.map((column) => (
          <Text key={column} style={bold} className="flex-1 text-right text-label text-foreground">
            {column}
          </Text>
        ))}
      </View>
      {table.rows.map((row) => (
        <View key={row.period} className="min-h-12 flex-row items-center border-b border-border">
          <Text style={regular} className="flex-1 text-label text-muted-foreground">
            {row.period}
          </Text>
          {row.cells.map((cell) => (
            <View key={cell.label} className="flex-1 items-end" accessibilityLabel={cell.label}>
              <Text
                style={cell.total ? bold : regular}
                className="text-body text-foreground tabular-nums"
              >
                {cell.value}
              </Text>
              <Text style={regular} className="text-caption text-muted-foreground tabular-nums">
                {cell.detail}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
