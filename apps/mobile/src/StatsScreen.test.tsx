import { fireEvent, render, screen, within } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import { ALARM_EVENTS, FACTORY_THEME, newAlarm, themeFor, type AlarmEvent } from "@app/core";
import { fakeSyncApi } from "@app/contracts/testing";
import { localData } from "./database.ts";
import { StatsScreen } from "./StatsScreen.tsx";

const theme = themeFor(FACTORY_THEME, "light");
type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] };
/** The paints of a chart's drawn shapes. */
function fills(node: Node): unknown[] {
  const own = node.type === "Rect" || node.type === "Path" ? [node.props?.fill] : [];
  return [
    ...own,
    ...(node.children ?? []).flatMap((child) =>
      typeof child === "object" && child ? fills(child as Node) : [],
    ),
  ];
}

test("shows each stat overall and per deck from the local review log, drawing grades in their hues", async () => {
  const api = await fakeSyncApi({});
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        c.addBasicNote(c.createDeck("Palavras").id, "casa", "house");
        c.addBasicNote(c.createDeck("Verbos").id, "correr", "run");
      }),
    ),
  );
  const deckCard = (name: string) => {
    const deck = state.decks.find((d) => d.fields.name.value === name)!;
    return state.cards.find((c) => c.fields.deckId.value === deck.id)!.id;
  };
  await Effect.runPromise(localData((data) => data.answerCard(deckCard("Palavras"), 1, 1000)));
  await Effect.runPromise(localData((data) => data.answerCard(deckCard("Verbos"), 3, 1000)));
  try {
    await render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <StatsScreen locale="pt-BR" theme={theme} onExit={() => {}} />
      </QueryClientProvider>,
    );
    const daily = await screen.findByLabelText("Revisões por dia");
    expect(fills(daily)).toEqual(expect.arrayContaining([theme.again, theme.good]));
    expect(fills(daily)).not.toContain(theme.easy);
    for (const name of [
      "Previsão",
      "Cartões por estado",
      "Intervalos",
      "Revisões por hora",
      "Estabilidade",
      "Dificuldade",
      "Recuperabilidade",
    ])
      expect(screen.getByLabelText(name)).toBeTruthy();
    expect(screen.getByText("Retenção real")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "Palavras" }));
    const deck = await screen.findByLabelText("Revisões por dia");
    expect(fills(deck)).toContain(theme.again);
    expect(fills(deck)).not.toContain(theme.good);
    expect(api.calls.metadata).toBe(0);
  } finally {
    await api.dispose();
  }
});

test("shows wake-up stats overall and per alarm from the ingested alarm journal", async () => {
  const api = await fakeSyncApi({});
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        c.addBasicNote(c.createDeck("Acordar").id, "sol", "sun");
      }),
    ),
  );
  const cardId = state.cards[0]!.id;
  const start = Date.now() - 10 * 60_000;
  let n = 0;
  const event = (kind: string, alarmId: string, ringId: string, at: number): AlarmEvent => ({
    id: `event-${n++}`,
    kind,
    alarmId,
    ringId,
    wallTime: at,
    elapsedRealtime: at - start,
  });
  await Effect.runPromise(
    localData((data) =>
      Effect.gen(function* () {
        yield* data.saveAlarm({ ...newAlarm("work"), label: "Trabalho" });
        yield* data.saveAlarm({
          ...newAlarm("gym"),
          label: "",
          rule: { hour: 6, minute: 30, repeatDays: [6] },
        });
        yield* data.answerCard(cardId, 1, 1000, "ring-1");
        yield* data.answerCard(cardId, 3, 1000, "ring-1");
        yield* data.ingestEvents([
          event(ALARM_EVENTS.ringStarted, "work", "ring-1", start),
          event(ALARM_EVENTS.snoozed, "work", "ring-1", start + 60_000),
          event(ALARM_EVENTS.dismissed, "work", "ring-1", start + 15 * 60_000),
          event(ALARM_EVENTS.awakeCheckPassed, "work", "ring-1", start + 20 * 60_000),
          event(ALARM_EVENTS.ringStarted, "gym", "ring-2", start),
          event(ALARM_EVENTS.dismissed, "gym", "ring-2", start + 5 * 60_000),
          event(ALARM_EVENTS.awakeCheckFailed, "gym", "ring-2", start + 11 * 60_000),
        ]);
      }),
    ),
  );
  try {
    await render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <StatsScreen locale="pt-BR" theme={theme} onExit={() => {}} />
      </QueryClientProvider>,
    );
    const overall = await screen.findByLabelText("Todos os alarmes");
    expect(within(overall).getByText("Tocou 2 vezes")).toBeTruthy();
    expect(within(overall).getByText("10 min")).toBeTruthy();
    expect(within(overall).getByText("1 de 2")).toBeTruthy();
    const work = screen.getByLabelText("Trabalho");
    expect(within(work).getByText("15 min")).toBeTruthy();
    expect(within(work).getByText("1,0")).toBeTruthy();
    expect(within(work).getByText("2,0")).toBeTruthy();
    const gym = screen.getByLabelText("06:30");
    expect(within(gym).getByText("5 min")).toBeTruthy();
    expect(within(gym).getByText("0 de 1")).toBeTruthy();
  } finally {
    await api.dispose();
  }
});
