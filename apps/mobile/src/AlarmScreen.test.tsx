import { fireEvent, render, screen, waitFor } from "@testing-library/react-native/pure";
import { expect, test, vi } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import { newAlarm, type Alarm, type Collection } from "@app/core";
import { fakeSyncApi } from "@app/contracts/testing";
import { localData } from "./database.ts";
import { AlarmScreen } from "./AlarmScreen.tsx";
import { memoryAlarmService, type Ring } from "./alarms.ts";
import { mediaUrl } from "./media.ts";

const front = () => String(screen.getByLabelText("Frente").props.source.html);
async function revealAndGrade(grade: string) {
  await fireEvent.press(screen.getByRole("button", { name: "Mostrar resposta" }));
  // The grades wait a moment after the reveal.
  expect(screen.queryByRole("button", { name: grade })).toBeNull();
  await fireEvent.press(await screen.findByRole("button", { name: grade }));
}

/** A ring of an alarm on a new deck `name` with `fronts`, delivered by the memory native. */
async function ringing(
  name: string,
  fronts: readonly string[],
  alarm: Partial<Alarm>,
  more: (c: Collection) => void = () => {},
  display: { zone: string; use24Hour: boolean } = { zone: "UTC", use24Hour: true },
  phase: Pick<Ring, "phase" | "snoozes" | "snoozedUntil"> = {
    phase: "ringing",
    snoozes: 0,
    snoozedUntil: null,
  },
) {
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        const deck = c.createDeck(name);
        for (const word of fronts) c.addBasicNote(deck.id, word, "back");
        more(c);
      }),
    ),
  );
  const deckId = state.decks.find((d) => d.fields.name.value === name)!.id;
  const ring: Ring = {
    id: `ring-${name}`,
    alarm: { ...newAlarm("alarm-1"), label: "Trabalho", deckId, ...alarm },
    startedAt: Date.now(),
    ...phase,
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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: "always" } },
  });
  let dismissed = 0;
  const show = (active: Ring) => (
    <QueryClientProvider client={client}>
      <AlarmScreen
        ring={active}
        locale="pt-BR"
        zone={display.zone}
        use24Hour={display.use24Hour}
        layer={native.layer}
        gradeDelayMs={50}
        onDismissed={() => dismissed++}
      />
    </QueryClientProvider>
  );
  const view = await render(show(ring));
  return {
    native,
    dismissed: () => dismissed,
    /** What App does when native reports a change: the screen gets native's ring. */
    rerender: () => view.rerender(show(native.ring()!)),
  };
}

test("Start silences the ring, cards count toward N and N right dismisses it", async () => {
  const api = await fakeSyncApi({});
  try {
    const { native, dismissed } = await ringing("Acordar", ["casa"], { need: 2 }, (c) => {
      c.addBasicNote(c.createDeck("Acordar::Bichos").id, "gato", "cat");
      c.addBasicNote(c.createDeck("Outro").id, "fora", "out");
    });
    screen.getByText("Trabalho");
    expect(screen.queryByLabelText("Frente")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Começar" }));
    await screen.findByLabelText("Frente");
    expect(native.signals()).toContain("sessionStarted:ring-Acordar");
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
    await waitFor(() => expect(dismissed()).toBe(1));
    expect(native.ring()).toBeNull();
    expect(native.signals()).toContain("dismiss:ring-Acordar");
    expect(native.signals().filter((s) => s === "activity:ring-Acordar").length).toBeGreaterThan(0);
    const log = await Effect.runPromise(localData((data) => data.reviewLog));
    expect(log.map((e) => e.kind === "review" && [e.grade, e.origin, e.ringId])).toEqual([
      [1, "alarm", "ring-Acordar"],
      [3, "alarm", "ring-Acordar"],
      [4, "alarm", "ring-Acordar"],
    ]);
    expect(api.calls.metadata).toBe(0);
  } finally {
    await api.dispose();
  }
});

test("the ring's clock is Home's: the system's 12 or 24 h setting, in the phone's zone", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-29T09:05:00Z"));
  try {
    await ringing("Relógio", ["sol"], {}, undefined, {
      zone: "America/Sao_Paulo",
      use24Hour: false,
    });
    expect(screen.getByText("6:05")).toBeTruthy();
    expect(screen.getByText("AM")).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});

test("a snoozed ring shows when it rings again on the same clock, in the same format", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-29T09:05:00Z"));
  try {
    await ringing(
      "Soneca",
      ["sol"],
      { need: 1 },
      undefined,
      { zone: "America/Sao_Paulo", use24Hour: false },
      { phase: "snoozed", snoozes: 1, snoozedUntil: Date.parse("2026-10-29T09:14:00Z") },
    );
    expect(screen.getByText("6:14")).toBeTruthy();
    expect(screen.getByText("AM")).toBeTruthy();
    await screen.findByText(/^Vai tocar de novo às 6:14 AM com \d+ cartões\.$/);
  } finally {
    vi.useRealTimers();
  }
});

