/// <reference types="node" />
import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import { fileURLToPath } from "node:url";
import { fakeSyncApi } from "@app/contracts/testing";
import { File, Paths, picks } from "../test/native/expo-file-system.ts";
import { CollectionScreen } from "./CollectionScreen.tsx";
import { localData } from "./database.ts";
import { StudyScreen } from "./StudyScreen.tsx";
import { pickAndImportApkg } from "./apkg.ts";

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../packages/core/fixtures/apkg/${name}`, import.meta.url));
const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always" } } });

test("imports a package from the picker, stores its media and imports it again without duplicates", async () => {
  const api = await fakeSyncApi({});
  try {
    await render(
      <QueryClientProvider client={client()}>
        <CollectionScreen locale="pt-BR" onExit={() => {}} onTheme={() => {}} />
      </QueryClientProvider>,
    );
    picks.push(fixture("latest.apkg"));
    await fireEvent.press(await screen.findByRole("button", { name: "Importar .apkg" }));
    expect(
      await screen.findByText("Importado: 3 notas, 5 cartões e 6 revisões novas."),
    ).toBeDefined();
    expect(await screen.findByRole("button", { name: /Português::Verbos/ })).toBeDefined();
    expect(new File(Paths.document, "media", "gato.png").exists).toBe(true);
    expect(new File(Paths.document, "media", "miau.mp3").exists).toBe(true);

    picks.push(fixture("legacy2.apkg"));
    await fireEvent.press(screen.getByRole("button", { name: "Importar .apkg" }));
    expect(
      await screen.findByText("Importado: 3 notas, 5 cartões e 0 revisões novas."),
    ).toBeDefined();
    const state = await Effect.runPromise(localData((data) => data.collection));
    expect(state.decks.filter((d) => d.fields.name.value === "Português::Verbos")).toHaveLength(1);
    expect(state.cards.filter((c) => c.anki)).toHaveLength(5);

    // Cancelling the picker changes nothing.
    await fireEvent.press(screen.getByRole("button", { name: "Importar .apkg" }));
    await screen.findByRole("button", { name: "Importar .apkg" });
    expect(screen.queryByText(/Não foi possível importar/)).toBeNull();
    expect(api.calls.metadata).toBe(0);
  } finally {
    await api.dispose();
  }
});

test("imported cards study with their templates, cloze numbers and local media", async () => {
  picks.push(fixture("latest.apkg"));
  await pickAndImportApkg();
  const state = await Effect.runPromise(localData((data) => data.collection));
  const deck = state.decks.find((d) => d.fields.name.value === "Português::Verbos")!;
  await render(
    <QueryClientProvider client={client()}>
      <StudyScreen deckId={deck.id} locale="pt-BR" onExit={() => {}} />
    </QueryClientProvider>,
  );
  const fronts: string[] = [];
  const backs: string[] = [];
  // The suspended reverse card stays out: four cards, each answered once, in order.
  /* oxlint-disable eslint/no-await-in-loop -- Each answer brings the next card. */
  for (let i = 0; i < 4; i++) {
    const reveal = await screen.findByRole("button", { name: "Mostrar resposta" });
    fronts.push(String(screen.getByLabelText("Frente").props.source.html));
    await fireEvent.press(reveal);
    backs.push(String(screen.getByLabelText("Verso").props.source.html));
    await fireEvent.press(screen.getByRole("button", { name: "Bom" }));
  }
  await screen.findByText("Nenhum cartão disponível agora. Os limites diários se aplicam.");
  const media = new File(Paths.document, "media", "gato.png").uri;
  const html = backs.join("\n");
  expect(html).toContain(`<img src="${media}">`);
  expect(html).toContain(`src="${new File(Paths.document, "media", "miau.mp3").uri}"`);
  expect(html).toContain('<span class="cloze" data-ordinal="1">Brasília</span>');
  expect(html).toContain('<span class="cloze" data-ordinal="2">Brasil</span>');
  expect(html).toContain("casa");
  const asked = fronts.join("\n");
  expect(asked).toContain('<span class="cloze" data-ordinal="1">[...]</span>');
  expect(asked).toContain('<span class="cloze" data-ordinal="2">[país]</span>');
  expect(asked).not.toContain("house");
});
