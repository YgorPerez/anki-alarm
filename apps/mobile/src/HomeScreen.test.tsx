import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native/pure";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { newAlarm, quickAlarm, type Alarm } from "@app/core";
import { HomeScreen } from "./HomeScreen.tsx";

afterEach(() => vi.useRealTimers());

test("Home shows localized alarm details, edits, adds and refreshes next ring after data changes", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-29T23:18:00Z"));
  const alarm = {
    ...newAlarm("a"),
    label: "Trabalho",
    deckId: "deck",
    rule: { hour: 6, minute: 30, repeatDays: [1, 2, 3, 4, 5] },
  };
  const actions: string[] = [];
  const view = (alarms: Alarm[] = [alarm], locale: "pt-BR" | "en" = "pt-BR", use24Hour = true) => (
    <HomeScreen
      alarms={alarms}
      decks={[{ id: "deck", name: "Idiomas::Inglês" }]}
      locale={locale}
      zone="UTC"
      use24Hour={use24Hour}
      onEdit={(a) => actions.push(a.id)}
      onAdd={() => actions.push("new")}
      onToggle={(a) => actions.push(a.enabled ? "on" : "off")}
    />
  );
  const result = await render(view());
  expect(screen.getByText("23:18")).toBeTruthy();
  expect(screen.getByText("Próximo 06:30 · em 7 h 12 min")).toBeTruthy();
  expect(screen.getByText("Dias úteis")).toBeTruthy();
  expect(screen.getByText("Idiomas::Inglês · 3 cartões")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: /Trabalho/ }));
  await fireEvent.press(screen.getByRole("button", { name: "Novo alarme" }));
  await fireEvent(screen.getByLabelText("Trabalho: Ativado"), "valueChange", false);
  expect(actions).toEqual(["a", "new", "off"]);
  await result.rerender(view([{ ...alarm, enabled: false }]));
  expect(screen.getByText("Nenhum alarme ativado")).toBeTruthy();
  await result.rerender(
    view([{ ...alarm, rule: { hour: 7, minute: 0, onceDate: "2026-10-30" } }], "en", false),
  );
  expect(screen.getByText("11:18")).toBeTruthy();
  expect(screen.getByText("PM")).toBeTruthy();
  expect(screen.getByText("Tomorrow")).toBeTruthy();
  expect(screen.getByText("Next 7:00 AM · in 7 h 42 min")).toBeTruthy();
  await act(() => vi.advanceTimersByTime(60000));
  expect(screen.getByText("11:19")).toBeTruthy();
  expect(screen.getByText("Next 7:00 AM · in 7 h 41 min")).toBeTruthy();
  // Past a day, the wait counts days, as the editor's "Rings in" does.
  await result.rerender(
    view([{ ...alarm, rule: { hour: 8, minute: 0, repeatDays: [6] } }], "pt-BR"),
  );
  expect(screen.getByText("Próximo 08:00 · em 1 d 8 h 41 min")).toBeTruthy();
  await result.rerender(view([], "en"));
  expect(screen.getByText("No alarms enabled")).toBeTruthy();
});

