import { pressBack } from "../test/native/react-native.ts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native/pure";
import { expect, test, vi } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import { fakeSyncApi } from "@app/contracts/testing";
import { localData } from "./database.ts";
import { AnswerControls, StudyScreen } from "./StudyScreen.tsx";

const frontHtml = () => String(screen.getByLabelText("Frente").props.source.html);
const undoButton = () => screen.getByRole("button", { name: "Desfazer" });
/** Picks `item` from the card-action menu. */
async function fromMenu(item: string) {
  await fireEvent.press(screen.getByRole("button", { name: "Ações do cartão" }));
  await fireEvent.press(screen.getByRole("button", { name: item }));
}

test.each([1, 2, 3, 4] as const)(
  "reveals before grade %i and commits a phone review while the sync API is offline",
  async (grade) => {
    const api = await fakeSyncApi({});
    const state = await Effect.runPromise(
      localData((data) =>
        data.changeCollection((c) => {
          const deck = c.createDeck(`Study test ${grade}`);
          c.addBasicNote(deck.id, "casa", "house");
        }),
      ),
    );
    const deck = state.decks.find((d) => d.fields.name.value === `Study test ${grade}`)!;
    try {
      await render(
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: { queries: { retry: false, networkMode: "always" } },
            })
          }
        >
          <StudyScreen deckId={deck.id} locale="pt-BR" onExit={() => {}} />
        </QueryClientProvider>,
      );
      await screen.findByLabelText("Frente");
      expect(
        screen.queryByRole("button", { name: ["De novo", "Difícil", "Bom", "Fácil"][grade - 1] }),
      ).toBeNull();
      expect(screen.getByLabelText("Frente").props.source.html).toContain("casa");
      expect(screen.getByLabelText("Frente").props.source.html).not.toContain("house");
      expect(screen.getByRole("button", { name: "Mostrar resposta" })).toBeTruthy();

      const front = screen.getByLabelText("Frente");
      expect(front.props.javaScriptEnabled).toBe(false);
      expect(front.props.textZoom).toBe(100);
      expect(front.props.accessibilityHint).toBe("Toque para ver a resposta");
      await fireEvent(front, "touchStart", {
        nativeEvent: { pageX: 10, pageY: 10, touches: [{}] },
      });
      await fireEvent(front, "touchMove", {
        nativeEvent: { pageX: 10, pageY: 100, touches: [{}] },
      });
      await fireEvent(front, "touchEnd", { nativeEvent: { pageX: 10, pageY: 10, touches: [] } });
      expect(screen.queryByLabelText("Verso")).toBeNull();
      await fireEvent(front, "touchStart", {
        nativeEvent: { pageX: 10, pageY: 10, touches: [{}] },
      });
      await fireEvent(front, "touchEnd", { nativeEvent: { pageX: 12, pageY: 12, touches: [] } });
      expect(screen.getByLabelText("Verso").props.source.html).toContain("house");
      expect(screen.getByText("<1min(s)")).toBeTruthy();
      await fireEvent.press(
        screen.getByRole("button", { name: ["De novo", "Difícil", "Bom", "Fácil"][grade - 1] }),
      );
      await screen.findByText("Nenhum cartão disponível agora. Os limites diários se aplicam.");
      const log = await Effect.runPromise(localData((data) => data.reviewLog));
      expect(log.at(-1)).toMatchObject({ kind: "review", origin: "phone", grade });
      expect(api.calls.metadata).toBe(0);
    } finally {
      await api.dispose();
    }
  },
);

test("A deck's interactive card runs its script and a tap on it doesn't reveal", async () => {
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        const deck = c.createDeck("Script test");
        c.addBasicNote(deck.id, '<div onclick="mark(this)">A</div>', "door");
      }),
    ),
  );
  const deck = state.decks.find((d) => d.fields.name.value === "Script test")!;
  await render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always" } } })
      }
    >
      <StudyScreen deckId={deck.id} locale="pt-BR" onExit={() => {}} />
    </QueryClientProvider>,
  );
  const front = await screen.findByLabelText("Frente");
  expect(front.props.javaScriptEnabled).toBe(true);
  expect(front.props.source.html).toContain("script-src 'unsafe-inline' file:");
  expect(front.props.accessibilityHint).toBeUndefined();
  await fireEvent(front, "touchStart", { nativeEvent: { pageX: 10, pageY: 10, touches: [{}] } });
  await fireEvent(front, "touchEnd", { nativeEvent: { pageX: 10, pageY: 10, touches: [] } });
  expect(screen.queryByLabelText("Verso")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Mostrar resposta" }));
  expect(screen.getByLabelText("Verso").props.javaScriptEnabled).toBe(true);
});

