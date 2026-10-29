import { act, fireEvent, render, screen } from "@testing-library/react-native/pure";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { newAlarm, type Alarm } from "@app/core";
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