test("Home keeps long labels and deck paths available on a small phone at large font scale", async () => {
  const native = await import("react-native");
  const dimensions = vi.spyOn(native, "useWindowDimensions").mockReturnValue({
    width: 320,
    height: 640,
    scale: 2,
    fontScale: 1.3,
  });
  const label = "Revisar o vocabulário antes de sair para trabalhar";
  const deckName = "Idiomas::Inglês::Vocabulário para o trabalho";
  try {
    await render(
      <HomeScreen
        alarms={[
          {
            ...newAlarm("long"),
            label,
            deckId: "deck",
            rule: { hour: 6, minute: 30, repeatDays: [3, 1] },
          },
        ]}
        decks={[{ id: "deck", name: deckName }]}
        locale="pt-BR"
        zone="UTC"
        use24Hour
        onEdit={() => {}}
        onAdd={() => {}}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText(deckName + " · 3 cartões")).toBeTruthy();
    expect(screen.getByText("Seg, Qua")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Novo alarme" })).toBeTruthy();
  } finally {
    dimensions.mockRestore();
  }
});

test("the card menu skips the next ring of a repeating alarm, shows the ring after it and undoes", async () => {
  vi.useFakeTimers();
  // Thursday 23:18; the alarm rings weekdays at 06:30, next on Friday.
  vi.setSystemTime(new Date("2026-10-29T23:18:00Z"));
  const alarm = {
    ...newAlarm("a"),
    label: "Trabalho",
    rule: { hour: 6, minute: 30, repeatDays: [1, 2, 3, 4, 5] },
  };
  const saved: Alarm[] = [];
  const view = (alarms: Alarm[], locale: "pt-BR" | "en" = "pt-BR") => (
    <HomeScreen
      alarms={alarms}
      decks={[]}
      locale={locale}
      zone="UTC"
      use24Hour
      onEdit={() => {}}
      onAdd={() => {}}
      onToggle={() => {}}
      onSkip={(a) => saved.push(a)}
    />
  );
  const result = await render(view([alarm]));
  await fireEvent.press(screen.getByRole("button", { name: "Mais opções: Trabalho" }));
  await fireEvent.press(screen.getByRole("button", { name: "Pular a próxima" }));
  expect(saved.at(-1)?.skip).toBe(Date.parse("2026-10-30T06:30:00Z"));
  expect(screen.queryByRole("button", { name: "Pular a próxima" })).toBeNull();

  await result.rerender(view([saved.at(-1)!]));
  expect(screen.getByText("Pulado · toca seg., 2 de nov.")).toBeTruthy();
  expect(screen.getByText("Próximo 06:30 · em 3 d 7 h 12 min")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Mais opções: Trabalho" }));
  await fireEvent.press(screen.getByRole("button", { name: "Desfazer pulo" }));
  expect(saved.at(-1)?.skip).toBeNull();

  await result.rerender(view([saved[0]!], "en"));
  expect(screen.getByText("Skipped · rings Mon, Nov 2")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "More options: Trabalho" }));
  expect(screen.getByRole("button", { name: "Undo skip" })).toBeTruthy();

  // Once the skipped Friday ring has passed, the skip clears itself.
  await result.rerender(view([saved[0]!]));
  await act(() => vi.setSystemTime(new Date("2026-10-30T07:00:00Z")));
  await act(() => vi.advanceTimersByTime(1000));
  expect(screen.queryByText(/Pulado/)).toBeNull();
  expect(screen.getByText("Próximo 06:30 · em 2 d 23 h 30 min")).toBeTruthy();
});

test("the card menu is only for enabled repeating alarms", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-29T23:18:00Z"));
  const repeating = { ...newAlarm("a"), label: "Semana" };
  await render(
    <HomeScreen
      alarms={[
        { ...repeating, id: "off", label: "Desligado", enabled: false },
        {
          ...repeating,
          id: "once",
          label: "Uma vez",
          rule: { hour: 7, minute: 0, onceDate: "2026-10-30" },
        },
      ]}
      decks={[]}
      locale="pt-BR"
      zone="UTC"
      use24Hour
      onEdit={() => {}}
      onAdd={() => {}}
      onToggle={() => {}}
      onSkip={() => {}}
    />,
  );
  expect(screen.queryByRole("button", { name: /Mais opções/ })).toBeNull();
});

test("quick alarm chips add a marked one-off alarm and say when it rings", async () => {
  vi.useFakeTimers();
  // 06:00:40 UTC: +10 min rings at 06:10, 9 min 20 s away.
  vi.setSystemTime(new Date("2026-10-29T06:00:40Z"));
  const options = { deckId: "deck", need: 3, sound: newAlarm("a").sound };
  const added: number[] = [];
  const view = (alarms: Alarm[], locale: "pt-BR" | "en" = "pt-BR", quick = true) => (
    <HomeScreen
      alarms={alarms}
      decks={[{ id: "deck", name: "Inglês" }]}
      locale={locale}
      zone="UTC"
      use24Hour
      onEdit={() => {}}
      onAdd={() => {}}
      onToggle={() => {}}
      onQuickAlarm={
        quick
          ? (minutes, onAdded) => {
              added.push(minutes);
              onAdded(quickAlarm("q", minutes, options, Date.now(), "UTC"));
            }
          : undefined
      }
    />
  );
  const result = await render(view([]));
  await fireEvent.press(screen.getByRole("button", { name: "Alarme daqui a 10 minutos" }));
  expect(added).toEqual([10]);
  await waitFor(() => expect(screen.getByText("Toca em 10 min")).toBeTruthy());
  await result.rerender(view([quickAlarm("q", 10, options, Date.now(), "UTC")]));
  expect(screen.getByText("Hoje · Rápido")).toBeTruthy();
  await act(() => vi.advanceTimersByTime(5000));
  expect(screen.queryByText("Toca em 10 min")).toBeNull();
  await result.rerender(view([], "en"));
  expect(screen.getByText("+30 min")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Alarm in 30 minutes" }));
  await waitFor(() => expect(screen.getByText("Rings in 30 min")).toBeTruthy());
  // With no saved alarm or no deck, App passes no handler and the chips go.
  await result.rerender(view([], "en", false));
  expect(screen.queryByText("+10 min")).toBeNull();
});