test("Undo restores the front; the back link and system Back leave study", async () => {
  const exit = vi.fn<() => void>();
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        const deck = c.createDeck("Undo test");
        c.addBasicNote(deck.id, "porta", "door");
        c.addBasicNote(deck.id, "janela", "window");
      }),
    ),
  );
  const deck = state.decks.find((d) => d.fields.name.value === "Undo test")!;
  await render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always" } } })
      }
    >
      <StudyScreen deckId={deck.id} locale="pt-BR" onExit={exit} />
    </QueryClientProvider>,
  );
  expect(screen.getByRole("button", { name: "Desfazer" })).toHaveProperty(
    "props.accessibilityState.disabled",
    true,
  );
  await fireEvent(await screen.findByLabelText("Frente"), "accessibilityAction", {
    nativeEvent: { actionName: "activate" },
  });
  const first = String(screen.getByLabelText("Verso").props.source.html);
  await fireEvent.press(screen.getByRole("button", { name: "Fácil" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Desfazer" }).props.accessibilityState.disabled).toBe(
      false,
    ),
  );
  await fireEvent.press(screen.getByRole("button", { name: "Desfazer" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Desfazer" })).toHaveProperty(
      "props.accessibilityState.disabled",
      true,
    ),
  );
  const log = await Effect.runPromise(localData((data) => data.reviewLog));
  const review = log.findLast((e) => e.kind === "review")!;
  expect(log.at(-1)).toMatchObject({ kind: "void", targetId: review.id, cardId: review.cardId });
  await fireEvent(screen.getByLabelText("Frente"), "accessibilityAction", {
    nativeEvent: { actionName: "activate" },
  });
  expect(screen.getByLabelText("Verso").props.source.html).toBe(first);
  await fireEvent.press(screen.getByRole("button", { name: "Undo test" }));
  await act(async () => {
    expect(pressBack()).toBe(true);
  });
  expect(exit).toHaveBeenCalledTimes(2);
});

test.each([
  { fontScale: 1, height: 88 },
  { fontScale: 2, height: 220 },
])(
  "the control strip reserves $height pixels on both sides at font scale $fontScale",
  async ({ fontScale, height }) => {
    const native = await import("react-native");
    const dimensions = vi.spyOn(native, "useWindowDimensions").mockReturnValue({
      width: 400,
      height: 800,
      scale: 2,
      fontScale,
    });
    try {
      const view = await render(controls(false));
      screen.getByText("Tap to see the answer");
      expect(view.toJSON()).toMatchObject({ props: { style: { height } } });
      await view.rerender(controls(true, false));
      expect(view.toJSON()).toMatchObject({ props: { style: { height } } });
      expect(screen.queryByRole("button", { name: "Good" })).toBeNull();
      await view.rerender(controls(true));
      expect(view.toJSON()).toMatchObject({ props: { style: { height } } });
      expect(screen.getAllByRole("button")).toHaveLength(4);
      expect(screen.getByText("<10m")).toBeTruthy();
    } finally {
      dimensions.mockRestore();
    }
  },
);

const controls = (revealed: boolean, gradesShown = true) => (
  <AnswerControls
    intervals={{ 1: 60, 2: 360, 3: 600, 4: 86400 }}
    revealed={revealed}
    gradesShown={gradesShown}
    locale="en"
    busy={false}
    onAnswer={async () => {}}
  />
);

test.each([
  { fontScale: 1, height: 80 },
  { fontScale: 2, height: 220 },
])("Decks reveal bar and grades reserve $height pixels", async ({ fontScale, height }) => {
  const native = await import("react-native");
  const dimensions = vi
    .spyOn(native, "useWindowDimensions")
    .mockReturnValue({ width: 400, height: 800, scale: 2, fontScale });
  const reveal = vi.fn<() => void>();
  try {
    const view = await render(
      <AnswerControls
        revealed={false}
        locale="pt-BR"
        busy={false}
        onReveal={reveal}
        gradeHeight={56}
        onAnswer={async () => {}}
      />,
    );
    expect(view.toJSON()).toMatchObject({ props: { style: { height } } });
    await fireEvent.press(screen.getByRole("button", { name: "Mostrar resposta" }));
    expect(reveal).toHaveBeenCalledOnce();
    await view.rerender(
      <AnswerControls
        revealed
        locale="pt-BR"
        busy={false}
        onReveal={reveal}
        gradeHeight={56}
        onAnswer={async () => {}}
      />,
    );
    expect(view.toJSON()).toMatchObject({ props: { style: { height } } });
    expect(screen.getAllByRole("button")).toHaveLength(4);
  } finally {
    dimensions.mockRestore();
  }
});

