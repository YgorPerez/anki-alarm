import {
  Collection,
  newAlarm,
  studyStats,
  wakeUpStats,
  type Alarm,
  type AlarmEvent,
  type LogEntry,
} from "@app/core";
import { createChartScene } from "@tanstack/charts/scene";
import { renderChartSvg } from "@tanstack/charts/svg";
import { describe, expect, test } from "vite-plus/test";
import {
  chartDefinition,
  retentionTable,
  statsCopy,
  studySections,
  wakeUpScopes,
  type BarChart,
  type StudySection,
} from "./index.ts";

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 28, 15);
const paint = (token: string) => `var(--color-${token})`;

const answer = (id: string, cardId: string, at: number, grade: 1 | 3): LogEntry => ({
  kind: "review",
  id,
  cardId,
  at,
  grade,
  durationMs: 900,
  origin: "web",
});
function collectionWithAnswers() {
  let n = 0;
  const collection = new Collection({
    deviceId: "web",
    now: () => now - 2 * DAY,
    random: () => new Uint8Array(16).fill(n++),
  });
  const deck = collection.createDeck("Palavras");
  collection.addBasicNote(deck.id, "casa", "house");
  collection.addBasicNote(deck.id, "sol", "sun");
  const state = collection.snapshot();
  const [first, second] = state.cards;
  return {
    state,
    log: [answer("r1", first!.id, now - DAY, 1), answer("r2", second!.id, now - 60_000, 3)],
  };
}

/** A section's chart; the retention table has none. */
function chartOf(section: StudySection | undefined): BarChart {
  if (!section || section.body.kind === "retention") throw new Error("Not a chart");
  return section.body;
}
/** The SVG a host would draw for a chart. */
const drawn = (chart: BarChart) =>
  renderChartSvg(createChartScene(chartDefinition(chart, paint), { width: 320, height: 180 }), {
    ariaLabel: chart.label,
  });

describe("studySections", () => {
  test("lists every phone stat in order, each titled in the locale", () => {
    const { state, log } = collectionWithAnswers();
    const sections = studySections(studyStats(state, log, { now }), statsCopy("pt-BR"));
    expect(sections.map((s) => s.title)).toEqual([
      "Revisões por dia",
      "Previsão",
      "Retenção real",
      "Cartões por estado",
      "Intervalos",
      "Revisões por hora",
      "Estabilidade",
      "Dificuldade",
      "Recuperabilidade",
    ]);
    expect(sections[0]).toMatchObject({ legend: true, notice: null });
    expect(sections[2]!.body.kind).toBe("retention");
  });

  test("says when the period has no answers", () => {
    const { state } = collectionWithAnswers();
    const [reviews] = studySections(studyStats(state, [], { now }), statsCopy("en"));
    expect(reviews!.notice).toBe("No reviews in this period.");
  });

  test("draws grades in their hues and leaves out grades nobody gave", () => {
    const { state, log } = collectionWithAnswers();
    const [reviews] = studySections(studyStats(state, log, { now }), statsCopy("pt-BR"));
    const svg = drawn(chartOf(reviews));
    expect(svg).toContain('fill="var(--color-again)"');
    expect(svg).toContain('fill="var(--color-good)"');
    expect(svg).not.toContain('fill="var(--color-easy)"');
    expect(svg).toContain(">hoje<");
  });

  test("labels card states with their counts and paints them like the deck row", () => {
    const { state, log } = collectionWithAnswers();
    const chart = chartOf(studySections(studyStats(state, log, { now }), statsCopy("en"))[3]);
    expect(chart.rows.map((r) => ("fill" in r ? r.fill : null))).toEqual([
      "easy",
      "again",
      "again",
      "primary",
      "primary",
    ]);
    expect(chart.format(0)).toBe("New 0");
    expect(chart.format(1)).toBe("Learning 2");
    expect(drawn(chart)).toContain('fill="var(--color-again)"');
  });
});

test("retentionTable gives each period's young, mature and total as percent and counts", () => {
  const table = retentionTable(
    [
      {
        period: "week",
        young: { passed: 3, failed: 1, rate: 0.75 },
        mature: { passed: 0, failed: 0, rate: null },
        total: { passed: 3, failed: 1, rate: 0.75 },
      },
    ],
    statsCopy("pt-BR"),
  );
  expect(table.columns).toEqual(["Jovens", "Maduros", "Total"]);
  expect(table.rows).toEqual([
    {
      period: "7 dias",
      cells: [
        { label: "7 dias, Jovens: 75%", value: "75%", detail: "3 de 4", total: false },
        { label: "7 dias, Maduros: —", value: "—", detail: "0 de 0", total: false },
        { label: "7 dias, Total: 75%", value: "75%", detail: "3 de 4", total: true },
      ],
    },
  ]);
});

describe("wakeUpScopes", () => {
  const start = now - 60 * 60_000;
  let n = 0;
  const event = (kind: string, alarmId: string, ringId: string, at: number): AlarmEvent => ({
    id: `e${n++}`,
    kind,
    alarmId,
    ringId,
    wallTime: at,
    elapsedRealtime: at - start,
  });
  const alarms: Alarm[] = [
    { ...newAlarm("work"), label: "Trabalho" },
    { ...newAlarm("gym"), label: "", rule: { hour: 6, minute: 30, repeatDays: [6] } },
  ];

  test("is empty when no alarm rang or was missed", () => {
    const stats = wakeUpStats([], [], { now });
    expect(wakeUpScopes(stats, alarms, statsCopy("pt-BR"), "pt-BR")).toEqual([]);
  });

  test("names each alarm by label, else its time, else as deleted, after all alarms together", () => {
    const events = [
      event("ringStarted", "work", "r1", start),
      event("snoozed", "work", "r1", start + 60_000),
      event("dismissed", "work", "r1", start + 15 * 60_000),
      event("awakeCheckPassed", "work", "r1", start + 20 * 60_000),
      event("ringStarted", "gym", "r2", start),
      event("dismissed", "gym", "r2", start + 90 * 1000),
      event("ringStarted", "gone", "r3", start),
    ];
    const stats = wakeUpStats(events, [], { now });
    const scopes = wakeUpScopes(stats, alarms, statsCopy("pt-BR"), "pt-BR");
    expect(scopes.map((s) => [s.key, s.name, s.rang])).toEqual([
      ["all", "Todos os alarmes", "Tocou 3 vezes"],
      ["gone", "Alarme apagado", "Tocou 1 vez"],
      ["gym", "06:30", "Tocou 1 vez"],
      ["work", "Trabalho", "Tocou 1 vez"],
    ]);
    expect(scopes[3]!.rows).toEqual([
      { label: "Tempo até desligar (mediana)", value: "15 min" },
      { label: "Sonecas por toque", value: "1,0" },
      { label: "Cartões até desligar", value: "0,0" },
      { label: "Checagens de despertar respondidas", value: "1 de 1" },
      { label: "Perdidos com o celular desligado", value: "0" },
    ]);
    expect(scopes[2]!.rows[0]!.value).toBe("2 min");
    expect(scopes[1]!.rows[0]!.value).toBe("—");
  });
});