/** The rows the four grades sit in, once a card is revealed. */
async function gradeRows() {
  await fireEvent.press(screen.getByRole("button", { name: "Começar" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Mostrar resposta" }));
  await screen.findByRole("button", { name: "Bom" });
  return ["De novo", "Difícil", "Bom", "Fácil"].map(
    (name) => screen.getByRole("button", { name }).parent,
  );
}

test("at the largest font scale on a small phone the grades sit two by two, keeping words whole", async () => {
  const native = await import("react-native");
  const dimensions = vi.spyOn(native, "useWindowDimensions").mockReturnValue({
    width: 320,
    height: 640,
    scale: 2,
    fontScale: 2,
  });
  try {
    await ringing("Grande", ["sol"], {});
    const [again, hard, good, easy] = await gradeRows();
    expect(hard).toBe(again);
    expect(easy).toBe(good);
    expect(good).not.toBe(again);
  } finally {
    dimensions.mockRestore();
  }
  await ringing("Normal", ["lua"], {});
  expect(new Set(await gradeRows()).size).toBe(1);
});

test("an alarm folded into the ring raises its N and keeps the ring's deck", async () => {
  const api = await fakeSyncApi({});
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        const deck = c.createDeck("Dobra");
        c.addBasicNote(deck.id, "sol", "sun");
        const other = c.createDeck("Dobra outro");
        c.addBasicNote(other.id, "lua", "moon");
      }),
    ),
  );
  const deckId = (name: string) => state.decks.find((d) => d.fields.name.value === name)!.id;
  const ring: Ring = {
    id: "ring-fold",
    alarm: { ...newAlarm("fold-1"), label: "Cedo", deckId: deckId("Dobra"), need: 1 },
    startedAt: Date.now(),
    phase: "ringing",
    snoozes: 0,
    snoozedUntil: null,
  };
  const later = { ...newAlarm("fold-2"), deckId: deckId("Dobra outro"), need: 4 };
  await Effect.runPromise(
    localData((data) =>
      Effect.andThen(data.saveAlarm(later), () =>
        data.ingestEvents([
          {
            id: "fold-event",
            kind: "absorbed",
            alarmId: later.id,
            ringId: ring.id,
            wallTime: ring.startedAt,
            elapsedRealtime: 2,
          },
        ]),
      ),
    ),
  );
  const native = memoryAlarmService();
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
          zone="UTC"
          use24Hour
          layer={native.layer}
          onDismissed={() => {}}
        />
      </QueryClientProvider>,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Começar" }));
    await screen.findByText("0 de 4 certos · faltam 4");
    expect(front()).toContain("sol");
  } finally {
    await api.dispose();
  }
});

test("a snooze silences the ring, adds its cost to N, and isn't offered at the cap", async () => {
  const { native, rerender } = await ringing("Adiar", ["sol", "lua"], {
    need: 1,
    snoozeMinutes: 9,
    snoozeCap: 1,
  });
  await fireEvent.press(screen.getByRole("button", { name: "Adiar 9 min · +2 cartões" }));
  expect(native.signals()).toContain("snooze:ring-Adiar:9");
  await screen.findByText("Adiado.");
  await screen.findByText(/^Vai tocar de novo às .+ com 3 cartões\.$/);
  screen.getByText("Sem mais adiamentos.");

  // Native's snooze alarm fires: the same ring rings again.
  native.endSnooze();
  await rerender();
  await fireEvent.press(screen.getByRole("button", { name: "Começar" }));
  await screen.findByText("0 de 3 certos · faltam 3");
  expect(screen.queryByRole("button", { name: /^Adiar/ })).toBeNull();
});

test("a session can snooze, and Answer now ends the snooze early", async () => {
  const { native } = await ringing("Mais tarde", ["chuva", "vento"], { need: 2, snoozeCap: 2 });
  await fireEvent.press(screen.getByRole("button", { name: "Começar" }));
  await screen.findByText("0 de 2 certos · faltam 2");
  await fireEvent.press(screen.getByRole("button", { name: "Adiar 9 min · +2 cartões" }));
  await screen.findByText("Adiado.");
  await screen.findByText(/com 4 cartões\.$/);
  screen.getByText("Mais 1 adiamento possível.");

  await fireEvent.press(screen.getByRole("button", { name: "Responder agora" }));
  await screen.findByText("0 de 4 certos · faltam 4");
  expect(native.ring()).toMatchObject({ phase: "session", snoozes: 1, snoozedUntil: null });
  expect(native.signals().at(-1)).toBe("sessionStarted:ring-Mais tarde");
  screen.getByLabelText("Frente");
  // One snooze left.
  screen.getByRole("button", { name: "Adiar 9 min · +2 cartões" });
});