test("study menu suspends the card without a review", async () => {
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        const deck = c.createDeck("Suspend study");
        c.addBasicNote(deck.id, "suspend me", "back");
      }),
    ),
  );
  const deck = state.decks.find((d) => d.fields.name.value === "Suspend study")!;
  await render(
    <QueryClientProvider client={new QueryClient()}>
      <StudyScreen deckId={deck.id} locale="pt-BR" onExit={() => {}} />
    </QueryClientProvider>,
  );
  await screen.findByLabelText("Frente");
  await fireEvent.press(screen.getByRole("button", { name: "Ações do cartão" }));
  await fireEvent.press(screen.getByRole("button", { name: "Suspender cartão" }));
  await screen.findByText("Nenhum cartão disponível agora. Os limites diários se aplicam.");
  expect(
    (await Effect.runPromise(localData((d) => d.collection))).cards.find(
      (c) => c.fields.deckId.value === deck.id,
    )!.fields.suspended.value,
  ).toBe(true);
});

test("Edit note from the menu returns to the same card, re-rendered; Back cancels the edit", async () => {
  const exit = vi.fn<() => void>();
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        const deck = c.createDeck("Edit test");
        c.createDeck("Edit test other");
        c.addBasicNote(deck.id, "gato", "cat");
        c.addBasicNote(deck.id, "rato", "mouse");
      }),
    ),
  );
  const deck = state.decks.find((d) => d.fields.name.value === "Edit test")!;
  await render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always" } } })
      }
    >
      <StudyScreen deckId={deck.id} locale="pt-BR" onExit={exit} />
    </QueryClientProvider>,
  );
  await fireEvent(await screen.findByLabelText("Frente"), "accessibilityAction", {
    nativeEvent: { actionName: "activate" },
  });
  const back = String(screen.getByLabelText("Verso").props.source.html);
  const word = back.includes("cat") ? "cat" : "mouse";

  await fireEvent.press(screen.getByRole("button", { name: "Ações do cartão" }));
  await fireEvent.press(screen.getByRole("button", { name: "Editar nota" }));
  expect((await screen.findByLabelText("Verso")).props.value).toBe(word);
  // Moving the note to another deck stays in the deck page's editor.
  expect(screen.queryByRole("radio", { name: "Edit test other" })).toBeNull();
  await act(async () => {
    expect(pressBack()).toBe(true);
  });
  expect(exit).not.toHaveBeenCalled();
  expect(String((await screen.findByLabelText("Verso")).props.source.html)).toBe(back);

  await fireEvent.press(screen.getByRole("button", { name: "Ações do cartão" }));
  await fireEvent.press(screen.getByRole("button", { name: "Editar nota" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Cancelar" }));
  expect(String((await screen.findByLabelText("Verso")).props.source.html)).toBe(back);

  await fireEvent.press(screen.getByRole("button", { name: "Ações do cartão" }));
  await fireEvent.press(screen.getByRole("button", { name: "Editar nota" }));
  await fireEvent.changeText(await screen.findByLabelText("Verso"), `${word} (editado)`);
  await fireEvent.press(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() =>
    expect(String(screen.getByLabelText("Verso").props.source?.html)).toContain(
      `${word} (editado)`,
    ),
  );
  const saved = await Effect.runPromise(localData((data) => data.collection));
  expect(saved.notes.some((n) => n.values[1]?.value === `${word} (editado)`)).toBe(true);
  expect(exit).not.toHaveBeenCalled();
});

test("Bury from the card menu skips the card until tomorrow without answering it", async () => {
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        const deck = c.createDeck("Bury test");
        c.addBasicNote(deck.id, "ponte", "bridge");
        c.addBasicNote(deck.id, "rio", "river");
      }),
    ),
  );
  const deck = state.decks.find((d) => d.fields.name.value === "Bury test")!;
  const logBefore = await Effect.runPromise(localData((data) => data.reviewLog));
  await render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always" } } })
      }
    >
      <StudyScreen deckId={deck.id} locale="pt-BR" onExit={() => {}} />
    </QueryClientProvider>,
  );
  const html = String((await screen.findByLabelText("Frente")).props.source.html);
  const [buried, other] = html.includes("ponte") ? ["ponte", "rio"] : ["rio", "ponte"];
  expect(screen.getByLabelText("2 novos")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Ações do cartão" }));
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    expect(screen.getByRole("button", { name: new RegExp(`^Bandeira ${n}: `) })).toBeTruthy();
  }
  expect(screen.queryByRole("button", { name: "Remover bandeira" })).toBeNull();
  expect(
    screen
      .getAllByText(
        /^(Editar nota|Marcar nota|Enterrar até amanhã|Suspender cartão|Suspender nota)$/,
      )
      .map((item) => item.props.children),
  ).toEqual([
    "Editar nota",
    "Marcar nota",
    "Enterrar até amanhã",
    "Suspender cartão",
    "Suspender nota",
  ]);
  await fireEvent.press(screen.getByRole("button", { name: "Enterrar até amanhã" }));
  await waitFor(() => expect(screen.getByLabelText("Frente").props.source.html).toContain(other));
  expect(screen.getByLabelText("1 novos")).toBeTruthy();
  const after = await Effect.runPromise(localData((data) => data.collection));
  const note = after.notes.find((n) => n.values[0]?.value === buried)!;
  const card = after.cards.find((c) => c.fields.noteId.value === note.id)!;
  expect(card.fields.buriedUntil.value).toBeGreaterThan(Date.now());
  expect(await Effect.runPromise(localData((data) => data.reviewLog))).toEqual(logBefore);
});

