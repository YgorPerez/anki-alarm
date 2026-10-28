import { fireEvent, render, screen, waitFor } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import { newAlarm } from "@app/core";
import { localData } from "./database.ts";
import { AwakeCheckScreen } from "./AwakeCheckScreen.tsx";
import { AlarmService, memoryAlarmService, type AwakeCheck, type Ring } from "./alarms.ts";

/** A ring dismissed with the awake check on, its prompt now showing. */
async function shownCheck(ringId: string, deckId: string | null) {
  const ring: Ring = {
    id: ringId,
    alarm: { ...newAlarm(`alarm-${ringId}`), deckId, need: 1, awakeCheck: true },
    startedAt: Date.now(),
    phase: "session",
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

async function show(check: AwakeCheck, layer: ReturnType<typeof memoryAlarmService>["layer"]) {
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
  screen.getByText("Ainda acordado?");
  screen.getByText("Responda um cartão em 60 s ou o alarme toca de novo");
  expect(String((await screen.findByLabelText("Frente")).props.source.html)).toContain("lua");
  await fireEvent.press(screen.getByRole("button", { name: "Mostrar resposta" }));
  await fireEvent.press(await screen.findByRole("button", { name: "De novo" }));
  await waitFor(() => expect(passed()).toBe(1));
  expect(native.awakeCheck()).toBeNull();
  expect(native.signals()).toContain(`awakeCheckPassed:${check.id}`);
  const log = await Effect.runPromise(localData((data) => data.reviewLog));
  expect(log.map((e) => e.kind === "review" && [e.grade, e.origin, e.ringId])).toEqual([
    [1, "alarm", check.id],
  ]);
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
