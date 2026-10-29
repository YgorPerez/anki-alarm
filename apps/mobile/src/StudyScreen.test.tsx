import { fireEvent, render, screen, waitFor } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import { fakeSyncApi } from "@app/contracts/testing";
import { localData } from "./database.ts";
import { StudyScreen } from "./StudyScreen.tsx";

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
      await screen.findByRole("button", { name: "Mostrar resposta" });
      expect(
        screen.queryByRole("button", { name: ["De novo", "Difícil", "Bom", "Fácil"][grade - 1] }),
      ).toBeNull();
      expect(screen.getByLabelText("Frente").props.source.html).toContain("casa");
      expect(screen.getByLabelText("Frente").props.source.html).not.toContain("house");
      await fireEvent.press(screen.getByRole("button", { name: "Mostrar resposta" }));
      expect(screen.getByLabelText("Verso").props.source.html).toContain("house");
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

test("Undo voids the last answer and brings its card back to the front", async () => {
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
      <StudyScreen deckId={deck.id} locale="pt-BR" onExit={() => {}} />
    </QueryClientProvider>,
  );
  expect(screen.queryByRole("button", { name: "Desfazer" })).toBeNull();
  await fireEvent.press(await screen.findByRole("button", { name: "Mostrar resposta" }));
  const first = String(screen.getByLabelText("Verso").props.source.html);
  await fireEvent.press(screen.getByRole("button", { name: "Fácil" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Desfazer" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Desfazer" })).toBeNull());
  const log = await Effect.runPromise(localData((data) => data.reviewLog));
  const review = log.findLast((e) => e.kind === "review")!;
  expect(log.at(-1)).toMatchObject({ kind: "void", targetId: review.id, cardId: review.cardId });
  await fireEvent.press(screen.getByRole("button", { name: "Mostrar resposta" }));
  expect(screen.getByLabelText("Verso").props.source.html).toBe(first);
});
