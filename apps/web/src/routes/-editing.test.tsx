import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";

import { webRequest } from "#/data/client.ts";

import { renderRoute } from "../../test/render.tsx";

test("a new deck gets options and a note, which the browser finds and edits as you type", async () => {
  const { user } = await renderRoute("/");
  await user.click(await screen.findByRole("link", { name: "Novo baralho" }));
  await user.type(await screen.findByLabelText("Nome do baralho"), "Inglês");
  await user.click(screen.getByRole("button", { name: "Criar baralho" }));
  expect(await screen.findByRole("heading", { name: "Inglês" })).toBeDefined();

  expect(screen.queryByLabelText("Cartões novos por dia")).toBeNull();
  expect(screen.queryByRole("button", { name: "Exportar .apkg" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Opções do baralho" }));

  const retention = screen.getByRole("slider", { name: "Retenção desejada" });
  fireEvent.change(retention, { target: { value: "85" } });
  expect(retention).toHaveProperty("value", "85");
  expect(screen.queryByLabelText("Parâmetros do FSRS")).toBeNull();
  await user.click(screen.getByText("Avançado"));
  expect(screen.getByLabelText("Parâmetros do FSRS")).toBeDefined();
  // Deck options: Core's rules check what is typed, then the preset saves.
  const newPerDay = screen.getByLabelText("Cartões novos por dia");
  await user.clear(newPerDay);
  await user.type(newPerDay, "1.5");
  expect(await screen.findByText("Use um número inteiro de 0 a 9999.")).toBeDefined();
  expect(screen.getByRole("button", { name: "Salvar" })).toHaveProperty("disabled", true);
  await user.clear(newPerDay);
  await user.type(newPerDay, "5");
  await user.click(screen.getByRole("button", { name: "Salvar" }));
  expect(await screen.findByText("Salvo.")).toBeDefined();
  // Leaving and coming back shows what was saved.
  await user.click(screen.getByRole("link", { name: "‹ Voltar" }));
  await user.click(await screen.findByRole("button", { name: "Opções do baralho" }));
  expect(await screen.findByLabelText("Cartões novos por dia")).toHaveProperty("value", "5");

  await user.click(screen.getByRole("link", { name: "‹ Voltar" }));
  await user.click(screen.getByRole("button", { name: "Adicionar nota" }));
  await user.type(await screen.findByLabelText("Frente"), "cat");
  await user.type(screen.getByLabelText("Verso"), "gato");
  await user.click(screen.getByRole("button", { name: "Adicionar" }));
  expect(await screen.findByText("Nota adicionada.")).toBeDefined();
  const cards = screen.getByRole("list", { name: "Cartões" });
  expect(await within(cards).findByRole("button", { name: /cat/ })).toBeDefined();
  // Another note, added elsewhere (another tab): the browser lists it too.
  const { decks } = await webRequest("collection");
  await webRequest("change", {
    kind: "addNote",
    deckId: decks[0]!.id,
    noteTypeId: "",
    values: ["bird", "pássaro"],
  });

  // The browser lists cards by their front, and the search waits for typing to pause.
  expect(await within(cards).findByRole("button", { name: /bird/ })).toBeDefined();
  await user.type(screen.getByRole("searchbox", { name: "Buscar" }), "GATO");
  await waitFor(() => expect(within(cards).queryByRole("button", { name: /bird/ })).toBeNull());
  expect(screen.getByText("1 cartões")).toBeDefined();
  await user.click(within(cards).getByRole("button", { name: /cat/ }));
  const back = await screen.findByLabelText("Verso");
  expect(back).toHaveProperty("value", "gato");
  await user.clear(back);
  await user.type(back, "gata");
  // Autosave: no button, a save once typing pauses.
  expect(await screen.findByText("Salvo.", {}, { timeout: 3000 })).toBeDefined();
  await user.clear(screen.getByRole("searchbox", { name: "Buscar" }));
  await user.click(await within(cards).findByRole("button", { name: /bird/ }));
  expect(await screen.findByLabelText("Verso")).toHaveProperty("value", "pássaro");
  await user.click(within(cards).getByRole("button", { name: /cat/ }));
  await waitFor(() => expect(screen.getByLabelText("Verso")).toHaveProperty("value", "gata"));

  // Card actions wait for a first review, then move and forget the card.
  const card = screen.getByRole("group", { name: "Card 1" });
  expect(within(card).getByRole("button", { name: "Esquecer" })).toHaveProperty("disabled", true);
  expect(within(card).getByText("Novo")).toBeDefined();
  const state = await webRequest("collection");
  const cat = state.notes.find((n) => n.values[0]!.value === "cat")!;
  const cardId = state.cards.find((c) => c.fields.noteId.value === cat.id)!.id;
  await webRequest("answerCard", cardId, 3, 2000);
  const due = await within(card).findByText(/^Vence em /);
  const reviewed = due.textContent;
  const days = within(card).getByLabelText("Vence daqui a quantos dias (0 = hoje)");
  await user.clear(days);
  await user.type(days, "7");
  await user.click(within(card).getByRole("button", { name: "Definir vencimento" }));
  await waitFor(() => expect(within(card).getByText(/^Vence em /).textContent).not.toBe(reviewed));
  await user.click(within(card).getByRole("button", { name: "Esquecer" }));
  await user.click(within(card).getByRole("button", { name: "Esquecer" }));
  expect(await within(card).findByText("Novo")).toBeDefined();

  await user.click(screen.getByRole("button", { name: "Excluir nota" }));
  await user.click(screen.getByRole("button", { name: "Excluir" }));
  expect(await screen.findByText("Escolha um cartão para editar a nota.")).toBeDefined();
  await waitFor(() => expect(within(cards).queryByRole("button", { name: /cat/ })).toBeNull());
  expect(within(cards).getByRole("button", { name: /bird/ })).toBeDefined();
}, 30_000);

test("the browser finds flagged and marked cards", async () => {
  const deckId = await webRequest("change", { kind: "createDeck", name: "Bandeiras" });
  await Promise.all(
    ["red", "blue", "star"].map((front) =>
      webRequest("change", {
        kind: "addNote",
        deckId: deckId!,
        noteTypeId: "",
        values: [front, ""],
      }),
    ),
  );
  const state = await webRequest("collection");
  const note = (front: string) => state.notes.find((n) => n.values[0]!.value === front)!;
  const card = (front: string) =>
    state.cards.find((c) => c.fields.noteId.value === note(front).id)!;
  await webRequest("change", { kind: "setCardFlag", id: card("red").id, flag: 1 });
  await webRequest("change", { kind: "setCardFlag", id: card("blue").id, flag: 4 });
  await webRequest("change", { kind: "setNoteMarked", id: note("star").id, marked: true });

  const { user } = await renderRoute("/browse");
  const cards = await screen.findByRole("list", { name: "Cartões" });
  const search = screen.getByRole("searchbox", { name: "Buscar" });
  const found = async (query: string, fronts: string[]) => {
    await user.clear(search);
    await user.type(search, `deck:Bandeiras ${query}{Enter}`);
    await waitFor(() =>
      expect(
        within(cards)
          .getAllByRole("button")
          .map((b) => ["red", "blue", "star"].find((f) => b.textContent?.startsWith(f))),
      ).toEqual(fronts),
    );
  };
  await found("flag:4", ["blue"]);
  await found("flag:1", ["red"]);
  await found("is:marked", ["star"]);
  await found("-is:marked -flag:1", ["blue"]);
  expect(screen.getByText(/flag:1.*is:marked/)).toBeDefined();
});

test("deck options protect unsaved changes and leave freely after saving", async () => {
  const id = await webRequest("change", { kind: "createDeck", name: "Draft options" });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  try {
    const { user } = await renderRoute(`/deck?deck=${id}&options=true&lang=en`);
    const limit = await screen.findByLabelText("New cards per day");
    await user.clear(limit);
    await user.type(limit, "7");
    await user.click(screen.getByRole("link", { name: "‹ Back" }));
    expect(confirm).toHaveBeenCalledWith("Discard unsaved changes?");
    expect(screen.getByLabelText("New cards per day")).toHaveProperty("value", "7");
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("link", { name: "‹ Back" }));
    await user.click(await screen.findByRole("button", { name: "Deck options" }));
    expect(await screen.findByLabelText("New cards per day")).not.toHaveProperty("value", "7");
    await user.clear(screen.getByLabelText("New cards per day"));
    await user.type(screen.getByLabelText("New cards per day"), "8");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    confirm.mockClear();
    await user.click(screen.getByRole("link", { name: "‹ Back" }));
    await screen.findByRole("button", { name: "Deck options" });
    expect(confirm).not.toHaveBeenCalled();
  } finally {
    confirm.mockRestore();
  }
});
