import { newAlarm, type Locale, type WakeUpStats } from "@app/core";
import { statsCopy, wakeUpScopes } from "@app/stats-ui";
import { sampleCharts, sampleRetention } from "@app/stats-ui/fixtures";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { GradeLegend, RetentionTable, StatsChart, WakeUpScopes } from "./stats.tsx";

const wakeTally = {
  rings: 12,
  dismissed: 12,
  medianDismissMs: 7 * 60_000,
  snoozes: 6,
  snoozesPerRing: 0.5,
  cardsPerDismissal: 9.25,
  awakeChecksPassed: 10,
  awakeChecksFailed: 1,
  missed: 1,
};
const wakeUp: WakeUpStats = {
  overall: wakeTally,
  alarms: [{ alarmId: "work", ...wakeTally }],
};
const alarms = [{ ...newAlarm("work"), label: "Trabalho" }];

function Gallery({ locale, rang }: { locale: Locale; rang: boolean }) {
  const t = statsCopy(locale);
  const empty = { overall: { ...wakeTally, rings: 0, missed: 0 }, alarms: [] };
  const charts = sampleCharts(t);
  return (
    <div className="flex w-xl flex-col gap-6 p-6">
      <WakeUpScopes scopes={wakeUpScopes(rang ? wakeUp : empty, alarms, t, locale)} t={t} />
      <StatsChart chart={charts.reviews} />
      <GradeLegend t={t} />
      <StatsChart chart={charts.forecast} />
      <RetentionTable table={sampleRetention(t)} caption={t("retention")} />
    </div>
  );
}

const fills = (chart: HTMLElement) =>
  new Set([...chart.querySelectorAll("rect, path")].map((shape) => shape.getAttribute("fill")));

const meta = {
  title: "Stats/Charts",
  component: Gallery,
  args: { locale: "pt-BR", rang: true },
} satisfies Meta<typeof Gallery>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Portuguese: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const reviews = canvas.getByRole("img", { name: "Revisões por dia" });
    await expect([...fills(reviews)]).toEqual(
      expect.arrayContaining(["again", "hard", "good", "easy"].map((g) => `var(--color-${g})`)),
    );
    await expect(fills(canvas.getByRole("img", { name: "Previsão" }))).toContain(
      "var(--color-primary)",
    );
    await expect(canvas.getByText("De novo")).toBeVisible();
    const table = canvas.getByRole("table", { name: "Retenção real" });
    await expect(within(table).getByLabelText("hoje, Total: 93%")).toBeVisible();
    const work = canvas.getByRole("listitem", { name: "Trabalho" });
    await expect(within(work).getByText("Tocou 12 vezes")).toBeVisible();
    await expect(within(work).getByText("9,3")).toBeVisible();
    await expect(within(work).getByText("10 de 11")).toBeVisible();
  },
};

export const English: Story = {
  args: { locale: "en" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("img", { name: "Reviews per day" })).toBeVisible();
    await expect(canvas.getAllByText("today").length).toBeGreaterThan(1);
    await expect(canvas.getByRole("listitem", { name: "All alarms" })).toBeVisible();
    await expect(canvas.getAllByText("7 min")).toHaveLength(2);
  },
};

export const NothingRang: Story = {
  args: { rang: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Nenhum alarme tocou neste período.")).toBeVisible();
    await expect(canvas.queryByRole("listitem", { name: "Todos os alarmes" })).toBeNull();
  },
};
