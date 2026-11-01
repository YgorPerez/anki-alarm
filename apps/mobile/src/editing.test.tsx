import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import { openDatabaseAsync } from "expo-sqlite";
import { fakeSyncApi } from "@app/contracts/testing";
import type { Collection } from "@app/core";
import { answerAlert } from "../test/native/react-native.ts";
import { memoryAnkiDroid } from "./ankidroid.ts";
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
      <CollectionScreen
        locale="pt-BR"
        onExit={() => {}}
        onTheme={() => {}}
        ankiDroid={memoryAnkiDroid({ installed: null })}
      />
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
  expect(screen.queryByRole("button", { name: "Exportar .apkg" })).toBeNull();
  await press("button", "Opções do baralho");
  expect(screen.getByRole("button", { name: "Exportar .apkg" })).toBeDefined();
  expect(await screen.findByText(/Estas opções valem para \d+ baralhos\./)).toBeDefined();
  for (const name of [
    "Enterrar irmãos novos",
    "Enterrar irmãos de revisão",
    "Enterrar irmãos em aprendizado",
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- User interactions run in order.
    await fireEvent(screen.getByRole("switch", { name }), "valueChange", true);
  }
  const slider = screen.getByRole("adjustable", { name: "Retenção desejada" });
  expect(slider.props.accessibilityValue.now).toBe(90);
  await fireEvent(slider, "accessibilityAction", { nativeEvent: { actionName: "decrement" } });
  expect(screen.getByRole("adjustable").props.accessibilityValue.now).toBe(89);
  expect(screen.queryByLabelText("Parâmetros do FSRS")).toBeNull();
  await press("button", "Avançado");
  expect(screen.getByLabelText("Parâmetros do FSRS").props.value.split(",")).toHaveLength(21);
  await fireEvent.changeText(screen.getByLabelText("Etapas de aprendizado (minutos)"), "-1");
  expect(
    await screen.findByText("Use minutos maiores que zero, separados por espaço."),
  ).toBeDefined();
  expect(screen.getByRole("button", { name: "Salvar" }).props.accessibilityState.disabled).toBe(
    true,
  );
  await fireEvent.changeText(screen.getByLabelText("Cartões novos por dia"), "5");
  await fireEvent.changeText(screen.getByLabelText("Etapas de aprendizado (minutos)"), "2 15");
  await fireEvent.changeText(screen.getByLabelText("Etapas de reaprendizado (minutos)"), "3 20");
  await fireEvent.changeText(screen.getByLabelText("Limite de lapsos (0 desativa)"), "4");
  await fireEvent.changeText(screen.getByLabelText("Intervalo máximo (dias)"), "90");
  await fireEvent.press(
    within(screen.getByLabelText("Ordem de inserção")).getByRole("radio", { name: "Aleatória" }),
  );
  await press("radio", "Suspender");
  const newMix = within(screen.getByLabelText("Cartões novos e revisões"));
  await fireEvent.press(newMix.getByRole("radio", { name: "Antes das revisões" }));
  await press("radio", "Atraso relativo");
  await press("button", "Salvar");
  await screen.findByRole("button", { name: "Opções do baralho" });

  const preset = (await run((data) => data.collection)).presets.find((p) => p.id === presetId)!;
  expect(preset.fields.desiredRetention.value).toBe(0.89);
  expect(preset.fields.newPerDay.value).toBe(5);
  expect(preset.fields.learningSteps.value).toEqual([2, 15]);
  expect(preset.fields.relearningSteps.value).toEqual([3, 20]);
  expect(preset.fields.leechThreshold.value).toBe(4);
  expect(preset.fields.maximumInterval.value).toBe(90);
  expect(preset.fields.insertionOrder.value).toBe("random");
  expect(preset.fields.leechAction.value).toBe("suspend");
  expect(preset.fields.fsrsParameters.value).toHaveLength(21);
  expect([
    preset.fields.buryNew.value,
    preset.fields.buryReviews.value,
    preset.fields.buryLearning.value,
  ]).toEqual([true, true, true]);
  expect(preset.fields.newMix.value).toBe("before");
  expect(preset.fields.interdayLearningMix.value).toBe("mix");
  expect(preset.fields.reviewOrder.value).toBe("relativeOverdueness");
});

