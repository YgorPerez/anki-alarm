import { Effect } from "effect";
import fixture from "../../../packages/core/fixtures/ankidroid-deck.json" with { type: "json" };
import { act, fireEvent, render, screen } from "@testing-library/react-native/pure";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test } from "vite-plus/test";
import { CollectionScreen } from "./CollectionScreen.tsx";
import { StatsScreen } from "./StatsScreen.tsx";
import { memoryAnkiDroid } from "./ankidroid.ts";
import { FACTORY_THEME, themeFor } from "@app/core";
import { pressBack } from "../test/native/react-native.ts";
import { ScreenActivity } from "./screen-activity.ts";

test("Back goes within Decks, ignores an inactive tab, then leaves from its root", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: "always" } },
  });
  const api = memoryAnkiDroid({ installed: null });
  const view = (active: boolean) => (
    <QueryClientProvider client={client}>
      <ScreenActivity value={active}>
        <CollectionScreen locale="pt-BR" onTheme={() => {}} ankiDroid={api} />
      </ScreenActivity>
    </QueryClientProvider>
  );
  const app = await render(view(true));
  expect(pressBack()).toBe(false);
  await fireEvent.press(await screen.findByRole("button", { name: "Criar baralho" }));
  await fireEvent.changeText(screen.getByLabelText("Nome do baralho"), "Back test deck");
  await fireEvent.press(screen.getByRole("button", { name: "Salvar" }));
  await fireEvent.press(await screen.findByRole("button", { name: /Back test deck/ }));
  await app.rerender(view(false));
  expect(pressBack()).toBe(false);
  await app.rerender(view(true));
  expect(screen.getByRole("button", { name: "Estudar" })).toBeTruthy();
  await act(async () => {
    expect(pressBack()).toBe(true);
  });
  expect(screen.getByRole("button", { name: /Back test deck/ })).toBeTruthy();
  expect(pressBack()).toBe(false);
});

test("Back leaves from the Stats tab root", async () => {
  await render(
    <QueryClientProvider client={new QueryClient()}>
      <StatsScreen locale="en" theme={themeFor(FACTORY_THEME, "light")} />
    </QueryClientProvider>,
  );
  expect(pressBack()).toBe(false);
});

test("Back stays in AnkiDroid while a deck is being linked", async () => {
  const api = memoryAnkiDroid({
    installed: { versionCode: 22500300, permission: "granted" },
    decks: fixture.decks,
    sources: [fixture.source],
  });
  const gate = Promise.withResolvers<void>();
  const readDeck = api.readDeck;
  api.readDeck = (id) =>
    Effect.promise(() => gate.promise).pipe(Effect.flatMap(() => readDeck(id)));
  await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CollectionScreen locale="pt-BR" onTheme={() => {}} ankiDroid={api} />
    </QueryClientProvider>,
  );
  await fireEvent.press(await screen.findByRole("button", { name: "Vincular do AnkiDroid" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Japonês" }));
  await act(async () => {
    expect(pressBack()).toBe(true);
  });
  expect(screen.queryByRole("button", { name: "Criar baralho" })).toBeNull();
  gate.resolve();
  expect(await screen.findByText(/Japonês foi vinculado/)).toBeTruthy();
  await act(async () => {
    expect(pressBack()).toBe(true);
  });
  expect(await screen.findByRole("button", { name: "Criar baralho" })).toBeTruthy();
});