test("flag and mark stay in the top bar and can be cleared without answering", async () => {
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        const deck = c.createDeck("Annotations");
        c.addBasicNote(deck.id, "word", "meaning");
      }),
    ),
  );
  await render(
    <QueryClientProvider client={new QueryClient()}>
      <StudyScreen deckId={state.decks.at(-1)!.id} locale="pt-BR" onExit={() => {}} />
    </QueryClientProvider>,
  );
  await screen.findByLabelText("Frente");
  await fireEvent.press(screen.getByRole("button", { name: "Ações do cartão" }));
  await fireEvent.press(screen.getByRole("button", { name: "Bandeira 5: Rosa" }));
  await screen.findByLabelText("Bandeira 5: Rosa");
  await fireEvent.press(screen.getByRole("button", { name: "Ações do cartão" }));
  await fireEvent.press(screen.getByRole("button", { name: "Marcar nota" }));
  await screen.findByLabelText("Nota marcada");
  expect(screen.getByLabelText("Frente").props.source.html).not.toContain("★");
  await fireEvent.press(screen.getByRole("button", { name: "Ações do cartão" }));
  await fireEvent.press(screen.getByRole("button", { name: "Desmarcar nota" }));
  await waitFor(() => expect(screen.queryByLabelText("Nota marcada")).toBeNull());
  await fireEvent.press(screen.getByRole("button", { name: "Ações do cartão" }));
  await fireEvent.press(screen.getByRole("button", { name: "Remover bandeira" }));
  await waitFor(() => expect(screen.queryByLabelText("Bandeira 5: Rosa")).toBeNull());
});

test("Undo reverses suspend, bury, flag and mark too, newest first, and the card comes back", async () => {
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        const deck = c.createDeck("Undo actions");
        c.addBasicNote(deck.id, "sol", "sun");
        c.addBasicNote(deck.id, "mar", "sea");
      }),
    ),
  );
  const deck = state.decks.find((d) => d.fields.name.value === "Undo actions")!;
  await render(
    <QueryClientProvider client={new QueryClient()}>
      <StudyScreen deckId={deck.id} locale="pt-BR" onExit={() => {}} />
    </QueryClientProvider>,
  );
  await screen.findByLabelText("Frente");
  const first = frontHtml();
  await fromMenu("Bandeira 5: Rosa");
  await screen.findByLabelText("Bandeira 5: Rosa");
  await fromMenu("Marcar nota");
  await screen.findByLabelText("Nota marcada");
  await fromMenu("Suspender cartão");
  await waitFor(() => expect(frontHtml()).not.toBe(first));

  await fireEvent.press(undoButton());
  await waitFor(() => expect(frontHtml()).toBe(first));
  screen.getByLabelText("Bandeira 5: Rosa");
  screen.getByLabelText("Nota marcada");
  await fireEvent.press(undoButton());
  await waitFor(() => expect(screen.queryByLabelText("Nota marcada")).toBeNull());
  await fireEvent.press(undoButton());
  await waitFor(() => expect(screen.queryByLabelText("Bandeira 5: Rosa")).toBeNull());
  expect(undoButton()).toHaveProperty("props.accessibilityState.disabled", true);

  await fromMenu("Enterrar até amanhã");
  await waitFor(() => expect(frontHtml()).not.toBe(first));
  await fireEvent.press(undoButton());
  await waitFor(() => expect(frontHtml()).toBe(first));
  expect(screen.getByLabelText("2 novos")).toBeTruthy();
  const after = await Effect.runPromise(localData((data) => data.collection));
  const cards = after.cards.filter((c) => c.fields.deckId.value === deck.id);
  expect(cards.map((c) => [c.fields.suspended.value, c.fields.buriedUntil.value])).toEqual([
    [false, null],
    [false, null],
  ]);
  const log = await Effect.runPromise(localData((data) => data.reviewLog));
  expect(log.filter((e) => cards.some((c) => c.id === e.cardId))).toEqual([]);
});