test("deck options set each weekday's easy day", async () => {
  const state = await change((c) => {
    c.createDeck("Folga");
  });
  const presetId = state.decks.find((d) => d.fields.name.value === "Folga")!.fields.presetId.value;
  await open();
  await press("button", /Folga/);
  await press("button", "Opções do baralho");
  const sunday = screen.getByLabelText("Domingo");
  expect(
    within(sunday).getByRole("radio", { name: "Normal" }).props.accessibilityState.checked,
  ).toBe(true);
  await fireEvent.press(within(sunday).getByRole("radio", { name: "Mínimo" }));
  await fireEvent.press(
    within(screen.getByLabelText("Sábado")).getByRole("radio", {
      name: "Reduzido",
    }),
  );
  await press("button", "Salvar");
  await screen.findByRole("button", { name: "Opções do baralho" });

  const preset = (await run((data) => data.collection)).presets.find((p) => p.id === presetId)!;
  expect(preset.fields.easyDays.value).toEqual([
    "normal",
    "normal",
    "normal",
    "normal",
    "normal",
    "reduced",
    "minimum",
  ]);
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

test("deck options leave cleanly, but Back and Cancel protect unsaved edits", async () => {
  await change((c) => {
    c.createDeck("Draft options");
  });
  await open();
  await press("button", /Draft options/);
  await press("button", "Opções do baralho");
  await press("button", "Voltar");
  expect(screen.queryByLabelText("Cartões novos por dia")).toBeNull();
  await press("button", "Opções do baralho");
  await fireEvent.changeText(screen.getByLabelText("Cartões novos por dia"), "7");
  await press("button", "Cancelar");
  expect(screen.getByLabelText("Cartões novos por dia").props.value).toBe("7");
  answerAlert("Cancelar");
  await press("button", "Voltar");
  answerAlert("Descartar");
  await press("button", "Opções do baralho");
  expect(screen.getByLabelText("Cartões novos por dia").props.value).not.toBe("7");
});

test("deck options create, copy, rename, switch and delete presets", async () => {
  await change((c) => {
    c.createDeck("Predefinições");
  });
  await open();
  await press("button", /Predefinições/);
  await press("button", "Opções do baralho");
  expect(await screen.findByText(/Usada por \d+ baralhos/)).toBeDefined();
  await fireEvent.changeText(screen.getByLabelText("Nome para a predefinição"), "Intensivo");
  await press("button", "Criar predefinição");
  await waitFor(() =>
    expect(screen.getByRole("radio", { name: "Intensivo" }).props.accessibilityState.checked).toBe(
      true,
    ),
  );
  await fireEvent.changeText(screen.getByLabelText("Nome para a predefinição"), "Cópia");
  await press("button", "Duplicar predefinição");
  await waitFor(() =>
    expect(screen.getByRole("radio", { name: "Cópia" }).props.accessibilityState.checked).toBe(
      true,
    ),
  );
  await fireEvent.changeText(screen.getByLabelText("Nome para a predefinição"), "Renomeada");
  await press("button", "Renomear predefinição");
  await screen.findByRole("radio", { name: "Renomeada" });
  await press("radio", "Intensivo");
  await waitFor(() =>
    expect(screen.getByRole("radio", { name: "Intensivo" }).props.accessibilityState.checked).toBe(
      true,
    ),
  );
  await press("button", "Excluir predefinição");
  answerAlert("Excluir predefinição");
  await waitFor(() => expect(screen.queryByRole("radio", { name: "Intensivo" })).toBeNull());
  expect(
    screen.getByRole("button", { name: "Excluir predefinição" }).props.accessibilityState.disabled,
  ).toBe(true);
});
