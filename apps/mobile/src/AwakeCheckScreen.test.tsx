import { pressBack } from "../test/native/react-native.ts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native/pure";
import { expect, test, vi } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import { newAlarm } from "@app/core";
import { localData } from "./database.ts";
import { AwakeCheckScreen } from "./AwakeCheckScreen.tsx";
import { AlarmService, memoryAlarmService, type AwakeCheck, type Ring } from "./alarms.ts";

const front = () => String(screen.getByLabelText("Frente").props.source.html);
/** Picks `item` from the card-action menu. */
async function fromMenu(item: string) {
  await fireEvent.press(screen.getByRole("button", { name: "Ações do cartão" }));
  await fireEvent.press(screen.getByRole("button", { name: item }));
}

/** A ring dismissed with the awake check on, its prompt now showing. */
async function shownCheck(ringId: string, deckId: string | null) {
  const ring: Ring = {
    id: ringId,
    alarm: { ...newAlarm(`alarm-${ringId}`), deckId, need: 1, awakeCheck: true },
    startedAt: Date.now(),
    phase: "session",
    snoozes: 0,
    snoozedUntil: null,
  };
  const native = memoryAlarmService();
  native.deliver(
    {
      id: `event-${ringId}`,
      kind: "ringStarted",
      alarmId: ring.alarm.id,
      ringId,
      wallTime: ring.startedAt,
      elapsedRealtime: 1,
    },
    ring,
  );
  await Effect.runPromise(
    Effect.flatMap(AlarmService, (service) => service.dismiss(ringId, 300)).pipe(
      Effect.provide(native.layer),
    ),
  );
  native.showAwakeCheck(Date.now());
  return { native, check: native.awakeCheck()! };
}

async function show(
  check: AwakeCheck,
  layer: ReturnType<typeof memoryAlarmService>["layer"],
  display: { zone: string; use24Hour: boolean } = { zone: "UTC", use24Hour: true },
) {
  let passed = 0;
  await render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always" } } })
      }
    >
      <AwakeCheckScreen
        check={check}
        locale="pt-BR"
        zone={display.zone}
        use24Hour={display.use24Hour}
        layer={layer}
        gradeDelayMs={0}
        onPassed={() => passed++}
      />
    </QueryClientProvider>,
  );
  return () => passed;
}

test("one answer, any grade, passes the check and is a normal review", async () => {
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        const deck = c.createDeck("Manhã");
        c.addBasicNote(deck.id, "lua", "moon");
      }),
    ),
  );
  const deckId = state.decks.find((d) => d.fields.name.value === "Manhã")!.id;
  const { native, check } = await shownCheck("ring-1", deckId);
  const passed = await show(check, native.layer);
  await screen.findByLabelText("Frente");
  expect(screen.queryByText("Ainda acordado?")).toBeNull();
  screen.getByText(/ · 0 de 1 · 60 s/);
  expect(String((await screen.findByLabelText("Frente")).props.source.html)).toContain("lua");
  await fireEvent(screen.getByLabelText("Frente"), "accessibilityAction", {
    nativeEvent: { actionName: "activate" },
  });
  const again = await screen.findByRole("button", { name: "De novo" });
  expect(screen.getByText("<1min(s)")).toBeTruthy();
  expect(again.props.accessibilityHint).toBe("<1min(s)");
  await fireEvent.press(again);
  await waitFor(() => expect(passed()).toBe(1));
  expect(native.awakeCheck()).toBeNull();
  expect(native.signals()).toContain(`awakeCheckPassed:${check.id}`);
  const log = await Effect.runPromise(localData((data) => data.reviewLog));
  expect(log.map((e) => e.kind === "review" && [e.grade, e.origin, e.ringId])).toEqual([
    [1, "alarm", check.id],
  ]);
});

test("burying the check's card shows another and doesn't pass the check", async () => {
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        const deck = c.createDeck("Tarde");
        c.addBasicNote(deck.id, "nuvem", "cloud");
        c.addBasicNote(deck.id, "chuva", "rain");
      }),
    ),
  );
  const deckId = state.decks.find((d) => d.fields.name.value === "Tarde")!.id;
  const { native, check } = await shownCheck("ring-bury", deckId);
  const passed = await show(check, native.layer);
  const first = String((await screen.findByLabelText("Frente")).props.source.html);
  await fireEvent.press(screen.getByRole("button", { name: "Ações do cartão" }));
  await fireEvent.press(screen.getByRole("button", { name: "Enterrar até amanhã" }));
  await waitFor(() =>
    expect(String(screen.getByLabelText("Frente").props.source.html)).not.toBe(first),
  );
  expect(passed()).toBe(0);
  expect(native.awakeCheck()).not.toBeNull();
});

test("the check's clock is Home's: the system's 12 or 24 h setting, in the phone's zone", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-29T09:20:00Z"));
  try {
    const { native, check } = await shownCheck("ring-clock", null);
    await show(check, native.layer, { zone: "America/Sao_Paulo", use24Hour: false });
    expect(screen.getByText("6:20")).toBeTruthy();
    expect(screen.getByText("AM")).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});

test("a check already answered before a restart passes at once", async () => {
  const state = await Effect.runPromise(localData((data) => data.collection));
  const { native, check } = await shownCheck("ring-2", state.decks[0]!.id);
  const cardId = state.cards[0]!.id;
  await Effect.runPromise(localData((data) => data.answerCard(cardId, 3, 100, check.id)));
  const passed = await show(check, native.layer);
  await waitFor(() => expect(passed()).toBe(1));
  expect(native.awakeCheck()).toBeNull();
});

