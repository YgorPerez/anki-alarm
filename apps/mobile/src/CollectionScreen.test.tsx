import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { describe, expect, test } from "vite-plus/test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CollectionScreen } from "./CollectionScreen.tsx";

describe("CollectionScreen", () => {
  test("creates a deck and lists it", async () => {
    await render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CollectionScreen locale="pt-BR" onExit={() => {}} onTheme={() => {}} />
      </QueryClientProvider>,
    );

    await fireEvent.press(await screen.findByRole("button", { name: "Criar baralho" }));
    await fireEvent.changeText(screen.getByLabelText("Nome do baralho"), "Verbos");
    await fireEvent.press(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("button", { name: /Verbos/ })).toBeDefined();
    expect(screen.getByRole("header", { name: "Baralhos" })).toBeDefined();
  });
});
