import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import { fakeSyncApi } from "@app/contracts/testing";
import fixture from "../../../packages/core/fixtures/ankidroid-deck.json" with { type: "json" };
import { memoryAnkiDroid, type AnkiDroidApi } from "./ankidroid.ts";
import { AnkiDroidScreen } from "./AnkiDroidScreen.tsx";
import { localData } from "./database.ts";

const show = (ankiDroid: AnkiDroidApi, onOpen: (deckId: string) => void = () => {}) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always" } } })
      }
    >
      <AnkiDroidScreen ankiDroid={ankiDroid} locale="pt-BR" onExit={() => {}} onOpen={onOpen} />
    </QueryClientProvider>,
  );

test("without AnkiDroid the screen says so", async () => {
  await show(memoryAnkiDroid({ installed: null }));
  expect(await screen.findByText(/AnkiDroid não está instalado/)).toBeDefined();
});

test("an AnkiDroid older than 2.24 is named as the reason", async () => {
  await show(memoryAnkiDroid({ installed: { versionCode: 22303300, permission: "granted" } }));
  expect(await screen.findByText(/AnkiDroid 2.24 ou mais novo/)).toBeDefined();
});

test("asks for AnkiDroid's permission, then lists its decks", async () => {
  const ankiDroid = memoryAnkiDroid({
    installed: { versionCode: 22400300, permission: "denied" },
    decks: fixture.decks,
  });
  await show(ankiDroid);
  await fireEvent.press(
    await screen.findByRole("button", { name: "Permitir acesso ao AnkiDroid" }),
  );
  expect(ankiDroid.requests).toBe(1);
  expect(await screen.findByRole("button", { name: "Japonês" })).toBeDefined();
});

test("a provider permission error falls back to asking again", async () => {
  await show(
    memoryAnkiDroid({
      installed: { versionCode: 22400300, permission: "granted" },
      failure: "permission",
    }),
  );
  expect(await screen.findByRole("button", { name: "Permitir acesso ao AnkiDroid" })).toBeDefined();
});

test("links a deck as this phone's linked deck, then brings its media from an .apkg", async () => {
  const api = await fakeSyncApi({});
  let opened = "";
  try {
    await show(
      memoryAnkiDroid({
        installed: { versionCode: 22500300, permission: "granted" },
        decks: fixture.decks,
        sources: [fixture.source],
        media: 3,
      }),
      (deckId) => {
        opened = deckId;
      },
    );
    await fireEvent.press(await screen.findByRole("button", { name: "Japonês" }));
    expect(await screen.findByText(/Japonês foi vinculado/)).toBeDefined();
    const state = await Effect.runPromise(localData((data) => data.collection));
    const deck = state.decks.find((d) => d.anki?.id === 1700000000001)!;
    expect(deck.fields.name.value).toBe("Japonês");
    expect(deck.fields.linkedBy?.value).toBe(deck.fields.name.hlc.deviceId);
    const inDeck = state.cards.filter((c) => c.fields.deckId.value === deck.id);
    expect(new Set(inDeck.map((c) => c.fields.noteId.value)).size).toBe(2);
    await fireEvent.press(screen.getByRole("button", { name: "Escolher arquivo .apkg" }));
    expect(await screen.findByText("3 arquivos de mídia adicionados.")).toBeDefined();
    await fireEvent.press(screen.getByRole("button", { name: "Abrir baralho" }));
    expect(opened).toBe(deck.id);
    expect(api.calls.metadata).toBe(0);
  } finally {
    await api.dispose();
  }
});
