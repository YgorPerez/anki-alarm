import type { Meta, StoryObj } from "@storybook/react-native";
import { FACTORY_THEME, themeFor, type RetentionRow } from "@app/core";
import { View } from "react-native";
import { ScopedTheme } from "uniwind";
import { retentionTable, statsCopy } from "@app/stats-ui";
import { GradeLegend, RetentionTable, StatsChart } from "./StatsCharts.tsx";

const light = themeFor(FACTORY_THEME, "light");
const dark = themeFor(FACTORY_THEME, "dark");
// A month of answers that grows toward today, deterministic so the story looks the same each time.
const month = Array.from({ length: 30 }, (_, i) => ({
  x: i - 29,
  again: (i * 7) % 5,
  hard: (i * 3) % 4,
  good: 6 + ((i * 5) % 9) + Math.floor(i / 3),
  easy: (i * 11) % 6,
}));
const forecast = Array.from({ length: 30 }, (_, day) => ({
  x: day,
  n: day === 0 ? 24 : Math.max(0, 18 - day + ((day * 7) % 6)),
  fill: "primary" as const,
}));
const tally = (passed: number, failed: number) => ({
  passed,
  failed,
  rate: passed + failed ? passed / (passed + failed) : null,
});
const retention: RetentionRow[] = (
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

function Gallery({ mode, locale }: { mode: "light" | "dark"; locale: "pt-BR" | "en" }) {
  const theme = mode === "dark" ? dark : light;
  const t = statsCopy(locale);
  return (
    <ScopedTheme theme={mode}>
      <View style={{ flex: 1, gap: 24, padding: 24, backgroundColor: theme.background }}>
        <StatsChart
          chart={{
            kind: "grade",
            label: t("reviews"),
            rows: month,
            format: (day) => (day === 0 ? t("today") : String(day)),
          }}
          theme={theme}
          locale={locale}
        />
        <GradeLegend t={t} theme={theme} />
        <StatsChart
          chart={{
            kind: "count",
            label: t("forecast"),
            rows: forecast,
            format: (day) => (day === 0 ? t("today") : `+${day}`),
          }}
          theme={theme}
          locale={locale}
        />
        <RetentionTable table={retentionTable(retention, t)} />
      </View>
    </ScopedTheme>
  );
}

const meta = {
  title: "Stats charts",
  component: Gallery,
  args: { mode: "light", locale: "pt-BR" },
} satisfies Meta<typeof Gallery>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Light: Story = {};
export const Dark: Story = { args: { mode: "dark" } };
export const English: Story = { args: { locale: "en" } };
