import { Effect } from "effect";
import { localData } from "./database.ts";
import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { describe, expect, test, vi } from "vite-plus/test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CollectionScreen } from "./CollectionScreen.tsx";
import { memoryAnkiDroid } from "./ankidroid.ts";

/** The decks screen over the phone's local database, as Home opens it. */
const show = (onStudy?: (id: string) => void) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always" } } })
      }
    >
      <CollectionScreen
        onStudy={onStudy}
        locale="pt-BR"
        onExit={() => {}}
        onTheme={() => {}}
        ankiDroid={memoryAnkiDroid({ installed: null })}
      />
    </QueryClientProvider>,
  );

describe("CollectionScreen", () => {
  test("creates a deck, lists it, and still lists it when opened again", async () => {
    const view = await show();
    await fireEvent.press(await screen.findByRole("button", { name: "Criar baralho" }));
    await fireEvent.changeText(screen.getByLabelText("Nome do baralho"), "Verbos");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("button", { name: /Verbos/ })).toBeDefined();
    expect(screen.getByRole("header", { name: "Baralhos" })).toBeDefined();

    // The deck is in the phone's database, not only on this screen.
    await view.unmount();
    await show();
    expect(await screen.findByRole("button", { name: /Verbos/ })).toBeDefined();
  });
});

test("Study opens the selected deck through the navigation boundary", async () => {
  const study = vi.fn<(id: string) => void>();
  await show(study);
  await fireEvent.press(await screen.findByRole("button", { name: "Criar baralho" }));
  await fireEvent.changeText(screen.getByLabelText("Nome do baralho"), "Navigation deck");
  await fireEvent.press(screen.getByRole("button", { name: "Salvar" }));
  await fireEvent.press(await screen.findByRole("button", { name: /Navigation deck/ }));
  expect(await screen.findByLabelText("0 novos")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Estudar" }));
  expect(study).toHaveBeenCalledWith(expect.any(String));
  expect(screen.getByRole("header", { name: "Navigation deck" })).toBeTruthy();
});

test("returning from study refreshes the deck's remaining counts", async () => {
  await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        const deck = c.createDeck("Count refresh");
        c.addBasicNote(deck.id, "casa", "house");
      }),
    ),
  );
  await show();
  await fireEvent.press(await screen.findByRole("button", { name: /Count refresh/ }));
  expect(await screen.findByLabelText("1 novos")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Estudar" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Mostrar resposta" }));
  await fireEvent.press(screen.getByRole("button", { name: "Fácil" }));
  await screen.findByText("Nenhum cartão disponível agora. Os limites diários se aplicam.");
  await fireEvent.press(screen.getByRole("button", { name: "‹ Count refresh" }));
  expect(await screen.findByLabelText("0 novos")).toBeTruthy();
});
