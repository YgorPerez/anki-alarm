import { fireEvent, render, screen, waitFor } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import { openDatabaseAsync } from "expo-sqlite";
import { fakeSyncApi } from "@app/contracts/testing";
import type { Collection } from "@app/core";
import { answerAlert } from "../test/native/react-native.ts";
import { localData } from "./database.ts";
import { CollectionScreen } from "./CollectionScreen.tsx";

const run = <A,>(read: Parameters<typeof localData<A>>[0]) => Effect.runPromise(localData(read));
const change = (command: (c: Collection) => void) => run((data) => data.changeCollection(command));
async function open() {
  await render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always" } } })
      }
    >
      <CollectionScreen locale="pt-BR" onExit={() => {}} onTheme={() => {}} />
    </QueryClientProvider>,
  );
}
const press = async (role: "button" | "radio", name: string | RegExp) =>
  fireEvent.press(await screen.findByRole(role, { name }));

/** A three-field note type, as an import brings one: the phone can't create note types. */
async function seedVocabularyType() {
  const state = await change((c) => {
    c.addBasicNote(c.createDeck("Seed").id, "seed", "");
  });
  const type = structuredClone(state.noteTypes[0]!);
  type.id = "018bcfe5-6800-7fff-bfff-0000000000aa";
  type.fields.name.value = "Vocabulário";
  type.fields.fieldNames.value = ["Word", "Reading", "Meaning"];
  const db = await openDatabaseAsync("collection.db");
  await db.runAsync('INSERT INTO "noteTypes" (id, body) VALUES (?, ?)', [
    type.id,
    JSON.stringify(type),
  ]);
  return type.id;
}

test("edits every field of an imported note type and moves its card to another deck", async () => {
  const api = await fakeSyncApi({});
  try {
    const typeId = await seedVocabularyType();
    const state = await change((c) => {
      const deck = c.createDeck("Japonês");
      c.createDeck("Kanji");
      c.addNote(deck.id, typeId, ["水", "みず", "water"]);
    });
    const kanji = state.decks.find((d) => d.fields.name.value === "Kanji")!;
    await open();
    await press("button", /Japonês/);
    await press("button", "Editar nota: 水");
    expect(
      screen.getByText("Campos, modelos e CSS dos tipos de nota são editados na versão web."),
    ).toBeDefined();
    expect(screen.getByLabelText("Reading").props.value).toBe("みず");
    await fireEvent.changeText(screen.getByLabelText("Meaning"), "water (drink)");
    await fireEvent.changeText(screen.getByLabelText("Word"), "");
    expect(await screen.findByText("Preencha o primeiro campo.")).toBeDefined();
    await fireEvent.changeText(screen.getByLabelText("Word"), "水");
    await press("radio", "Kanji");
    await press("button", "Salvar");
    await screen.findByText("Nenhum cartão. Adicione uma nota com frente e verso.");

    const saved = await run((data) => data.collection);
    const note = saved.notes.find((n) => n.values[0]?.value === "水")!;
    expect(note.values.map((v) => v.value)).toEqual(["水", "みず", "water (drink)"]);
    expect(saved.cards.find((c) => c.fields.noteId.value === note.id)?.fields.deckId.value).toBe(
      kanji.id,
    );
    expect(api.calls.metadata).toBe(0);
  } finally {
    await api.dispose();
  }
});

test("a new note picks its note type and shows that type's fields", async () => {
  await change((c) => {
    c.createDeck("Escolha");
  });
  await open();
  await press("button", /Escolha/);
  await press("button", "Adicionar nota");
  await press("radio", "Vocabulário");
  await fireEvent.changeText(await screen.findByLabelText("Word"), "火");
  await fireEvent.changeText(screen.getByLabelText("Meaning"), "fire");
  await press("button", "Salvar");
  expect(await screen.findByRole("button", { name: "Editar nota: 火" })).toBeDefined();
  const saved = await run((data) => data.collection);
  expect(saved.notes.find((n) => n.values[0]?.value === "火")?.values.map((v) => v.value)).toEqual([
    "火",
    "",
    "fire",
  ]);
});

test("deck options save limits, retention and learning steps, and refuse what FSRS can't use", async () => {
  const state = await change((c) => {
    c.createDeck("Opções");
  });
  const presetId = state.decks.find((d) => d.fields.name.value === "Opções")!.fields.presetId.value;
  await open();
  await press("button", /Opções/);
  await press("button", "Opções do baralho");
  expect(await screen.findByText(/Estas opções valem para \d+ baralhos\./)).toBeDefined();
  await fireEvent.changeText(screen.getByLabelText("Retenção desejada"), "0,5");
  expect(await screen.findByText("Use um valor de 0,70 a 0,99.")).toBeDefined();
  expect(screen.getByRole("button", { name: "Salvar" }).props.accessibilityState.disabled).toBe(
    true,
  );
  await fireEvent.changeText(screen.getByLabelText("Retenção desejada"), "0,85");
  await fireEvent.changeText(screen.getByLabelText("Cartões novos por dia"), "5");
  await fireEvent.changeText(screen.getByLabelText("Etapas de aprendizado (minutos)"), "2 15");
  await press("button", "Salvar");
  await screen.findByRole("button", { name: "Opções do baralho" });

  const preset = (await run((data) => data.collection)).presets.find((p) => p.id === presetId)!;
  expect(preset.fields.desiredRetention.value).toBe(0.85);
  expect(preset.fields.newPerDay.value).toBe(5);
  expect(preset.fields.learningSteps.value).toEqual([2, 15]);
  expect(preset.fields.fsrsParameters.value).toHaveLength(21);
});

test("Set due date and Forget append their log entries for a studied card", async () => {
  const state = await change((c) => {
    c.addBasicNote(c.createDeck("Revisar").id, "livro", "book");
  });
  const note = state.notes.find((n) => n.values[0]?.value === "livro")!;
  const cardId = state.cards.find((c) => c.fields.noteId.value === note.id)!.id;
  await run((data) => data.answerCard(cardId, 4, 1000));
  await open();
  await press("button", /Revisar/);
  await press("button", "Editar nota: livro");
  expect(await screen.findByText(/^Vence em /)).toBeDefined();
  await fireEvent.changeText(screen.getByLabelText("Vence daqui a quantos dias (0 = hoje)"), "0");
  await press("button", "Definir vencimento");
  await waitFor(async () =>
    expect((await run((data) => data.reviewLog)).at(-1)).toMatchObject({
      kind: "setDueDate",
      cardId,
    }),
  );
  await press("button", "Esquecer");
  answerAlert("Esquecer");
  expect(await screen.findByText("Disponível depois da primeira revisão.")).toBeDefined();
  const log = await run((data) => data.reviewLog);
  expect(log.at(-1)).toMatchObject({ kind: "reset", cardId });
  expect(log.filter((e) => e.cardId === cardId).map((e) => e.kind)).toEqual([
    "review",
    "setDueDate",
    "reset",
  ]);
});