test("with the awake check on, the dismissal schedules it after the alarm's delay", async () => {
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        const deck = c.createDeck("Despertar");
        c.addBasicNote(deck.id, "sol", "sun");
        c.createDeck("Vazio");
      }),
    ),
  );
  const deckId = (name: string) => state.decks.find((d) => d.fields.name.value === name)!.id;
  const show = async (ringId: string, deck: string) => {
    const ring: Ring = {
      id: ringId,
      alarm: {
        ...newAlarm("alarm-2"),
        deckId: deckId(deck),
        need: 1,
        awakeCheck: true,
        awakeCheckMinutes: 10,
      },
      startedAt: Date.now(),
      phase: "ringing",
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
    let dismissed = false;
    const view = await render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always" } } })
        }
      >
        <AlarmScreen
          ring={ring}
          locale="pt-BR"
          zone="UTC"
          use24Hour
          layer={native.layer}
          gradeDelayMs={50}
          onDismissed={() => {
            dismissed = true;
          }}
        />
      </QueryClientProvider>,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Começar" }));
    return { native, view, dismissed: () => dismissed };
  };

  const before = Date.now();
  const answered = await show("ring-2", "Despertar");
  await revealAndGrade("Bom");
  await waitFor(() => expect(answered.dismissed()).toBe(true));
  expect(answered.native.awakeCheck()).toMatchObject({ ringId: "ring-2", shownAt: null });
  expect(answered.native.awakeCheck()!.dueAt).toBeGreaterThanOrEqual(before + 600_000);
  await answered.view.unmount();

  // A deck with no cards couldn't show the check a card, so there is none.
  const empty = await show("ring-3", "Vazio");
  await fireEvent.press(await screen.findByRole("button", { name: "Desligar" }));
  await waitFor(() => expect(empty.dismissed()).toBe(true));
  expect(empty.native.awakeCheck()).toBeNull();
});

/** Rings an alarm on a new deck whose notes are `fronts`, in order. */
async function ringWithFronts(
  fronts: string[],
  options: { readAloud: boolean; language?: string },
) {
  const name = `Acordar ${fronts.join()}`;
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        const deck = c.createDeck(name);
        if (options.language) c.setDeckLanguage(deck.id, options.language);
        for (const text of fronts) c.addBasicNote(deck.id, text, "verso");
      }),
    ),
  );
  const deck = state.decks.find((d) => d.fields.name.value === name)!;
  const ring: Ring = {
    id: `ring-${deck.id}`,
    alarm: { ...newAlarm("alarm"), deckId: deck.id, need: 2, readAloud: options.readAloud },
    startedAt: Date.now(),
    phase: "ringing",
    snoozes: 0,
    snoozedUntil: null,
  };
  const native = memoryAlarmService();
  const view = await render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always" } } })
      }
    >
      <AlarmScreen
        ring={ring}
        locale="pt-BR"
        zone="UTC"
        use24Hour
        layer={native.layer}
        gradeDelayMs={10}
        onDismissed={() => {}}
      />
    </QueryClientProvider>,
  );
  return { native, view, start: pressStart };
}
const pressStart = () => fireEvent.press(screen.getByRole("button", { name: "Começar" }));
const reading = (signals: readonly string[]) =>
  signals.filter((s) => /^(?:speak|playClip|stopReading)/.test(s));

test("read aloud plays a card's own audio, else speaks its front in the deck's language", async () => {
  const { native, view, start } = await ringWithFronts(["gato [sound:miau.mp3]", "casa"], {
    readAloud: true,
    language: "en-US",
  });
  try {
    await screen.findByRole("button", { name: "Começar" });
    expect(reading(native.signals())).toEqual([]);
    await start();
    await waitFor(() =>
      expect(reading(native.signals())).toEqual([`playClip:${mediaUrl("miau.mp3")}`]),
    );

    await revealAndGrade("Bom");
    await waitFor(() => expect(native.signals()).toContain("speak:en-US:casa"));
    expect(reading(native.signals()).filter((s) => s.startsWith("speak"))).toEqual([
      "speak:en-US:casa",
    ]);
  } finally {
    await view.unmount();
  }
  // Leaving the screen stops whatever is still being read.
  expect(reading(native.signals()).at(-1)).toBe("stopReading");
});

test("read aloud speaks the front when the card's audio can't play", async () => {
  const { native, view, start } = await ringWithFronts(["pato [sound:quack.mp3]"], {
    readAloud: true,
  });
  try {
    native.unplayable(mediaUrl("quack.mp3"));
    await start();
    await waitFor(() => expect(native.signals()).toContain("speak:pt-BR:pato"));
  } finally {
    await view.unmount();
  }
});

test("an alarm without read aloud reads nothing", async () => {
  const { native, view, start } = await ringWithFronts(["boi [sound:muu.mp3]", "vaca"], {
    readAloud: false,
  });
  try {
    await start();
    await screen.findByLabelText("Frente");
    await revealAndGrade("Bom");
    await screen.findByText("1 de 2 certos · faltam 1");
  } finally {
    await view.unmount();
  }
  expect(reading(native.signals())).toEqual([]);
});
