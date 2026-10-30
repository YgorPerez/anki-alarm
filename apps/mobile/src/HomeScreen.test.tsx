import { StyleSheet } from "react-native";
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
  expect(screen.queryByText("23:18")).toBeNull();
  // The card's time and the one under the headline.
  const times = screen.getAllByText("06:30");
  expect(times).toHaveLength(2);
  for (const time of times)
    expect(StyleSheet.flatten(time.props.style)).toMatchObject({
      fontFamily: "Inter_700Bold",
      fontVariant: ["tabular-nums"],
    });
  expect(screen.getByText("Alarme em 7 h 12")).toBeTruthy();
  expect(screen.getByText("sex., 30 de out. · 06:30")).toBeTruthy();
  expect(screen.getByText("Trabalho · 3 cartões")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: /Trabalho/ }));
  await fireEvent.press(screen.getByRole("button", { name: "Novo alarme" }));
  await fireEvent(screen.getByLabelText("Trabalho: Ativado"), "valueChange", false);
  expect(actions).toEqual(["a", "new", "off"]);
  await result.rerender(view([{ ...alarm, enabled: false }]));
  expect(screen.getByText("Nenhum alarme ativo")).toBeTruthy();
  await result.rerender(
    view([{ ...alarm, rule: { hour: 7, minute: 0, onceDate: "2026-10-30" } }], "en", false),
  );
  expect(screen.queryByText("11:18")).toBeNull();
  expect(screen.getByText("Oct 30, 2026")).toBeTruthy();
  expect(screen.getByText("Alarm in 7 h 42")).toBeTruthy();
  await act(() => vi.advanceTimersByTime(60000));
  expect(screen.queryByText("11:19")).toBeNull();
  expect(screen.getByText("Alarm in 7 h 41")).toBeTruthy();
  // Past a day, the wait counts days, as the editor's "Rings in" does.
  await result.rerender(
    view([{ ...alarm, rule: { hour: 8, minute: 0, repeatDays: [6] } }], "pt-BR"),
  );
  expect(screen.getByText("Alarme em 1 d 8 h 41")).toBeTruthy();
  // Minutes under ten read as on a clock; with no hours beside them they keep their unit.
  await result.rerender(
    view([{ ...alarm, rule: { hour: 0, minute: 24, onceDate: "2026-10-30" } }]),
  );
  expect(screen.getByText("Alarme em 1 h 05")).toBeTruthy();
  await result.rerender(
    view([{ ...alarm, rule: { hour: 23, minute: 49, onceDate: "2026-10-30" } }]),
  );
  expect(screen.getByText("Alarme em 1 d 30 min")).toBeTruthy();
  await result.rerender(
    view([{ ...alarm, rule: { hour: 7, minute: 19, onceDate: "2026-10-30" } }]),
  );
  expect(screen.getByText("Alarme em 8 h")).toBeTruthy();
  await result.rerender(
    view([{ ...alarm, label: "", rule: { hour: 23, minute: 20, onceDate: "2026-10-29" } }]),
  );
  expect(screen.getByText("Alarme em 1 min")).toBeTruthy();
  expect(screen.getByText("Idiomas::Inglês · 3 cartões")).toBeTruthy();
  await result.rerender(view([], "en"));
  expect(screen.getByText("No active alarms")).toBeTruthy();
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
    expect(screen.getByText(label + " · 3 cartões").props.numberOfLines).toBe(1);
    expect(screen.getByRole("button", { name: new RegExp(label) })).toBeTruthy();

    expect(screen.getByRole("button", { name: /Seg, Qua/ })).toBeTruthy();
    const cardTime = screen.getAllByText("06:30").at(-1)!;
    expect(StyleSheet.flatten(cardTime.props.style).fontSize * 1.3).toBeLessThan(50);
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
  const duplicated: Alarm[] = [];
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
      onDuplicate={(a) => duplicated.push(a)}
    />
  );
  const result = await render(view([alarm]));
  await fireEvent(screen.getByRole("button", { name: /^06:30, Trabalho/ }), "longPress");
  expect(screen.queryByText("⋯")).toBeNull();
  expect(screen.getByRole("button", { name: "Pular o próximo" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Duplicar alarme" }));
  expect(duplicated).toEqual([alarm]);
  await fireEvent(screen.getByRole("button", { name: /^06:30, Trabalho/ }), "longPress");
  await fireEvent.press(screen.getByRole("button", { name: "Pular o próximo" }));
  expect(saved.at(-1)?.skip).toBe(Date.parse("2026-10-30T06:30:00Z"));
  expect(screen.queryByRole("button", { name: "Pular o próximo" })).toBeNull();

  await result.rerender(view([saved.at(-1)!]));
  expect(screen.getByText("Pulado · toca seg., 2 de nov.")).toBeTruthy();
  expect(screen.getByText("Alarme em 3 d 7 h 12")).toBeTruthy();
  await fireEvent(screen.getByRole("button", { name: /^06:30, Trabalho/ }), "longPress");
  await fireEvent.press(screen.getByRole("button", { name: "Desfazer pulo" }));
  expect(saved.at(-1)?.skip).toBeNull();

  await result.rerender(view([saved[0]!], "en"));
  expect(screen.getByText("Skipped · rings Mon, Nov 2")).toBeTruthy();
  await fireEvent(screen.getByRole("button", { name: /^06:30, Trabalho/ }), "accessibilityAction", {
    nativeEvent: { actionName: "longpress" },
  });
  expect(screen.getByRole("button", { name: "Undo skip" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Duplicate alarm" })).toBeTruthy();

  await result.rerender(view([{ ...saved[0]!, enabled: false }]));
  expect(screen.getByText("Pulado · toca seg., 2 de nov.")).toBeTruthy();
  expect(screen.getByText("Nenhum alarme ativo")).toBeTruthy();
  // A skip marked on a disabled alarm can still be undone.
  await fireEvent(screen.getByRole("button", { name: /^06:30, Trabalho/ }), "longPress");
  await fireEvent.press(screen.getByRole("button", { name: "Desfazer pulo" }));
  expect(saved.at(-1)).toMatchObject({ enabled: false, skip: null });

  // Once the skipped Friday ring has passed, the skip clears itself.
  await result.rerender(view([saved[0]!]));
  await act(() => vi.setSystemTime(new Date("2026-10-30T07:00:00Z")));
  await act(() => vi.advanceTimersByTime(1000));
  expect(screen.queryByText(/Pulado/)).toBeNull();
  expect(screen.getByText("Alarme em 2 d 23 h 30")).toBeTruthy();
});

test.each(["Desligado", "Uma vez"])(
  "%s card menu keeps Duplicate without offering Skip",
  async (label) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T23:18:00Z"));
    const repeating = { ...newAlarm("a"), label: "Semana" };
    const duplicated: Alarm[] = [];
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
        onDuplicate={(alarm) => duplicated.push(alarm)}
      />,
    );
    await fireEvent(screen.getByRole("button", { name: new RegExp(label) }), "longPress");
    expect(screen.queryByRole("button", { name: "Pular o próximo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Desfazer pulo" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Duplicar alarme" }));
    expect(duplicated.map((alarm) => alarm.id)).toEqual([label === "Desligado" ? "off" : "once"]);
  },
);

test("long-pressing + offers the quick alarms, which add a marked one-off and say when it rings", async () => {
  vi.useFakeTimers();
  // 06:00:40 UTC: +10 min rings at 06:10, 9 min 20 s away.
  vi.setSystemTime(new Date("2026-10-29T06:00:40Z"));
  const options = { deckId: "deck", need: 3, sound: newAlarm("a").sound };
  const added: number[] = [];
  const opened: string[] = [];
  const view = (alarms: Alarm[], locale: "pt-BR" | "en" = "pt-BR", quick = true) => (
    <HomeScreen
      alarms={alarms}
      decks={[{ id: "deck", name: "Inglês" }]}
      locale={locale}
      zone="UTC"
      use24Hour
      onEdit={() => {}}
      onAdd={() => opened.push("new")}
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
  // The chips only come up from +; a tap on + still adds an alarm.
  expect(screen.queryByText("+10 min")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Novo alarme" }));
  expect(opened).toEqual(["new"]);
  expect(screen.queryByText("+10 min")).toBeNull();

  await fireEvent(screen.getByRole("button", { name: "Novo alarme" }), "longPress");
  expect(screen.getByText("+20 min")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Alarme daqui a 10 minutos" }));
  expect(added).toEqual([10]);
  expect(opened).toEqual(["new"]);
  expect(screen.queryByText("+20 min")).toBeNull();
  await waitFor(() => expect(screen.getByText("Toca em 10 min")).toBeTruthy());
  await result.rerender(view([quickAlarm("q", 10, options, Date.now(), "UTC")]));
  expect(screen.getByText("29 de out. de 2026 · Rápido")).toBeTruthy();
  await act(() => vi.advanceTimersByTime(5000));
  expect(screen.queryByText("Toca em 10 min")).toBeNull();

  // TalkBack names the action and reaches the same choices.
  await result.rerender(view([], "en"));
  const add = screen.getByRole("button", { name: "New alarm" });
  expect(add.props.accessibilityActions).toEqual([{ name: "longpress", label: "Quick alarms" }]);
  expect(add.props.accessibilityHint).toBe("Touch and hold for quick alarms");
  await fireEvent(add, "accessibilityAction", { nativeEvent: { actionName: "longpress" } });
  expect(screen.getByText("+30 min")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Alarm in 30 minutes" }));
  await waitFor(() => expect(screen.getByText("Rings in 30 min")).toBeTruthy());

  // With no saved alarm or no deck, App passes no handler and + only adds.
  await result.rerender(view([], "en", false));
  const plainAdd = screen.getByRole("button", { name: "New alarm" });
  expect(plainAdd.props.accessibilityActions).toEqual([]);
  expect(plainAdd.props.accessibilityHint).toBeUndefined();
  await fireEvent(plainAdd, "longPress");
  expect(screen.queryByText("+10 min")).toBeNull();
});

test("the quick alarm hint shows when asked for, and reports being dismissed or used", async () => {
  const seen: string[] = [];
  const view = ({ hint = true, quick = true }: { hint?: boolean; quick?: boolean } = {}) => (
    <HomeScreen
      alarms={[{ ...newAlarm("a"), deckId: "deck" }]}
      decks={[{ id: "deck", name: "Inglês" }]}
      locale="pt-BR"
      zone="UTC"
      use24Hour
      onEdit={() => {}}
      onAdd={() => {}}
      onToggle={() => {}}
      onQuickAlarm={quick ? () => {} : undefined}
      quickHint={hint}
      onQuickHintSeen={() => seen.push("seen")}
    />
  );
  const text = "Segure o + para um alarme rápido de +10, +20 ou +30 min.";
  const result = await render(view());
  expect(screen.getByText(text)).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Novo alarme" }));
  expect(seen).toEqual([]);
  await fireEvent.press(screen.getByRole("button", { name: "Dispensar dica" }));
  expect(seen).toEqual(["seen"]);
  await result.rerender(view({ hint: false }));
  expect(screen.queryByText(text)).toBeNull();

  // Using the quick alarms counts as having seen the hint.
  await result.rerender(view());
  await fireEvent(screen.getByRole("button", { name: "Novo alarme" }), "longPress");
  expect(seen).toEqual(["seen", "seen"]);

  // Without quick alarms on offer, the hint would describe something + can't do.
  await result.rerender(view({ quick: false }));
  expect(screen.queryByText(text)).toBeNull();
});

test("a card's day letters start on Sunday, and selected ones are bold ink, not lilac", async () => {
  await render(
    <HomeScreen
      alarms={[
        { ...newAlarm("a"), label: "Trabalho", rule: { hour: 6, minute: 30, repeatDays: [7] } },
      ]}
      decks={[]}
      locale="pt-BR"
      zone="UTC"
      use24Hour
      onEdit={() => {}}
      onAdd={() => {}}
      onToggle={() => {}}
    />,
  );
  const letters = screen.getAllByText(/^[DSTQ]$/);
  expect(letters.map((letter) => letter.props.children).join("")).toBe("DSTQQSS");
  const [sunday, monday] = letters;
  expect(sunday!.props.className).toBe("text-caption text-foreground");
  expect(StyleSheet.flatten(sunday!.props.style).fontFamily).toBe("AtkinsonHyperlegible_700Bold");
  expect(monday!.props.className).toBe("text-caption text-muted-foreground");
});

test("a 12-hour card sets AM/PM in Atkinson beside the Inter figures, as the big clock does", async () => {
  await render(
    <HomeScreen
      alarms={[{ ...newAlarm("a"), label: "Trabalho", enabled: false }]}
      decks={[]}
      locale="en"
      zone="UTC"
      use24Hour={false}
      onEdit={() => {}}
      onAdd={() => {}}
      onToggle={() => {}}
    />,
  );
  const figures = screen.getByText(/^\d+:\d\d$/);
  expect(StyleSheet.flatten(figures.props.style).fontFamily).toBe("Inter_700Bold");
  expect(figures.props.className).toBe("text-muted-foreground");
  expect(StyleSheet.flatten(screen.getByText("AM").props.style).fontFamily).toBe(
    "AtkinsonHyperlegible_400Regular",
  );
  expect(screen.getByRole("button", { name: /^7:00 AM, Trabalho/ })).toBeTruthy();
});

test("a card's TalkBack label says it is skipped, without a separate stop for its day letters", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-29T23:18:00Z"));
  await render(
    <HomeScreen
      alarms={[
        {
          ...newAlarm("a"),
          label: "Trabalho",
          enabled: false,
          skip: Date.parse("2026-10-30T06:30:00Z"),
          rule: { hour: 6, minute: 30, repeatDays: [1, 2, 3, 4, 5] },
        },
      ]}
      decks={[]}
      locale="pt-BR"
      zone="UTC"
      use24Hour
      onEdit={() => {}}
      onAdd={() => {}}
      onToggle={() => {}}
    />,
  );
  expect(
    screen.getByRole("button", {
      name: "06:30, Trabalho, Dias úteis, Pulado · toca seg., 2 de nov., 3 cartões",
    }),
  ).toBeTruthy();
  expect(screen.queryByLabelText("Dias úteis")).toBeNull();
  // Disabled stays readable: muted ink, not a dimmed card.
  expect(screen.getByText("06:30").props.className).toBe("text-muted-foreground");
  expect(screen.getByText("Trabalho · 3 cartões")).toBeTruthy();
});
