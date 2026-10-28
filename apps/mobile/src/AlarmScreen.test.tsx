import { fireEvent, render, screen, waitFor } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import { newAlarm } from "@app/core";
import { fakeSyncApi } from "@app/contracts/testing";
import { localData } from "./database.ts";
import { AlarmScreen } from "./AlarmScreen.tsx";
import { memoryAlarmService, type Ring } from "./alarms.ts";

const front = () => String(screen.getByLabelText("Frente").props.source.html);
async function revealAndGrade(grade: string) {
  await fireEvent.press(screen.getByRole("button", { name: "Mostrar resposta" }));
  // The grades wait a moment after the reveal.
  expect(screen.queryByRole("button", { name: grade })).toBeNull();
  await fireEvent.press(await screen.findByRole("button", { name: grade }));
}

test("Start silences the ring, cards count toward N and N right dismisses it", async () => {
  const api = await fakeSyncApi({});
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        const deck = c.createDeck("Acordar");
        c.addBasicNote(deck.id, "casa", "house");
        const sub = c.createDeck("Acordar::Bichos");
        c.addBasicNote(sub.id, "gato", "cat");
        const other = c.createDeck("Outro");
        c.addBasicNote(other.id, "fora", "out");
      }),
    ),
  );
  const deckId = state.decks.find((d) => d.fields.name.value === "Acordar")!.id;
  const ring: Ring = {
    id: "ring-1",
    alarm: { ...newAlarm("alarm-1"), label: "Trabalho", deckId, need: 2 },
    startedAt: Date.now(),
    phase: "ringing",
  };
  const native = memoryAlarmService();
  native.deliver(
    {
      id: "event-1",
      kind: "ringStarted",
      alarmId: "alarm-1",
      ringId: ring.id,
      wallTime: ring.startedAt,
      elapsedRealtime: 1,
    },
    ring,
  );
  let dismissed = 0;
  try {
    await render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always" } } })
        }
      >
        <AlarmScreen
          ring={ring}
          locale="pt-BR"
          layer={native.layer}
          gradeDelayMs={50}
          onDismissed={() => dismissed++}
        />
      </QueryClientProvider>,
    );
    screen.getByText("Trabalho");
    expect(screen.queryByLabelText("Frente")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Começar" }));
    await screen.findByLabelText("Frente");
    expect(native.signals()).toContain("sessionStarted:ring-1");
    screen.getByText("0 de 2 certos · faltam 2");

    const first = front();
    await revealAndGrade("De novo");
    await screen.findByText("0 de 2 certos · faltam 2");
    await waitFor(() => expect(front()).not.toBe(first));
    expect(front()).not.toContain("fora");

    await revealAndGrade("Bom");
    await screen.findByText("1 de 2 certos · faltam 1");
    // The card missed with Again comes back.
    await waitFor(() => expect(front()).toBe(first));
    screen.getByText("Voltou");

    await revealAndGrade("Fácil");
    await waitFor(() => expect(dismissed).toBe(1));
    expect(native.ring()).toBeNull();
    expect(native.signals()).toContain("dismiss:ring-1");
    expect(native.signals().filter((s) => s === "activity:ring-1").length).toBeGreaterThan(0);
    const log = await Effect.runPromise(localData((data) => data.reviewLog));
    expect(log.map((e) => e.kind === "review" && [e.grade, e.origin, e.ringId])).toEqual([
      [1, "alarm", "ring-1"],
      [3, "alarm", "ring-1"],
      [4, "alarm", "ring-1"],
    ]);
    expect(api.calls.metadata).toBe(0);
  } finally {
    await api.dispose();
  }
});