test("with no card to show, tapping I'm awake passes it", async () => {
  const { native, check } = await shownCheck("ring-3", null);
  const passed = await show(check, native.layer);
  await fireEvent.press(await screen.findByRole("button", { name: "Estou acordado" }));
  await waitFor(() => expect(passed()).toBe(1));
  expect(native.awakeCheck()).toBeNull();
});

test.each(["Suspender card", "Suspender nota"])(
  "%s replaces the awake-check card without passing it",
  async (action) => {
    const state = await Effect.runPromise(
      localData((data) =>
        data.changeCollection((c) => {
          const deck = c.createDeck(`Awake ${action}`);
          c.addBasicNote(deck.id, "first", "back");
          c.addBasicNote(deck.id, "second", "back");
        }),
      ),
    );
    const deckId = state.decks.find((d) => d.fields.name.value === `Awake ${action}`)!.id;
    const { check, native } = await shownCheck(`suspend-${action}`, deckId);
    const passed = await show(check, native.layer);
    const first = await screen.findByLabelText("Frente");
    const before = first.props.source.html;
    await fireEvent.press(screen.getByRole("button", { name: "Ações do cartão" }));
    await fireEvent.press(screen.getByRole("button", { name: action }));
    await waitFor(() => expect(screen.getByLabelText("Frente").props.source.html).not.toBe(before));
    expect(passed()).toBe(0);
    await fireEvent.press(screen.getByRole("button", { name: "Ações do cartão" }));
    await fireEvent.press(screen.getByRole("button", { name: action }));
    await screen.findByRole("button", { name: "Estou acordado" });
    expect(passed()).toBe(0);
  },
);

test("Edit note returns to the same card, updated, and Back stays on the check", async () => {
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        c.addBasicNote(c.createDeck("Editar na checagem").id, "sol", "sun");
      }),
    ),
  );
  const deckId = state.decks.find((d) => d.fields.name.value === "Editar na checagem")!.id;
  const { native, check } = await shownCheck("ring-edit", deckId);
  const passed = await show(check, native.layer);
  await fireEvent(await screen.findByLabelText("Frente"), "accessibilityAction", {
    nativeEvent: { actionName: "activate" },
  });
  await screen.findByRole("button", { name: "Bom" });

  await fireEvent.press(screen.getByRole("button", { name: "Ações do cartão" }));
  await fireEvent.press(screen.getByRole("button", { name: "Editar nota" }));
  await act(async () => {
    expect(pressBack()).toBe(true);
  });
  expect(String((await screen.findByLabelText("Verso")).props.source.html)).toContain("sun");

  await fireEvent.press(screen.getByRole("button", { name: "Ações do cartão" }));
  await fireEvent.press(screen.getByRole("button", { name: "Editar nota" }));
  await fireEvent.changeText(await screen.findByLabelText("Verso"), "sun (star)");
  await fireEvent.press(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() =>
    expect(String(screen.getByLabelText("Verso").props.source?.html)).toContain("sun (star)"),
  );
  expect(passed()).toBe(0);
  expect(native.awakeCheck()).not.toBeNull();
});

test("flagging and marking the awake check card keeps the check open", async () => {
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        const deck = c.createDeck("Check annotations");
        c.addBasicNote(deck.id, "star", "estrela");
      }),
    ),
  );
  const deckId = state.decks.find((d) => d.fields.name.value === "Check annotations")!.id;
  const { native, check } = await shownCheck("check-annotations", deckId);
  const passed = await show(check, native.layer);
  await screen.findByLabelText("Frente");
  await fireEvent.press(screen.getByRole("button", { name: "Ações do cartão" }));
  await fireEvent.press(screen.getByRole("button", { name: "Bandeira 7: Roxa" }));
  await screen.findByLabelText("Bandeira 7: Roxa");
  await fireEvent.press(screen.getByRole("button", { name: "Ações do cartão" }));
  await fireEvent.press(screen.getByRole("button", { name: "Marcar nota" }));
  await screen.findByLabelText("Nota marcada");
  expect(passed()).toBe(0);
  expect(native.awakeCheck()).not.toBeNull();
});

test("Undo brings back a card buried or suspended on the check, which stays open", async () => {
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        const deck = c.createDeck("Noite");
        c.addBasicNote(deck.id, "estrela", "star");
        c.addBasicNote(deck.id, "cometa", "comet");
      }),
    ),
  );
  const deckId = state.decks.find((d) => d.fields.name.value === "Noite")!.id;
  const { native, check } = await shownCheck("ring-undo", deckId);
  const passed = await show(check, native.layer);
  await screen.findByLabelText("Frente");
  const first = front();
  await fromMenu("Enterrar até amanhã");
  await waitFor(() => expect(front()).not.toBe(first));
  await fromMenu("Desfazer");
  await waitFor(() => expect(front()).toBe(first));
  await fromMenu("Suspender nota");
  await waitFor(() => expect(front()).not.toBe(first));
  await fromMenu("Desfazer");
  await waitFor(() => expect(front()).toBe(first));
  const after = await Effect.runPromise(localData((data) => data.collection));
  expect(
    after.cards
      .filter((c) => c.fields.deckId.value === deckId)
      .map((c) => [c.fields.suspended.value, c.fields.buriedUntil.value]),
  ).toEqual([
    [false, null],
    [false, null],
  ]);
  expect(passed()).toBe(0);
  expect(native.awakeCheck()).not.toBeNull();
});
