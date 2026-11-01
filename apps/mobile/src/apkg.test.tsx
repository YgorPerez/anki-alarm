/// <reference types="node" />
import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { fakeSyncApi } from "@app/contracts/testing";
import { File, Paths, folders, picks } from "../test/native/expo-file-system.ts";
import { memoryAnkiDroid } from "./ankidroid.ts";
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
        <CollectionScreen
          locale="pt-BR"
          onExit={() => {}}
          onTheme={() => {}}
          ankiDroid={memoryAnkiDroid({ installed: null })}
        />
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
    const reveal = await screen.findByLabelText("Frente");
    fronts.push(String(screen.getByLabelText("Frente").props.source.html));
    await fireEvent(reveal, "accessibilityAction", { nativeEvent: { actionName: "activate" } });
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

test("exports a deck into a picked folder and importing the file back adds nothing", async () => {
  await render(
    <QueryClientProvider client={client()}>
      <CollectionScreen
        locale="pt-BR"
        onExit={() => {}}
        onTheme={() => {}}
        ankiDroid={memoryAnkiDroid({ installed: null })}
      />
    </QueryClientProvider>,
  );
  await fireEvent.press(await screen.findByRole("button", { name: /Português::Verbos/ }));
  await fireEvent.press(screen.getByRole("button", { name: "Opções do baralho" }));
  // Leaving the folder picker exports nothing and says nothing.
  await fireEvent.press(await screen.findByRole("button", { name: "Exportar .apkg" }));
  await screen.findByRole("button", { name: "Exportar .apkg" });
  expect(screen.queryByText(/Salvo como|Não foi possível exportar/)).toBeNull();

  const folder = mkdtempSync(join(tmpdir(), "export-"));
  folders.push(folder);
  await fireEvent.press(screen.getByRole("button", { name: "Exportar .apkg" }));
  expect(await screen.findByText("Salvo como Português - Verbos.apkg.")).toBeDefined();
  const zip = unzipSync(readFileSync(join(folder, "Português - Verbos.apkg")));
  expect(Object.keys(zip).toSorted((a, b) => a.localeCompare(b))).toEqual([
    "0",
    "1",
    "collection.anki21",
    "media",
    "meta",
  ]);
  expect(JSON.parse(new TextDecoder().decode(zip.media))).toEqual({
    "0": "gato.png",
    "1": "miau.mp3",
  });

  // The phone's own answers from the study test come back as the reviews they already are.
  picks.push(join(folder, "Português - Verbos.apkg"));
  expect(await pickAndImportApkg()).toEqual({ notes: 3, cards: 5, entries: 0 });
});
