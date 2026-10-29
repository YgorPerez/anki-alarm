import type { Meta, StoryObj } from "@storybook/react-native";
import { FACTORY_THEME, themeFor } from "@app/core";
import { View } from "react-native";
import { ScopedTheme } from "uniwind";
import { statsCopy } from "@app/stats-ui";
import { sampleCharts, sampleRetention } from "@app/stats-ui/fixtures";
import { GradeLegend, RetentionTable, StatsChart } from "./StatsCharts.tsx";

const light = themeFor(FACTORY_THEME, "light");
const dark = themeFor(FACTORY_THEME, "dark");

function Gallery({ mode, locale }: { mode: "light" | "dark"; locale: "pt-BR" | "en" }) {
  const theme = mode === "dark" ? dark : light;
  const t = statsCopy(locale);
  const charts = sampleCharts(t);
  return (
    <ScopedTheme theme={mode}>
      <View style={{ flex: 1, gap: 24, padding: 24, backgroundColor: theme.background }}>
        <StatsChart chart={charts.reviews} theme={theme} locale={locale} />
        <GradeLegend t={t} theme={theme} />
        <StatsChart chart={charts.forecast} theme={theme} locale={locale} />
        <RetentionTable table={sampleRetention(t)} />
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
