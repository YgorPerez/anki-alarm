import { fireEvent, render, screen, waitFor } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import fixture from "../../../packages/core/fixtures/ankidroid-deck.json" with { type: "json" };
import { unlinkedAnkiDroidDeck } from "../../../packages/client-data/src/ankidroid-offer-fixture.ts";
import { memoryAnkiDroid } from "./ankidroid.ts";
import { CollectionScreen } from "./CollectionScreen.tsx";
import { localData } from "./database.ts";

const press = async (name: string | RegExp) =>
  fireEvent.press(await screen.findByRole("button", { name }));

test.each([
  ["Oferta enviada", 10, true, 1],
  ["Oferta recusada", 20, false, 0],
])("leaving the link screen keeps the offer on the deck: %s", async (name, offset, send, sent) => {
  // Linked, with an earlier answer, and the link screen left without answering.
  const source = structuredClone(fixture.source);
  source.deckId += offset;
  source.decks[0]!.id = source.deckId;
  source.decks[0]!.name = name;
  for (const card of source.cards) card.deckId = source.deckId;
  for (const note of source.notes) note.guid += name;
  await Effect.runPromise(localData((data) => data.importAnki(unlinkedAnkiDroidDeck(source))));
  const state = await Effect.runPromise(localData((data) => data.collection));
  const deck = state.decks.find((d) => d.anki?.id === source.deckId)!;
  const card = state.cards.find((c) => c.fields.deckId.value === deck.id)!;
  await Effect.runPromise(localData((data) => data.answerCard(card.id, 3, 5000)));
  await Effect.runPromise(localData((data) => data.linkAnkiDroidDeck(source)));
  const anki = memoryAnkiDroid({
    installed: { versionCode: 22500300, permission: "granted" },
    sources: [source],
  });
  const view = await render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always" } } })
      }
    >
      <CollectionScreen locale="pt-BR" onExit={() => {}} onTheme={() => {}} ankiDroid={anki} />
    </QueryClientProvider>,
  );
  await press(new RegExp(name));
  await screen.findByText(/Revisões ainda não enviadas ao AnkiDroid: 1\./);
  await screen.findByText("0 revisões pendentes para o AnkiDroid.");
  // Nothing goes until the user answers, even when they tap Send.
  await press("Enviar revisões ao AnkiDroid");
  await screen.findByText("0 revisões enviadas ao AnkiDroid.");
  expect(anki.answers).toHaveLength(0);

  await press(send ? "Enviar essas revisões" : "Não enviar essas revisões");
  await waitFor(() =>
    expect(screen.queryByText(/Revisões ainda não enviadas ao AnkiDroid/)).toBeNull(),
  );
  await waitFor(() => expect(anki.answers).toHaveLength(sent));
  await screen.findByText("0 revisões pendentes para o AnkiDroid.");
  await view.unmount();
});
